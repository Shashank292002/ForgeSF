//! Listing a workspace's folders for the explorer.

use std::fs;
use std::path::Path;

use serde::Serialize;
use ts_rs::TS;

use crate::error::{AppError, AppResult};
use crate::util::blocking;
use crate::workspace::paths::{
    is_ignored_path, link_leaves, real_root, resolve_in_workspace, to_relative_string,
};
use crate::workspace::registry::workspace_root;

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
pub(crate) fn read_directory(
    root: &Path,
    real_root: &Path,
    path: &Path,
    depth: usize,
) -> Result<Vec<FileNode>, String> {
    let mut nodes = Vec::new();

    for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let entry_path = entry.path();

        if is_ignored_path(Path::new(&entry.file_name())) {
            continue;
        }

        let name = entry.file_name().to_string_lossy().to_string();
        // A link out of the workspace is listed, but nothing is read through it.
        let outside = entry.file_type().is_ok_and(|kind| kind.is_symlink())
            && link_leaves(real_root, &entry_path);

        if entry_path.is_dir() {
            let children = if depth > 1 && !outside {
                Some(read_directory(root, real_root, &entry_path, depth - 1)?)
            } else {
                None
            };
            nodes.push(FileNode {
                name: name.clone(),
                path: to_relative_string(root, &entry_path),
                node_type: "folder".to_string(),
                has_children: !outside
                    && children
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

    // Deterministic ordering — folders first, then files, both alphabetically.
    nodes.sort_by(|a, b| match (a.node_type.as_str(), b.node_type.as_str()) {
        ("folder", "file") => std::cmp::Ordering::Less,
        ("file", "folder") => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(nodes)
}

#[tauri::command]
pub async fn read_workspace(
    app: tauri::AppHandle,
    path: String,
    depth: Option<usize>,
    workspace_id: Option<String>,
) -> AppResult<Vec<FileNode>> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let target = if path.trim().is_empty() {
            root.clone()
        } else {
            resolve_in_workspace(&root, &path)?
        };

        // Default to one level: callers opt into deeper reads explicitly.
        read_directory(&root, &real_root(&root), &target, depth.unwrap_or(1).max(1))
            .map_err(AppError::from)
    })
    .await
}
