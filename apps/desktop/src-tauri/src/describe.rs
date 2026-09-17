//! What an org's objects and fields are called — the facts SOQL autocomplete
//! needs.
//!
//! A full describe is a large payload (Account alone has 76 fields, each with
//! forty-odd attributes). Only the handful of attributes a completion list
//! shows crosses to the UI; the rest is dropped here.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppResult;
use crate::sf::discover::run_sf;
use crate::sf::json::parse_sf_json;
use crate::util::blocking;

/// One field of an object, as a completion item.
#[derive(TS, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct SObjectField {
    pub name: String,
    pub label: String,
    /// `string`, `reference`, `picklist`… what SOQL will return.
    pub field_type: String,
    /// For a lookup, the objects it can point at.
    #[ts(type = "string[]")]
    pub reference_to: Vec<String>,
    /// For a lookup, the name to traverse with — `Account` in `Account.Name`.
    #[ts(optional = nullable)]
    pub relationship_name: Option<String>,
    pub custom: bool,
    /// Whether SOQL can filter and sort on it.
    pub filterable: bool,
}

/// An object and its fields.
#[derive(TS, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct SObjectDescribe {
    pub name: String,
    pub label: String,
    pub custom: bool,
    /// Whether records of it can be queried at all.
    pub queryable: bool,
    pub fields: Vec<SObjectField>,
    /// Child relationships, for sub-queries: `(SELECT … FROM Contacts)`.
    #[ts(type = "string[]")]
    pub child_relationships: Vec<String>,
}

fn text(value: &serde_json::Value) -> String {
    value.as_str().unwrap_or_default().trim().to_string()
}

fn strings(value: &serde_json::Value) -> Vec<String> {
    value
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|item| item.as_str())
        .map(str::to_string)
        .collect()
}

/// Every object in the org, sorted, so autocomplete can offer them.
#[tauri::command]
pub async fn list_sobjects(username: String) -> AppResult<Vec<String>> {
    blocking(move || {
        let output = run_sf([
            "sobject",
            "list",
            "--sobject",
            "ALL",
            "--target-org",
            &username,
            "--json",
        ])?;
        let json = parse_sf_json(&output)?;
        let mut names = strings(&json["result"]);
        names.sort_unstable();
        names.dedup();
        Ok(names)
    })
    .await
}

/// Reads a describe payload down to what a completion list needs.
fn parse_describe(result: &serde_json::Value) -> SObjectDescribe {
    let fields = result["fields"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|field| {
            let name = field["name"].as_str()?.trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some(SObjectField {
                label: text(&field["label"]),
                field_type: text(&field["type"]),
                reference_to: strings(&field["referenceTo"]),
                relationship_name: field["relationshipName"]
                    .as_str()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                custom: field["custom"].as_bool().unwrap_or(false),
                filterable: field["filterable"].as_bool().unwrap_or(false),
                name,
            })
        })
        .collect();

    let mut child_relationships: Vec<String> = result["childRelationships"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|child| child["relationshipName"].as_str())
        .map(str::to_string)
        .filter(|name| !name.is_empty())
        .collect();
    child_relationships.sort_unstable();
    child_relationships.dedup();

    SObjectDescribe {
        name: text(&result["name"]),
        label: text(&result["label"]),
        custom: result["custom"].as_bool().unwrap_or(false),
        queryable: result["queryable"].as_bool().unwrap_or(true),
        fields,
        child_relationships,
    }
}

/// One object's fields and relationships.
#[tauri::command]
pub async fn describe_sobject(
    username: String,
    sobject: String,
    tooling: Option<bool>,
) -> AppResult<SObjectDescribe> {
    blocking(move || {
        let mut args = vec![
            "sobject".to_string(),
            "describe".to_string(),
            "--sobject".to_string(),
            sobject,
            "--target-org".to_string(),
            username,
            "--json".to_string(),
        ];
        if tooling == Some(true) {
            args.push("--use-tooling-api".to_string());
        }

        let output = run_sf(args)?;
        let json = parse_sf_json(&output)?;
        Ok(parse_describe(&json["result"]))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_describe_keeps_only_what_a_completion_list_shows() {
        let described = parse_describe(&serde_json::json!({
            "name": "Account",
            "label": "Account",
            "custom": false,
            "queryable": true,
            "fields": [
                {
                    "name": "Id",
                    "label": "Account ID",
                    "type": "id",
                    "referenceTo": [],
                    "relationshipName": null,
                    "custom": false,
                    "filterable": true,
                    // Everything below is dropped rather than sent to the UI.
                    "byteLength": 18,
                    "calculatedFormula": null,
                    "picklistValues": []
                },
                {
                    "name": "OwnerId",
                    "label": "Owner ID",
                    "type": "reference",
                    "referenceTo": ["User"],
                    "relationshipName": "Owner",
                    "custom": false,
                    "filterable": true
                },
                // No name: not a field.
                { "label": "Nameless" }
            ],
            "childRelationships": [
                { "relationshipName": "Contacts" },
                { "relationshipName": "Opportunities" },
                { "relationshipName": null },
                { "relationshipName": "Contacts" }
            ]
        }));

        assert_eq!(described.name, "Account");
        assert_eq!(described.fields.len(), 2);
        assert_eq!(
            described.fields[1],
            SObjectField {
                name: "OwnerId".to_string(),
                label: "Owner ID".to_string(),
                field_type: "reference".to_string(),
                reference_to: vec!["User".to_string()],
                relationship_name: Some("Owner".to_string()),
                custom: false,
                filterable: true,
            }
        );
        // Sorted and de-duplicated, with the unnamed one left out.
        assert_eq!(
            described.child_relationships,
            vec!["Contacts", "Opportunities"]
        );
    }

    #[test]
    fn an_empty_describe_is_empty_rather_than_an_error() {
        let described = parse_describe(&serde_json::Value::Null);
        assert_eq!(described.name, "");
        assert!(described.fields.is_empty());
        assert!(described.child_relationships.is_empty());
        // Nothing said about it, so it is assumed queryable.
        assert!(described.queryable);
    }
}
