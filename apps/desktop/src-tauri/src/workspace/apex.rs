//! Just enough Apex reading to keep a class's name in step with its file.
//!
//! Salesforce only accepts `Foo.cls` when it declares `class Foo`. Renaming or
//! copying the file used to leave the old name inside, so the new file could
//! not be deployed. This is not a parser: it skips comments and string
//! literals and looks at identifiers, which is all these edits need.

use std::ops::Range;

/// An identifier in Apex source: where it is, and whether a declaration
/// keyword (`class`, `interface`, `enum`, `trigger`) came directly before it.
struct Name {
    span: Range<usize>,
    declared_by: Option<&'static str>,
}

const TYPE_KEYWORDS: &[&str] = &["class", "interface", "enum"];
const TRIGGER_KEYWORDS: &[&str] = &["trigger"];

/// Every identifier outside comments and string literals, in order.
fn names(source: &str, keywords: &[&'static str]) -> Vec<Name> {
    let bytes = source.as_bytes();
    let mut found = Vec::new();
    let mut pending: Option<&'static str> = None;
    let mut i = 0;

    while i < bytes.len() {
        let byte = bytes[i];
        if byte.is_ascii_whitespace() {
            i += 1;
        } else if byte == b'/' && bytes.get(i + 1) == Some(&b'/') {
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
        } else if byte == b'/' && bytes.get(i + 1) == Some(&b'*') {
            i += 2;
            while i < bytes.len() && !(bytes[i] == b'*' && bytes.get(i + 1) == Some(&b'/')) {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
        } else if byte == b'\'' {
            i += 1;
            while i < bytes.len() && bytes[i] != b'\'' {
                // A backslash escapes the next character, quotes included.
                i += if bytes[i] == b'\\' { 2 } else { 1 };
            }
            i = (i + 1).min(bytes.len());
            pending = None;
        } else if byte.is_ascii_alphabetic() || byte == b'_' {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                i += 1;
            }
            let word = &source[start..i];
            found.push(Name {
                span: start..i,
                declared_by: pending.take(),
            });
            pending = keywords
                .iter()
                .find(|keyword| word.eq_ignore_ascii_case(keyword))
                .copied();
        } else {
            // A declaration keyword is followed directly by its name; anything
            // else in between (`@`, a bracket, an operator) means it was not one.
            pending = None;
            i += 1;
        }
    }
    found
}

/// The name a `.cls` file declares (its top-level class, interface or enum),
/// or a `.trigger` file's trigger name, with its position in `source`.
pub(crate) fn declared_name(source: &str, trigger: bool) -> Option<(String, Range<usize>)> {
    let keywords = if trigger {
        TRIGGER_KEYWORDS
    } else {
        TYPE_KEYWORDS
    };
    names(source, keywords)
        .into_iter()
        .find(|name| name.declared_by.is_some())
        .map(|name| (source[name.span.clone()].to_string(), name.span))
}

/// `source` with the declared name `old` changed to `new`, and the count of
/// changes — or None when the file does not declare `old`.
///
/// For a class, its other uses in the file change too: constructors, `new
/// Foo()`, `Foo.CONSTANT`. Those must match `old` exactly, so a variable `foo`
/// in class `Foo` keeps its name; the declaration itself is matched ignoring
/// case, as Apex does. A trigger's name is only ever its declaration.
pub(crate) fn rename_declared(
    source: &str,
    trigger: bool,
    old: &str,
    new: &str,
) -> Option<(String, usize)> {
    let keywords = if trigger {
        TRIGGER_KEYWORDS
    } else {
        TYPE_KEYWORDS
    };
    let all = names(source, keywords);
    let declaration = all.iter().position(|name| name.declared_by.is_some())?;
    if !source[all[declaration].span.clone()].eq_ignore_ascii_case(old) {
        return None;
    }

    let spans: Vec<Range<usize>> = all
        .iter()
        .enumerate()
        .filter(|(index, name)| {
            *index == declaration || (!trigger && &source[name.span.clone()] == old)
        })
        .map(|(_, name)| name.span.clone())
        .collect();

    let mut renamed = String::with_capacity(source.len() + spans.len() * new.len());
    let mut last = 0;
    for span in &spans {
        renamed.push_str(&source[last..span.start]);
        renamed.push_str(new);
        last = span.end;
    }
    renamed.push_str(&source[last..]);
    Some((renamed, spans.len()))
}

/// Which kind of Apex source a file name is, by extension: `Some(false)` for a
/// class, `Some(true)` for a trigger.
pub(crate) fn apex_kind(file_name: &str) -> Option<bool> {
    match file_name.rsplit_once('.') {
        Some((_, "cls")) => Some(false),
        Some((_, "trigger")) => Some(true),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLASS: &str = "/**\n * Replaces class OldService, see 'class Foo'.\n */\n\
        @RestResource(urlMapping='/class/Foo/*')\n\
        public with sharing class Foo extends Base implements Callable {\n\
        \x20   private static final String LABEL = 'Foo class';\n\
        \x20   public Foo() {}\n\
        \x20   public Foo(String name) { this(); }\n\
        \x20   public static Foo make() { Foo foo = new Foo(); return foo; }\n\
        \x20   // Foo again, in a comment\n\
        \x20   public class FooInner {}\n\
        }\n";

    #[test]
    fn finds_the_declaration_past_comments_annotations_and_strings() {
        let (name, span) = declared_name(CLASS, false).unwrap();
        assert_eq!(name, "Foo");
        assert!(CLASS[..span.start].ends_with("class "));

        assert_eq!(
            declared_name("global interface Callable2 {}", false)
                .unwrap()
                .0,
            "Callable2"
        );
        assert_eq!(
            declared_name("public enum Season { WINTER }", false)
                .unwrap()
                .0,
            "Season"
        );
        assert_eq!(
            declared_name("trigger AccountTrigger on Account (before insert) {}", true)
                .unwrap()
                .0,
            "AccountTrigger"
        );
        // Keywords only count as code, not inside a comment or string.
        assert!(declared_name("// class Foo\nString s = 'class Bar';", false).is_none());
    }

    #[test]
    fn renaming_changes_the_class_and_its_uses_but_not_comments_or_strings() {
        let (renamed, count) = rename_declared(CLASS, false, "Foo", "Bar").unwrap();
        assert!(renamed.contains("public with sharing class Bar extends Base"));
        assert!(renamed.contains("public Bar() {}"));
        assert!(renamed.contains("public Bar(String name)"));
        assert!(renamed.contains("public static Bar make() { Bar foo = new Bar(); return foo; }"));
        // Comments, strings, a differently cased variable and a longer name stay.
        assert!(renamed.contains("Replaces class OldService, see 'class Foo'."));
        assert!(renamed.contains("urlMapping='/class/Foo/*'"));
        assert!(renamed.contains("'Foo class'"));
        assert!(renamed.contains("// Foo again, in a comment"));
        assert!(renamed.contains("public class FooInner {}"));
        assert_eq!(count, 6);
    }

    #[test]
    fn nothing_changes_when_the_file_declares_another_name() {
        assert!(rename_declared(CLASS, false, "Other", "Bar").is_none());
        // The declaration matches regardless of case, as Apex does.
        let (renamed, _) = rename_declared("public class FOO {}", false, "Foo", "Bar").unwrap();
        assert_eq!(renamed, "public class Bar {}");
    }

    #[test]
    fn a_trigger_keeps_everything_but_its_declared_name() {
        let source = "trigger Old on Account (after update) {\n    Old.handle(Trigger.new);\n}\n";
        let (renamed, count) = rename_declared(source, true, "Old", "New").unwrap();
        assert_eq!(
            renamed,
            "trigger New on Account (after update) {\n    Old.handle(Trigger.new);\n}\n"
        );
        assert_eq!(count, 1);
    }

    #[test]
    fn apex_files_are_told_apart_by_extension() {
        assert_eq!(apex_kind("Foo.cls"), Some(false));
        assert_eq!(apex_kind("Foo.trigger"), Some(true));
        assert_eq!(apex_kind("Foo.cls-meta.xml"), None);
        assert_eq!(apex_kind("foo.js"), None);
    }
}
