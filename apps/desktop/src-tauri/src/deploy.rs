//! Deploys and validations as background jobs.
//!
//! Every deploy used to run as one blocking `sf project deploy … --wait 10`
//! call: it could not be cancelled, the window showed a spinner for its whole
//! length, and a deploy that outlived the ten-minute wait was reported as a
//! failure while it carried on in the org — with its job id lost. Jobs now
//! start with `--async`, the UI polls `deploy report` for progress, cancels
//! with `deploy cancel`, and every job is kept in a history file so an app
//! restart picks up where it left off.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use ts_rs::TS;

use crate::diff::files_under;
use crate::error::{AppError, AppResult, ErrorKind};
use crate::metadata::{package_xml, MAX_INLINE_METADATA_CHARS};
use crate::orgs::org_version_and_name;
use crate::sf::discover::sf_command;
use crate::sf::json::{cli_failure, envelope_failure, parse_sf_json, sf_plain_error};
use crate::sf::runner::{run_with_limits, RunGuard};
use crate::util::{blocking, lock, now_millis, write_atomic, TempDir, TempFile};
use crate::workspace::changes;
use crate::workspace::paths::{resolve_in_workspace, resolve_paths, to_relative_string};
use crate::workspace::registry::{read_registry, workspace_root};
use crate::workspace::sfdx_project::{package_directories, source_api_version, write_project_file};

/* ─────────────────────────────────────────────────────────────────
Options
───────────────────────────────────────────────────────────────── */

/// What a deploy sends.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum DeployScope {
    /// Every package directory of the workspace.
    Workspace,
    /// Specific workspace-relative files or folders.
    Paths { paths: Vec<String> },
    /// Metadata specs such as `ApexClass` or `ApexClass:Foo`.
    Metadata { metadata: Vec<String> },
    /// A `package.xml` in the workspace — the portable way to name a set.
    Manifest { path: String },
    /// Components taken from another org, staged and sent on.
    ///
    /// The same specs as `Metadata`, but retrieved out of `source_username`
    /// into a throwaway project first. The open workspace is not read, and
    /// there need not be one.
    #[serde(rename_all = "camelCase")]
    OrgSource {
        source_username: String,
        metadata: Vec<String>,
    },
}

/// How a deploy or validation runs.
#[derive(TS, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct DeployOptions {
    pub scope: DeployScope,
    /// A validation (`deploy validate`): nothing is committed, and the job can
    /// later be promoted with a quick deploy.
    pub check_only: bool,
    /// `NoTestRun`, `RunSpecifiedTests`, `RunLocalTests`, `RunAllTestsInOrg`
    /// or `RunRelevantTests`. `None` lets the org decide.
    pub test_level: Option<String>,
    /// Apex test classes, for `RunSpecifiedTests`.
    pub tests: Vec<String>,
    pub ignore_warnings: bool,
    /// Shown in history, e.g. "3 files" or "ApexClass, Flow".
    pub label: String,
}

const TEST_LEVELS: &[&str] = &[
    "NoTestRun",
    "RunSpecifiedTests",
    "RunLocalTests",
    "RunAllTestsInOrg",
    "RunRelevantTests",
];

/// A test class name: letters, digits, `_`, and `.` for a namespace prefix.
fn valid_test_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with(['-', '.'])
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.')
}

/// The deploy arguments after the scope, validated. Pure, so it is testable
/// without the CLI.
pub(crate) fn option_args(options: &DeployOptions) -> Result<Vec<String>, String> {
    let mut args = Vec::new();

    if let Some(level) = options.test_level.as_deref() {
        if !TEST_LEVELS.contains(&level) {
            return Err(format!("'{level}' is not a test level."));
        }
        if options.check_only && level == "NoTestRun" {
            return Err(
                "A validation has to run tests. Pick \"Run local tests\" or \"Run specified tests\"."
                    .to_string(),
            );
        }
        args.push("--test-level".to_string());
        args.push(level.to_string());
    }

    let tests: Vec<&str> = options
        .tests
        .iter()
        .map(|test| test.trim())
        .filter(|test| !test.is_empty())
        .collect();
    let specified = options.test_level.as_deref() == Some("RunSpecifiedTests");
    if specified && tests.is_empty() {
        return Err("\"Run specified tests\" needs at least one test class.".to_string());
    }
    if !specified && !tests.is_empty() {
        return Err("Test classes are only used with \"Run specified tests\".".to_string());
    }
    for test in tests {
        if !valid_test_name(test) {
            return Err(format!("'{test}' is not a valid Apex test class name."));
        }
        args.push("--tests".to_string());
        args.push(test.to_string());
    }

    if options.ignore_warnings {
        args.push("--ignore-warnings".to_string());
    }
    Ok(args)
}

/// Longest `--source-dir` list sent inline. cmd.exe rejects command lines over
/// 8191 characters, and the rest of the command needs room.
const MAX_INLINE_PATH_CHARS: usize = 6500;

/// Specs with the blanks taken out, refusing a selection that names nothing.
fn clean_specs(metadata: &[String]) -> Result<Vec<String>, String> {
    let specs: Vec<String> = metadata
        .iter()
        .map(|spec| spec.trim().to_string())
        .filter(|spec| !spec.is_empty())
        .collect();
    if specs.is_empty() {
        return Err("No metadata was selected.".to_string());
    }
    Ok(specs)
}

/// The scope's arguments, plus a manifest file to keep alive while the CLI runs.
///
/// `workspace` is where the command will run: the open project for the local
/// scopes, and the staging project for `OrgSource`.
fn scope_args(
    workspace: &Path,
    scope: &DeployScope,
) -> Result<(Vec<String>, Option<TempFile>), String> {
    match scope {
        // Staged by `stage_from_org` before this is called, so what it sends
        // is the staging project — which holds the selected components only.
        DeployScope::Workspace | DeployScope::OrgSource { .. } => {
            let mut args = Vec::new();
            for dir in package_directories(workspace) {
                args.push("--source-dir".to_string());
                args.push(dir);
            }
            Ok((args, None))
        }
        DeployScope::Paths { paths } => {
            let targets = resolve_paths(workspace, paths)?;
            let length: usize = targets.iter().map(|path| path.len() + 16).sum();
            if length > MAX_INLINE_PATH_CHARS {
                return Err(format!(
                    "{} files are too many for one deploy command. Deploy their folder instead.",
                    targets.len()
                ));
            }
            let mut args = Vec::new();
            for target in targets {
                args.push("--source-dir".to_string());
                args.push(target);
            }
            Ok((args, None))
        }
        DeployScope::Manifest { path } => {
            // Resolved inside the workspace: a manifest path from the page
            // must not reach a file anywhere else.
            let manifest = resolve_in_workspace(workspace, path)?;
            if !manifest.is_file() {
                return Err(format!("{path} is not a file in this workspace."));
            }
            Ok((
                vec![
                    "--manifest".to_string(),
                    manifest.to_string_lossy().to_string(),
                ],
                None,
            ))
        }
        DeployScope::Metadata { metadata } => {
            let specs = clean_specs(metadata)?;
            let length: usize = specs.iter().map(|spec| spec.len() + 14).sum();
            if length > MAX_INLINE_METADATA_CHARS {
                let xml = package_xml(&specs, source_api_version(workspace).as_deref());
                let manifest = TempFile::create("xml", &xml)?;
                let args = vec![
                    "--manifest".to_string(),
                    manifest.path().to_string_lossy().to_string(),
                ];
                return Ok((args, Some(manifest)));
            }
            let mut args = Vec::new();
            for spec in specs {
                args.push("--metadata".to_string());
                args.push(spec);
            }
            Ok((args, None))
        }
    }
}

/* ─────────────────────────────────────────────────────────────────
History
───────────────────────────────────────────────────────────────── */

/// One deploy, validation or quick deploy, as kept in history.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct DeployRecord {
    pub job_id: String,
    pub username: String,
    pub workspace_id: Option<String>,
    pub workspace_name: String,
    pub check_only: bool,
    pub label: String,
    pub test_level: Option<String>,
    /// Set on a quick deploy: the validation it promoted.
    pub quick_deploy_of: Option<String>,
    /// Set on a validation once a quick deploy promoted it.
    pub promoted_by: Option<String>,
    /// The org's status: `Pending`, `InProgress`, `Succeeded`,
    /// `SucceededPartial`, `Failed`, `Canceling`, `Canceled`.
    pub status: String,
    pub done: bool,
    #[ts(type = "number")]
    pub created_at: u64,
    #[ts(type = "number | null")]
    pub completed_at: Option<u64>,
    pub components_total: u32,
    pub components_deployed: u32,
    pub component_errors: u32,
    pub tests_total: u32,
    pub tests_completed: u32,
    pub test_errors: u32,
    pub error: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct HistoryFile {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    records: Vec<DeployRecord>,
}

const HISTORY_FILE: &str = "deploy-history.json";
/// Oldest finished jobs beyond this are dropped.
const HISTORY_LIMIT: usize = 200;

static HISTORY_LOCK: Mutex<()> = Mutex::new(());

fn history_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(dir.join(HISTORY_FILE))
}

fn read_history_file(path: &Path) -> Vec<DeployRecord> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    match serde_json::from_str::<HistoryFile>(&raw) {
        Ok(file) => file.records,
        Err(_) => {
            // Keep an unreadable history for inspection rather than
            // overwriting it on the next write.
            let _ = fs::rename(
                path,
                path.with_extension(format!("corrupt-{}", now_millis())),
            );
            Vec::new()
        }
    }
}

fn write_history_file(path: &Path, mut records: Vec<DeployRecord>) -> Result<(), String> {
    if records.len() > HISTORY_LIMIT {
        // The cap goes by latest activity, so a long job that has only just
        // finished counts as recent rather than being dropped for having
        // started long ago. Running jobs are never dropped.
        records.sort_by_key(|record| {
            std::cmp::Reverse(record.completed_at.unwrap_or(record.created_at))
        });
        let mut kept = 0;
        records.retain(|record| {
            kept += 1;
            kept <= HISTORY_LIMIT || !record.done
        });
    }
    records.sort_by_key(|record| std::cmp::Reverse(record.created_at));
    let file = HistoryFile {
        version: 1,
        records,
    };
    let json = serde_json::to_string_pretty(&file).map_err(|error| error.to_string())?;
    write_atomic(path, json.as_bytes())
}

/// Applies `change` to the history under the lock.
fn update_history_at<T>(
    path: &Path,
    change: impl FnOnce(&mut Vec<DeployRecord>) -> T,
) -> Result<T, String> {
    let _guard = lock(&HISTORY_LOCK);
    let mut records = read_history_file(path);
    let result = change(&mut records);
    write_history_file(path, records)?;
    Ok(result)
}

fn upsert(records: &mut Vec<DeployRecord>, record: DeployRecord) {
    match records.iter_mut().find(|item| item.job_id == record.job_id) {
        Some(existing) => *existing = record,
        None => records.push(record),
    }
}

/* ─────────────────────────────────────────────────────────────────
Reports
───────────────────────────────────────────────────────────────── */

#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ComponentFailure {
    pub component_type: String,
    pub full_name: String,
    pub file_name: Option<String>,
    pub problem: String,
    pub problem_type: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct TestFailure {
    pub class_name: String,
    pub method_name: String,
    pub message: String,
    pub stack_trace: Option<String>,
}

#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct CoverageEntry {
    pub name: String,
    pub total_lines: u32,
    pub uncovered_lines: u32,
}

/// A job's current state as the org reports it.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct DeployReport {
    pub job_id: String,
    pub status: String,
    pub done: bool,
    pub success: bool,
    pub check_only: bool,
    pub components_total: u32,
    pub components_deployed: u32,
    pub component_errors: u32,
    pub tests_total: u32,
    pub tests_completed: u32,
    pub test_errors: u32,
    pub component_failures: Vec<ComponentFailure>,
    pub test_failures: Vec<TestFailure>,
    pub coverage: Vec<CoverageEntry>,
    /// Overall line coverage of the classes the tests touched.
    pub coverage_percent: Option<f64>,
    pub error_message: Option<String>,
    /// Workspace-relative files the deploy wrote, once it succeeded.
    pub deployed_files: Vec<String>,
}

const TERMINAL_STATUSES: &[&str] = &["Succeeded", "SucceededPartial", "Failed", "Canceled"];

pub(crate) fn is_terminal(status: &str, done: bool) -> bool {
    done || TERMINAL_STATUSES
        .iter()
        .any(|terminal| terminal.eq_ignore_ascii_case(status))
}

/// A JSON value as a list: the Metadata API returns a single object where a
/// list holds one element.
fn items(value: &serde_json::Value) -> Vec<&serde_json::Value> {
    match value {
        serde_json::Value::Array(values) => values.iter().collect(),
        serde_json::Value::Object(_) => vec![value],
        _ => Vec::new(),
    }
}

fn text(value: &serde_json::Value, key: &str) -> Option<String> {
    match value.get(key)? {
        serde_json::Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        serde_json::Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

/// A count that may arrive as a number or a numeric string.
fn count(value: &serde_json::Value, key: &str) -> u32 {
    match value.get(key) {
        Some(serde_json::Value::Number(number)) => number.as_u64().unwrap_or(0) as u32,
        Some(serde_json::Value::String(text)) => text.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

fn flag(value: &serde_json::Value, key: &str) -> bool {
    match value.get(key) {
        Some(serde_json::Value::Bool(flag)) => *flag,
        Some(serde_json::Value::String(text)) => text.eq_ignore_ascii_case("true"),
        _ => false,
    }
}

/// Builds a report from `sf project deploy report --json`'s `result`.
pub(crate) fn report_from_result(
    result: &serde_json::Value,
    job_id: &str,
    workspace: Option<&Path>,
) -> DeployReport {
    let details = &result["details"];

    let component_failures = items(&details["componentFailures"])
        .into_iter()
        .map(|failure| ComponentFailure {
            component_type: text(failure, "componentType").unwrap_or_default(),
            full_name: text(failure, "fullName").unwrap_or_default(),
            file_name: text(failure, "fileName"),
            problem: text(failure, "problem").unwrap_or_else(|| "Unknown problem".to_string()),
            problem_type: text(failure, "problemType"),
            line: text(failure, "lineNumber").and_then(|line| line.parse().ok()),
            column: text(failure, "columnNumber").and_then(|column| column.parse().ok()),
        })
        .collect();

    let tests = &details["runTestResult"];
    let test_failures = items(&tests["failures"])
        .into_iter()
        .map(|failure| TestFailure {
            class_name: text(failure, "name").unwrap_or_default(),
            method_name: text(failure, "methodName").unwrap_or_default(),
            message: text(failure, "message").unwrap_or_default(),
            stack_trace: text(failure, "stackTrace"),
        })
        .collect();

    let coverage: Vec<CoverageEntry> = items(&tests["codeCoverage"])
        .into_iter()
        .map(|entry| CoverageEntry {
            name: text(entry, "name").unwrap_or_default(),
            total_lines: count(entry, "numLocations"),
            uncovered_lines: count(entry, "numLocationsNotCovered"),
        })
        .collect();
    let (total, uncovered) = coverage.iter().fold((0u64, 0u64), |(t, u), entry| {
        (
            t + u64::from(entry.total_lines),
            u + u64::from(entry.uncovered_lines),
        )
    });
    let coverage_percent =
        (total > 0).then(|| ((total - uncovered) as f64 / total as f64 * 1000.0).round() / 10.0);

    let status = text(result, "status").unwrap_or_else(|| "Pending".to_string());
    let done = flag(result, "done");

    let deployed_files = match workspace {
        Some(root) if status.starts_with("Succeeded") => items(&result["files"])
            .into_iter()
            .filter(|file| {
                !text(file, "state").is_some_and(|state| state.eq_ignore_ascii_case("failed"))
            })
            .filter_map(|file| text(file, "filePath"))
            .map(|path| {
                let path = Path::new(&path);
                if path.is_absolute() {
                    to_relative_string(root, path)
                } else {
                    path.to_string_lossy().replace('\\', "/")
                }
            })
            .collect(),
        _ => Vec::new(),
    };

    DeployReport {
        job_id: text(result, "id").unwrap_or_else(|| job_id.to_string()),
        success: flag(result, "success"),
        check_only: flag(result, "checkOnly"),
        components_total: count(result, "numberComponentsTotal"),
        components_deployed: count(result, "numberComponentsDeployed"),
        component_errors: count(result, "numberComponentErrors"),
        tests_total: count(result, "numberTestsTotal"),
        tests_completed: count(result, "numberTestsCompleted"),
        test_errors: count(result, "numberTestErrors"),
        component_failures,
        test_failures,
        coverage,
        coverage_percent,
        error_message: text(result, "errorMessage"),
        deployed_files,
        status,
        done,
    }
}

/// Folds a report into its history record.
fn apply_report(record: &mut DeployRecord, report: &DeployReport) {
    record.status = report.status.clone();
    record.done = is_terminal(&report.status, report.done);
    record.components_total = report.components_total;
    record.components_deployed = report.components_deployed;
    record.component_errors = report.component_errors;
    record.tests_total = report.tests_total;
    record.tests_completed = report.tests_completed;
    record.test_errors = report.test_errors;
    record.error = report
        .error_message
        .clone()
        .or_else(|| report.component_failures.first().map(|f| f.problem.clone()))
        .or_else(|| report.test_failures.first().map(|f| f.message.clone()))
        .filter(|_| !report.status.starts_with("Succeeded"));
    if record.done && record.completed_at.is_none() {
        record.completed_at = Some(now_millis());
    }
}

/// Folds a report into its job's record. When this report is the one that
/// shows the job finishing, returns when the job read its files.
///
/// A job already known to be finished returns `None`: reopening the report of
/// last week's deploy must not mark files edited since then as matching the
/// org.
fn finish_record(records: &mut [DeployRecord], job_id: &str, report: &DeployReport) -> Option<u64> {
    let index = records.iter().position(|record| record.job_id == job_id)?;
    let was_done = records[index].done;
    apply_report(&mut records[index], report);
    if was_done || !records[index].done {
        return None;
    }
    // A quick deploy sends what its validation read.
    let record = &records[index];
    let read_at = record
        .quick_deploy_of
        .as_deref()
        .and_then(|validation| records.iter().find(|item| item.job_id == validation))
        .map_or(record.created_at, |validation| validation.created_at);
    Some(read_at)
}

/* ─────────────────────────────────────────────────────────────────
Commands
───────────────────────────────────────────────────────────────── */

/// How long starting a job may take — `--async` returns once it is queued.
const START_TIMEOUT: Duration = Duration::from_secs(5 * 60);
/// How long one status check may take.
const REPORT_TIMEOUT: Duration = Duration::from_secs(2 * 60);

/// A Salesforce id: 15 or 18 letters and digits.
fn valid_job_id(job_id: &str) -> bool {
    matches!(job_id.len(), 15 | 18) && job_id.chars().all(|c| c.is_ascii_alphanumeric())
}

fn workspace_name(app: &tauri::AppHandle, workspace_id: Option<&str>, root: &Path) -> String {
    read_registry(app)
        .ok()
        .and_then(|registry| {
            workspace_id.and_then(|id| {
                registry
                    .workspaces
                    .into_iter()
                    .find(|entry| entry.id == id)
                    .map(|entry| entry.name)
            })
        })
        .unwrap_or_else(|| {
            root.file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_default()
        })
}

/// How long staging the source org's components may take. A retrieve of a
/// large selection is slower than starting the deploy that follows it.
const STAGE_TIMEOUT: Duration = Duration::from_secs(10 * 60);

/// The package directory a staging project uses. Retrieves land in the CLI's
/// default layout, so the conventional name is the one to ask for.
const STAGE_PACKAGE_DIR: &str = "force-app";

/// The lower of two API versions, so a staged deploy asks for nothing the
/// target cannot accept. Either side being unknown defers to the other.
fn lower_api_version(source: Option<&str>, target: Option<&str>) -> Option<String> {
    let parse = |value: &str| value.trim().parse::<f64>().ok();
    match (source, target) {
        (Some(a), Some(b)) => match (parse(a), parse(b)) {
            // Versions read "68.0", so a numeric compare is the right one;
            // anything unparseable defers to the source.
            (Some(x), Some(y)) => Some(if x <= y { a.to_string() } else { b.to_string() }),
            _ => Some(a.to_string()),
        },
        (Some(a), None) => Some(a.to_string()),
        (None, other) => other.map(str::to_string),
    }
}

/// Retrieves the chosen components out of the source org into a throwaway
/// project, so they can be deployed on to the target.
///
/// This is how an org → org deploy works without a project on disk: the open
/// workspace is never read or written, and there need not be one. The
/// directory is removed when the returned handle drops — which must be after
/// the CLI has finished reading it.
fn stage_from_org(
    source_username: &str,
    target_username: &str,
    metadata: &[String],
    run: &RunGuard,
) -> AppResult<(TempDir, String)> {
    let source = source_username.trim();
    if source.is_empty() {
        return Err("Choose the org to take the components from.".into());
    }
    if source == target_username.trim() {
        return Err(AppError::new(
            ErrorKind::Failed,
            format!(
                "{source} is both the source and the target. Choose a different org to deploy to."
            ),
        ));
    }
    let specs = clean_specs(metadata)?;

    // Checked before the retrieve, which is the slow part: every component
    // comes back stamped with the source org's own `<apiVersion>`, and a
    // target on an older release refuses the lot with a bare
    // `Invalid api version`. Salesforce offers no way to deploy newer
    // metadata to an older org, so this is named plainly rather than
    // rewritten behind the user's back.
    let (source_version, source_name) = org_version_and_name(source);
    let target = target_username.trim();
    let (target_version, target_name) = org_version_and_name(target);
    if let (Some(from), Some(to)) = (source_version.as_deref(), target_version.as_deref()) {
        let number = |v: &str| v.trim().parse::<f64>().ok();
        if matches!((number(from), number(to)), (Some(a), Some(b)) if a > b) {
            return Err(AppError::new(
                ErrorKind::Failed,
                format!("{source_name} runs API {from}, but {target_name} only supports {to}. Salesforce refuses metadata newer than the target org, so these components cannot be deployed there. Pick a target on {from} or later, or retrieve them into a workspace and lower each component's apiVersion first."),
            ));
        }
    }

    let staging = TempDir::create("deploy-stage")?;
    let stage_error = |error: std::io::Error| format!("Could not stage the deploy: {error}");
    fs::create_dir_all(staging.path().join(STAGE_PACKAGE_DIR)).map_err(stage_error)?;
    // The lower of the two orgs' API versions.
    //
    // The retrieve is served at the source's version, but metadata at a
    // version the target does not know is refused outright: a source on a
    // newer release failed with "Invalid version specified", which is the
    // common case rather than the rare one.
    write_project_file(
        staging.path(),
        lower_api_version(source_version.as_deref(), target_version.as_deref()).as_deref(),
    )?;

    let xml = package_xml(&specs, source_api_version(staging.path()).as_deref());
    let manifest = staging.path().join("package.xml");
    fs::write(&manifest, xml).map_err(stage_error)?;

    let mut retrieve = sf_command()?;
    retrieve.args(["project", "retrieve", "start", "--manifest"]);
    retrieve.arg(&manifest);
    retrieve.args(["--target-org", source, "--wait", "20", "--json"]);
    retrieve.current_dir(staging.path());
    let output = run_with_limits(retrieve, None, &run.cancelled, STAGE_TIMEOUT)?;
    parse_sf_json(&output).map_err(|error| {
        AppError::new(
            error.kind,
            format!("Retrieving from {source_name} failed: {}", error.message),
        )
    })?;

    // An org can succeed at retrieving nothing — every selected component is
    // missing there. Deploying that would report success having sent nothing.
    let mut files = Vec::new();
    files_under(
        staging.path(),
        &staging.path().join(STAGE_PACKAGE_DIR),
        &mut files,
    );
    if files.is_empty() {
        return Err(AppError::new(
            ErrorKind::NotFound,
            format!(
                "{source} returned none of the selected components, so there is nothing to deploy."
            ),
        ));
    }

    Ok((staging, source_name))
}

/// Runs a CLI command in `workspace` and returns its `result.id`.
fn start_job(command: Command, run: &RunGuard) -> AppResult<String> {
    let output = run_with_limits(command, None, &run.cancelled, START_TIMEOUT)?;
    let json = parse_sf_json(&output)?;
    json.pointer("/result/id")
        .and_then(serde_json::Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "The Salesforce CLI did not return a job id.".into())
}

/// Starts a deploy or validation in the background and records it.
#[tauri::command]
pub async fn deploy_start(
    app: tauri::AppHandle,
    username: String,
    workspace_id: Option<String>,
    options: DeployOptions,
    run_id: Option<String>,
) -> AppResult<DeployRecord> {
    blocking(move || {
        let run = RunGuard::begin(run_id);
        let extra = option_args(&options)?;

        // An org → org deploy stages the components in a throwaway project and
        // runs there, so it neither reads nor needs the open workspace. The
        // handle is held until the CLI has finished reading the files.
        let staged = match &options.scope {
            DeployScope::OrgSource {
                source_username,
                metadata,
            } => Some(stage_from_org(source_username, &username, metadata, &run)?),
            _ => None,
        };

        let workspace = match &staged {
            Some((staging, _)) => staging.path().to_path_buf(),
            None => workspace_root(&app, workspace_id.as_deref())?,
        };
        let (scope, _manifest) = scope_args(&workspace, &options.scope)?;

        let mut command = sf_command()?;
        command.args([
            "project",
            "deploy",
            if options.check_only {
                "validate"
            } else {
                "start"
            },
            "--target-org",
            &username,
            "--async",
            "--json",
        ]);
        command.args(&scope);
        command.args(&extra);
        command.current_dir(&workspace);

        // Taken before the CLI reads the files: a file saved after this may
        // not be what was sent (see `changes::record_synced_files`).
        let created_at = now_millis();
        let job_id = start_job(command, &run)?;
        // A staged deploy sent the source org's files, not the workspace's, so
        // it records no workspace: `deploy_report` would otherwise mark local
        // files as synced that were never part of it.
        let (record_workspace_id, record_workspace_name) = match &staged {
            Some((_, source)) => (None, source.clone()),
            None => (
                workspace_id.clone(),
                workspace_name(&app, workspace_id.as_deref(), &workspace),
            ),
        };
        let record = DeployRecord {
            job_id,
            username,
            workspace_name: record_workspace_name,
            workspace_id: record_workspace_id,
            check_only: options.check_only,
            label: options.label,
            test_level: options.test_level,
            quick_deploy_of: None,
            promoted_by: None,
            status: "Pending".to_string(),
            done: false,
            created_at,
            completed_at: None,
            components_total: 0,
            components_deployed: 0,
            component_errors: 0,
            tests_total: 0,
            tests_completed: 0,
            test_errors: 0,
            error: None,
        };
        update_history_at(&history_path(&app)?, |records| {
            upsert(records, record.clone())
        })?;
        Ok(record)
    })
    .await
}

/// Promotes a successful validation without re-running it.
#[tauri::command]
pub async fn deploy_quick_start(
    app: tauri::AppHandle,
    username: String,
    validation_job_id: String,
    workspace_id: Option<String>,
    run_id: Option<String>,
) -> AppResult<DeployRecord> {
    blocking(move || {
        if !valid_job_id(&validation_job_id) {
            return Err(format!("'{validation_job_id}' is not a deploy job id.").into());
        }
        let run = RunGuard::begin(run_id);
        // A quick deploy promotes a job by id and sends no files, so it works
        // without a project — which an org → org validation is promoted with.
        let workspace = workspace_root(&app, workspace_id.as_deref()).ok();
        let path = history_path(&app)?;

        let mut command = sf_command()?;
        command.args([
            "project",
            "deploy",
            "quick",
            "--job-id",
            &validation_job_id,
            "--target-org",
            &username,
            "--async",
            "--json",
        ]);
        if let Some(root) = &workspace {
            command.current_dir(root);
        }
        let job_id = start_job(command, &run)?;

        update_history_at(&path, |records| {
            let validation = records
                .iter()
                .find(|record| record.job_id == validation_job_id)
                .cloned();
            let record = DeployRecord {
                job_id: job_id.clone(),
                username: username.clone(),
                workspace_name: validation
                    .as_ref()
                    .map(|v| v.workspace_name.clone())
                    .unwrap_or_else(|| {
                        workspace
                            .as_deref()
                            .map(|root| workspace_name(&app, workspace_id.as_deref(), root))
                            .unwrap_or_default()
                    }),
                // A quick deploy sends exactly what its validation did, so it
                // belongs to the same workspace — or to none, when the
                // validation was staged from another org.
                workspace_id: validation
                    .as_ref()
                    .map_or_else(|| workspace_id.clone(), |v| v.workspace_id.clone()),
                check_only: false,
                label: validation
                    .as_ref()
                    .map(|v| v.label.clone())
                    .unwrap_or_else(|| "Quick deploy".to_string()),
                test_level: validation.as_ref().and_then(|v| v.test_level.clone()),
                quick_deploy_of: Some(validation_job_id.clone()),
                promoted_by: None,
                status: "Pending".to_string(),
                done: false,
                created_at: now_millis(),
                completed_at: None,
                components_total: 0,
                components_deployed: 0,
                component_errors: 0,
                tests_total: 0,
                tests_completed: 0,
                test_errors: 0,
                error: None,
            };
            if let Some(validation) = records
                .iter_mut()
                .find(|record| record.job_id == validation_job_id)
            {
                validation.promoted_by = Some(job_id.clone());
            }
            upsert(records, record.clone());
            record
        })
        .map_err(AppError::from)
    })
    .await
}

/// Checks a job's progress once, and updates its history record.
#[tauri::command]
pub async fn deploy_report(
    app: tauri::AppHandle,
    username: String,
    job_id: String,
    workspace_id: Option<String>,
) -> AppResult<DeployReport> {
    blocking(move || {
        if !valid_job_id(&job_id) {
            return Err(format!("'{job_id}' is not a deploy job id.").into());
        }
        let workspace = workspace_root(&app, workspace_id.as_deref()).ok();

        let mut command = sf_command()?;
        command.args([
            "project",
            "deploy",
            "report",
            "--job-id",
            &job_id,
            "--target-org",
            &username,
            "--json",
        ]);
        if let Some(root) = &workspace {
            command.current_dir(root);
        }

        let run = RunGuard::begin(None);
        let output = run_with_limits(command, None, &run.cancelled, REPORT_TIMEOUT)?;

        // A failed deploy exits non-zero but still carries its full result,
        // which is exactly what the failure tables need — so the result is read
        // regardless of the exit status.
        let stdout = String::from_utf8_lossy(&output.stdout);
        let json: serde_json::Value = serde_json::from_str(stdout.trim())
            .map_err(|_| cli_failure(None, sf_plain_error(&output)))?;
        if !json["result"].is_object() {
            return Err(envelope_failure(&json, &output));
        }
        let report = report_from_result(&json["result"], &job_id, workspace.as_deref());

        let finished_now = update_history_at(&history_path(&app)?, |records| {
            finish_record(records, &job_id, &report)
        })?;

        // What the org now has matches these files: they leave "pending
        // changes". A validation commits nothing, so it does not count.
        if let (Some(read_at), Some(root)) = (finished_now, &workspace) {
            if report.status.starts_with("Succeeded") && !report.check_only {
                let _ =
                    changes::record_synced_files(&app, root, &report.deployed_files, Some(read_at));
            }
        }

        Ok(report)
    })
    .await
}

/// Asks the org to stop a job. Returns once the request is queued.
#[tauri::command]
pub async fn deploy_cancel(
    app: tauri::AppHandle,
    username: String,
    job_id: String,
    workspace_id: Option<String>,
) -> AppResult<()> {
    blocking(move || {
        if !valid_job_id(&job_id) {
            return Err(format!("'{job_id}' is not a deploy job id.").into());
        }
        let mut command = sf_command()?;
        command.args([
            "project",
            "deploy",
            "cancel",
            "--job-id",
            &job_id,
            "--target-org",
            &username,
            "--async",
            "--json",
        ]);
        if let Ok(root) = workspace_root(&app, workspace_id.as_deref()) {
            command.current_dir(root);
        }
        let run = RunGuard::begin(None);
        let output = run_with_limits(command, None, &run.cancelled, REPORT_TIMEOUT)?;
        parse_sf_json(&output)?;

        update_history_at(&history_path(&app)?, |records| {
            if let Some(record) = records.iter_mut().find(|record| record.job_id == job_id) {
                if !record.done {
                    record.status = "Canceling".to_string();
                }
            }
        })?;
        Ok(())
    })
    .await
}

/// Every recorded job, newest first.
#[tauri::command]
pub async fn deploy_history(app: tauri::AppHandle) -> AppResult<Vec<DeployRecord>> {
    blocking(move || {
        let path = history_path(&app)?;
        let _guard = lock(&HISTORY_LOCK);
        let mut records = read_history_file(&path);
        records.sort_by_key(|record| std::cmp::Reverse(record.created_at));
        Ok(records)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(scope: DeployScope) -> DeployOptions {
        DeployOptions {
            scope,
            check_only: false,
            test_level: None,
            tests: Vec::new(),
            ignore_warnings: false,
            label: String::new(),
        }
    }

    /* ── Options ────────────────────────────────────────────────── */

    #[test]
    fn test_levels_and_tests_become_flags() {
        let mut opts = options(DeployScope::Workspace);
        opts.test_level = Some("RunSpecifiedTests".to_string());
        opts.tests = vec![
            "AccountServiceTest".to_string(),
            " ns.OrderTest ".to_string(),
        ];
        opts.ignore_warnings = true;
        assert_eq!(
            option_args(&opts).unwrap(),
            vec![
                "--test-level",
                "RunSpecifiedTests",
                "--tests",
                "AccountServiceTest",
                "--tests",
                "ns.OrderTest",
                "--ignore-warnings"
            ]
        );
    }

    #[test]
    fn a_validation_cannot_skip_tests() {
        let mut opts = options(DeployScope::Workspace);
        opts.check_only = true;
        opts.test_level = Some("NoTestRun".to_string());
        assert!(option_args(&opts).unwrap_err().contains("has to run tests"));
    }

    #[test]
    fn specified_tests_need_names_and_only_with_that_level() {
        let mut opts = options(DeployScope::Workspace);
        opts.test_level = Some("RunSpecifiedTests".to_string());
        assert!(option_args(&opts).is_err());

        opts.test_level = Some("RunLocalTests".to_string());
        opts.tests = vec!["FooTest".to_string()];
        assert!(option_args(&opts).is_err());
    }

    #[test]
    fn unknown_levels_and_unsafe_test_names_are_rejected() {
        let mut opts = options(DeployScope::Workspace);
        opts.test_level = Some("RunEverything".to_string());
        assert!(option_args(&opts).is_err());

        opts.test_level = Some("RunSpecifiedTests".to_string());
        for bad in ["--wait", "Foo Test", "Foo;Bar", ".Hidden"] {
            opts.tests = vec![bad.to_string()];
            assert!(option_args(&opts).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn job_ids_are_salesforce_ids() {
        assert!(valid_job_id("0AfKj00000abcdEFGH"));
        assert!(valid_job_id("0AfKj00000abcdE"));
        assert!(!valid_job_id("0Af"));
        assert!(!valid_job_id("0AfKj00000abcd--GH"));
    }

    #[test]
    fn scopes_become_source_dirs_metadata_or_a_manifest() {
        let root = std::env::temp_dir().join(format!(
            "forgesf-deploy-scope-{}",
            crate::util::next_temp_suffix()
        ));
        fs::create_dir_all(root.join("force-app/main/default/classes")).unwrap();
        fs::write(root.join("force-app/main/default/classes/A.cls"), "").unwrap();

        let (args, manifest) = scope_args(&root, &DeployScope::Workspace).unwrap();
        assert_eq!(args, vec!["--source-dir", "force-app"]);
        assert!(manifest.is_none());

        let (args, _) = scope_args(
            &root,
            &DeployScope::Paths {
                paths: vec!["force-app/main/default/classes/A.cls".to_string()],
            },
        )
        .unwrap();
        assert_eq!(
            args,
            vec!["--source-dir", "force-app/main/default/classes/A.cls"]
        );

        let (args, _) = scope_args(
            &root,
            &DeployScope::Metadata {
                metadata: vec!["ApexClass:A".to_string()],
            },
        )
        .unwrap();
        assert_eq!(args, vec!["--metadata", "ApexClass:A"]);

        let many: Vec<String> = (0..200).map(|i| format!("ApexClass:Class{i:04}")).collect();
        let (args, manifest) =
            scope_args(&root, &DeployScope::Metadata { metadata: many }).unwrap();
        assert_eq!(args[0], "--manifest");
        assert!(manifest.is_some());

        // A selection that names nothing is refused rather than deploying the
        // whole workspace by accident.
        assert!(scope_args(
            &root,
            &DeployScope::Metadata {
                metadata: vec!["  ".to_string()],
            },
        )
        .is_err());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_org_source_deploy_sends_the_staging_project() {
        let root = std::env::temp_dir().join(format!(
            "forgesf-deploy-stage-{}",
            crate::util::next_temp_suffix()
        ));
        fs::create_dir_all(root.join("force-app")).unwrap();
        write_project_file(&root, Some("64.0")).unwrap();

        // By the time this runs the components have been retrieved into the
        // staging project, so the deploy sends that project — not specs, which
        // would be resolved against the org instead of the staged files.
        let (args, manifest) = scope_args(
            &root,
            &DeployScope::OrgSource {
                source_username: "source@example.com".to_string(),
                metadata: vec!["ApexClass:A".to_string()],
            },
        )
        .unwrap();
        assert_eq!(args, vec!["--source-dir", "force-app"]);
        assert!(manifest.is_none());

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn staging_asks_for_the_version_both_orgs_understand() {
        // A source on a newer release than the target failed the deploy
        // outright with "Invalid version specified: 68.0" — the common
        // case, since sandboxes are upgraded before other orgs.
        assert_eq!(
            lower_api_version(Some("68.0"), Some("67.0")).as_deref(),
            Some("67.0")
        );
        assert_eq!(
            lower_api_version(Some("64.0"), Some("67.0")).as_deref(),
            Some("64.0")
        );
        assert_eq!(
            lower_api_version(Some("67.0"), Some("67.0")).as_deref(),
            Some("67.0")
        );

        // An org that could not be asked defers to the one that could.
        assert_eq!(
            lower_api_version(Some("68.0"), None).as_deref(),
            Some("68.0")
        );
        assert_eq!(
            lower_api_version(None, Some("67.0")).as_deref(),
            Some("67.0")
        );
        assert_eq!(lower_api_version(None, None), None);

        // Nothing numeric to compare: the source stands rather than the
        // deploy being staged at a version nobody asked for.
        assert_eq!(
            lower_api_version(Some("68.0"), Some("v67")).as_deref(),
            Some("68.0")
        );
    }

    #[test]
    fn staging_refuses_an_empty_or_self_targeted_selection() {
        let run = RunGuard::begin(None);
        let specs = vec!["ApexClass:A".to_string()];

        let same = stage_from_org("me@example.com", " me@example.com ", &specs, &run).unwrap_err();
        assert!(
            same.message.contains("both the source and the target"),
            "{}",
            same.message
        );

        let blank = stage_from_org("  ", "target@example.com", &specs, &run).unwrap_err();
        assert!(
            blank.message.contains("Choose the org"),
            "{}",
            blank.message
        );

        // Refused before the CLI is ever started, so no org is contacted.
        let nothing = stage_from_org("source@example.com", "target@example.com", &[], &run)
            .unwrap_err()
            .message;
        assert!(nothing.contains("No metadata was selected"), "{nothing}");
    }

    /* ── Reports ────────────────────────────────────────────────── */

    fn failed_report() -> serde_json::Value {
        serde_json::json!({
            "id": "0AfKj00000abcdEFGH",
            "status": "Failed",
            "done": true,
            "success": false,
            "checkOnly": true,
            "numberComponentsTotal": 12,
            "numberComponentsDeployed": 10,
            "numberComponentErrors": 2,
            "numberTestsTotal": "40",
            "numberTestsCompleted": "39",
            "numberTestErrors": "1",
            "details": {
                "componentFailures": [
                    {
                        "componentType": "ApexClass",
                        "fullName": "AccountService",
                        "fileName": "classes/AccountService.cls",
                        "problem": "Variable does not exist: acct",
                        "problemType": "Error",
                        "lineNumber": "42",
                        "columnNumber": "9"
                    },
                    {
                        "componentType": "CustomField",
                        "fullName": "Account.Tier__c",
                        "problem": "Picklist value missing",
                        "problemType": "Error"
                    }
                ],
                "runTestResult": {
                    "failures": {
                        "name": "AccountServiceTest",
                        "methodName": "createsAccount",
                        "message": "System.AssertException: Assertion Failed",
                        "stackTrace": "Class.AccountServiceTest.createsAccount: line 12"
                    },
                    "codeCoverage": [
                        { "name": "AccountService", "numLocations": 50, "numLocationsNotCovered": 10 },
                        { "name": "OrderService", "numLocations": "30", "numLocationsNotCovered": "0" }
                    ]
                }
            }
        })
    }

    #[test]
    fn a_failed_validation_reports_components_tests_and_coverage() {
        let report = report_from_result(&failed_report(), "0AfKj00000abcdEFGH", None);

        assert_eq!(report.status, "Failed");
        assert!(report.done && report.check_only && !report.success);
        assert_eq!((report.components_total, report.component_errors), (12, 2));
        assert_eq!(
            (
                report.tests_total,
                report.tests_completed,
                report.test_errors
            ),
            (40, 39, 1)
        );

        assert_eq!(report.component_failures.len(), 2);
        assert_eq!(report.component_failures[0].line, Some(42));
        assert_eq!(report.component_failures[0].column, Some(9));
        assert_eq!(report.component_failures[1].file_name, None);

        // A single failure arrives as an object, not a list.
        assert_eq!(report.test_failures.len(), 1);
        assert_eq!(report.test_failures[0].method_name, "createsAccount");

        assert_eq!(report.coverage.len(), 2);
        assert_eq!(report.coverage_percent, Some(87.5));
        assert!(report.deployed_files.is_empty());
    }

    #[test]
    fn an_in_progress_report_is_not_terminal() {
        let report = report_from_result(
            &serde_json::json!({ "status": "InProgress", "done": false, "numberComponentsTotal": 5, "numberComponentsDeployed": 2 }),
            "0AfKj00000abcdEFGH",
            None,
        );
        assert!(!is_terminal(&report.status, report.done));
        assert_eq!(report.components_deployed, 2);
        assert_eq!(report.coverage_percent, None);
    }

    #[test]
    fn a_successful_deploy_lists_its_files_relative_to_the_workspace() {
        let root = if cfg!(windows) {
            PathBuf::from(r"C:\ws\acme")
        } else {
            PathBuf::from("/ws/acme")
        };
        let absolute = root.join("force-app/main/default/classes/A.cls");
        let report = report_from_result(
            &serde_json::json!({
                "status": "Succeeded", "done": true, "success": true, "checkOnly": false,
                "files": [
                    { "fullName": "A", "type": "ApexClass", "state": "Changed", "filePath": absolute.to_string_lossy() },
                    { "fullName": "B", "type": "ApexClass", "state": "Failed", "filePath": "force-app/main/default/classes/B.cls" }
                ]
            }),
            "0AfKj00000abcdEFGH",
            Some(&root),
        );
        assert_eq!(
            report.deployed_files,
            vec!["force-app/main/default/classes/A.cls"]
        );
    }

    #[test]
    fn history_keeps_running_jobs_and_folds_in_reports() {
        let path = std::env::temp_dir().join(format!(
            "forgesf-history-{}.json",
            crate::util::next_temp_suffix()
        ));
        let record = |job: &str, created: u64, done: bool| DeployRecord {
            job_id: job.to_string(),
            username: "me@acme.com".to_string(),
            workspace_id: None,
            workspace_name: "acme".to_string(),
            check_only: true,
            label: "Workspace".to_string(),
            test_level: Some("RunLocalTests".to_string()),
            quick_deploy_of: None,
            promoted_by: None,
            status: if done { "Succeeded" } else { "InProgress" }.to_string(),
            done,
            created_at: created,
            completed_at: None,
            components_total: 0,
            components_deployed: 0,
            component_errors: 0,
            tests_total: 0,
            tests_completed: 0,
            test_errors: 0,
            error: None,
        };

        update_history_at(&path, |records| {
            // A running job older than 200 finished ones must survive the cap.
            upsert(records, record("0AfKj00000RUNNING", 0, false));
            for i in 0..(HISTORY_LIMIT as u64 + 5) {
                upsert(records, record(&format!("0AfKj0000{i:06}"), 10 + i, true));
            }
        })
        .unwrap();

        let kept = read_history_file(&path);
        assert!(kept.iter().any(|r| r.job_id == "0AfKj00000RUNNING"));
        assert_eq!(kept.iter().filter(|r| r.done).count(), HISTORY_LIMIT);

        let report = report_from_result(&failed_report(), "0AfKj00000RUNNING", None);
        update_history_at(&path, |records| {
            let running = records
                .iter_mut()
                .find(|r| r.job_id == "0AfKj00000RUNNING")
                .unwrap();
            apply_report(running, &report);
        })
        .unwrap();
        let updated = read_history_file(&path)
            .into_iter()
            .find(|r| r.job_id == "0AfKj00000RUNNING")
            .unwrap();
        assert!(updated.done);
        assert_eq!(updated.status, "Failed");
        assert_eq!(
            updated.error.as_deref(),
            Some("Variable does not exist: acct")
        );
        assert!(updated.completed_at.is_some());

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn only_a_job_seen_finishing_counts_as_synced() {
        let record = |job: &str, created: u64, done: bool| DeployRecord {
            job_id: job.to_string(),
            username: "me@acme.com".to_string(),
            workspace_id: None,
            workspace_name: "acme".to_string(),
            check_only: false,
            label: "3 files".to_string(),
            test_level: None,
            quick_deploy_of: None,
            promoted_by: None,
            status: if done { "Succeeded" } else { "InProgress" }.to_string(),
            done,
            created_at: created,
            completed_at: done.then_some(created + 1),
            components_total: 0,
            components_deployed: 0,
            component_errors: 0,
            tests_total: 0,
            tests_completed: 0,
            test_errors: 0,
            error: None,
        };
        let succeeded = report_from_result(
            &serde_json::json!({ "status": "Succeeded", "done": true, "success": true }),
            "0AfKj00000abcdEFGH",
            None,
        );

        let mut quick = record("0AfKj00000QUICKDEP", 5_000, false);
        quick.quick_deploy_of = Some("0AfKj00000VALIDATE".to_string());
        let mut records = vec![
            record("0AfKj00000RUNNINGA", 1_000, false),
            record("0AfKj00000FINISHED", 2_000, true),
            record("0AfKj00000VALIDATE", 3_000, true),
            quick,
        ];

        // Running until now: files are counted from when the job read them.
        assert_eq!(
            finish_record(&mut records, "0AfKj00000RUNNINGA", &succeeded),
            Some(1_000)
        );
        assert!(records[0].done);
        // Seen again — or finished before — it no longer counts.
        assert_eq!(
            finish_record(&mut records, "0AfKj00000RUNNINGA", &succeeded),
            None
        );
        assert_eq!(
            finish_record(&mut records, "0AfKj00000FINISHED", &succeeded),
            None
        );
        // A quick deploy sent what its validation read.
        assert_eq!(
            finish_record(&mut records, "0AfKj00000QUICKDEP", &succeeded),
            Some(3_000)
        );
        // A job that is not in history is left alone.
        assert_eq!(
            finish_record(&mut records, "0AfKj00000UNKNOWNJ", &succeeded),
            None
        );

        let in_progress = report_from_result(
            &serde_json::json!({ "status": "InProgress", "done": false }),
            "0AfKj00000abcdEFGH",
            None,
        );
        let mut running = vec![record("0AfKj00000STILLRUN", 7_000, false)];
        assert_eq!(
            finish_record(&mut running, "0AfKj00000STILLRUN", &in_progress),
            None
        );
    }
}
