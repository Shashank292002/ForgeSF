//! The saved list of workspaces: storage, locking, and which folder a request acts on.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::util::{lock, now_millis, write_atomic};
use crate::workspace::sfdx_project::ensure_sfdx_project;

const WORKSPACE_CONFIG_FILE: &str = "workspace-config.json";

pub(crate) const WORKSPACE_CONFIG_KEY: &str = "workspacePath";

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
    /// Whether ForgeSF created this folder itself, inside its own app data.
    ///
    /// Only those may be deleted along with the registry entry — a folder the
    /// user picked is theirs. Derived from the path on every response and
    /// neither stored (`write_registry_file` strips it) nor trusted from a
    /// stored file (`read_registry_file` clears it), so it cannot go stale.
    #[serde(default)]
    pub managed: bool,
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

pub(crate) const WORKSPACE_SCHEMA_VERSION: u32 = 3;

/// Serialises every read-modify-write of the registry file.
///
/// Commands run in parallel on the blocking pool, and at startup two of them
/// update the registry at once. With no lock, one could read the file while
/// another was rewriting it, or overwrite the other's change.
static REGISTRY_LOCK: Mutex<()> = Mutex::new(());

/// Why the saved registry had to be replaced, until `list_workspaces` reports it.
pub(crate) static REGISTRY_NOTICE: Mutex<Option<String>> = Mutex::new(None);

/// Canonicalises a path for use as a stable id, falling back to the input when
/// the path does not exist yet.
pub(crate) fn workspace_id(path: &Path) -> String {
    let resolved = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    // `canonicalize` yields a \\?\ prefix on Windows; strip it so ids stay
    // readable and match what the UI shows.
    let text = resolved.to_string_lossy().replace('\\', "/");
    text.strip_prefix("//?/").unwrap_or(&text).to_string()
}

pub(crate) fn entry_for(path: &Path) -> WorkspaceEntry {
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
        managed: false,
    }
}

/// Turns an org alias or username into a safe folder name.
pub(crate) fn sanitize_folder_name(label: &str) -> String {
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

/// Whether `path` is one of the folders ForgeSF created for an org, and so one
/// it may delete. Compared on the canonicalised form, so `..` in the stored
/// path cannot smuggle in a folder from elsewhere.
pub(crate) fn is_managed_workspace(root: &Path, path: &Path) -> bool {
    let resolved = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    resolved.starts_with(&root) && resolved != root
}

/// Fills in `managed` before a registry goes to the UI.
pub(crate) fn mark_managed(app: &tauri::AppHandle, registry: &mut WorkspaceRegistry) {
    for entry in &mut registry.workspaces {
        mark_entry_managed(app, entry);
    }
}

/// The same, for a command that answers with one entry.
pub(crate) fn mark_entry_managed(app: &tauri::AppHandle, entry: &mut WorkspaceEntry) {
    let Ok(root) = org_workspaces_root(app) else {
        return;
    };
    entry.managed = is_managed_workspace(&root, Path::new(&entry.path));
}

/// Root that auto-created per-org workspaces live under.
pub(crate) fn org_workspaces_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(data_dir.join("workspaces"))
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
            Ok(mut registry) => {
                // `managed` says whether a folder is one ForgeSF may delete. It
                // is worked out from the path each time a registry is sent, so
                // a value carried in a file — hand-written, or from a build
                // that stored it — is never believed.
                for entry in &mut registry.workspaces {
                    entry.managed = false;
                }
                Ok(registry)
            }
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
    // The notice is a one-off message for the UI, not part of the stored list,
    // and `managed` is derived from the path every time it is sent.
    if let Some(object) = value.as_object_mut() {
        object.remove("notice");
        if let Some(entries) = object
            .get_mut("workspaces")
            .and_then(|list| list.as_array_mut())
        {
            for entry in entries {
                if let Some(entry) = entry.as_object_mut() {
                    entry.remove("managed");
                }
            }
        }
    }
    let json = serde_json::to_string_pretty(&value).map_err(|error| error.to_string())?;
    write_atomic(path, json.as_bytes())
}

/// When a file last changed, and its size.
type FileStamp = (SystemTime, u64);

fn file_stamp(path: &Path) -> Option<FileStamp> {
    let metadata = fs::metadata(path).ok()?;
    Some((metadata.modified().ok()?, metadata.len()))
}

/// The registry as last read from or written to disk, per registry file,
/// with the file's stamp at that moment.
///
/// Every workspace command finds its folder through the registry, so a single
/// explorer action read and parsed the file several times. A repeat read now
/// costs one metadata call, and the file is parsed again only when it has
/// changed — including when another ForgeSF window wrote it.
static REGISTRY_CACHE: Mutex<BTreeMap<PathBuf, (FileStamp, WorkspaceRegistry)>> =
    Mutex::new(BTreeMap::new());

/// Remembers `registry` as the content of `path`, if the file is still as it
/// was when `before` was taken (`None`: it was just written).
fn remember_registry(path: &Path, before: Option<FileStamp>, registry: &WorkspaceRegistry) {
    let mut cache = lock(&REGISTRY_CACHE);
    match file_stamp(path) {
        Some(stamp) if before.map_or(true, |before| before == stamp) => {
            cache.insert(path.to_path_buf(), (stamp, registry.clone()));
        }
        // It changed while being read, or is gone: read it afresh next time.
        _ => {
            cache.remove(path);
        }
    }
}

/// `read_registry_file`, without parsing a file that is unchanged since it was
/// last read or written. Callers must hold `REGISTRY_LOCK`.
fn read_registry_cached(path: &Path) -> Result<WorkspaceRegistry, String> {
    let before = file_stamp(path);
    if let Some(stamp) = before {
        if let Some((cached, registry)) = lock(&REGISTRY_CACHE).get(path) {
            if *cached == stamp {
                return Ok(registry.clone());
            }
        }
    }
    let registry = read_registry_file(path)?;
    if before.is_some() {
        remember_registry(path, before, &registry);
    }
    Ok(registry)
}

/// A consistent snapshot of the registry.
pub(crate) fn read_registry(app: &tauri::AppHandle) -> AppResult<WorkspaceRegistry> {
    let path = workspace_config_path(app)?;
    let _guard = lock(&REGISTRY_LOCK);
    read_registry_cached(&path).map_err(AppError::from)
}

/// Runs one read-modify-write of the registry file under the lock.
///
/// `change` returns its result and whether it modified the registry; the file
/// is only rewritten when it did.
fn update_registry_at<T>(
    path: &Path,
    change: impl FnOnce(&mut WorkspaceRegistry) -> AppResult<(T, bool)>,
) -> AppResult<T> {
    let _guard = lock(&REGISTRY_LOCK);
    let mut registry = read_registry_cached(path)?;
    let (result, changed) = change(&mut registry)?;
    if changed {
        write_registry_file(path, &registry)?;
        remember_registry(path, None, &registry);
    }
    Ok(result)
}

pub(crate) fn update_registry<T>(
    app: &tauri::AppHandle,
    change: impl FnOnce(&mut WorkspaceRegistry) -> AppResult<(T, bool)>,
) -> AppResult<T> {
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
///   1. The active registered workspace (if it still exists).
///   2. In debug builds only, the dev workspace at `apps/desktop/workspace`.
///   3. A fresh project skeleton created under the app data directory.
pub(crate) fn get_workspace(app: &tauri::AppHandle) -> AppResult<PathBuf> {
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
) -> AppResult<PathBuf> {
    let registry = read_registry(app)?;
    match workspace_id.filter(|id| !id.is_empty()) {
        Some(id) => registered_workspace_path(&registry, id),
        None => resolve_workspace(app, &registry),
    }
}

/// A registered workspace's folder, which must still exist.
fn registered_workspace_path(registry: &WorkspaceRegistry, id: &str) -> AppResult<PathBuf> {
    let entry = registry
        .workspaces
        .iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| {
            AppError::new(
                ErrorKind::NotFound,
                "That workspace is no longer registered.",
            )
        })?;
    let path = PathBuf::from(&entry.path);
    if !path.is_dir() {
        return Err(AppError::new(
            ErrorKind::NotFound,
            format!("The workspace folder '{}' no longer exists.", entry.path),
        ));
    }
    Ok(path)
}

/// `get_workspace` against a registry the caller already holds — needed inside
/// `update_registry`, where reading it again would deadlock on the lock.
pub(crate) fn resolve_workspace(
    app: &tauri::AppHandle,
    registry: &WorkspaceRegistry,
) -> AppResult<PathBuf> {
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
    // The no-org fallback: there is no org to ask for an API version.
    ensure_sfdx_project(&root, None)?;
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{cleanup, scratch_dir};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;

    use crate::util::{lock, next_temp_suffix};

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

    fn entry_named(name: &str) -> WorkspaceEntry {
        WorkspaceEntry {
            id: name.to_string(),
            name: name.to_string(),
            path: format!("/tmp/{name}"),
            org_id: None,
            last_org_id: None,
            last_retrieved_org_id: None,
            created_at: 0,
            managed: false,
        }
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
                managed: false,
            }],
            notice: None,
        }
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
                managed: false,
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

    #[test]
    fn only_folders_forgesf_created_for_an_org_count_as_its_own() {
        let root = scratch_dir("managed-root");
        let inside = root.join("Acme-Dev");
        fs::create_dir_all(&inside).unwrap();
        let outside = scratch_dir("managed-elsewhere");

        assert!(is_managed_workspace(&root, &inside));
        // A project the user picked, and the root itself, are never deleted.
        assert!(!is_managed_workspace(&root, &outside));
        assert!(!is_managed_workspace(&root, &root));
        // Nor is one reached by climbing out of the root and back.
        assert!(!is_managed_workspace(
            &root,
            &inside
                .join("..")
                .join("..")
                .join(outside.file_name().unwrap())
        ));

        cleanup(&[&root, &outside]);
    }

    #[test]
    fn whether_a_folder_is_forgesfs_own_is_never_stored() {
        // It is derived from the path on every response; a stored value would
        // go stale the moment a registry file moved between machines.
        let dir = scratch_dir("registry-managed");
        let path = dir.join(WORKSPACE_CONFIG_FILE);
        let mut registry = empty_registry();
        let mut entry = entry_named("acme");
        entry.managed = true;
        registry.workspaces.push(entry);

        write_registry_file(&path, &registry).unwrap();
        assert!(!fs::read_to_string(&path).unwrap().contains("managed"));

        let reread = read_registry_file(&path).unwrap();
        assert!(!reread.workspaces[0].managed);

        // Nor is one believed if it turns up in the file anyway.
        let planted = fs::read_to_string(&path)
            .unwrap()
            .replace(r#""name": "acme""#, r#""name": "acme", "managed": true"#);
        fs::write(&path, planted).unwrap();
        assert!(!read_registry_file(&path).unwrap().workspaces[0].managed);

        let _ = fs::remove_dir_all(&dir);
    }

    /// Sets a file's modification time, as a later or an unnoticed write would.
    fn set_modified(path: &Path, when: std::time::SystemTime) {
        fs::File::options()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(when)
            .unwrap();
    }

    fn names(registry: &WorkspaceRegistry) -> Vec<String> {
        registry
            .workspaces
            .iter()
            .map(|entry| entry.name.clone())
            .collect()
    }

    #[test]
    fn an_unchanged_registry_file_is_not_parsed_again() {
        let dir = scratch_dir("registry-cache-hit");
        let path = dir.join(WORKSPACE_CONFIG_FILE);
        update_registry_at(&path, |registry| {
            registry.workspaces.push(entry_named("ws-a"));
            Ok(((), true))
        })
        .unwrap();
        let (written_at, _) = file_stamp(&path).unwrap();

        // Different content, but the same size and modification time: only a
        // cached copy still says "ws-a".
        let text = fs::read_to_string(&path).unwrap().replace("ws-a", "ws-b");
        fs::write(&path, text).unwrap();
        set_modified(&path, written_at);

        let _guard = lock(&REGISTRY_LOCK);
        assert_eq!(names(&read_registry_cached(&path).unwrap()), ["ws-a"]);
        drop(_guard);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_registry_file_changed_elsewhere_is_read_again() {
        let dir = scratch_dir("registry-cache-miss");
        let path = dir.join(WORKSPACE_CONFIG_FILE);
        update_registry_at(&path, |registry| {
            registry.workspaces.push(entry_named("ws-a"));
            Ok(((), true))
        })
        .unwrap();

        // Another ForgeSF window saves its own list.
        let mut other = empty_registry();
        other.workspaces.push(entry_named("from-another-window"));
        write_registry_file(&path, &other).unwrap();
        set_modified(
            &path,
            std::time::SystemTime::now() + std::time::Duration::from_secs(5),
        );

        let _guard = lock(&REGISTRY_LOCK);
        assert_eq!(
            names(&read_registry_cached(&path).unwrap()),
            ["from-another-window"]
        );
        drop(_guard);

        // And an update builds on that list, not on the stale copy.
        update_registry_at(&path, |registry| {
            registry.workspaces.push(entry_named("ws-c"));
            Ok(((), true))
        })
        .unwrap();
        let _guard = lock(&REGISTRY_LOCK);
        assert_eq!(
            names(&read_registry_file(&path).unwrap()),
            ["from-another-window", "ws-c"]
        );
        drop(_guard);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_request_resolves_the_workspace_it_names_not_the_active_one() {
        let dir = std::env::temp_dir().join(format!("forgesf-int-ws-{}", next_temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        let registry = registry_with("org-a", &dir);

        assert_eq!(registered_workspace_path(&registry, "org-a").unwrap(), dir);
        let unregistered = registered_workspace_path(&registry, "org-b").unwrap_err();
        assert_eq!(unregistered.kind, ErrorKind::NotFound);
        assert!(unregistered.message.contains("no longer registered"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_named_workspace_whose_folder_is_gone_is_an_error_not_a_fallback() {
        let missing = std::env::temp_dir().join(format!("forgesf-int-gone-{}", next_temp_suffix()));
        let registry = registry_with("org-a", &missing);
        let gone = registered_workspace_path(&registry, "org-a").unwrap_err();
        assert_eq!(gone.kind, ErrorKind::NotFound);
        assert!(gone.message.contains("no longer exists"));
    }
}
