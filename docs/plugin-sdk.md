# Plugin SDK — design

Status: **design, not built.** The Plugins page in the app is a labelled
preview and installs nothing. This document is what has to be agreed before
any of it is written.

Written for whoever implements the SDK, and for anyone deciding whether the
trade-offs below are acceptable.

## Why a plugin system at all

ForgeSF covers the work most Salesforce developers share: orgs, metadata, a
workspace, deploys, tests, logs, queries. What it cannot cover is the work that
is specific to a team — an internal naming convention to lint, a CPQ-shaped
workflow, an in-house deployment gate. Those belong to the people who have
them, and today the only way to add one is to fork the app.

A plugin system is worth building if it lets someone add that work without
forking, and without being able to quietly do something else with the org
credentials the app can reach. If it cannot do the second part, it should not
ship.

## The hard part: what a plugin is allowed to do

ForgeSF talks to real Salesforce orgs, including production ones. A plugin that
runs with the app's own privileges can deploy, delete metadata, query customer
data, and exfiltrate all of it — silently, because every one of those actions
looks like something the app does anyway.

So the security model is the design, not a section of it.

### Three models considered

**1. In-process JavaScript.** Plugins load as modules into the webview. Simple,
fast, and the plugin gets everything the page has, including the IPC bridge to
every Tauri command. Rejected: a plugin could call `deploy_start` or
`run_query` directly, and nothing in the app would know the difference.

**2. Node subprocesses.** Each plugin runs as its own process, talking to
ForgeSF over stdio. Strong isolation, but every plugin author ships a runtime,
start-up costs a process per plugin, and the process can reach the filesystem
and network freely — so the isolation is against ForgeSF, not against the user's
machine.

**3. A sandboxed webview with a brokered API (recommended).** Each plugin runs
in its own webview with no Tauri IPC, no network access of its own, and no
filesystem access. It talks to ForgeSF through a narrow, asynchronous message
channel. Every capability it uses is declared in its manifest, granted by the
user at install time, and mediated by ForgeSF — which means every org-touching
call goes through the same confirmations and typed errors the app's own UI does.

The third is what this design assumes.

### Capabilities

A plugin declares what it needs; ForgeSF asks the user once, at install, in
plain words. Nothing is implicit.

| Capability        | What it grants                                   | What ForgeSF still enforces                                    |
| ----------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| `query`           | Read-only SOQL/SOSL against the selected org     | Row caps; no Tooling API unless separately granted             |
| `metadata:read`   | List and retrieve metadata                       | Retrieves land in the workspace, not anywhere the plugin names |
| `metadata:write`  | Deploy                                           | Production confirmation; workspace/org mismatch guard          |
| `workspace:read`  | Read files in the open workspace                 | Path resolution inside the workspace, symlinks checked         |
| `workspace:write` | Create and modify files                          | Same, plus the app's own change tracking                       |
| `ui:panel`        | Contribute a panel, a sidebar view, or a command | No access to the rest of the DOM                               |
| `storage`         | Its own key-value store                          | Scoped to the plugin; not shared                               |

Deliberately **not** offered in v1: raw HTTP, arbitrary CLI commands, reading
the access token, running Anonymous Apex, `org logout`, and anything that
writes outside the workspace. A plugin that needs those is asking to be a fork.

### What the plugin never sees

The org's access token. Everything authenticated happens in Rust, as it does
today. A plugin asks "run this query against the selected org"; it does not get
credentials it could use elsewhere.

## Extension points (v1)

Small and concrete, so the first plugins are possible and the API can grow
without breaking:

- **Commands** — named actions that appear in the command palette, with an
  optional keybinding. The unit everything else builds on.
- **Panels** — a sidebar view or a bottom panel, rendered in the plugin's own
  webview.
- **Context-menu items** — in the explorer, scoped by file type.
- **Status-bar items** — text and a click target.

Not in v1: editor decorations, language servers, custom metadata-type handlers,
theme contributions. Each is a real request; each also widens the API surface
enough to make it hard to change later.

## The manifest

```jsonc
{
  "id": "acme.naming-lint", // reverse-DNS, unique
  "name": "Acme naming lint",
  "version": "1.2.0", // semver
  "publisher": "acme",
  "description": "Checks Apex class names against our conventions.",
  "forgesf": ">=0.2.0", // which app versions this works with
  "main": "dist/plugin.js",
  "capabilities": ["workspace:read", "ui:panel"],
  "contributes": {
    "commands": [
      { "id": "acme.lint.run", "title": "Lint naming", "key": "Ctrl+Alt+L" },
    ],
    "panels": [
      { "id": "acme.lint.results", "title": "Naming", "where": "sidebar" },
    ],
  },
}
```

Rules: an id that is already installed is refused; a `forgesf` range the running
version does not satisfy means the plugin loads disabled, with a reason; unknown
capabilities are refused rather than ignored, so a plugin built for a later
version fails loudly.

## The API a plugin sees

One asynchronous object, everything promise-returning, nothing synchronous that
could block the host:

```ts
declare const forgesf: {
  org: {
    current(): Promise<{
      alias: string;
      username: string;
      type: string;
    } | null>;
    query(soql: string): Promise<Record<string, unknown>[]>; // `query`
    onChanged(handler: (org: Org | null) => void): () => void;
  };
  workspace: {
    root(): Promise<string>;
    list(glob?: string): Promise<string[]>; // workspace:read
    read(path: string): Promise<string>; // workspace:read
    write(path: string, text: string): Promise<void>; // workspace:write
  };
  ui: {
    panel(id: string): Panel; // ui:panel
    toast(message: string, options?: ToastOptions): void;
    confirm(options: ConfirmOptions): Promise<boolean>;
  };
  storage: {
    // storage
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
  };
  commands: {
    register(id: string, run: () => void | Promise<void>): void;
  };
};
```

Calling something a plugin has no capability for rejects with a typed error
naming the missing capability — the same `AppError` shape the app's own IPC
uses, so the message a user sees is written once.

## Distribution

v1 installs from a local folder or a `.zip`, and only after the capability
prompt. No registry, no auto-update, no remote fetch — a marketplace is a
distribution problem _and_ a review problem, and shipping one without review is
how a plugin system becomes a malware channel.

If a registry follows, it needs at minimum: signed packages, a publisher
identity, a capability diff shown on update, and a way to pull a package.

## Lifecycle

1. **Discovered** at startup from the plugins folder in app data.
2. **Validated** — manifest shape, id uniqueness, version range, capabilities.
3. **Activated** lazily: on a contributed command being run, or its panel being
   opened. A plugin that is never used costs nothing.
4. **Deactivated** on disable or uninstall; its webview is destroyed and its
   storage kept until uninstall.

A plugin that throws during activation is disabled with the error shown against
it, and never retried automatically — a broken plugin must not take a launch
with it.

## Open questions

- **Bundling.** Do plugin authors ship a bundle, or does ForgeSF bundle at
  install time? Bundling at install is friendlier and slower, and needs a
  toolchain in the app.
- **Versioning the API.** Semver on `forgesf` handles the app, but the plugin
  API needs its own version once it grows a second shape.
- **Testing.** Plugin authors need a way to run a plugin against a fake org.
  That is probably a test harness package, and it is work.
- **Are panels enough?** The first five plugin ideas on the Plugins page split
  roughly evenly between "a panel" and "a step in an existing flow". The second
  kind needs hooks that do not exist in this design.

## What has to be true before this is built

1. The capability broker exists in Rust and is tested — including that a plugin
   without a capability cannot reach the command behind it.
2. There is a way to see what a plugin has done: its calls appear in the
   activity log, attributed to it.
3. Uninstall is complete — webview, storage, contributions, all of it.
4. The first plugin is written against the SDK by someone who did not design
   it, and the friction they hit is fixed before it ships.

Until then the Plugins page stays a preview, and says so.
