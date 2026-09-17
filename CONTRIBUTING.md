# Contributing to ForgeSF

Thanks for looking. ForgeSF is a Tauri v2 desktop app: a React 19 + TypeScript
frontend, a Rust backend, and the Salesforce CLI (`sf`) doing the actual work
against orgs.

## Getting set up

You need [Node 20+](https://nodejs.org/) with [pnpm](https://pnpm.io/), a stable
[Rust](https://rustup.rs/) toolchain, and the
[Salesforce CLI](https://developer.salesforce.com/tools/salesforcecli) on your
`PATH`. On Linux you also need the Tauri system dependencies (`libwebkit2gtk-4.1-dev`,
`libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf`).

```bash
cd apps/desktop
pnpm install
pnpm tauri dev        # the app, with the Rust backend
pnpm dev              # frontend only; Tauri commands will fail
```

If the app cannot find your CLI, set `FORGESF_SF_PATH` to the full path of the
`sf` executable.

## Before you open a pull request

Run what CI runs. All of it should pass locally:

```bash
# in apps/desktop
pnpm exec tsc --noEmit -p tsconfig.app.json
pnpm lint
pnpm test
pnpm format:check

# in apps/desktop/src-tauri
cargo fmt --check
cargo clippy -- -D warnings
cargo test --lib
```

`cargo test --lib` also regenerates the TypeScript types for everything crossing
the IPC boundary. If `git status` shows changes under `src/types/generated`,
commit them: CI fails when they are stale, because it means the frontend's
`invoke<T>` calls no longer match what Rust sends.

The minimum supported Rust version is pinned in `Cargo.toml` (1.77.2), so newer
standard-library methods will fail clippy even when they compile on your
machine.

## How the code is organised

```
apps/desktop/
  src/
    features/<feature>/       components, hooks, lib, services, store
    components/ui/            shared primitives (Button, Dialog, Menu, Toast…)
    services/tauri.ts         invoke() wrappers
    store/                    cross-feature Zustand stores
    types/generated/          ts-rs output — never edit by hand
  src-tauri/src/
    sf/                       finding, running and parsing the CLI
    workspace/                the registry, files, tree, search, watcher
    orgs.rs  metadata.rs  deploy.rs  diff.rs  terminal.rs  error.rs
```

A Tauri command lives in the module it belongs to, is registered in `lib.rs`,
and returns `AppResult<T>` so failures reach the UI as a typed error rather than
a string.

## What we look for in a change

**Say why, not what.** The code says what it does. Comments are for the reason —
the bug that made this necessary, the constraint that rules out the obvious
approach. A comment that restates the line below it will be asked about in
review.

**Write in the style already there.** Match the surrounding naming, comment
density and structure rather than importing a personal style. CSS lives in a
module next to its component, or in the prefixed global sheet for the workspace
and retrieve surfaces; design tokens live in `src/styles/variables.css` and
nowhere else.

**Cover the logic with tests.** Pure helpers, store actions and parsing get unit
tests (Vitest for the frontend, `cargo test` for Rust). Component tests use
Testing Library with `// @vitest-environment jsdom` at the top of the file.
Anything touching the registry, paths or the CLI runner needs a test — those are
where the damaging bugs have been.

**Never widen what the webview can do.** New commands validate their inputs in
Rust and resolve paths through the workspace helpers. Do not add a capability to
`capabilities/default.json` or relax the CSP without saying why in the pull
request.

**Be careful with real orgs.** If a change can deploy, delete or modify org
data, it goes through the existing confirmation helpers, and it should be tested
against a scratch org or a sandbox — never against production.

## Commits and pull requests

Describe the behaviour change and the reason. If it fixes something, say what
went wrong and how you reproduced it; if it is a feature, say which roadmap item
it belongs to. Screenshots help for anything visual. Keep unrelated changes in
separate pull requests — a formatting sweep mixed into a bug fix is hard to
review and harder to revert.

## Reporting bugs

Include your OS, the ForgeSF version (Settings → About), the output of
`sf --version`, what you did, and what happened. If the app showed an error,
quote it exactly. For anything that looks like a security problem, do not open
an issue — see [SECURITY.md](SECURITY.md).
