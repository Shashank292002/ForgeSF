# ForgeSF

<p align="center">
  <img src="assets/logo.png" alt="ForgeSF Logo" width="180"/>
</p>

<h1 align="center">ForgeSF</h1>

<p align="center">
The Open Platform for Salesforce Developers
</p>

<p align="center">
Build • Explore • Analyze • Deploy
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Planning-blue" />
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-success" />
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

# ✨ Planned Features

## 🏢 Org Manager

- Multiple org management
- OAuth authentication
- Scratch Org support
- Sandbox management
- Connected org dashboard
- Org aliases
- Favourite orgs

---

## 🔍 SOQL Studio

- Query editor
- Syntax highlighting
- Auto-complete
- Query history
- Saved queries
- CSV export
- Execution statistics

---

## ⚡ Apex Studio

- Execute Anonymous Apex
- Save snippets
- Run history
- Debug output
- Execution logs

---

## 📦 Metadata Explorer

Explore every part of your Salesforce org.

- Objects
- Fields
- Apex Classes
- Triggers
- LWC
- Aura Components
- Flows
- Profiles
- Permission Sets
- Custom Metadata
- Custom Labels

---

## 🚀 Deployment Center

Deploy metadata visually.

- Validate deployment
- Deploy source
- Deployment history
- Rollback support
- Deployment logs

---

## 📊 Debug Center

Visual debugging.

- Live Debug Logs
- CPU Usage
- Heap Usage
- SOQL Limits
- DML Limits
- Exception Viewer
- Execution Timeline

---

## 🔄 Org Comparison

Compare two Salesforce orgs.

Compare

- Objects
- Fields
- Apex
- Flows
- Permission Sets
- Profiles
- Metadata

---

## 🧠 Dependency Analyzer

Understand where metadata is used.

Example

```
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
| Desktop | Tauri |
| Frontend | React |
| Language | TypeScript |
| Styling | Tailwind CSS |
| UI Components | shadcn/ui |
| State Management | Zustand |
| Data Fetching | TanStack Query |
| Editor | Monaco Editor |
| Graphs | React Flow |
| Backend | Rust |
| Local Database | SQLite |
| Testing | Vitest |
| End-to-End Testing | Playwright |
| CI/CD | GitHub Actions |

---

# 📂 Repository Structure

```
ForgeSF
│
├── apps/
│   └── desktop/
│
├── packages/
│   ├── auth/
│   ├── core/
│   ├── deployment/
│   ├── graph/
│   ├── metadata/
│   ├── plugin-sdk/
│   ├── salesforce/
│   ├── shared/
│   └── ui/
│
├── plugins/
├── docs/
├── website/
├── assets/
├── scripts/
├── tests/
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

## Phase 1

- Repository Setup
- Documentation
- Architecture
- Branding

---

## Phase 2

- Desktop Foundation
- Authentication
- Dashboard

---

## Phase 3

- Org Manager
- SOQL Studio
- Apex Runner

---

## Phase 4

- Metadata Explorer
- Debug Center

---

## Phase 5

- Deployment Center
- Org Comparison

---

## Phase 6

- Dependency Analyzer

---

## Phase 7

- Plugin SDK

---

## Phase 8

- AI Features

---

## Phase 9

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

ForgeSF is currently in the architecture and planning phase.

The first milestone focuses on building a solid foundation before implementing the desktop application.

Stay tuned for updates!