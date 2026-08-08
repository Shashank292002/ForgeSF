import { invoke } from "@tauri-apps/api/core";

import type { Organization } from "../features/org-manager/types";
import type { MetadataType } from "../features/metadata/types";

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