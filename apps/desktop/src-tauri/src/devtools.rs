//! The Developer Tools commands: SOQL, SOSL, anonymous Apex, and free-form CLI commands.

use crate::error::AppResult;
use crate::sf::discover::sf_command;
use crate::sf::json::{output_to_string, parse_sf_json};
use crate::sf::policy;
use crate::sf::runner::{run_cancellable, RunGuard};
use crate::util::{blocking, TempFile};
use crate::workspace::registry::get_workspace;

/// Runs a SOQL query.
///
/// The query is passed with `--file` rather than `--query`. On Windows `sf` is
/// `sf.cmd`, and Rust refuses to pass arguments containing line breaks to a
/// batch file, so every multi-line query failed with "batch file arguments are
/// invalid"; a file also sidesteps cmd.exe's 8191-character line limit.
#[tauri::command]
pub async fn run_query(
    username: String,
    query: String,
    run_id: Option<String>,
    tooling: Option<bool>,
) -> AppResult<String> {
    blocking(move || {
        run_query_file(
            "query",
            &username,
            &query,
            "soql",
            run_id,
            tooling == Some(true),
        )
    })
    .await
}

/// Runs a SOSL search, passed by file for the same reasons as `run_query`.
#[tauri::command]
pub async fn run_search(
    username: String,
    query: String,
    run_id: Option<String>,
) -> AppResult<String> {
    blocking(move || run_query_file("search", &username, &query, "sosl", run_id, false)).await
}

/// `sf data <verb> --file <tmp>`, returning the CLI's full JSON.
fn run_query_file(
    verb: &str,
    username: &str,
    query: &str,
    extension: &str,
    run_id: Option<String>,
    tooling: bool,
) -> AppResult<String> {
    // Registered before the CLI is located: the first lookup can take seconds,
    // and a Cancel pressed during it must still count.
    let run = RunGuard::begin(run_id);
    let query_file = TempFile::create(extension, query.trim())?;

    let mut command = sf_command()?;
    command.args(["data", verb, "--target-org", username, "--json", "--file"]);
    command.arg(query_file.path());
    // Tooling objects — ApexClass, ApexTrigger, the metadata ones — live
    // behind the Tooling API and are invisible to a plain query.
    if tooling {
        command.arg("--use-tooling-api");
    }

    let output = run_cancellable(command, None, &run)?;
    // Surface the CLI's structured error (bad field, malformed SOQL) rather
    // than a raw stdout/stderr dump, but hand the caller the full JSON so the
    // results table can render the records.
    parse_sf_json(&output)?;
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

/// Runs an `sf` command that emits `--json`, validating the envelope.
///
/// `run_command` only checks the process exit code, which is not enough for
/// several subcommands: `sf apex execute --json` exits **0** when Apex compiles
/// and then throws at runtime, reporting `result.success: false` with the
/// exception in the payload. Routing the SOSL and Apex tabs through here means
/// a failed run reads as failed instead of succeeding silently.
#[tauri::command]
pub async fn run_sf_json(
    app: tauri::AppHandle,
    args: Vec<String>,
    input: Option<String>,
    run_id: Option<String>,
) -> AppResult<String> {
    blocking(move || {
        if let Some(reason) = policy::refusal(&args) {
            return Err(reason.into());
        }
        let run = RunGuard::begin(run_id);
        let mut command = sf_command()?;
        if !args.is_empty() {
            command.args(&args);
        }
        if let Ok(workspace) = get_workspace(&app) {
            command.current_dir(workspace);
        }

        let output = run_cancellable(command, input, &run)?;
        let json = parse_sf_json(&output)?;

        // `apex execute` carries its own success flag inside a status-0
        // envelope, so the generic envelope check above is not sufficient.
        if json.pointer("/result/success") == Some(&serde_json::Value::Bool(false)) {
            return Err(apex_failure_message(&json).into());
        }

        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    })
    .await
}

/// Readable failure text for an anonymous-Apex run.
fn apex_failure_message(json: &serde_json::Value) -> String {
    let field = |name: &str| {
        json.pointer(&format!("/result/{name}"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    };

    let mut parts: Vec<String> = Vec::new();

    // A compile failure names a line and column; a runtime one has a stack.
    if let Some(problem) = field("compileProblem") {
        let line = json
            .pointer("/result/line")
            .and_then(serde_json::Value::as_i64);
        let column = json
            .pointer("/result/column")
            .and_then(serde_json::Value::as_i64);
        match (line, column) {
            (Some(line), Some(column)) => parts.push(format!(
                "Compile error (line {line}, column {column}): {problem}"
            )),
            _ => parts.push(format!("Compile error: {problem}")),
        }
    }

    if let Some(message) = field("exceptionMessage") {
        parts.push(message.to_string());
    }
    if let Some(stack) = field("exceptionStackTrace") {
        parts.push(stack.to_string());
    }

    if parts.is_empty() {
        "The Apex ran but reported failure.".to_string()
    } else {
        parts.join(
            "
",
        )
    }
}

/// Runs an arbitrary `sf` command, optionally feeding it stdin.
///
/// Runs inside the workspace so project-scoped subcommands (`project deploy`,
/// `project retrieve`) resolve the same `sfdx-project.json` the rest of the app
/// uses — previously they ran against whatever directory the app was launched
/// from.
#[tauri::command]
pub async fn run_command(
    app: tauri::AppHandle,
    args: Vec<String>,
    input: Option<String>,
    run_id: Option<String>,
) -> AppResult<String> {
    blocking(move || {
        if let Some(reason) = policy::refusal(&args) {
            return Err(reason.into());
        }
        let run = RunGuard::begin(run_id);
        let mut command = sf_command()?;
        if !args.is_empty() {
            command.args(&args);
        }
        if let Ok(workspace) = get_workspace(&app) {
            command.current_dir(workspace);
        }

        let output = run_cancellable(command, input, &run)?;
        output_to_string(&output)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `sf apex execute --json` reports a runtime throw inside a status-0
    /// envelope, so exit code alone says the run succeeded.
    #[test]
    fn a_runtime_exception_is_reported_with_its_stack() {
        let json = serde_json::json!({
            "status": 0,
            "result": {
                "success": false,
                "compiled": true,
                "compileProblem": "",
                "exceptionMessage": "System.MathException: Divide by 0",
                "exceptionStackTrace": "AnonymousBlock: line 1, column 1"
            }
        });
        let message = apex_failure_message(&json);
        assert!(message.contains("Divide by 0"));
        assert!(message.contains("line 1, column 1"));
    }

    #[test]
    fn a_compile_error_names_the_line_and_column() {
        let json = serde_json::json!({
            "status": 0,
            "result": {
                "success": false,
                "compiled": false,
                "compileProblem": "Unexpected token ')'",
                "line": 3,
                "column": 17
            }
        });
        let message = apex_failure_message(&json);
        assert!(message.contains("line 3"));
        assert!(message.contains("column 17"));
        assert!(message.contains("Unexpected token"));
    }

    #[test]
    fn a_compile_error_without_a_position_still_reports_the_problem() {
        let json = serde_json::json!({
            "status": 0,
            "result": { "success": false, "compileProblem": "Something broke" }
        });
        assert!(apex_failure_message(&json).contains("Something broke"));
    }

    #[test]
    fn empty_detail_falls_back_to_a_generic_message() {
        // Blank strings are the CLI's "not applicable", not real content.
        let json = serde_json::json!({
            "status": 0,
            "result": {
                "success": false,
                "compileProblem": "",
                "exceptionMessage": "",
                "exceptionStackTrace": ""
            }
        });
        assert_eq!(
            apex_failure_message(&json),
            "The Apex ran but reported failure."
        );
    }
}
