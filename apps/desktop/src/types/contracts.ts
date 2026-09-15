/**
 * Compile-time proof that the hand-written IPC types still match Rust.
 *
 * The generated types in `./generated` are the source of truth for *shape*, but
 * the hand-written ones narrow several fields in ways that carry real meaning —
 * `orgType: "Production" | …` is what `isProtectedOrg` keys off, and a plain
 * `string` would silently disable that guard. So both are kept, and this file
 * asserts the hand-written type covers every field Rust actually sends.
 *
 * A Rust field that is added or renamed without a matching TypeScript change
 * fails to compile here. This is the class of bug that let `connectedAt` be
 * declared in TypeScript and never sent by Rust for months.
 *
 * Nothing imports this at runtime; it exists purely for `tsc`.
 */
import type {
  DiffEntry as RustDiffEntry,
  DiffSession as RustDiffSession,
  MetadataType as RustMetadataType,
  Organization as RustOrganization,
  RetrieveResult as RustRetrieveResult,
  WorkspaceEntry as RustWorkspaceEntry,
  WorkspaceRegistry as RustWorkspaceRegistry,
} from "./generated";

import type { Organization } from "@/features/org-manager/types";
import type { MetadataType, RetrieveResult } from "@/features/metadata/types";
import type {
  DiffEntry,
  DiffSession,
  Workspace,
  WorkspaceRegistry,
} from "@/features/workspace/types";
/** Fails to compile unless `T` covers every member of `Shape`. */
type Covers<T extends Shape, Shape> = T;

// Deploy jobs, change tracking and CLI info use the generated types directly,
// so they need no hand-written mirror here.
export type IpcContractChecks = [
  Covers<Organization, RustOrganization>,
  Covers<MetadataType, RustMetadataType>,
  Covers<RetrieveResult, RustRetrieveResult>,
  Covers<DiffEntry, RustDiffEntry>,
  Covers<DiffSession, RustDiffSession>,
  Covers<Workspace, RustWorkspaceEntry>,
  Covers<WorkspaceRegistry, RustWorkspaceRegistry>,
];
