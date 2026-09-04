import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { Organization } from "../features/org-manager/types";
import type { MetadataType, RetrieveResult } from "../features/metadata/types";

export type {
  RetrieveResult,
  RetrieveTypeResult as RetrieveResultItem,
} from "../features/metadata/types";

export interface RetrieveProgressEvent {
  phase: "item" | "complete";
  index: number;
  total: number;
  kind: string | null;
  status: "running" | "completed" | "failed" | "cancelled" | null;
  retrieved: number;
  succeeded: number;
  failed: number;
  message: string | null;
}

// Connect Salesforce org
export function connectSalesforce() {
  return invoke<Organization>("connect_salesforce");
}

// Open org in browser
export function openOrg(username: string) {
  return invoke<void>("open_org", {
    username,
  });
}

// Set default org
export function setDefaultOrg(username: string) {
  return invoke<string>("set_default_org", {
    username,
  });
}

// Logout org
export function logoutOrg(username: string) {
  return invoke<string>("logout_org", {
    username,
  });
}

// List all metadata types
export function listMetadataTypes(username: string) {
  return invoke<MetadataType[]>("list_metadata_types", {
    username,
  });
}

// List components for a metadata type
export function listMetadataComponents(metadataType: string, username: string) {
  return invoke<string[]>("list_metadata_components", {
    metadataType,
    username,
  });
}

export function readWorkspaceFile(path: string) {
  return invoke<string>("read_workspace_file", { path });
}

export function writeWorkspaceFile(path: string, content: string) {
  return invoke<string>("write_workspace_file", { path, content });
}

export interface DeployOutcome {
  /** Present after a validation — feed it to `deployQuick` to promote it. */
  jobId: string | null;
  status: string;
  summary: string;
  checkOnly: boolean;
}

/**
 * Deploys the local workspace to `username`. `checkOnly` runs a server-side
 * validation whose job id can then be promoted via `deployQuick` instead of
 * re-uploading everything. `metadata` scopes the deploy to specific components
 * (`ApexClass:Foo`); omit it to deploy the whole package directory.
 */
export function deployWorkspace(
  username: string,
  checkOnly = false,
  metadata?: string[],
) {
  return invoke<DeployOutcome>("deploy_workspace", {
    username,
    checkOnly,
    metadata: metadata && metadata.length > 0 ? metadata : null,
  });
}

/** Promotes a previously validated deployment without re-running it. */
export function deployQuick(username: string, jobId: string) {
  return invoke<DeployOutcome>("deploy_quick", { username, jobId });
}

/** Every org the Salesforce CLI is authenticated against. */
export function listOrgs() {
  return invoke<Organization[]>("list_orgs");
}

export function runQuery(username: string, query: string) {
  return invoke<string>("run_query", { username, query });
}

export function runCommand(args: string[], input?: string) {
  return invoke<string>("run_command", { args, input });
}

/**
 * Runs an `sf` command that emits `--json`, validating the response envelope.
 *
 * Use this over `runCommand` for anything passing `--json`: several
 * subcommands report failure *inside* a status-0 response. `sf apex execute`
 * exits 0 when Apex compiles and then throws, so exit-code checking alone
 * reports a failed run as a success.
 */
export function runSfJson(args: string[], input?: string) {
  return invoke<string>("run_sf_json", { args, input });
}

/** Asks an in-flight Developer Tools command to stop. */
export function cancelSfCommand() {
  return invoke<void>("cancel_sf_command");
}

/**
 * Retrieves the selected metadata from an org, streaming live progress events
 * so callers can render per-type progress. Resolves once all types complete.
 */
export function retrieveMetadataProgress(username: string, metadata: string[]) {
  return invoke<RetrieveResult>("retrieve_metadata_progress", {
    username,
    metadata,
  });
}

/**
 * Asks an in-flight retrieve to stop after the current batch. The retrieve
 * promise still resolves, with the types it managed to complete.
 */
export function cancelRetrieve() {
  return invoke<void>("cancel_retrieve");
}

/**
 * Subscribes to live retrieval progress events. Returns a function that
 * unsubscribes.
 */
export function onRetrieveProgress(
  callback: (payload: RetrieveProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<RetrieveProgressEvent>("retrieve_progress", (event) => {
    callback(event.payload);
  });
}
