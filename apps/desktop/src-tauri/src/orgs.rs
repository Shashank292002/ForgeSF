//! Salesforce orgs: listing and classifying them, logging in and out, and the default org.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::AppResult;
use crate::sf::discover::{run_sf, sf_command};
use crate::sf::json::{output_to_string, parse_sf_json};
use crate::sf::runner::{run_with_limits, RunGuard};
use crate::util::blocking;
use crate::workspace::sfdx_project::FALLBACK_API_VERSION;

#[derive(TS, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct Organization {
    pub id: String,
    pub alias: String,
    pub username: String,
    pub instance_url: String,
    pub org_type: String,
    pub is_default: bool,
    pub status: String,
}

#[derive(TS, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct OrgDetails {
    pub instance_url: String,
    pub api_version: String,
    pub username: String,
    /// The org's 18-character id.
    pub org_id: String,
    pub alias: Option<String>,
    /// What the CLI made of its last connection attempt ("Connected").
    pub connected_status: Option<String>,
    /// Where the login went — test.salesforce.com or a My Domain host.
    pub login_url: Option<String>,
    /// Scratch and sandbox orgs report these; a Developer Edition does not.
    pub org_name: Option<String>,
    pub edition: Option<String>,
    pub status: Option<String>,
    pub created_date: Option<String>,
    /// When a scratch org stops working.
    pub expiration_date: Option<String>,
}

/// One row of `sf limits api display` — a governor limit and its headroom.
#[derive(TS, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct OrgLimit {
    pub name: String,
    #[ts(type = "number")]
    pub max: i64,
    #[ts(type = "number")]
    pub remaining: i64,
}

// Deliberately no `access_token` here. `sf org display --json` returns one, but
// handing a live session token to the webview means any XSS-shaped bug — or a
// stray console.log — leaks production org access. Anything needing
// authenticated calls should run in Rust, where the token never leaves.

/// Classifies an org from the flags `sf` reports, falling back to the instance
/// host when they are absent. Previously every org was hardcoded "Production",
/// which mislabelled sandboxes and scratch orgs everywhere they were shown —
/// including both deployment dropdowns.
fn classify_org_type(value: &serde_json::Value) -> &'static str {
    let flag = |key: &str| {
        value
            .get(key)
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
    };

    if flag("isScratch") {
        return "Scratch Org";
    }
    if flag("isSandbox") {
        return "Sandbox";
    }

    // `org display` omits those flags, so fall back to the host, which encodes
    // the org kind for sandboxes and scratch/dev orgs.
    let host = value
        .get("instanceUrl")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();

    // Scratch orgs and Trailhead playgrounds have hosts of their own. Without
    // them both read as Production — the one label that makes every deploy,
    // logout and Apex run stop for a confirmation.
    if host.contains(".scratch.") {
        return "Scratch Org";
    }
    if host.contains(".sandbox.") {
        return "Sandbox";
    }
    if host.contains(".trailblaze.") || host.contains(".develop.") || host.contains("-dev-ed.") {
        return "Developer";
    }
    "Production"
}

/// Maps the CLI's `connectedStatus` onto the three states the UI models.
fn classify_org_status(value: &serde_json::Value) -> &'static str {
    let connected = value
        .get("connectedStatus")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();

    // `org login`/`org display` omit the field on a freshly authenticated org.
    if connected.is_empty() || connected.eq_ignore_ascii_case("Connected") {
        return "Connected";
    }

    let lower = connected.to_ascii_lowercase();
    if lower.contains("expired")
        || lower.contains("refreshtoken")
        || lower.contains("invalid_grant")
    {
        return "Expired";
    }
    "Disconnected"
}

/// Builds an `Organization` from a CLI org payload.
///
/// Required fields are errors rather than empty strings: coercing a missing
/// `orgId` to `""` used to store an org whose React key collided with every
/// other malformed entry.
fn organization_from_json(value: &serde_json::Value) -> Result<Organization, String> {
    let username = value
        .get("username")
        .and_then(serde_json::Value::as_str)
        .filter(|name| !name.is_empty())
        .ok_or("The Salesforce CLI returned an org with no username.")?
        .to_string();

    let id = value
        .get("orgId")
        .or_else(|| value.get("id"))
        .and_then(serde_json::Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| format!("The Salesforce CLI returned no org id for {username}."))?
        .to_string();

    let alias = value
        .get("alias")
        .and_then(serde_json::Value::as_str)
        .filter(|alias| !alias.is_empty())
        .unwrap_or(&username)
        .to_string();

    Ok(Organization {
        id,
        alias,
        instance_url: value
            .get("instanceUrl")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string(),
        org_type: classify_org_type(value).to_string(),
        is_default: value
            .get("isDefaultUsername")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
        status: classify_org_status(value).to_string(),
        username,
    })
}

/// Every org the Salesforce CLI knows about, de-duplicated across its buckets.
///
/// `skip_connection_status` avoids the per-org network round-trip that makes
/// `sf org list` slow; statuses then read as connected and must come from a
/// later full refresh.
fn collect_orgs(skip_connection_status: bool) -> AppResult<Vec<Organization>> {
    let mut args = vec!["org", "list", "--json"];
    if skip_connection_status {
        args.push("--skip-connection-status");
    }
    let output = run_sf(args)?;
    let json = parse_sf_json(&output)?;
    let result = &json["result"];

    let mut orgs: Vec<Organization> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    // The buckets overlap — a dev hub is also a non-scratch org — so the first
    // occurrence wins, and the bucket itself refines the type where the flags
    // were not set.
    for bucket in [
        "scratchOrgs",
        "sandboxes",
        "devHubs",
        "nonScratchOrgs",
        "other",
    ] {
        let Some(entries) = result.get(bucket).and_then(serde_json::Value::as_array) else {
            continue;
        };

        for entry in entries {
            let Ok(mut org) = organization_from_json(entry) else {
                continue;
            };
            if bucket == "scratchOrgs" {
                org.org_type = "Scratch Org".to_string();
            } else if bucket == "sandboxes" && org.org_type == "Production" {
                org.org_type = "Sandbox".to_string();
            }
            if seen.insert(org.username.clone()) {
                orgs.push(org);
            }
        }
    }

    Ok(orgs)
}

/// Lists every org the CLI is authenticated against.
///
/// The app previously had no way to discover orgs: its list only grew when a
/// user pressed "Add Organization", so orgs already authenticated in the CLI
/// were invisible, and orgs logged out via the CLI lingered as phantoms.
#[tauri::command]
pub async fn list_orgs(skip_connection_status: Option<bool>) -> AppResult<Vec<Organization>> {
    blocking(move || collect_orgs(skip_connection_status.unwrap_or(false))).await
}

/// Normalises a login URL: `https` only, with a plain host (and optional port
/// and path). A bare host such as `acme.my.salesforce.com` gets `https://`.
fn login_instance_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Enter the org's login URL.".to_string());
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("http://") {
        return Err("The login URL must use https://.".to_string());
    }
    let rest = if lower.starts_with("https://") {
        &trimmed["https://".len()..]
    } else {
        trimmed
    };

    let (authority, path) = match rest.split_once('/') {
        Some((authority, path)) => (authority, Some(path)),
        None => (rest, None),
    };
    let (host, port) = match authority.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (authority, None),
    };

    let host_ok = !host.is_empty()
        && host.contains('.')
        && host
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '-'));
    let port_ok = port.map_or(true, |port| {
        !port.is_empty() && port.chars().all(|c| c.is_ascii_digit())
    });
    let path_ok = path.map_or(true, |path| {
        path.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '~' | '/'))
    });

    if !(host_ok && port_ok && path_ok) {
        return Err(format!("'{}' is not a valid login URL.", raw.trim()));
    }
    Ok(format!("https://{rest}"))
}

/// Validates an org alias. The CLI accepts little beyond these characters, and
/// keeping it to them means it can never be misread as another argument.
fn login_alias(raw: &str) -> Result<String, String> {
    let alias = raw.trim();
    let valid = !alias.is_empty()
        && alias.len() <= 80
        && !alias.starts_with('-')
        && alias
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | '@'));
    if valid {
        Ok(alias.to_string())
    } else {
        Err("An alias may use letters, digits, and _ - . @ only.".to_string())
    }
}

/// `sf org login web` arguments for the chosen options.
fn login_args(
    instance_url: Option<&str>,
    alias: Option<&str>,
    set_default: bool,
) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = ["org", "login", "web", "--json"]
        .into_iter()
        .map(str::to_string)
        .collect();
    if let Some(url) = instance_url.filter(|url| !url.trim().is_empty()) {
        args.push("--instance-url".to_string());
        args.push(login_instance_url(url)?);
    }
    if let Some(alias) = alias.filter(|alias| !alias.trim().is_empty()) {
        args.push("--alias".to_string());
        args.push(login_alias(alias)?);
    }
    if set_default {
        args.push("--set-default".to_string());
    }
    Ok(args)
}

/// How long a browser login may take before the waiting CLI is stopped.
const LOGIN_TIMEOUT: Duration = Duration::from_secs(15 * 60);

/// Authenticates an org through the browser.
///
/// `instance_url` selects a sandbox (`https://test.salesforce.com`) or a My
/// Domain; previously every login went to production's login page, so
/// sandboxes could not be connected at all. The login is a cancellable run: an
/// abandoned browser tab used to leave the button spinning until restart.
#[tauri::command]
pub async fn connect_salesforce(
    instance_url: Option<String>,
    alias: Option<String>,
    set_default: Option<bool>,
    run_id: Option<String>,
) -> AppResult<Organization> {
    blocking(move || {
        let run = RunGuard::begin(run_id);
        let args = login_args(
            instance_url.as_deref(),
            alias.as_deref(),
            set_default.unwrap_or(false),
        )?;

        let mut command = sf_command()?;
        command.args(&args);
        let login = run_with_limits(command, None, &run.cancelled, LOGIN_TIMEOUT)?;
        let json = parse_sf_json(&login)?;

        let username = json
            .pointer("/result/username")
            .and_then(serde_json::Value::as_str)
            .filter(|name| !name.is_empty())
            .ok_or("The Salesforce CLI did not report a username for this login.")?
            .to_string();

        // The login payload carries no isSandbox/isScratch/default flags, so
        // re-read the org from `org list`, which does. Falling back to the
        // login payload keeps the connection usable if that second call fails.
        if let Ok(orgs) = collect_orgs(false) {
            if let Some(org) = orgs.into_iter().find(|org| org.username == username) {
                return Ok(org);
            }
        }

        Ok(organization_from_json(&json["result"])?)
    })
    .await
}

#[tauri::command]
pub async fn open_org(username: String) -> AppResult<()> {
    blocking(move || {
        let output = run_sf(["org", "open", "--target-org", &username])?;
        output_to_string(&output)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn set_default_org(username: String) -> AppResult<String> {
    blocking(move || {
        // `--global`: without it the CLI writes project-local config into its
        // working directory, which is not a project the user chose.
        let output = run_sf(["config", "set", "target-org", &username, "--global"])?;
        output_to_string(&output)
    })
    .await
}

#[tauri::command]
pub async fn logout_org(username: String) -> AppResult<String> {
    blocking(move || {
        let output = run_sf(["org", "logout", "--target-org", &username, "--no-prompt"])?;
        output_to_string(&output)
    })
    .await
}

/// `sf org display` for one org. `target` is an alias or a username.
fn org_display(target: &str) -> AppResult<serde_json::Value> {
    let output = run_sf(["org", "display", "--target-org", target, "--json"])?;
    parse_sf_json(&output)
}

/// The API version an org runs, for a project ForgeSF is about to create.
///
/// `None` when the org cannot be asked — expired auth, no network — and the
/// caller then falls back to the shipped default rather than failing.
pub(crate) fn org_api_version(target: &str) -> Option<String> {
    let json = org_display(target).ok()?;
    json["result"]["apiVersion"]
        .as_str()
        .filter(|version| !version.trim().is_empty())
        .map(str::to_string)
}

/// The API version an org runs and the name to call it by, in one call.
///
/// Messages should name an org the way the user does, so this returns the
/// alias when the CLI knows one and the username otherwise. Asking for the
/// version and the alias separately would start `sf` twice.
pub(crate) fn org_version_and_name(target: &str) -> (Option<String>, String) {
    let Ok(json) = org_display(target) else {
        return (None, target.to_string());
    };
    let result = &json["result"];
    let version = result["apiVersion"]
        .as_str()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let name = result["alias"]
        .as_str()
        .map(str::trim)
        .filter(|a| !a.is_empty())
        .unwrap_or(target)
        .to_string();
    (version, name)
}

/// A field of the `org display` result, when the CLI reported one that is not
/// empty. Most are absent outside scratch orgs.
fn optional_field(result: &serde_json::Value, key: &str) -> Option<String> {
    result[key]
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

#[tauri::command]
pub async fn get_org_details(username: String) -> AppResult<OrgDetails> {
    blocking(move || {
        let json = org_display(&username)?;
        let result = &json["result"];

        // Every field is picked by name. Copying the whole result across would
        // hand the webview the access token that sits in it.
        Ok(OrgDetails {
            instance_url: result["instanceUrl"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            api_version: result["apiVersion"]
                .as_str()
                .unwrap_or(FALLBACK_API_VERSION)
                .to_string(),
            username: optional_field(result, "username").unwrap_or(username),
            org_id: optional_field(result, "id").unwrap_or_default(),
            alias: optional_field(result, "alias"),
            connected_status: optional_field(result, "connectedStatus"),
            login_url: optional_field(result, "loginUrl"),
            org_name: optional_field(result, "orgName"),
            edition: optional_field(result, "edition"),
            status: optional_field(result, "status"),
            created_date: optional_field(result, "createdDate"),
            expiration_date: optional_field(result, "expirationDate"),
        })
    })
    .await
}

/// The org's governor limits and how much of each is left.
///
/// `sf limits api display` is one API call against the org, so this is cheap
/// next to the CLI start-up it pays for either way.
#[tauri::command]
pub async fn org_limits(username: String) -> AppResult<Vec<OrgLimit>> {
    blocking(move || {
        let output = run_sf([
            "limits",
            "api",
            "display",
            "--target-org",
            &username,
            "--json",
        ])?;
        let json = parse_sf_json(&output)?;
        Ok(parse_limits(&json["result"]))
    })
    .await
}

/// Reads the limit rows, skipping anything malformed rather than failing the
/// whole panel: the CLI adds limits over time, and one odd row should not hide
/// the rest.
fn parse_limits(result: &serde_json::Value) -> Vec<OrgLimit> {
    let mut limits: Vec<OrgLimit> = result
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|row| {
            let name = row["name"].as_str()?.trim();
            if name.is_empty() {
                return None;
            }
            Some(OrgLimit {
                name: name.to_string(),
                max: row["max"].as_i64()?,
                remaining: row["remaining"].as_i64()?,
            })
        })
        .collect();

    limits.sort_by(|a, b| a.name.cmp(&b.name));
    limits
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limits_are_read_by_name_and_a_bad_row_does_not_hide_the_rest() {
        let limits = parse_limits(&serde_json::json!([
            { "name": "DailyApiRequests", "max": 15000, "remaining": 14980 },
            // A row the CLI grew that this build does not understand.
            { "name": "SomethingNew", "max": "lots", "remaining": 3 },
            { "name": "  ", "max": 1, "remaining": 1 },
            { "name": "ActiveScratchOrgs", "max": 3, "remaining": 1 },
        ]));

        assert_eq!(
            limits,
            vec![
                OrgLimit {
                    name: "ActiveScratchOrgs".to_string(),
                    max: 3,
                    remaining: 1,
                },
                OrgLimit {
                    name: "DailyApiRequests".to_string(),
                    max: 15000,
                    remaining: 14980,
                },
            ]
        );

        // An org that reports nothing is empty, not an error.
        assert!(parse_limits(&serde_json::Value::Null).is_empty());
    }

    #[test]
    fn org_details_leave_out_empty_fields() {
        let result = serde_json::json!({
            "alias": "AgentOrg",
            "orgName": "   ",
            "expirationDate": null,
        });
        assert_eq!(
            optional_field(&result, "alias").as_deref(),
            Some("AgentOrg")
        );
        assert_eq!(optional_field(&result, "orgName"), None);
        assert_eq!(optional_field(&result, "expirationDate"), None);
        assert_eq!(optional_field(&result, "missing"), None);
    }

    #[test]
    fn org_types_come_from_the_flags_and_then_the_host() {
        let org = |json: serde_json::Value| classify_org_type(&json);

        assert_eq!(org(serde_json::json!({ "isScratch": true })), "Scratch Org");
        assert_eq!(org(serde_json::json!({ "isSandbox": true })), "Sandbox");

        // `org display` omits both flags, so the host has to say.
        let host = |url: &str| org(serde_json::json!({ "instanceUrl": url }));
        assert_eq!(
            host("https://power-site-1234-dev-ed.scratch.my.salesforce.com"),
            "Scratch Org"
        );
        assert_eq!(
            host("https://acme--uat.sandbox.my.salesforce.com"),
            "Sandbox"
        );
        assert_eq!(
            host("https://curious-koala-abc-dev-ed.trailblaze.my.salesforce.com"),
            "Developer"
        );
        assert_eq!(
            host("https://acme-dev-ed.develop.my.salesforce.com"),
            "Developer"
        );
        assert_eq!(host("https://acme.my.salesforce.com"), "Production");
    }

    #[test]
    fn login_urls_are_normalised_to_https() {
        assert_eq!(
            login_instance_url("https://test.salesforce.com/").unwrap(),
            "https://test.salesforce.com"
        );
        assert_eq!(
            login_instance_url("acme.my.salesforce.com").unwrap(),
            "https://acme.my.salesforce.com"
        );
        assert_eq!(
            login_instance_url("https://acme--uat.sandbox.my.salesforce.com:443").unwrap(),
            "https://acme--uat.sandbox.my.salesforce.com:443"
        );
    }

    #[test]
    fn unsafe_or_malformed_login_urls_are_rejected() {
        for bad in [
            "",
            "http://login.salesforce.com",
            "https://",
            "localhost",
            "https://evil.com\" --jwt-key-file x",
            "https://a.com:port",
            "https://a.com/path?query=1",
        ] {
            assert!(login_instance_url(bad).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn aliases_are_restricted_to_safe_characters() {
        assert_eq!(login_alias(" uat-sandbox ").unwrap(), "uat-sandbox");
        assert!(login_alias("me@acme.com").is_ok());
        for bad in [
            "",
            "two words",
            "--set-default",
            "semi;colon",
            &"x".repeat(81),
        ] {
            assert!(login_alias(bad).is_err(), "accepted {bad:?}");
        }
    }

    #[test]
    fn login_arguments_include_only_the_chosen_options() {
        assert_eq!(
            login_args(None, None, false).unwrap(),
            vec!["org", "login", "web", "--json"]
        );
        assert_eq!(
            login_args(Some("test.salesforce.com"), Some("uat"), true).unwrap(),
            vec![
                "org",
                "login",
                "web",
                "--json",
                "--instance-url",
                "https://test.salesforce.com",
                "--alias",
                "uat",
                "--set-default"
            ]
        );
        assert!(login_args(Some("http://x.com"), None, false).is_err());
    }
}
