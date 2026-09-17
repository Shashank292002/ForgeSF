//! Reading files as editor text, refusing anything that can't round-trip.

use std::fs;
use std::path::Path;

/// Largest file the editor opens. The whole file crosses the IPC bridge as one
/// string, and Monaco is unusable well before this size.
const MAX_EDITOR_FILE_BYTES: u64 = 10 * 1024 * 1024;

/// A NUL byte in the first block is the usual "this is binary" heuristic.
pub(crate) fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|byte| *byte == 0)
}

/// Reads a file for the editor, refusing anything it cannot round-trip.
///
/// The errors say *why*, and the UI treats any of them as "do not open an
/// editable buffer" — opening a binary static resource used to show an empty
/// editor whose next save overwrote the real file.
pub(crate) fn read_editor_text(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => "The file no longer exists on disk.".to_string(),
        _ => error.to_string(),
    })?;

    if metadata.is_dir() {
        return Err("This is a folder, not a file.".to_string());
    }
    if metadata.len() > MAX_EDITOR_FILE_BYTES {
        return Err(format!(
            "The file is {:.1} MB, larger than the {} MB the editor opens.",
            metadata.len() as f64 / (1024.0 * 1024.0),
            MAX_EDITOR_FILE_BYTES / (1024 * 1024)
        ));
    }

    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    if looks_binary(&bytes) {
        return Err("This is a binary file, so it can't be shown as text.".to_string());
    }
    String::from_utf8(bytes).map_err(|_| {
        "The file isn't valid UTF-8 text, so it can't be edited safely here.".to_string()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::test_support::scratch_dir;
    use std::fs;

    #[test]
    fn the_editor_reads_utf8_text() {
        let dir = scratch_dir("read-text");
        let path = dir.join("Foo.cls");
        fs::write(&path, "// Grüße\npublic class Foo {}").unwrap();
        assert_eq!(
            read_editor_text(&path).unwrap(),
            "// Grüße\npublic class Foo {}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_editor_refuses_binary_invalid_missing_and_huge_files() {
        let dir = scratch_dir("read-refuse");

        let binary = dir.join("logo.resource");
        fs::write(&binary, [0x89, b'P', b'N', b'G', 0, 0, 0, 13]).unwrap();
        assert!(read_editor_text(&binary).unwrap_err().contains("binary"));

        let latin1 = dir.join("legacy.txt");
        fs::write(&latin1, [b'c', b'a', b'f', 0xE9]).unwrap();
        assert!(read_editor_text(&latin1).unwrap_err().contains("UTF-8"));

        assert!(read_editor_text(&dir.join("gone.cls"))
            .unwrap_err()
            .contains("no longer exists"));

        let huge = dir.join("huge.json");
        fs::File::create(&huge)
            .unwrap()
            .set_len(MAX_EDITOR_FILE_BYTES + 1)
            .unwrap();
        assert!(read_editor_text(&huge).unwrap_err().contains("larger than"));

        assert!(read_editor_text(&dir).unwrap_err().contains("folder"));
        let _ = fs::remove_dir_all(&dir);
    }
}
