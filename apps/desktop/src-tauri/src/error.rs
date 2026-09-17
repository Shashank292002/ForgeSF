//! The error every command reports to the page: a readable message, and what
//! kind of problem it is.
//!
//! Commands used to fail with a bare string, so the page could only show the
//! text. With the kind it can offer the fix — log in again when a session has
//! expired — and stay quiet about a run the user cancelled.

use std::fmt;

use serde::Serialize;
use ts_rs::TS;

/// What went wrong, in terms the UI can act on.
#[derive(TS, Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum ErrorKind {
    /// The Salesforce CLI isn't installed, or ForgeSF can't find it.
    CliMissing,
    /// The org needs logging in again: its session expired or was revoked,
    /// or the CLI has no authorization for it.
    AuthRequired,
    /// A file, folder or workspace that no longer exists.
    NotFound,
    /// A save found the file changed on disk since it was opened; saving would
    /// overwrite that change.
    ChangedOnDisk,
    /// The user stopped it.
    Cancelled,
    /// It ran too long and was stopped.
    Timeout,
    /// Anything else; the message says what.
    Failed,
}

/// A command's error.
#[derive(TS, Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }

    pub fn cancelled() -> Self {
        Self::new(ErrorKind::Cancelled, "Cancelled.")
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

impl From<String> for AppError {
    fn from(message: String) -> Self {
        Self::new(ErrorKind::Failed, message)
    }
}

impl From<&str> for AppError {
    fn from(message: &str) -> Self {
        Self::new(ErrorKind::Failed, message)
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        let kind = match error.kind() {
            std::io::ErrorKind::NotFound => ErrorKind::NotFound,
            _ => ErrorKind::Failed,
        };
        Self::new(kind, error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_reaches_the_page_as_a_kind_and_a_message() {
        let error = AppError::new(ErrorKind::AuthRequired, "Log in again.");
        assert_eq!(
            serde_json::to_value(&error).unwrap(),
            serde_json::json!({ "kind": "authRequired", "message": "Log in again." })
        );
    }

    #[test]
    fn plain_messages_and_io_errors_convert() {
        assert_eq!(AppError::from("nope").kind, ErrorKind::Failed);
        let missing = std::io::Error::new(std::io::ErrorKind::NotFound, "gone");
        assert_eq!(AppError::from(missing).kind, ErrorKind::NotFound);
    }
}
