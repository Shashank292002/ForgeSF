//! What ForgeSF reads from, and writes to, a project's `sfdx-project.json`.

use std::fs;
use std::path::Path;

/// Whether `root` holds the `sfdx-project.json` that deploy and retrieve need.
pub(crate) fn is_salesforce_project(root: &Path) -> bool {
    root.join("sfdx-project.json").is_file()
}

/// Used when the org cannot be asked what it runs.
pub(crate) const FALLBACK_API_VERSION: &str = "65.0";

/// Bootstraps an SFDX project skeleton in a folder ForgeSF owns — an org's
/// folder under the app data directory — when it does not exist yet.
///
/// A folder the user picked is never passed here: it only gets a project file
/// when they agree to one (`add_workspace`).
pub(crate) fn ensure_sfdx_project(root: &Path, api_version: Option<&str>) -> Result<(), String> {
    if !root.exists() {
        fs::create_dir_all(root.join("force-app/main/default"))
            .map_err(|error| error.to_string())?;
    }
    write_project_file(root, api_version)
}

/// Writes a minimal `sfdx-project.json` into `root`, unless it has one.
///
/// `api_version` is the org's own, so a retrieve does not silently downgrade
/// metadata to whatever version this build happened to ship with.
pub(crate) fn write_project_file(root: &Path, api_version: Option<&str>) -> Result<(), String> {
    let project_file = root.join("sfdx-project.json");
    if !project_file.exists() {
        let version = api_version
            .map(str::trim)
            .filter(|version| !version.is_empty())
            .unwrap_or(FALLBACK_API_VERSION);
        let sources = format!(
            r#"{{
  "packageDirectories": [
    {{
      "path": "force-app",
      "default": true
    }}
  ],
  "namespace": "",
  "sourceApiVersion": "{version}"
}}
"#
        );
        fs::write(project_file, sources).map_err(|error| error.to_string())?;
    }

    Ok(())
}

/// `sourceApiVersion` from the project manifest, when set.
pub(crate) fn source_api_version(workspace: &Path) -> Option<String> {
    let raw = fs::read_to_string(workspace.join("sfdx-project.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&raw).ok()?;
    json.get("sourceApiVersion")
        .and_then(serde_json::Value::as_str)
        .filter(|version| !version.trim().is_empty())
        .map(str::to_string)
}

/// Reads `packageDirectories[].path` from the project manifest.
///
/// Deploys hardcoded `force-app`, so a project laid out any other way — `src`,
/// `main`, or a multi-package repo — could not be deployed at all.
pub(crate) fn package_directories(workspace: &Path) -> Vec<String> {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{cleanup, scratch_dir};
    use std::fs;

    #[test]
    fn a_project_file_is_only_added_when_missing() {
        let dir = scratch_dir("project");
        assert!(!is_salesforce_project(&dir));

        write_project_file(&dir, None).unwrap();
        assert!(is_salesforce_project(&dir));
        // Nothing else is created in a folder the user picked.
        let entries: Vec<_> = fs::read_dir(&dir).unwrap().flatten().collect();
        assert_eq!(entries.len(), 1);

        fs::write(dir.join("sfdx-project.json"), "{\"custom\":true}").unwrap();
        write_project_file(&dir, None).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join("sfdx-project.json")).unwrap(),
            "{\"custom\":true}"
        );
        cleanup(&[&dir]);
    }

    #[test]
    fn a_new_project_is_written_at_the_orgs_api_version() {
        let orgs = scratch_dir("project-org-version");
        write_project_file(&orgs, Some("63.0")).unwrap();
        assert_eq!(source_api_version(&orgs).as_deref(), Some("63.0"));

        // An org that could not be asked falls back to the shipped version.
        let unknown = scratch_dir("project-no-version");
        write_project_file(&unknown, Some("  ")).unwrap();
        assert_eq!(
            source_api_version(&unknown).as_deref(),
            Some(FALLBACK_API_VERSION)
        );

        cleanup(&[&orgs, &unknown]);
    }
}
