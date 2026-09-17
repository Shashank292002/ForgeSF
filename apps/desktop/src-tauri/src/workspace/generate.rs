//! Creating Salesforce source through the CLI's own generators.
//!
//! A hand-written `.cls` needs a matching `-meta.xml` with the right API
//! version, and an LWC needs a folder with four files in it. Rather than
//! reproduce those layouts — and drift from them as Salesforce changes — this
//! asks `sf template generate`, which is what `sf` itself ships for the job.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::sf::discover::sf_command;
use crate::sf::json::parse_sf_json;
use crate::sf::runner::run_with_limits;
use crate::util::blocking;
use crate::workspace::registry::workspace_root;
use crate::workspace::sfdx_project::{
    package_directories, source_api_version, FALLBACK_API_VERSION,
};

/// Generating is local file writing, but it starts Node, so it is not instant.
const GENERATE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// What to generate. The UI sends `kind`; everything else applies to some
/// kinds only, and is ignored by the rest.
#[derive(TS, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct GenerateRequest {
    /// One of the `kind` values `generator_for` accepts.
    pub kind: String,
    pub name: String,
    /// The CLI template, e.g. `ApexUnitTest` for a class.
    #[serde(default)]
    pub template: Option<String>,
    /// Apex triggers: the object the trigger is on, and when it fires.
    #[serde(default)]
    pub sobject: Option<String>,
    #[serde(default)]
    pub events: Option<Vec<String>>,
    /// Visualforce pages and components: their label.
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(TS, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct GeneratedSource {
    /// Everything written, workspace-relative, in the CLI's order.
    pub paths: Vec<String>,
    /// The one worth opening — the class body, not its metadata file.
    #[ts(optional = nullable)]
    pub open: Option<String>,
}

/// A kind of source and how the CLI is asked for it.
struct Generator {
    /// Words after `sf template generate`.
    command: &'static [&'static str],
    /// Folder inside `<package dir>/main/default`.
    folder: &'static str,
    /// Extra flags this kind needs.
    needs_sobject: bool,
    needs_label: bool,
    /// `--type` for the lightning generator, which serves both bundle kinds.
    bundle_type: Option<&'static str>,
}

fn generator_for(kind: &str) -> Option<Generator> {
    // `sf apex generate class` and friends still work but are deprecated in
    // favour of these, and print a deprecation notice that would end up in the
    // user's face.
    Some(match kind {
        "apexClass" => Generator {
            command: &["apex", "class"],
            folder: "classes",
            needs_sobject: false,
            needs_label: false,
            bundle_type: None,
        },
        "apexTrigger" => Generator {
            command: &["apex", "trigger"],
            folder: "triggers",
            needs_sobject: true,
            needs_label: false,
            bundle_type: None,
        },
        "lwc" => Generator {
            command: &["lightning", "component"],
            folder: "lwc",
            needs_sobject: false,
            needs_label: false,
            bundle_type: Some("lwc"),
        },
        "aura" => Generator {
            command: &["lightning", "component"],
            folder: "aura",
            needs_sobject: false,
            needs_label: false,
            bundle_type: Some("aura"),
        },
        "visualforcePage" => Generator {
            command: &["visualforce", "page"],
            folder: "pages",
            needs_sobject: false,
            needs_label: true,
            bundle_type: None,
        },
        "visualforceComponent" => Generator {
            command: &["visualforce", "component"],
            folder: "components",
            needs_sobject: false,
            needs_label: true,
            bundle_type: None,
        },
        _ => return None,
    })
}

/// Salesforce API names: a letter, then letters, digits and underscores.
///
/// Checked here so an empty or shell-shaped name is refused before it reaches
/// the CLI, and the message names the rule instead of quoting a stack trace.
pub(crate) fn valid_api_name(name: &str) -> bool {
    let mut characters = name.chars();
    matches!(characters.next(), Some(first) if first.is_ascii_alphabetic())
        && characters.all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !name.contains("__")
        && !name.ends_with('_')
        && name.len() <= 40
}

/// Where a kind of source belongs: the first package directory the project
/// declares, then the conventional folder for that kind.
fn output_dir(root: &Path, folder: &str) -> PathBuf {
    let package = package_directories(root)
        .into_iter()
        .next()
        .unwrap_or_else(|| "force-app".to_string());
    PathBuf::from(package)
        .join("main")
        .join("default")
        .join(folder)
}

/// The file the editor should open: the first one that is not metadata, a
/// test, or configuration — the thing the user came to write.
fn file_to_open(paths: &[String]) -> Option<String> {
    paths
        .iter()
        .find(|path| {
            let lower = path.to_lowercase();
            !lower.ends_with("-meta.xml") && !lower.contains("__tests__")
        })
        .or_else(|| paths.first())
        .cloned()
}

/// Reads the created file list, normalising Windows separators so the paths
/// match the ones the explorer and editor use.
fn created_paths(json: &serde_json::Value) -> Vec<String> {
    json["result"]["created"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|value| value.as_str())
        .map(|path| path.replace('\\', "/"))
        .collect()
}

/// Generates Salesforce source in the workspace and reports what was written.
#[tauri::command]
pub async fn generate_source(
    app: tauri::AppHandle,
    request: GenerateRequest,
    workspace_id: Option<String>,
) -> AppResult<GeneratedSource> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;

        let generator = generator_for(&request.kind).ok_or_else(|| {
            AppError::new(
                ErrorKind::Failed,
                format!("ForgeSF cannot generate '{}'.", request.kind),
            )
        })?;

        let name = request.name.trim();
        if !valid_api_name(name) {
            return Err(AppError::new(
                ErrorKind::Failed,
                format!(
                    "'{name}' is not a usable API name. Start with a letter, then use letters, \
                     digits and single underscores — up to 40 characters."
                ),
            ));
        }

        let directory = output_dir(&root, generator.folder);
        std::fs::create_dir_all(root.join(&directory)).map_err(|error| {
            AppError::new(
                ErrorKind::Failed,
                format!("Could not create {}: {error}", directory.display()),
            )
        })?;

        let mut command = sf_command()?;
        command.arg("template").arg("generate");
        for word in generator.command {
            command.arg(word);
        }
        command.arg("--name").arg(name);
        command.arg("--output-dir").arg(&directory);

        // The project's version, which is the org's since ForgeSF creates
        // projects at whatever the org runs.
        command
            .arg("--api-version")
            .arg(source_api_version(&root).unwrap_or_else(|| FALLBACK_API_VERSION.to_string()));

        if let Some(bundle) = generator.bundle_type {
            command.arg("--type").arg(bundle);
        }
        if let Some(template) = request.template.as_deref().map(str::trim) {
            if !template.is_empty() {
                command.arg("--template").arg(template);
            }
        }
        if generator.needs_sobject {
            let sobject = request.sobject.as_deref().map(str::trim).unwrap_or("");
            if !valid_api_name(sobject.trim_end_matches("__c")) && !sobject.is_empty() {
                return Err(AppError::new(
                    ErrorKind::Failed,
                    format!("'{sobject}' is not a usable object name."),
                ));
            }
            if !sobject.is_empty() {
                command.arg("--sobject").arg(sobject);
            }
            for event in request.events.as_deref().unwrap_or_default() {
                command.arg("--event").arg(event);
            }
        }
        if generator.needs_label {
            let label = request
                .label
                .as_deref()
                .map(str::trim)
                .filter(|label| !label.is_empty())
                .unwrap_or(name);
            command.arg("--label").arg(label);
        }
        command.arg("--json");
        command.current_dir(&root);

        let output = run_with_limits(command, None, &Default::default(), GENERATE_TIMEOUT)?;
        let json = parse_sf_json(&output)?;

        let paths = created_paths(&json);
        Ok(GeneratedSource {
            open: file_to_open(&paths),
            paths,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_names_follow_salesforces_rules() {
        assert!(valid_api_name("AccountService"));
        assert!(valid_api_name("Account_Service"));
        assert!(valid_api_name("a"));

        assert!(!valid_api_name(""));
        assert!(!valid_api_name("1Account"), "must start with a letter");
        assert!(!valid_api_name("_Account"), "must start with a letter");
        assert!(!valid_api_name("Account Service"), "no spaces");
        assert!(!valid_api_name("Account-Service"), "no punctuation");
        assert!(!valid_api_name("Account__c"), "no double underscore");
        assert!(!valid_api_name("Account_"), "no trailing underscore");
        assert!(!valid_api_name(&"A".repeat(41)), "40 characters at most");
        // A name that would otherwise reach the shell as an argument.
        assert!(!valid_api_name("A;rm -rf /"));
    }

    #[test]
    fn every_kind_lands_in_its_conventional_folder() {
        let root = Path::new("/ws");
        for (kind, folder) in [
            ("apexClass", "classes"),
            ("apexTrigger", "triggers"),
            ("lwc", "lwc"),
            ("aura", "aura"),
            ("visualforcePage", "pages"),
            ("visualforceComponent", "components"),
        ] {
            let generator = generator_for(kind).expect(kind);
            assert_eq!(generator.folder, folder);
            // No project file in this path, so it falls back to force-app.
            assert_eq!(
                output_dir(root, generator.folder),
                PathBuf::from("force-app")
                    .join("main")
                    .join("default")
                    .join(folder)
            );
        }

        assert!(generator_for("somethingElse").is_none());
    }

    #[test]
    fn the_file_worth_opening_is_the_one_you_came_to_write() {
        let lwc = [
            "force-app/main/default/lwc/probe/probe.js".to_string(),
            "force-app/main/default/lwc/probe/probe.html".to_string(),
            "force-app/main/default/lwc/probe/__tests__/probe.test.js".to_string(),
            "force-app/main/default/lwc/probe/probe.js-meta.xml".to_string(),
        ];
        assert_eq!(
            file_to_open(&lwc).as_deref(),
            Some("force-app/main/default/lwc/probe/probe.js")
        );

        let apex = [
            "force-app/main/default/classes/A.cls-meta.xml".to_string(),
            "force-app/main/default/classes/A.cls".to_string(),
        ];
        assert_eq!(
            file_to_open(&apex).as_deref(),
            Some("force-app/main/default/classes/A.cls")
        );

        assert_eq!(file_to_open(&[]), None);
    }

    #[test]
    fn created_paths_come_back_in_the_editors_form() {
        let json = serde_json::json!({
            "result": {
                "created": [
                    "force-app\\main\\default\\classes\\A.cls",
                    "force-app\\main\\default\\classes\\A.cls-meta.xml",
                    42,
                ]
            }
        });
        assert_eq!(
            created_paths(&json),
            vec![
                "force-app/main/default/classes/A.cls",
                "force-app/main/default/classes/A.cls-meta.xml",
            ]
        );
        assert!(created_paths(&serde_json::Value::Null).is_empty());
    }
}
