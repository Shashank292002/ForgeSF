//! File operations behind the explorer and the editor.
//!
//! Salesforce source is not a plain file tree. A class is `Foo.cls` plus
//! `Foo.cls-meta.xml`; a static resource is `logo.resource-meta.xml` plus
//! `logo.png` (or a `logo/` folder); an LWC or Aura component is a folder whose
//! files carry the folder's name. Renaming, moving, copying or deleting one
//! half used to leave the other behind, which the next deploy rejected, so
//! these commands treat each group as one item.

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};
use crate::util::{blocking, next_temp_suffix, write_atomic};
use crate::workspace::apex;
use crate::workspace::paths::{resolve_in_workspace, to_relative_string};
use crate::workspace::registry::workspace_root;
use crate::workspace::sfdx_project::{
    package_directories, source_api_version, FALLBACK_API_VERSION,
};
use crate::workspace::text::read_editor_text;

/* ─────────────────────────────────────────────────────────────────
Types
───────────────────────────────────────────────────────────────── */

/// When a file was last written, and its size: enough to tell whether it
/// changed on disk since the editor read it.
#[derive(TS, Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct FileStamp {
    #[ts(type = "number")]
    pub modified: u64,
    #[ts(type = "number")]
    pub size: u64,
}

/// A file's text for the editor, with the stamp a later save is checked
/// against.
#[derive(TS, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct FileContent {
    pub content: String,
    pub stamp: FileStamp,
}

/// A path that moved, so the UI can follow it: open tabs, expanded folders.
#[derive(TS, Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct PathChange {
    pub from: String,
    pub to: String,
}

/// What a rename did.
#[derive(TS, Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct RenameResult {
    /// Every path that moved, the item's own first.
    pub changes: Vec<PathChange>,
    /// How many times the class or trigger name changed inside the renamed
    /// file, when that was asked for.
    pub renamed_uses: u32,
}

/// What a copy created.
#[derive(TS, Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct CopyResult {
    pub created: Vec<String>,
    /// Copied classes and triggers renamed inside to match their new file.
    pub renamed_in: Vec<String>,
}

/* ─────────────────────────────────────────────────────────────────
Names and stamps
───────────────────────────────────────────────────────────────── */

fn stamp_of(path: &Path) -> Option<FileStamp> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |elapsed| elapsed.as_millis() as u64);
    Some(FileStamp {
        modified,
        size: metadata.len(),
    })
}

fn name_of(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default()
}

/// A single file or folder name that every supported OS accepts.
///
/// `.` and `..` pass a separator check but resolve to a parent once joined;
/// Windows also strips a trailing dot or space and forbids a few characters.
fn valid_entry_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.ends_with(['.', ' '])
        && !name.contains(['/', '\\', '<', '>', ':', '"', '|', '?', '*'])
        && !name.chars().any(char::is_control)
}

/// An Apex or Visualforce API name: starts with a letter; letters, digits and
/// single underscores; no trailing underscore; at most 40 characters.
fn valid_apex_name(name: &str) -> bool {
    name.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        && !name.contains("__")
        && !name.ends_with('_')
        && name.len() <= 40
}

/// Splits a name at its first dot, ignoring a leading one: `Foo.cls-meta.xml`
/// is (`Foo`, `.cls-meta.xml`), `.gitignore` is (`.gitignore`, ``).
fn split_stem(name: &str) -> (&str, &str) {
    let search_from = usize::from(name.starts_with('.'));
    match name[search_from..].find('.') {
        Some(index) => name.split_at(search_from + index),
        None => (name, ""),
    }
}

/// `name` without `prefix`, ignoring ASCII case. Files found on a
/// case-insensitive file system may be spelled differently from their pair.
fn strip_prefix_ignore_case<'a>(name: &'a str, prefix: &str) -> Option<&'a str> {
    if name.len() < prefix.len() || !name.is_char_boundary(prefix.len()) {
        return None;
    }
    let (head, rest) = name.split_at(prefix.len());
    head.eq_ignore_ascii_case(prefix).then_some(rest)
}

/* ─────────────────────────────────────────────────────────────────
What belongs together
───────────────────────────────────────────────────────────────── */

/// Metadata types whose content keeps its own extension, or is a folder.
const RESOURCE_LIKE: &[&str] = &["resource", "document", "asset"];

/// The files that belong with `path`: a source file's `-meta.xml`, a
/// `-meta.xml`'s source file, and a static resource's content or metadata.
/// Only entries that exist are returned.
pub(crate) fn companions(path: &Path) -> Vec<PathBuf> {
    let (Some(parent), Some(name)) = (path.parent(), path.file_name().and_then(|n| n.to_str()))
    else {
        return Vec::new();
    };

    let mut candidates = Vec::new();
    if let Some(base) = name.strip_suffix("-meta.xml") {
        let content = parent.join(base);
        if content.exists() {
            candidates.push(content);
        } else if let Some((stem, kind)) = base.rsplit_once('.') {
            if RESOURCE_LIKE.contains(&kind) {
                candidates.extend(siblings_named(parent, stem));
            }
        }
    } else {
        let meta = parent.join(format!("{name}-meta.xml"));
        if meta.exists() {
            candidates.push(meta);
        } else {
            let (stem, _) = split_stem(name);
            for kind in RESOURCE_LIKE {
                let meta = parent.join(format!("{stem}.{kind}-meta.xml"));
                if meta.exists() {
                    candidates.push(meta);
                }
            }
        }
    }

    candidates.retain(|candidate| candidate.as_path() != path);
    candidates
}

/// Entries in `dir` named `stem` or `stem.<anything>`, other than metadata.
fn siblings_named(dir: &Path, stem: &str) -> Vec<PathBuf> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let dotted = format!("{stem}.");
    let mut found: Vec<PathBuf> = entries
        .flatten()
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            (name.eq_ignore_ascii_case(stem) || strip_prefix_ignore_case(&name, &dotted).is_some())
                && !name.ends_with("-meta.xml")
        })
        .map(|entry| entry.path())
        .collect();
    found.sort();
    found
}

/// An LWC or Aura component folder: its files are named after it.
fn is_bundle_folder(path: &Path) -> bool {
    path.is_dir()
        && path
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            .is_some_and(|name| name == "lwc" || name == "aura")
}

/// Aura's controller, helper and renderer are named `<bundle>Controller.js`.
const AURA_SUFFIXES: &[&str] = &["Controller.js", "Helper.js", "Renderer.js"];

/// The files directly in a bundle folder that carry the bundle's name. Other
/// modules in an LWC folder keep theirs: imports refer to them by name.
fn bundle_files(folder: &Path, bundle: &str) -> Vec<String> {
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };
    let dotted = format!("{bundle}.");
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_file())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .filter(|name| {
            name.starts_with(&dotted)
                || AURA_SUFFIXES
                    .iter()
                    .any(|suffix| *name == format!("{bundle}{suffix}"))
        })
        .collect();
    names.sort();
    names
}

/// A companion's new name after its item was renamed from `old` to `new`, or
/// None when it keeps its name.
fn renamed_companion(old: &str, new: &str, companion: &str) -> Option<String> {
    // `Foo.cls` → `Bar.cls` renames `Foo.cls-meta.xml` → `Bar.cls-meta.xml`.
    if let Some(rest) = strip_prefix_ignore_case(companion, old) {
        return Some(format!("{new}{rest}"));
    }
    // Otherwise the shared part is the stem: `logo.png` and
    // `logo.resource-meta.xml`, or `Foo.cls-meta.xml` and `Foo.cls`.
    let (old_stem, _) = split_stem(old);
    let (new_stem, _) = split_stem(new);
    if old_stem == new_stem {
        return None;
    }
    let rest = strip_prefix_ignore_case(companion, old_stem)?;
    (rest.is_empty() || rest.starts_with('.')).then(|| format!("{new_stem}{rest}"))
}

/* ─────────────────────────────────────────────────────────────────
Plans
───────────────────────────────────────────────────────────────── */

type Plan = Vec<(PathBuf, PathBuf)>;

/// Renaming `path` to `new_name`, with everything that belongs with it, as
/// (from, to) pairs in the order they run.
fn rename_plan(path: &Path, new_name: &str) -> Plan {
    let old_name = name_of(path);
    let target = path.with_file_name(new_name);
    let mut plan = vec![(path.to_path_buf(), target.clone())];

    if is_bundle_folder(path) {
        // Run after the folder itself moved, so they are addressed inside it.
        for inner in bundle_files(path, &old_name) {
            let renamed = format!("{new_name}{}", &inner[old_name.len()..]);
            plan.push((target.join(&inner), target.join(renamed)));
        }
    }

    for companion in companions(path) {
        if let Some(new_companion) = renamed_companion(&old_name, new_name, &name_of(&companion)) {
            let to = companion.with_file_name(new_companion);
            plan.push((companion, to));
        }
    }
    plan
}

/// Items with everything that belongs with them, dropping any entry that sits
/// inside another one on the list.
fn with_companions(items: &[PathBuf]) -> Vec<PathBuf> {
    let mut all: Vec<PathBuf> = Vec::new();
    for item in items {
        for entry in std::iter::once(item.clone()).chain(companions(item)) {
            if !all.iter().any(|known| same_entry_or_equal(known, &entry)) {
                all.push(entry);
            }
        }
    }
    top_level(all)
}

/// Drops paths inside another path on the list.
fn top_level(mut paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let snapshot = paths.clone();
    paths.retain(|path| {
        !snapshot
            .iter()
            .any(|other| other != path && path.starts_with(other))
    });
    paths.sort();
    paths
}

/// Where each entry lands when moved into `destination`.
fn move_plan(items: &[PathBuf], destination: &Path) -> Result<Plan, String> {
    let mut plan = Vec::new();
    for entry in with_companions(items) {
        if destination.starts_with(&entry) {
            return Err(format!("'{}' can't be moved into itself.", name_of(&entry)));
        }
        if entry.parent() == Some(destination) {
            continue;
        }
        let to = destination.join(entry.file_name().unwrap_or_default());
        plan.push((entry, to));
    }
    Ok(plan)
}

/// Copying `items` into `destination`. Each item keeps its name when it is
/// free there; otherwise it and its companions share a new stem —
/// `FooCopy.cls` with `FooCopy.cls-meta.xml` — since API names cannot hold
/// spaces. Bundle files follow their folder's new name.
fn copy_plan(items: &[PathBuf], destination: &Path) -> Plan {
    let mut plan: Plan = Vec::new();
    let mut handled: Vec<PathBuf> = Vec::new();

    for item in top_level(items.to_vec()) {
        if handled.iter().any(|done| same_entry_or_equal(done, &item)) {
            continue;
        }
        let group: Vec<PathBuf> = std::iter::once(item.clone())
            .chain(companions(&item))
            .collect();
        handled.extend(group.iter().cloned());

        let item_name = name_of(&item);
        let (item_stem, _) = split_stem(&item_name);
        let taken = |name: &str| {
            destination.join(name).exists()
                || plan
                    .iter()
                    .any(|(_, to)| name_of(to).eq_ignore_ascii_case(name))
        };

        let mut attempt = 0;
        let names = loop {
            let suffix = match attempt {
                0 => String::new(),
                1 => "Copy".to_string(),
                n => format!("Copy{n}"),
            };
            let names: Vec<String> = group
                .iter()
                .map(|entry| {
                    let name = name_of(entry);
                    match strip_prefix_ignore_case(&name, item_stem) {
                        Some(rest) => format!("{item_stem}{suffix}{rest}"),
                        None => {
                            let (stem, rest) = split_stem(&name);
                            format!("{stem}{suffix}{rest}")
                        }
                    }
                })
                .collect();
            if names.iter().all(|name| !taken(name)) {
                break names;
            }
            attempt += 1;
        };

        for (entry, name) in group.iter().zip(names) {
            plan.push((entry.clone(), destination.join(name)));
        }
    }
    plan
}

/* ─────────────────────────────────────────────────────────────────
Doing it
───────────────────────────────────────────────────────────────── */

/// Whether two paths name the same file or folder. True for a case-only change
/// on a case-insensitive file system, where the "new" name already exists.
fn same_entry(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn same_entry_or_equal(a: &Path, b: &Path) -> bool {
    a == b || same_entry(a, b)
}

/// Renames, via a temporary name when only the letter case changes: Windows
/// and macOS otherwise report that the target already exists.
fn rename_entry(from: &Path, to: &Path) -> std::io::Result<()> {
    if from != to && same_entry(from, to) {
        let temp = from.with_file_name(format!(".{}.{}.rename", name_of(from), next_temp_suffix()));
        fs::rename(from, &temp)?;
        return fs::rename(&temp, to);
    }
    fs::rename(from, to)
}

/// Runs a rename or move plan. Every destination is checked first, so a clash
/// stops it before anything moves; a failure part-way puts back what moved.
fn apply_moves(root: &Path, plan: &Plan) -> Result<Vec<PathChange>, String> {
    for (from, to) in plan {
        if !to.starts_with(root) {
            return Err("Moving outside the workspace is not allowed.".to_string());
        }
        if to.exists() && !same_entry(from, to) {
            return Err(format!(
                "'{}' already exists.",
                to_relative_string(root, to)
            ));
        }
    }

    let mut done: Vec<&(PathBuf, PathBuf)> = Vec::new();
    for step in plan {
        let (from, to) = step;
        if let Err(error) = rename_entry(from, to) {
            for (undo_from, undo_to) in done.iter().rev().map(|step| (&step.0, &step.1)) {
                let _ = rename_entry(undo_to, undo_from);
            }
            return Err(format!(
                "Could not move '{}': {error}",
                to_relative_string(root, from)
            ));
        }
        done.push(step);
    }

    Ok(plan
        .iter()
        .map(|(from, to)| PathChange {
            from: to_relative_string(root, from),
            to: to_relative_string(root, to),
        })
        .collect())
}

fn copy_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    if from.is_dir() {
        fs::create_dir_all(to)?;
        for entry in fs::read_dir(from)? {
            let entry = entry?;
            copy_recursive(&entry.path(), &to.join(entry.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(from, to).map(|_| ())
    }
}

/// Renames the class or trigger a file declares, after the file itself went
/// from `old_name` to `new_name`: its declaration, and for a class its
/// constructors and other uses in the file. Returns how many names changed,
/// or None when there was nothing to rename.
fn rename_apex_name_in(file: &Path, old_name: &str, new_name: &str) -> Option<u32> {
    let trigger = apex::apex_kind(new_name)?;
    if apex::apex_kind(old_name)? != trigger {
        return None;
    }
    let (old_stem, _) = old_name.rsplit_once('.')?;
    let (new_stem, _) = new_name.rsplit_once('.')?;
    if old_stem == new_stem || !valid_apex_name(new_stem) {
        return None;
    }
    let source = fs::read_to_string(file).ok()?;
    let (renamed, count) = apex::rename_declared(&source, trigger, old_stem, new_stem)?;
    write_atomic(file, renamed.as_bytes()).ok()?;
    Some(count as u32)
}

/// Runs a copy plan, then renames bundle files inside any copied component
/// folder that got a new name, and the class inside any copied class. A copy
/// named `FooCopy.cls` that still declared `class Foo` could not be deployed —
/// or, worse, would have replaced `Foo` in the org.
fn apply_copies(root: &Path, plan: &Plan) -> Result<CopyResult, String> {
    for (_, to) in plan {
        if !to.starts_with(root) {
            return Err("Copying outside the workspace is not allowed.".to_string());
        }
    }

    let mut result = CopyResult {
        created: Vec::new(),
        renamed_in: Vec::new(),
    };
    for (from, to) in plan {
        copy_recursive(from, to).map_err(|error| {
            format!(
                "Could not copy '{}': {error}",
                to_relative_string(root, from)
            )
        })?;
        result.created.push(to_relative_string(root, to));

        let (old_name, new_name) = (name_of(from), name_of(to));
        if old_name == new_name {
            continue;
        }
        if is_bundle_folder(to) {
            for inner in bundle_files(to, &old_name) {
                let renamed = format!("{new_name}{}", &inner[old_name.len()..]);
                fs::rename(to.join(&inner), to.join(renamed)).map_err(|error| error.to_string())?;
            }
        } else if to.is_file() && rename_apex_name_in(to, &old_name, &new_name).is_some() {
            result.renamed_in.push(to_relative_string(root, to));
        }
    }
    Ok(result)
}

/// New Apex or Visualforce content with its `-meta.xml`, or None for any other
/// kind of file.
fn scaffold(file_name: &str, api_version: &str) -> Result<Option<(String, String)>, String> {
    let Some((stem, extension)) = file_name.rsplit_once('.') else {
        return Ok(None);
    };
    let (meta_type, label, content) = match extension {
        "cls" => (
            "ApexClass",
            "Apex class",
            format!("public with sharing class {stem} {{\n\n}}\n"),
        ),
        "trigger" => (
            "ApexTrigger",
            "Apex trigger",
            format!("trigger {stem} on Account (before insert) {{\n\n}}\n"),
        ),
        "page" => (
            "ApexPage",
            "Visualforce page",
            "<apex:page>\n\n</apex:page>\n".to_string(),
        ),
        "component" => (
            "ApexComponent",
            "Visualforce component",
            "<apex:component>\n\n</apex:component>\n".to_string(),
        ),
        _ => return Ok(None),
    };

    if !valid_apex_name(stem) {
        return Err(format!(
            "'{stem}' can't be an {label} name. Start with a letter, then use letters, \
             digits and single underscores (at most 40 characters)."
        ));
    }

    let fields = match meta_type {
        "ApexClass" | "ApexTrigger" => {
            format!("    <apiVersion>{api_version}</apiVersion>\n    <status>Active</status>\n")
        }
        _ => format!("    <apiVersion>{api_version}</apiVersion>\n    <label>{stem}</label>\n"),
    };
    let meta = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <{meta_type} xmlns=\"http://soap.sforce.com/2006/04/metadata\">\n{fields}</{meta_type}>\n"
    );
    Ok(Some((content, meta)))
}

fn resolve_existing(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let absolute = resolve_in_workspace(root, relative)?;
    if !absolute.exists() {
        return Err(format!("'{relative}' does not exist."));
    }
    if absolute == root {
        return Err("The workspace folder itself can't be changed here.".to_string());
    }
    Ok(absolute)
}

fn resolve_folder(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let folder = if relative.trim().is_empty() {
        root.to_path_buf()
    } else {
        resolve_in_workspace(root, relative)?
    };
    if !folder.is_dir() {
        return Err("Items can only be moved or copied into a folder.".to_string());
    }
    Ok(folder)
}

/* ─────────────────────────────────────────────────────────────────
Commands
───────────────────────────────────────────────────────────────── */

#[tauri::command]
pub async fn read_workspace_file(
    app: tauri::AppHandle,
    path: String,
    workspace_id: Option<String>,
) -> AppResult<FileContent> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let full_path = resolve_in_workspace(&root, &path)?;
        // A write landing mid-read would pair new content with an old stamp,
        // and a later save would then miss a real conflict: read until the
        // stamp holds still.
        for _ in 0..3 {
            let before = stamp_of(&full_path);
            let content = read_editor_text(&full_path)?;
            let after = stamp_of(&full_path);
            if let (Some(before), Some(after)) = (before, after) {
                if before == after {
                    return Ok(FileContent {
                        content,
                        stamp: after,
                    });
                }
            }
        }
        Err("The file kept changing while it was being read. Try again.".into())
    })
    .await
}

/// Saves editor text. Given the stamp the text was read with, it refuses to
/// overwrite a file that changed or disappeared on disk since — a retrieve, a
/// git checkout or another editor — rather than silently replacing that work.
#[tauri::command]
pub async fn write_workspace_file(
    app: tauri::AppHandle,
    path: String,
    content: String,
    workspace_id: Option<String>,
    expected: Option<FileStamp>,
) -> AppResult<FileStamp> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let full_path = resolve_in_workspace(&root, &path)?;

        if let Some(expected) = expected {
            match stamp_of(&full_path) {
                Some(current) if current == expected => {}
                Some(_) => {
                    return Err(AppError::new(
                        ErrorKind::ChangedOnDisk,
                        format!("'{path}' changed on disk after it was opened."),
                    ))
                }
                None => {
                    return Err(AppError::new(
                        ErrorKind::ChangedOnDisk,
                        format!("'{path}' was deleted on disk after it was opened."),
                    ))
                }
            }
        }

        // Atomic, so a crash or power loss mid-save cannot truncate source.
        write_atomic(&full_path, content.as_bytes())?;
        stamp_of(&full_path).ok_or_else(|| "The file was saved but can't be read back.".into())
    })
    .await
}

/// Creates a file or folder. A new `.cls`, `.trigger`, `.page` or `.component`
/// also gets its `-meta.xml` and a minimal body, as `sf` generates them —
/// without one the file could not be deployed. Returns every path created.
#[tauri::command]
pub async fn create_workspace_item(
    app: tauri::AppHandle,
    item_path: String,
    is_folder: bool,
    workspace_id: Option<String>,
) -> AppResult<Vec<String>> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let absolute = resolve_in_workspace(&root, &item_path)?;
        let name = name_of(&absolute);
        if !valid_entry_name(&name) {
            return Err(format!("'{name}' isn't a valid file or folder name.").into());
        }
        if absolute.exists() {
            return Err(format!("'{item_path}' already exists.").into());
        }

        if is_folder {
            fs::create_dir_all(&absolute).map_err(|error| error.to_string())?;
            return Ok(vec![to_relative_string(&root, &absolute)]);
        }

        if let Some(parent) = absolute.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let api_version =
            source_api_version(&root).unwrap_or_else(|| FALLBACK_API_VERSION.to_string());
        match scaffold(&name, &api_version)? {
            Some((content, meta)) => {
                let meta_path = absolute.with_file_name(format!("{name}-meta.xml"));
                if meta_path.exists() {
                    return Err(format!(
                        "'{}' already exists.",
                        to_relative_string(&root, &meta_path)
                    )
                    .into());
                }
                fs::write(&absolute, content).map_err(|error| error.to_string())?;
                fs::write(&meta_path, meta).map_err(|error| error.to_string())?;
                Ok(vec![
                    to_relative_string(&root, &absolute),
                    to_relative_string(&root, &meta_path),
                ])
            }
            None => {
                fs::write(&absolute, "").map_err(|error| error.to_string())?;
                Ok(vec![to_relative_string(&root, &absolute)])
            }
        }
    })
    .await
}

/// Renames a file or folder with what belongs to it. The first change is the
/// item itself. With `rename_in_file`, a renamed class or trigger also gets
/// the new name inside — the user was asked, since other files that use the
/// old name are not changed.
#[tauri::command]
pub async fn rename_workspace_item(
    app: tauri::AppHandle,
    item_path: String,
    new_name: String,
    workspace_id: Option<String>,
    rename_in_file: Option<bool>,
) -> AppResult<RenameResult> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let absolute = resolve_existing(&root, &item_path)?;
        let new_name = new_name.trim();
        if !valid_entry_name(new_name) {
            return Err(format!("'{new_name}' isn't a valid file or folder name.").into());
        }
        let old_name = name_of(&absolute);
        if new_name == old_name {
            return Ok(RenameResult {
                changes: Vec::new(),
                renamed_uses: 0,
            });
        }
        let changes = apply_moves(&root, &rename_plan(&absolute, new_name))?;
        let renamed_uses = if rename_in_file.unwrap_or(false) {
            rename_apex_name_in(&absolute.with_file_name(new_name), &old_name, new_name)
                .unwrap_or(0)
        } else {
            0
        };
        Ok(RenameResult {
            changes,
            renamed_uses,
        })
    })
    .await
}

/// The class, interface, enum or trigger name an Apex file declares, or None
/// for any other file.
#[tauri::command]
pub async fn apex_declared_name(
    app: tauri::AppHandle,
    item_path: String,
    workspace_id: Option<String>,
) -> AppResult<Option<String>> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let absolute = resolve_existing(&root, &item_path)?;
        let Some(trigger) = apex::apex_kind(&name_of(&absolute)) else {
            return Ok(None);
        };
        let source = read_editor_text(&absolute)?;
        Ok(apex::declared_name(&source, trigger).map(|(name, _)| name))
    })
    .await
}

/// `item_paths` with everything that belongs to them, which a delete removes
/// and a move carries along — for the confirmation to list.
#[tauri::command]
pub async fn include_companions(
    app: tauri::AppHandle,
    item_paths: Vec<String>,
    workspace_id: Option<String>,
) -> AppResult<Vec<String>> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let items = item_paths
            .iter()
            .map(|path| resolve_existing(&root, path))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(with_companions(&items)
            .iter()
            .map(|path| to_relative_string(&root, path))
            .collect())
    })
    .await
}

/// Deletes items with what belongs to them. Returns every path removed.
#[tauri::command]
pub async fn delete_workspace_items(
    app: tauri::AppHandle,
    item_paths: Vec<String>,
    workspace_id: Option<String>,
) -> AppResult<Vec<String>> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let items = item_paths
            .iter()
            .map(|path| resolve_existing(&root, path))
            .collect::<Result<Vec<_>, _>>()?;

        let mut removed = Vec::new();
        for path in with_companions(&items) {
            // Listed twice under different letter case: already gone.
            if !path.exists() {
                continue;
            }
            let result = if path.is_dir() {
                fs::remove_dir_all(&path)
            } else {
                fs::remove_file(&path)
            };
            result.map_err(|error| {
                format!(
                    "Could not delete '{}': {error}",
                    to_relative_string(&root, &path)
                )
            })?;
            removed.push(to_relative_string(&root, &path));
        }
        Ok(removed)
    })
    .await
}

/// Moves items, with what belongs to them, into a folder ("" is the root).
#[tauri::command]
pub async fn move_workspace_items(
    app: tauri::AppHandle,
    item_paths: Vec<String>,
    target_folder: String,
    workspace_id: Option<String>,
) -> AppResult<Vec<PathChange>> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let destination = resolve_folder(&root, &target_folder)?;
        let items = item_paths
            .iter()
            .map(|path| resolve_existing(&root, path))
            .collect::<Result<Vec<_>, _>>()?;
        apply_moves(&root, &move_plan(&items, &destination)?).map_err(AppError::from)
    })
    .await
}

/// Copies items, with what belongs to them, into a folder ("" is the root).
/// Returns every path created.
#[tauri::command]
pub async fn copy_workspace_items(
    app: tauri::AppHandle,
    item_paths: Vec<String>,
    target_folder: String,
    workspace_id: Option<String>,
) -> AppResult<CopyResult> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let destination = resolve_folder(&root, &target_folder)?;
        let items = item_paths
            .iter()
            .map(|path| resolve_existing(&root, path))
            .collect::<Result<Vec<_>, _>>()?;
        if items
            .iter()
            .any(|item| item.is_dir() && destination.starts_with(item))
        {
            return Err("A folder can't be copied into itself.".into());
        }
        apply_copies(&root, &copy_plan(&items, &destination)).map_err(AppError::from)
    })
    .await
}

/// Shows a file or folder in the system file manager.
#[tauri::command]
pub async fn reveal_workspace_item(
    app: tauri::AppHandle,
    item_path: String,
    workspace_id: Option<String>,
) -> AppResult<()> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        let absolute = if item_path.trim().is_empty() {
            root
        } else {
            resolve_in_workspace(&root, &item_path)?
        };
        if !absolute.exists() {
            return Err(AppError::new(
                ErrorKind::NotFound,
                format!("'{item_path}' does not exist."),
            ));
        }
        reveal(&absolute).map_err(AppError::from)
    })
    .await
}

#[cfg(windows)]
fn reveal(path: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // Explorer parses `/select,` itself and mishandles the quoting Rust would
    // add around a path with spaces, so the argument is passed verbatim.
    Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{}\"", path.display()))
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(target_os = "macos")]
fn reveal(path: &Path) -> Result<(), String> {
    Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn reveal(path: &Path) -> Result<(), String> {
    let folder = if path.is_dir() {
        path
    } else {
        path.parent().unwrap_or(path)
    };
    Command::new("xdg-open")
        .arg(folder)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

/// Package directories as the explorer compares paths: `/`-separated, with no
/// `./` or trailing slash. An empty list means the project root is one, so
/// everything is deployable.
fn explorer_package_directories(dirs: Vec<String>) -> Vec<String> {
    let mut unique = BTreeSet::new();
    for dir in dirs {
        let normalized = dir
            .split(['/', '\\'])
            .filter(|part| !part.is_empty() && *part != ".")
            .collect::<Vec<_>>()
            .join("/");
        if normalized.is_empty() {
            return Vec::new();
        }
        unique.insert(normalized);
    }
    unique.into_iter().collect()
}

/// The project's package directories, which hold everything deployable.
#[tauri::command]
pub async fn workspace_package_directories(
    app: tauri::AppHandle,
    workspace_id: Option<String>,
) -> AppResult<Vec<String>> {
    blocking(move || {
        let root = workspace_root(&app, workspace_id.as_deref())?;
        Ok(explorer_package_directories(package_directories(&root)))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A throwaway project with a class, a static resource and two bundles.
    fn project(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("forgesf-fs-{label}-{}", next_temp_suffix()));
        let default = root.join("force-app/main/default");
        for dir in [
            "classes",
            "staticresources/logo",
            "lwc/myComp/__tests__",
            "aura/myCmp",
        ] {
            fs::create_dir_all(default.join(dir)).unwrap();
        }
        let files = [
            ("classes/Foo.cls", "public class Foo {}"),
            ("classes/Foo.cls-meta.xml", "<ApexClass/>"),
            ("classes/Bar.cls", "public class Bar {}"),
            ("staticresources/jquery.js", "/* jquery */"),
            (
                "staticresources/jquery.resource-meta.xml",
                "<StaticResource/>",
            ),
            ("staticresources/logo/logo.png", "png"),
            (
                "staticresources/logo.resource-meta.xml",
                "<StaticResource/>",
            ),
            ("lwc/myComp/myComp.js", "export default class MyComp {}"),
            ("lwc/myComp/myComp.html", "<template></template>"),
            (
                "lwc/myComp/myComp.js-meta.xml",
                "<LightningComponentBundle/>",
            ),
            ("lwc/myComp/myCompUtils.js", "export const x = 1;"),
            ("lwc/myComp/__tests__/myComp.test.js", "test"),
            ("aura/myCmp/myCmp.cmp", "<aura:component/>"),
            ("aura/myCmp/myCmpController.js", "({})"),
            ("aura/myCmp/myCmp.cmp-meta.xml", "<AuraDefinitionBundle/>"),
        ];
        for (path, content) in files {
            fs::write(default.join(path), content).unwrap();
        }
        root
    }

    fn rel(root: &Path, plan: &Plan) -> Vec<(String, String)> {
        plan.iter()
            .map(|(from, to)| (to_relative_string(root, from), to_relative_string(root, to)))
            .collect()
    }

    const D: &str = "force-app/main/default";

    #[test]
    fn names_are_checked_for_every_os() {
        for good in ["Foo.cls", "my-comp", ".forceignore", "a b.txt"] {
            assert!(valid_entry_name(good), "rejected {good:?}");
        }
        for bad in [
            "",
            ".",
            "..",
            "a/b",
            "a\\b",
            "what?",
            "trailing.",
            "trailing ",
            "c:d",
        ] {
            assert!(!valid_entry_name(bad), "accepted {bad:?}");
        }
        assert!(valid_apex_name("AccountService_2"));
        for bad in [
            "2Fast",
            "Double__Under",
            "Trailing_",
            "has-dash",
            &"A".repeat(41),
        ] {
            assert!(!valid_apex_name(bad), "accepted {bad:?}");
        }
        assert_eq!(split_stem("Foo.cls-meta.xml"), ("Foo", ".cls-meta.xml"));
        assert_eq!(split_stem(".gitignore"), (".gitignore", ""));
        assert_eq!(split_stem("README"), ("README", ""));
    }

    #[test]
    fn a_class_and_its_metadata_belong_together() {
        let root = project("pairs");
        let classes = root.join(D).join("classes");
        assert_eq!(
            companions(&classes.join("Foo.cls")),
            vec![classes.join("Foo.cls-meta.xml")]
        );
        assert_eq!(
            companions(&classes.join("Foo.cls-meta.xml")),
            vec![classes.join("Foo.cls")]
        );
        // A file with no metadata has no companions.
        assert!(companions(&classes.join("Bar.cls")).is_empty());

        let resources = root.join(D).join("staticresources");
        assert_eq!(
            companions(&resources.join("jquery.js")),
            vec![resources.join("jquery.resource-meta.xml")]
        );
        assert_eq!(
            companions(&resources.join("logo.resource-meta.xml")),
            vec![resources.join("logo")]
        );
        assert_eq!(
            companions(&resources.join("logo")),
            vec![resources.join("logo.resource-meta.xml")]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn renaming_carries_companions_and_bundle_files() {
        let root = project("rename");
        let default = root.join(D);

        assert_eq!(
            rel(
                &root,
                &rename_plan(&default.join("classes/Foo.cls"), "Baz.cls")
            ),
            vec![
                (
                    format!("{D}/classes/Foo.cls"),
                    format!("{D}/classes/Baz.cls")
                ),
                (
                    format!("{D}/classes/Foo.cls-meta.xml"),
                    format!("{D}/classes/Baz.cls-meta.xml")
                ),
            ]
        );
        // Renaming the metadata file renames the class too.
        assert_eq!(
            rel(
                &root,
                &rename_plan(
                    &default.join("classes/Foo.cls-meta.xml"),
                    "Baz.cls-meta.xml"
                )
            )[1],
            (
                format!("{D}/classes/Foo.cls"),
                format!("{D}/classes/Baz.cls")
            )
        );

        let lwc = rel(&root, &rename_plan(&default.join("lwc/myComp"), "newComp"));
        assert_eq!(
            lwc[0],
            (format!("{D}/lwc/myComp"), format!("{D}/lwc/newComp"))
        );
        assert_eq!(
            lwc[1..].to_vec(),
            vec![
                (
                    format!("{D}/lwc/newComp/myComp.html"),
                    format!("{D}/lwc/newComp/newComp.html")
                ),
                (
                    format!("{D}/lwc/newComp/myComp.js"),
                    format!("{D}/lwc/newComp/newComp.js")
                ),
                (
                    format!("{D}/lwc/newComp/myComp.js-meta.xml"),
                    format!("{D}/lwc/newComp/newComp.js-meta.xml")
                ),
            ],
            "a helper module keeps its name, since imports refer to it"
        );

        let aura = rel(&root, &rename_plan(&default.join("aura/myCmp"), "newCmp"));
        assert!(aura.contains(&(
            format!("{D}/aura/newCmp/myCmpController.js"),
            format!("{D}/aura/newCmp/newCmpController.js")
        )));

        // Carried out: the folder and its files end up renamed on disk.
        apply_moves(&root, &rename_plan(&default.join("lwc/myComp"), "newComp")).unwrap();
        assert!(default.join("lwc/newComp/newComp.js-meta.xml").is_file());
        assert!(default.join("lwc/newComp/myCompUtils.js").is_file());
        assert!(!default.join("lwc/myComp").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_clash_stops_the_whole_rename_before_anything_moves() {
        let root = project("clash");
        let classes = root.join(D).join("classes");
        fs::write(classes.join("Taken.cls-meta.xml"), "<ApexClass/>").unwrap();

        let error =
            apply_moves(&root, &rename_plan(&classes.join("Foo.cls"), "Taken.cls")).unwrap_err();
        assert!(error.contains("Taken.cls-meta.xml"), "{error}");
        assert!(classes.join("Foo.cls").is_file());
        assert!(!classes.join("Taken.cls").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    #[cfg(any(windows, target_os = "macos"))]
    fn a_case_only_rename_works_on_a_case_insensitive_file_system() {
        let root = project("case");
        let classes = root.join(D).join("classes");
        let changes =
            apply_moves(&root, &rename_plan(&classes.join("Foo.cls"), "FOO.cls")).unwrap();
        assert_eq!(changes.len(), 2);
        let names: Vec<String> = fs::read_dir(&classes)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect();
        assert!(names.contains(&"FOO.cls".to_string()), "{names:?}");
        assert!(names.contains(&"FOO.cls-meta.xml".to_string()), "{names:?}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn moving_takes_companions_and_refuses_a_folder_into_itself() {
        let root = project("move");
        let default = root.join(D);
        let target = default.join("classes/archive");
        fs::create_dir_all(&target).unwrap();

        let plan = move_plan(&[default.join("classes/Foo.cls")], &target).unwrap();
        assert_eq!(
            rel(&root, &plan),
            vec![
                (
                    format!("{D}/classes/Foo.cls"),
                    format!("{D}/classes/archive/Foo.cls")
                ),
                (
                    format!("{D}/classes/Foo.cls-meta.xml"),
                    format!("{D}/classes/archive/Foo.cls-meta.xml")
                ),
            ]
        );
        assert!(move_plan(&[default.join("classes")], &target).is_err());
        // Selecting both halves moves each once.
        let both = move_plan(
            &[
                default.join("classes/Foo.cls"),
                default.join("classes/Foo.cls-meta.xml"),
            ],
            &target,
        )
        .unwrap();
        assert_eq!(both.len(), 2);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn copies_get_a_shared_free_name() {
        let root = project("copy");
        let default = root.join(D);
        let classes = default.join("classes");

        let first = apply_copies(&root, &copy_plan(&[classes.join("Foo.cls")], &classes)).unwrap();
        assert_eq!(
            first.created,
            vec![
                format!("{D}/classes/FooCopy.cls"),
                format!("{D}/classes/FooCopy.cls-meta.xml")
            ]
        );
        // The class inside follows its new file name; the original is untouched.
        assert_eq!(first.renamed_in, vec![format!("{D}/classes/FooCopy.cls")]);
        assert_eq!(
            fs::read_to_string(classes.join("FooCopy.cls")).unwrap(),
            "public class FooCopy {}"
        );
        assert_eq!(
            fs::read_to_string(classes.join("Foo.cls")).unwrap(),
            "public class Foo {}"
        );
        let second = apply_copies(&root, &copy_plan(&[classes.join("Foo.cls")], &classes)).unwrap();
        assert_eq!(second.created[0], format!("{D}/classes/FooCopy2.cls"));

        // Into another folder, the name is kept, and so is the class inside.
        let elsewhere = default.join("classes/archive");
        fs::create_dir_all(&elsewhere).unwrap();
        let moved =
            apply_copies(&root, &copy_plan(&[classes.join("Bar.cls")], &elsewhere)).unwrap();
        assert_eq!(moved.created, vec![format!("{D}/classes/archive/Bar.cls")]);
        assert!(moved.renamed_in.is_empty());

        // A copied bundle's files follow the folder's new name.
        let lwc = default.join("lwc");
        apply_copies(&root, &copy_plan(&[lwc.join("myComp")], &lwc)).unwrap();
        assert!(lwc.join("myCompCopy/myCompCopy.js").is_file());
        assert!(lwc.join("myCompCopy/myCompUtils.js").is_file());
        assert!(lwc.join("myCompCopy/__tests__/myComp.test.js").is_file());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn a_renamed_class_can_take_its_new_name_inside_too() {
        let root = project("apex-rename");
        let classes = root.join(D).join("classes");
        fs::write(
            classes.join("Foo.cls"),
            "public class Foo {\r\n    public Foo() {}\r\n}\r\n",
        )
        .unwrap();

        apply_moves(&root, &rename_plan(&classes.join("Foo.cls"), "Baz.cls")).unwrap();
        let renamed = rename_apex_name_in(&classes.join("Baz.cls"), "Foo.cls", "Baz.cls");
        assert_eq!(renamed, Some(2));
        assert_eq!(
            fs::read_to_string(classes.join("Baz.cls")).unwrap(),
            "public class Baz {\r\n    public Baz() {}\r\n}\r\n",
            "line endings are kept"
        );

        // Nothing to do: not Apex, a name Apex can't use, or another declaration.
        assert_eq!(
            rename_apex_name_in(&classes.join("Baz.cls"), "Foo.cls", "Baz.cls"),
            None
        );
        assert_eq!(
            rename_apex_name_in(&classes.join("Baz.cls"), "Baz.cls", "my-baz.cls"),
            None
        );
        assert_eq!(
            rename_apex_name_in(&classes.join("Baz.cls"), "Baz.txt", "Qux.txt"),
            None
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn deleting_takes_companions_once() {
        let root = project("delete");
        let default = root.join(D);
        let planned: Vec<String> = with_companions(&[
            default.join("classes/Foo.cls"),
            default.join("staticresources/logo"),
            default.join("staticresources/logo/logo.png"),
        ])
        .iter()
        .map(|path| to_relative_string(&root, path))
        .collect();
        assert_eq!(
            planned,
            vec![
                format!("{D}/classes/Foo.cls"),
                format!("{D}/classes/Foo.cls-meta.xml"),
                format!("{D}/staticresources/logo"),
                format!("{D}/staticresources/logo.resource-meta.xml"),
            ]
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn package_directories_are_normalised_for_the_explorer() {
        let dirs = |list: &[&str]| list.iter().map(|dir| dir.to_string()).collect();
        assert_eq!(
            explorer_package_directories(dirs(&["./force-app/", "libs\\shared", "force-app"])),
            vec!["force-app".to_string(), "libs/shared".to_string()]
        );
        // The root as a package directory makes everything deployable.
        assert!(explorer_package_directories(dirs(&["force-app", "."])).is_empty());
    }

    #[test]
    fn new_apex_comes_with_its_metadata() {
        let (content, meta) = scaffold("AccountService.cls", "62.0").unwrap().unwrap();
        assert_eq!(content, "public with sharing class AccountService {\n\n}\n");
        assert!(meta.contains("<ApexClass xmlns=\"http://soap.sforce.com/2006/04/metadata\">"));
        assert!(meta.contains("<apiVersion>62.0</apiVersion>"));

        let (_, page_meta) = scaffold("Invoice.page", "62.0").unwrap().unwrap();
        assert!(page_meta.contains("<label>Invoice</label>"));

        assert!(scaffold("notes.txt", "62.0").unwrap().is_none());
        assert!(scaffold("my-class.cls", "62.0")
            .unwrap_err()
            .contains("Apex class name"));
    }
}
