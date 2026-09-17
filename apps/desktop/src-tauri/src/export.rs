//! Saving something the app produced to a file the user chooses.
//!
//! The webview cannot write files, and a download link inside it is inert, so
//! the native save dialog runs here and Rust does the writing.

use std::path::PathBuf;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::util::blocking;
use tauri_plugin_dialog::DialogExt;

/// Shows the native "Save as" dialog and writes `contents` where it points.
///
/// Returns the path written, or `None` when the dialog was dismissed. The user
/// picks the location, so nothing is written anywhere they did not choose.
#[tauri::command]
pub async fn save_text_file(
    window: tauri::Window,
    suggested_name: String,
    contents: String,
) -> AppResult<Option<String>> {
    blocking(move || {
        let name = suggested_name.trim();
        let extension = name.rsplit('.').next().filter(|ext| *ext != name);

        let mut dialog = window
            .dialog()
            .file()
            .set_parent(&window)
            .set_title("Save as")
            .set_file_name(name);
        if let Some(extension) = extension {
            dialog = dialog.add_filter(extension.to_uppercase(), &[extension]);
        }

        let Some(choice) = dialog.blocking_save_file() else {
            return Ok(None);
        };

        let path: PathBuf = choice.into_path().map_err(|error| error.to_string())?;
        std::fs::write(&path, contents).map_err(|error| {
            AppError::new(
                ErrorKind::Failed,
                format!("Could not write {}: {error}", path.display()),
            )
        })?;

        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
}
