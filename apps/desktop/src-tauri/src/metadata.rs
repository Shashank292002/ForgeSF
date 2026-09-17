//! Metadata types and components, and retrieving them from an org into a workspace.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::sf::discover::{run_sf, sf_command};
use crate::sf::json::parse_sf_json;
use crate::sf::runner::{cancel_sf_command, run_with_limits, RunGuard};
use crate::util::{blocking, lock, next_temp_suffix, TempFile};
use crate::workspace::paths::{resolve_paths, to_relative_string};
use crate::workspace::registry::workspace_root;
use crate::workspace::sfdx_project::source_api_version;

#[derive(TS, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct MetadataType {
    pub xml_name: String,
    pub directory_name: String,
    pub suffix: Option<String>,
    pub in_folder: bool,
    pub meta_file: bool,
    pub child_xml_names: Vec<String>,
}

#[tauri::command]
pub async fn list_metadata_types(username: String) -> AppResult<Vec<MetadataType>> {
    blocking(move || {
        let output = run_sf([
            "org",
            "list",
            "metadata-types",
            "--target-org",
            &username,
            "--json",
        ])?;
        let json = parse_sf_json(&output)?;

        serde_json::from_value(json["result"]["metadataObjects"].clone())
            .map_err(|error| AppError::from(error.to_string()))
    })
    .await
}

/// The folder metadata type that organises an in-folder type, if it is one.
fn folder_type_for(metadata_type: &str) -> Option<&'static str> {
    match metadata_type {
        "Report" => Some("ReportFolder"),
        "Dashboard" => Some("DashboardFolder"),
        "Document" => Some("DocumentFolder"),
        "EmailTemplate" => Some("EmailFolder"),
        _ => None,
    }
}

/// Folders that exist without being listed as folder metadata.
fn implicit_folders_for(metadata_type: &str) -> &'static [&'static str] {
    match metadata_type {
        "Report" | "EmailTemplate" => &["unfiled$public"],
        _ => &[],
    }
}

/// `fullName`s from one `sf org list metadata` call.
fn list_members(
    metadata_type: &str,
    username: &str,
    folder: Option<&str>,
) -> AppResult<Vec<String>> {
    let mut args = vec![
        "org",
        "list",
        "metadata",
        "--metadata-type",
        metadata_type,
        "--target-org",
        username,
        "--json",
    ];
    if let Some(folder) = folder {
        args.push("--folder");
        args.push(folder);
    }
    let output = run_sf(args)?;
    let json = parse_sf_json(&output)?;

    // A type with no components is an empty list, not an error: the CLI
    // returns a null result (or a single object for one component).
    let members = match &json["result"] {
        serde_json::Value::Array(items) => items.iter().collect::<Vec<_>>(),
        object @ serde_json::Value::Object(_) => vec![object],
        _ => Vec::new(),
    };
    Ok(members
        .iter()
        .filter_map(|member| member["fullName"].as_str().map(str::to_string))
        .collect())
}

/// Lists the components of a metadata type.
///
/// Reports, dashboards, documents and email templates live in folders, and the
/// Metadata API only lists them one folder at a time — the picker used to show
/// "no components" for all of them. Their folders are listed first, then each
/// folder's contents; the folders themselves are returned too, as they are
/// retrievable members of the same type.
#[tauri::command]
pub async fn list_metadata_components(
    metadata_type: String,
    username: String,
) -> AppResult<Vec<String>> {
    blocking(move || {
        let Some(folder_type) = folder_type_for(&metadata_type) else {
            return list_members(&metadata_type, &username, None);
        };

        let mut folders = list_members(folder_type, &username, None)?;
        for implicit in implicit_folders_for(&metadata_type) {
            if !folders.iter().any(|folder| folder == implicit) {
                folders.push((*implicit).to_string());
            }
        }

        let mut members: BTreeSet<String> = BTreeSet::new();
        for folder in &folders {
            if !implicit_folders_for(&metadata_type).contains(&folder.as_str()) {
                members.insert(folder.clone());
            }
            members.extend(list_members(&metadata_type, &username, Some(folder))?);
        }
        Ok(members.into_iter().collect())
    })
    .await
}

/// Pretty-prints an `sf` JSON result so it reads well in the terminal.
fn summarize_sf_json(stdout: &[u8]) -> String {
    match serde_json::from_slice::<serde_json::Value>(stdout) {
        Ok(json) => {
            let result = &json["result"];
            let mut lines = Vec::new();

            if let Some(value) = json["status"].as_i64() {
                lines.push(format!("status: {value}"));
            }
            if let Some(value) = result["status"].as_str() {
                lines.push(format!("result.status: {value}"));
            }
            if let Some(value) = result["id"].as_str() {
                lines.push(format!("result.id: {value}"));
            }
            if let Some(value) = result["done"].as_bool() {
                lines.push(format!("result.done: {value}"));
            }
            if let Some(files) = result["files"].as_array() {
                lines.push(format!("files: {} component(s)", files.len()));
            }

            if lines.is_empty() {
                serde_json::to_string_pretty(&json)
                    .unwrap_or_else(|_| String::from_utf8_lossy(stdout).to_string())
            } else {
                lines.join("\n")
            }
        }
        Err(_) => String::from_utf8_lossy(stdout).to_string(),
    }
}

/// One metadata type / group included in a retrieve batch, and its outcome.
#[derive(TS, Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct RetrieveResultItem {
    pub kind: String,
    pub status: String, // "completed" | "failed" | "skipped"
    pub retrieved: u32,
    pub message: Option<String>,
    /// Problems the CLI reported without failing the retrieve, such as a
    /// component that does not exist in the org. They used to be dropped, so
    /// a type could read "completed, 0 items" with no explanation.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// Aggregated outcome of a retrieve run (with per-type detail).
#[derive(TS, Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct RetrieveResult {
    pub success: bool,
    pub summary: String,
    pub items: Vec<RetrieveResultItem>,
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
    /// True when the run was stopped early; unprocessed types are `skipped`.
    #[serde(default)]
    pub cancelled: bool,
}

/// Real-time payload pushed to the frontend while a retrieve is in flight.
#[derive(TS, Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct RetrieveProgressEvent {
    pub phase: String, // "item" | "complete"
    pub index: usize,
    pub total: usize,
    pub kind: Option<String>,   // metadata type being processed
    pub status: Option<String>, // running | completed | failed
    pub retrieved: u32,
    pub succeeded: u32,
    pub failed: u32,
    pub message: Option<String>,
}

/// Splits a CLI member string (`ApexClass`, `ApexClass:Foo`, `ApexClass:*`)
/// into `(metadataType, member)` so we can group a batch by type.
fn split_metadata_member(member: &str) -> (String, String) {
    match member.split_once(':') {
        Some((kind, _rest)) => (kind.to_string(), "*".to_string()),
        None => (member.to_string(), "*".to_string()),
    }
}

/// Counts retrieved files per metadata type.
///
/// `sf project retrieve start --json` reports each written file with its
/// `type`, which lets one batched invocation still report per-type totals.
fn files_by_type(stdout: &[u8]) -> std::collections::HashMap<String, u32> {
    let mut counts = std::collections::HashMap::new();
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(stdout) else {
        return counts;
    };
    let Some(files) = json["result"]["files"].as_array() else {
        return counts;
    };

    for file in files {
        // A file the CLI could not write is a warning (see `retrieve_warnings`),
        // not something retrieved.
        let failed = file
            .get("state")
            .and_then(serde_json::Value::as_str)
            .is_some_and(|state| state.eq_ignore_ascii_case("failed"));
        if failed {
            continue;
        }
        if let Some(kind) = file.get("type").and_then(serde_json::Value::as_str) {
            *counts.entry(kind.to_string()).or_insert(0) += 1;
        }
    }
    counts
}

/// The metadata type named in a Metadata API problem such as
/// "Entity of type 'ApexClass' named 'Foo' cannot be found".
fn type_named_in_problem(problem: &str) -> Option<&str> {
    let start = problem.find("type '")? + "type '".len();
    let length = problem[start..].find('\'')?;
    Some(&problem[start..start + length]).filter(|kind| !kind.is_empty())
}

/// Non-fatal problems from a retrieve, grouped by metadata type.
///
/// `sf project retrieve start --json` succeeds even when requested components
/// are missing; the detail is in `result.messages` (one object or an array)
/// and in `result.files` entries whose `state` is `Failed`. Problems that do
/// not name a type are grouped under the empty string.
pub(crate) fn retrieve_warnings(stdout: &[u8]) -> HashMap<String, Vec<String>> {
    let mut warnings: HashMap<String, Vec<String>> = HashMap::new();
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(stdout) else {
        return warnings;
    };
    let result = &json["result"];

    fn add(warnings: &mut HashMap<String, Vec<String>>, kind: &str, text: &str) {
        let text = text.trim();
        if text.is_empty() {
            return;
        }
        let bucket = warnings.entry(kind.to_string()).or_default();
        if !bucket.iter().any(|existing| existing == text) {
            bucket.push(text.to_string());
        }
    }

    let messages: Vec<&serde_json::Value> = match &result["messages"] {
        serde_json::Value::Array(items) => items.iter().collect(),
        object @ serde_json::Value::Object(_) => vec![object],
        _ => Vec::new(),
    };
    for message in messages {
        if let Some(problem) = message.get("problem").and_then(serde_json::Value::as_str) {
            add(
                &mut warnings,
                type_named_in_problem(problem).unwrap_or_default(),
                problem,
            );
        }
    }

    if let Some(files) = result["files"].as_array() {
        for file in files {
            let failed = file
                .get("state")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|state| state.eq_ignore_ascii_case("failed"));
            if !failed {
                continue;
            }
            let kind = file
                .get("type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let name = file
                .get("fullName")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            let problem = file
                .get("error")
                .or_else(|| file.get("problem"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("could not be retrieved");
            // A missing component is reported twice — once in `messages`,
            // once as a failed file — and was listed twice.
            let reported = warnings
                .get(kind)
                .is_some_and(|bucket| bucket.iter().any(|existing| existing == problem.trim()));
            if reported {
                continue;
            }
            if name.is_empty() {
                add(&mut warnings, kind, problem);
            } else {
                add(&mut warnings, kind, &format!("{name}: {problem}"));
            }
        }
    }

    warnings
}

/// Workspace-relative paths of the files a retrieve or deploy wrote, from its
/// `result.files`. Failed entries are skipped.
pub(crate) fn written_files(stdout: &[u8], root: &Path) -> Vec<String> {
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(stdout) else {
        return Vec::new();
    };
    let Some(files) = json["result"]["files"].as_array() else {
        return Vec::new();
    };
    files
        .iter()
        .filter(|file| {
            !file
                .get("state")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|state| state.eq_ignore_ascii_case("failed"))
        })
        .filter_map(|file| file.get("filePath").and_then(serde_json::Value::as_str))
        .map(|path| {
            let path = Path::new(path);
            if path.is_absolute() {
                to_relative_string(root, path)
            } else {
                path.to_string_lossy().replace('\\', "/")
            }
        })
        .collect()
}

/// What one `sf project retrieve start` call produced.
struct RetrieveBatchOutcome {
    counts: HashMap<String, u32>,
    warnings: HashMap<String, Vec<String>>,
    /// Workspace-relative files written, for change tracking.
    files: Vec<String>,
}

impl RetrieveBatchOutcome {
    /// Warnings for `kind`. Problems that name no type are only attributed
    /// when the call retrieved that type alone, where the source is certain.
    fn warnings_for(&self, kind: &str, only_kind_in_call: bool) -> Vec<String> {
        let mut found = self.warnings.get(kind).cloned().unwrap_or_default();
        if only_kind_in_call {
            if let Some(unattributed) = self.warnings.get("") {
                found.extend(unattributed.iter().cloned());
            }
        }
        found
    }
}

/// Set by `cancel_retrieve`, checked between batches.
///
/// A retrieval could previously not be stopped at all: selecting every
/// metadata type committed the user to hundreds of sequential CLI invocations
/// with no way out short of killing the app.
static RETRIEVE_CANCELLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// The run id of the retrieve batch in flight, so Cancel can stop it too.
static RETRIEVE_RUN: Mutex<Option<String>> = Mutex::new(None);

/// How long one retrieve batch may run.
pub(crate) const RETRIEVE_TIMEOUT: Duration = Duration::from_secs(25 * 60);

/// Requests cancellation of an in-flight retrieve.
///
/// Stops the batch in flight as well: cancelling used to only take effect
/// between batches, so a large batch still ran to completion first.
#[tauri::command]
pub fn cancel_retrieve() {
    RETRIEVE_CANCELLED.store(true, std::sync::atomic::Ordering::SeqCst);
    if let Some(run_id) = lock(&RETRIEVE_RUN).clone() {
        cancel_sf_command(run_id);
    }
}

/// Metadata types retrieved per `sf` invocation.
///
/// One invocation per type meant a 200-type selection paid 200 Node.js
/// start-ups, each waiting up to 20 minutes. Batching keeps per-type reporting
/// (via `files_by_type`) while cutting the process count by an order of
/// magnitude; a failed batch is retried type-by-type to isolate the culprit.
const RETRIEVE_BATCH_SIZE: usize = 10;

/// Above this many characters of `--metadata` arguments, a retrieve's selection
/// goes into a `package.xml` instead.
///
/// Windows runs `sf.cmd` through cmd.exe, which rejects command lines longer
/// than 8191 characters, so picking a few hundred components of one type
/// failed outright. The margin leaves room for the rest of the command line.
pub(crate) const MAX_INLINE_METADATA_CHARS: usize = 2000;

fn xml_escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

/// Builds a `package.xml` from CLI member specs (`ApexClass`, `ApexClass:Foo`).
/// A bare type means every member (`*`).
pub(crate) fn package_xml(specs: &[String], api_version: Option<&str>) -> String {
    let mut types: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for spec in specs {
        let spec = spec.trim();
        if spec.is_empty() {
            continue;
        }
        let (kind, member) = match spec.split_once(':') {
            Some((kind, member)) if !member.trim().is_empty() => (kind.trim(), member.trim()),
            Some((kind, _)) => (kind.trim(), "*"),
            None => (spec, "*"),
        };
        types.entry(kind).or_default().insert(member);
    }

    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <Package xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n",
    );
    for (kind, members) in &types {
        xml.push_str("    <types>\n");
        for member in members {
            xml.push_str(&format!(
                "        <members>{}</members>\n",
                xml_escape(member)
            ));
        }
        xml.push_str(&format!("        <name>{}</name>\n", xml_escape(kind)));
        xml.push_str("    </types>\n");
    }
    if let Some(version) = api_version {
        xml.push_str(&format!("    <version>{}</version>\n", xml_escape(version)));
    }
    xml.push_str("</Package>\n");
    xml
}

/// Retrieves any number of members in a single `sf` invocation and reports how
/// many files were written per metadata type.
fn retrieve_members(
    workspace: &Path,
    username: &str,
    members: &[String],
    cancelled: &AtomicBool,
) -> AppResult<RetrieveBatchOutcome> {
    let mut command = sf_command()?;
    command.args([
        "project",
        "retrieve",
        "start",
        "--target-org",
        username,
        "--json",
        "--wait",
        "20",
    ]);

    let inline_chars: usize = members
        .iter()
        .map(|member| member.len() + " --metadata \"\"".len())
        .sum();

    // Kept alive until the CLI has run; the file is deleted on drop.
    let _manifest = if inline_chars > MAX_INLINE_METADATA_CHARS {
        let xml = package_xml(members, source_api_version(workspace).as_deref());
        let file = TempFile::create("xml", &xml)?;
        command.arg("--manifest");
        command.arg(file.path());
        Some(file)
    } else {
        for member in members {
            command.arg("--metadata");
            command.arg(member);
        }
        None
    };
    command.current_dir(workspace);

    let output = run_with_limits(command, None, cancelled, RETRIEVE_TIMEOUT)?;
    parse_sf_json(&output)?;
    Ok(RetrieveBatchOutcome {
        counts: files_by_type(&output.stdout),
        warnings: retrieve_warnings(&output.stdout),
        files: written_files(&output.stdout, workspace),
    })
}

/// Retrieves the requested metadata from an org, streaming live progress
/// events so the UI can render a meaningful progress experience instead of a
/// blocking spinner. Returns a structured result with per-type outcomes for
/// the results summary and failed-retry flow.
#[tauri::command]
pub async fn retrieve_metadata_progress(
    app: tauri::AppHandle,
    username: String,
    metadata: Vec<String>,
    workspace_id: Option<String>,
) -> AppResult<RetrieveResult> {
    // The loop below runs one `sf` process per metadata type, each waiting up
    // to 20 minutes. Doing that inline in an async command starved Tauri's
    // shared async runtime for the whole retrieval.
    blocking(move || retrieve_metadata_blocking(app, username, metadata, workspace_id)).await
}

fn retrieve_metadata_blocking(
    app: tauri::AppHandle,
    username: String,
    metadata: Vec<String>,
    workspace_id: Option<String>,
) -> AppResult<RetrieveResult> {
    let workspace = workspace_root(&app, workspace_id.as_deref())?;

    // Group members by metadata type so each type becomes an isolated,
    // observable unit of progress.
    let mut order: Vec<String> = Vec::new();
    let mut groups: Vec<Vec<String>> = Vec::new();
    let mut index_by_kind: std::collections::HashMap<String, usize> =
        std::collections::HashMap::new();
    for member in &metadata {
        let trimmed = member.trim();
        if trimmed.is_empty() {
            continue;
        }
        let (kind, _) = split_metadata_member(trimmed);
        let idx = match index_by_kind.get(&kind) {
            Some(&existing) => existing,
            None => {
                let new_index = order.len();
                order.push(kind.clone());
                groups.push(Vec::new());
                index_by_kind.insert(kind, new_index);
                new_index
            }
        };
        groups[idx].push(trimmed.to_string());
    }

    let total = order.len();
    let mut succeeded = 0u32;
    let mut failed = 0u32;
    let mut items: Vec<RetrieveResultItem> = Vec::new();

    let emit = |payload: &RetrieveProgressEvent| -> Result<(), String> {
        app.emit("retrieve_progress", payload)
            .map_err(|error| error.to_string())
    };

    // A fresh run clears any cancellation left over from the previous one.
    RETRIEVE_CANCELLED.store(false, std::sync::atomic::Ordering::SeqCst);
    let cancelled = || RETRIEVE_CANCELLED.load(std::sync::atomic::Ordering::SeqCst);

    // One cancellable run for the whole retrieve: Cancel kills the batch in
    // flight through it, and the flag above stops the next one starting.
    let run = RunGuard::begin(Some(format!("retrieve-{}", next_temp_suffix())));
    *lock(&RETRIEVE_RUN) = Some(run.id.clone());
    struct ClearRun;
    impl Drop for ClearRun {
        fn drop(&mut self) {
            *lock(&RETRIEVE_RUN) = None;
        }
    }
    let _clear_run = ClearRun;

    // Files written by every batch, so they can leave "pending changes".
    let mut synced_files: Vec<String> = Vec::new();

    let record = |kind: &str,
                  outcome: Result<(u32, Vec<String>), String>,
                  succeeded: &mut u32,
                  failed: &mut u32,
                  items: &mut Vec<RetrieveResultItem>|
     -> Result<(), String> {
        match outcome {
            Ok((retrieved, warnings)) => {
                *succeeded += 1;
                items.push(RetrieveResultItem {
                    kind: kind.to_string(),
                    status: "completed".to_string(),
                    message: Some(format!("{retrieved} item(s) retrieved")),
                    retrieved,
                    warnings,
                });
                emit(&RetrieveProgressEvent {
                    phase: "item".to_string(),
                    kind: Some(kind.to_string()),
                    status: Some("completed".to_string()),
                    index: 0,
                    total: 0,
                    retrieved,
                    succeeded: *succeeded,
                    failed: *failed,
                    message: Some(format!("Retrieved {retrieved} item(s)")),
                })
            }
            Err(error) => {
                *failed += 1;
                items.push(RetrieveResultItem {
                    kind: kind.to_string(),
                    status: "failed".to_string(),
                    retrieved: 0,
                    message: Some(error.clone()),
                    warnings: Vec::new(),
                });
                emit(&RetrieveProgressEvent {
                    phase: "item".to_string(),
                    kind: Some(kind.to_string()),
                    status: Some("failed".to_string()),
                    index: 0,
                    total: 0,
                    retrieved: 0,
                    succeeded: *succeeded,
                    failed: *failed,
                    message: Some(error),
                })
            }
        }
    };

    let batches: Vec<Vec<usize>> = (0..order.len())
        .collect::<Vec<_>>()
        .chunks(RETRIEVE_BATCH_SIZE)
        .map(<[usize]>::to_vec)
        .collect();

    let mut processed = 0usize;

    'batches: for batch in batches {
        if cancelled() {
            break;
        }

        // Announce every type in the batch before the single CLI call runs.
        for &position in &batch {
            processed += 1;
            emit(&RetrieveProgressEvent {
                phase: "item".to_string(),
                index: processed,
                total,
                kind: Some(order[position].clone()),
                status: Some("running".to_string()),
                retrieved: 0,
                succeeded,
                failed,
                message: Some(format!("Retrieving {}…", order[position])),
            })?;
        }

        let members: Vec<String> = batch
            .iter()
            .flat_map(|&position| groups[position].clone())
            .collect();

        match retrieve_members(&workspace, &username, &members, &run.cancelled) {
            Ok(outcome) => {
                synced_files.extend(outcome.files.iter().cloned());
                let single = batch.len() == 1;
                for &position in &batch {
                    let kind = &order[position];
                    let retrieved = outcome.counts.get(kind).copied().unwrap_or(0);
                    let warnings = outcome.warnings_for(kind, single);
                    record(
                        kind,
                        Ok((retrieved, warnings)),
                        &mut succeeded,
                        &mut failed,
                        &mut items,
                    )?;
                }
            }
            // An expired session, or a CLI that has gone missing, fails every
            // batch the same way: report it once rather than once per type.
            Err(error) if matches!(error.kind, ErrorKind::AuthRequired | ErrorKind::CliMissing) => {
                return Err(error);
            }
            Err(_) => {
                // One bad type fails the whole batch, so isolate it: re-run the
                // batch's types individually to find out which actually failed
                // instead of reporting all ten as broken.
                for &position in &batch {
                    if cancelled() {
                        break 'batches;
                    }
                    let kind = &order[position];
                    let outcome =
                        retrieve_members(&workspace, &username, &groups[position], &run.cancelled)
                            .map(|outcome| {
                                synced_files.extend(outcome.files.iter().cloned());
                                (
                                    outcome.counts.get(kind).copied().unwrap_or(0),
                                    outcome.warnings_for(kind, true),
                                )
                            })
                            .map_err(|error| format!("{kind}: {error}"));
                    record(kind, outcome, &mut succeeded, &mut failed, &mut items)?;
                }
            }
        }
    }

    let was_cancelled = cancelled();
    let success = failed == 0 && !was_cancelled;
    let skipped = total.saturating_sub(items.len());

    // What was retrieved now matches the org. Best-effort: bookkeeping must
    // never fail a retrieve that worked.
    if succeeded > 0 {
        let _ =
            crate::workspace::changes::record_synced_files(&app, &workspace, &synced_files, None);
    }

    // Types the run never reached are reported, not silently dropped from the
    // results — the summary used to count them while the list omitted them.
    for kind in &order {
        if !items.iter().any(|item| &item.kind == kind) {
            items.push(RetrieveResultItem {
                kind: kind.clone(),
                status: "skipped".to_string(),
                retrieved: 0,
                message: Some("Not retrieved — the run was cancelled first.".to_string()),
                warnings: Vec::new(),
            });
        }
    }
    let summary = if was_cancelled {
        format!("Cancelled — {succeeded} type(s) retrieved, {skipped} skipped.")
    } else if success {
        format!("Retrieved metadata from {succeeded} type(s) successfully.")
    } else {
        format!("Finished with {failed} failed type(s).")
    };

    emit(&RetrieveProgressEvent {
        phase: "complete".to_string(),
        index: total,
        total,
        kind: None,
        status: Some(if was_cancelled {
            "cancelled".to_string()
        } else if success {
            "complete".to_string()
        } else {
            "complete-with-errors".to_string()
        }),
        retrieved: items.iter().map(|item| item.retrieved).sum(),
        succeeded,
        failed,
        message: Some(summary.clone()),
    })?;

    Ok(RetrieveResult {
        success,
        summary,
        items,
        total: total as u32,
        succeeded,
        failed,
        cancelled: was_cancelled,
    })
}

/// Retrieves specific files or folders from the org into the workspace.
#[tauri::command]
pub async fn retrieve_paths(
    app: tauri::AppHandle,
    username: String,
    paths: Vec<String>,
    workspace_id: Option<String>,
) -> AppResult<String> {
    blocking(move || {
        let workspace = workspace_root(&app, workspace_id.as_deref())?;
        let targets = resolve_paths(&workspace, &paths)?;

        let mut command = sf_command()?;
        command.args([
            "project",
            "retrieve",
            "start",
            "--target-org",
            &username,
            "--wait",
            "20",
        ]);
        for target in &targets {
            command.arg("--source-dir");
            command.arg(target);
        }
        command.arg("--json");
        command.current_dir(&workspace);

        // Bounded, rather than a plain `output()` that could wait forever.
        let run = RunGuard::begin(None);
        let output = run_with_limits(command, None, &run.cancelled, RETRIEVE_TIMEOUT)?;
        parse_sf_json(&output)?;

        let _ = crate::workspace::changes::record_synced_files(
            &app,
            &workspace,
            &written_files(&output.stdout, &workspace),
            None,
        );
        Ok(summarize_sf_json(&output.stdout))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn a_manifest_groups_members_by_type() {
        let specs = vec![
            "ApexClass:Foo".to_string(),
            "ApexClass:Bar".to_string(),
            "CustomObject".to_string(),
            "Layout:Account-Account Layout".to_string(),
        ];
        let xml = package_xml(&specs, Some("65.0"));

        assert!(xml.contains(
            "<types>\n        <members>Bar</members>\n        <members>Foo</members>\n        <name>ApexClass</name>"
        ));
        assert!(xml.contains("<members>*</members>\n        <name>CustomObject</name>"));
        assert!(xml.contains("<members>Account-Account Layout</members>"));
        assert!(xml.contains("<version>65.0</version>"));
    }

    #[test]
    fn a_manifest_escapes_xml_and_omits_an_unknown_version() {
        let xml = package_xml(&["EmailTemplate:Folder/A&B <Draft>".to_string()], None);
        assert!(xml.contains("<members>Folder/A&amp;B &lt;Draft&gt;</members>"));
        assert!(!xml.contains("<version>"));
    }

    #[test]
    fn missing_components_become_warnings_on_their_type() {
        let stdout = br#"{"status":0,"result":{"status":"Succeeded","files":[
            {"fullName":"Foo","type":"ApexClass","state":"Changed","filePath":"a"},
            {"fullName":"Foo","type":"ApexClass","state":"Changed","filePath":"a-meta"}
          ],"messages":[
            {"fileName":"unpackaged/package.xml","problem":"Entity of type 'ApexClass' named 'Nope' cannot be found"},
            {"fileName":"unpackaged/package.xml","problem":"Entity of type 'CustomObject' named 'Gone__c' cannot be found"}
          ]}}"#;

        let warnings = retrieve_warnings(stdout);
        assert_eq!(
            warnings["ApexClass"],
            vec!["Entity of type 'ApexClass' named 'Nope' cannot be found"]
        );
        assert_eq!(warnings["CustomObject"].len(), 1);
        assert_eq!(files_by_type(stdout)["ApexClass"], 2);
    }

    #[test]
    fn a_single_message_object_and_failed_files_are_reported() {
        let stdout = br#"{"status":0,"result":{"files":[
            {"fullName":"Bar","type":"ApexClass","state":"Failed","error":"insufficient access"}
          ],"messages":{"problem":"Something unrelated went wrong"}}}"#;

        let warnings = retrieve_warnings(stdout);
        assert_eq!(warnings["ApexClass"], vec!["Bar: insufficient access"]);
        assert_eq!(warnings[""], vec!["Something unrelated went wrong"]);
        // A file that failed was not retrieved.
        assert!(!files_by_type(stdout).contains_key("ApexClass"));
    }

    #[test]
    fn a_missing_component_is_reported_once() {
        // What `sf project retrieve start --json` returns for a class the org
        // does not have: the same problem as a message and as a failed file.
        let stdout = br#"{"status":0,"result":{"files":[
            {"fullName":"Probe","type":"ApexClass","state":"Failed","problemType":"Warning",
             "error":"Entity of type 'ApexClass' named 'Probe' cannot be found"}
          ],"messages":[{"fileName":"unpackaged/package.xml",
             "problem":"Entity of type 'ApexClass' named 'Probe' cannot be found"}]}}"#;

        assert_eq!(
            retrieve_warnings(stdout)["ApexClass"],
            vec!["Entity of type 'ApexClass' named 'Probe' cannot be found"]
        );
    }

    #[test]
    fn unattributed_warnings_only_land_on_a_type_retrieved_alone() {
        let outcome = RetrieveBatchOutcome {
            counts: HashMap::new(),
            warnings: HashMap::from([("".to_string(), vec!["general".to_string()])]),
            files: Vec::new(),
        };
        assert_eq!(outcome.warnings_for("ApexClass", true), vec!["general"]);
        assert!(outcome.warnings_for("ApexClass", false).is_empty());
    }

    #[test]
    fn the_type_is_read_from_a_problem_message() {
        assert_eq!(
            type_named_in_problem("Entity of type 'Report' named 'X/Y' cannot be found"),
            Some("Report")
        );
        assert_eq!(type_named_in_problem("no type here"), None);
    }

    #[test]
    fn in_folder_types_map_to_their_folder_types() {
        assert_eq!(folder_type_for("Report"), Some("ReportFolder"));
        assert_eq!(folder_type_for("EmailTemplate"), Some("EmailFolder"));
        assert_eq!(folder_type_for("ApexClass"), None);
        assert!(implicit_folders_for("Report").contains(&"unfiled$public"));
        assert!(implicit_folders_for("Dashboard").is_empty());
    }
}
