# ForgeSF

<p align="center">
  <img src="apps/desktop/public/favicon.svg" alt="ForgeSF Logo" width="180"/>
</p>

<h1 align="center">ForgeSF</h1>

<p align="center">
The Open Platform for Salesforce Developers
</p>

<p align="center">
Build • Explore • Analyze • Deploy
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-In%20Development-blue" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-success" />
  <img src="https://img.shields.io/badge/UI-Tauri%20%2B%20React-informational" />
  <img src="https://img.shields.io/badge/Open%20Source-Yes-green" />
  <img src="https://img.shields.io/badge/License-Apache%202.0-orange" />
</p>

---

## 🚀 Overview

ForgeSF is an open-source, cross-platform desktop platform built for Salesforce developers.

Its goal is to simplify the Salesforce development experience by bringing together multiple developer tools into one modern workspace.

Instead of switching between:

- Salesforce CLI
- VS Code
- Workbench
- Salesforce Inspector
- Setup UI
- Deployment Tools
- Debug Logs

ForgeSF provides a unified experience focused on productivity and developer experience.

ForgeSF is built as a **Tauri + React** desktop application backed by a **Rust** core that shells out to the **Salesforce CLI (`sf`)**. Today the app ships a working, connected development workspace with **Org Manager**, a **Metadata Explorer**, unified **Developer Tools** (SOQL / SOSL / Anonymous Apex / CLI), a Monaco-powered **Workspace editor** with deploy support, and a **Deployments** manager.

---

# 🎯 Vision

ForgeSF aims to become the developer cockpit for Salesforce.

Think of it as a combination of:

- VS Code
- Postman
- Docker Desktop
- GitHub Desktop
- Grafana

built specifically for Salesforce development.

---

# 🌍 Mission

Our mission is to create a modern, extensible, open-source platform that helps Salesforce Developers, Architects, Consultants, Admins and DevOps Engineers work more efficiently.

ForgeSF will provide:

- Better developer experience
- Faster troubleshooting
- Easier deployments
- Metadata intelligence
- Dependency visualization
- Extensible plugin ecosystem

---

# ✨ Features

## ✅ Implemented in the current build

The following modules are functional in the desktop app today:

### 🏢 Org Manager
- Connect, list, and switch between multiple Salesforce orgs (OAuth via Salesforce CLI)
- Org aliases, default-org selection, and connection status
- Open the org in a browser, log out, and inspect org details

### 🧰 Developer Tools (single hub)
- **SOQL** and **SOSL** — run queries against the connected org with table & raw JSON views
- **Anonymous Apex** — execute code directly against your org
- **CLI** — run any `sf` command from the app
- Query/command **history** (persisted locally, re-runnable), row counts, execution time, copy & format output
- Keyboard shortcut `Ctrl/⌘ + Enter` to execute

### 📦 Metadata Explorer
Browse and retrieve metadata from any connected org:
- Search and select metadata types, then browse the components of each type
- Select multiple components and retrieve them into your local workspace
- Refresh types/components, clear selections, and jump to the Workspace

> **Note:** *Metadata* and *Anonymous Apex* no longer appear as top-level navigation items. To keep the sidebar clean they are surfaced through **Developer Tools** and the **Dashboard** quick actions — the underlying `/metadata` and `/apex` routes remain available.

### 💻 Workspace
- VS Code-style layout with an activity bar, file explorer, Monaco editor, and terminal
- **Apex syntax highlighting** and language-aware editing for `.cls`, `.trigger`, `.xml`, and more
- Create, rename, and delete files/folders inside the local `force-app` project
- **Deploy** your source to the connected org (with check-only option)

### 🚀 Deployments
- Validate and deploy workspace changes to a connected org
- Deployment status and feedback from the Salesforce CLI

### 🔌 Plugins & ⚙️ Settings
- Foundational **Plugins** and **Settings** surfaces ready for the extensibility roadmap

---

## 🧭 Planned & Roadmap Features

The next sections describe the product roadmap. Items already shipped are listed above under *Implemented in the current build*.

### 📊 Debug Center

Visual debugging (planned).

- Live Debug Logs
- CPU Usage
- Heap Usage
- SOQL Limits
- DML Limits
- Exception Viewer
- Execution Timeline

---

### 🔄 Org Comparison

Compare two Salesforce orgs (planned).

- Objects
- Fields
- Apex
- Flows
- Permission Sets
- Profiles
- Metadata

---

### 🧠 Dependency Analyzer

Understand where metadata is used (planned).

```text
Account.Status__c

↓

Flow

↓

Validation Rule

↓

Apex Trigger

↓

LWC

↓

Reports

↓

Permission Sets
```

---

## 🔌 Plugin Marketplace

Extend ForgeSF using plugins.

Future plugins may include:

- CPQ
- OmniStudio
- Health Cloud
- AI Assistants
- Data Loader
- Custom Integrations

---

# 🛠 Technology Stack

| Layer | Technology |
|--------|------------|
| Desktop | Tauri (v2) |
| Frontend | React 19 |
| Language | TypeScript |
| Styling | CSS Modules + global styles |
| UI Components | Lucide icons + custom components (Button, Badge, Card, Input) |
| State Management | Zustand |
| Data Fetching | TanStack Query |
| Editor | Monaco Editor |
| Resizable Layouts | react-resizable-panels |
| Routing | React Router |
| Backend | Rust (Tauri commands) |
| Salesforce Integration | Salesforce CLI (`sf`) |
| Testing | Vitest (planned) |
| End-to-End Testing | Playwright (planned) |
| CI/CD | GitHub Actions (planned) |

---

# 🖥 Getting Started (Development)

## Prerequisites

- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/) toolchain (stable) for the Tauri backend
- [Tauri v2 CLI](https://v2.tauri.app/) (`cargo install tauri-cli --version "^2"` or via pnpm)
- [Salesforce CLI (`sf`)](https://developer.salesforce.com/tools/salesforcecli) available on `PATH` (or installed at `C:\Program Files\sf`)

## Install

```bash
# from the repository root
pnpm install

# the desktop app lives in apps/desktop
cd apps/desktop
pnpm install
```

## Run

```bash
# Tauri desktop app (full backend)
pnpm tauri dev

# Frontend-only (Vite dev server, backend commands unavailable)
pnpm dev
```

## Build & lint

```bash
pnpm build   # type-check + production bundle
pnpm lint    # ESLint
```

---

# 📂 Repository Structure

The current, actively-developed app is a single **Tauri desktop** application under `apps/desktop`. Its React frontend is organised by feature:

```
ForgeSF
│
├── apps/
│   └── desktop/
│       ├── src/
│       │   ├── app/            # routing / app shell
│       │   ├── components/     # shared UI, layout, navigation
│       │   ├── features/       # feature modules (org-manager, metadata,
│       │   │                   #   soql/dev-tools, workspace, deployments, …)
│       │   ├── hooks/
│       │   ├── lib/
│       │   ├── providers/
│       │   ├── services/       # Tauri-invoke wrappers (SF CLI calls)
│       │   ├── store/          # Zustand stores
│       │   └── styles/
│       │
│       ├── src-tauri/          # Rust backend (Tauri commands → sf CLI)
│       └── workspace/          # local force-app source (Salesforce project)
│
├── docs/                       # (planned) project documentation
├── plugins/                    # (planned) plugin SDK & marketplace
├── packages/                   # (planned) shared packages
├── website/                    # (planned) project website
│
├── README.md
├── LICENSE
├── CHANGELOG.md
├── CONTRIBUTING.md
├── SECURITY.md
└── ROADMAP.md
```

---

# 📖 Documentation

Complete project documentation lives inside the `docs/` directory.

Documentation includes:

- Product Requirements Document
- Software Requirements Specification
- System Architecture
- Frontend Architecture
- Backend Architecture
- Database Design
- UI Guidelines
- Plugin SDK
- Development Standards
- Contribution Guide
- Security Guidelines
- Roadmap

---

# 🗺 Roadmap

## ✅ Phase 1 — Foundation
- Repository Setup
- Documentation
- Architecture
- Branding

## ✅ Phase 2 — Desktop Shell
- Desktop Foundation (Tauri + React)
- Authentication / Org connection via Salesforce CLI
- Dashboard

## ✅ Phase 3 — Core Developer Tools
- Org Manager
- Developer Tools (SOQL / SOSL / Anonymous Apex / CLI)
- Metadata Explorer

## 🔄 Phase 4 — Workspace & Deploy
- Workspace (Monaco editor, file explorer, terminal)
- Deployments (validate & deploy)

## ⏭ Phase 5
- Debug Center
- Org Comparison

---

## ⏭ Phase 6

- Dependency Analyzer

---

## ⏭ Phase 7

- Plugin SDK

---

## ⏭ Phase 8

- AI Features

---

## ⏭ Phase 9

- Stable v1.0 Release

---

# 🤝 Contributing

ForgeSF is an open-source community project.

We welcome contributions in the form of:

- Bug Reports
- Documentation
- Feature Requests
- Pull Requests
- Plugin Development
- UI Improvements
- Performance Optimisations

Please read the **CONTRIBUTING.md** guide before opening a pull request.

---

# 📋 Project Principles

ForgeSF follows these principles:

- Open Source First
- Developer Experience
- Extensible Architecture
- Modern UI
- Cross Platform
- Community Driven
- Performance Focused
- Enterprise Ready

---

# 🎯 Target Audience

ForgeSF is designed for:

- Salesforce Developers
- Salesforce Architects
- Salesforce Consultants
- Salesforce Administrators
- DevOps Engineers
- Technical Leads
- Students
- Open Source Contributors

---

# 🔐 Security

Security vulnerabilities should not be reported through GitHub Issues.

Please refer to **SECURITY.md**.

---

# 📜 License

This project is licensed under the Apache License 2.0.

See the LICENSE file for details.

---

# ⚠ Disclaimer

ForgeSF is an independent open-source project.

It is **not affiliated with, endorsed by, or sponsored by Salesforce, Inc.**

Salesforce is a registered trademark of Salesforce, Inc.

---

# ⭐ Support the Project

If you believe ForgeSF can improve the Salesforce developer experience:

⭐ Star the repository

🍴 Fork it

💡 Suggest new features

🤝 Contribute code

---

# ❤️ Acknowledgements

ForgeSF exists because of the amazing Salesforce developer community.

Thank you to everyone who contributes ideas, code, documentation and feedback.

Together, we can build a better developer experience.

---

## 🚧 Project Status

ForgeSF is an **active, in-development** project.

The desktop application is functional and can already connect to Salesforce orgs, browse and retrieve metadata, run **SOQL / SOSL / Anonymous Apex / CLI** from unified Developer Tools, edit a local `force-app` workspace, and deploy changes.

The current focus areas are:

- Finishing the **Workspace** experience (editor, file explorer, terminal, deploy)
- Polishing the **Dashboard**, **Org Manager**, and **Developer Tools** UX
- Extending the **Metadata Explorer** for deeper org introspection
- Building out **Deployments**, **Debug Center**, **Org Comparison**, and the **Plugin SDK**

Stay tuned for updates!
