//! What uses a piece of metadata, and what it uses.
//!
//! The org keeps this in `MetadataComponentDependency`, a Tooling API object.
//! One row is "A refers to B"; asked in both directions it answers the
//! question worth asking before a change: what breaks if this moves?

use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::sf::discover::sf_command;
use crate::sf::json::parse_sf_json;
use crate::sf::runner::{run_with_limits, RunGuard};
use crate::util::{blocking, TempFile};

const QUERY_TIMEOUT: Duration = Duration::from_secs(120);

/// The org caps this query; asking for more only makes it slower.
const LIMIT: usize = 500;

/// One end of a dependency: a component, named and typed.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct DependencyNode {
    pub name: String,
    /// `ApexClass`, `CustomField`, `Flow`…
    pub component_type: String,
}

/// What a component is connected to, in both directions.
#[derive(TS, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct Dependencies {
    /// The component asked about.
    pub component: DependencyNode,
    /// Components that refer to it — what breaks if it changes.
    pub used_by: Vec<DependencyNode>,
    /// Components it refers to.
    pub uses: Vec<DependencyNode>,
    /// The org returned as many rows as it would; there may be more.
    pub truncated: bool,
}

/// The Tooling object a metadata type's records live in, and the field that
/// holds its API name.
///
/// `MetadataComponentDependency` cannot be filtered by name — only by id and
/// type — so a name has to be resolved to an id first, and each type keeps its
/// records in its own object under its own name field.
fn lookup_for(component_type: &str) -> Option<(&'static str, &'static str)> {
    Some(match component_type {
        "ApexClass" => ("ApexClass", "Name"),
        "ApexTrigger" => ("ApexTrigger", "Name"),
        "ApexPage" => ("ApexPage", "Name"),
        "ApexComponent" => ("ApexComponent", "Name"),
        "StaticResource" => ("StaticResource", "Name"),
        "PermissionSet" => ("PermissionSet", "Name"),
        "CustomObject" => ("CustomObject", "DeveloperName"),
        "CustomField" => ("CustomField", "DeveloperName"),
        "CustomTab" => ("CustomTab", "DeveloperName"),
        "FlexiPage" => ("FlexiPage", "DeveloperName"),
        "ValidationRule" => ("ValidationRule", "ValidationName"),
        "LightningComponentBundle" => ("LightningComponentBundle", "DeveloperName"),
        "AuraDefinitionBundle" => ("AuraDefinitionBundle", "DeveloperName"),
        "Flow" => ("FlowDefinition", "DeveloperName"),
        "Layout" => ("Layout", "Name"),
        "QuickAction" => ("QuickAction", "DeveloperName"),
        _ => return None,
    })
}

/// The metadata types this can look up, for the UI's picker.
#[tauri::command]
pub fn dependency_types() -> Vec<String> {
    [
        "ApexClass",
        "ApexTrigger",
        "ApexPage",
        "ApexComponent",
        "AuraDefinitionBundle",
        "CustomField",
        "CustomObject",
        "CustomTab",
        "FlexiPage",
        "Flow",
        "Layout",
        "LightningComponentBundle",
        "PermissionSet",
        "QuickAction",
        "StaticResource",
        "ValidationRule",
    ]
    .iter()
    .map(|name| name.to_string())
    .collect()
}

/// Escapes a value for a SOQL string literal.
///
/// The name comes from the page, and goes into a query: a quote or backslash
/// in it must not end the literal.
fn soql_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

fn nodes_from(records: &serde_json::Value, name_key: &str, type_key: &str) -> Vec<DependencyNode> {
    let mut nodes: Vec<DependencyNode> = records
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|row| {
            let name = row[name_key].as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(DependencyNode {
                name: name.to_string(),
                component_type: row[type_key]
                    .as_str()
                    .unwrap_or_default()
                    .trim()
                    .to_string(),
            })
        })
        .collect();

    nodes.sort();
    nodes.dedup();
    nodes
}

/// Everything the org knows about one component's connections.
///
/// `component_type` is required: the dependency object cannot be filtered by
/// name, so the name is resolved to an id through that type's own Tooling
/// object first.
#[tauri::command]
pub async fn metadata_dependencies(
    username: String,
    name: String,
    component_type: String,
    run_id: Option<String>,
) -> AppResult<Dependencies> {
    blocking(move || {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(AppError::new(
                ErrorKind::Failed,
                "Name a component to look up.",
            ));
        }

        let (object, name_field) = lookup_for(component_type.trim()).ok_or_else(|| {
            AppError::new(
                ErrorKind::Failed,
                format!("ForgeSF cannot look up dependencies for {component_type}."),
            )
        })?;

        let run = RunGuard::begin(run_id);
        let literal = soql_literal(&name);

        let run_query = |soql: String| -> AppResult<serde_json::Value> {
            // Through a file, like every other query: `sf` is a batch file on
            // Windows and refuses arguments with line breaks or great length.
            let file = TempFile::create("soql", &soql)?;
            let mut command = sf_command()?;
            command.args(["data", "query", "--target-org", &username]);
            command.arg("--file").arg(file.path());
            command.args(["--use-tooling-api", "--json"]);
            let output = run_with_limits(command, None, &run.cancelled, QUERY_TIMEOUT)?;
            let json = parse_sf_json(&output)?;
            Ok(json["result"]["records"].clone())
        };

        // 1. The component's id.
        let found = run_query(format!(
            "SELECT Id FROM {object} WHERE {name_field} = '{literal}' LIMIT 1"
        ))?;
        let id = found
            .as_array()
            .and_then(|rows| rows.first())
            .and_then(|row| row["Id"].as_str())
            .ok_or_else(|| {
                AppError::new(
                    ErrorKind::NotFound,
                    format!("No {component_type} called '{name}' in this org."),
                )
            })?
            .to_string();

        // 2. Both directions, by id — the only way this object can be filtered.
        let used_by_rows = run_query(format!(
            "SELECT MetadataComponentName, MetadataComponentType              FROM MetadataComponentDependency              WHERE RefMetadataComponentId = '{id}' LIMIT {LIMIT}"
        ))?;
        let uses_rows = run_query(format!(
            "SELECT RefMetadataComponentName, RefMetadataComponentType              FROM MetadataComponentDependency              WHERE MetadataComponentId = '{id}' LIMIT {LIMIT}"
        ))?;

        let used_by = nodes_from(
            &used_by_rows,
            "MetadataComponentName",
            "MetadataComponentType",
        );
        let uses = nodes_from(
            &uses_rows,
            "RefMetadataComponentName",
            "RefMetadataComponentType",
        );

        let count = |rows: &serde_json::Value| rows.as_array().map(Vec::len).unwrap_or(0);
        let truncated = count(&used_by_rows) >= LIMIT || count(&uses_rows) >= LIMIT;

        Ok(Dependencies {
            component: DependencyNode {
                name,
                component_type,
            },
            used_by,
            uses,
            truncated,
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_cannot_break_out_of_the_query() {
        assert_eq!(soql_literal("Account"), "Account");
        // A quote would otherwise end the literal and leave the rest as SOQL.
        assert_eq!(
            soql_literal("O'Brien' OR Name != '"),
            "O\\'Brien\\' OR Name != \\'"
        );
        assert_eq!(soql_literal("back\\slash"), "back\\\\slash");
    }

    #[test]
    fn every_offered_type_can_actually_be_looked_up() {
        // The picker only offers what the resolver knows; otherwise a type in
        // the list would fail the moment it was chosen.
        for component_type in dependency_types() {
            assert!(
                lookup_for(&component_type).is_some(),
                "{component_type} is offered but has no lookup"
            );
        }
        assert!(lookup_for("SomethingElse").is_none());
        // A Flow's records live in FlowDefinition, not Flow.
        assert_eq!(
            lookup_for("Flow"),
            Some(("FlowDefinition", "DeveloperName"))
        );
    }

    #[test]
    fn each_direction_reads_the_other_end_of_the_row() {
        let rows = serde_json::json!([
            {
                "MetadataComponentName": "AccountTrigger",
                "MetadataComponentType": "ApexTrigger",
                "RefMetadataComponentName": "AccountService",
                "RefMetadataComponentType": "ApexClass"
            },
            {
                "MetadataComponentName": "AccountTrigger",
                "MetadataComponentType": "ApexTrigger",
                "RefMetadataComponentName": "AccountService",
                "RefMetadataComponentType": "ApexClass"
            },
            { "MetadataComponentName": "  ", "MetadataComponentType": "ApexClass" }
        ]);

        // Asking "what uses AccountService" reads the referring side.
        let used_by = nodes_from(&rows, "MetadataComponentName", "MetadataComponentType");
        assert_eq!(
            used_by,
            vec![DependencyNode {
                name: "AccountTrigger".to_string(),
                component_type: "ApexTrigger".to_string(),
            }],
            "duplicates collapse, and an unnamed row is skipped"
        );

        // Asking "what does AccountTrigger use" reads the referenced side.
        let uses = nodes_from(
            &rows,
            "RefMetadataComponentName",
            "RefMetadataComponentType",
        );
        assert_eq!(uses.len(), 1);
        assert_eq!(uses[0].name, "AccountService");

        assert!(nodes_from(&serde_json::Value::Null, "a", "b").is_empty());
    }
}
