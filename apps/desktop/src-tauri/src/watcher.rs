//! Watches the open workspace, so changes made outside ForgeSF — a git
//! checkout, a retrieve run in a terminal, another editor — reach the explorer
//! and open files without a manual refresh.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::Emitter;
use ts_rs::TS;

use crate::commands::{blocking, is_ignored_path, lock, workspace_root};

/// Emitted as `workspace_fs_changed` when files change in the watched
/// workspace.
#[derive(TS, Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct WorkspaceFsEvent {
    /// The workspace id the watch was started with.
    pub workspace_id: Option<String>,
    /// Workspace-relative paths that changed, without duplicates.
    pub paths: Vec<String>,
    /// Too many changes to list, or events were lost: reload everything.
    pub overflow: bool,
}

pub(crate) const FS_EVENT: &str = "workspace_fs_changed";

/// Events are gathered until the folder has been quiet this long.
const QUIET_PERIOD: Duration = Duration::from_millis(300);
/// …but a steady stream still reports at least this often.
const MAX_DELAY: Duration = Duration::from_secs(2);
/// Past this many paths, a reload is cheaper than following each one.
const MAX_PATHS: usize = 200;

struct ActiveWatch {
    root: PathBuf,
    // Dropping the watcher closes the channel, which ends its thread.
    _watcher: RecommendedWatcher,
}

static ACTIVE: Mutex<Option<ActiveWatch>> = Mutex::new(None);

/// A changed path as the UI names it, or None when it is not worth reporting:
/// outside the workspace, inside an ignored folder such as `.git` or `.sf`, or
/// one of the temporary files a save or rename writes and removes.
pub(crate) fn reportable(root: &Path, path: &Path) -> Option<String> {
    let relative = path.strip_prefix(root).ok()?;
    if relative.as_os_str().is_empty() || is_ignored_path(relative) {
        return None;
    }
    let name = relative.file_name()?.to_string_lossy();
    if name.starts_with('.') && (name.ends_with(".tmp") || name.ends_with(".rename")) {
        return None;
    }
    Some(relative.to_string_lossy().replace('\\', "/"))
}

/// Folds raw event paths into one report: (paths, overflow).
pub(crate) fn batch(root: &Path, paths: impl IntoIterator<Item = PathBuf>) -> (Vec<String>, bool) {
    let unique: BTreeSet<String> = paths
        .into_iter()
        .filter_map(|path| reportable(root, &path))
        .collect();
    if unique.len() > MAX_PATHS {
        (Vec::new(), true)
    } else {
        (unique.into_iter().collect(), false)
    }
}

/// Starts watching a workspace, replacing any earlier watch.
#[tauri::command]
pub async fn watch_workspace(
    app: tauri::AppHandle,
    workspace_id: Option<String>,
) -> Result<(), String> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let mut active = lock(&ACTIVE);
        if active.as_ref().is_some_and(|watch| watch.root == root) {
            return Ok(());
        }
        *active = None;

        let (sender, receiver) = channel::<notify::Result<notify::Event>>();
        let mut watcher = notify::recommended_watcher(sender).map_err(|error| error.to_string())?;
        watcher
            .watch(&root, RecursiveMode::Recursive)
            .map_err(|error| error.to_string())?;

        let thread_root = root.clone();
        std::thread::spawn(move || {
            let mut pending: Vec<PathBuf> = Vec::new();
            let mut lost = false;
            let mut first_at: Option<Instant> = None;

            loop {
                let next = receiver.recv_timeout(QUIET_PERIOD);
                let mut flush = false;
                match next {
                    Ok(Ok(event)) => {
                        if !matches!(event.kind, EventKind::Access(_)) {
                            pending.extend(event.paths);
                            first_at.get_or_insert_with(Instant::now);
                        }
                        flush = first_at.is_some_and(|at| at.elapsed() >= MAX_DELAY);
                    }
                    // The OS dropped events (a buffer overflow): only a full
                    // reload is safe.
                    Ok(Err(_)) => {
                        lost = true;
                        first_at.get_or_insert_with(Instant::now);
                    }
                    Err(RecvTimeoutError::Timeout) => flush = true,
                    Err(RecvTimeoutError::Disconnected) => break,
                }

                if !flush || (pending.is_empty() && !lost) {
                    continue;
                }
                let (paths, overflow) = batch(&thread_root, pending.drain(..));
                first_at = None;
                if paths.is_empty() && !overflow && !lost {
                    continue;
                }
                let _ = app.emit(
                    FS_EVENT,
                    WorkspaceFsEvent {
                        workspace_id: workspace_id.clone(),
                        paths,
                        overflow: overflow || lost,
                    },
                );
                lost = false;
            }
        });

        *active = Some(ActiveWatch {
            root,
            _watcher: watcher,
        });
        Ok(())
    })
    .await
}

/// Stops watching.
#[tauri::command]
pub async fn unwatch_workspace() -> Result<(), String> {
    blocking(|| {
        *lock(&ACTIVE) = None;
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_workspace_changes_worth_showing_are_reported() {
        let root = PathBuf::from(if cfg!(windows) {
            r"C:\ws\acme"
        } else {
            "/ws/acme"
        });
        let at = |relative: &str| root.join(relative);

        assert_eq!(
            reportable(&root, &at("force-app/main/default/classes/Foo.cls")).as_deref(),
            Some("force-app/main/default/classes/Foo.cls")
        );
        // Ignored folders, the root itself, and paths outside it.
        assert_eq!(reportable(&root, &at(".git/index")), None);
        assert_eq!(reportable(&root, &at(".sf/orgs/00D/config.json")), None);
        assert_eq!(reportable(&root, &at("node_modules/x/index.js")), None);
        assert_eq!(reportable(&root, &root), None);
        assert_eq!(reportable(&root, Path::new("/elsewhere/file.cls")), None);
        // Temporary files from an atomic save or a case-only rename.
        assert_eq!(
            reportable(&root, &at("classes/.Foo.cls.1234-17000-3.tmp")),
            None
        );
        assert_eq!(
            reportable(&root, &at("classes/.Foo.cls.1234-17000-3.rename")),
            None
        );
        // An ordinary dotfile still counts.
        assert_eq!(
            reportable(&root, &at(".forceignore")).as_deref(),
            Some(".forceignore")
        );
    }

    #[test]
    fn a_burst_becomes_one_report_and_a_flood_asks_for_a_reload() {
        let root = PathBuf::from(if cfg!(windows) {
            r"C:\ws\acme"
        } else {
            "/ws/acme"
        });
        let (paths, overflow) = batch(
            &root,
            vec![
                root.join("classes/Foo.cls"),
                root.join("classes/Foo.cls"),
                root.join(".git/HEAD"),
                root.join("classes/Bar.cls"),
            ],
        );
        assert_eq!(paths, vec!["classes/Bar.cls", "classes/Foo.cls"]);
        assert!(!overflow);

        let flood = (0..=MAX_PATHS).map(|index| root.join(format!("classes/C{index}.cls")));
        let (paths, overflow) = batch(&root, flood);
        assert!(paths.is_empty() && overflow);
    }
}
