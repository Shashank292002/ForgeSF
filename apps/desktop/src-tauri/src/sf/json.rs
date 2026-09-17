//! Reading the CLI's `--json` envelopes into results, or into readable errors.

use crate::error::{AppError, AppResult, ErrorKind};

/// Last resort when the CLI produced nothing machine-readable.
pub(crate) fn sf_plain_error(output: &std::process::Output) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stderr.is_empty() {
        return stderr;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !stdout.is_empty() {
        return stdout;
    }
    format!("The Salesforce CLI exited with {}.", output.status)
}

/// Builds a readable message from the CLI's structured error envelope.
///
/// `sf --json` reports failures as `{ status, name, message, actions }`, and
/// deploys/retrieves add per-component detail. All of that used to be dumped
/// on the user as a raw `STDOUT:/STDERR:` blob.
pub(crate) fn sf_error_message(json: &serde_json::Value, output: &std::process::Output) -> String {
    let mut parts: Vec<String> = Vec::new();

    if let Some(message) = json.get("message").and_then(serde_json::Value::as_str) {
        parts.push(message.trim().to_string());
    }

    // Component-level failures carry the detail a developer actually needs.
    if let Some(failures) = json
        .pointer("/result/details/componentFailures")
        .and_then(serde_json::Value::as_array)
    {
        for failure in failures {
            let problem = failure
                .get("problem")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            if problem.is_empty() {
                continue;
            }
            match failure.get("fullName").and_then(serde_json::Value::as_str) {
                Some(name) if !name.is_empty() => parts.push(format!("{name}: {problem}")),
                _ => parts.push(problem.to_string()),
            }
        }
    }

    // The CLI's own suggested next steps ("Run `sf org login web`…").
    if let Some(actions) = json.get("actions").and_then(serde_json::Value::as_array) {
        for action in actions.iter().filter_map(serde_json::Value::as_str) {
            parts.push(format!("→ {action}"));
        }
    }

    if parts.is_empty() {
        sf_plain_error(output)
    } else {
        parts.join("\n")
    }
}

/// Error names the CLI gives a failure that logging in again would fix.
const AUTH_ERROR_NAMES: &[&str] = &[
    "RefreshTokenAuthError",
    "NamedOrgNotFoundError",
    "NoAuthInfoFound",
    "NoAuthInfoFoundError",
    "INVALID_SESSION_ID",
];

/// How the CLI and the Salesforce API word the same failures, for output
/// that carries no error name.
const AUTH_ERROR_PHRASES: &[&str] = &[
    "expired access/refresh token",
    "invalid_session_id",
    "session expired or invalid",
    "no authorization information found",
    "invalid_grant",
];

/// A failed CLI run as an error, marked when logging in again would fix it.
pub(crate) fn cli_failure(name: Option<&str>, message: String) -> AppError {
    let lower = message.to_lowercase();
    let auth = name.is_some_and(|name| AUTH_ERROR_NAMES.contains(&name))
        || AUTH_ERROR_PHRASES
            .iter()
            .any(|phrase| lower.contains(phrase));
    let kind = if auth {
        ErrorKind::AuthRequired
    } else {
        ErrorKind::Failed
    };
    AppError::new(kind, message)
}

/// The error for a failed `--json` envelope.
pub(crate) fn envelope_failure(
    json: &serde_json::Value,
    output: &std::process::Output,
) -> AppError {
    cli_failure(
        json.get("name").and_then(serde_json::Value::as_str),
        sf_error_message(json, output),
    )
}

/// Parses a `--json` response, returning the envelope on success.
///
/// Exit status alone is not a reliable signal: some commands exit 0 while
/// `result.status` is `"Failed"`, and the previous helper treated *unparseable*
/// output as success — turning a broken CLI response into a silent false pass.
pub(crate) fn parse_sf_json(output: &std::process::Output) -> AppResult<serde_json::Value> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    // `sf` prints its JSON envelope on stdout even for failures; fall back to
    // stderr for cases where it died before producing one.
    let json: serde_json::Value = serde_json::from_str(stdout.trim())
        .or_else(|_| serde_json::from_str(stderr.trim()))
        .map_err(|_| cli_failure(None, sf_plain_error(output)))?;

    let envelope_failed = json
        .get("status")
        .and_then(serde_json::Value::as_i64)
        .is_some_and(|status| status != 0);

    let result_failed = json
        .pointer("/result/status")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|status| status.eq_ignore_ascii_case("failed"));

    if envelope_failed || result_failed || !output.status.success() {
        return Err(envelope_failure(&json, output));
    }

    Ok(json)
}

/// For commands invoked without `--json`, where only the exit code is available.
pub(crate) fn output_to_string(output: &std::process::Output) -> AppResult<String> {
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(cli_failure(None, sf_plain_error(output)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What the CLI printed, and how it exited.
    fn output(code: i32, stdout: &str) -> std::process::Output {
        #[cfg(windows)]
        let status = {
            use std::os::windows::process::ExitStatusExt;
            std::process::ExitStatus::from_raw(code as u32)
        };
        #[cfg(unix)]
        let status = {
            use std::os::unix::process::ExitStatusExt;
            std::process::ExitStatus::from_raw(code << 8)
        };
        std::process::Output {
            status,
            stdout: stdout.as_bytes().to_vec(),
            stderr: Vec::new(),
        }
    }

    #[test]
    fn an_expired_session_asks_for_a_new_login() {
        for envelope in [
            r#"{"status":1,"name":"RefreshTokenAuthError","message":"Error authenticating with the refresh token due to: expired access/refresh token"}"#,
            r#"{"status":1,"name":"NamedOrgNotFoundError","message":"No authorization information found for dev."}"#,
            r#"{"status":1,"name":"Error","message":"INVALID_SESSION_ID: Session expired or invalid"}"#,
        ] {
            let error = parse_sf_json(&output(1, envelope)).unwrap_err();
            assert_eq!(error.kind, ErrorKind::AuthRequired, "{envelope}");
        }

        let plain = output_to_string(&output(
            1,
            "Error (1): No authorization information found for uat.",
        ));
        assert_eq!(plain.unwrap_err().kind, ErrorKind::AuthRequired);
    }

    #[test]
    fn other_failures_stay_plain_failures() {
        let error = parse_sf_json(&output(
            1,
            r#"{"status":1,"name":"MALFORMED_QUERY","message":"unexpected token: FORM"}"#,
        ))
        .unwrap_err();
        assert_eq!(error.kind, ErrorKind::Failed);
        assert_eq!(error.message, "unexpected token: FORM");
    }

    #[test]
    fn a_successful_envelope_is_returned() {
        let json = parse_sf_json(&output(0, r#"{"status":0,"result":{"totalSize":1}}"#)).unwrap();
        assert_eq!(json["result"]["totalSize"], 1);
    }
}
