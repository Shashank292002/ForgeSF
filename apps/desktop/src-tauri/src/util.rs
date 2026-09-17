//! Small helpers shared across the backend: running work off the async
//! runtime, locking, timestamps, and writing files without leaving them
//! half-written.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};

use crate::error::{AppError, AppResult};

/// Locks a mutex, recovering the data if a panicking thread poisoned it: every
/// value guarded here stays valid even if an update was interrupted.
pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A uniquifier for temp-file names within this process.
pub(crate) fn next_temp_suffix() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        std::process::id(),
        now_millis(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

/// Replaces a file's contents without ever leaving it half-written.
///
/// `fs::write` truncates first, so a crash mid-write left an empty or partial
/// file, and a concurrent reader could see one too — which is how the
/// workspace list could be read back as garbage. The new content is written
/// beside the target and renamed over it; within one directory a rename
/// replaces the file in a single step.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("'{}' has no parent directory.", path.display()))?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let temp = parent.join(format!(".{file_name}.{}.tmp", next_temp_suffix()));

    let attempt = || -> std::io::Result<()> {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        // Keep the original's permissions, e.g. an executable script's mode.
        if let Ok(metadata) = fs::metadata(path) {
            let _ = fs::set_permissions(&temp, metadata.permissions());
        }
        fs::rename(&temp, path)
    };

    match attempt() {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = fs::remove_file(&temp);
            // On Windows another program holding the file open without delete
            // sharing blocks the rename. An in-place write still beats failing
            // the save outright.
            if error.kind() == std::io::ErrorKind::PermissionDenied && path.is_file() {
                return fs::write(path, bytes).map_err(|error| error.to_string());
            }
            Err(error.to_string())
        }
    }
}

/// A file in the OS temp directory, deleted when dropped.
pub(crate) struct TempFile(PathBuf);

impl TempFile {
    pub(crate) fn create(extension: &str, contents: &str) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("forgesf-{}.{extension}", next_temp_suffix()));
        fs::write(&path, contents)
            .map_err(|error| format!("Could not stage a temporary file: {error}"))?;
        Ok(Self(path))
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

/// A directory in the OS temp directory, removed when dropped.
///
/// Used to stage files the CLI reads — the contents have to outlive the
/// command that reads them, and nothing else.
#[derive(Debug)]
pub(crate) struct TempDir(PathBuf);

impl TempDir {
    pub(crate) fn create(name: &str) -> Result<Self, String> {
        let path = std::env::temp_dir().join(format!("forgesf-{name}-{}", next_temp_suffix()));
        fs::create_dir_all(&path)
            .map_err(|error| format!("Could not stage a temporary folder: {error}"))?;
        Ok(Self(path))
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Runs a blocking closure on the blocking pool.
///
/// Every `sf` invocation is a Node.js process that takes seconds — a deploy
/// waits minutes. Tauri executes non-`async` commands on the **main thread**,
/// so each of those calls froze the whole window (most visibly during the
/// browser OAuth round-trip in `connect_salesforce`); a plain `async` command
/// would instead starve the shared async runtime. Both problems go away by
/// moving the work to a pool where blocking is expected.
pub(crate) async fn blocking<T, F>(task: F) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| AppError::from(format!("Background task failed: {error}")))?
}

/// Milliseconds since the Unix epoch.
pub(crate) fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// Helpers for tests across the crate.
#[cfg(test)]
pub(crate) mod test_support {
    use std::fs;
    use std::path::{Path, PathBuf};

    use super::next_temp_suffix;

    /// A fresh, empty directory under the OS temp dir.
    pub(crate) fn scratch_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("forgesf-test-{name}-{}", next_temp_suffix()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Removes directories a test created, ignoring any already gone.
    pub(crate) fn cleanup(dirs: &[&Path]) {
        for dir in dirs {
            let _ = fs::remove_dir_all(dir);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::scratch_dir;
    use std::fs;

    #[test]
    fn a_temp_file_is_removed_when_dropped() {
        let file = TempFile::create("soql", "SELECT Id\nFROM Account").unwrap();
        let path = file.path().to_path_buf();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "SELECT Id\nFROM Account"
        );
        drop(file);
        assert!(!path.exists());
    }

    #[test]
    fn an_atomic_write_replaces_the_content_and_leaves_no_temp_file() {
        let dir = scratch_dir("atomic");
        let path = dir.join("Foo.cls");
        fs::write(&path, "old").unwrap();

        write_atomic(&path, b"public class Foo {}").unwrap();

        assert_eq!(fs::read_to_string(&path).unwrap(), "public class Foo {}");
        let leftovers: Vec<_> = fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .filter(|entry| entry.file_name() != "Foo.cls")
            .collect();
        assert!(
            leftovers.is_empty(),
            "temp files left behind: {leftovers:?}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_atomic_write_creates_missing_parent_folders() {
        let dir = scratch_dir("atomic-parents");
        let path = dir.join("force-app/main/default/classes/Bar.cls");
        write_atomic(&path, b"public class Bar {}").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "public class Bar {}");
        let _ = fs::remove_dir_all(&dir);
    }
}
