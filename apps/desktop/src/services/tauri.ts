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
  /**
   * Per type: `running` | `completed` | `failed`. On the final `complete`
   * event: `complete` | `complete-with-errors` | `cancelled`.
   */
  status: string | null;
  retrieved: number;
  succeeded: number;
  failed: number;
  message: string | null;
}

/** Where and how to authenticate a new org. */
export interface ConnectOptions {
  /**
   * Login host — `https://test.salesforce.com` for a sandbox, or a My Domain
   * URL. Omitted for production's standard login page.
   */
  instanceUrl?: string | null;
  alias?: string | null;
  /** Make it the CLI's default org. */
  setDefault?: boolean;
}

/**
 * Authenticates an org through the browser. Pass a `runId` so the login can be
 * abandoned with `cancelSfCommand`.
 */
export function connectSalesforce(
  options: ConnectOptions = {},
  runId?: string,
) {
  return invoke<Organization>("connect_salesforce", {
    instanceUrl: options.instanceUrl || null,
    alias: options.alias || null,
    setDefault: options.setDefault ?? false,
    runId: runId ?? null,
  });
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

/**
 * Every org the Salesforce CLI is authenticated against.
 *
 * `skipConnectionStatus` returns in a fraction of the time — it skips pinging
 * each org — but every status then reads "Connected"; follow it with a full
 * call before trusting statuses.
 */
export function listOrgs(options: { skipConnectionStatus?: boolean } = {}) {
  return invoke<Organization[]>("list_orgs", {
    skipConnectionStatus: options.skipConnectionStatus ?? false,
  });
}

/**
 * Identifies one cancellable CLI run.
 *
 * Cancellation used to be a single global flag that every new command reset,
 * so a Cancel pressed while the CLI was still starting was lost, and cancelling
 * in Developer Tools also killed a terminal command running at the same time.
 */
export function newRunId(): string {
  return crypto.randomUUID();
}

/**
 * Runs a SOQL query. The query travels in a temp file (`--file`), so
 * multi-line queries work on Windows, where `sf.cmd` cannot take arguments
 * containing line breaks.
 */
export function runQuery(username: string, query: string, runId?: string) {
  return invoke<string>("run_query", { username, query, runId: runId ?? null });
}

/** Runs a SOSL search — passed by file for the same reason as `runQuery`. */
export function runSearch(username: string, query: string, runId?: string) {
  return invoke<string>("run_search", {
    username,
    query,
    runId: runId ?? null,
  });
}

export function runCommand(args: string[], input?: string, runId?: string) {
  return invoke<string>("run_command", { args, input, runId: runId ?? null });
}

/**
 * Runs an `sf` command that emits `--json`, validating the response envelope.
 *
 * Use this over `runCommand` for anything passing `--json`: several
 * subcommands report failure *inside* a status-0 response. `sf apex execute`
 * exits 0 when Apex compiles and then throws, so exit-code checking alone
 * reports a failed run as a success.
 */
export function runSfJson(args: string[], input?: string, runId?: string) {
  return invoke<string>("run_sf_json", { args, input, runId: runId ?? null });
}

/**
 * Stops the CLI run started with `runId`, killing its whole process tree.
 * Safe to call before the run has started or after it has finished.
 */
export function cancelSfCommand(runId: string) {
  return invoke<void>("cancel_sf_command", { runId });
}

/**
 * Retrieves the selected metadata from an org, streaming live progress events
 * so callers can render per-type progress. Resolves once all types complete.
 */
export function retrieveMetadataProgress(
  username: string,
  metadata: string[],
  workspaceId?: string | null,
) {
  return invoke<RetrieveResult>("retrieve_metadata_progress", {
    username,
    metadata,
    workspaceId: workspaceId ?? null,
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
