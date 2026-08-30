use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::Manager;

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Salesforce CLI discovery
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

fn find_sf_executable() -> Result<String, String> {
    let candidates = [
        r"C:\Program Files\sf\bin\sf.cmd".to_string(),
        "sf".to_string(),
        "sf.cmd".to_string(),
    ];

    for candidate in candidates {
        if let Ok(output) = Command::new(&candidate).arg("--version").output() {
            if output.status.success() || !output.stdout.is_empty() {
                return Ok(candidate);
            }
        }
    }

    Err(
        "Could not find the 'sf' Salesforce CLI. Install it and ensure it is on PATH, \
         or install it under 'C:\\Program Files\\sf'."
            .to_string(),
    )
}

fn run_sf<I, S>(args: I) -> Result<std::process::Output, String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    let sf = find_sf_executable()?;
    Command::new(sf)
        .args(args)
        .output()
        .map_err(|error| error.to_string())
}

fn output_to_string(output: &std::process::Output) -> Result<String, String> {
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(format!(
            "STDOUT:\n{}\n\nSTDERR:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Shared models
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Organization {
    pub id: String,
    pub alias: String,
    pub username: String,
    pub instance_url: String,
    pub org_type: String,
    pub is_default: bool,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgDetails {
    pub access_token: String,
    pub instance_url: String,
    pub api_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataType {
    pub xml_name: String,
    pub directory_name: String,
    pub suffix: Option<String>,
    pub in_folder: bool,
    pub meta_file: bool,
    pub child_xml_names: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub node_type: String,
    pub children: Option<Vec<FileNode>>,
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Workspace root management
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

const WORKSPACE_CONFIG_FILE: &str = "workspace-config.json";
const WORKSPACE_CONFIG_KEY: &str = "workspacePath";

/// Directories that are always hidden from the workspace explorer.
const IGNORED_DIRECTORIES: &[&str] = &[
    ".git", ".hg", ".svn", ".github", ".idea", ".vscode",
    ".sf", ".sfdx", ".sfdx-journal.json",
    "node_modules", ".turbo", ".cache",
];

fn workspace_config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve app data directory: {error}"))?;
    fs::create_dir_all(&data_dir).map_err(|error| error.to_string())?;
    Ok(data_dir.join(WORKSPACE_CONFIG_FILE))
}

/// Reads the workspace path persisted via `set_workspace_path`.
fn read_configured_workspace(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let config_path = workspace_config_path(app)?;
    if !config_path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&config_path).map_err(|error| error.to_string())?;
    let json: serde_json::Value =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;

    Ok(json
        .get(WORKSPACE_CONFIG_KEY)
        .and_then(|value| value.as_str())
        .map(PathBuf::from)
        .filter(|path| path.exists() && path.is_dir()))
}

fn write_configured_workspace(app: &tauri::AppHandle, root: &Path) -> Result<(), String> {
    let json = serde_json::json!({ WORKSPACE_CONFIG_KEY: root.to_string_lossy() });
    fs::write(workspace_config_path(app)?, json.to_string()).map_err(|error| error.to_string())
}

/// Resolves the workspace root used by every workspace command.
///
/// Priority:
///   1. The path saved through `set_workspace_path` (if it still exists).
///   2. The dev workspace bundled with the app (`apps/desktop/workspace`).
///   3. A fresh project skeleton created under the app data directory.
fn get_workspace(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(configured) = read_configured_workspace(app)? {
        return Ok(configured);
    }

    // Dev fallback: apps/desktop/workspace relative to the src-tauri directory.
    if let Ok(mut current) = std::env::current_dir() {
        if current.file_name().is_some_and(|name| name == "src-tauri") {
            current.pop();
        }
        current.push("workspace");
        if current.exists() && current.is_dir() {
            return Ok(current);
        }
    }

    // Production fallback: a dedicated workspace under the app data directory.
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
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
        return Err(format!("Path '{relative}' must be relative to the workspace."));
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
                return Err(format!("Path '{relative}' must be relative to the workspace."));
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

fn read_directory(root: &Path, path: &Path) -> Result<Vec<FileNode>, String> {
    let mut nodes = Vec::new();

    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_path = entry.path();

        if is_ignored_path(&entry_path) {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();

        if entry_path.is_dir() {
            nodes.push(FileNode {
                name: name.clone(),
                path: to_relative_string(root, &entry_path),
                node_type: "folder".to_string(),
                children: Some(read_directory(root, &entry_path)?),
            });
        } else {
            nodes.push(FileNode {
                name,
                path: to_relative_string(root, &entry_path),
                node_type: "file".to_string(),
                children: None,
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

fn collect_files(current: &Path, root: &Path, files: &mut Vec<String>) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if is_ignored_path(&path) {
            continue;
        }

        if path.is_dir() {
            collect_files(&path, root, files)?;
        } else {
            files.push(to_relative_string(root, &path));
        }
    }

    Ok(())
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Org management
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

#[tauri::command]
pub fn connect_salesforce() -> Result<Organization, String> {
    let login = run_sf(["org", "login", "web", "--json"])?;

    if !login.status.success() {
        return Err(String::from_utf8_lossy(&login.stderr).to_string());
    }

    let json: serde_json::Value =
        serde_json::from_slice(&login.stdout).map_err(|error| error.to_string())?;
    let result = &json["result"];

    let username = result["username"].as_str().unwrap_or_default().to_string();

    Ok(Organization {
        id: result["orgId"].as_str().unwrap_or_default().to_string(),
        alias: result["alias"]
            .as_str()
            .unwrap_or(&username)
            .to_string(),
        username,
        instance_url: result["instanceUrl"].as_str().unwrap_or_default().to_string(),
        org_type: "Production".to_string(),
        is_default: true,
        status: "Connected".to_string(),
    })
}

#[tauri::command]
pub fn open_org(username: String) -> Result<(), String> {
    let output = run_sf(["org", "open", "--target-org", &username])?;
    output_to_string(&output)?;
    Ok(())
}

#[tauri::command]
pub fn set_default_org(username: String) -> Result<String, String> {
    let output = run_sf(["config", "set", "target-org", &username])?;
    output_to_string(&output)
}

#[tauri::command]
pub fn logout_org(username: String) -> Result<String, String> {
    let output = run_sf(["org", "logout", "--target-org", &username, "--no-prompt"])?;
    output_to_string(&output)
}

#[tauri::command]
pub fn get_org_details(username: String) -> Result<OrgDetails, String> {
    let output = run_sf(["org", "display", "--target-org", &username, "--json"])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let json: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;
    let result = &json["result"];

    Ok(OrgDetails {
        access_token: result["accessToken"].as_str().unwrap_or_default().to_string(),
        instance_url: result["instanceUrl"].as_str().unwrap_or_default().to_string(),
        api_version: result["apiVersion"]
            .as_str()
            .unwrap_or("65.0")
            .to_string(),
    })
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Metadata
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

#[tauri::command]
pub fn list_metadata_types(username: String) -> Result<Vec<MetadataType>, String> {
    let output = run_sf([
        "org", "list", "metadata-types", "--target-org", &username, "--json",
    ])?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let json: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;

    serde_json::from_value(json["result"]["metadataObjects"].clone())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_metadata_components(
    metadata_type: String,
    username: String,
) -> Result<Vec<String>, String> {
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

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }

    let json: serde_json::Value =
        serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;

    Ok(json["result"]
        .as_array()
        .ok_or("No metadata found")?
        .iter()
        .filter_map(|member| member["fullName"].as_str().map(|name| name.to_string()))
        .collect())
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

#[tauri::command]
pub fn retrieve_metadata(
    app: tauri::AppHandle,
    metadata_types: Vec<String>,
    username: String,
) -> Result<String, String> {
    let workspace = get_workspace(&app)?;
    let sf = find_sf_executable()?;

    let mut command = Command::new(sf);
    command.args(["project", "retrieve", "start", "--target-org", &username]);

    for metadata in &metadata_types {
        command.arg("--metadata");
        command.arg(metadata);
    }

    command.args(["--wait", "20", "--json"]);
    command.current_dir(&workspace);

    let output = command.output().map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(summarize_sf_json(&output.stdout))
    } else {
        Err(format!(
            "STDOUT:\n{}\n\nSTDERR:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/// One metadata type / group included in a retrieve batch, and its outcome.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrieveResultItem {
    pub kind: String,
    pub status: String, // "completed" | "failed"
    pub retrieved: u32,
    pub message: Option<String>,
}

/// Aggregated outcome of a retrieve run (with per-type detail).
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrieveResult {
    pub success: bool,
    pub summary: String,
    pub items: Vec<RetrieveResultItem>,
    pub total: u32,
    pub succeeded: u32,
    pub failed: u32,
}

/// Real-time payload pushed to the frontend while a retrieve is in flight.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RetrieveProgressEvent {
    pub phase: String,          // "item" | "complete"
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

/// Extracts the number of retrieved files from an `sf` JSON result payload.
fn metadata_file_count(stdout: &[u8]) -> u32 {
    match serde_json::from_slice::<serde_json::Value>(stdout) {
        Ok(json) => json["result"]["files"]
            .as_array()
            .map(|files| files.len() as u32)
            .unwrap_or(0),
        Err(_) => 0,
    }
}

/// Determines whether an `sf` JSON payload represents success vs. failure.
fn metadata_json_succeeded(stdout: &[u8]) -> bool {
    match serde_json::from_slice::<serde_json::Value>(stdout) {
        Ok(json) => {
            let status = json["status"].as_i64().unwrap_or(0);
            let result_status = json["result"]["status"]
                .as_str()
                .map(|s| s.eq_ignore_ascii_case("failed"))
                .unwrap_or(false);
            status == 0 && !result_status
        }
        Err(_) => true,
    }
}

/// Retrieve one group of members belonging to a single metadata type and
/// report back how many files were written.
fn retrieve_type_group(
    sf: &str,
    workspace: &Path,
    username: &str,
    kind: &str,
    members: &[String],
) -> Result<u32, String> {
    let mut command = Command::new(sf);
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

    if output.status.success() && metadata_json_succeeded(&output.stdout) {
        Ok(metadata_file_count(&output.stdout))
    } else if output.status.success() {
        Err(format!(
            "Retrieve failed for {kind}. STDOUT:\n{}",
            String::from_utf8_lossy(&output.stdout)
        ))
    } else {
        Err(format!(
            "Retrieve failed for {kind}.\nSTDERR:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
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
    let workspace = get_workspace(&app)?;
    let sf = find_sf_executable()?;

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
    let mut index = 0usize;
    let mut succeeded = 0u32;
    let mut failed = 0u32;
    let mut items: Vec<RetrieveResultItem> = Vec::new();

    let emit = |payload: &RetrieveProgressEvent| -> Result<(), String> {
        app.emit("retrieve_progress", payload)
            .map_err(|error| error.to_string())
    };

    for (kind, members) in order.into_iter().zip(groups) {
        index += 1;

        emit(&RetrieveProgressEvent {
            phase: "item".to_string(),
            index,
            total,
            kind: Some(kind.clone()),
            status: Some("running".to_string()),
            retrieved: 0,
            succeeded,
            failed,
            message: Some(format!("Retrieving {kind}…")),
        })?;

        match retrieve_type_group(&sf, &workspace, &username, &kind, &members) {
            Ok(retrieved) => {
                succeeded += 1;
                items.push(RetrieveResultItem {
                    kind: kind.clone(),
                    status: "completed".to_string(),
                    message: Some(format!("{retrieved} item(s) retrieved")),
                    retrieved,
                });
                emit(&RetrieveProgressEvent {
                    phase: "item".to_string(),
                    kind: Some(kind.clone()),
                    status: Some("completed".to_string()),
                    index: 0,
                    total: 0,
                    retrieved,
                    succeeded,
                    failed,
                    message: Some(format!("Retrieved {retrieved} item(s)")),
                })?;
            }
            Err(error) => {
                failed += 1;
                items.push(RetrieveResultItem {
                    kind: kind.clone(),
                    status: "failed".to_string(),
                    retrieved: 0,
                    message: Some(error.clone()),
                });
                emit(&RetrieveProgressEvent {
                    phase: "item".to_string(),
                    kind: Some(kind.clone()),
                    status: Some("failed".to_string()),
                    index: 0,
                    total: 0,
                    retrieved: 0,
                    succeeded,
                    failed,
                    message: Some(error),
                })?;
            }
        }
    }

    let success = failed == 0;
    let summary = if success {
        format!(
            "Retrieved metadata from {} type(s) successfully.",
            succeeded,
        )
    } else {
        format!(
            "Finished with {failed} failed type(s).",
        )
    };

    emit(&RetrieveProgressEvent {
        phase: "complete".to_string(),
        index: total,
        total,
        kind: None,
        status: Some(if success {
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

#[tauri::command]
pub fn deploy_workspace(
    app: tauri::AppHandle,
    username: String,
    check_only: bool,
) -> Result<String, String> {
    let workspace = get_workspace(&app)?;
    let sf = find_sf_executable()?;

    let mut command = Command::new(sf);
    command.args([
        "project",
        "deploy",
        "start",
        "--target-org",
        &username,
        "--source-dir",
        "force-app",
        "--wait",
        "10",
    ]);

    if check_only {
        command.arg("--check-only");
    }

    command.arg("--json");
    command.current_dir(&workspace);

    let output = command.output().map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(summarize_sf_json(&output.stdout))
    } else {
        Err(format!(
            "STDOUT:\n{}\n\nSTDERR:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Workspace commands
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

#[tauri::command]
pub fn get_workspace_root(app: tauri::AppHandle) -> Result<String, String> {
    Ok(get_workspace(&app)?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn set_workspace_path(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("'{path}' is not an existing directory."));
    }

    ensure_sfdx_project(&root)?;
    write_configured_workspace(&app, &root)?;
    Ok(root.to_string_lossy().to_string())
}

#[tauri::command]
pub fn read_workspace(app: tauri::AppHandle, path: String) -> Result<Vec<FileNode>, String> {
    let root = get_workspace(&app)?;
    let target = if path.trim().is_empty() {
        root.clone()
    } else {
        resolve_in_workspace(&root, &path)?
    };

    read_directory(&root, &target)
}

#[tauri::command]
pub fn list_workspace_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let workspace = get_workspace(&app)?;
    let mut files = Vec::new();
    collect_files(&workspace, &workspace, &mut files)?;
    files.sort();
    Ok(files)
}

#[tauri::command]
pub fn read_workspace_file(app: tauri::AppHandle, path: String) -> Result<String, String> {
    let root = get_workspace(&app)?;
    let full_path = resolve_in_workspace(&root, &path)?;
    fs::read_to_string(full_path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn write_workspace_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
) -> Result<String, String> {
    let root = get_workspace(&app)?;
    let full_path = resolve_in_workspace(&root, &path)?;

    if let Some(parent) = full_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(&full_path, content).map_err(|error| error.to_string())?;
    Ok(to_relative_string(&root, &full_path))
}

#[tauri::command]
pub fn create_workspace_item(
    app: tauri::AppHandle,
    item_path: String,
    is_folder: bool,
) -> Result<String, String> {
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
}

#[tauri::command]
pub fn rename_workspace_item(
    app: tauri::AppHandle,
    item_path: String,
    new_name: String,
) -> Result<String, String> {
    let root = get_workspace(&app)?;
    let absolute = resolve_in_workspace(&root, &item_path)?;

    if !absolute.exists() {
        return Err(format!("'{item_path}' does not exist."));
    }

    let new_name = new_name.trim();
    if new_name.is_empty() || new_name.contains('/') || new_name.contains('\\') {
        return Err("Name must be a single file or folder name.".to_string());
    }

    let new_absolute = absolute.with_file_name(new_name);
    if new_absolute.exists() {
        return Err(format!("'{new_name}' already exists."));
    }

    fs::rename(&absolute, &new_absolute).map_err(|error| error.to_string())?;
    Ok(to_relative_string(&root, &new_absolute))
}

#[tauri::command]
pub fn delete_workspace_item(app: tauri::AppHandle, item_path: String) -> Result<(), String> {
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
}

/* â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Data & misc commands
   â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

#[tauri::command]
pub fn run_query(username: String, query: String) -> Result<String, String> {
    let mut command = Command::new(find_sf_executable()?);
    command.args(["data", "query", "--target-org", &username, "--json"]);
    command.arg("--query");
    command.arg(query);

    let output = command.output().map_err(|error| error.to_string())?;
    output_to_string(&output)
}

#[tauri::command]
pub fn run_command(args: Vec<String>, input: Option<String>) -> Result<String, String> {
    let mut command = Command::new(find_sf_executable()?);
    if !args.is_empty() {
        command.args(&args);
    }

    if input.is_some() {
        command.stdin(Stdio::piped());
    }

    let mut child = command.spawn().map_err(|error| error.to_string())?;

    if let Some(input_str) = input {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(input_str.as_bytes())
                .map_err(|error| error.to_string())?;
        }
    }

    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    output_to_string(&output)
}
