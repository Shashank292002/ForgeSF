import { invoke } from "@tauri-apps/api/core";

import type { WorkspaceId } from "./workspaceService";
import type { ManifestFile } from "@/types/generated";

/** Every `package.xml` in the project: `manifest/` plus one at the root. */
export function listManifests(
  workspaceId?: WorkspaceId,
): Promise<ManifestFile[]> {
  return invoke<ManifestFile[]>("list_manifests", {
    workspaceId: workspaceId ?? null,
  });
}

/**
 * Builds a manifest from local source paths, metadata specs, or both, and
 * writes it into `manifest/`. Resolves with its workspace-relative path.
 */
export function generateManifest(
  name: string,
  sourcePaths?: string[],
  metadata?: string[],
  workspaceId?: WorkspaceId,
): Promise<string> {
  return invoke<string>("generate_manifest", {
    name,
    sourcePaths: sourcePaths ?? null,
    metadata: metadata ?? null,
    workspaceId: workspaceId ?? null,
  });
}

/** Retrieves everything a manifest names. Resolves with the files written. */
export function retrieveManifest(
  username: string,
  manifestPath: string,
  workspaceId?: WorkspaceId,
  runId?: string,
): Promise<string[]> {
  return invoke<string[]>("retrieve_manifest", {
    username,
    manifestPath,
    workspaceId: workspaceId ?? null,
    runId: runId ?? null,
  });
}
