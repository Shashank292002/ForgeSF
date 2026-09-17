import { invoke } from "@tauri-apps/api/core";

import type { Dependencies } from "@/types/generated";

/**
 * What the org says a component is connected to, in both directions.
 *
 * The type is required: Salesforce's dependency records cannot be filtered by
 * name, so the name is resolved to an id through that type's own object first.
 */
export function metadataDependencies(
  username: string,
  name: string,
  componentType: string,
  runId?: string,
): Promise<Dependencies> {
  return invoke<Dependencies>("metadata_dependencies", {
    username,
    name,
    componentType,
    runId: runId ?? null,
  });
}

/** The metadata types dependencies can be looked up for. */
export function dependencyTypes(): Promise<string[]> {
  return invoke<string[]>("dependency_types");
}
