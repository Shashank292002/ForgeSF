use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::Manager;
use ts_rs::TS;

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Salesforce CLI discovery
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/// Resolved once per process. Probing costs a full `sf --version` spawn — a
/// Node.js start-up, typically 0.5–2s — so doing it per command made every
/// call pay that price twice.
static SF_EXECUTABLE: OnceLock<String> = OnceLock::new();

/// Where the `sf` CLI is looked for, in order.
///
/// A GUI app launched from Finder or a desktop entry does not inherit the
/// login shell's `PATH`, so a bare `sf` lookup finds nothing on macOS or Linux
/// even when the CLI is installed and works fine in a terminal. Discovery was
/// previously Windows-only paths plus that bare lookup, which meant the app
/// simply could not find the CLI on the platforms the README advertises.
fn sf_candidates() -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();

    // An explicit override always wins.
    if let Ok(configured) = std::env::var("FORGESF_SF_PATH") {
        if !configured.trim().is_empty() {
            candidates.push(configured);
        }
    }

    #[cfg(windows)]
    {
        candidates.push(r"C:\Program Files\sf\bin\sf.cmd".to_string());
        candidates.push(r"C:\Program Files\sfdx\bin\sf.cmd".to_string());
        if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
            candidates.push(format!(r"{appdata}\sf\bin\sf.cmd"));
        }
        candidates.push("sf.cmd".to_string());
    }

    #[cfg(not(windows))]
    {
        // The common install locations: Homebrew (Apple silicon and Intel),
        // the Salesforce installer, npm global prefixes, and asdf/volta shims.
        candidates.push("/opt/homebrew/bin/sf".to_string());
        candidates.push("/usr/local/bin/sf".to_string());
        candidates.push("/usr/bin/sf".to_string());
        candidates.push("/snap/bin/sf".to_string());
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(format!("{home}/.local/bin/sf"));
            candidates.push(format!("{home}/.volta/bin/sf"));
            candidates.push(format!("{home}/.asdf/shims/sf"));
            candidates.push(format!("{home}/.npm-global/bin/sf"));
        }
    }

    // PATH last: it works when the app was started from a shell, and costs
    // nothing when it was not.
    candidates.push("sf".to_string());
    candidates
}

fn find_sf_executable() -> Result<String, String> {
    if let Some(cached) = SF_EXECUTABLE.get() {
        return Ok(cached.clone());
    }

    for candidate in sf_candidates() {
        let mut probe = Command::new(&candidate);
        hide_console(&mut probe);
        if let Ok(output) = probe.arg("--version").output() {
            if output.status.success() || !output.stdout.is_empty() {
                // Only successful lookups are cached: a failure may simply mean
                // the CLI is not installed *yet*, and should be re-probed.
                return Ok(SF_EXECUTABLE.get_or_init(|| candidate).clone());
            }
        }
    }

    Err("Could not find the 'sf' Salesforce CLI.\n\
         Install it from https://developer.salesforce.com/tools/salesforcecli, \
         then either restart ForgeSF from a terminal where `sf --version` works, \
         or set FORGESF_SF_PATH to its full path."
        .to_string())
}

/// Suppresses the console window Windows pops for every `sf.cmd` spawn.
#[cfg(windows)]
pub(crate) fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn hide_console(_command: &mut Command) {}

/// Working directory for `sf` calls that are not about a particular project.
///
/// Commands such as `org list metadata` or `data query` ran with no working
/// directory set, so the CLI wrote its project-local cache (`.sf/orgs/…`) into
/// wherever ForgeSF happened to be launched from — a stray `.sf/` folder in the
/// repository was the visible symptom. Project commands still override this
/// with the workspace.
static NEUTRAL_CWD: OnceLock<PathBuf> = OnceLock::new();

/// One-time setup that needs the app handle. Called from `run`'s setup hook.
pub fn init(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        if fs::create_dir_all(&dir).is_ok() {
            let _ = NEUTRAL_CWD.set(dir);
        }
    }
}

/// The installed Salesforce CLI, as far as ForgeSF can tell.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct CliInfo {
    pub found: bool,
    /// e.g. `2.150.6`.
    pub version: Option<String>,
    /// Whether this version supports what ForgeSF relies on.
    pub supported: bool,
    /// What to do about it, when something is wrong.
    pub message: Option<String>,
}

/// Oldest major version with the `sf project deploy …` commands (including
/// `--async`, `report` and `cancel`) that deploy jobs use.
const MIN_SF_MAJOR: u32 = 2;

/// The version from `sf --version` output such as
/// `@salesforce/cli/2.150.6 win32-x64 node-v24.19.0`.
fn parse_cli_version(output: &str) -> Option<(String, u32)> {
    let token = output
        .split_whitespace()
        .find(|token| token.starts_with("@salesforce/cli/"))?;
    let version = token.trim_start_matches("@salesforce/cli/").to_string();
    let major = version.split('.').next()?.parse().ok()?;
    Some((version, major))
}

fn cli_info_from(output: Result<String, String>) -> CliInfo {
    match output {
        Err(message) => CliInfo {
            found: false,
            version: None,
            supported: false,
            message: Some(message),
        },
        Ok(text) => match parse_cli_version(&text) {
            Some((version, major)) if major >= MIN_SF_MAJOR => CliInfo {
                found: true,
                version: Some(version),
                supported: true,
                message: None,
            },
            Some((version, _)) => CliInfo {
                found: true,
                message: Some(format!(
                    "Salesforce CLI {version} is too old for ForgeSF. Update it with \
                     `sf update` (or reinstall) to version {MIN_SF_MAJOR} or later."
                )),
                version: Some(version),
                supported: false,
            },
            None => CliInfo {
                found: true,
                version: None,
                supported: false,
                message: Some(
                    "The installed command is not the Salesforce CLI (`sf`) ForgeSF expects."
                        .to_string(),
                ),
            },
        },
    }
}

/// Reports whether a usable Salesforce CLI is installed.
#[tauri::command]
pub async fn cli_info() -> Result<CliInfo, String> {
    blocking(|| {
        let output = run_sf(["--version"]).and_then(|output| output_to_string(&output));
        Ok(cli_info_from(output))
    })
    .await
}

/// Builds a `Command` for the resolved `sf` executable.
pub(crate) fn sf_command() -> Result<Command, String> {
    let mut command = Command::new(find_sf_executable()?);
    hide_console(&mut command);
    if let Some(dir) = NEUTRAL_CWD.get() {
        command.current_dir(dir);
    }
    Ok(command)
}

/// Locks a mutex, recovering the data if a panicking thread poisoned it: every
/// value guarded here stays valid even if an update was interrupted.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A uniquifier for temp-file names within this process.
pub(crate) fn next_temp_suffix() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        std::process::id(),
        now_millis(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// Replaces a file's contents without ever leaving it half-written.
///
/// `fs::write` truncates first, so a crash mid-write left an empty or partial
/// file, and a concurrent reader could see one too — which is how the
/// workspace list could be read back as garbage. The new content is written
/// beside the target and renamed over it; within one directory a rename
/// replaces the file in a single step.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("'{}' has no parent directory.", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let temp = parent.join(format!(".{file_name}.{}.tmp", next_temp_suffix()));

    let attempt = || -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        // Keep the original's permissions, e.g. an executable script's mode.
        if let Ok(metadata) = fs::metadata(path) {
            let _ = fs::set_permissions(&temp, metadata.permissions());
        }
        fs::rename(&temp, path)
    };

    match attempt() {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temp);
            // On Windows another program holding the file open without delete
            // sharing blocks the rename. An in-place write still beats failing
            // the save outright.
            if error.kind() == std::io::ErrorKind::PermissionDenied && path.is_file() {
                return fs::write(path, bytes).map_err(|error| error.to_string());
            }
            Err(error.to_string())
        }
    }
}

/// A file in the OS temp directory, deleted when dropped.
pub(crate) struct TempFile(PathBuf);

impl TempFile {
    pub(crate) fn create(extension: &str, contents: &str) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("forgesf-{}.{extension}", next_temp_suffix()));
        fs::write(&path, contents)
            .map_err(|error| format!("Could not stage a temporary file: {error}"))?;
        Ok(Self(path))
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn run_sf<I, S>(args: I) -> Result<std::process::Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    sf_command()?
        .args(args)
        .output()
        .map_err(|error| error.to_string())
}

/* ─────────────────────────────────────────────────────────────────
Off-thread execution
───────────────────────────────────────────────────────────────── */

/// Runs a blocking closure on the blocking pool.
///
/// Every `sf` invocation is a Node.js process that takes seconds — a deploy
/// waits minutes. Tauri executes non-`async` commands on the **main thread**,
/// so each of those calls froze the whole window (most visibly during the
/// browser OAuth round-trip in `connect_salesforce`); a plain `async` command
/// would instead starve the shared async runtime. Both problems go away by
/// moving the work to a pool where blocking is expected.
pub(crate) async fn blocking<T, F>(task: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Background task failed: {error}"))?
}

/* ─────────────────────────────────────────────────────────────────
`sf` result parsing
───────────────────────────────────────────────────────────────── */

/// Last resort when the CLI produced nothing machine-readable.
pub(crate) fn sf_plain_error(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }
    format!("The Salesforce CLI exited with {}.", output.status)
}

/// Builds a readable message from the CLI's structured error envelope.
///
/// `sf --json` reports failures as `{ status, name, message, actions }`, and
/// deploys/retrieves add per-component detail. All of that used to be dumped
/// on the user as a raw `STDOUT:/STDERR:` blob.
pub(crate) fn sf_error_message(json: &serde_json::Value, output: &std::process::Output) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(message) = json.get("message").and_then(serde_json::Value::as_str) {
        parts.push(message.trim().to_string());
    }

    // Component-level failures carry the detail a developer actually needs.
    if let Some(failures) = json
        .pointer("/result/details/componentFailures")
        .and_then(serde_json::Value::as_array)
    {
        for failure in failures {
            let problem = failure
                .get("problem")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            if problem.is_empty() {
                continue;
            }
            match failure.get("fullName").and_then(serde_json::Value::as_str) {
                Some(name) if !name.is_empty() => parts.push(format!("{name}: {problem}")),
                _ => parts.push(problem.to_string()),
            }
        }
    }

    // The CLI's own suggested next steps ("Run `sf org login web`…").
    if let Some(actions) = json.get("actions").and_then(serde_json::Value::as_array) {
        for action in actions.iter().filter_map(serde_json::Value::as_str) {
            parts.push(format!("→ {action}"));
        }
    }

    if parts.is_empty() {
        sf_plain_error(output)
    } else {
        parts.join("\n")
    }
}

/// Parses a `--json` response, returning the envelope on success.
///
/// Exit status alone is not a reliable signal: some commands exit 0 while
/// `result.status` is `"Failed"`, and the previous helper treated *unparseable*
/// output as success — turning a broken CLI response into a silent false pass.
pub(crate) fn parse_sf_json(output: &std::process::Output) -> Result<serde_json::Value, String> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // `sf` prints its JSON envelope on stdout even for failures; fall back to
    // stderr for cases where it died before producing one.
    let json: serde_json::Value = serde_json::from_str(stdout.trim())
        .or_else(|_| serde_json::from_str(stderr.trim()))
        .map_err(|_| sf_plain_error(output))?;

    let envelope_failed = json
        .get("status")
        .and_then(serde_json::Value::as_i64)
        .is_some_and(|status| status != 0);

    let result_failed = json
        .pointer("/result/status")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|status| status.eq_ignore_ascii_case("failed"));

    if envelope_failed || result_failed || !output.status.success() {
        return Err(sf_error_message(&json, output));
    }

    Ok(json)
}

/// For commands invoked without `--json`, where only the exit code is available.
fn output_to_string(output: &std::process::Output) -> Result<String, String> {
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(sf_plain_error(output))
    }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Shared models
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

#[derive(TS, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct Organization {
    pub id: String,
    pub alias: String,
    pub username: String,
    pub instance_url: String,
    pub org_type: String,
    pub is_default: bool,
    pub status: String,
}

#[derive(TS, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct OrgDetails {
    pub instance_url: String,
    pub api_version: String,
}

// Deliberately no `access_token` here. `sf org display --json` returns one, but
// handing a live session token to the webview means any XSS-shaped bug — or a
// stray console.log — leaks production org access. Anything needing
// authenticated calls should run in Rust, where the token never leaves.

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

#[derive(TS, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub node_type: String,
    /// `None` on a folder means "not read yet", not "empty" — see `has_children`.
    pub children: Option<Vec<FileNode>>,
    /// Whether a folder holds anything, known without reading it. Lets the tree
    /// draw a disclosure arrow for folders whose contents are still unloaded.
    pub has_children: bool,
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Workspace root management
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const WORKSPACE_CONFIG_FILE: &str = "workspace-config.json";
const WORKSPACE_CONFIG_KEY: &str = "workspacePath";

/// Directories that are always hidden from the workspace explorer.
const IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    ".github",
    ".idea",
    ".vscode",
    ".sf",
    ".sfdx",
    ".sfdx-journal.json",
    "node_modules",
    ".turbo",
    ".cache",
];

fn workspace_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    Ok(data_dir.join(WORKSPACE_CONFIG_FILE))
}

/// One registered project.
///
/// `id` is the canonicalised path: it makes "is this folder already registered?"
/// a plain lookup and avoids pulling in a uuid crate. Moving a folder therefore
/// registers it as a new project; renaming the *display* name does not.
#[derive(TS, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct WorkspaceEntry {
    pub id: String,
    pub name: String,
    pub path: String,
    /// The org this folder belongs to.
    ///
    /// Each org gets its own workspace so one org's metadata is never written
    /// into another's tree. `None` marks the fallback workspace used when no
    /// org is connected.
    #[serde(default)]
    pub org_id: Option<String>,
    /// Org to restore when this project is opened. Retained from the previous
    /// schema; for org-owned folders it mirrors `org_id`.
    #[serde(default)]
    pub last_org_id: Option<String>,
    /// The org that actually wrote this tree — drives the mixing warning.
    #[serde(default)]
    pub last_retrieved_org_id: Option<String>,
    /// Milliseconds since the Unix epoch. Kept numeric so no date-formatting
    /// crate is needed on the Rust side; the UI formats it.
    #[serde(default)]
    #[ts(type = "number")]
    pub created_at: u64,
}

/// The persisted registry.
#[derive(TS, Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct WorkspaceRegistry {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub active_id: Option<String>,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceEntry>,
    /// Set on a response when the saved list could not be read and a new one
    /// was started. Never stored: `write_registry_file` strips it.
    #[serde(default)]
    #[ts(optional = nullable)]
    pub notice: Option<String>,
}

const WORKSPACE_SCHEMA_VERSION: u32 = 3;

/// Serialises every read-modify-write of the registry file.
///
/// Commands run in parallel on the blocking pool, and at startup two of them
/// update the registry at once. With no lock, one could read the file while
/// another was rewriting it, or overwrite the other's change.
static REGISTRY_LOCK: Mutex<()> = Mutex::new(());

/// Why the saved registry had to be replaced, until `list_workspaces` reports it.
static REGISTRY_NOTICE: Mutex<Option<String>> = Mutex::new(None);

/// Canonicalises a path for use as a stable id, falling back to the input when
/// the path does not exist yet.
fn workspace_id(path: &Path) -> String {
    let resolved = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    // `canonicalize` yields a \\?\ prefix on Windows; strip it so ids stay
    // readable and match what the UI shows.
    let text = resolved.to_string_lossy().replace('\\', "/");
    text.strip_prefix("//?/").unwrap_or(&text).to_string()
}

fn entry_for(path: &Path) -> WorkspaceEntry {
    let id = workspace_id(path);
    WorkspaceEntry {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| id.clone()),
        path: path.to_string_lossy().to_string(),
        id,
        org_id: None,
        last_org_id: None,
        last_retrieved_org_id: None,
        created_at: 0,
    }
}

/// Turns an org alias or username into a safe folder name.
fn sanitize_folder_name(label: &str) -> String {
    let cleaned: String = label
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' | '.' => character,
            _ => '-',
        })
        .collect();

    let trimmed = cleaned.trim_matches(['-', '.']).to_string();
    if trimmed.is_empty() {
        "org".to_string()
    } else {
        // Keep well clear of MAX_PATH once the force-app tree is appended.
        trimmed.chars().take(48).collect()
    }
}

/// Root that auto-created per-org workspaces live under.
fn org_workspaces_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(data_dir.join("workspaces"))
}

/// Milliseconds since the Unix epoch.
pub(crate) fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn empty_registry() -> WorkspaceRegistry {
    WorkspaceRegistry {
        version: WORKSPACE_SCHEMA_VERSION,
        ..Default::default()
    }
}

/// Moves an unreadable registry aside and starts a new one.
///
/// An unparseable file used to be read as an empty registry, which the next
/// write then saved over the original — silently forgetting every registered
/// workspace. The original is now kept as `workspace-config.json.corrupt-<ms>`,
/// and if it cannot be moved nothing is overwritten.
fn recover_unreadable_registry(path: &Path, reason: &str) -> Result<WorkspaceRegistry, String> {
    let backup_name = format!(
        "{}.corrupt-{}",
        path.file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| WORKSPACE_CONFIG_FILE.to_string()),
        now_millis()
    );
    let backup = path.with_file_name(backup_name);

    if let Err(error) = fs::rename(path, &backup) {
        return Err(format!(
            "The saved workspace list could not be read because {reason}, and it \
             could not be backed up ({error}). It has been left untouched at {}.",
            path.display()
        ));
    }

    let notice = format!(
        "The saved workspace list could not be read because {reason}. It was kept \
         as {} and a new list was started. No workspace folders were changed.",
        backup.display()
    );
    eprintln!("ForgeSF: {notice}");
    *lock(&REGISTRY_NOTICE) = Some(notice);
    Ok(empty_registry())
}

/// Reads the registry file, upgrading older documents on the way.
///
/// v1 was `{ "workspacePath": "…" }` with no version marker; it becomes a single
/// entry named after its folder, marked active. Callers must hold
/// `REGISTRY_LOCK`.
fn read_registry_file(path: &Path) -> Result<WorkspaceRegistry, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(empty_registry());
        }
        Err(error) => return Err(error.to_string()),
    };

    let json: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(json) => json,
        Err(error) => {
            return recover_unreadable_registry(path, &format!("it is not valid JSON ({error})"))
        }
    };

    let parse = |json: serde_json::Value| -> Result<WorkspaceRegistry, String> {
        match serde_json::from_value::<WorkspaceRegistry>(json) {
            Ok(registry) => Ok(registry),
            Err(error) => {
                recover_unreadable_registry(path, &format!("its entries are malformed ({error})"))
            }
        }
    };

    match json.get("version").and_then(serde_json::Value::as_u64) {
        Some(version) if version == u64::from(WORKSPACE_SCHEMA_VERSION) => parse(json),
        Some(2) => {
            // v2 tracked only which org a folder was *last used with*. Under the
            // per-org model that association becomes ownership, so an existing
            // project stays bound to the org it was already being used with.
            let mut registry = parse(json)?;
            for entry in &mut registry.workspaces {
                if entry.org_id.is_none() {
                    entry.org_id = entry.last_org_id.clone();
                }
            }
            registry.version = WORKSPACE_SCHEMA_VERSION;
            Ok(registry)
        }
        Some(version) if version > u64::from(WORKSPACE_SCHEMA_VERSION) => {
            recover_unreadable_registry(
                path,
                &format!("it was written by a newer version of ForgeSF (schema {version})"),
            )
        }
        _ => {
            // v1: salvage the single path if there is one.
            let mut registry = empty_registry();
            if let Some(workspace) = json
                .get(WORKSPACE_CONFIG_KEY)
                .and_then(serde_json::Value::as_str)
                .filter(|workspace| !workspace.is_empty())
            {
                let entry = entry_for(Path::new(workspace));
                registry.active_id = Some(entry.id.clone());
                registry.workspaces.push(entry);
            }
            Ok(registry)
        }
    }
}

/// Writes the registry atomically. Callers must hold `REGISTRY_LOCK`.
fn write_registry_file(path: &Path, registry: &WorkspaceRegistry) -> Result<(), String> {
    let mut value = serde_json::to_value(registry).map_err(|error| error.to_string())?;
    // The notice is a one-off message for the UI, not part of the stored list.
    if let Some(object) = value.as_object_mut() {
        object.remove("notice");
    }
    let json = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    write_atomic(path, json.as_bytes())
}

/// A consistent snapshot of the registry.
pub(crate) fn read_registry(app: &tauri::AppHandle) -> Result<WorkspaceRegistry, String> {
    let path = workspace_config_path(app)?;
    let _guard = lock(&REGISTRY_LOCK);
    read_registry_file(&path)
}

/// Runs one read-modify-write of the registry file under the lock.
///
/// `change` returns its result and whether it modified the registry; the file
/// is only rewritten when it did.
fn update_registry_at<T>(
    path: &Path,
    change: impl FnOnce(&mut WorkspaceRegistry) -> Result<(T, bool), String>,
) -> Result<T, String> {
    let _guard = lock(&REGISTRY_LOCK);
    let mut registry = read_registry_file(path)?;
    let (result, changed) = change(&mut registry)?;
    if changed {
        write_registry_file(path, &registry)?;
    }
    Ok(result)
}

fn update_registry<T>(
    app: &tauri::AppHandle,
    change: impl FnOnce(&mut WorkspaceRegistry) -> Result<(T, bool), String>,
) -> Result<T, String> {
    update_registry_at(&workspace_config_path(app)?, change)
}

/// The active entry's path, when it still exists on disk.
fn configured_workspace(registry: &WorkspaceRegistry) -> Option<PathBuf> {
    let active_id = registry.active_id.as_ref()?;
    registry
        .workspaces
        .iter()
        .find(|entry| &entry.id == active_id)
        .map(|entry| PathBuf::from(&entry.path))
        // A folder deleted or moved underneath us falls through to the next
        // resolution step rather than failing every workspace command.
        .filter(|path| path.exists() && path.is_dir())
}

/// The dev workspace, anchored to the crate directory at compile time.
///
/// This deliberately does NOT use `std::env::current_dir()`: the working
/// directory of a launched app is wherever the user started it from, which
/// made the workspace root non-deterministic (a `cargo tauri dev` from the
/// repo root and one from `apps/desktop` resolved to two different projects,
/// and a packaged build would silently adopt any `./workspace` directory that
/// happened to sit beside the executable).
#[cfg(debug_assertions)]
fn dev_workspace() -> Option<PathBuf> {
    // CARGO_MANIFEST_DIR is `apps/desktop/src-tauri`; the dev workspace is its
    // sibling at `apps/desktop/workspace`.
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()?
        .join("workspace");
    (root.exists() && root.is_dir()).then_some(root)
}

#[cfg(not(debug_assertions))]
fn dev_workspace() -> Option<PathBuf> {
    None
}

/// Resolves the workspace root used by every workspace command.
///
/// Priority:
///   1. The path saved through `set_workspace_path` (if it still exists).
///   2. In debug builds only, the dev workspace at `apps/desktop/workspace`.
///   3. A fresh project skeleton created under the app data directory.
fn get_workspace(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let registry = read_registry(app)?;
    resolve_workspace(app, &registry)
}

/// The folder a request should act on: the workspace with `workspace_id`, or
/// the active one when no id is given.
///
/// The UI passes the id of the workspace it is *showing*. Every command used
/// to resolve the global active workspace at the moment it ran, so a read,
/// save or deploy issued just before an org switch landed in the next org's
/// folder — and per-org trees share paths such as
/// `force-app/main/default/classes/Foo.cls`, so the wrong org's file could be
/// shown, overwritten or deployed.
pub(crate) fn workspace_root(
    app: &tauri::AppHandle,
    workspace_id: Option<&str>,
) -> Result<PathBuf, String> {
    let registry = read_registry(app)?;
    match workspace_id.filter(|id| !id.is_empty()) {
        Some(id) => registered_workspace_path(&registry, id),
        None => resolve_workspace(app, &registry),
    }
}

/// A registered workspace's folder, which must still exist.
fn registered_workspace_path(registry: &WorkspaceRegistry, id: &str) -> Result<PathBuf, String> {
    let entry = registry
        .workspaces
        .iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "That workspace is no longer registered.".to_string())?;
    let path = PathBuf::from(&entry.path);
    if !path.is_dir() {
        return Err(format!(
            "The workspace folder '{}' no longer exists.",
            entry.path
        ));
    }
    Ok(path)
}

/// `get_workspace` against a registry the caller already holds — needed inside
/// `update_registry`, where reading it again would deadlock on the lock.
fn resolve_workspace(
    app: &tauri::AppHandle,
    registry: &WorkspaceRegistry,
) -> Result<PathBuf, String> {
    if let Some(configured) = configured_workspace(registry) {
        return Ok(configured);
    }

    if let Some(dev) = dev_workspace() {
        return Ok(dev);
    }

    // Production fallback: a dedicated workspace under the app data directory.
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let root = data_dir.join("workspace");
    ensure_sfdx_project(&root)?;
    Ok(root)
}

/// Bootstraps an SFDX project skeleton in `root` when it does not exist yet.
fn ensure_sfdx_project(root: &Path) -> Result<(), String> {
    if !root.exists() {
        fs::create_dir_all(root.join("force-app/main/default"))
            .map_err(|error| error.to_string())?;
    }

    let project_file = root.join("sfdx-project.json");
    if !project_file.exists() {
        let sources = r#"{
  "packageDirectories": [
    {
      "path": "force-app",
      "default": true
    }
  ],
  "namespace": "",
  "sourceApiVersion": "65.0"
}
"#;
        fs::write(project_file, sources).map_err(|error| error.to_string())?;
    }

    Ok(())
}

/// Joins a relative path with the workspace root, rejecting any attempt to
/// escape the workspace directory (absolute paths, `..`, drive prefixes).
pub(crate) fn resolve_in_workspace(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute() {
        return Err(format!(
            "Path '{relative}' must be relative to the workspace."
        ));
    }

    let mut normalized = PathBuf::new();
    for component in relative_path.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!("Path '{relative}' escapes the workspace root."));
                }
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "Path '{relative}' must be relative to the workspace."
                ));
            }
        }
    }

    let full_path = root.join(normalized);
    if !full_path.starts_with(root) {
        return Err(format!("Path '{relative}' escapes the workspace root."));
    }
    Ok(full_path)
}

/// Returns true when a path should be hidden from the workspace explorer.
pub(crate) fn is_ignored_path(path: &Path) -> bool {
    path.components().any(|component| {
        if let Component::Normal(name) = component {
            let name = name.to_string_lossy();
            IGNORED_DIRECTORIES.iter().any(|ignored| name == *ignored)
        } else {
            false
        }
    })
}

/// Returns a path relative to the workspace root using `/` separators.
pub(crate) fn to_relative_string(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Workspace filesystem walker
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/// True when a directory holds at least one entry the explorer would show.
fn has_visible_entries(path: &Path) -> bool {
    let Ok(entries) = fs::read_dir(path) else {
        return false;
    };
    // By name only: checking the full path hid every entry of a workspace
    // that itself sits under a folder such as `.sf` or `node_modules`.
    entries
        .flatten()
        .any(|entry| !is_ignored_path(Path::new(&entry.file_name())))
}

/// Reads a directory `depth` levels deep.
///
/// `depth` of 1 returns immediate children only, leaving each folder's
/// `children` as `None` for the explorer to fetch on expand. Reading the whole
/// tree eagerly meant one multi-megabyte IPC payload and a full remount of
/// every node after each retrieve — untenable on a large org's source.
fn read_directory(root: &Path, path: &Path, depth: usize) -> Result<Vec<FileNode>, String> {
    let mut nodes = Vec::new();

    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_path = entry.path();

        if is_ignored_path(Path::new(&entry.file_name())) {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        if entry_path.is_dir() {
            let children = if depth > 1 {
                Some(read_directory(root, &entry_path, depth - 1)?)
            } else {
                None
            };
            nodes.push(FileNode {
                name: name.clone(),
                path: to_relative_string(root, &entry_path),
                node_type: "folder".to_string(),
                has_children: children
                    .as_ref()
                    .map(|items| !items.is_empty())
                    .unwrap_or_else(|| has_visible_entries(&entry_path)),
                children,
            });
        } else {
            nodes.push(FileNode {
                name,
                path: to_relative_string(root, &entry_path),
                node_type: "file".to_string(),
                children: None,
                has_children: false,
            });
        }
    }

    // Deterministic ordering â€” folders first, then files, both alphabetically.
    nodes.sort_by(|a, b| match (a.node_type.as_str(), b.node_type.as_str()) {
        ("folder", "file") => std::cmp::Ordering::Less,
        ("file", "folder") => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(nodes)
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Org management
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/// Classifies an org from the flags `sf` reports, falling back to the instance
/// host when they are absent. Previously every org was hardcoded "Production",
/// which mislabelled sandboxes and scratch orgs everywhere they were shown —
/// including both deployment dropdowns.
fn classify_org_type(value: &serde_json::Value) -> &'static str {
    let flag = |key: &str| {
        value
            .get(key)
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    };

    if flag("isScratch") {
        return "Scratch Org";
    }
    if flag("isSandbox") {
        return "Sandbox";
    }

    // `org display` omits those flags, so fall back to the host, which encodes
    // the org kind for sandboxes and scratch/dev orgs.
    let host = value
        .get("instanceUrl")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();

    if host.contains(".sandbox.") {
        return "Sandbox";
    }
    if host.contains(".develop.") || host.contains("-dev-ed.") {
        return "Developer";
    }
    "Production"
}

/// Maps the CLI's `connectedStatus` onto the three states the UI models.
fn classify_org_status(value: &serde_json::Value) -> &'static str {
    let connected = value
        .get("connectedStatus")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();

    // `org login`/`org display` omit the field on a freshly authenticated org.
    if connected.is_empty() || connected.eq_ignore_ascii_case("Connected") {
        return "Connected";
    }

    let lower = connected.to_ascii_lowercase();
    if lower.contains("expired")
        || lower.contains("refreshtoken")
        || lower.contains("invalid_grant")
    {
        return "Expired";
    }
    "Disconnected"
}

/// Builds an `Organization` from a CLI org payload.
///
/// Required fields are errors rather than empty strings: coercing a missing
/// `orgId` to `""` used to store an org whose React key collided with every
/// other malformed entry.
fn organization_from_json(value: &serde_json::Value) -> Result<Organization, String> {
    let username = value
        .get("username")
        .and_then(serde_json::Value::as_str)
        .filter(|name| !name.is_empty())
        .ok_or("The Salesforce CLI returned an org with no username.")?
        .to_string();

    let id = value
        .get("orgId")
        .or_else(|| value.get("id"))
        .and_then(serde_json::Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| format!("The Salesforce CLI returned no org id for {username}."))?
        .to_string();

    let alias = value
        .get("alias")
        .and_then(serde_json::Value::as_str)
        .filter(|alias| !alias.is_empty())
        .unwrap_or(&username)
        .to_string();

    Ok(Organization {
        id,
        alias,
        instance_url: value
            .get("instanceUrl")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string(),
        org_type: classify_org_type(value).to_string(),
        is_default: value
            .get("isDefaultUsername")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        status: classify_org_status(value).to_string(),
        username,
    })
}

/// Every org the Salesforce CLI knows about, de-duplicated across its buckets.
///
/// `skip_connection_status` avoids the per-org network round-trip that makes
/// `sf org list` slow; statuses then read as connected and must come from a
/// later full refresh.
fn collect_orgs(skip_connection_status: bool) -> Result<Vec<Organization>, String> {
    let mut args = vec!["org", "list", "--json"];
    if skip_connection_status {
        args.push("--skip-connection-status");
    }
    let output = run_sf(args)?;
    let json = parse_sf_json(&output)?;
    let result = &json["result"];

    let mut orgs: Vec<Organization> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    // The buckets overlap — a dev hub is also a non-scratch org — so the first
    // occurrence wins, and the bucket itself refines the type where the flags
    // were not set.
    for bucket in [
        "scratchOrgs",
        "sandboxes",
        "devHubs",
        "nonScratchOrgs",
        "other",
    ] {
        let Some(entries) = result.get(bucket).and_then(serde_json::Value::as_array) else {
            continue;
        };

        for entry in entries {
            let Ok(mut org) = organization_from_json(entry) else {
                continue;
            };
            if bucket == "scratchOrgs" {
                org.org_type = "Scratch Org".to_string();
            } else if bucket == "sandboxes" && org.org_type == "Production" {
                org.org_type = "Sandbox".to_string();
            }
            if seen.insert(org.username.clone()) {
                orgs.push(org);
            }
        }
    }

    Ok(orgs)
}

/// Lists every org the CLI is authenticated against.
///
/// The app previously had no way to discover orgs: its list only grew when a
/// user pressed "Add Organization", so orgs already authenticated in the CLI
/// were invisible, and orgs logged out via the CLI lingered as phantoms.
#[tauri::command]
pub async fn list_orgs(skip_connection_status: Option<bool>) -> Result<Vec<Organization>, String> {
    blocking(move || collect_orgs(skip_connection_status.unwrap_or(false))).await
}

/// Normalises a login URL: `https` only, with a plain host (and optional port
/// and path). A bare host such as `acme.my.salesforce.com` gets `https://`.
fn login_instance_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Enter the org's login URL.".to_string());
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") {
        return Err("The login URL must use https://.".to_string());
    }
    let rest = if lower.starts_with("https://") {
        &trimmed["https://".len()..]
    } else {
        trimmed
    };

    let (authority, path) = match rest.split_once('/') {
        Some((authority, path)) => (authority, Some(path)),
        None => (rest, None),
    };
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };

    let host_ok = !host.is_empty()
        && host.contains('.')
        && host
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'));
    let port_ok = port.map_or(true, |port| {
        !port.is_empty() && port.chars().all(|c| c.is_ascii_digit())
    });
    let path_ok = path.map_or(true, |path| {
        path.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '~' | '/'))
    });

    if !(host_ok && port_ok && path_ok) {
        return Err(format!("'{}' is not a valid login URL.", raw.trim()));
    }
    Ok(format!("https://{rest}"))
}

/// Validates an org alias. The CLI accepts little beyond these characters, and
/// keeping it to them means it can never be misread as another argument.
fn login_alias(raw: &str) -> Result<String, String> {
    let alias = raw.trim();
    let valid = !alias.is_empty()
        && alias.len() <= 80
        && !alias.starts_with('-')
        && alias
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '@'));
    if valid {
        Ok(alias.to_string())
    } else {
        Err("An alias may use letters, digits, and _ - . @ only.".to_string())
    }
}

/// `sf org login web` arguments for the chosen options.
fn login_args(
    instance_url: Option<&str>,
    alias: Option<&str>,
    set_default: bool,
) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = ["org", "login", "web", "--json"]
        .into_iter()
        .map(str::to_string)
        .collect();
    if let Some(url) = instance_url.filter(|url| !url.trim().is_empty()) {
        args.push("--instance-url".to_string());
        args.push(login_instance_url(url)?);
    }
    if let Some(alias) = alias.filter(|alias| !alias.trim().is_empty()) {
        args.push("--alias".to_string());
        args.push(login_alias(alias)?);
    }
    if set_default {
        args.push("--set-default".to_string());
    }
    Ok(args)
}

/// How long a browser login may take before the waiting CLI is stopped.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Authenticates an org through the browser.
///
/// `instance_url` selects a sandbox (`https://test.salesforce.com`) or a My
/// Domain; previously every login went to production's login page, so
/// sandboxes could not be connected at all. The login is a cancellable run: an
/// abandoned browser tab used to leave the button spinning until restart.
#[tauri::command]
pub async fn connect_salesforce(
    instance_url: Option<String>,
    alias: Option<String>,
    set_default: Option<bool>,
    run_id: Option<String>,
) -> Result<Organization, String> {
    blocking(move || {
        let run = RunGuard::begin(run_id);
        let args = login_args(
            instance_url.as_deref(),
            alias.as_deref(),
            set_default.unwrap_or(false),
        )?;

        let mut command = sf_command()?;
        command.args(&args);
        let login = run_with_limits(command, None, &run.cancelled, LOGIN_TIMEOUT)?;
        let json = parse_sf_json(&login)?;

        let username = json
            .pointer("/result/username")
            .and_then(serde_json::Value::as_str)
            .filter(|name| !name.is_empty())
            .ok_or("The Salesforce CLI did not report a username for this login.")?
            .to_string();

        // The login payload carries no isSandbox/isScratch/default flags, so
        // re-read the org from `org list`, which does. Falling back to the
        // login payload keeps the connection usable if that second call fails.
        if let Ok(orgs) = collect_orgs(false) {
            if let Some(org) = orgs.into_iter().find(|org| org.username == username) {
                return Ok(org);
            }
        }

        organization_from_json(&json["result"])
    })
    .await
}

#[tauri::command]
pub async fn open_org(username: String) -> Result<(), String> {
    blocking(move || {
        let output = run_sf(["org", "open", "--target-org", &username])?;
        output_to_string(&output)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_default_org(username: String) -> Result<String, String> {
    blocking(move || {
        // `--global`: without it the CLI writes project-local config into its
        // working directory, which is not a project the user chose.
        let output = run_sf(["config", "set", "target-org", &username, "--global"])?;
        output_to_string(&output)
    })
    .await
}

#[tauri::command]
pub async fn logout_org(username: String) -> Result<String, String> {
    blocking(move || {
        let output = run_sf(["org", "logout", "--target-org", &username, "--no-prompt"])?;
        output_to_string(&output)
    })
    .await
}

#[tauri::command]
pub async fn get_org_details(username: String) -> Result<OrgDetails, String> {
    blocking(move || {
        let output = run_sf(["org", "display", "--target-org", &username, "--json"])?;
        let json = parse_sf_json(&output)?;
        let result = &json["result"];

        Ok(OrgDetails {
            instance_url: result["instanceUrl"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            api_version: result["apiVersion"].as_str().unwrap_or("65.0").to_string(),
        })
    })
    .await
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Metadata
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

#[tauri::command]
pub async fn list_metadata_types(username: String) -> Result<Vec<MetadataType>, String> {
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
            .map_err(|error| error.to_string())
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
) -> Result<Vec<String>, String> {
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
) -> Result<Vec<String>, String> {
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
fn retrieve_warnings(stdout: &[u8]) -> HashMap<String, Vec<String>> {
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
const RETRIEVE_TIMEOUT: Duration = Duration::from_secs(25 * 60);

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

/// `sourceApiVersion` from the project manifest, when set.
pub(crate) fn source_api_version(workspace: &Path) -> Option<String> {
    let raw = fs::read_to_string(workspace.join("sfdx-project.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    json.get("sourceApiVersion")
        .and_then(serde_json::Value::as_str)
        .filter(|version| !version.trim().is_empty())
        .map(str::to_string)
}

/// Retrieves any number of members in a single `sf` invocation and reports how
/// many files were written per metadata type.
fn retrieve_members(
    workspace: &Path,
    username: &str,
    members: &[String],
    cancelled: &AtomicBool,
) -> Result<RetrieveBatchOutcome, String> {
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
) -> Result<RetrieveResult, String> {
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
) -> Result<RetrieveResult, String> {
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
        let _ = crate::changes::record_synced_files(&app, &workspace, &synced_files, None);
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

/// Reads `packageDirectories[].path` from the project manifest.
///
/// Deploys hardcoded `force-app`, so a project laid out any other way — `src`,
/// `main`, or a multi-package repo — could not be deployed at all.
pub(crate) fn package_directories(workspace: &Path) -> Vec<String> {
    let manifest = workspace.join("sfdx-project.json");
    let paths = fs::read_to_string(&manifest)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|json| {
            json.get("packageDirectories")
                .and_then(serde_json::Value::as_array)
                .map(|dirs| {
                    dirs.iter()
                        .filter_map(|dir| {
                            dir.get("path")
                                .and_then(serde_json::Value::as_str)
                                .filter(|path| !path.is_empty())
                                .map(|path| path.to_string())
                        })
                        .collect::<Vec<String>>()
                })
        })
        .unwrap_or_default();

    if paths.is_empty() {
        vec!["force-app".to_string()]
    } else {
        paths
    }
}

/// Validates a caller-supplied list of workspace-relative paths.
///
/// Every path goes through `resolve_in_workspace`, so a per-file action cannot
/// be pointed outside the active org's workspace.
pub(crate) fn resolve_paths(root: &Path, paths: &[String]) -> Result<Vec<String>, String> {
    if paths.is_empty() {
        return Err("No files or folders were selected.".to_string());
    }

    let mut resolved = Vec::with_capacity(paths.len());
    for path in paths {
        let absolute = resolve_in_workspace(root, path)?;
        if !absolute.exists() {
            return Err(format!("'{path}' no longer exists in the workspace."));
        }
        resolved.push(to_relative_string(root, &absolute));
    }
    Ok(resolved)
}

/// Retrieves specific files or folders from the org into the workspace.
#[tauri::command]
pub async fn retrieve_paths(
    app: tauri::AppHandle,
    username: String,
    paths: Vec<String>,
    workspace_id: Option<String>,
) -> Result<String, String> {
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

        let _ = crate::changes::record_synced_files(
            &app,
            &workspace,
            &written_files(&output.stdout, &workspace),
            None,
        );
        Ok(summarize_sf_json(&output.stdout))
    })
    .await
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Workspace commands
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

#[tauri::command]
pub async fn get_workspace_root(
    app: tauri::AppHandle,
    workspace_id: Option<String>,
) -> Result<String, String> {
    blocking(move || {
        Ok(workspace_root(&app, workspace_id.as_deref())?
            .to_string_lossy()
            .to_string())
    })
    .await
}

#[tauri::command]
pub async fn set_workspace_path(app: tauri::AppHandle, path: String) -> Result<String, String> {
    // Kept as a thin alias so existing callers keep working; registering a
    // folder now also makes it the active project.
    let entry = add_workspace(app, path, None).await?;
    Ok(entry.path)
}

/* ─────────────────────────────────────────────────────────────────
Workspace registry
───────────────────────────────────────────────────────────────── */

/// Every registered project. The active one is whichever `activeId` names.
///
/// Self-heals on read: whatever `get_workspace` resolves to is a real project
/// even when nobody picked it explicitly (the dev folder, or the app-data
/// skeleton). Registering it here means org associations, the switcher and the
/// mixing warning all work on first launch instead of staying inert until the
/// user happens to use "Open folder…".
#[tauri::command]
pub async fn list_workspaces(app: tauri::AppHandle) -> Result<WorkspaceRegistry, String> {
    blocking(move || {
        let mut registry = update_registry(&app, |registry| {
            let mut changed = false;

            // An `activeId` pointing at an entry that is no longer registered
            // would leave the app with no active project at all.
            if registry
                .active_id
                .as_ref()
                .is_some_and(|id| !registry.workspaces.iter().any(|item| &item.id == id))
            {
                registry.active_id = None;
                changed = true;
            }

            if registry.active_id.is_none() {
                let resolved = resolve_workspace(&app, registry)?;
                let id = workspace_id(&resolved);

                if !registry.workspaces.iter().any(|item| item.id == id) {
                    let mut entry = entry_for(&resolved);
                    entry.created_at = now_millis();
                    registry.workspaces.push(entry);
                }
                registry.active_id = Some(id);
                changed = true;
            }

            Ok((registry.clone(), changed))
        })?;

        // Reported once, on the response only — it is never written to disk.
        registry.notice = lock(&REGISTRY_NOTICE).take();
        Ok(registry)
    })
    .await
}

/// Registers a folder as a project and makes it active.
///
/// Adding a folder that is already registered just re-activates it rather than
/// creating a duplicate entry.
#[tauri::command]
pub async fn add_workspace(
    app: tauri::AppHandle,
    path: String,
    org_id: Option<String>,
) -> Result<WorkspaceEntry, String> {
    blocking(move || {
        let root = PathBuf::from(&path);
        if !root.is_dir() {
            return Err(format!("'{path}' is not an existing directory."));
        }
        ensure_sfdx_project(&root)?;

        update_registry(&app, |registry| {
            let entry = entry_for(&root);

            let existing = registry
                .workspaces
                .iter()
                .position(|item| item.id == entry.id);

            let active = match existing {
                Some(index) => registry.workspaces[index].clone(),
                None => {
                    let mut created = entry;
                    created.created_at = now_millis();
                    registry.workspaces.push(created.clone());
                    created
                }
            };

            // Picking a folder while an org is selected makes it that org's
            // workspace, releasing whichever folder held the claim before.
            if let Some(org) = org_id {
                for entry in &mut registry.workspaces {
                    if entry.id == active.id {
                        entry.org_id = Some(org.clone());
                        entry.last_org_id = Some(org.clone());
                    } else if entry.org_id.as_deref() == Some(org.as_str()) {
                        entry.org_id = None;
                    }
                }
            }

            registry.active_id = Some(active.id.clone());
            Ok((active, true))
        })
    })
    .await
}

/// Returns the workspace that belongs to `org_id`, creating it if needed, and
/// makes it active.
///
/// This is what keeps each org's metadata isolated: every org gets its own
/// folder, so a retrieve can only ever write into the tree for the org it came
/// from. Folders are created lazily under `<app data>/workspaces/<label>`, so
/// an org you never open costs nothing.
///
/// `label` is the org alias (or username) and is only used to name a *new*
/// folder — renaming an org later does not move an existing one.
#[tauri::command]
pub async fn workspace_for_org(
    app: tauri::AppHandle,
    org_id: String,
    label: Option<String>,
) -> Result<WorkspaceEntry, String> {
    blocking(move || {
        let root = org_workspaces_root(&app)?;

        update_registry(&app, |registry| {
            // Already bound: just activate it.
            if let Some(existing) = registry
                .workspaces
                .iter()
                .find(|item| item.org_id.as_deref() == Some(org_id.as_str()))
                .cloned()
            {
                // A folder deleted underneath us is recreated rather than
                // leaving every workspace command failing.
                ensure_sfdx_project(Path::new(&existing.path))?;
                let changed = registry.active_id.as_deref() != Some(existing.id.as_str());
                registry.active_id = Some(existing.id.clone());
                return Ok((existing, changed));
            }

            let base = sanitize_folder_name(label.as_deref().unwrap_or(&org_id));

            // Two orgs can share an alias; suffix until the path is free of any
            // folder already owned by a *different* org.
            let mut candidate = root.join(&base);
            let mut suffix = 2;
            while registry
                .workspaces
                .iter()
                .any(|item| item.id == workspace_id(&candidate))
            {
                candidate = root.join(format!("{base}-{suffix}"));
                suffix += 1;
            }

            ensure_sfdx_project(&candidate)?;

            let mut entry = entry_for(&candidate);
            entry.org_id = Some(org_id.clone());
            entry.last_org_id = Some(org_id.clone());
            entry.created_at = now_millis();

            registry.active_id = Some(entry.id.clone());
            registry.workspaces.push(entry.clone());
            Ok((entry, true))
        })
    })
    .await
}

/// Binds an already-registered folder to an org, replacing whatever folder that
/// org was using. Lets a developer point an org at their own repo instead of the
/// auto-created one.
#[tauri::command]
pub async fn bind_workspace_to_org(
    app: tauri::AppHandle,
    id: String,
    org_id: String,
) -> Result<WorkspaceRegistry, String> {
    blocking(move || {
        update_registry(&app, |registry| {
            if !registry.workspaces.iter().any(|item| item.id == id) {
                return Err("That workspace is no longer registered.".to_string());
            }

            for entry in &mut registry.workspaces {
                if entry.id == id {
                    entry.org_id = Some(org_id.clone());
                    entry.last_org_id = Some(org_id.clone());
                } else if entry.org_id.as_deref() == Some(org_id.as_str()) {
                    // Only one folder per org, so the previous owner is released
                    // rather than leaving two claims on the same org.
                    entry.org_id = None;
                }
            }

            registry.active_id = Some(id);
            Ok((registry.clone(), true))
        })
    })
    .await
}

/// Switches the active project.
#[tauri::command]
pub async fn set_active_workspace(
    app: tauri::AppHandle,
    id: String,
) -> Result<WorkspaceEntry, String> {
    blocking(move || {
        update_registry(&app, |registry| {
            let entry = registry
                .workspaces
                .iter()
                .find(|item| item.id == id)
                .cloned()
                .ok_or_else(|| "That workspace is no longer registered.".to_string())?;

            registry.active_id = Some(entry.id.clone());
            Ok((entry, true))
        })
    })
    .await
}

/// Forgets a project. This touches the registry only — never the files on disk.
#[tauri::command]
pub async fn remove_workspace(
    app: tauri::AppHandle,
    id: String,
) -> Result<WorkspaceRegistry, String> {
    blocking(move || {
        update_registry(&app, |registry| {
            registry.workspaces.retain(|item| item.id != id);

            // Removing the active project promotes the next one, if any.
            if registry.active_id.as_deref() == Some(id.as_str()) {
                registry.active_id = registry.workspaces.first().map(|item| item.id.clone());
            }

            Ok((registry.clone(), true))
        })
    })
    .await
}

/// Renames a project's display name. The id (its path) is unaffected.
#[tauri::command]
pub async fn rename_workspace(
    app: tauri::AppHandle,
    id: String,
    name: String,
) -> Result<WorkspaceRegistry, String> {
    blocking(move || {
        let trimmed = name.trim().to_string();
        if trimmed.is_empty() {
            return Err("A workspace name cannot be empty.".to_string());
        }

        update_registry(&app, |registry| {
            let entry = registry
                .workspaces
                .iter_mut()
                .find(|item| item.id == id)
                .ok_or_else(|| "That workspace is no longer registered.".to_string())?;
            entry.name = trimmed;

            Ok((registry.clone(), true))
        })
    })
    .await
}

/// Remembers which org this project was last used with, so opening it restores
/// that org instead of leaving the previous project's org selected.
#[tauri::command]
pub async fn set_workspace_org(
    app: tauri::AppHandle,
    id: String,
    org_id: Option<String>,
) -> Result<(), String> {
    blocking(move || {
        update_registry(&app, |registry| {
            let Some(entry) = registry.workspaces.iter_mut().find(|item| item.id == id) else {
                return Ok(((), false));
            };
            entry.last_org_id = org_id;
            Ok(((), true))
        })
    })
    .await
}

/// Records which org actually populated this tree. Retrieving from a different
/// org later is what the mixing warning is built on.
#[tauri::command]
pub async fn set_workspace_retrieved_org(
    app: tauri::AppHandle,
    id: String,
    org_id: String,
) -> Result<(), String> {
    blocking(move || {
        update_registry(&app, |registry| {
            let Some(entry) = registry.workspaces.iter_mut().find(|item| item.id == id) else {
                return Ok(((), false));
            };
            entry.last_retrieved_org_id = Some(org_id);
            Ok(((), true))
        })
    })
    .await
}

#[tauri::command]
pub async fn read_workspace(
    app: tauri::AppHandle,
    path: String,
    depth: Option<usize>,
    workspace_id: Option<String>,
) -> Result<Vec<FileNode>, String> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let target = if path.trim().is_empty() {
            root.clone()
        } else {
            resolve_in_workspace(&root, &path)?
        };

        // Default to one level: callers opt into deeper reads explicitly.
        read_directory(&root, &target, depth.unwrap_or(1).max(1))
    })
    .await
}

/// Largest file the editor opens. The whole file crosses the IPC bridge as one
/// string, and Monaco is unusable well before this size.
const MAX_EDITOR_FILE_BYTES: u64 = 10 * 1024 * 1024;

/// A NUL byte in the first block is the usual "this is binary" heuristic.
pub(crate) fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|byte| *byte == 0)
}

/// Reads a file for the editor, refusing anything it cannot round-trip.
///
/// The errors say *why*, and the UI treats any of them as "do not open an
/// editable buffer" — opening a binary static resource used to show an empty
/// editor whose next save overwrote the real file.
pub(crate) fn read_editor_text(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => "The file no longer exists on disk.".to_string(),
        _ => error.to_string(),
    })?;

    if metadata.is_dir() {
        return Err("This is a folder, not a file.".to_string());
    }
    if metadata.len() > MAX_EDITOR_FILE_BYTES {
        return Err(format!(
            "The file is {:.1} MB, larger than the {} MB the editor opens.",
            metadata.len() as f64 / (1024.0 * 1024.0),
            MAX_EDITOR_FILE_BYTES / (1024 * 1024)
        ));
    }

    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if looks_binary(&bytes) {
        return Err("This is a binary file, so it can't be shown as text.".to_string());
    }
    String::from_utf8(bytes).map_err(|_| {
        "The file isn't valid UTF-8 text, so it can't be edited safely here.".to_string()
    })
}

// Reading, writing, creating, renaming, moving and deleting workspace files
// live in `workspace_fs`.

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Data & misc commands
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

/// Runs a SOQL query.
///
/// The query is passed with `--file` rather than `--query`. On Windows `sf` is
/// `sf.cmd`, and Rust refuses to pass arguments containing line breaks to a
/// batch file, so every multi-line query failed with "batch file arguments are
/// invalid"; a file also sidesteps cmd.exe's 8191-character line limit.
#[tauri::command]
pub async fn run_query(
    username: String,
    query: String,
    run_id: Option<String>,
) -> Result<String, String> {
    blocking(move || run_query_file("query", &username, &query, "soql", run_id)).await
}

/// Runs a SOSL search, passed by file for the same reasons as `run_query`.
#[tauri::command]
pub async fn run_search(
    username: String,
    query: String,
    run_id: Option<String>,
) -> Result<String, String> {
    blocking(move || run_query_file("search", &username, &query, "sosl", run_id)).await
}

/// `sf data <verb> --file <tmp>`, returning the CLI's full JSON.
fn run_query_file(
    verb: &str,
    username: &str,
    query: &str,
    extension: &str,
    run_id: Option<String>,
) -> Result<String, String> {
    // Registered before the CLI is located: the first lookup can take seconds,
    // and a Cancel pressed during it must still count.
    let run = RunGuard::begin(run_id);
    let query_file = TempFile::create(extension, query.trim())?;

    let mut command = sf_command()?;
    command.args(["data", verb, "--target-org", username, "--json", "--file"]);
    command.arg(query_file.path());

    let output = run_cancellable(command, None, &run)?;
    // Surface the CLI's structured error (bad field, malformed SOQL) rather
    // than a raw stdout/stderr dump, but hand the caller the full JSON so the
    // results table can render the records.
    parse_sf_json(&output)?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Cancellation flags for in-flight runs, keyed by the id the UI generated,
/// with when each entry was created.
///
/// This replaced a single global flag that every new command reset: a Cancel
/// pressed while the CLI was still starting was wiped, and cancelling in
/// Developer Tools also killed a terminal command running at the same time.
type RunTable = HashMap<String, (Arc<AtomicBool>, Instant)>;

fn run_table() -> &'static Mutex<RunTable> {
    static RUNS: OnceLock<Mutex<RunTable>> = OnceLock::new();
    RUNS.get_or_init(Default::default)
}

/// A cancel for a run that never started (or already finished) is dropped
/// after this long, so the table cannot grow without bound.
const STALE_CANCEL_AGE: Duration = Duration::from_secs(600);

/// One cancellable run, registered for as long as it is alive.
pub(crate) struct RunGuard {
    id: String,
    pub(crate) cancelled: Arc<AtomicBool>,
}

impl RunGuard {
    /// Registers a run. A cancel that arrived before registration is honoured.
    /// Runs without an id (callers that never cancel) get a private one.
    pub(crate) fn begin(id: Option<String>) -> Self {
        let id = id.unwrap_or_else(|| format!("internal-{}", next_temp_suffix()));
        let mut table = lock(run_table());
        // Only entries no live run holds can be stale.
        table.retain(|_, (flag, created)| {
            Arc::strong_count(flag) > 1 || created.elapsed() < STALE_CANCEL_AGE
        });
        let cancelled = table
            .entry(id.clone())
            .or_insert_with(|| (Arc::new(AtomicBool::new(false)), Instant::now()))
            .0
            .clone();
        Self { id, cancelled }
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        lock(run_table()).remove(&self.id);
    }
}

/// Stops the run started with `run_id`, killing its whole process tree. Safe
/// to call before the run starts or after it ends.
#[tauri::command]
pub fn cancel_sf_command(run_id: String) {
    let mut table = lock(run_table());
    table
        .entry(run_id)
        .or_insert_with(|| (Arc::new(AtomicBool::new(false)), Instant::now()))
        .0
        .store(true, Ordering::SeqCst);
}

/// How long a Developer Tools command may run before being killed.
///
/// Nothing here had a timeout: a hung CLI — an expired token waiting on stdin,
/// a stalled network — held the pane forever with no way out.
const SF_COMMAND_TIMEOUT: Duration = Duration::from_secs(300);

/// Runs a command to completion, killing it on cancellation or timeout.
fn run_cancellable(
    command: Command,
    input: Option<String>,
    run: &RunGuard,
) -> Result<std::process::Output, String> {
    run_with_limits(command, input, &run.cancelled, SF_COMMAND_TIMEOUT)
}

/// Reads a child's pipe to the end on its own thread.
fn spawn_pipe_reader<R: Read + Send + 'static>(
    pipe: Option<R>,
) -> Option<std::thread::JoinHandle<Vec<u8>>> {
    pipe.map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buffer = Vec::new();
            let _ = pipe.read_to_end(&mut buffer);
            buffer
        })
    })
}

fn join_pipe_reader(reader: Option<std::thread::JoinHandle<Vec<u8>>>) -> Vec<u8> {
    reader
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default()
}

/// Stops a child and every process it started.
///
/// On Windows `sf` is `sf.cmd`: the child is `cmd.exe`, and the CLI itself runs
/// as a `node.exe` grandchild. `Child::kill` only ended the wrapper, so after
/// "Cancel" the CLI kept running and kept spending the org's API calls. On
/// Unix the child leads its own process group (see `run_with_limits`), which is
/// signalled as a whole.
pub(crate) fn kill_process_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let mut taskkill = Command::new("taskkill");
        hide_console(&mut taskkill);
        let _ = taskkill
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{}", child.id())])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    let _ = child.kill();
    // Reap it so no process handle is left behind.
    let _ = child.wait();
}

/// The runner behind `run_cancellable`, with the timeout as a parameter so
/// tests do not have to wait five minutes.
pub(crate) fn run_with_limits(
    mut command: Command,
    input: Option<String>,
    cancelled: &AtomicBool,
    timeout: Duration,
) -> Result<std::process::Output, String> {
    if cancelled.load(Ordering::SeqCst) {
        return Err("Cancelled.".to_string());
    }

    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    // Its own process group, so cancelling can stop everything it spawns.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command.spawn().map_err(|error| error.to_string())?;

    // Drain both pipes from the moment the child starts. They used to be read
    // only after it exited, so once `sf` wrote more than the OS pipe buffer —
    // a few KB on Windows, i.e. a modest SOQL result — it blocked on the write,
    // never exited, and the query hung until the timeout killed it.
    let stdout_reader = spawn_pipe_reader(child.stdout.take());
    let stderr_reader = spawn_pipe_reader(child.stderr.take());

    if let Some(text) = input {
        let Some(mut stdin) = child.stdin.take() else {
            kill_process_tree(&mut child);
            return Err("Could not open stdin for the Salesforce CLI.".to_string());
        };
        // Written from its own thread: a large input would otherwise block
        // here until the child read it, while nothing polls for cancellation.
        std::thread::spawn(move || stdin.write_all(text.as_bytes()));
    } else {
        drop(child.stdin.take());
    }

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status;
        }
        // On cancel or timeout the readers are left to finish on their own:
        // joining them could block if some process still holds a pipe open.
        if cancelled.load(Ordering::SeqCst) {
            kill_process_tree(&mut child);
            return Err("Cancelled.".to_string());
        }
        if started.elapsed() > timeout {
            kill_process_tree(&mut child);
            return Err(format!(
                "The command was still running after {} seconds and was stopped.",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    };

    Ok(std::process::Output {
        status,
        stdout: join_pipe_reader(stdout_reader),
        stderr: join_pipe_reader(stderr_reader),
    })
}

/// Runs an `sf` command that emits `--json`, validating the envelope.
///
/// `run_command` only checks the process exit code, which is not enough for
/// several subcommands: `sf apex execute --json` exits **0** when Apex compiles
/// and then throws at runtime, reporting `result.success: false` with the
/// exception in the payload. Routing the SOSL and Apex tabs through here means
/// a failed run reads as failed instead of succeeding silently.
#[tauri::command]
pub async fn run_sf_json(
    app: tauri::AppHandle,
    args: Vec<String>,
    input: Option<String>,
    run_id: Option<String>,
) -> Result<String, String> {
    blocking(move || {
        let run = RunGuard::begin(run_id);
        let mut command = sf_command()?;
        if !args.is_empty() {
            command.args(&args);
        }
        if let Ok(workspace) = get_workspace(&app) {
            command.current_dir(workspace);
        }

        let output = run_cancellable(command, input, &run)?;
        let json = parse_sf_json(&output)?;

        // `apex execute` carries its own success flag inside a status-0
        // envelope, so the generic envelope check above is not sufficient.
        if json.pointer("/result/success") == Some(&serde_json::Value::Bool(false)) {
            return Err(apex_failure_message(&json));
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    })
    .await
}

/// Readable failure text for an anonymous-Apex run.
fn apex_failure_message(json: &serde_json::Value) -> String {
    let field = |name: &str| {
        json.pointer(&format!("/result/{name}"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    };

    let mut parts: Vec<String> = Vec::new();

    // A compile failure names a line and column; a runtime one has a stack.
    if let Some(problem) = field("compileProblem") {
        let line = json
            .pointer("/result/line")
            .and_then(serde_json::Value::as_i64);
        let column = json
            .pointer("/result/column")
            .and_then(serde_json::Value::as_i64);
        match (line, column) {
            (Some(line), Some(column)) => parts.push(format!(
                "Compile error (line {line}, column {column}): {problem}"
            )),
            _ => parts.push(format!("Compile error: {problem}")),
        }
    }

    if let Some(message) = field("exceptionMessage") {
        parts.push(message.to_string());
    }
    if let Some(stack) = field("exceptionStackTrace") {
        parts.push(stack.to_string());
    }

    if parts.is_empty() {
        "The Apex ran but reported failure.".to_string()
    } else {
        parts.join(
            "
",
        )
    }
}

/// Runs an arbitrary `sf` command, optionally feeding it stdin.
///
/// Runs inside the workspace so project-scoped subcommands (`project deploy`,
/// `project retrieve`) resolve the same `sfdx-project.json` the rest of the app
/// uses — previously they ran against whatever directory the app was launched
/// from.
#[tauri::command]
pub async fn run_command(
    app: tauri::AppHandle,
    args: Vec<String>,
    input: Option<String>,
    run_id: Option<String>,
) -> Result<String, String> {
    blocking(move || {
        let run = RunGuard::begin(run_id);
        let mut command = sf_command()?;
        if !args.is_empty() {
            command.args(&args);
        }
        if let Ok(workspace) = get_workspace(&app) {
            command.current_dir(workspace);
        }

        let output = run_cancellable(command, input, &run)?;
        output_to_string(&output)
    })
    .await
}

/* ─────────────────────────────────────────────────────────────────
Diff Check
───────────────────────────────────────────────────────────────── */

/// One file's comparison between the workspace and the org.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct DiffEntry {
    /// Workspace-relative path, `/` separated. For an org-only file, where it
    /// would sit in the workspace.
    pub path: String,
    /// Where the org's copy sits in the session, when that differs from
    /// `path` (the org's folder layout differs from the workspace's).
    pub org_path: Option<String>,
    /// `changed` | `identical` | `localOnly` | `orgOnly` | `binary`
    pub status: String,
    pub local_lines: u32,
    pub org_lines: u32,
}

/// The result of one Diff Check run.
///
/// Entries carry counts only; contents are fetched per file through
/// `read_diff_pair` so comparing a 200-file folder does not push megabytes
/// across the IPC boundary at once.
#[derive(TS, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct DiffSession {
    /// Names the session to `read_diff_pair`. A number, not a path: passing
    /// the directory itself let a crafted `..` read files outside it.
    pub session_id: String,
    pub target: String,
    pub entries: Vec<DiffEntry>,
    /// Problems the retrieve reported, such as a component the org lacks.
    pub warnings: Vec<String>,
}

fn diff_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(data_dir.join("diff"))
}

/// Removes every previous Diff Check session.
#[tauri::command]
pub async fn clear_diff_sessions(app: tauri::AppHandle) -> Result<(), String> {
    blocking(move || {
        let root = diff_root(&app)?;
        if root.exists() {
            // Best-effort: a locked file must not break the app's startup.
            let _ = fs::remove_dir_all(&root);
        }
        Ok(())
    })
    .await
}

/// Every file under `path`, as `root`-relative strings.
fn files_under(root: &Path, path: &Path, out: &mut Vec<String>) {
    if path.is_file() {
        out.push(to_relative_string(root, path));
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        // The entry's own name: checking the absolute path hid everything
        // when the workspace itself lived under a folder such as `.cache`.
        if is_ignored_path(Path::new(&entry.file_name())) {
            continue;
        }
        files_under(root, &entry.path(), out);
    }
}

/// The package directory `relative` sits in, if any.
fn package_dir_for(package_dirs: &[String], relative: &str) -> Option<String> {
    package_dirs
        .iter()
        .map(|dir| dir.trim_matches('/').replace('\\', "/"))
        .find(|dir| relative == dir || relative.starts_with(&format!("{dir}/")))
}

/// A diff session id: digits only, so it can never name another directory.
fn valid_session_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 32 && id.chars().all(|c| c.is_ascii_digit())
}

/// Whether a generated `package.xml` names any component.
fn manifest_has_types(xml: &str) -> bool {
    xml.contains("<types>")
}

/// One side of a comparison: a relative path and its text (`None` when the
/// file is binary or unreadable).
type DiffSide = Vec<(String, Option<String>)>;

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Pairs the workspace's files with the org's and classifies each pair.
///
/// Files match by path. What is left over is matched by file name when that
/// name is unique on both sides — the org's copy lands in the default
/// `main/default` layout, which a workspace organised differently would
/// otherwise report as every file deleted locally and added in the org.
fn classify_diff(local: DiffSide, org: DiffSide) -> Vec<DiffEntry> {
    let mut org_by_path: BTreeMap<String, Option<String>> = org.into_iter().collect();
    let mut entries = Vec::new();
    let mut unmatched_local: Vec<(String, Option<String>)> = Vec::new();

    let entry = |path: String,
                 org_path: Option<String>,
                 local: Option<&Option<String>>,
                 org: Option<&Option<String>>| {
        let local_text = local.and_then(Option::as_ref);
        let org_text = org.and_then(Option::as_ref);
        // The outer option says whether the file exists on that side; the
        // inner one whether it could be read as text.
        let status = match (local, org) {
            (Some(_), None) => "localOnly",
            (None, Some(_)) => "orgOnly",
            (Some(Some(mine)), Some(Some(theirs))) if mine == theirs => "identical",
            (Some(Some(_)), Some(Some(_))) => "changed",
            _ => "binary",
        };
        DiffEntry {
            path,
            org_path,
            status: status.to_string(),
            local_lines: local_text.map(|text| line_count(text)).unwrap_or(0),
            org_lines: org_text.map(|text| line_count(text)).unwrap_or(0),
        }
    };

    for (path, text) in local {
        match org_by_path.remove(&path) {
            Some(org_text) => entries.push(entry(path, None, Some(&text), Some(&org_text))),
            None => unmatched_local.push((path, text)),
        }
    }

    let unique = |names: Vec<&str>| {
        let mut counts: BTreeMap<String, usize> = BTreeMap::new();
        for name in names {
            *counts.entry(name.to_string()).or_default() += 1;
        }
        counts
    };
    let local_names = unique(unmatched_local.iter().map(|(p, _)| basename(p)).collect());
    let org_names = unique(org_by_path.keys().map(|p| basename(p)).collect());

    for (path, text) in unmatched_local {
        let name = basename(&path).to_string();
        let pairable = local_names.get(&name) == Some(&1) && org_names.get(&name) == Some(&1);
        let org_match = pairable
            .then(|| {
                org_by_path
                    .keys()
                    .find(|org_path| basename(org_path) == name)
                    .cloned()
            })
            .flatten();
        match org_match {
            Some(org_path) => {
                let org_text = org_by_path.remove(&org_path).flatten();
                entries.push(entry(path, Some(org_path), Some(&text), Some(&org_text)));
            }
            None => entries.push(entry(path, None, Some(&text), None)),
        }
    }

    for (path, text) in org_by_path {
        entries.push(entry(path, None, None, Some(&text)));
    }

    entries.sort_by(|a, b| a.path.cmp(&b.path));
    entries
}

/// Text files only: comparing the bytes of a static resource is meaningless.
fn read_text(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    if looks_binary(&bytes) {
        return None;
    }
    String::from_utf8(bytes).ok()
}

fn line_count(text: &str) -> u32 {
    if text.is_empty() {
        0
    } else {
        text.lines().count() as u32
    }
}

/// How long generating the manifest for a Diff Check may take.
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(2 * 60);

/// Creates the empty project a Diff Check retrieves the org's copy into: just
/// the workspace's package directory, so retrieved files land under the same
/// top-level folder.
///
/// The directory itself must exist — the CLI refuses to retrieve into a
/// project whose `sfdx-project.json` names a package directory that is not on
/// disk, which failed every Diff Check.
fn write_session_project(
    session_dir: &Path,
    workspace: &Path,
    package_dir: &str,
) -> Result<(), String> {
    fs::create_dir_all(session_dir.join(package_dir)).map_err(|error| error.to_string())?;

    let mut project = serde_json::json!({
        "packageDirectories": [{ "path": package_dir, "default": true }],
    });
    if let Some(version) = source_api_version(workspace) {
        project["sourceApiVersion"] = serde_json::Value::String(version);
    }
    fs::write(
        session_dir.join("sfdx-project.json"),
        serde_json::to_string_pretty(&project).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    if let Ok(forceignore) = fs::read(workspace.join(".forceignore")) {
        let _ = fs::write(session_dir.join(".forceignore"), forceignore);
    }
    Ok(())
}

/// Compares a workspace file or folder against the org's current version.
///
/// A manifest is generated from the local selection, then retrieved into an
/// empty scratch project whose package directory matches the workspace's.
///
/// This replaced copying the local files into the scratch project and letting
/// a retrieve overwrite them. That approach treated *any* retrieve failure —
/// an expired session, a network error — as "the org has none of this", so
/// every file read as local-only; and a component missing from the org left
/// the local copy in place, so it read as identical.
#[tauri::command]
pub async fn diff_workspace_path(
    app: tauri::AppHandle,
    username: String,
    path: String,
    workspace_id: Option<String>,
    run_id: Option<String>,
) -> Result<DiffSession, String> {
    blocking(move || {
        let run = RunGuard::begin(run_id);
        let workspace = workspace_root(&app, workspace_id.as_deref())?;
        let target = resolve_in_workspace(&workspace, &path)?;
        if !target.exists() {
            return Err(format!("'{path}' no longer exists in the workspace."));
        }
        let relative = to_relative_string(&workspace, &target);

        let package_dir =
            package_dir_for(&package_directories(&workspace), &relative).ok_or_else(|| {
                format!(
                    "Diff Check compares metadata inside a package directory such as \
                     force-app, and '{relative}' is outside them."
                )
            })?;

        let session_id = format!("{}{}", now_millis(), std::process::id());
        let session_dir = diff_root(&app)?.join(&session_id);
        write_session_project(&session_dir, &workspace, &package_dir)?;

        // 1. Which components the selection contains.
        let mut generate = sf_command()?;
        generate.args(["project", "generate", "manifest", "--source-dir", &relative]);
        generate.arg("--output-dir");
        generate.arg(&session_dir);
        generate.args(["--name", "package", "--json"]);
        generate.current_dir(&workspace);
        let output = run_with_limits(generate, None, &run.cancelled, MANIFEST_TIMEOUT)?;
        parse_sf_json(&output).map_err(|error| {
            format!("Could not tell which metadata '{relative}' holds: {error}")
        })?;

        let manifest = session_dir.join("package.xml");
        let xml = fs::read_to_string(&manifest).unwrap_or_default();
        if !manifest_has_types(&xml) {
            return Err(format!(
                "'{relative}' contains no Salesforce metadata to compare."
            ));
        }

        // 2. The org's copy of exactly those components. Failures here are
        //    real errors, reported as such.
        let mut retrieve = sf_command()?;
        retrieve.args(["project", "retrieve", "start", "--manifest"]);
        retrieve.arg(&manifest);
        retrieve.args(["--target-org", &username, "--wait", "20", "--json"]);
        retrieve.current_dir(&session_dir);
        let output = run_with_limits(retrieve, None, &run.cancelled, RETRIEVE_TIMEOUT)?;
        parse_sf_json(&output)?;

        let warnings: Vec<String> = retrieve_warnings(&output.stdout)
            .into_values()
            .flatten()
            .collect();

        // 3. Compare.
        let mut local_paths = Vec::new();
        files_under(&workspace, &target, &mut local_paths);
        let local: DiffSide = local_paths
            .into_iter()
            .map(|file| {
                let text = read_text(&workspace.join(&file));
                (file, text)
            })
            .collect();

        let mut org_paths = Vec::new();
        files_under(
            &session_dir,
            &session_dir.join(&package_dir),
            &mut org_paths,
        );
        let org: DiffSide = org_paths
            .into_iter()
            .map(|file| {
                let text = read_text(&session_dir.join(&file));
                (file, text)
            })
            .collect();

        Ok(DiffSession {
            session_id,
            target: relative,
            entries: classify_diff(local, org),
            warnings,
        })
    })
    .await
}

/// Both sides of one file from a diff session.
#[derive(TS, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct DiffPair {
    pub local: String,
    pub org: String,
}

/// Reads one file's local and org contents from an open diff session.
#[tauri::command]
pub async fn read_diff_pair(
    app: tauri::AppHandle,
    session_id: String,
    path: String,
    org_path: Option<String>,
    workspace_id: Option<String>,
) -> Result<DiffPair, String> {
    blocking(move || {
        let workspace = workspace_root(&app, workspace_id.as_deref())?;

        // The id is digits only and the session always lives in the app's own
        // diff folder, so no request can read outside it.
        if !valid_session_id(&session_id) {
            return Err("Unknown diff session.".to_string());
        }
        let session = diff_root(&app)?.join(&session_id);
        if !session.is_dir() {
            return Err("That diff session has been closed.".to_string());
        }

        let local_path = resolve_in_workspace(&workspace, &path)?;
        let org_path = resolve_in_workspace(&session, org_path.as_deref().unwrap_or(&path))?;

        Ok(DiffPair {
            local: read_text(&local_path).unwrap_or_default(),
            org: read_text(&org_path).unwrap_or_default(),
        })
    })
    .await
}

#[cfg(test)]
mod workspace_registry_tests {
    use super::*;

    /// The v1 document was `{ "workspacePath": "…" }` with no version marker.
    fn migrate_v1(json: serde_json::Value) -> WorkspaceRegistry {
        let mut registry = WorkspaceRegistry {
            version: WORKSPACE_SCHEMA_VERSION,
            ..Default::default()
        };
        if let Some(path) = json
            .get(WORKSPACE_CONFIG_KEY)
            .and_then(serde_json::Value::as_str)
            .filter(|path| !path.is_empty())
        {
            let entry = entry_for(Path::new(path));
            registry.active_id = Some(entry.id.clone());
            registry.workspaces.push(entry);
        }
        registry
    }

    #[test]
    fn v1_path_becomes_a_single_active_entry() {
        let registry = migrate_v1(serde_json::json!({ "workspacePath": "/tmp/acme" }));
        assert_eq!(registry.version, WORKSPACE_SCHEMA_VERSION);
        assert_eq!(registry.workspaces.len(), 1);
        assert_eq!(registry.workspaces[0].name, "acme");
        assert_eq!(registry.active_id, Some(registry.workspaces[0].id.clone()));
    }

    #[test]
    fn v1_without_a_usable_path_migrates_to_an_empty_registry() {
        for document in [
            serde_json::json!({}),
            serde_json::json!({ "workspacePath": "" }),
            serde_json::json!({ "workspacePath": 42 }),
        ] {
            let registry = migrate_v1(document);
            assert!(registry.workspaces.is_empty());
            assert!(registry.active_id.is_none());
        }
    }

    #[test]
    fn ids_are_stable_and_use_forward_slashes() {
        let first = entry_for(Path::new("/tmp/acme"));
        let second = entry_for(Path::new("/tmp/acme"));
        assert_eq!(first.id, second.id, "same folder must dedupe to one id");
        assert!(!first.id.contains('\\'));
        assert!(!first.id.starts_with("//?/"));
    }

    #[test]
    fn a_v2_document_round_trips() {
        let registry = WorkspaceRegistry {
            version: 2,
            active_id: Some("a".into()),
            workspaces: vec![WorkspaceEntry {
                id: "a".into(),
                name: "acme".into(),
                path: "/tmp/acme".into(),
                org_id: Some("00D".into()),
                last_org_id: Some("00D".into()),
                last_retrieved_org_id: None,
                created_at: 123,
            }],
            notice: None,
        };

        let text = serde_json::to_string(&registry).unwrap();
        let parsed: WorkspaceRegistry = serde_json::from_str(&text).unwrap();
        assert_eq!(parsed.active_id, Some("a".into()));
        assert_eq!(parsed.workspaces[0].last_org_id, Some("00D".into()));
        assert_eq!(parsed.workspaces[0].last_retrieved_org_id, None);
    }

    #[test]
    fn v2_last_used_org_becomes_ownership() {
        let mut registry: WorkspaceRegistry = serde_json::from_str(
            r#"{"version":2,"activeId":"a","workspaces":[
                {"id":"a","name":"acme","path":"/tmp/acme","lastOrgId":"00Dxx"}]}"#,
        )
        .unwrap();
        // Mirrors the v2 branch of read_registry.
        for entry in &mut registry.workspaces {
            if entry.org_id.is_none() {
                entry.org_id = entry.last_org_id.clone();
            }
        }
        registry.version = WORKSPACE_SCHEMA_VERSION;

        assert_eq!(registry.version, 3);
        assert_eq!(registry.workspaces[0].org_id, Some("00Dxx".into()));
    }

    #[test]
    fn folder_names_stay_filesystem_safe() {
        assert_eq!(sanitize_folder_name("UAT Sandbox"), "UAT-Sandbox");
        assert_eq!(sanitize_folder_name("me@acme.com.uat"), "me-acme.com.uat");
        assert_eq!(sanitize_folder_name("../../etc"), "etc");
        assert_eq!(sanitize_folder_name("///"), "org");
        assert_eq!(sanitize_folder_name(""), "org");
        assert!(sanitize_folder_name(&"x".repeat(200)).len() <= 48);
    }

    #[test]
    fn an_org_without_a_folder_has_no_owner() {
        let registry = WorkspaceRegistry {
            version: 3,
            active_id: None,
            workspaces: vec![],
            notice: None,
        };
        assert!(!registry
            .workspaces
            .iter()
            .any(|item| item.org_id.as_deref() == Some("00Dxx")));
    }

    #[test]
    fn missing_optional_fields_default_rather_than_failing() {
        // Entries written before lastOrgId existed must still parse.
        let parsed: WorkspaceRegistry = serde_json::from_str(
            r#"{"version":2,"activeId":"a",
                "workspaces":[{"id":"a","name":"acme","path":"/tmp/acme"}]}"#,
        )
        .unwrap();
        assert_eq!(parsed.workspaces[0].last_org_id, None);
        assert_eq!(parsed.workspaces[0].created_at, 0);
    }

    fn side(files: &[(&str, Option<&str>)]) -> DiffSide {
        files
            .iter()
            .map(|(path, text)| (path.to_string(), text.map(str::to_string)))
            .collect()
    }

    fn statuses(entries: &[DiffEntry]) -> Vec<(String, String)> {
        entries
            .iter()
            .map(|entry| (entry.path.clone(), entry.status.clone()))
            .collect()
    }

    #[test]
    fn identical_text_is_not_reported_as_a_change() {
        let entries = classify_diff(
            side(&[("c/A.cls", Some("public class A {}"))]),
            side(&[("c/A.cls", Some("public class A {}"))]),
        );
        assert_eq!(
            statuses(&entries),
            vec![("c/A.cls".into(), "identical".into())]
        );
    }

    #[test]
    fn differing_text_is_a_change() {
        let entries = classify_diff(
            side(&[("c/A.cls", Some("public class A {}"))]),
            side(&[("c/A.cls", Some("public class B {}"))]),
        );
        assert_eq!(entries[0].status, "changed");
        assert_eq!((entries[0].local_lines, entries[0].org_lines), (1, 1));
    }

    #[test]
    fn a_file_the_org_does_not_have_is_local_only() {
        // The scratch project starts empty, so a component missing from the
        // org leaves nothing behind to be mistaken for an identical copy.
        let entries = classify_diff(side(&[("c/New.cls", Some("new"))]), side(&[]));
        assert_eq!(entries[0].status, "localOnly");
    }

    #[test]
    fn a_file_missing_locally_is_org_only() {
        let entries = classify_diff(side(&[]), side(&[("c/Theirs.cls", Some("theirs"))]));
        assert_eq!(entries[0].status, "orgOnly");
    }

    #[test]
    fn unreadable_text_on_a_present_file_is_binary() {
        // Static resources exist on both sides but cannot be compared as text.
        let entries = classify_diff(
            side(&[("r/logo.resource", None), ("r/data.resource", Some("text"))]),
            side(&[("r/logo.resource", None), ("r/data.resource", None)]),
        );
        assert!(entries.iter().all(|entry| entry.status == "binary"));
    }

    #[test]
    fn a_different_folder_layout_pairs_files_by_name() {
        let entries = classify_diff(
            side(&[("force-app/classes/A.cls", Some("local"))]),
            side(&[("force-app/main/default/classes/A.cls", Some("org"))]),
        );
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, "force-app/classes/A.cls");
        assert_eq!(
            entries[0].org_path.as_deref(),
            Some("force-app/main/default/classes/A.cls")
        );
        assert_eq!(entries[0].status, "changed");
    }

    #[test]
    fn ambiguous_names_are_not_paired() {
        let entries = classify_diff(
            side(&[("a/one/Util.cls", Some("1")), ("a/two/Util.cls", Some("2"))]),
            side(&[("b/Util.cls", Some("1"))]),
        );
        assert_eq!(
            entries.iter().filter(|e| e.status == "localOnly").count(),
            2
        );
        assert_eq!(entries.iter().filter(|e| e.status == "orgOnly").count(), 1);
    }

    #[test]
    fn diff_sessions_are_named_by_digits_only() {
        assert!(valid_session_id("17000000000001234"));
        for bad in ["", "..", "123/..", "abc", "12 34", &"1".repeat(40)] {
            assert!(!valid_session_id(bad), "accepted {bad:?}");
        }
    }

    #[test]
    fn a_path_belongs_to_its_package_directory() {
        let dirs = vec!["force-app".to_string(), "packages/core/".to_string()];
        assert_eq!(
            package_dir_for(&dirs, "force-app/main/default/classes/A.cls").as_deref(),
            Some("force-app")
        );
        assert_eq!(
            package_dir_for(&dirs, "packages/core").as_deref(),
            Some("packages/core")
        );
        assert_eq!(package_dir_for(&dirs, "force-apple/x.cls"), None);
        assert_eq!(package_dir_for(&dirs, "README.md"), None);
    }

    #[test]
    fn the_diff_session_project_has_its_package_directory_on_disk() {
        let base = std::env::temp_dir().join(format!("forgesf-session-{}", next_temp_suffix()));
        let workspace = base.join("workspace");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(
            workspace.join("sfdx-project.json"),
            r#"{"packageDirectories":[{"path":"packages/core","default":true}],"sourceApiVersion":"62.0"}"#,
        )
        .unwrap();
        fs::write(workspace.join(".forceignore"), "**/jsconfig.json\n").unwrap();

        let session = base.join("session");
        write_session_project(&session, &workspace, "packages/core").unwrap();

        // The CLI refuses to retrieve into a project whose package directory
        // is missing.
        assert!(session.join("packages/core").is_dir());
        assert_eq!(package_directories(&session), vec!["packages/core"]);
        assert_eq!(source_api_version(&session).as_deref(), Some("62.0"));
        assert!(session.join(".forceignore").is_file());

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn the_cli_version_decides_support() {
        let current = cli_info_from(Ok(
            "@salesforce/cli/2.150.6 win32-x64 node-v24.19.0\n".to_string()
        ));
        assert!(current.found && current.supported);
        assert_eq!(current.version.as_deref(), Some("2.150.6"));

        let old = cli_info_from(Ok(
            "@salesforce/cli/1.86.0 darwin-arm64 node-v18".to_string()
        ));
        assert!(old.found && !old.supported);
        assert!(old.message.unwrap().contains("too old"));

        let foreign = cli_info_from(Ok("sfdx-cli/7.209.6 win32-x64".to_string()));
        assert!(foreign.found && !foreign.supported);

        let missing = cli_info_from(Err("Could not find the 'sf' Salesforce CLI.".to_string()));
        assert!(!missing.found && !missing.supported);
    }

    #[test]
    fn an_empty_manifest_has_nothing_to_compare() {
        assert!(!manifest_has_types(
            "<Package><version>65.0</version></Package>"
        ));
        assert!(manifest_has_types(
            "<Package><types><members>A</members><name>ApexClass</name></types></Package>"
        ));
    }

    #[test]
    fn line_counts_treat_empty_as_zero() {
        assert_eq!(line_count(""), 0);
        assert_eq!(line_count("a"), 1);
        assert_eq!(
            line_count(
                "a
b
c"
            ),
            3
        );
    }

    /// A throwaway workspace containing `classes/A.cls`.
    fn scratch_workspace(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("forgesf-test-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("classes")).unwrap();
        fs::write(root.join("classes/A.cls"), "public class A {}").unwrap();
        root
    }

    #[test]
    fn a_single_file_resolves_to_a_relative_path() {
        let root = scratch_workspace("single");
        assert_eq!(
            resolve_paths(&root, &["classes/A.cls".to_string()]).unwrap(),
            vec!["classes/A.cls".to_string()]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_folder_resolves_too() {
        let root = scratch_workspace("folder");
        assert_eq!(
            resolve_paths(&root, &["classes".to_string()]).unwrap(),
            vec!["classes".to_string()]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn several_selections_all_resolve() {
        let root = scratch_workspace("several");
        let resolved =
            resolve_paths(&root, &["classes".to_string(), "classes/A.cls".to_string()]).unwrap();
        assert_eq!(resolved.len(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn an_empty_selection_is_rejected() {
        let root = scratch_workspace("empty");
        assert!(resolve_paths(&root, &[]).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_missing_path_is_rejected_before_the_cli_runs() {
        let root = scratch_workspace("missing");
        assert!(resolve_paths(&root, &["classes/Nope.cls".to_string()]).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_path_escaping_the_workspace_is_rejected() {
        // Per-file actions must not be aimed outside the active org's folder.
        let root = scratch_workspace("escape");
        assert!(resolve_paths(&root, &["../../secrets.txt".to_string()]).is_err());
        assert!(resolve_paths(&root, &["/etc/passwd".to_string()]).is_err());
        let _ = fs::remove_dir_all(&root);
    }

    /// `sf apex execute --json` reports a runtime throw inside a status-0
    /// envelope, so exit code alone says the run succeeded.
    #[test]
    fn a_runtime_exception_is_reported_with_its_stack() {
        let json = serde_json::json!({
            "status": 0,
            "result": {
                "success": false,
                "compiled": true,
                "compileProblem": "",
                "exceptionMessage": "System.MathException: Divide by 0",
                "exceptionStackTrace": "AnonymousBlock: line 1, column 1"
            }
        });
        let message = apex_failure_message(&json);
        assert!(message.contains("Divide by 0"));
        assert!(message.contains("line 1, column 1"));
    }

    #[test]
    fn a_compile_error_names_the_line_and_column() {
        let json = serde_json::json!({
            "status": 0,
            "result": {
                "success": false,
                "compiled": false,
                "compileProblem": "Unexpected token ')'",
                "line": 3,
                "column": 17
            }
        });
        let message = apex_failure_message(&json);
        assert!(message.contains("line 3"));
        assert!(message.contains("column 17"));
        assert!(message.contains("Unexpected token"));
    }

    #[test]
    fn a_compile_error_without_a_position_still_reports_the_problem() {
        let json = serde_json::json!({
            "status": 0,
            "result": { "success": false, "compileProblem": "Something broke" }
        });
        assert!(apex_failure_message(&json).contains("Something broke"));
    }

    #[test]
    fn empty_detail_falls_back_to_a_generic_message() {
        // Blank strings are the CLI's "not applicable", not real content.
        let json = serde_json::json!({
            "status": 0,
            "result": {
                "success": false,
                "compileProblem": "",
                "exceptionMessage": "",
                "exceptionStackTrace": ""
            }
        });
        assert_eq!(
            apex_failure_message(&json),
            "The Apex ran but reported failure."
        );
    }
}

#[cfg(test)]
mod reliability_tests {
    use super::*;

    /// A fresh, empty directory under the OS temp dir.
    fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("forgesf-rel-{name}-{}", next_temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// A command that prints `path`'s contents to stdout.
    fn print_file(path: &Path) -> Command {
        if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.arg("/C").arg("type").arg(path);
            command
        } else {
            let mut command = Command::new("cat");
            command.arg(path);
            command
        }
    }

    /// A command that runs for about 30 seconds, via a shell so it has a child.
    fn long_running() -> Command {
        if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.args(["/C", "ping -n 30 127.0.0.1 >NUL"]);
            command
        } else {
            let mut command = Command::new("sh");
            command.args(["-c", "sleep 30"]);
            command
        }
    }

    /* ── CLI runner ─────────────────────────────────────────────── */

    #[test]
    fn the_runner_drains_output_larger_than_a_pipe_buffer() {
        // Several MB: far beyond any OS pipe buffer. Before the fix the child
        // blocked writing and the run only ended at the timeout.
        let dir = scratch_dir("big-output");
        let file = dir.join("big.txt");
        let line = "0123456789abcdefghijklmnopqrstuvwxyz\n";
        fs::write(&file, line.repeat(80_000)).unwrap();

        let started = Instant::now();
        let output = run_with_limits(
            print_file(&file),
            None,
            &AtomicBool::new(false),
            Duration::from_secs(60),
        )
        .expect("the command should complete");

        assert!(output.status.success());
        assert!(output.stdout.len() >= line.len() * 80_000);
        assert!(started.elapsed() < Duration::from_secs(30));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cancelled_run_stops_promptly() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&cancelled);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            flag.store(true, Ordering::SeqCst);
        });

        let started = Instant::now();
        let result = run_with_limits(long_running(), None, &cancelled, Duration::from_secs(60));

        assert_eq!(result.unwrap_err(), "Cancelled.");
        assert!(started.elapsed() < Duration::from_secs(15));
    }

    #[test]
    fn a_run_past_its_timeout_is_stopped() {
        let started = Instant::now();
        let result = run_with_limits(
            long_running(),
            None,
            &AtomicBool::new(false),
            Duration::from_millis(500),
        );

        assert!(result.unwrap_err().contains("still running"));
        assert!(started.elapsed() < Duration::from_secs(15));
    }

    #[test]
    fn a_cancel_that_arrives_before_the_run_starts_is_honoured() {
        let id = format!("early-{}", next_temp_suffix());
        cancel_sf_command(id.clone());

        let run = RunGuard::begin(Some(id.clone()));
        assert!(run.cancelled.load(Ordering::SeqCst));
        assert_eq!(
            run_with_limits(
                long_running(),
                None,
                &run.cancelled,
                Duration::from_secs(60)
            )
            .unwrap_err(),
            "Cancelled."
        );

        drop(run);
        assert!(!lock(run_table()).contains_key(&id));
    }

    #[test]
    fn cancelling_one_run_leaves_another_running() {
        let first = RunGuard::begin(Some(format!("one-{}", next_temp_suffix())));
        let second = RunGuard::begin(Some(format!("two-{}", next_temp_suffix())));

        cancel_sf_command(first.id.clone());

        assert!(first.cancelled.load(Ordering::SeqCst));
        assert!(!second.cancelled.load(Ordering::SeqCst));
    }

    #[test]
    fn a_temp_file_is_removed_when_dropped() {
        let file = TempFile::create("soql", "SELECT Id\nFROM Account").unwrap();
        let path = file.path().to_path_buf();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "SELECT Id\nFROM Account"
        );
        drop(file);
        assert!(!path.exists());
    }

    /* ── Registry storage ───────────────────────────────────────── */

    fn entry_named(name: &str) -> WorkspaceEntry {
        WorkspaceEntry {
            id: name.to_string(),
            name: name.to_string(),
            path: format!("/tmp/{name}"),
            org_id: None,
            last_org_id: None,
            last_retrieved_org_id: None,
            created_at: 0,
        }
    }

    #[test]
    fn concurrent_registry_updates_do_not_lose_entries() {
        let dir = scratch_dir("registry-concurrent");
        let path = dir.join(WORKSPACE_CONFIG_FILE);

        let handles: Vec<_> = (0..16)
            .map(|index| {
                let path = path.clone();
                std::thread::spawn(move || {
                    update_registry_at(&path, |registry| {
                        registry
                            .workspaces
                            .push(entry_named(&format!("ws-{index}")));
                        Ok(((), true))
                    })
                    .unwrap();
                })
            })
            .collect();
        for handle in handles {
            handle.join().unwrap();
        }

        let registry = update_registry_at(&path, |registry| Ok((registry.clone(), false))).unwrap();
        assert_eq!(registry.workspaces.len(), 16);
        let _ = fs::remove_dir_all(&dir);
    }

    /// Tests that produce a registry notice share `REGISTRY_NOTICE`; running
    /// them one at a time keeps one test from taking the other's notice.
    static NOTICE_TESTS: Mutex<()> = Mutex::new(());

    fn corrupt_backups(dir: &Path) -> Vec<PathBuf> {
        fs::read_dir(dir)
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| path.to_string_lossy().contains(".corrupt-"))
            .collect()
    }

    #[test]
    fn an_unparseable_registry_is_backed_up_not_overwritten() {
        let _serial = lock(&NOTICE_TESTS);
        let _ = lock(&REGISTRY_NOTICE).take();
        let dir = scratch_dir("registry-corrupt");
        let path = dir.join(WORKSPACE_CONFIG_FILE);
        fs::write(&path, "{ this is not json").unwrap();

        let registry = update_registry_at(&path, |registry| {
            registry.workspaces.push(entry_named("fresh"));
            Ok((registry.clone(), true))
        })
        .unwrap();

        // A new list was started…
        assert_eq!(registry.workspaces.len(), 1);
        // …and the original survives, byte for byte.
        let backups = corrupt_backups(&dir);
        assert_eq!(backups.len(), 1);
        assert_eq!(
            fs::read_to_string(&backups[0]).unwrap(),
            "{ this is not json"
        );
        // The user is told once.
        assert!(lock(&REGISTRY_NOTICE)
            .take()
            .is_some_and(|notice| notice.contains("could not be read")));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_registry_from_a_newer_version_is_preserved() {
        let _serial = lock(&NOTICE_TESTS);
        let dir = scratch_dir("registry-newer");
        let path = dir.join(WORKSPACE_CONFIG_FILE);
        let original = r#"{"version":99,"workspaces":[{"shape":"unknown"}]}"#;
        fs::write(&path, original).unwrap();

        let _guard = lock(&REGISTRY_LOCK);
        let registry = read_registry_file(&path).unwrap();
        drop(_guard);

        assert!(registry.workspaces.is_empty());
        let backups = corrupt_backups(&dir);
        assert_eq!(fs::read_to_string(&backups[0]).unwrap(), original);
        let _ = lock(&REGISTRY_NOTICE).take();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_registry_is_simply_empty() {
        let dir = scratch_dir("registry-missing");
        let _guard = lock(&REGISTRY_LOCK);
        let registry = read_registry_file(&dir.join(WORKSPACE_CONFIG_FILE)).unwrap();
        assert!(registry.workspaces.is_empty());
        assert!(corrupt_backups(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stored_registry_carries_no_notice_field() {
        // Even a registry holding a notice is stored in exactly the v3 shape
        // older builds expect.
        let dir = scratch_dir("registry-notice");
        let path = dir.join(WORKSPACE_CONFIG_FILE);
        let mut registry = empty_registry();
        registry.notice = Some("shown once".to_string());

        write_registry_file(&path, &registry).unwrap();
        assert!(!fs::read_to_string(&path).unwrap().contains("notice"));
        let _ = fs::remove_dir_all(&dir);
    }

    /* ── File IO ────────────────────────────────────────────────── */

    #[test]
    fn an_atomic_write_replaces_the_content_and_leaves_no_temp_file() {
        let dir = scratch_dir("atomic");
        let path = dir.join("Foo.cls");
        fs::write(&path, "old").unwrap();

        write_atomic(&path, b"public class Foo {}").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "public class Foo {}");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name() != "Foo.cls")
            .collect();
        assert!(
            leftovers.is_empty(),
            "temp files left behind: {leftovers:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_atomic_write_creates_missing_parent_folders() {
        let dir = scratch_dir("atomic-parents");
        let path = dir.join("force-app/main/default/classes/Bar.cls");
        write_atomic(&path, b"public class Bar {}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "public class Bar {}");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_editor_reads_utf8_text() {
        let dir = scratch_dir("read-text");
        let path = dir.join("Foo.cls");
        fs::write(&path, "// Grüße\npublic class Foo {}").unwrap();
        assert_eq!(
            read_editor_text(&path).unwrap(),
            "// Grüße\npublic class Foo {}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_editor_refuses_binary_invalid_missing_and_huge_files() {
        let dir = scratch_dir("read-refuse");

        let binary = dir.join("logo.resource");
        fs::write(&binary, [0x89, b'P', b'N', b'G', 0, 0, 0, 13]).unwrap();
        assert!(read_editor_text(&binary).unwrap_err().contains("binary"));

        let latin1 = dir.join("legacy.txt");
        fs::write(&latin1, [b'c', b'a', b'f', 0xE9]).unwrap();
        assert!(read_editor_text(&latin1).unwrap_err().contains("UTF-8"));

        assert!(read_editor_text(&dir.join("gone.cls"))
            .unwrap_err()
            .contains("no longer exists"));

        let huge = dir.join("huge.json");
        fs::File::create(&huge)
            .unwrap()
            .set_len(MAX_EDITOR_FILE_BYTES + 1)
            .unwrap();
        assert!(read_editor_text(&huge).unwrap_err().contains("larger than"));

        assert!(read_editor_text(&dir).unwrap_err().contains("folder"));
        let _ = fs::remove_dir_all(&dir);
    }

    /* ── Retrieve manifests ─────────────────────────────────────── */

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
}

#[cfg(test)]
mod integrity_tests {
    use super::*;

    /* ── Workspace resolution by id ─────────────────────────────── */

    fn registry_with(id: &str, path: &Path) -> WorkspaceRegistry {
        WorkspaceRegistry {
            version: WORKSPACE_SCHEMA_VERSION,
            active_id: Some("someone-else".to_string()),
            workspaces: vec![WorkspaceEntry {
                id: id.to_string(),
                name: id.to_string(),
                path: path.to_string_lossy().to_string(),
                org_id: Some("00DA".to_string()),
                last_org_id: None,
                last_retrieved_org_id: None,
                created_at: 0,
            }],
            notice: None,
        }
    }

    #[test]
    fn a_request_resolves_the_workspace_it_names_not_the_active_one() {
        let dir = std::env::temp_dir().join(format!("forgesf-int-ws-{}", next_temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let registry = registry_with("org-a", &dir);

        assert_eq!(registered_workspace_path(&registry, "org-a").unwrap(), dir);
        assert!(registered_workspace_path(&registry, "org-b")
            .unwrap_err()
            .contains("no longer registered"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_named_workspace_whose_folder_is_gone_is_an_error_not_a_fallback() {
        let missing = std::env::temp_dir().join(format!("forgesf-int-gone-{}", next_temp_suffix()));
        let registry = registry_with("org-a", &missing);
        assert!(registered_workspace_path(&registry, "org-a")
            .unwrap_err()
            .contains("no longer exists"));
    }

    /* ── Retrieve warnings ──────────────────────────────────────── */

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

    /* ── Login options ──────────────────────────────────────────── */

    #[test]
    fn login_urls_are_normalised_to_https() {
        assert_eq!(
            login_instance_url("https://test.salesforce.com/").unwrap(),
            "https://test.salesforce.com"
        );
        assert_eq!(
            login_instance_url("acme.my.salesforce.com").unwrap(),
            "https://acme.my.salesforce.com"
        );
        assert_eq!(
            login_instance_url("https://acme--uat.sandbox.my.salesforce.com:443").unwrap(),
            "https://acme--uat.sandbox.my.salesforce.com:443"
        );
    }

    #[test]
    fn unsafe_or_malformed_login_urls_are_rejected() {
        for bad in [
            "",
            "http://login.salesforce.com",
            "https://",
            "localhost",
            "https://evil.com\" --jwt-key-file x",
            "https://a.com:port",
            "https://a.com/path?query=1",
        ] {
            assert!(login_instance_url(bad).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn aliases_are_restricted_to_safe_characters() {
        assert_eq!(login_alias(" uat-sandbox ").unwrap(), "uat-sandbox");
        assert!(login_alias("me@acme.com").is_ok());
        for bad in [
            "",
            "two words",
            "--set-default",
            "semi;colon",
            &"x".repeat(81),
        ] {
            assert!(login_alias(bad).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn login_arguments_include_only_the_chosen_options() {
        assert_eq!(
            login_args(None, None, false).unwrap(),
            vec!["org", "login", "web", "--json"]
        );
        assert_eq!(
            login_args(Some("test.salesforce.com"), Some("uat"), true).unwrap(),
            vec![
                "org",
                "login",
                "web",
                "--json",
                "--instance-url",
                "https://test.salesforce.com",
                "--alias",
                "uat",
                "--set-default"
            ]
        );
        assert!(login_args(Some("http://x.com"), None, false).is_err());
    }

    /* ── In-folder metadata ─────────────────────────────────────── */

    #[test]
    fn in_folder_types_map_to_their_folder_types() {
        assert_eq!(folder_type_for("Report"), Some("ReportFolder"));
        assert_eq!(folder_type_for("EmailTemplate"), Some("EmailFolder"));
        assert_eq!(folder_type_for("ApexClass"), None);
        assert!(implicit_folders_for("Report").contains(&"unfiled$public"));
        assert!(implicit_folders_for("Dashboard").is_empty());
    }
}
