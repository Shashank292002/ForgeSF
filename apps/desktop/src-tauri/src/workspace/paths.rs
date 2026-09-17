//! Keeping paths inside a workspace, and the entries the app never shows.

use std::fs;
use std::path::{Component, Path, PathBuf};

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

/// The workspace root with any links in its own path resolved, for comparing
/// against where a link inside it leads.
pub(crate) fn real_root(root: &Path) -> PathBuf {
    fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf())
}

/// Whether `path` is a symbolic link or junction that leads outside the
/// workspace whose resolved root is `real_root`. A link whose target can't be
/// resolved counts as outside: the target could be created there later.
pub(crate) fn link_leaves(real_root: &Path, path: &Path) -> bool {
    let is_link =
        fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_symlink());
    is_link && !fs::canonicalize(path).is_ok_and(|target| target.starts_with(real_root))
}

/// Whether a walk over the workspace (change tracking, Diff Check) passes over
/// `entry`. A link to a file inside the workspace counts as that file; every
/// other link is skipped. A link out of the workspace must never be read
/// through, and following links to folders can loop forever.
pub(crate) fn walk_skips_link(real_root: &Path, entry: &fs::DirEntry) -> bool {
    if !entry.file_type().is_ok_and(|kind| kind.is_symlink()) {
        return false;
    }
    let path = entry.path();
    link_leaves(real_root, &path) || path.is_dir()
}

/// Joins a relative path with the workspace root, rejecting any attempt to
/// escape the workspace directory (absolute paths, `..`, drive prefixes, and
/// links that lead outside it).
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

    let full_path = root.join(&normalized);
    if !full_path.starts_with(root) {
        return Err(format!("Path '{relative}' escapes the workspace root."));
    }

    // `..` can't get out, but a symbolic link or junction inside the workspace
    // can point anywhere: a cloned repository could carry one to the user's
    // home folder, and reads and writes would follow it. Each part of the path
    // that exists must stay inside.
    let mut resolved_root = None;
    let mut step = root.to_path_buf();
    for part in normalized.components() {
        step.push(part);
        let Ok(metadata) = fs::symlink_metadata(&step) else {
            // Nothing exists below a missing part, so there is no link to follow.
            break;
        };
        if metadata.file_type().is_symlink() {
            let resolved_root = resolved_root.get_or_insert_with(|| real_root(root));
            if link_leaves(resolved_root, &step) {
                return Err(format!(
                    "'{relative}' goes through a link to a location outside the workspace."
                ));
            }
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{cleanup, scratch_dir};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::{Command, Stdio};

    use crate::diff::files_under;

    use crate::workspace::tree::read_directory;

    /// A throwaway workspace containing `classes/A.cls`.
    fn scratch_workspace(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("forgesf-test-{name}"));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("classes")).unwrap();
        fs::write(root.join("classes/A.cls"), "public class A {}").unwrap();
        root
    }

    /// A link to a folder: a symbolic link on Unix, a junction on Windows
    /// (junctions need no special privilege, and behave the same way here).
    fn link_folder(target: &Path, link: &Path) {
        #[cfg(unix)]
        std::os::unix::fs::symlink(target, link).unwrap();
        #[cfg(windows)]
        {
            // cmd reads a `/` inside a path as the start of a switch.
            let windows_path = |path: &Path| path.to_string_lossy().replace('/', "\\");
            let status = Command::new("cmd")
                .arg("/C")
                .arg("mklink")
                .arg("/J")
                .arg(windows_path(link))
                .arg(windows_path(target))
                .stdout(Stdio::null())
                .status()
                .unwrap();
            assert!(status.success(), "mklink /J failed");
        }
    }

    /// A workspace whose `force-app` holds a real class, a link to a folder
    /// outside the workspace, and a link to another folder inside it.
    fn workspace_with_links() -> (PathBuf, PathBuf) {
        let root = scratch_dir("ws");
        let outside = scratch_dir("outside");
        fs::write(outside.join("secret.txt"), "not for the workspace").unwrap();

        let classes = root.join("force-app/main/default/classes");
        fs::create_dir_all(&classes).unwrap();
        fs::write(classes.join("Real.cls"), "public class Real {}").unwrap();

        link_folder(&outside, &root.join("force-app/outside"));
        link_folder(&classes, &root.join("force-app/inner"));
        (root, outside)
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

    #[test]
    fn a_path_through_a_link_out_of_the_workspace_is_refused() {
        let (root, outside) = workspace_with_links();

        for path in [
            "force-app/outside",
            "force-app/outside/secret.txt",
            "force-app/outside/new-file.txt",
            "./force-app/main/../outside/secret.txt",
        ] {
            let error = resolve_in_workspace(&root, path).unwrap_err();
            assert!(error.contains("outside the workspace"), "{path}: {error}");
        }

        // Ordinary paths, new files and links that stay inside all resolve.
        for path in [
            "force-app/main/default/classes/Real.cls",
            "force-app/main/default/classes/New.cls",
            "force-app/inner/Real.cls",
            "does/not/exist/yet.txt",
        ] {
            assert!(resolve_in_workspace(&root, path).is_ok(), "{path}");
        }
        cleanup(&[&root, &outside]);
    }

    #[test]
    fn a_link_whose_target_is_gone_is_refused() {
        let root = scratch_dir("dangling");
        let target = scratch_dir("dangling-target");
        link_folder(&target, &root.join("gone"));
        fs::remove_dir_all(&target).unwrap();

        assert!(resolve_in_workspace(&root, "gone/file.txt").is_err());
        cleanup(&[&root]);
    }

    #[test]
    fn walks_never_follow_a_link_out_of_the_workspace() {
        let (root, outside) = workspace_with_links();

        let mut files = Vec::new();
        files_under(&root, &root.join("force-app"), &mut files);
        assert_eq!(files, vec!["force-app/main/default/classes/Real.cls"]);

        // The explorer still lists the link, but offers nothing inside it.
        let nodes = read_directory(&root, &real_root(&root), &root.join("force-app"), 1).unwrap();
        let outside_node = nodes.iter().find(|node| node.name == "outside").unwrap();
        assert!(!outside_node.has_children);
        let inner_node = nodes.iter().find(|node| node.name == "inner").unwrap();
        assert!(inner_node.has_children);
        cleanup(&[&root, &outside]);
    }
}
