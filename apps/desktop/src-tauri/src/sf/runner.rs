//! Running CLI processes to completion: draining their output, cancelling
//! them by run id, timing them out, and stopping their whole process tree.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use crate::error::{AppError, AppResult, ErrorKind};
// Only `kill_process_tree` uses it, and only on Windows — an ungated import
// is an unused one everywhere else, which `-D warnings` rejects.
#[cfg(windows)]
use crate::sf::discover::hide_console;
use crate::util::{lock, next_temp_suffix};

/// Cancellation flags for in-flight runs, keyed by the id the UI generated,
/// with when each entry was created.
///
/// This replaced a single global flag that every new command reset: a Cancel
/// pressed while the CLI was still starting was wiped, and cancelling in
/// Developer Tools also killed a terminal command running at the same time.
type RunTable = HashMap<String, (Arc<AtomicBool>, Instant)>;

fn run_table() -> &'static Mutex<RunTable> {
    static RUNS: OnceLock<Mutex<RunTable>> = OnceLock::new();
    RUNS.get_or_init(Default::default)
}

/// A cancel for a run that never started (or already finished) is dropped
/// after this long, so the table cannot grow without bound.
const STALE_CANCEL_AGE: Duration = Duration::from_secs(600);

/// One cancellable run, registered for as long as it is alive.
pub(crate) struct RunGuard {
    pub(crate) id: String,
    pub(crate) cancelled: Arc<AtomicBool>,
}

impl RunGuard {
    /// Registers a run. A cancel that arrived before registration is honoured.
    /// Runs without an id (callers that never cancel) get a private one.
    pub(crate) fn begin(id: Option<String>) -> Self {
        let id = id.unwrap_or_else(|| format!("internal-{}", next_temp_suffix()));
        let mut table = lock(run_table());
        // Only entries no live run holds can be stale.
        table.retain(|_, (flag, created)| {
            Arc::strong_count(flag) > 1 || created.elapsed() < STALE_CANCEL_AGE
        });
        let cancelled = table
            .entry(id.clone())
            .or_insert_with(|| (Arc::new(AtomicBool::new(false)), Instant::now()))
            .0
            .clone();
        Self { id, cancelled }
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        lock(run_table()).remove(&self.id);
    }
}

/// Stops the run started with `run_id`, killing its whole process tree. Safe
/// to call before the run starts or after it ends.
#[tauri::command]
pub fn cancel_sf_command(run_id: String) {
    let mut table = lock(run_table());
    table
        .entry(run_id)
        .or_insert_with(|| (Arc::new(AtomicBool::new(false)), Instant::now()))
        .0
        .store(true, Ordering::SeqCst);
}

/// How long a Developer Tools command may run before being killed.
///
/// Nothing here had a timeout: a hung CLI — an expired token waiting on stdin,
/// a stalled network — held the pane forever with no way out.
const SF_COMMAND_TIMEOUT: Duration = Duration::from_secs(300);

/// Runs a command to completion, killing it on cancellation or timeout.
pub(crate) fn run_cancellable(
    command: Command,
    input: Option<String>,
    run: &RunGuard,
) -> AppResult<std::process::Output> {
    run_with_limits(command, input, &run.cancelled, SF_COMMAND_TIMEOUT)
}

/// Reads a child's pipe to the end on its own thread.
fn spawn_pipe_reader<R: Read + Send + 'static>(
    pipe: Option<R>,
) -> Option<std::thread::JoinHandle<Vec<u8>>> {
    pipe.map(|mut pipe| {
        std::thread::spawn(move || {
            let mut buffer = Vec::new();
            let _ = pipe.read_to_end(&mut buffer);
            buffer
        })
    })
}

fn join_pipe_reader(reader: Option<std::thread::JoinHandle<Vec<u8>>>) -> Vec<u8> {
    reader
        .and_then(|handle| handle.join().ok())
        .unwrap_or_default()
}

/// Stops a child and every process it started.
///
/// On Windows `sf` is `sf.cmd`: the child is `cmd.exe`, and the CLI itself runs
/// as a `node.exe` grandchild. `Child::kill` only ended the wrapper, so after
/// "Cancel" the CLI kept running and kept spending the org's API calls. On
/// Unix the child leads its own process group (see `run_with_limits`), which is
/// signalled as a whole.
pub(crate) fn kill_process_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let mut taskkill = Command::new("taskkill");
        hide_console(&mut taskkill);
        let _ = taskkill
            .args(["/T", "/F", "/PID", &child.id().to_string()])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-KILL", "--", &format!("-{}", child.id())])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    let _ = child.kill();
    // Reap it so no process handle is left behind.
    let _ = child.wait();
}

/// The runner behind `run_cancellable`, with the timeout as a parameter so
/// tests do not have to wait five minutes.
pub(crate) fn run_with_limits(
    mut command: Command,
    input: Option<String>,
    cancelled: &AtomicBool,
    timeout: Duration,
) -> AppResult<std::process::Output> {
    if cancelled.load(Ordering::SeqCst) {
        return Err(AppError::cancelled());
    }

    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());

    // Its own process group, so cancelling can stop everything it spawns.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }

    let mut child = command.spawn()?;

    // Drain both pipes from the moment the child starts. They used to be read
    // only after it exited, so once `sf` wrote more than the OS pipe buffer —
    // a few KB on Windows, i.e. a modest SOQL result — it blocked on the write,
    // never exited, and the query hung until the timeout killed it.
    let stdout_reader = spawn_pipe_reader(child.stdout.take());
    let stderr_reader = spawn_pipe_reader(child.stderr.take());

    if let Some(text) = input {
        let Some(mut stdin) = child.stdin.take() else {
            kill_process_tree(&mut child);
            return Err("Could not open stdin for the Salesforce CLI.".into());
        };
        // Written from its own thread: a large input would otherwise block
        // here until the child read it, while nothing polls for cancellation.
        std::thread::spawn(move || stdin.write_all(text.as_bytes()));
    } else {
        drop(child.stdin.take());
    }

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        // On cancel or timeout the readers are left to finish on their own:
        // joining them could block if some process still holds a pipe open.
        if cancelled.load(Ordering::SeqCst) {
            kill_process_tree(&mut child);
            return Err(AppError::cancelled());
        }
        if started.elapsed() > timeout {
            kill_process_tree(&mut child);
            return Err(AppError::new(
                ErrorKind::Timeout,
                format!(
                    "The command was still running after {} seconds and was stopped.",
                    timeout.as_secs()
                ),
            ));
        }
        std::thread::sleep(Duration::from_millis(50));
    };

    Ok(std::process::Output {
        status,
        stdout: join_pipe_reader(stdout_reader),
        stderr: join_pipe_reader(stderr_reader),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::scratch_dir;
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use crate::util::{lock, next_temp_suffix};

    /// A command that prints `path`'s contents to stdout.
    fn print_file(path: &Path) -> Command {
        if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.arg("/C").arg("type").arg(path);
            command
        } else {
            let mut command = Command::new("cat");
            command.arg(path);
            command
        }
    }

    /// A command that runs for about 30 seconds, via a shell so it has a child.
    fn long_running() -> Command {
        if cfg!(windows) {
            let mut command = Command::new("cmd");
            command.args(["/C", "ping -n 30 127.0.0.1 >NUL"]);
            command
        } else {
            let mut command = Command::new("sh");
            command.args(["-c", "sleep 30"]);
            command
        }
    }

    #[test]
    fn the_runner_drains_output_larger_than_a_pipe_buffer() {
        // Several MB: far beyond any OS pipe buffer. Before the fix the child
        // blocked writing and the run only ended at the timeout.
        let dir = scratch_dir("big-output");
        let file = dir.join("big.txt");
        let line = "0123456789abcdefghijklmnopqrstuvwxyz\n";
        fs::write(&file, line.repeat(80_000)).unwrap();

        let started = Instant::now();
        let output = run_with_limits(
            print_file(&file),
            None,
            &AtomicBool::new(false),
            Duration::from_secs(60),
        )
        .expect("the command should complete");

        assert!(output.status.success());
        assert!(output.stdout.len() >= line.len() * 80_000);
        assert!(started.elapsed() < Duration::from_secs(30));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cancelled_run_stops_promptly() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&cancelled);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            flag.store(true, Ordering::SeqCst);
        });

        let started = Instant::now();
        let result = run_with_limits(long_running(), None, &cancelled, Duration::from_secs(60));

        assert_eq!(result.unwrap_err().kind, ErrorKind::Cancelled);
        assert!(started.elapsed() < Duration::from_secs(15));
    }

    #[test]
    fn a_run_past_its_timeout_is_stopped() {
        let started = Instant::now();
        let result = run_with_limits(
            long_running(),
            None,
            &AtomicBool::new(false),
            Duration::from_millis(500),
        );

        let error = result.unwrap_err();
        assert_eq!(error.kind, ErrorKind::Timeout);
        assert!(error.message.contains("still running"));
        assert!(started.elapsed() < Duration::from_secs(15));
    }

    #[test]
    fn a_cancel_that_arrives_before_the_run_starts_is_honoured() {
        let id = format!("early-{}", next_temp_suffix());
        cancel_sf_command(id.clone());

        let run = RunGuard::begin(Some(id.clone()));
        assert!(run.cancelled.load(Ordering::SeqCst));
        assert_eq!(
            run_with_limits(
                long_running(),
                None,
                &run.cancelled,
                Duration::from_secs(60)
            )
            .unwrap_err()
            .kind,
            ErrorKind::Cancelled
        );

        drop(run);
        assert!(!lock(run_table()).contains_key(&id));
    }

    #[test]
    fn cancelling_one_run_leaves_another_running() {
        let first = RunGuard::begin(Some(format!("one-{}", next_temp_suffix())));
        let second = RunGuard::begin(Some(format!("two-{}", next_temp_suffix())));

        cancel_sf_command(first.id.clone());

        assert!(first.cancelled.load(Ordering::SeqCst));
        assert!(!second.cancelled.load(Ordering::SeqCst));
    }
}
