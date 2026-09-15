//! Find in files, and the file list behind Quick Open.
//!
//! Both see the workspace the way the explorer shows it: the folders it hides
//! (`.git`, `.sf`, `node_modules`…) are skipped, and so is whatever a
//! `.gitignore` excludes. `.forceignore` is deliberately not applied — it says
//! what the CLI leaves out of deploys, such as LWC Jest tests and
//! `package.xml`, which are exactly the files a developer still needs to find.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

use ignore::overrides::{Override, OverrideBuilder};
use ignore::WalkBuilder;
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::commands::{
    blocking, is_ignored_path, looks_binary, to_relative_string, workspace_root,
};

/* ─────────────────────────────────────────────────────────────────
Types
───────────────────────────────────────────────────────────────── */

/// What to find, and where.
#[derive(TS, Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct SearchRequest {
    pub query: String,
    #[serde(default)]
    pub match_case: bool,
    #[serde(default)]
    pub whole_word: bool,
    /// `query` is a regular expression rather than plain text.
    #[serde(default)]
    pub regex: bool,
    /// Comma-separated globs a file must match, e.g. `*.cls, lwc`. A folder
    /// name covers everything in it. Empty: every file.
    #[serde(default)]
    pub include: String,
    /// Comma-separated globs of files to leave out.
    #[serde(default)]
    pub exclude: String,
}

/// One match, positioned the way the editor counts: lines from 1, columns
/// from 1 in UTF-16 code units.
#[derive(TS, Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct SearchMatch {
    pub line: u32,
    pub column: u32,
    pub length: u32,
    /// The line, shortened around the match when it is long.
    pub preview: String,
    /// Where the match sits in `preview`, in UTF-16 code units.
    pub preview_start: u32,
    pub preview_length: u32,
}

#[derive(TS, Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct SearchFileResult {
    pub path: String,
    pub matches: Vec<SearchMatch>,
}

#[derive(TS, Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct SearchResults {
    pub files: Vec<SearchFileResult>,
    pub match_count: u32,
    pub files_searched: u32,
    /// The search stopped at the match limit; there are more.
    pub limit_hit: bool,
    /// A newer search started, so this one stopped early.
    pub cancelled: bool,
    #[ts(type = "number")]
    pub duration_ms: u64,
}

/// Every file Quick Open can offer.
#[derive(TS, Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct WorkspaceFileList {
    pub files: Vec<String>,
    /// More files exist than were listed.
    pub truncated: bool,
}

/// Stops a search here, and tells the user to narrow it.
pub(crate) const MAX_MATCHES: usize = 2_000;
/// Files past this size are skipped: minified bundles and data dumps.
const MAX_SEARCH_FILE_BYTES: u64 = 5 * 1024 * 1024;
/// Characters of a line shown before a match, and in a preview at most.
const PREVIEW_BEFORE: usize = 40;
const PREVIEW_MAX: usize = 250;
const MAX_LISTED_FILES: usize = 50_000;

/// Bumped by every search, so a running one can tell it was superseded.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/* ─────────────────────────────────────────────────────────────────
Walking
───────────────────────────────────────────────────────────────── */

/// Globs from a comma-separated list, as paths from the workspace root.
fn split_globs(list: &str) -> impl Iterator<Item = String> + '_ {
    list.split(',')
        .map(|glob| glob.trim().replace('\\', "/"))
        .map(|glob| {
            glob.trim_start_matches("./")
                .trim_start_matches('/')
                .to_string()
        })
        .filter(|glob| !glob.is_empty())
}

/// Include and exclude globs as the walker applies them. A glob also covers
/// everything inside a folder it names: `force-app/main/default/lwc` and a
/// bare `lwc` work as well as `**/lwc/**`.
fn overrides(root: &Path, include: &str, exclude: &str) -> Result<Override, String> {
    let mut builder = OverrideBuilder::new(root);
    let mut add = |glob: &str, negate: bool| -> Result<(), String> {
        let folder = glob.trim_end_matches('/');
        // As in a .gitignore, a glob with no slash matches at any depth, but
        // one with a slash is anchored to the root — so the folder form of a
        // bare name needs its own `**/`.
        let contents = if folder.contains('/') {
            format!("{folder}/**")
        } else {
            format!("**/{folder}/**")
        };
        for pattern in [glob.to_string(), contents] {
            let pattern = if negate {
                format!("!{pattern}")
            } else {
                pattern
            };
            builder
                .add(&pattern)
                .map_err(|error| format!("'{glob}' isn't a valid file pattern: {error}"))?;
        }
        Ok(())
    };
    for glob in split_globs(include) {
        add(&glob, false)?;
    }
    for glob in split_globs(exclude) {
        add(&glob, true)?;
    }
    builder
        .build()
        .map_err(|error| format!("The file patterns couldn't be used: {error}"))
}

/// The workspace's files in path order, as search and Quick Open see them.
fn workspace_files(root: &Path, include: &str, exclude: &str) -> Result<ignore::Walk, String> {
    let overrides = overrides(root, include, exclude)?;
    let base: PathBuf = root.to_path_buf();
    let mut builder = WalkBuilder::new(root);
    builder
        // Dot-files such as `.forceignore` are worth finding; the folders the
        // explorer hides are filtered below instead.
        .hidden(false)
        // A `.gitignore` applies even in a folder that isn't a git repository.
        .require_git(false)
        .follow_links(false)
        .overrides(overrides)
        .sort_by_file_name(|a, b| a.cmp(b))
        .filter_entry(move |entry| {
            entry
                .path()
                .strip_prefix(&base)
                .map(|relative| !is_ignored_path(relative))
                .unwrap_or(true)
        });
    Ok(builder.build())
}

/* ─────────────────────────────────────────────────────────────────
Matching
───────────────────────────────────────────────────────────────── */

/// The matcher for a request, or a message saying why the pattern is unusable.
pub(crate) fn matcher(request: &SearchRequest) -> Result<Regex, String> {
    let mut pattern = if request.regex {
        request.query.clone()
    } else {
        regex::escape(&request.query)
    };
    if request.whole_word {
        pattern = format!(r"\b(?:{pattern})\b");
    }
    RegexBuilder::new(&pattern)
        .case_insensitive(!request.match_case)
        .size_limit(16 * 1024 * 1024)
        .build()
        .map_err(|error| {
            // The crate's message draws the pattern with a caret; its last
            // line is the part worth showing.
            let text = error.to_string();
            let reason = text
                .lines()
                .rev()
                .find_map(|line| line.trim().strip_prefix("error: "))
                .unwrap_or_else(|| text.lines().next().unwrap_or("invalid pattern"))
                .to_string();
            format!("Invalid regular expression: {reason}")
        })
}

fn utf16_len(text: &str) -> u32 {
    text.encode_utf16().count() as u32
}

/// `line` shortened around the byte range `start..end`, with the match's
/// position inside the shortened text.
fn preview(line: &str, start: usize, end: usize) -> (String, u32, u32) {
    // Indentation says nothing; it is dropped unless the match is in it.
    let indent = line.len() - line.trim_start().len();
    let from = indent.min(start);

    let before: Vec<usize> = line[from..start]
        .char_indices()
        .map(|(index, _)| from + index)
        .collect();
    let (cut, ellipsis) = if before.len() > PREVIEW_BEFORE {
        (before[before.len() - PREVIEW_BEFORE], "…")
    } else {
        (from, "")
    };

    let visible_end = line[cut..]
        .char_indices()
        .nth(PREVIEW_MAX)
        .map_or(line.len(), |(index, _)| cut + index);
    let text = format!("{ellipsis}{}", &line[cut..visible_end]);

    let preview_start = utf16_len(ellipsis) + utf16_len(&line[cut..start]);
    let shown_end = end.min(visible_end);
    let preview_length = if shown_end > start {
        utf16_len(&line[start..shown_end])
    } else {
        0
    };
    (text, preview_start, preview_length)
}

/// The matches in one file's text, at most `budget` of them.
pub(crate) fn find_in_text(text: &str, matcher: &Regex, budget: usize) -> Vec<SearchMatch> {
    let mut matches = Vec::new();
    for (index, raw_line) in text.split('\n').enumerate() {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        for found in matcher.find_iter(line) {
            // A pattern that can match nothing (`^`, `a*`) would list every line.
            if found.start() == found.end() {
                continue;
            }
            let (preview, preview_start, preview_length) =
                preview(line, found.start(), found.end());
            matches.push(SearchMatch {
                line: index as u32 + 1,
                column: utf16_len(&line[..found.start()]) + 1,
                length: utf16_len(found.as_str()),
                preview,
                preview_start,
                preview_length,
            });
            if matches.len() >= budget {
                return matches;
            }
        }
    }
    matches
}

/// Searches every file under `root`. Stops early when `still_wanted` says a
/// newer search has started.
fn search_files(
    root: &Path,
    request: &SearchRequest,
    still_wanted: impl Fn() -> bool,
) -> Result<SearchResults, String> {
    let started = Instant::now();
    let mut results = SearchResults::default();
    if request.query.is_empty() {
        return Ok(results);
    }
    let matcher = matcher(request)?;

    for entry in workspace_files(root, &request.include, &request.exclude)? {
        if !still_wanted() {
            results.cancelled = true;
            break;
        }
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let path = entry.path();
        if fs::metadata(path).map_or(true, |metadata| metadata.len() > MAX_SEARCH_FILE_BYTES) {
            continue;
        }
        let Ok(bytes) = fs::read(path) else { continue };
        if looks_binary(&bytes) {
            continue;
        }
        results.files_searched += 1;
        // Text that isn't valid UTF-8 is still searched, with the odd bytes
        // replaced; its matches can at least be found and opened.
        let text = String::from_utf8_lossy(&bytes);

        let budget = MAX_MATCHES - results.match_count as usize;
        let matches = find_in_text(&text, &matcher, budget);
        if matches.is_empty() {
            continue;
        }
        results.match_count += matches.len() as u32;
        results.files.push(SearchFileResult {
            path: to_relative_string(root, path),
            matches,
        });
        if results.match_count as usize >= MAX_MATCHES {
            results.limit_hit = true;
            break;
        }
    }

    results.duration_ms = started.elapsed().as_millis() as u64;
    Ok(results)
}

/* ─────────────────────────────────────────────────────────────────
Commands
───────────────────────────────────────────────────────────────── */

/// Finds text in the workspace's files. Starting a search stops any search
/// still running, which then reports itself as cancelled.
#[tauri::command]
pub async fn search_workspace(
    app: tauri::AppHandle,
    request: SearchRequest,
    workspace_id: Option<String>,
) -> Result<SearchResults, String> {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        search_files(&root, &request, || {
            GENERATION.load(Ordering::SeqCst) == generation
        })
    })
    .await
}

/// Stops the running search, if any — the query was cleared.
#[tauri::command]
pub async fn cancel_workspace_search() -> Result<(), String> {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    Ok(())
}

/// Every file in the workspace, for Quick Open.
#[tauri::command]
pub async fn list_workspace_files(
    app: tauri::AppHandle,
    workspace_id: Option<String>,
) -> Result<WorkspaceFileList, String> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        list_files(&root)
    })
    .await
}

fn list_files(root: &Path) -> Result<WorkspaceFileList, String> {
    let mut list = WorkspaceFileList::default();
    for entry in workspace_files(root, "", "")?.flatten() {
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        if list.files.len() >= MAX_LISTED_FILES {
            list.truncated = true;
            break;
        }
        list.files.push(to_relative_string(root, entry.path()));
    }
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::next_temp_suffix;

    fn request(query: &str) -> SearchRequest {
        SearchRequest {
            query: query.to_string(),
            ..Default::default()
        }
    }

    /// A small project: classes, an LWC with a Jest test, and folders that
    /// search must never look in.
    fn project() -> PathBuf {
        let root = std::env::temp_dir().join(format!("forgesf-search-{}", next_temp_suffix()));
        let files = [
            ("force-app/main/default/classes/AccountService.cls", "public class AccountService {\n    // TODO: accountService cache\n    Account a;\n}\n"),
            ("force-app/main/default/classes/OrderService.cls", "public class OrderService {\r\n    Account owner;\r\n}\r\n"),
            ("force-app/main/default/lwc/accountList/accountList.js", "import { LightningElement } from 'lwc';\n"),
            ("force-app/main/default/lwc/accountList/__tests__/accountList.test.js", "describe('Account list', () => {});\n"),
            (".forceignore", "**/__tests__/**\n"),
            (".gitignore", "coverage/\n"),
            ("coverage/report.txt", "Account coverage\n"),
            ("node_modules/lib/index.js", "Account\n"),
            (".sf/config.json", "{\"Account\": true}\n"),
        ];
        for (path, content) in files {
            let full = root.join(path);
            fs::create_dir_all(full.parent().unwrap()).unwrap();
            fs::write(full, content).unwrap();
        }
        fs::write(
            root.join("force-app/logo.png"),
            [0x89, b'P', 0, 0, b'A', b'c', b'c', b'o', b'u', b'n', b't'],
        )
        .unwrap();
        root
    }

    fn paths(results: &SearchResults) -> Vec<String> {
        results.files.iter().map(|file| file.path.clone()).collect()
    }

    #[test]
    fn finds_text_everywhere_the_explorer_shows_but_nowhere_it_hides() {
        let root = project();
        let results = search_files(&root, &request("Account"), || true).unwrap();
        assert_eq!(
            paths(&results),
            vec![
                "force-app/main/default/classes/AccountService.cls",
                "force-app/main/default/classes/OrderService.cls",
                "force-app/main/default/lwc/accountList/__tests__/accountList.test.js",
            ],
            "ignored folders, .gitignore'd files and binaries are skipped; .forceignore is not applied"
        );
        // Case-insensitive by default: `accountService` in the comment counts.
        assert_eq!(results.files[0].matches.len(), 3);
        assert!(!results.limit_hit && !results.cancelled);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn match_case_whole_word_and_regex_narrow_it_down() {
        let root = project();
        let case = SearchRequest {
            match_case: true,
            ..request("Account")
        };
        let found = search_files(&root, &case, || true).unwrap();
        assert_eq!(found.files[0].matches.len(), 2, "not the lowercase one");

        let word = SearchRequest {
            whole_word: true,
            match_case: true,
            ..request("Account")
        };
        let found = search_files(&root, &word, || true).unwrap();
        // `Account a;` and `Account owner;` — not AccountService.
        assert_eq!(found.match_count, 3);

        let pattern = SearchRequest {
            regex: true,
            ..request(r"class \w+Service")
        };
        let found = search_files(&root, &pattern, || true).unwrap();
        assert_eq!(found.match_count, 2);

        let broken = SearchRequest {
            regex: true,
            ..request("(unclosed")
        };
        let error = search_files(&root, &broken, || true).unwrap_err();
        assert!(error.starts_with("Invalid regular expression:"), "{error}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn include_and_exclude_globs_pick_the_files() {
        let root = project();
        let only_classes = SearchRequest {
            include: "*.cls".to_string(),
            ..request("Account")
        };
        assert_eq!(
            search_files(&root, &only_classes, || true)
                .unwrap()
                .files
                .len(),
            2
        );

        let lwc_test = vec!["force-app/main/default/lwc/accountList/__tests__/accountList.test.js"];
        let a_folder = SearchRequest {
            include: "force-app/main/default/lwc".to_string(),
            ..request("Account")
        };
        assert_eq!(
            paths(&search_files(&root, &a_folder, || true).unwrap()),
            lwc_test
        );
        // A bare folder name matches that folder wherever it is.
        let bare = SearchRequest {
            include: "lwc".to_string(),
            ..request("Account")
        };
        assert_eq!(
            paths(&search_files(&root, &bare, || true).unwrap()),
            lwc_test
        );

        let no_tests = SearchRequest {
            exclude: "**/__tests__, OrderService.cls".to_string(),
            ..request("Account")
        };
        assert_eq!(
            paths(&search_files(&root, &no_tests, || true).unwrap()),
            vec!["force-app/main/default/classes/AccountService.cls"]
        );

        let bad = SearchRequest {
            include: "[".to_string(),
            ..request("Account")
        };
        assert!(search_files(&root, &bad, || true)
            .unwrap_err()
            .contains("isn't a valid file pattern"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn positions_are_the_editors_and_crlf_is_not_part_of_the_line() {
        let matcher = matcher(&SearchRequest {
            match_case: true,
            ..request("owner")
        })
        .unwrap();
        let found = find_in_text("a\r\n    Account owner;\r\n", &matcher, 10);
        assert_eq!(found.len(), 1);
        let hit = &found[0];
        assert_eq!((hit.line, hit.column, hit.length), (2, 13, 5));
        assert_eq!(hit.preview, "Account owner;");
        assert_eq!(
            &hit.preview
                [hit.preview_start as usize..(hit.preview_start + hit.preview_length) as usize],
            "owner"
        );

        // Columns count UTF-16 units: "é" is one, "😀" is two.
        let emoji = matcher.clone();
        let found = find_in_text("é😀 owner", &emoji, 10);
        assert_eq!(found[0].column, 5);
    }

    #[test]
    fn a_long_line_is_shortened_around_the_match() {
        let line = format!("{}needle{}", "x".repeat(300), "y".repeat(300));
        let matcher = matcher(&request("needle")).unwrap();
        let hit = &find_in_text(&line, &matcher, 10)[0];
        assert!(hit.preview.starts_with('…'));
        assert!(hit.preview.chars().count() <= PREVIEW_MAX + 1);
        let start = hit.preview_start as usize;
        let shown: String = hit
            .preview
            .chars()
            .skip(start)
            .take(hit.preview_length as usize)
            .collect();
        assert_eq!(shown, "needle");
        // An empty match (a pattern like `x*`) is not a result.
        let empty = matcher_for_regex("z*");
        assert!(find_in_text("abc", &empty, 10).is_empty());
    }

    fn matcher_for_regex(pattern: &str) -> Regex {
        matcher(&SearchRequest {
            regex: true,
            ..request(pattern)
        })
        .unwrap()
    }

    #[test]
    fn a_search_stops_at_the_limit_or_when_superseded() {
        let root =
            std::env::temp_dir().join(format!("forgesf-search-limit-{}", next_temp_suffix()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("many.txt"), "hit\n".repeat(MAX_MATCHES + 50)).unwrap();
        fs::write(root.join("more.txt"), "hit\n").unwrap();
        let results = search_files(&root, &request("hit"), || true).unwrap();
        assert_eq!(results.match_count as usize, MAX_MATCHES);
        assert!(results.limit_hit);

        let stopped = search_files(&root, &request("hit"), || false).unwrap();
        assert!(stopped.cancelled);
        assert_eq!(stopped.match_count, 0);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn quick_open_lists_files_the_explorer_shows() {
        let root = project();
        let listed = list_files(&root).unwrap();
        assert!(listed
            .files
            .contains(&"force-app/main/default/classes/AccountService.cls".to_string()));
        assert!(listed.files.contains(&".forceignore".to_string()));
        assert!(listed.files.contains(&"force-app/logo.png".to_string()));
        assert!(!listed
            .files
            .iter()
            .any(|path| path.starts_with("node_modules")
                || path.starts_with(".sf/")
                || path.starts_with("coverage/")));
        assert!(!listed.truncated);
        let _ = fs::remove_dir_all(&root);
    }
}
