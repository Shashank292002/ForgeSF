import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { Organization } from "../features/org-manager/types";
import type { MetadataType } from "../features/metadata/types";

export interface RetrieveResultItem {
  kind: string;
  status: "completed" | "failed";
  retrieved: number;
  message?: string;
}

export interface RetrieveResult {
  success: boolean;
  summary: string;
  items: RetrieveResultItem[];
  total: number;
  succeeded: number;
  failed: number;
}

export interface RetrieveProgressEvent {
  phase: "item" | "complete";
  index: number;
  total: number;
  kind?: string;
  status?: "running" | "completed" | "failed";
  retrieved: number;
  succeeded: number;
  failed: number;
  message?: string;
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
export function listMetadataComponents(
    metadataType: string,
    username: string
) {
    return invoke<string[]>("list_metadata_components", {
        metadataType,
        username,
    });
}

// Retrieve selected metadata
export function retrieveMetadata(
    metadataTypes: string[],
    username: string
) {
    console.log("Invoking retrieve_metadata", {
        metadataTypes,
        username,
    });

    return invoke<string>("retrieve_metadata", {
        metadataTypes,
        username,
    });
}

export function listWorkspaceFiles() {
    return invoke<string[]>("list_workspace_files");
}

export function readWorkspaceFile(path: string) {
    return invoke<string>(
        "read_workspace_file",
        { path }
    );
}

export function writeWorkspaceFile(path: string, content: string) {
    return invoke<string>(
        "write_workspace_file",
        { path, content }
    );
}

export function deployWorkspace(username: string, checkOnly = false) {
    return invoke<string>("deploy_workspace", {
        username,
        checkOnly,
    });
}

export function runQuery(username: string, query: string) {
    return invoke<string>("run_query", { username, query });
}

export function runCommand(args: string[], input?: string) {
    return invoke<string>("run_command", { args, input });
}

/**
 * Retrieves the selected metadata from an org, streaming live progress events
 * so callers can render per-type progress. Resolves once all types complete.
 */
export function retrieveMetadataProgress(
    username: string,
    metadata: string[]
) {
    return invoke<RetrieveResult>("retrieve_metadata_progress", {
        username,
        metadata,
    });
}

/**
 * Subscribes to live retrieval progress events. Returns a function that
 * unsubscribes.
 */
export function onRetrieveProgress(
    callback: (payload: RetrieveProgressEvent) => void
): Promise<UnlistenFn> {
    return listen<RetrieveProgressEvent>("retrieve_progress", (event) => {
        callback(event.payload);
    });
}