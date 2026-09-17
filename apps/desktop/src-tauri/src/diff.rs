//! Diff Check: retrieving the org's copy of workspace files into a session
//! folder and comparing the two.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::metadata::{retrieve_warnings, RETRIEVE_TIMEOUT};
use crate::sf::discover::sf_command;
use crate::sf::json::parse_sf_json;
use crate::sf::runner::{run_with_limits, RunGuard};
use crate::util::{blocking, now_millis};
use crate::workspace::paths::{
    is_ignored_path, real_root, resolve_in_workspace, to_relative_string, walk_skips_link,
};
use crate::workspace::registry::workspace_root;
use crate::workspace::sfdx_project::{package_directories, source_api_version};
use crate::workspace::text::looks_binary;

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

/// Folder names the two sides of an org comparison retrieve into.
const SOURCE_SIDE: &str = "source";
const TARGET_SIDE: &str = "target";

fn diff_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    Ok(data_dir.join("diff"))
}

/// Removes every previous Diff Check session.
#[tauri::command]
pub async fn clear_diff_sessions(app: tauri::AppHandle) -> AppResult<()> {
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
pub(crate) fn files_under(root: &Path, path: &Path, out: &mut Vec<String>) {
    collect_files(root, &real_root(root), path, out);
}

fn collect_files(root: &Path, real_root: &Path, path: &Path, out: &mut Vec<String>) {
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
        if is_ignored_path(Path::new(&entry.file_name())) || walk_skips_link(real_root, &entry) {
            continue;
        }
        collect_files(root, real_root, &entry.path(), out);
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
pub(crate) type DiffSide = Vec<(String, Option<String>)>;

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
) -> AppResult<DiffSession> {
    blocking(move || {
        let run = RunGuard::begin(run_id);
        let workspace = workspace_root(&app, workspace_id.as_deref())?;
        let target = resolve_in_workspace(&workspace, &path)?;
        if !target.exists() {
            return Err(AppError::new(
                ErrorKind::NotFound,
                format!("'{path}' no longer exists in the workspace."),
            ));
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
            return Err(format!("'{relative}' contains no Salesforce metadata to compare.").into());
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

/// Compares the same metadata in two orgs.
///
/// Retrieves the manifest into two scratch projects — one per org — and
/// classifies one against the other, reusing the engine Diff Check uses. The
/// workspace is never touched: this compares orgs, not what is on disk.
#[tauri::command]
pub async fn compare_orgs(
    app: tauri::AppHandle,
    source_username: String,
    target_username: String,
    manifest_path: String,
    workspace_id: Option<String>,
    run_id: Option<String>,
) -> AppResult<DiffSession> {
    blocking(move || {
        if source_username == target_username {
            return Err("Choose two different orgs to compare.".into());
        }

        let run = RunGuard::begin(run_id);
        let workspace = workspace_root(&app, workspace_id.as_deref())?;
        let manifest = resolve_in_workspace(&workspace, &manifest_path)?;
        if !manifest.is_file() {
            return Err(AppError::new(
                ErrorKind::NotFound,
                format!("'{manifest_path}' is not a manifest in this workspace."),
            ));
        }

        let xml = fs::read_to_string(&manifest).unwrap_or_default();
        if !manifest_has_types(&xml) {
            return Err(format!("'{manifest_path}' names no metadata to compare.").into());
        }

        // The package directory both sides use. Retrieves land in the default
        // layout, so the same one on each side keeps paths comparable.
        let package_dir = package_directories(&workspace)
            .into_iter()
            .next()
            .unwrap_or_else(|| "force-app".to_string());

        let session_id = format!("{}{}", now_millis(), std::process::id());
        let session_dir = diff_root(&app)?.join(&session_id);

        let mut sides = Vec::new();
        for (name, username) in [
            (SOURCE_SIDE, &source_username),
            (TARGET_SIDE, &target_username),
        ] {
            let side_dir = session_dir.join(name);
            write_session_project(&side_dir, &workspace, &package_dir)?;

            let mut retrieve = sf_command()?;
            retrieve.args(["project", "retrieve", "start", "--manifest"]);
            retrieve.arg(&manifest);
            retrieve.args(["--target-org", username, "--wait", "20", "--json"]);
            retrieve.current_dir(&side_dir);
            let output = run_with_limits(retrieve, None, &run.cancelled, RETRIEVE_TIMEOUT)?;
            parse_sf_json(&output).map_err(|error| {
                AppError::new(
                    error.kind,
                    format!("Retrieving from {username} failed: {}", error.message),
                )
            })?;

            let warnings: Vec<String> = retrieve_warnings(&output.stdout)
                .into_values()
                .flatten()
                .map(|warning| format!("{username}: {warning}"))
                .collect();

            let mut files = Vec::new();
            files_under(&side_dir, &side_dir.join(&package_dir), &mut files);
            let read: DiffSide = files
                .into_iter()
                .map(|file| {
                    let text = read_text(&side_dir.join(&file));
                    // Paths are reported with the side folder, so `read_diff_pair`
                    // can find each copy inside the one session.
                    (format!("{name}/{file}"), text)
                })
                .collect();
            sides.push((read, warnings));
        }

        let (target, target_warnings) = sides.pop().expect("both sides retrieved");
        let (source, source_warnings) = sides.pop().expect("both sides retrieved");

        // The source org is the "local" side, so a component only it has reads
        // as localOnly — what the UI labels with the source org's name.
        let entries = classify_diff(strip_side(source, SOURCE_SIDE), target)
            .into_iter()
            .map(|mut entry| {
                // The target's path keeps its side folder for `read_diff_pair`;
                // the entry's own path is the one a person reads.
                entry.org_path = Some(
                    entry
                        .org_path
                        .unwrap_or_else(|| format!("{TARGET_SIDE}/{}", entry.path)),
                );
                entry
            })
            .collect();

        Ok(DiffSession {
            session_id,
            target: manifest_path,
            entries,
            warnings: source_warnings.into_iter().chain(target_warnings).collect(),
        })
    })
    .await
}

/// Drops the side folder from a side's paths, so entries read as plain
/// workspace-relative paths.
fn strip_side(side: DiffSide, name: &str) -> DiffSide {
    let prefix = format!("{name}/");
    side.into_iter()
        .map(|(path, text)| {
            (
                path.strip_prefix(&prefix).unwrap_or(&path).to_string(),
                text,
            )
        })
        .collect()
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
) -> AppResult<DiffPair> {
    blocking(move || {
        let workspace = workspace_root(&app, workspace_id.as_deref())?;

        // The id is digits only and the session always lives in the app's own
        // diff folder, so no request can read outside it.
        if !valid_session_id(&session_id) {
            return Err("Unknown diff session.".into());
        }
        let session = diff_root(&app)?.join(&session_id);
        if !session.is_dir() {
            return Err(AppError::new(
                ErrorKind::NotFound,
                "That diff session has been closed.",
            ));
        }

        // An org comparison holds both sides in the session; a Diff Check's
        // local side is the workspace file itself.
        let compared = session.join(SOURCE_SIDE).is_dir();
        let local_path = if compared {
            resolve_in_workspace(&session, &format!("{SOURCE_SIDE}/{path}"))?
        } else {
            resolve_in_workspace(&workspace, &path)?
        };
        let org_path = resolve_in_workspace(&session, org_path.as_deref().unwrap_or(&path))?;

        Ok(DiffPair {
            local: read_text(&local_path).unwrap_or_default(),
            org: read_text(&org_path).unwrap_or_default(),
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    use crate::util::next_temp_suffix;
    use crate::workspace::sfdx_project::{package_directories, source_api_version};

    fn side(files: &[(&str, Option<&str>)]) -> DiffSide {
        files
            .iter()
            .map(|(path, text)| (path.to_string(), text.map(str::to_string)))
            .collect()
    }

    #[test]
    fn comparing_two_orgs_reads_each_side_from_its_own_folder() {
        // Each side retrieves into its own folder inside one session, so both
        // copies of a file can be read back without touching the workspace.
        let source = side(&[
            ("source/force-app/A.cls", Some("shared")),
            ("source/force-app/OnlyHere.cls", Some("one side")),
        ]);
        let target = side(&[
            ("target/force-app/A.cls", Some("different")),
            ("target/force-app/OnlyThere.cls", Some("other side")),
        ]);

        let stripped = strip_side(source, SOURCE_SIDE);
        assert_eq!(
            stripped.iter().map(|(p, _)| p.as_str()).collect::<Vec<_>>(),
            vec!["force-app/A.cls", "force-app/OnlyHere.cls"],
            "the source side reads as plain paths"
        );

        let entries = classify_diff(stripped, target);
        let by_path = statuses(&entries);
        assert!(by_path.contains(&(
            "force-app/OnlyHere.cls".to_string(),
            "localOnly".to_string()
        )));
        assert!(by_path.contains(&(
            "target/force-app/OnlyThere.cls".to_string(),
            "orgOnly".to_string()
        )));
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
}
