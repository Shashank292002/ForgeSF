//! Apex debug logs: listing them, fetching one, and tailing the org live.
//!
//! The first two are ordinary `--json` commands. Tailing is not: `sf apex tail
//! log` streams until it is stopped, so it reuses the terminal's streaming
//! runner and reaches the UI as events.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use ts_rs::TS;

use crate::error::AppResult;
use crate::sf::discover::{run_sf, sf_command};
use crate::sf::json::parse_sf_json;
use crate::sf::runner::RunGuard;
use crate::terminal::{run_streaming, TerminalEvent, MAX_OUTPUT_BYTES};
use crate::util::blocking;

/// A tail runs until it is stopped; this is the backstop for one left running.
const TAIL_TIMEOUT: Duration = Duration::from_secs(60 * 60 * 2);

/// Events a tail sends, alongside the terminal's own.
const TAIL_EVENT: &str = "apex_log_tail";

/// One row of `sf apex list log`.
#[derive(TS, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ApexLog {
    pub id: String,
    /// Who ran the code.
    pub user: String,
    /// "ApexTestHandler", "Browser", "Api" — where the request came from.
    pub application: String,
    /// The operation logged, e.g. "/services/data/v67.0/tooling/executeAnonymous".
    pub operation: String,
    pub status: String,
    /// ISO 8601, as the org reports it.
    pub start_time: String,
    #[ts(type = "number")]
    pub duration_ms: i64,
    #[ts(type = "number")]
    pub length_bytes: i64,
}

fn text(value: &serde_json::Value) -> String {
    value.as_str().unwrap_or_default().trim().to_string()
}

/// Reads the log rows, newest first — which is the one you want to open.
fn parse_logs(result: &serde_json::Value) -> Vec<ApexLog> {
    let mut logs: Vec<ApexLog> = result
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|row| {
            let id = row["Id"].as_str()?.trim().to_string();
            if id.is_empty() {
                return None;
            }
            Some(ApexLog {
                id,
                // The CLI sends the related user either nested or flattened,
                // depending on how the query was built.
                user: match row["LogUser"]["Name"].as_str() {
                    Some(name) => name.trim().to_string(),
                    None => text(&row["LogUserName"]),
                },
                application: text(&row["Application"]),
                operation: text(&row["Operation"]),
                status: text(&row["Status"]),
                start_time: text(&row["StartTime"]),
                duration_ms: row["DurationMilliseconds"].as_i64().unwrap_or(0),
                length_bytes: row["LogLength"].as_i64().unwrap_or(0),
            })
        })
        .collect();

    logs.sort_by(|a, b| b.start_time.cmp(&a.start_time));
    logs
}

/// Every debug log the org is holding for this user.
#[tauri::command]
pub async fn list_apex_logs(username: String) -> AppResult<Vec<ApexLog>> {
    blocking(move || {
        let output = run_sf(["apex", "list", "log", "--target-org", &username, "--json"])?;
        let json = parse_sf_json(&output)?;
        Ok(parse_logs(&json["result"]))
    })
    .await
}

/// Pulls one log's body out of the CLI's payload, whichever shape it used.
fn log_body(json: &serde_json::Value) -> String {
    let result = &json["result"];

    // `apex get log` answers with an array of `{ log }`; some versions answer
    // with the string alone.
    if let Some(text) = result.as_str() {
        return text.to_string();
    }
    if let Some(entries) = result.as_array() {
        return entries
            .iter()
            .filter_map(|entry| entry["log"].as_str().or_else(|| entry.as_str()))
            .collect::<Vec<_>>()
            .join("\n");
    }
    result["log"].as_str().unwrap_or_default().to_string()
}

/// One debug log, in full.
#[tauri::command]
pub async fn get_apex_log(username: String, log_id: String) -> AppResult<String> {
    blocking(move || {
        let output = run_sf([
            "apex",
            "get",
            "log",
            "--log-id",
            &log_id,
            "--target-org",
            &username,
            "--json",
        ])?;
        let json = parse_sf_json(&output)?;
        Ok(log_body(&json))
    })
    .await
}

/// Streams the org's log output until stopped.
///
/// The CLI sets up the `DEVELOPER_LOG` trace flag for the user itself, which
/// is the fiddly part of watching logs, and removes nothing else.
#[tauri::command]
pub async fn tail_apex_logs(
    app: tauri::AppHandle,
    username: String,
    run_id: String,
    debug_level: Option<String>,
) -> AppResult<()> {
    blocking(move || {
        let run = RunGuard::begin(Some(run_id.clone()));

        let mut command = sf_command()?;
        command.arg("apex").arg("tail").arg("log");
        command.arg("--target-org").arg(&username);
        if let Some(level) = debug_level.as_deref().map(str::trim) {
            if !level.is_empty() {
                command.arg("--debug-level").arg(level);
            }
        }

        run_streaming(
            command,
            &run.cancelled,
            TAIL_TIMEOUT,
            MAX_OUTPUT_BYTES,
            |chunks, exit| {
                let _ = app.emit(
                    TAIL_EVENT,
                    TerminalEvent {
                        run_id: run_id.clone(),
                        chunks,
                        exit,
                    },
                );
            },
        )
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logs_are_read_newest_first() {
        let logs = parse_logs(&serde_json::json!([
            {
                "Id": "07L000000000001",
                "LogUser": { "Name": "Ada Lovelace" },
                "Application": "Browser",
                "Operation": "/apexdebug/traceDebug.apexp",
                "Status": "Success",
                "StartTime": "2026-09-16T09:00:00.000+0000",
                "DurationMilliseconds": 120,
                "LogLength": 4096
            },
            {
                "Id": "07L000000000002",
                "LogUserName": "Ada Lovelace",
                "Application": "Unknown",
                "Operation": "executeAnonymous",
                "Status": "Failed",
                "StartTime": "2026-09-16T10:00:00.000+0000",
                "DurationMilliseconds": 9,
                "LogLength": 128
            },
            // No id: not a log row.
            { "Application": "Browser" }
        ]));

        assert_eq!(logs.len(), 2);
        assert_eq!(logs[0].id, "07L000000000002", "newest first");
        // The user comes through whether it was nested or flattened.
        assert_eq!(logs[0].user, "Ada Lovelace");
        assert_eq!(logs[1].user, "Ada Lovelace");
        assert_eq!(logs[1].length_bytes, 4096);
        assert_eq!(logs[0].status, "Failed");

        assert!(parse_logs(&serde_json::Value::Null).is_empty());
    }

    #[test]
    fn a_log_body_is_found_whichever_shape_the_cli_used() {
        assert_eq!(
            log_body(&serde_json::json!({ "result": [{ "log": "44.0 APEX_CODE" }] })),
            "44.0 APEX_CODE"
        );
        assert_eq!(
            log_body(&serde_json::json!({ "result": "44.0 APEX_CODE" })),
            "44.0 APEX_CODE"
        );
        assert_eq!(
            log_body(&serde_json::json!({ "result": { "log": "44.0 APEX_CODE" } })),
            "44.0 APEX_CODE"
        );
        assert_eq!(log_body(&serde_json::json!({ "result": null })), "");
    }
}
