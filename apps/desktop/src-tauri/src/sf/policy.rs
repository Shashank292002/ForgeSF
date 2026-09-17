//! The `sf` commands ForgeSF won't run for the page.
//!
//! Developer Tools and the workspace terminal pass free-form arguments to the
//! CLI, and nearly anything goes: they are a CLI. A few commands are different.
//! They install code that then runs on this computer with the user's
//! permissions (`sf plugins install` fetches and runs an npm package), or
//! replace the CLI that ForgeSF itself runs on. The page can't be relied on to
//! filter those, so every free-form command is checked here.

/// The words that name the command, lower-cased.
///
/// They end where the CLI's own lookup stops: at the first flag or
/// `name=value` argument. Colons and spaces both separate words, and the CLI
/// accepts a command's words in any order, so `plugins:install`,
/// `plugins install` and `install plugins` all name the same command.
fn command_words(args: &[String]) -> Vec<String> {
    let mut words = Vec::new();
    for arg in args {
        let arg = arg.trim();
        if arg.starts_with('-') || arg.contains('=') {
            break;
        }
        words.extend(
            arg.split(|character: char| character == ':' || character.is_whitespace())
                .filter(|word| !word.is_empty())
                .map(str::to_lowercase),
        );
    }
    words
}

/// The words that make a `plugins` command change what is installed: install
/// (alias `add`), link, uninstall (aliases `unlink`, `remove`), update, reset,
/// and adding to or removing from the unsigned-plugin allowlist.
const PLUGIN_CHANGES: &[&str] = &[
    "install",
    "add",
    "link",
    "uninstall",
    "unlink",
    "remove",
    "update",
    "reset",
];

/// Why ForgeSF won't run `args`, or `None` when it will.
pub(crate) fn refusal(args: &[String]) -> Option<String> {
    let words = command_words(args);
    let has = |wanted: &str| words.iter().any(|word| word == wanted);
    let shown = || format!("sf {}", words.join(" "));

    if has("plugins") && PLUGIN_CHANGES.iter().any(|word| has(word)) {
        return Some(format!(
            "ForgeSF won't run `{}`: plugins are code that runs on this computer with \
             your permissions. If you trust the plugin, run the command in your own terminal.",
            shown()
        ));
    }
    // `update` is a single-word command, so it can only come first.
    if words.first().is_some_and(|word| word == "update") {
        return Some(format!(
            "ForgeSF won't run `{}`: it replaces the Salesforce CLI that ForgeSF runs on. \
             Update the CLI from your own terminal or its installer.",
            shown()
        ));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(line: &str) -> Vec<String> {
        line.split_whitespace().map(str::to_string).collect()
    }

    #[test]
    fn plugin_changes_are_refused_in_every_spelling() {
        for line in [
            "plugins install @scope/evil",
            "plugins:install @scope/evil",
            "PLUGINS INSTALL @scope/evil",
            "install plugins @scope/evil",
            "install:plugins @scope/evil",
            "plugins add evil",
            "plugins link ./local-plugin",
            "plugins uninstall evil",
            "plugins unlink evil",
            "plugins remove evil",
            "plugins update",
            "plugins reset --hard",
            "plugins trust allowlist add --name evil",
            "plugins install evil --json",
        ] {
            assert!(refusal(&args(line)).is_some(), "{line} should be refused");
        }
        // One argument holding the whole command.
        let joined = vec!["plugins install".to_string(), "evil".to_string()];
        assert!(refusal(&joined).is_some());
    }

    #[test]
    fn reading_about_plugins_is_allowed() {
        for line in [
            "plugins",
            "plugins --core",
            "plugins inspect @salesforce/plugin-apex",
            "plugins discover",
            "plugins trust verify --npm @scope/pkg",
            "plugins trust allowlist list",
        ] {
            assert_eq!(refusal(&args(line)), None, "{line} should run");
        }
    }

    #[test]
    fn updating_the_cli_is_refused() {
        assert!(refusal(&args("update")).is_some());
        assert!(refusal(&args("update stable")).is_some());
        assert!(refusal(&args("update --version 2.0.0")).is_some());
    }

    #[test]
    fn everyday_commands_run() {
        for line in [
            "org list",
            "org display --target-org dev",
            "data update record --sobject Account --record-id 001 --values Name=X",
            "package update --package x",
            "project deploy start --source-dir plugins/install",
            "apex run --file update.apex",
            "alias set plugins=install",
            "",
        ] {
            assert_eq!(refusal(&args(line)), None, "{line} should run");
        }
    }

    #[test]
    fn the_refusal_names_the_command() {
        let message = refusal(&args("plugins:install @scope/evil --json")).unwrap();
        assert!(
            message.contains("`sf plugins install @scope/evil`"),
            "{message}"
        );
    }
}
