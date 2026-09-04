use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;

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
fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut Command) {}

/// Builds a `Command` for the resolved `sf` executable.
fn sf_command() -> Result<Command, String> {
    let mut command = Command::new(find_sf_executable()?);
    hide_console(&mut command);
    Ok(command)
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
async fn blocking<T, F>(task: F) -> Result<T, String>
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
fn sf_plain_error(output: &std::process::Output) -> String {
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
fn sf_error_message(json: &serde_json::Value, output: &std::process::Output) -> String {
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
fn parse_sf_json(output: &std::process::Output) -> Result<serde_json::Value, String> {
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
}

const WORKSPACE_SCHEMA_VERSION: u32 = 3;

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
fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Reads the registry, upgrading the v1 single-path document on the way.
///
/// v1 was `{ "workspacePath": "…" }` with no version marker; it becomes a single
/// entry named after its folder, marked active.
fn read_registry(app: &tauri::AppHandle) -> Result<WorkspaceRegistry, String> {
    let config_path = workspace_config_path(app)?;
    if !config_path.exists() {
        return Ok(WorkspaceRegistry {
            version: WORKSPACE_SCHEMA_VERSION,
            ..Default::default()
        });
    }

    let raw = fs::read_to_string(&config_path).map_err(|error| error.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&raw).unwrap_or_default();

    match json.get("version").and_then(serde_json::Value::as_u64) {
        Some(3) => return serde_json::from_value(json).map_err(|error| error.to_string()),
        Some(2) => {
            // v2 tracked only which org a folder was *last used with*. Under the
            // per-org model that association becomes ownership, so an existing
            // project stays bound to the org it was already being used with.
            let mut registry: WorkspaceRegistry =
                serde_json::from_value(json).map_err(|error| error.to_string())?;
            for entry in &mut registry.workspaces {
                if entry.org_id.is_none() {
                    entry.org_id = entry.last_org_id.clone();
                }
            }
            registry.version = WORKSPACE_SCHEMA_VERSION;
            return Ok(registry);
        }
        _ => {}
    }

    // v1 (or unrecognised): salvage the single path if there is one.
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
    Ok(registry)
}

fn write_registry(app: &tauri::AppHandle, registry: &WorkspaceRegistry) -> Result<(), String> {
    let json = serde_json::to_string_pretty(registry).map_err(|error| error.to_string())?;
    fs::write(workspace_config_path(app)?, json).map_err(|error| error.to_string())
}

/// The active entry's path, when it still exists on disk.
fn read_configured_workspace(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let registry = read_registry(app)?;
    let Some(active_id) = registry.active_id else {
        return Ok(None);
    };

    Ok(registry
        .workspaces
        .into_iter()
        .find(|entry| entry.id == active_id)
        .map(|entry| PathBuf::from(entry.path))
        // A folder deleted or moved underneath us falls through to the next
        // resolution step rather than failing every workspace command.
        .filter(|path| path.exists() && path.is_dir()))
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
    if let Some(configured) = read_configured_workspace(app)? {
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
fn resolve_in_workspace(root: &Path, relative: &str) -> Result<PathBuf, String> {
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
fn is_ignored_path(path: &Path) -> bool {
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
fn to_relative_string(root: &Path, path: &Path) -> String {
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
    entries
        .flatten()
        .any(|entry| !is_ignored_path(&entry.path()))
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

        if is_ignored_path(&entry_path) {
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
fn collect_orgs() -> Result<Vec<Organization>, String> {
    let output = run_sf(["org", "list", "--json"])?;
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
pub async fn list_orgs() -> Result<Vec<Organization>, String> {
    blocking(collect_orgs).await
}

#[tauri::command]
pub async fn connect_salesforce() -> Result<Organization, String> {
    blocking(|| {
        let login = run_sf(["org", "login", "web", "--json"])?;
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
        if let Ok(orgs) = collect_orgs() {
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
        let output = run_sf(["config", "set", "target-org", &username])?;
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

#[tauri::command]
pub async fn list_metadata_components(
    metadata_type: String,
    username: String,
) -> Result<Vec<String>, String> {
    blocking(move || {
        let output = run_sf([
            "org",
            "list",
            "metadata",
            "--metadata-type",
            &metadata_type,
            "--target-org",
            &username,
            "--json",
        ])?;
        let json = parse_sf_json(&output)?;

        // A type with no components is an empty list, not an error: the CLI
        // returns a null result for types the org has none of.
        let Some(members) = json["result"].as_array() else {
            return Ok(Vec::new());
        };

        Ok(members
            .iter()
            .filter_map(|member| member["fullName"].as_str().map(|name| name.to_string()))
            .collect())
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
    pub status: String, // "completed" | "failed"
    pub retrieved: u32,
    pub message: Option<String>,
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
        if let Some(kind) = file.get("type").and_then(serde_json::Value::as_str) {
            *counts.entry(kind.to_string()).or_insert(0) += 1;
        }
    }
    counts
}

/// Set by `cancel_retrieve`, checked between batches.
///
/// A retrieval could previously not be stopped at all: selecting every
/// metadata type committed the user to hundreds of sequential CLI invocations
/// with no way out short of killing the app.
static RETRIEVE_CANCELLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Requests cancellation of an in-flight retrieve.
#[tauri::command]
pub fn cancel_retrieve() {
    RETRIEVE_CANCELLED.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// Metadata types retrieved per `sf` invocation.
///
/// One invocation per type meant a 200-type selection paid 200 Node.js
/// start-ups, each waiting up to 20 minutes. Batching keeps per-type reporting
/// (via `files_by_type`) while cutting the process count by an order of
/// magnitude; a failed batch is retried type-by-type to isolate the culprit.
const RETRIEVE_BATCH_SIZE: usize = 10;

/// Retrieves any number of members in a single `sf` invocation and reports how
/// many files were written per metadata type.
fn retrieve_members(
    workspace: &Path,
    username: &str,
    members: &[String],
) -> Result<std::collections::HashMap<String, u32>, String> {
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
    for member in members {
        command.arg("--metadata");
        command.arg(member);
    }
    command.current_dir(workspace);

    let output = command.output().map_err(|error| error.to_string())?;
    parse_sf_json(&output)?;
    Ok(files_by_type(&output.stdout))
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
) -> Result<RetrieveResult, String> {
    // The loop below runs one `sf` process per metadata type, each waiting up
    // to 20 minutes. Doing that inline in an async command starved Tauri's
    // shared async runtime for the whole retrieval.
    blocking(move || retrieve_metadata_blocking(app, username, metadata)).await
}

fn retrieve_metadata_blocking(
    app: tauri::AppHandle,
    username: String,
    metadata: Vec<String>,
) -> Result<RetrieveResult, String> {
    let workspace = get_workspace(&app)?;

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

    let record = |kind: &str,
                  outcome: Result<u32, String>,
                  succeeded: &mut u32,
                  failed: &mut u32,
                  items: &mut Vec<RetrieveResultItem>|
     -> Result<(), String> {
        match outcome {
            Ok(retrieved) => {
                *succeeded += 1;
                items.push(RetrieveResultItem {
                    kind: kind.to_string(),
                    status: "completed".to_string(),
                    message: Some(format!("{retrieved} item(s) retrieved")),
                    retrieved,
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

        match retrieve_members(&workspace, &username, &members) {
            Ok(counts) => {
                for &position in &batch {
                    let kind = &order[position];
                    let retrieved = counts.get(kind).copied().unwrap_or(0);
                    record(kind, Ok(retrieved), &mut succeeded, &mut failed, &mut items)?;
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
                    let outcome = retrieve_members(&workspace, &username, &groups[position])
                        .map(|counts| counts.get(kind).copied().unwrap_or(0))
                        .map_err(|error| format!("{kind}: {error}"));
                    record(kind, outcome, &mut succeeded, &mut failed, &mut items)?;
                }
            }
        }
    }

    let was_cancelled = cancelled();
    let success = failed == 0 && !was_cancelled;
    let skipped = total.saturating_sub(items.len());
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
    })
}

/// Outcome of a deploy or validation, including the job id a validation
/// produces so a later quick-deploy can reuse the work instead of re-running it.
#[derive(TS, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct DeployOutcome {
    pub job_id: Option<String>,
    pub status: String,
    pub summary: String,
    pub check_only: bool,
}

fn deploy_outcome(stdout: &[u8], check_only: bool) -> DeployOutcome {
    let json: serde_json::Value = serde_json::from_slice(stdout).unwrap_or_default();
    DeployOutcome {
        job_id: json
            .pointer("/result/id")
            .and_then(serde_json::Value::as_str)
            .map(|id| id.to_string()),
        status: json
            .pointer("/result/status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("Succeeded")
            .to_string(),
        summary: summarize_sf_json(stdout),
        check_only,
    }
}

/// Reads `packageDirectories[].path` from the project manifest.
///
/// Deploys hardcoded `force-app`, so a project laid out any other way — `src`,
/// `main`, or a multi-package repo — could not be deployed at all.
fn package_directories(workspace: &Path) -> Vec<String> {
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

/// Adds either an explicit metadata selection or every package directory.
fn add_deploy_scope(command: &mut Command, workspace: &Path, metadata: &[String]) {
    if metadata.is_empty() {
        for path in package_directories(workspace) {
            command.arg("--source-dir");
            command.arg(path);
        }
        return;
    }
    for entry in metadata {
        command.arg("--metadata");
        command.arg(entry);
    }
}

/// Validates a caller-supplied list of workspace-relative paths.
///
/// Every path goes through `resolve_in_workspace`, so a per-file action cannot
/// be pointed outside the active org's workspace.
fn resolve_paths(root: &Path, paths: &[String]) -> Result<Vec<String>, String> {
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

/// Deploys specific files or folders rather than the whole package directory.
///
/// `sf project deploy start --source-dir` accepts a file or a directory, so the
/// same flag covers "deploy this class" and "deploy this folder".
#[tauri::command]
pub async fn deploy_paths(
    app: tauri::AppHandle,
    username: String,
    paths: Vec<String>,
) -> Result<DeployOutcome, String> {
    blocking(move || {
        let workspace = get_workspace(&app)?;
        let targets = resolve_paths(&workspace, &paths)?;

        let mut command = sf_command()?;
        command.args([
            "project",
            "deploy",
            "start",
            "--target-org",
            &username,
            "--wait",
            "10",
        ]);
        for target in &targets {
            command.arg("--source-dir");
            command.arg(target);
        }
        command.arg("--json");
        command.current_dir(&workspace);

        let output = command.output().map_err(|error| error.to_string())?;
        parse_sf_json(&output)?;
        Ok(deploy_outcome(&output.stdout, false))
    })
    .await
}

/// Retrieves specific files or folders from the org into the workspace.
#[tauri::command]
pub async fn retrieve_paths(
    app: tauri::AppHandle,
    username: String,
    paths: Vec<String>,
) -> Result<String, String> {
    blocking(move || {
        let workspace = get_workspace(&app)?;
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

        let output = command.output().map_err(|error| error.to_string())?;
        parse_sf_json(&output)?;
        Ok(summarize_sf_json(&output.stdout))
    })
    .await
}

/// Deploys the local workspace to `username`.
///
/// `check_only` runs `project deploy validate`, which registers a validated
/// deployment server-side and returns its job id — feed that to `deploy_quick`
/// to promote it without re-uploading and re-testing everything. `metadata`
/// scopes the deploy to specific components; empty means the whole package
/// directory.
#[tauri::command]
pub async fn deploy_workspace(
    app: tauri::AppHandle,
    username: String,
    check_only: bool,
    metadata: Option<Vec<String>>,
) -> Result<DeployOutcome, String> {
    blocking(move || {
        let workspace = get_workspace(&app)?;
        let scope = metadata.unwrap_or_default();

        let mut command = sf_command()?;
        command.args([
            "project",
            "deploy",
            if check_only { "validate" } else { "start" },
            "--target-org",
            &username,
            "--wait",
            "10",
        ]);
        add_deploy_scope(&mut command, &workspace, &scope);
        command.arg("--json");
        command.current_dir(&workspace);

        let output = command.output().map_err(|error| error.to_string())?;
        parse_sf_json(&output)?;
        Ok(deploy_outcome(&output.stdout, check_only))
    })
    .await
}

/// Promotes a previously validated deployment. This is what makes the
/// pipeline's Validate step meaningful: without it the deploy step re-uploaded
/// and re-ran everything the validation had just done.
#[tauri::command]
pub async fn deploy_quick(
    app: tauri::AppHandle,
    username: String,
    job_id: String,
) -> Result<DeployOutcome, String> {
    blocking(move || {
        let workspace = get_workspace(&app)?;

        let mut command = sf_command()?;
        command.args([
            "project",
            "deploy",
            "quick",
            "--target-org",
            &username,
            "--job-id",
            &job_id,
            "--wait",
            "10",
            "--json",
        ]);
        command.current_dir(&workspace);

        let output = command.output().map_err(|error| error.to_string())?;
        parse_sf_json(&output)?;
        Ok(deploy_outcome(&output.stdout, false))
    })
    .await
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Workspace commands
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

#[tauri::command]
pub async fn get_workspace_root(app: tauri::AppHandle) -> Result<String, String> {
    blocking(move || Ok(get_workspace(&app)?.to_string_lossy().to_string())).await
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
        let mut registry = read_registry(&app)?;
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
            let resolved = get_workspace(&app)?;
            let id = workspace_id(&resolved);

            if !registry.workspaces.iter().any(|item| item.id == id) {
                let mut entry = entry_for(&resolved);
                entry.created_at = now_millis();
                registry.workspaces.push(entry);
            }
            registry.active_id = Some(id);
            changed = true;
        }

        if changed {
            write_registry(&app, &registry)?;
        }
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

        let mut registry = read_registry(&app)?;
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
        write_registry(&app, &registry)?;
        Ok(active)
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
        let mut registry = read_registry(&app)?;

        // Already bound: just activate it.
        if let Some(existing) = registry
            .workspaces
            .iter()
            .find(|item| item.org_id.as_deref() == Some(org_id.as_str()))
            .cloned()
        {
            // A folder deleted underneath us is recreated rather than leaving
            // every workspace command failing.
            ensure_sfdx_project(Path::new(&existing.path))?;
            registry.active_id = Some(existing.id.clone());
            write_registry(&app, &registry)?;
            return Ok(existing);
        }

        let root = org_workspaces_root(&app)?;
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
        entry.last_org_id = Some(org_id);
        entry.created_at = now_millis();

        registry.active_id = Some(entry.id.clone());
        registry.workspaces.push(entry.clone());
        write_registry(&app, &registry)?;
        Ok(entry)
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
        let mut registry = read_registry(&app)?;

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
        write_registry(&app, &registry)?;
        Ok(registry)
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
        let mut registry = read_registry(&app)?;
        let entry = registry
            .workspaces
            .iter()
            .find(|item| item.id == id)
            .cloned()
            .ok_or_else(|| "That workspace is no longer registered.".to_string())?;

        registry.active_id = Some(entry.id.clone());
        write_registry(&app, &registry)?;
        Ok(entry)
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
        let mut registry = read_registry(&app)?;
        registry.workspaces.retain(|item| item.id != id);

        // Removing the active project promotes the next one, if any.
        if registry.active_id.as_deref() == Some(id.as_str()) {
            registry.active_id = registry.workspaces.first().map(|item| item.id.clone());
        }

        write_registry(&app, &registry)?;
        Ok(registry)
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

        let mut registry = read_registry(&app)?;
        let entry = registry
            .workspaces
            .iter_mut()
            .find(|item| item.id == id)
            .ok_or_else(|| "That workspace is no longer registered.".to_string())?;
        entry.name = trimmed;

        write_registry(&app, &registry)?;
        Ok(registry)
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
        let mut registry = read_registry(&app)?;
        if let Some(entry) = registry.workspaces.iter_mut().find(|item| item.id == id) {
            entry.last_org_id = org_id;
            write_registry(&app, &registry)?;
        }
        Ok(())
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
        let mut registry = read_registry(&app)?;
        if let Some(entry) = registry.workspaces.iter_mut().find(|item| item.id == id) {
            entry.last_retrieved_org_id = Some(org_id);
            write_registry(&app, &registry)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn read_workspace(
    app: tauri::AppHandle,
    path: String,
    depth: Option<usize>,
) -> Result<Vec<FileNode>, String> {
    blocking(move || {
        let root = get_workspace(&app)?;
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

#[tauri::command]
pub async fn read_workspace_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    blocking(move || {
        let root = get_workspace(&app)?;
        let full_path = resolve_in_workspace(&root, &path)?;
        fs::read_to_string(full_path).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn write_workspace_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<String, String> {
    blocking(move || {
        let root = get_workspace(&app)?;
        let full_path = resolve_in_workspace(&root, &path)?;

        if let Some(parent) = full_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        fs::write(&full_path, content).map_err(|error| error.to_string())?;
        Ok(to_relative_string(&root, &full_path))
    })
    .await
}

#[tauri::command]
pub async fn create_workspace_item(
    app: tauri::AppHandle,
    item_path: String,
    is_folder: bool,
) -> Result<String, String> {
    blocking(move || {
        let root = get_workspace(&app)?;
        let absolute = resolve_in_workspace(&root, &item_path)?;

        if absolute.exists() {
            return Err(format!("'{item_path}' already exists."));
        }

        if is_folder {
            fs::create_dir_all(&absolute).map_err(|error| error.to_string())?;
        } else {
            if let Some(parent) = absolute.parent() {
                fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            }
            fs::write(&absolute, "").map_err(|error| error.to_string())?;
        }

        Ok(to_relative_string(&root, &absolute))
    })
    .await
}

#[tauri::command]
pub async fn rename_workspace_item(
    app: tauri::AppHandle,
    item_path: String,
    new_name: String,
) -> Result<String, String> {
    blocking(move || {
        let root = get_workspace(&app)?;
        let absolute = resolve_in_workspace(&root, &item_path)?;

        if !absolute.exists() {
            return Err(format!("'{item_path}' does not exist."));
        }

        let new_name = new_name.trim();
        // `.` and `..` pass a separator check but resolve to the parent
        // directory once joined, so reject them explicitly: the destination
        // never goes through `resolve_in_workspace`.
        if new_name.is_empty()
            || new_name == "."
            || new_name == ".."
            || new_name.contains('/')
            || new_name.contains('\\')
        {
            return Err("Name must be a single file or folder name.".to_string());
        }

        let new_absolute = absolute.with_file_name(new_name);
        if !new_absolute.starts_with(&root) {
            return Err("Renaming outside the workspace is not allowed.".to_string());
        }
        if new_absolute.exists() {
            return Err(format!("'{new_name}' already exists."));
        }

        fs::rename(&absolute, &new_absolute).map_err(|error| error.to_string())?;
        Ok(to_relative_string(&root, &new_absolute))
    })
    .await
}

#[tauri::command]
pub async fn delete_workspace_item(app: tauri::AppHandle, item_path: String) -> Result<(), String> {
    blocking(move || {
        let root = get_workspace(&app)?;
        let absolute = resolve_in_workspace(&root, &item_path)?;

        if !absolute.exists() {
            return Err(format!("'{item_path}' does not exist."));
        }
        if absolute == root {
            return Err("The workspace root cannot be deleted.".to_string());
        }

        if absolute.is_dir() {
            fs::remove_dir_all(&absolute).map_err(|error| error.to_string())?;
        } else {
            fs::remove_file(&absolute).map_err(|error| error.to_string())?;
        }

        Ok(())
    })
    .await
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Data & misc commands
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

#[tauri::command]
pub async fn run_query(username: String, query: String) -> Result<String, String> {
    blocking(move || {
        let mut command = sf_command()?;
        command.args(["data", "query", "--target-org", &username, "--json"]);
        command.arg("--query");
        command.arg(query);

        let output = run_cancellable(command, None)?;
        // Surface the CLI's structured error (bad field, malformed SOQL) rather
        // than a raw stdout/stderr dump, but hand the caller the full JSON so
        // the results table can render the records.
        parse_sf_json(&output)?;
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    })
    .await
}

/// Set by `cancel_sf_command`, checked while a Developer Tools command runs.
///
/// The CLI child is killed rather than merely abandoned, so a long query stops
/// consuming an org's API calls the moment the user gives up on it.
static SF_COMMAND_CANCELLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Requests cancellation of an in-flight Developer Tools command.
#[tauri::command]
pub fn cancel_sf_command() {
    SF_COMMAND_CANCELLED.store(true, std::sync::atomic::Ordering::SeqCst);
}

/// How long a Developer Tools command may run before being killed.
///
/// Nothing here had a timeout: a hung CLI — an expired token waiting on stdin,
/// a stalled network — held the pane forever with no way out.
const SF_COMMAND_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);

/// Runs a command to completion, killing it on cancellation or timeout.
fn run_cancellable(
    mut command: Command,
    input: Option<String>,
) -> Result<std::process::Output, String> {
    SF_COMMAND_CANCELLED.store(false, std::sync::atomic::Ordering::SeqCst);

    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|error| error.to_string())?;

    if let Some(text) = input {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Could not open stdin for the Salesforce CLI.".to_string())?;
        // Written from its own thread for the same reason as `run_with_input`:
        // writing inline deadlocks once either pipe buffer fills.
        std::thread::spawn(move || stdin.write_all(text.as_bytes()));
    } else {
        drop(child.stdin.take());
    }

    let started = std::time::Instant::now();
    loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(_) => break,
            None => {
                if SF_COMMAND_CANCELLED.load(std::sync::atomic::Ordering::SeqCst) {
                    let _ = child.kill();
                    return Err("Cancelled.".to_string());
                }
                if started.elapsed() > SF_COMMAND_TIMEOUT {
                    let _ = child.kill();
                    return Err(format!(
                        "The command was still running after {} seconds and was stopped.",
                        SF_COMMAND_TIMEOUT.as_secs()
                    ));
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
        }
    }

    child.wait_with_output().map_err(|error| error.to_string())
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
) -> Result<String, String> {
    blocking(move || {
        let mut command = sf_command()?;
        if !args.is_empty() {
            command.args(&args);
        }
        if let Ok(workspace) = get_workspace(&app) {
            command.current_dir(workspace);
        }

        let output = run_cancellable(command, input)?;
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
) -> Result<String, String> {
    blocking(move || {
        let mut command = sf_command()?;
        if !args.is_empty() {
            command.args(&args);
        }
        if let Ok(workspace) = get_workspace(&app) {
            command.current_dir(workspace);
        }

        let output = run_cancellable(command, input)?;
        output_to_string(&output)
    })
    .await
}

/* ─────────────────────────────────────────────────────────────────
Diff Check
───────────────────────────────────────────────────────────────── */

/// One file's comparison between the workspace and the org.
#[derive(TS, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct DiffEntry {
    /// Workspace-relative path, `/` separated.
    pub path: String,
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
    pub session_dir: String,
    pub target: String,
    pub entries: Vec<DiffEntry>,
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

/// Copies a file or directory, creating parents as needed.
fn copy_into(source: &Path, destination: &Path) -> Result<(), String> {
    if source.is_dir() {
        for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let path = entry.path();
            if is_ignored_path(&path) {
                continue;
            }
            copy_into(&path, &destination.join(entry.file_name()))?;
        }
        return Ok(());
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, destination).map_err(|error| error.to_string())?;
    Ok(())
}

/// Every file under `path`, as workspace-relative strings.
fn files_under(root: &Path, path: &Path, out: &mut Vec<String>) {
    if path.is_file() {
        out.push(to_relative_string(root, path));
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    for entry in entries.flatten() {
        let child = entry.path();
        if is_ignored_path(&child) {
            continue;
        }
        files_under(root, &child, out);
    }
}

/// Text files only: comparing the bytes of a static resource is meaningless.
fn read_text(path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    // A NUL byte in the first block is the usual "this is binary" heuristic.
    if bytes.iter().take(8000).any(|byte| *byte == 0) {
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

/// Classifies one file from the two sides of a comparison.
fn diff_status(
    local: Option<&String>,
    org: Option<&String>,
    org_file_exists: bool,
) -> &'static str {
    match (local, org) {
        (Some(local_text), Some(org_text)) => {
            if local_text == org_text {
                "identical"
            } else {
                "changed"
            }
        }
        // Readable locally but not as text on the other side.
        (Some(_), None) if org_file_exists => "binary",
        (Some(_), None) => "localOnly",
        (None, Some(_)) => "orgOnly",
        (None, None) => "binary",
    }
}

/// Compares a workspace file or folder against the org's current version.
///
/// Works by seeding a throwaway SFDX project, copying the selection into it and
/// letting `project retrieve start --source-dir` overwrite the copy with what
/// the org has. No `sf` command emits a textual diff, and `--source-dir` needs a
/// local file present in order to name the component.
#[tauri::command]
pub async fn diff_workspace_path(
    app: tauri::AppHandle,
    username: String,
    path: String,
) -> Result<DiffSession, String> {
    blocking(move || {
        let workspace = get_workspace(&app)?;
        let target = resolve_in_workspace(&workspace, &path)?;
        if !target.exists() {
            return Err(format!("'{path}' no longer exists in the workspace."));
        }

        let relative = to_relative_string(&workspace, &target);
        let session_dir = diff_root(&app)?.join(now_millis().to_string());
        ensure_sfdx_project(&session_dir)?;

        // The org only reports components it can name from local source, so the
        // selection has to exist in the session project first.
        copy_into(&target, &session_dir.join(&relative))?;

        let mut command = sf_command()?;
        command.args([
            "project",
            "retrieve",
            "start",
            "--target-org",
            &username,
            "--source-dir",
            &relative,
            "--wait",
            "20",
            "--json",
        ]);
        command.current_dir(&session_dir);
        let output = command.output().map_err(|error| error.to_string())?;

        // A selection that exists nowhere in the org is not an error: every
        // file simply reports as local-only below.
        let org_has_nothing = parse_sf_json(&output).is_err();

        let mut paths: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        let mut local_files = Vec::new();
        files_under(&workspace, &target, &mut local_files);
        paths.extend(local_files);

        let session_target = session_dir.join(&relative);
        if !org_has_nothing && session_target.exists() {
            let mut org_files = Vec::new();
            files_under(&session_dir, &session_target, &mut org_files);
            paths.extend(org_files);
        }

        let mut entries = Vec::new();
        for item in paths {
            let local_path = workspace.join(&item);
            let org_path = session_dir.join(&item);

            let local = if local_path.is_file() {
                read_text(&local_path)
            } else {
                None
            };
            let org = if !org_has_nothing && org_path.is_file() {
                read_text(&org_path)
            } else {
                None
            };

            entries.push(DiffEntry {
                status: diff_status(local.as_ref(), org.as_ref(), org_path.is_file()).to_string(),
                local_lines: local.as_deref().map(line_count).unwrap_or(0),
                org_lines: org.as_deref().map(line_count).unwrap_or(0),
                path: item,
            });
        }

        Ok(DiffSession {
            session_dir: session_dir.to_string_lossy().to_string(),
            target: relative,
            entries,
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
    session_dir: String,
    path: String,
) -> Result<DiffPair, String> {
    blocking(move || {
        let workspace = get_workspace(&app)?;
        let session = PathBuf::from(&session_dir);

        // The session directory is app-managed, so confine reads to it just as
        // workspace reads are confined to the workspace.
        if !session.starts_with(diff_root(&app)?) {
            return Err("Unknown diff session.".to_string());
        }

        let local_path = resolve_in_workspace(&workspace, &path)?;
        let org_path = resolve_in_workspace(&session, &path)?;

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

    #[test]
    fn identical_text_is_not_reported_as_a_change() {
        let same = String::from("public class A {}");
        assert_eq!(diff_status(Some(&same), Some(&same), true), "identical");
    }

    #[test]
    fn differing_text_is_a_change() {
        let local = String::from("public class A {}");
        let org = String::from("public class B {}");
        assert_eq!(diff_status(Some(&local), Some(&org), true), "changed");
    }

    #[test]
    fn a_file_the_org_does_not_have_is_local_only() {
        let local = String::from("new");
        assert_eq!(diff_status(Some(&local), None, false), "localOnly");
    }

    #[test]
    fn a_file_missing_locally_is_org_only() {
        let org = String::from("theirs");
        assert_eq!(diff_status(None, Some(&org), true), "orgOnly");
    }

    #[test]
    fn unreadable_text_on_a_present_file_is_binary() {
        // Static resources exist on both sides but cannot be compared as text.
        let local = String::from("local");
        assert_eq!(diff_status(Some(&local), None, true), "binary");
        assert_eq!(diff_status(None, None, true), "binary");
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
