//! The workspace terminal: `sf` commands whose output shows up as it is
//! printed, and which can be stopped.
//!
//! The terminal used to wait for a command to finish before showing anything,
//! so a long retrieve looked frozen, and there was no way to stop one.

use std::borrow::Cow;
use std::io::{BufRead, BufReader, Read};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use regex::Regex;
use serde::Serialize;
use tauri::Emitter;
use ts_rs::TS;

use crate::commands::{blocking, kill_process_tree, sf_command, workspace_root, RunGuard};

/// Emitted for each batch of a running command's output, and once at the end.
pub(crate) const TERMINAL_EVENT: &str = "terminal_output";

/// Output from one stream, possibly several lines.
#[derive(TS, Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct TerminalChunk {
    /// `stdout` or `stderr`.
    pub stream: String,
    pub text: String,
}

/// How a terminal command ended.
#[derive(TS, Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct TerminalExit {
    /// The exit code, when the command ended by itself.
    pub code: Option<i32>,
    pub cancelled: bool,
    pub timed_out: bool,
    /// Output past the limit was not shown.
    pub truncated: bool,
}

#[derive(TS, Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct TerminalEvent {
    pub run_id: String,
    pub chunks: Vec<TerminalChunk>,
    /// Set on the run's last event; no output follows it.
    pub exit: Option<TerminalExit>,
}

/// A terminal command may run this long: a deploy with a long `--wait` fits.
const TERMINAL_TIMEOUT: Duration = Duration::from_secs(60 * 60);
/// Output shown per command, at most. More would only flood the panel.
const MAX_OUTPUT_BYTES: usize = 4 * 1024 * 1024;
/// Output is sent in batches this often, not line by line.
const BATCH_INTERVAL: Duration = Duration::from_millis(60);
const POLL: Duration = Duration::from_millis(25);
/// After the command ends, how long to wait for what is still in its pipes.
const DRAIN_GRACE: Duration = Duration::from_secs(2);

/// A raw output line as the panel shows it: without colour codes, and — when
/// a progress spinner redrew it with carriage returns — only its last state.
fn terminal_line(raw: &[u8]) -> String {
    static ANSI: OnceLock<Regex> = OnceLock::new();
    let ansi = ANSI.get_or_init(|| {
        Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]")
            .expect("valid pattern")
    });
    let text = String::from_utf8_lossy(raw);
    let line = text.trim_end_matches(['\n', '\r']);
    let shown = line.rsplit('\r').next().unwrap_or_default();
    match ansi.replace_all(shown, "") {
        Cow::Borrowed(clean) => clean.to_string(),
        Cow::Owned(clean) => clean,
    }
}

/// Sends a pipe's lines to the run loop, from a thread of its own.
fn forward_lines<R: Read + Send + 'static>(
    pipe: Option<R>,
    stream: &'static str,
    sender: Sender<(&'static str, String)>,
) {
    let Some(pipe) = pipe else { return };
    std::thread::spawn(move || {
        let mut reader = BufReader::new(pipe);
        let mut buffer = Vec::new();
        loop {
            buffer.clear();
            match reader.read_until(b'\n', &mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if sender.send((stream, terminal_line(&buffer))).is_err() {
                        break;
                    }
                }
            }
        }
    });
}

/// Output waiting to be sent, merged into one chunk per run of a stream.
struct Pending {
    chunks: Vec<TerminalChunk>,
    sent_bytes: usize,
    max_bytes: usize,
    truncated: bool,
}

impl Pending {
    fn push(&mut self, stream: &str, line: String) {
        if self.truncated {
            return;
        }
        if self.sent_bytes + line.len() > self.max_bytes {
            self.truncated = true;
            return;
        }
        self.sent_bytes += line.len() + 1;
        match self.chunks.last_mut() {
            Some(last) if last.stream == stream => {
                last.text.push('\n');
                last.text.push_str(&line);
            }
            _ => self.chunks.push(TerminalChunk {
                stream: stream.to_string(),
                text: line,
            }),
        }
    }

    /// Takes everything the pipes have produced so far.
    fn drain(&mut self, receiver: &Receiver<(&'static str, String)>, wait: Duration) -> bool {
        match receiver.recv_timeout(wait) {
            Ok((stream, line)) => self.push(stream, line),
            Err(RecvTimeoutError::Timeout) => return true,
            Err(RecvTimeoutError::Disconnected) => return false,
        }
        while let Ok((stream, line)) = receiver.try_recv() {
            self.push(stream, line);
        }
        true
    }
}

/// Runs `command`, handing its output to `emit` in batches as it arrives. The
/// last call carries how it ended, and nothing is emitted after it.
pub(crate) fn run_streaming(
    mut command: Command,
    cancelled: &AtomicBool,
    timeout: Duration,
    max_bytes: usize,
    mut emit: impl FnMut(Vec<TerminalChunk>, Option<TerminalExit>),
) -> Result<(), String> {
    if cancelled.load(Ordering::SeqCst) {
        emit(
            Vec::new(),
            Some(TerminalExit {
                cancelled: true,
                ..Default::default()
            }),
        );
        return Ok(());
    }

    // Nothing is typed into a command here; a prompt fails at once instead of
    // waiting forever for input that cannot come.
    command.stdin(Stdio::null());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|error| error.to_string())?;

    let (sender, receiver) = channel();
    forward_lines(child.stdout.take(), "stdout", sender.clone());
    forward_lines(child.stderr.take(), "stderr", sender);

    let mut pending = Pending {
        chunks: Vec::new(),
        sent_bytes: 0,
        max_bytes,
        truncated: false,
    };
    let mut exit = TerminalExit::default();
    let started = Instant::now();
    let mut last_batch = Instant::now();

    let status = loop {
        // Both pipes closed before the process ended: nothing to wait on but
        // the process itself.
        if !pending.drain(&receiver, POLL) {
            std::thread::sleep(POLL);
        }
        if !pending.chunks.is_empty() && last_batch.elapsed() >= BATCH_INTERVAL {
            emit(std::mem::take(&mut pending.chunks), None);
            last_batch = Instant::now();
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break Some(status);
        }
        if cancelled.load(Ordering::SeqCst) {
            kill_process_tree(&mut child);
            exit.cancelled = true;
            break None;
        }
        if started.elapsed() > timeout {
            kill_process_tree(&mut child);
            exit.timed_out = true;
            break None;
        }
    };

    // What the command wrote just before it ended is still in the pipes. A
    // process it left behind may hold them open, so this does not wait long.
    let deadline = Instant::now() + DRAIN_GRACE;
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        if !pending.drain(&receiver, left.min(POLL)) {
            break;
        }
    }

    exit.code = status.and_then(|status| status.code());
    exit.truncated = pending.truncated;
    emit(std::mem::take(&mut pending.chunks), Some(exit));
    Ok(())
}

/// Runs an `sf` command for the workspace terminal. Its output arrives as
/// `terminal_output` events for `run_id`; the command resolves after the last
/// one, and fails only when the command could not start. Stopped with
/// `cancel_sf_command`.
#[tauri::command]
pub async fn run_terminal_command(
    app: tauri::AppHandle,
    args: Vec<String>,
    run_id: String,
    workspace_id: Option<String>,
) -> Result<(), String> {
    blocking(move || {
        let run = RunGuard::begin(Some(run_id.clone()));
        let mut command = sf_command()?;
        command.args(&args);
        // In the workspace, so project commands find its sfdx-project.json.
        if let Ok(root) = workspace_root(&app, workspace_id.as_deref()) {
            command.current_dir(root);
        }
        run_streaming(
            command,
            &run.cancelled,
            TERMINAL_TIMEOUT,
            MAX_OUTPUT_BYTES,
            |chunks, exit| {
                let _ = app.emit(
                    TERMINAL_EVENT,
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
    use std::sync::Arc;

    /// Prints to both streams, then exits with 3.
    fn chatty() -> Command {
        if cfg!(windows) {
            let mut command = Command::new("cmd");
            // No spaces before `&` or `>`: cmd would echo them.
            command.args(["/C", "echo one& echo two>&2& echo three& exit /b 3"]);
            command
        } else {
            let mut command = Command::new("sh");
            command.args(["-c", "echo one; echo two >&2; echo three; exit 3"]);
            command
        }
    }

    /// Runs for about 30 seconds, through a shell so it has a child.
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

    type Events = Vec<(Vec<TerminalChunk>, Option<TerminalExit>)>;

    fn run(command: Command, cancelled: &AtomicBool, max_bytes: usize) -> Events {
        let mut events = Vec::new();
        run_streaming(
            command,
            cancelled,
            Duration::from_secs(60),
            max_bytes,
            |chunks, exit| events.push((chunks, exit)),
        )
        .expect("the command should start");
        events
    }

    fn text_of(events: &Events, stream: &str) -> String {
        events
            .iter()
            .flat_map(|(chunks, _)| chunks)
            .filter(|chunk| chunk.stream == stream)
            .map(|chunk| chunk.text.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn output_arrives_by_stream_and_the_last_event_says_how_it_ended() {
        let events = run(chatty(), &AtomicBool::new(false), MAX_OUTPUT_BYTES);

        assert_eq!(text_of(&events, "stdout"), "one\nthree");
        assert_eq!(text_of(&events, "stderr"), "two");
        let (_, exit) = events.last().unwrap();
        assert_eq!(
            exit.as_ref(),
            Some(&TerminalExit {
                code: Some(3),
                ..Default::default()
            })
        );
        // Only the last event carries the exit.
        assert!(events[..events.len() - 1]
            .iter()
            .all(|(_, exit)| exit.is_none()));
    }

    #[test]
    fn a_cancelled_command_stops_promptly_and_says_so() {
        let cancelled = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&cancelled);
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            flag.store(true, Ordering::SeqCst);
        });

        let started = Instant::now();
        let events = run(long_running(), &cancelled, MAX_OUTPUT_BYTES);

        let exit = events.last().unwrap().1.clone().unwrap();
        assert!(exit.cancelled);
        assert_eq!(exit.code, None);
        assert!(started.elapsed() < Duration::from_secs(15));
    }

    #[test]
    fn output_past_the_limit_is_left_out() {
        let events = run(chatty(), &AtomicBool::new(false), 5);
        assert_eq!(text_of(&events, "stdout"), "one");
        assert!(events.last().unwrap().1.as_ref().unwrap().truncated);
    }

    #[test]
    fn lines_lose_colour_codes_and_spinner_frames() {
        assert_eq!(terminal_line(b"\x1b[32mDeployed\x1b[0m\r\n"), "Deployed");
        assert_eq!(
            terminal_line(b"Deploying |\rDeploying /\rDeploying done\n"),
            "Deploying done"
        );
        assert_eq!(terminal_line(b"plain\n"), "plain");
    }
}
