//! Finding the `sf` executable, starting it safely, and describing the installed CLI.

use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use tauri::Manager;
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::sf::json::output_to_string;
use crate::util::{blocking, lock};

/// Resolved once per process. Probing costs a full `sf --version` spawn — a
/// Node.js start-up, typically 0.5–2s — so doing it per command made every
/// call pay that price twice.
static SF_EXECUTABLE: Mutex<Option<String>> = Mutex::new(None);

/// A path chosen in Settings, which beats everything discovery would find.
///
/// Set at startup from the saved preference, and whenever it changes. Held
/// separately from the cache so clearing it falls back to discovery rather
/// than to the last path that happened to work.
static SF_OVERRIDE: Mutex<Option<String>> = Mutex::new(None);

/// Where the `sf` CLI is looked for, in order.
///
/// A GUI app launched from Finder or a desktop entry does not inherit the
/// login shell's `PATH`, so a bare `sf` lookup finds nothing on macOS or Linux
/// even when the CLI is installed and works fine in a terminal. Discovery was
/// previously Windows-only paths plus that bare lookup, which meant the app
/// simply could not find the CLI on the platforms the README advertises.
fn sf_candidates() -> Vec<String> {
    let mut candidates: Vec<String> = Vec::new();

    // Chosen in Settings: the most explicit statement there is.
    if let Some(configured) = lock(&SF_OVERRIDE).clone() {
        candidates.push(configured);
    }

    // An explicit override always wins.
    if let Ok(configured) = std::env::var("FORGESF_SF_PATH") {
        if !configured.trim().is_empty() {
            candidates.push(configured);
        }
    }

    #[cfg(windows)]
    {
        candidates.push(r"C:\Program Files\sf\bin\sf.cmd".to_string());
        candidates.push(r"C:\Program Files\sfdx\bin\sf.cmd".to_string());
        if let Ok(appdata) = std::env::var("LOCALAPPDATA") {
            candidates.push(format!(r"{appdata}\sf\bin\sf.cmd"));
        }
        candidates.push("sf.cmd".to_string());
    }

    #[cfg(not(windows))]
    {
        // The common install locations: Homebrew (Apple silicon and Intel),
        // the Salesforce installer, npm global prefixes, and asdf/volta shims.
        candidates.push("/opt/homebrew/bin/sf".to_string());
        candidates.push("/usr/local/bin/sf".to_string());
        candidates.push("/usr/bin/sf".to_string());
        candidates.push("/snap/bin/sf".to_string());
        if let Ok(home) = std::env::var("HOME") {
            candidates.push(format!("{home}/.local/bin/sf"));
            candidates.push(format!("{home}/.volta/bin/sf"));
            candidates.push(format!("{home}/.asdf/shims/sf"));
            candidates.push(format!("{home}/.npm-global/bin/sf"));
        }
    }

    // PATH last: it works when the app was started from a shell, and costs
    // nothing when it was not.
    candidates.push("sf".to_string());
    candidates
}

/// Whether `candidate` runs and answers as a CLI.
fn probe_sf(candidate: &str) -> bool {
    let mut probe = Command::new(candidate);
    hide_console(&mut probe);
    no_working_directory_lookup(&mut probe);
    match probe.arg("--version").output() {
        Ok(output) => output.status.success() || !output.stdout.is_empty(),
        Err(_) => false,
    }
}

fn find_sf_executable() -> AppResult<String> {
    if let Some(cached) = lock(&SF_EXECUTABLE).clone() {
        return Ok(cached);
    }

    for candidate in sf_candidates() {
        if probe_sf(&candidate) {
            // Only successful lookups are cached: a failure may simply mean
            // the CLI is not installed *yet*, and should be re-probed.
            *lock(&SF_EXECUTABLE) = Some(candidate.clone());
            return Ok(candidate);
        }
    }

    Err(AppError::new(
        ErrorKind::CliMissing,
        "Could not find the 'sf' Salesforce CLI.\n\
         Install it from https://developer.salesforce.com/tools/salesforcecli, \
         then either restart ForgeSF from a terminal where `sf --version` works, \
         or set FORGESF_SF_PATH to its full path.",
    ))
}

/// Suppresses the console window Windows pops for every `sf.cmd` spawn.
#[cfg(windows)]
pub(crate) fn hide_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
pub(crate) fn hide_console(_command: &mut Command) {}

/// Stops `cmd.exe` looking for programs in the working directory first.
///
/// On Windows `sf` is a batch file, and cmd.exe searches the current directory
/// before `PATH`. The npm-installed CLI's `sf.cmd` starts a bare `node`, and
/// project commands run inside the workspace, so a `node.exe` sitting in a
/// cloned repository would have run in place of Node.
#[cfg(windows)]
fn no_working_directory_lookup(command: &mut Command) {
    command.env("NoDefaultCurrentDirectoryInExePath", "1");
}

#[cfg(not(windows))]
fn no_working_directory_lookup(_command: &mut Command) {}

/// Working directory for `sf` calls that are not about a particular project.
///
/// Commands such as `org list metadata` or `data query` ran with no working
/// directory set, so the CLI wrote its project-local cache (`.sf/orgs/…`) into
/// wherever ForgeSF happened to be launched from — a stray `.sf/` folder in the
/// repository was the visible symptom. Project commands still override this
/// with the workspace.
static NEUTRAL_CWD: OnceLock<PathBuf> = OnceLock::new();

/// One-time setup that needs the app handle. Called from `run`'s setup hook.
pub fn init(app: &tauri::AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        if fs::create_dir_all(&dir).is_ok() {
            let _ = NEUTRAL_CWD.set(dir);
        }
    }
}

/// The installed Salesforce CLI, as far as ForgeSF can tell.
#[derive(TS, Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct CliInfo {
    pub found: bool,
    /// e.g. `2.150.6`.
    pub version: Option<String>,
    /// Whether this version supports what ForgeSF relies on.
    pub supported: bool,
    /// What to do about it, when something is wrong.
    pub message: Option<String>,
}

/// Oldest major version with the `sf project deploy …` commands (including
/// `--async`, `report` and `cancel`) that deploy jobs use.
const MIN_SF_MAJOR: u32 = 2;

/// The version from `sf --version` output such as
/// `@salesforce/cli/2.150.6 win32-x64 node-v24.19.0`.
fn parse_cli_version(output: &str) -> Option<(String, u32)> {
    let token = output
        .split_whitespace()
        .find(|token| token.starts_with("@salesforce/cli/"))?;
    let version = token.trim_start_matches("@salesforce/cli/").to_string();
    let major = version.split('.').next()?.parse().ok()?;
    Some((version, major))
}

fn cli_info_from(output: AppResult<String>) -> CliInfo {
    match output {
        Err(error) => CliInfo {
            found: false,
            version: None,
            supported: false,
            message: Some(error.message),
        },
        Ok(text) => match parse_cli_version(&text) {
            Some((version, major)) if major >= MIN_SF_MAJOR => CliInfo {
                found: true,
                version: Some(version),
                supported: true,
                message: None,
            },
            Some((version, _)) => CliInfo {
                found: true,
                message: Some(format!(
                    "Salesforce CLI {version} is too old for ForgeSF. Update it with \
                     `sf update` (or reinstall) to version {MIN_SF_MAJOR} or later."
                )),
                version: Some(version),
                supported: false,
            },
            None => CliInfo {
                found: true,
                version: None,
                supported: false,
                message: Some(
                    "The installed command is not the Salesforce CLI (`sf`) ForgeSF expects."
                        .to_string(),
                ),
            },
        },
    }
}

/// Points ForgeSF at a particular `sf`, or back at discovery when empty.
///
/// The path is probed before it is accepted, so a typo is reported here rather
/// than as "the CLI is missing" on the next command.
#[tauri::command]
pub async fn set_sf_path(path: Option<String>) -> AppResult<CliInfo> {
    blocking(move || {
        let chosen = path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());

        if let Some(candidate) = &chosen {
            if !probe_sf(candidate) {
                return Err(AppError::new(
                    ErrorKind::CliMissing,
                    format!("'{candidate}' did not answer as the Salesforce CLI."),
                ));
            }
        }

        *lock(&SF_OVERRIDE) = chosen;
        // Discovery runs again from scratch: the cached path may be the one
        // just replaced, or the one just cleared.
        *lock(&SF_EXECUTABLE) = None;

        let output = run_sf(["--version"]).and_then(|output| output_to_string(&output));
        Ok(cli_info_from(output))
    })
    .await
}

/// Reports whether a usable Salesforce CLI is installed.
#[tauri::command]
pub async fn cli_info() -> AppResult<CliInfo> {
    blocking(|| {
        let output = run_sf(["--version"]).and_then(|output| output_to_string(&output));
        Ok(cli_info_from(output))
    })
    .await
}

/// Builds a `Command` for the resolved `sf` executable.
pub(crate) fn sf_command() -> AppResult<Command> {
    let mut command = Command::new(find_sf_executable()?);
    hide_console(&mut command);
    no_working_directory_lookup(&mut command);
    if let Some(dir) = NEUTRAL_CWD.get() {
        command.current_dir(dir);
    }
    Ok(command)
}

pub(crate) fn run_sf<I, S>(args: I) -> AppResult<std::process::Output>
where
    I: IntoIterator<Item = S>,
    S: AsRef<std::ffi::OsStr>,
{
    Ok(sf_command()?.args(args).output()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::{cleanup, scratch_dir};
    use std::fs;

    use std::process::Command;

    #[test]
    fn the_cli_version_decides_support() {
        let current = cli_info_from(Ok(
            "@salesforce/cli/2.150.6 win32-x64 node-v24.19.0\n".to_string()
        ));
        assert!(current.found && current.supported);
        assert_eq!(current.version.as_deref(), Some("2.150.6"));

        let old = cli_info_from(Ok(
            "@salesforce/cli/1.86.0 darwin-arm64 node-v18".to_string()
        ));
        assert!(old.found && !old.supported);
        assert!(old.message.unwrap().contains("too old"));

        let foreign = cli_info_from(Ok("sfdx-cli/7.209.6 win32-x64".to_string()));
        assert!(foreign.found && !foreign.supported);

        let missing = cli_info_from(Err(AppError::new(
            ErrorKind::CliMissing,
            "Could not find the 'sf' Salesforce CLI.",
        )));
        assert!(!missing.found && !missing.supported);
        assert_eq!(
            missing.message.as_deref(),
            Some("Could not find the 'sf' Salesforce CLI.")
        );
    }

    /// On Windows `sf` is a batch file, and cmd.exe used to look for the
    /// programs it starts in the working directory — a workspace — first.
    #[cfg(windows)]
    #[test]
    fn a_program_planted_in_the_working_directory_is_not_run() {
        let bin = scratch_dir("bin");
        let workspace = scratch_dir("planted");
        // Like the npm-installed `sf.cmd`, which starts a bare `node`.
        let launcher = bin.join("launcher.cmd");
        fs::write(&launcher, "@echo off\r\nforgesf-probe-tool\r\n").unwrap();
        fs::write(
            workspace.join("forgesf-probe-tool.cmd"),
            "@echo off\r\necho planted\r\n",
        )
        .unwrap();

        let run = |harden: bool| {
            let mut command = Command::new(&launcher);
            command.current_dir(&workspace);
            if harden {
                no_working_directory_lookup(&mut command);
            } else {
                // Some shells set it already; a desktop launch does not.
                command.env_remove("NoDefaultCurrentDirectoryInExePath");
            }
            let output = command.output().unwrap();
            String::from_utf8_lossy(&output.stdout).to_string()
        };

        // Without the setting the planted program runs, so the test can fail.
        assert!(run(false).contains("planted"));
        assert!(!run(true).contains("planted"));
        cleanup(&[&bin, &workspace]);
    }
}
