# Sprint 0 - Project Foundation

**Version:** v0.1.0

**Status:** ✅ Completed

---

# Objective

The objective of Sprint 0 is to prepare the complete development environment for ForgeSF.

By the end of this sprint we should have:

- GitHub Repository
- React Application
- Tauri Desktop Application
- Rust Toolchain
- Tailwind CSS
- shadcn/ui
- Initial Project Structure

---

# Step 1 - Create GitHub Repository

## Why?

The GitHub repository will store the source code and documentation.

Repository Name

```
ForgeSF
```

Files Created

```
README.md
LICENSE
.gitignore
CHANGELOG.md
ROADMAP.md
CONTRIBUTING.md
```

---

# Step 2 - Initialise Git

## Command

```bash
git init
```

## Why?

Initialises Git version control inside the project.

---

# Step 3 - Connect Repository

## Command

```bash
git remote add origin https://github.com/<username>/ForgeSF.git
```

## Why?

Connects the local repository to GitHub.

---

# Step 4 - Configure Git

## Commands

```bash
git config --global user.name "Your Name"

git config --global user.email "your@email.com"

git config --global core.editor "code --wait"
```

## Why?

Configures Git identity and uses VS Code as the default editor.

---

# Step 5 - Install Node.js

Download

https://nodejs.org

Verify

```bash
node -v

npm -v
```

Expected

```
Node Installed
```

## Why?

React, Vite and pnpm require Node.js.

---

# Step 6 - Install pnpm

Command

```bash
npm install -g pnpm
```

Verify

```bash
pnpm -v
```

## Why?

pnpm is the package manager used by ForgeSF.

---

# Step 7 - Install Rust

Download

https://rustup.rs

Choose

```
Visual Studio Toolchain
```

Verify

```bash
rustc --version

cargo --version
```

## Why?

Tauri requires Rust.

---

# Step 8 - Install Visual Studio Build Tools

Install

```
Desktop development with C++
```

Required Components

- MSVC
- Windows SDK
- MSBuild

Verify

```bash
where link
```

## Why?

Rust requires Microsoft's linker (link.exe).

Without this Tauri cannot compile.

---

# Step 9 - Verify Development Environment

Commands

```bash
node -v

npm -v

pnpm -v

git --version

rustc --version

cargo --version
```

Expected

All commands should return version numbers.

---

# Step 10 - Create pnpm Workspace

Create

```
pnpm-workspace.yaml
```

Contents

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "website"
```

## Why?

Allows multiple applications and packages inside one repository.

---

# Step 11 - Root package.json

Create

```
package.json
```

Install dependencies

```bash
pnpm install
```

## Why?

Creates node_modules and installs workspace dependencies.

---

# Step 12 - Create React Application

Navigate

```bash
cd apps
```

Create Project

```bash
pnpm create vite desktop --template react-ts
```

Options

```
Framework
React

Language
TypeScript

Linter
ESLint
```

Install

```bash
cd desktop

pnpm install
```

Run

```bash
pnpm dev
```

## Why?

Creates the frontend application.

---

# Step 13 - Install Tauri

Install CLI

```bash
pnpm add -D @tauri-apps/cli
```

Install API

```bash
pnpm add @tauri-apps/api
```

Initialise

```bash
pnpm tauri init
```

Options

```
App Name
ForgeSF

Window Title
ForgeSF

Dev Server
http://localhost:5173

Frontend Dev Command
pnpm dev

Frontend Build Command
pnpm build

Frontend Dist
dist
```

## Why?

Converts the React application into a native desktop application.

---

# Step 14 - Run ForgeSF

Command

```bash
pnpm tauri dev
```

Expected

```
React application opens inside a native desktop window.
```

---

# Step 15 - Common Issues

## link.exe not found

Cause

```
Visual Studio Build Tools missing.
```

Solution

Install

```
Desktop development with C++
```

Verify

```bash
where link
```

---

## vite not recognised

Cause

```
Dependencies not installed.
```

Solution

```bash
pnpm install
```

---

## Git Push Rejected

Cause

```
Remote repository already contains commits.
```

Solution

```bash
git pull origin main --allow-unrelated-histories

git push
```

---

# Step 16 - Commit Changes

```bash
git add .

git commit -m "feat: initialise ForgeSF desktop application"

git push origin feature/sprint-0-foundation
```

---

# Sprint Outcome

Completed

- GitHub Repository
- Git Configuration
- React
- TypeScript
- Vite
- pnpm Workspace
- Rust
- Cargo
- Tauri
- Tailwind CSS
- shadcn/ui

ForgeSF is now ready for Sprint 1.