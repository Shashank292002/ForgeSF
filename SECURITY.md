# Security

## Reporting a vulnerability

Report privately, not in a public issue: open a
[security advisory](https://github.com/Shashank292002/ForgeSF/security/advisories/new)
on this repository. That page is visible only to you and the maintainers.

Please include what an attacker would have to control to exploit it, what they
gain, and the steps to reproduce. A proof of concept helps; a patch is welcome
but not required.

You should get a first reply within a week. If a fix is needed, the advisory
stays private until a release carries it, and you will be credited unless you
ask otherwise.

## What is supported

Nothing is released yet, so the only supported version is the `main` branch.
Once installers ship, the latest release is supported.

## How ForgeSF handles your org

Worth knowing before you audit it, and before you trust it with a production
org.

**ForgeSF never sees your password, and does not store your tokens.** Logging in
runs `sf org login web`, which opens your browser and hands the tokens to the
Salesforce CLI's own credential store. ForgeSF asks the CLI to act on an org by
username or alias; it holds no secret of its own and writes no credentials to
disk. Revoking access with `sf org logout` (or from the org's Setup) revokes
ForgeSF's access with it.

**Every Salesforce call goes through the `sf` CLI.** There is no direct HTTP
connection to Salesforce, and the webview never talks to the network: the
content security policy allows `'self'` and the Tauri IPC channel only, with no
`'unsafe-eval'`.

**The webview cannot run arbitrary programs.** The CLI tab and the workspace
terminal run `sf` and nothing else, and commands that would execute code
downloaded from npm — `sf plugins install`, `link`, `update` — are refused
whatever word order or spelling is used.

**File access is confined to registered workspaces.** A folder becomes a
workspace only after being chosen in the native folder picker; a path sent from
the page is never registered on its own. Inside a workspace, every path is
resolved one component at a time with symlinks checked, so a link in a cloned
repository cannot be used to read or write outside the folder.

**Destructive actions against a protected org are confirmed.** Deploying,
running anonymous Apex, running a mutating CLI command, or logging out of an org
classified as Production asks first, and a deploy whose target org does not own
the open workspace asks before it proceeds.

## Known limitations

These are accepted, not overlooked:

- **The installers are unsigned.** Until a code-signing certificate is in place,
  verify what you download against the checksums on the release, and expect a
  macOS Gatekeeper prompt and a Windows SmartScreen warning.
- **There is no auto-update**, so a fix reaches you only when you download a new
  build. See ROADMAP.md.
- **ForgeSF trusts the `sf` CLI it finds.** It prefers the standard install
  locations and honours `FORGESF_SF_PATH`; on Windows it starts the CLI with
  `NoDefaultCurrentDirectoryInExePath` set, so a `node.exe` sitting in a cloned
  repository cannot take the place of the real one. If your `PATH` is
  compromised, so is ForgeSF.
- **Anything the CLI can do, a ForgeSF user can do**, including deleting
  metadata in a connected org. ForgeSF adds confirmations; it is not a
  permissions boundary.
