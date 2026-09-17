//! Which workspace files differ from what was last synced with the org.
//!
//! "Pending Changes" used to list only unsaved editor buffers: a file dropped
//! off the list the moment it was saved, although it had never been deployed.
//! Each workspace now keeps a snapshot — a content hash per file under its
//! package directories — taken when files were last retrieved from or
//! deployed to the org. Comparing the tree with it gives modified, added and
//! deleted files. When the folder is a git repository, `git status` is
//! reported alongside.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use std::time::{Duration, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use ts_rs::TS;

use crate::error::AppResult;
use crate::sf::discover::hide_console;
use crate::sf::runner::run_with_limits;
use crate::util::{blocking, lock, now_millis, write_atomic};
use crate::workspace::paths::{
    is_ignored_path, real_root, resolve_in_workspace, to_relative_string, walk_skips_link,
};
use crate::workspace::registry::workspace_root;
use crate::workspace::sfdx_project::package_directories;

/// Files that differ from the last sync with the org.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct WorkspaceChanges {
    /// When the snapshot was first taken; `None` until the workspace has been
    /// synced (retrieved into, deployed from, or marked) once.
    #[ts(type = "number | null")]
    pub baseline_at: Option<u64>,
    pub modified: Vec<String>,
    pub added: Vec<String>,
    pub deleted: Vec<String>,
    /// `git status` for the package directories, when the folder is a repo.
    pub git: Option<Vec<GitChange>>,
}

#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct GitChange {
    /// The two-letter porcelain code, e.g. ` M`, `??`, `A `.
    pub status: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
struct Stamp {
    hash: String,
    size: u64,
    modified: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Snapshot {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    taken_at: u64,
    #[serde(default)]
    files: BTreeMap<String, Stamp>,
}

static SNAPSHOT_LOCK: Mutex<()> = Mutex::new(());

/// FNV-1a, 64-bit. Stable across Rust versions — unlike `DefaultHasher` —
/// which matters for hashes kept on disk. Change detection, not security.
pub(crate) fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn snapshot_path(app: &tauri::AppHandle, root: &Path) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("snapshots");
    // Keyed by the folder, so a workspace keeps its baseline across renames
    // of its display name.
    let key = root.to_string_lossy().replace('\\', "/").to_lowercase();
    Ok(dir.join(format!("{:016x}.json", fnv1a64(key.as_bytes()))))
}

fn read_snapshot(path: &Path) -> Option<Snapshot> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_snapshot(path: &Path, snapshot: &Snapshot) -> Result<(), String> {
    let json = serde_json::to_string(snapshot).map_err(|error| error.to_string())?;
    write_atomic(path, json.as_bytes())
}

fn modified_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Stamps one file, reusing `previous` when size and mtime are unchanged so a
/// rescan does not re-read every file.
fn stamp(path: &Path, previous: Option<&Stamp>) -> Option<Stamp> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let size = metadata.len();
    let modified = modified_millis(&metadata);
    if let Some(previous) = previous {
        if previous.size == size && previous.modified == modified {
            return Some(previous.clone());
        }
    }
    let bytes = fs::read(path).ok()?;
    Some(Stamp {
        hash: format!("{:016x}", fnv1a64(&bytes)),
        size,
        modified,
    })
}

fn walk(
    root: &Path,
    real_root: &Path,
    dir: &Path,
    previous: Option<&Snapshot>,
    out: &mut BTreeMap<String, Stamp>,
) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if is_ignored_path(Path::new(&entry.file_name())) || walk_skips_link(real_root, &entry) {
            continue;
        }
        if path.is_dir() {
            walk(root, real_root, &path, previous, out);
        } else {
            let relative = to_relative_string(root, &path);
            let prior = previous.and_then(|snapshot| snapshot.files.get(&relative));
            if let Some(stamp) = stamp(&path, prior) {
                out.insert(relative, stamp);
            }
        }
    }
}

/// Every file under the workspace's package directories.
fn scan(root: &Path, previous: Option<&Snapshot>) -> BTreeMap<String, Stamp> {
    let real_root = real_root(root);
    let mut files = BTreeMap::new();
    for dir in package_directories(root) {
        // `sfdx-project.json` names these; one pointing out of the workspace
        // (`../..`) is not followed.
        if let Ok(path) = resolve_in_workspace(root, &dir) {
            walk(root, &real_root, &path, previous, &mut files);
        }
    }
    files
}

/// Modified, added and deleted paths between a snapshot and the current tree.
fn compare(
    baseline: &BTreeMap<String, Stamp>,
    current: &BTreeMap<String, Stamp>,
) -> (Vec<String>, Vec<String>, Vec<String>) {
    let mut modified = Vec::new();
    let mut added = Vec::new();
    for (path, stamp) in current {
        match baseline.get(path) {
            Some(old) if old.hash != stamp.hash => modified.push(path.clone()),
            Some(_) => {}
            None => added.push(path.clone()),
        }
    }
    let deleted = baseline
        .keys()
        .filter(|path| !current.contains_key(*path))
        .cloned()
        .collect();
    (modified, added, deleted)
}

/// Marks files as matching the org after a retrieve or deploy.
///
/// With no snapshot yet, the whole tree is taken as the baseline: a workspace
/// that has just been retrieved into (or deployed from) is, as far as anyone
/// can tell, in step with the org. Later syncs only touch the files they
/// wrote, so unrelated local edits stay pending.
///
/// `modified_before` is when a deploy read the files. A file saved after that
/// is newer than what reached the org, so it stays pending — otherwise an edit
/// made while a long deploy ran its tests vanished from the list when the
/// deploy finished.
pub(crate) fn record_synced_files(
    app: &tauri::AppHandle,
    root: &Path,
    files: &[String],
    modified_before: Option<u64>,
) -> Result<(), String> {
    record_synced_files_at(&snapshot_path(app, root)?, root, files, modified_before)
}

fn record_synced_files_at(
    path: &Path,
    root: &Path,
    files: &[String],
    modified_before: Option<u64>,
) -> Result<(), String> {
    let _guard = lock(&SNAPSHOT_LOCK);
    let mut snapshot = match read_snapshot(path) {
        Some(snapshot) => snapshot,
        None => {
            let snapshot = Snapshot {
                version: 1,
                taken_at: now_millis(),
                files: scan(root, None),
            };
            return write_snapshot(path, &snapshot);
        }
    };

    for file in files {
        let relative = file.replace('\\', "/");
        let absolute = root.join(&relative);
        match stamp(&absolute, None) {
            Some(stamp) if modified_before.is_some_and(|limit| stamp.modified > limit) => {}
            Some(stamp) => {
                snapshot.files.insert(relative, stamp);
            }
            None => {
                snapshot.files.remove(&relative);
            }
        }
    }
    write_snapshot(path, &snapshot)
}

fn changes_at(path: &Path, root: &Path) -> WorkspaceChanges {
    let _guard = lock(&SNAPSHOT_LOCK);
    let Some(snapshot) = read_snapshot(path) else {
        return WorkspaceChanges {
            baseline_at: None,
            modified: Vec::new(),
            added: Vec::new(),
            deleted: Vec::new(),
            git: None,
        };
    };
    let current = scan(root, Some(&snapshot));
    let (modified, added, deleted) = compare(&snapshot.files, &current);
    WorkspaceChanges {
        baseline_at: Some(snapshot.taken_at),
        modified,
        added,
        deleted,
        git: None,
    }
}

/// Parses `git status --porcelain=v1 -z`.
fn parse_porcelain(output: &str) -> Vec<GitChange> {
    let mut changes = Vec::new();
    let mut entries = output.split('\0').filter(|entry| !entry.is_empty());
    while let Some(entry) = entries.next() {
        if entry.len() < 4 {
            continue;
        }
        let status = entry[..2].to_string();
        // Renames and copies are followed by the original path.
        if status.contains('R') || status.contains('C') {
            entries.next();
        }
        changes.push(GitChange {
            status,
            path: entry[3..].to_string(),
        });
    }
    changes
}

fn git_status(root: &Path) -> Option<Vec<GitChange>> {
    if !root.join(".git").exists() {
        return None;
    }
    let mut command = Command::new("git");
    hide_console(&mut command);
    command
        .args([
            // A repository's own config can name a program for `git status` to
            // start (`core.fsmonitor`). A copied-in `.git` folder must not get
            // to run one just because its folder was opened.
            "-c",
            "core.fsmonitor=false",
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
        ])
        .args(package_directories(root))
        .current_dir(root);
    let output = run_with_limits(
        command,
        None,
        &AtomicBool::new(false),
        Duration::from_secs(20),
    )
    .ok()?;
    output
        .status
        .success()
        .then(|| parse_porcelain(&String::from_utf8_lossy(&output.stdout)))
}

/// Files changed since the workspace was last synced with its org.
#[tauri::command]
pub async fn workspace_changes(
    app: tauri::AppHandle,
    workspace_id: Option<String>,
) -> AppResult<WorkspaceChanges> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let mut changes = changes_at(&snapshot_path(&app, &root)?, &root);
        changes.git = git_status(&root);
        Ok(changes)
    })
    .await
}

/// Takes the current tree as matching the org, clearing pending changes.
#[tauri::command]
pub async fn reset_workspace_baseline(
    app: tauri::AppHandle,
    workspace_id: Option<String>,
) -> AppResult<WorkspaceChanges> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let path = snapshot_path(&app, &root)?;
        {
            let _guard = lock(&SNAPSHOT_LOCK);
            let snapshot = Snapshot {
                version: 1,
                taken_at: now_millis(),
                files: scan(&root, None),
            };
            write_snapshot(&path, &snapshot)?;
        }
        let mut changes = changes_at(&path, &root);
        changes.git = git_status(&root);
        Ok(changes)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "forgesf-changes-{name}-{}",
            crate::util::next_temp_suffix()
        ));
        fs::create_dir_all(root.join("force-app/main/default/classes")).unwrap();
        fs::write(
            root.join("sfdx-project.json"),
            r#"{"packageDirectories":[{"path":"force-app","default":true}]}"#,
        )
        .unwrap();
        fs::write(
            root.join("force-app/main/default/classes/A.cls"),
            "class A {}",
        )
        .unwrap();
        fs::write(
            root.join("force-app/main/default/classes/B.cls"),
            "class B {}",
        )
        .unwrap();
        fs::write(root.join("README.md"), "outside the package directory").unwrap();
        root
    }

    #[test]
    fn fnv1a_matches_the_reference_vectors() {
        assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
        assert_eq!(fnv1a64(b"foobar"), 0x85944171f73967e8);
    }

    #[test]
    fn without_a_snapshot_there_is_no_baseline() {
        let root = workspace("none");
        let snapshot = root.join("snapshot.json");
        let changes = changes_at(&snapshot, &root);
        assert_eq!(changes.baseline_at, None);
        assert!(changes.modified.is_empty() && changes.added.is_empty());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn edits_additions_and_deletions_show_after_a_sync() {
        let root = workspace("diff");
        let snapshot = root.join("../").join(format!(
            "forgesf-snapshot-{}.json",
            crate::util::next_temp_suffix()
        ));

        // The first sync takes the whole tree as the baseline.
        record_synced_files_at(&snapshot, &root, &[], None).unwrap();
        assert!(changes_at(&snapshot, &root).modified.is_empty());

        fs::write(
            root.join("force-app/main/default/classes/A.cls"),
            "class A { void x() {} }",
        )
        .unwrap();
        fs::write(
            root.join("force-app/main/default/classes/C.cls"),
            "class C {}",
        )
        .unwrap();
        fs::remove_file(root.join("force-app/main/default/classes/B.cls")).unwrap();
        fs::write(root.join("README.md"), "changed, but not metadata").unwrap();

        let changes = changes_at(&snapshot, &root);
        assert!(changes.baseline_at.is_some());
        assert_eq!(
            changes.modified,
            vec!["force-app/main/default/classes/A.cls"]
        );
        assert_eq!(changes.added, vec!["force-app/main/default/classes/C.cls"]);
        assert_eq!(
            changes.deleted,
            vec!["force-app/main/default/classes/B.cls"]
        );

        // Deploying A and C (and B's deletion) syncs only those files.
        record_synced_files_at(
            &snapshot,
            &root,
            &[
                "force-app/main/default/classes/A.cls".to_string(),
                "force-app/main/default/classes/C.cls".to_string(),
                "force-app/main/default/classes/B.cls".to_string(),
            ],
            None,
        )
        .unwrap();
        let after = changes_at(&snapshot, &root);
        assert!(after.modified.is_empty() && after.added.is_empty() && after.deleted.is_empty());

        let _ = fs::remove_file(&snapshot);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_partial_sync_leaves_unrelated_edits_pending() {
        let root = workspace("partial");
        let snapshot = root.join("../").join(format!(
            "forgesf-snapshot-{}.json",
            crate::util::next_temp_suffix()
        ));
        record_synced_files_at(&snapshot, &root, &[], None).unwrap();

        fs::write(
            root.join("force-app/main/default/classes/A.cls"),
            "edited A",
        )
        .unwrap();
        fs::write(
            root.join("force-app/main/default/classes/B.cls"),
            "edited B",
        )
        .unwrap();
        record_synced_files_at(
            &snapshot,
            &root,
            &["force-app/main/default/classes/A.cls".to_string()],
            None,
        )
        .unwrap();

        assert_eq!(
            changes_at(&snapshot, &root).modified,
            vec!["force-app/main/default/classes/B.cls"]
        );
        let _ = fs::remove_file(&snapshot);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_file_saved_after_the_deploy_read_it_stays_pending() {
        let root = workspace("late-edit");
        let snapshot = root.join("../").join(format!(
            "forgesf-snapshot-{}.json",
            crate::util::next_temp_suffix()
        ));
        record_synced_files_at(&snapshot, &root, &[], None).unwrap();

        let a = root.join("force-app/main/default/classes/A.cls");
        let b = root.join("force-app/main/default/classes/B.cls");
        fs::write(&a, "deployed edit").unwrap();
        fs::write(&b, "deployed edit").unwrap();
        let read_at = modified_millis(&fs::metadata(&a).unwrap());
        // B is saved again while the deploy runs; its mtime is set explicitly
        // so the test does not depend on the file system's clock resolution.
        fs::write(&b, "edited during the deploy").unwrap();
        fs::File::options()
            .write(true)
            .open(&b)
            .unwrap()
            .set_modified(UNIX_EPOCH + Duration::from_millis(read_at + 60_000))
            .unwrap();

        record_synced_files_at(
            &snapshot,
            &root,
            &[
                "force-app/main/default/classes/A.cls".to_string(),
                "force-app/main/default/classes/B.cls".to_string(),
            ],
            Some(read_at),
        )
        .unwrap();

        assert_eq!(
            changes_at(&snapshot, &root).modified,
            vec!["force-app/main/default/classes/B.cls"]
        );
        let _ = fs::remove_file(&snapshot);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn porcelain_output_is_parsed_including_renames() {
        let output = " M force-app/a.cls\0?? force-app/new.cls\0R  force-app/renamed.cls\0force-app/old.cls\0";
        assert_eq!(
            parse_porcelain(output),
            vec![
                GitChange {
                    status: " M".to_string(),
                    path: "force-app/a.cls".to_string()
                },
                GitChange {
                    status: "??".to_string(),
                    path: "force-app/new.cls".to_string()
                },
                GitChange {
                    status: "R ".to_string(),
                    path: "force-app/renamed.cls".to_string()
                },
            ]
        );
    }

    #[test]
    fn a_package_directory_outside_the_workspace_is_not_scanned() {
        let root = workspace("escape");
        let outside = std::env::temp_dir().join(format!(
            "forgesf-changes-outside-{}",
            crate::util::next_temp_suffix()
        ));
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("Leak.cls"), "class Leak {}").unwrap();
        let name = outside.file_name().unwrap().to_string_lossy().to_string();
        fs::write(
            root.join("sfdx-project.json"),
            format!(r#"{{"packageDirectories":[{{"path":"force-app"}},{{"path":"../{name}"}}]}}"#),
        )
        .unwrap();

        let files: Vec<String> = scan(&root, None).into_keys().collect();
        assert_eq!(
            files,
            vec![
                "force-app/main/default/classes/A.cls",
                "force-app/main/default/classes/B.cls"
            ]
        );
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&outside);
    }
}
