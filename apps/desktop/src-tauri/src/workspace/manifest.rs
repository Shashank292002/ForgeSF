//! `package.xml` files: making them, finding them, and retrieving from them.
//!
//! A manifest is the portable way to say "this set of metadata": it can be
//! committed, shared, and used by both a retrieve and a deploy. ForgeSF builds
//! them with `sf project generate manifest` rather than writing the XML, so
//! the API version and the type names are the CLI's.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::sf::discover::sf_command;
use crate::sf::json::parse_sf_json;
use crate::sf::runner::{run_with_limits, RunGuard};
use crate::util::blocking;
use crate::workspace::paths::{resolve_in_workspace, resolve_paths, to_relative_string};
use crate::workspace::registry::workspace_root;

/// Building a manifest is local, but it starts Node.
const GENERATE_TIMEOUT: Duration = Duration::from_secs(120);
/// A retrieve by manifest can pull a lot; it gets the same room as any other.
const RETRIEVE_TIMEOUT: Duration = Duration::from_secs(60 * 20);

/// Where manifests are kept by convention, and where ForgeSF writes them.
const MANIFEST_DIR: &str = "manifest";

/// One manifest in the workspace.
#[derive(TS, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ManifestFile {
    /// Workspace-relative, with `/` separators.
    pub path: String,
    /// The file's own name, without its folder.
    pub name: String,
    /// The metadata types it names, for a one-line summary.
    #[ts(type = "string[]")]
    pub types: Vec<String>,
    #[ts(type = "number")]
    pub member_count: i64,
}

/// The `<name>` of every `<types>` block, and how many members they hold.
///
/// Read with a scan rather than an XML parser: a manifest is a flat, known
/// shape, and a malformed one should still list rather than fail.
fn summarise(xml: &str) -> (Vec<String>, i64) {
    let mut types = Vec::new();
    let mut members = 0;

    for chunk in xml.split("<types>").skip(1) {
        let block = chunk.split("</types>").next().unwrap_or_default();
        members += block.matches("<members>").count() as i64;
        if let Some(name) = block.split("<name>").nth(1) {
            let name = name.split("</name>").next().unwrap_or_default().trim();
            if !name.is_empty() {
                types.push(name.to_string());
            }
        }
    }

    types.sort_unstable();
    types.dedup();
    (types, members)
}

/// Whether a file is a manifest rather than some other XML in the project.
fn is_manifest(xml: &str) -> bool {
    xml.contains("<Package") && xml.contains("</Package>")
}

/// Every manifest in the workspace: the conventional `manifest/` folder, plus
/// any `package.xml` elsewhere in the project.
#[tauri::command]
pub async fn list_manifests(
    app: tauri::AppHandle,
    workspace_id: Option<String>,
) -> AppResult<Vec<ManifestFile>> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let mut found: Vec<ManifestFile> = Vec::new();

        let mut consider = |path: &Path| {
            let Ok(xml) = std::fs::read_to_string(path) else {
                return;
            };
            if !is_manifest(&xml) {
                return;
            }
            let (types, member_count) = summarise(&xml);
            found.push(ManifestFile {
                path: to_relative_string(&root, path),
                name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().to_string())
                    .unwrap_or_default(),
                types,
                member_count,
            });
        };

        if let Ok(entries) = std::fs::read_dir(root.join(MANIFEST_DIR)) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().is_some_and(|ext| ext == "xml") {
                    consider(&path);
                }
            }
        }

        // The one many projects keep at the root.
        let at_root = root.join("package.xml");
        if at_root.is_file() {
            consider(&at_root);
        }

        found.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(found)
    })
    .await
}

/// A file name that cannot climb out of the manifest folder.
fn manifest_name(name: &str) -> AppResult<String> {
    let trimmed = name.trim().trim_end_matches(".xml");
    let safe: String = trimmed
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();

    if safe.is_empty() {
        return Err(AppError::new(
            ErrorKind::Failed,
            "Give the manifest a name of letters, digits, hyphens or underscores.",
        ));
    }
    Ok(safe)
}

/// Builds a manifest from local source folders, metadata specs, or both.
///
/// Writes it into `manifest/` and returns its workspace-relative path.
#[tauri::command]
pub async fn generate_manifest(
    app: tauri::AppHandle,
    name: String,
    source_paths: Option<Vec<String>>,
    metadata: Option<Vec<String>>,
    workspace_id: Option<String>,
) -> AppResult<String> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let name = manifest_name(&name)?;

        let sources = source_paths.unwrap_or_default();
        let specs: Vec<String> = metadata
            .unwrap_or_default()
            .into_iter()
            .map(|spec| spec.trim().to_string())
            .filter(|spec| !spec.is_empty())
            .collect();

        if sources.is_empty() && specs.is_empty() {
            return Err(AppError::new(
                ErrorKind::Failed,
                "Choose some source or metadata for the manifest to describe.",
            ));
        }

        // Resolved inside the workspace, so a path from the page cannot reach
        // anything else on disk.
        let resolved = resolve_paths(&root, &sources)?;

        let output = root.join(MANIFEST_DIR);
        std::fs::create_dir_all(&output).map_err(|error| error.to_string())?;

        let mut command = sf_command()?;
        command.arg("project").arg("generate").arg("manifest");
        command.arg("--name").arg(&name);
        command.arg("--output-dir").arg(MANIFEST_DIR);
        for path in resolved {
            command.arg("--source-dir").arg(path);
        }
        for spec in specs {
            command.arg("--metadata").arg(spec);
        }
        command.arg("--json");
        command.current_dir(&root);

        let output = run_with_limits(command, None, &Default::default(), GENERATE_TIMEOUT)?;
        parse_sf_json(&output)?;

        let written: PathBuf = root.join(MANIFEST_DIR).join(format!("{name}.xml"));
        if !written.is_file() {
            return Err(AppError::new(
                ErrorKind::Failed,
                "The CLI reported success but wrote no manifest.",
            ));
        }
        Ok(to_relative_string(&root, &written))
    })
    .await
}

/// Retrieves everything a manifest names into the workspace.
#[tauri::command]
pub async fn retrieve_manifest(
    app: tauri::AppHandle,
    username: String,
    manifest_path: String,
    workspace_id: Option<String>,
    run_id: Option<String>,
) -> AppResult<Vec<String>> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let manifest = resolve_in_workspace(&root, &manifest_path)?;
        if !manifest.is_file() {
            return Err(AppError::new(
                ErrorKind::NotFound,
                format!("{manifest_path} is not a file in this workspace."),
            ));
        }
        let run = RunGuard::begin(run_id);

        let mut command = sf_command()?;
        command.arg("project").arg("retrieve").arg("start");
        command.arg("--manifest").arg(&manifest);
        command.arg("--target-org").arg(&username);
        command.arg("--json");
        command.current_dir(&root);

        let output = run_with_limits(command, None, &run.cancelled, RETRIEVE_TIMEOUT)?;
        let json = parse_sf_json(&output)?;

        let files = json["result"]["files"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .filter_map(|file| file["filePath"].as_str())
            .map(|path| to_relative_string(&root, Path::new(path)))
            .collect();
        Ok(files)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    const PACKAGE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<Package xmlns="http://soap.sforce.com/2006/04/metadata">
    <types>
        <members>AccountService</members>
        <members>ContactService</members>
        <name>ApexClass</name>
    </types>
    <types>
        <members>*</members>
        <name>CustomObject</name>
    </types>
    <version>67.0</version>
</Package>
"#;

    #[test]
    fn a_manifest_is_summarised_by_its_types_and_members() {
        let (types, members) = summarise(PACKAGE);
        assert_eq!(types, vec!["ApexClass", "CustomObject"]);
        assert_eq!(members, 3);

        // Nothing in it is not an error.
        assert_eq!(summarise(""), (Vec::<String>::new(), 0));
    }

    #[test]
    fn only_a_package_document_counts_as_a_manifest() {
        assert!(is_manifest(PACKAGE));
        // An Apex class's metadata file is XML in the same project.
        assert!(!is_manifest(
            r#"<?xml version="1.0"?><ApexClass><apiVersion>67.0</apiVersion></ApexClass>"#
        ));
    }

    #[test]
    fn a_manifest_name_cannot_escape_its_folder() {
        assert_eq!(manifest_name("release-1").unwrap(), "release-1");
        assert_eq!(manifest_name(" release-1.xml ").unwrap(), "release-1");
        // A path, or anything that would leave the manifest folder, is stripped.
        assert_eq!(manifest_name("../../etc/passwd").unwrap(), "etcpasswd");
        assert!(manifest_name("   ").is_err());
        assert!(manifest_name("../..").is_err());
    }
}
