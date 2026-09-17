//! Running Apex tests and reading what came back.
//!
//! `sf apex run test --result-format json` reports the run, each test, and —
//! with `--code-coverage` — which lines of each class the run touched. The
//! shapes below are only the parts the UI shows; everything else the CLI
//! returns (queue item ids, async job ids) is dropped here rather than carried
//! across the IPC boundary.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::sf::discover::sf_command;
use crate::sf::json::parse_sf_json;
use crate::sf::runner::{run_with_limits, RunGuard};
use crate::util::blocking;

/// A long test run is normal; the CLI's own `--wait` gives up first.
const TEST_TIMEOUT: Duration = Duration::from_secs(60 * 30);

/// Minutes the CLI waits for results before returning.
const WAIT_MINUTES: &str = "30";

/// What to run.
#[derive(TS, Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ApexTestScope {
    /// `RunLocalTests`, `RunAllTestsInOrg` or `RunSpecifiedTests`.
    pub level: String,
    /// With `RunSpecifiedTests`: class names, or `Class.method` for one test.
    #[serde(default)]
    pub tests: Option<Vec<String>>,
    /// Test suites to run instead of individual classes.
    #[serde(default)]
    pub suites: Option<Vec<String>>,
}

#[derive(TS, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ApexTestSummary {
    /// "Passed", "Failed", or what the org called it.
    pub outcome: String,
    #[ts(type = "number")]
    pub tests_ran: i64,
    #[ts(type = "number")]
    pub passing: i64,
    #[ts(type = "number")]
    pub failing: i64,
    #[ts(type = "number")]
    pub skipped: i64,
    /// Milliseconds the tests themselves took, without the CLI's own time.
    #[ts(type = "number")]
    pub run_time_ms: i64,
    /// The id to look the run up by in Setup.
    pub test_run_id: String,
    /// Percentages as the org words them, e.g. "74%". Absent without
    /// `--code-coverage`.
    #[ts(optional = nullable)]
    pub run_coverage: Option<String>,
    #[ts(optional = nullable)]
    pub org_coverage: Option<String>,
}

#[derive(TS, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ApexTestCase {
    /// `Class.method`.
    pub name: String,
    pub class_name: String,
    pub method_name: String,
    /// "Pass", "Fail", "Skip", or "CompileFail".
    pub outcome: String,
    #[ts(type = "number")]
    pub run_time_ms: i64,
    /// Why it failed, and where — both absent on a pass.
    #[ts(optional = nullable)]
    pub message: Option<String>,
    #[ts(optional = nullable)]
    pub stack_trace: Option<String>,
}

#[derive(TS, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ApexClassCoverage {
    /// The class or trigger, without its extension.
    pub name: String,
    #[ts(type = "number")]
    pub covered_percent: f64,
    #[ts(type = "number")]
    pub total_lines: i64,
    #[ts(type = "number")]
    pub covered_lines: i64,
    /// Lines the run never reached, ascending — the editor's gutter marks.
    #[ts(type = "number[]")]
    pub uncovered: Vec<i64>,
}

#[derive(TS, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ApexTestRun {
    pub summary: ApexTestSummary,
    /// Failures first: a run of four hundred tests is opened to see the three
    /// that broke.
    pub tests: Vec<ApexTestCase>,
    /// Least covered first, for the same reason.
    pub coverage: Vec<ApexClassCoverage>,
}

/// "2071 ms" → 2071. The CLI reports these as strings with a unit.
fn millis_from(value: &serde_json::Value) -> i64 {
    match value {
        serde_json::Value::Number(number) => number.as_f64().unwrap_or(0.0).round() as i64,
        serde_json::Value::String(text) => text
            .trim()
            .trim_end_matches(|c: char| c.is_ascii_alphabetic() || c.is_whitespace())
            .parse::<f64>()
            .map(|value| value.round() as i64)
            .unwrap_or(0),
        _ => 0,
    }
}

fn text(value: &serde_json::Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn number(value: &serde_json::Value) -> i64 {
    value.as_i64().unwrap_or(0)
}

fn summary_of(result: &serde_json::Value) -> ApexTestSummary {
    let summary = &result["summary"];
    ApexTestSummary {
        outcome: text(&summary["outcome"]).unwrap_or_else(|| "Unknown".to_string()),
        tests_ran: number(&summary["testsRan"]),
        passing: number(&summary["passing"]),
        failing: number(&summary["failing"]),
        skipped: number(&summary["skipped"]),
        run_time_ms: millis_from(&summary["testExecutionTime"]),
        test_run_id: text(&summary["testRunId"]).unwrap_or_default(),
        run_coverage: text(&summary["testRunCoverage"]),
        org_coverage: text(&summary["orgWideCoverage"]),
    }
}

/// How badly a result wants looking at: failures first, then skips.
fn attention(outcome: &str) -> u8 {
    match outcome {
        "Fail" | "CompileFail" => 0,
        "Skip" => 1,
        _ => 2,
    }
}

fn tests_of(result: &serde_json::Value) -> Vec<ApexTestCase> {
    let mut tests: Vec<ApexTestCase> = result["tests"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|test| {
            let class_name = text(&test["ApexClass"]["Name"]).unwrap_or_default();
            let method_name = text(&test["MethodName"]).unwrap_or_default();
            ApexTestCase {
                name: text(&test["FullName"])
                    .unwrap_or_else(|| format!("{class_name}.{method_name}")),
                class_name,
                method_name,
                outcome: text(&test["Outcome"]).unwrap_or_else(|| "Unknown".to_string()),
                run_time_ms: millis_from(&test["RunTime"]),
                message: text(&test["Message"]),
                stack_trace: text(&test["StackTrace"]),
            }
        })
        .collect();

    tests.sort_by(|a, b| {
        attention(&a.outcome)
            .cmp(&attention(&b.outcome))
            .then_with(|| a.name.cmp(&b.name))
    });
    tests
}

fn coverage_of(result: &serde_json::Value) -> Vec<ApexClassCoverage> {
    let mut classes: Vec<ApexClassCoverage> = result["coverage"]["coverage"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|entry| {
            let name = text(&entry["name"])?;

            // `lines` maps a line number to 1 when the run reached it.
            let mut uncovered: Vec<i64> = entry["lines"]
                .as_object()
                .map(|lines| {
                    lines
                        .iter()
                        .filter(|(_, hits)| hits.as_i64().unwrap_or(0) == 0)
                        .filter_map(|(line, _)| line.parse::<i64>().ok())
                        .collect()
                })
                .unwrap_or_default();
            uncovered.sort_unstable();

            Some(ApexClassCoverage {
                name,
                covered_percent: entry["coveredPercent"].as_f64().unwrap_or(0.0),
                total_lines: number(&entry["totalLines"]),
                covered_lines: number(&entry["totalCovered"]),
                uncovered,
            })
        })
        .collect();

    classes.sort_by(|a, b| {
        a.covered_percent
            .partial_cmp(&b.covered_percent)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.name.cmp(&b.name))
    });
    classes
}

/// Turns one `apex run test --json` payload into what the UI shows.
fn parse_run(json: &serde_json::Value) -> ApexTestRun {
    let result = &json["result"];
    ApexTestRun {
        summary: summary_of(result),
        tests: tests_of(result),
        coverage: coverage_of(result),
    }
}

/// Runs Apex tests and reports results with coverage.
///
/// The run itself happens in the org: cancelling stops ForgeSF waiting for it,
/// which is the same thing closing the CLI would do.
#[tauri::command]
pub async fn run_apex_tests(
    username: String,
    scope: ApexTestScope,
    run_id: Option<String>,
) -> AppResult<ApexTestRun> {
    blocking(move || {
        let run = RunGuard::begin(run_id);

        let mut command = sf_command()?;
        command.arg("apex").arg("run").arg("test");
        command.arg("--target-org").arg(&username);
        command.arg("--result-format").arg("json");
        command.arg("--code-coverage");
        command.arg("--wait").arg(WAIT_MINUTES);

        match scope.level.as_str() {
            "RunSpecifiedTests" => {
                let tests = scope.tests.unwrap_or_default();
                let suites = scope.suites.unwrap_or_default();
                if tests.is_empty() && suites.is_empty() {
                    return Err(AppError::new(
                        ErrorKind::Failed,
                        "Choose at least one test class or suite to run.",
                    ));
                }
                command.arg("--test-level").arg("RunSpecifiedTests");
                for test in tests {
                    command.arg("--tests").arg(test);
                }
                for suite in suites {
                    command.arg("--suite-names").arg(suite);
                }
            }
            level @ ("RunLocalTests" | "RunAllTestsInOrg") => {
                command.arg("--test-level").arg(level);
            }
            other => {
                return Err(AppError::new(
                    ErrorKind::Failed,
                    format!("'{other}' is not a test level ForgeSF knows."),
                ));
            }
        }

        let output = run_with_limits(command, None, &run.cancelled, TEST_TIMEOUT)?;

        // A run with failing tests exits non-zero but still reports results,
        // which are exactly what the user wants to see. Only a payload with no
        // summary at all is an error.
        let json = match parse_sf_json(&output) {
            Ok(json) => json,
            Err(error) => {
                let raw: Option<serde_json::Value> = serde_json::from_slice(&output.stdout).ok();
                match raw {
                    Some(json) if json["result"]["summary"].is_object() => json,
                    _ => return Err(error),
                }
            }
        };

        Ok(parse_run(&json))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> serde_json::Value {
        serde_json::json!({
            "result": {
                "summary": {
                    "outcome": "Failed",
                    "testsRan": 3,
                    "passing": 1,
                    "failing": 1,
                    "skipped": 1,
                    "testRunId": "707gL00001Iv74M",
                    "testExecutionTime": "2071 ms",
                    "commandTime": "431 ms",
                    "testRunCoverage": "74%",
                    "orgWideCoverage": "2%"
                },
                "tests": [
                    {
                        "FullName": "AccountServiceTest.testPasses",
                        "MethodName": "testPasses",
                        "Outcome": "Pass",
                        "RunTime": 23,
                        "Message": null,
                        "StackTrace": null,
                        "ApexClass": { "Name": "AccountServiceTest" }
                    },
                    {
                        "FullName": "AccountServiceTest.testSkipped",
                        "MethodName": "testSkipped",
                        "Outcome": "Skip",
                        "RunTime": 0,
                        "ApexClass": { "Name": "AccountServiceTest" }
                    },
                    {
                        "FullName": "AccountServiceTest.testFails",
                        "MethodName": "testFails",
                        "Outcome": "Fail",
                        "RunTime": 84,
                        "Message": "System.AssertException: Assertion Failed",
                        "StackTrace": "Class.AccountServiceTest.testFails: line 12, column 1",
                        "ApexClass": { "Name": "AccountServiceTest" }
                    }
                ],
                "coverage": {
                    "coverage": [
                        {
                            "name": "AccountService",
                            "totalLines": 4,
                            "totalCovered": 2,
                            "coveredPercent": 50,
                            "lines": { "5": 1, "6": 0, "7": 1, "9": 0 }
                        },
                        {
                            "name": "ContactService",
                            "totalLines": 2,
                            "totalCovered": 2,
                            "coveredPercent": 100,
                            "lines": { "3": 1, "4": 1 }
                        }
                    ]
                }
            }
        })
    }

    #[test]
    fn a_run_is_read_with_its_failures_first() {
        let run = parse_run(&fixture());

        assert_eq!(
            run.summary,
            ApexTestSummary {
                outcome: "Failed".to_string(),
                tests_ran: 3,
                passing: 1,
                failing: 1,
                skipped: 1,
                run_time_ms: 2071,
                test_run_id: "707gL00001Iv74M".to_string(),
                run_coverage: Some("74%".to_string()),
                org_coverage: Some("2%".to_string()),
            }
        );

        // Failures, then skips, then passes — the order you read them in.
        assert_eq!(
            run.tests
                .iter()
                .map(|t| t.outcome.as_str())
                .collect::<Vec<_>>(),
            vec!["Fail", "Skip", "Pass"]
        );
        let failure = &run.tests[0];
        assert_eq!(failure.name, "AccountServiceTest.testFails");
        assert_eq!(failure.class_name, "AccountServiceTest");
        assert_eq!(failure.run_time_ms, 84);
        assert!(failure.message.as_deref().unwrap().contains("Assertion"));
        assert!(failure.stack_trace.as_deref().unwrap().contains("line 12"));
        // A passing test carries no message rather than an empty one.
        assert_eq!(run.tests[2].message, None);
    }

    #[test]
    fn coverage_names_the_lines_the_run_never_reached() {
        let run = parse_run(&fixture());

        // Least covered first.
        assert_eq!(
            run.coverage
                .iter()
                .map(|c| c.name.as_str())
                .collect::<Vec<_>>(),
            vec!["AccountService", "ContactService"]
        );
        assert_eq!(
            run.coverage[0],
            ApexClassCoverage {
                name: "AccountService".to_string(),
                covered_percent: 50.0,
                total_lines: 4,
                covered_lines: 2,
                uncovered: vec![6, 9],
            }
        );
        assert!(run.coverage[1].uncovered.is_empty());
    }

    #[test]
    fn a_run_without_coverage_or_results_is_still_read() {
        let run = parse_run(&serde_json::json!({
            "result": { "summary": { "outcome": "Passed", "testsRan": 0 } }
        }));

        assert_eq!(run.summary.outcome, "Passed");
        assert_eq!(run.summary.run_time_ms, 0);
        assert_eq!(run.summary.run_coverage, None);
        assert!(run.tests.is_empty());
        assert!(run.coverage.is_empty());
    }

    #[test]
    fn times_are_read_whether_the_cli_sends_a_string_or_a_number() {
        assert_eq!(millis_from(&serde_json::json!("2071 ms")), 2071);
        assert_eq!(millis_from(&serde_json::json!("2071")), 2071);
        assert_eq!(millis_from(&serde_json::json!(84)), 84);
        assert_eq!(millis_from(&serde_json::json!(83.6)), 84);
        assert_eq!(millis_from(&serde_json::json!(null)), 0);
        assert_eq!(millis_from(&serde_json::json!("not a time")), 0);
    }
}
