//! Commands that pick, add, switch, bind, rename and forget workspace folders.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri_plugin_dialog::DialogExt;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::orgs::org_api_version;
use crate::util::{blocking, lock, now_millis};
use crate::workspace::registry::{
    entry_for, is_managed_workspace, mark_entry_managed, mark_managed, org_workspaces_root,
    read_registry, resolve_workspace, sanitize_folder_name, update_registry, workspace_id,
    workspace_root, WorkspaceEntry, WorkspaceRegistry, REGISTRY_NOTICE,
};
use crate::workspace::sfdx_project::{
    ensure_sfdx_project, is_salesforce_project, write_project_file,
};

/// Says whether an entry is one of ForgeSF's own folders, before it is sent to
/// the UI. Commands that answer with a single entry go through here.
fn marked(app: &tauri::AppHandle, mut entry: WorkspaceEntry) -> WorkspaceEntry {
    mark_entry_managed(app, &mut entry);
    entry
}

#[tauri::command]
pub async fn get_workspace_root(
    app: tauri::AppHandle,
    workspace_id: Option<String>,
) -> AppResult<String> {
    blocking(move || {
        Ok(workspace_root(&app, workspace_id.as_deref())?
            .to_string_lossy()
            .to_string())
    })
    .await
}

/// Every registered project. The active one is whichever `activeId` names.
///
/// Self-heals on read: whatever `get_workspace` resolves to is a real project
/// even when nobody picked it explicitly (the dev folder, or the app-data
/// skeleton). Registering it here means org associations, the switcher and the
/// mixing warning all work on first launch instead of staying inert until the
/// user happens to use "Open folder…".
#[tauri::command]
pub async fn list_workspaces(app: tauri::AppHandle) -> AppResult<WorkspaceRegistry> {
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
        mark_managed(&app, &mut registry);
        Ok(registry)
    })
    .await
}

/// A folder chosen in the native picker, not registered yet.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct PickedFolder {
    pub path: String,
    pub name: String,
    /// Whether it already has an `sfdx-project.json`.
    pub is_salesforce_project: bool,
}

/// The folder last chosen with `pick_workspace_folder`: the only one
/// `add_workspace` accepts.
///
/// Every file command acts inside a registered workspace, so a page that could
/// register any path it named could read and write anywhere the user can. Only
/// a folder the user picked in the native dialog becomes a workspace.
static PICKED_FOLDER: Mutex<Option<String>> = Mutex::new(None);

fn picked_folder(path: &Path) -> PickedFolder {
    let text = path.to_string_lossy().to_string();
    PickedFolder {
        name: path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| text.clone()),
        is_salesforce_project: is_salesforce_project(path),
        path: text,
    }
}

/// Shows the native folder picker for "Open Folder…". `None` when cancelled.
#[tauri::command]
pub async fn pick_workspace_folder(window: tauri::Window) -> AppResult<Option<PickedFolder>> {
    blocking(move || {
        let Some(choice) = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Open Folder")
            .blocking_pick_folder()
        else {
            return Ok(None);
        };
        let path = choice.into_path().map_err(|error| error.to_string())?;
        let folder = picked_folder(&path);
        *lock(&PICKED_FOLDER) = Some(folder.path.clone());
        Ok(Some(folder))
    })
    .await
}

/// Registers the folder just chosen with `pick_workspace_folder` as a project
/// and makes it active.
///
/// A folder without `sfdx-project.json` gets one only with `create_project`,
/// meaning the user agreed to it; it used to be written without asking.
/// Adding a folder that is already registered just re-activates it rather than
/// creating a duplicate entry.
///
/// `fallback_api_version` is the Settings preference, used when the org
/// cannot be asked — otherwise a new project silently took whatever version
/// this build happened to ship with.
#[tauri::command]
pub async fn add_workspace(
    app: tauri::AppHandle,
    path: String,
    org_id: Option<String>,
    create_project: Option<bool>,
    label: Option<String>,
    fallback_api_version: Option<String>,
) -> AppResult<WorkspaceEntry> {
    blocking(move || {
        if lock(&PICKED_FOLDER).as_deref() != Some(path.as_str()) {
            return Err("Choose the folder with Open Folder… first.".into());
        }
        let root = PathBuf::from(&path);
        if !root.is_dir() {
            return Err(format!("'{path}' is not an existing directory.").into());
        }
        if !is_salesforce_project(&root) {
            if create_project != Some(true) {
                return Err(format!("'{path}' has no sfdx-project.json.").into());
            }
            // Only when a project is actually being created, so opening a
            // folder that already has one costs no CLI call.
            let api_version = label
                .as_deref()
                .and_then(org_api_version)
                .or(fallback_api_version);
            write_project_file(&root, api_version.as_deref())?;
        }

        let entry = update_registry(&app, |registry| {
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
        })?;

        *lock(&PICKED_FOLDER) = None;
        Ok(marked(&app, entry))
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
///
/// `fallback_api_version` is the Settings preference, used when the org
/// cannot be asked.
#[tauri::command]
pub async fn workspace_for_org(
    app: tauri::AppHandle,
    org_id: String,
    label: Option<String>,
    fallback_api_version: Option<String>,
) -> AppResult<WorkspaceEntry> {
    blocking(move || {
        let root = org_workspaces_root(&app)?;

        // Asked once, before the registry lock is taken, and only when this org
        // has no folder yet: `sf org display` is a second or two, and every org
        // switch comes through here.
        let api_version = match read_registry(&app)?
            .workspaces
            .iter()
            .any(|item| item.org_id.as_deref() == Some(org_id.as_str()))
        {
            true => None,
            false => label
                .as_deref()
                .and_then(org_api_version)
                .or(fallback_api_version),
        };

        update_registry(&app, |registry| {
            // Already bound: just activate it.
            if let Some(existing) = registry
                .workspaces
                .iter()
                .find(|item| item.org_id.as_deref() == Some(org_id.as_str()))
                .cloned()
            {
                let path = Path::new(&existing.path);
                if path.starts_with(&root) {
                    // ForgeSF's own folder: one deleted underneath us is
                    // recreated rather than leaving every workspace command
                    // failing.
                    ensure_sfdx_project(path, api_version.as_deref())?;
                } else if !path.is_dir() {
                    // A folder the user picked is theirs. ForgeSF neither
                    // recreates it nor writes a project into it.
                    return Err(AppError::new(
                        ErrorKind::NotFound,
                        format!(
                            "The folder for this org, {}, no longer exists. Open another \
                             folder for the org, or forget this one in Settings.",
                            existing.path
                        ),
                    ));
                }
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

            ensure_sfdx_project(&candidate, api_version.as_deref())?;

            let mut entry = entry_for(&candidate);
            entry.org_id = Some(org_id.clone());
            entry.last_org_id = Some(org_id.clone());
            entry.created_at = now_millis();

            registry.active_id = Some(entry.id.clone());
            registry.workspaces.push(entry.clone());
            Ok((entry, true))
        })
        .map(|entry| marked(&app, entry))
    })
    .await
}

/// Switches the active project.
#[tauri::command]
pub async fn set_active_workspace(app: tauri::AppHandle, id: String) -> AppResult<WorkspaceEntry> {
    blocking(move || {
        update_registry(&app, |registry| {
            let entry = registry
                .workspaces
                .iter()
                .find(|item| item.id == id)
                .cloned()
                .ok_or_else(|| {
                    AppError::new(
                        ErrorKind::NotFound,
                        "That workspace is no longer registered.",
                    )
                })?;

            registry.active_id = Some(entry.id.clone());
            Ok((entry, true))
        })
        .map(|entry| marked(&app, entry))
    })
    .await
}

/// Forgets a project.
///
/// The files stay on disk unless `delete_files` is set, and then only for a
/// folder ForgeSF created for an org inside its own app data — otherwise the
/// app-data tree grows a dead folder per org that nothing can ever clear. A
/// folder the user picked is theirs and is never deleted, whatever the caller
/// asks for.
#[tauri::command]
pub async fn remove_workspace(
    app: tauri::AppHandle,
    id: String,
    delete_files: Option<bool>,
) -> AppResult<WorkspaceRegistry> {
    blocking(move || {
        let doomed = update_registry(&app, |registry| {
            let removed = registry
                .workspaces
                .iter()
                .position(|item| item.id == id)
                .map(|index| registry.workspaces.remove(index));

            // Removing the active project promotes the next one, if any.
            if registry.active_id.as_deref() == Some(id.as_str()) {
                registry.active_id = registry.workspaces.first().map(|item| item.id.clone());
            }

            Ok(((registry.clone(), removed), true))
        })?;

        let (mut registry, removed) = doomed;

        if delete_files == Some(true) {
            let entry = removed.ok_or_else(|| {
                AppError::new(
                    ErrorKind::NotFound,
                    "That workspace is no longer registered.",
                )
            })?;
            let path = PathBuf::from(&entry.path);
            let root = org_workspaces_root(&app)?;
            if !is_managed_workspace(&root, &path) {
                return Err(AppError::new(
                    ErrorKind::Failed,
                    format!(
                        "{} is your own folder, so ForgeSF will not delete it. The entry has \
                         been removed; delete the folder yourself if you meant to.",
                        entry.path
                    ),
                ));
            }
            if path.is_dir() {
                std::fs::remove_dir_all(&path).map_err(|error| {
                    AppError::new(
                        ErrorKind::Failed,
                        format!(
                            "Removed the entry, but could not delete {}: {error}",
                            entry.path
                        ),
                    )
                })?;
            }
        }

        mark_managed(&app, &mut registry);
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
) -> AppResult<WorkspaceRegistry> {
    blocking(move || {
        let trimmed = name.trim().to_string();
        if trimmed.is_empty() {
            return Err("A workspace name cannot be empty.".into());
        }

        update_registry(&app, |registry| {
            let entry = registry
                .workspaces
                .iter_mut()
                .find(|item| item.id == id)
                .ok_or_else(|| {
                    AppError::new(
                        ErrorKind::NotFound,
                        "That workspace is no longer registered.",
                    )
                })?;
            entry.name = trimmed;

            Ok((registry.clone(), true))
        })
        .map(|mut registry| {
            mark_managed(&app, &mut registry);
            registry
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
) -> AppResult<()> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{cleanup, scratch_dir};
    use std::fs;

    #[test]
    fn a_picked_folder_reports_whether_it_is_a_project() {
        let dir = scratch_dir("picked");
        let folder = picked_folder(&dir);
        assert_eq!(folder.path, dir.to_string_lossy());
        assert!(folder.name.starts_with("forgesf-test-picked-"));
        assert!(!folder.is_salesforce_project);

        fs::write(dir.join("sfdx-project.json"), "{}").unwrap();
        assert!(picked_folder(&dir).is_salesforce_project);
        cleanup(&[&dir]);
    }
}
