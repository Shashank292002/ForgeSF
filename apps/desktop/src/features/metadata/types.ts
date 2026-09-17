export interface MetadataType {
  xmlName: string;
  directoryName: string;
  suffix: string | null;
  inFolder: boolean;
  metaFile: boolean;
  childXmlNames: string[];
}

/** Progress row shown while metadata is being retrieved. */
export interface RetrieveProgressEntry {
  kind: string;
  /** "skipped" marks a type the run never reached because it was cancelled. */
  status: "running" | "completed" | "failed" | "skipped";
  retrieved: number;
  message: string;
  warnings?: string[];
}

/** Outcome of a completed retrieval for a single metadata type. */
export interface RetrieveTypeResult {
  kind: string;
  /** `skipped`: not attempted, because the run was cancelled first. */
  status: "completed" | "failed" | "skipped";
  retrieved: number;
  message: string | null;
  /**
   * Problems reported without failing the retrieve — typically a requested
   * component that does not exist in the org.
   */
  warnings: string[];
}

/** Aggregated outcome of a retrieve run. */
export interface RetrieveResult {
  /** True when the run stopped early because the user cancelled it. */
  cancelled: boolean;
  success: boolean;
  summary: string;
  items: RetrieveTypeResult[];
  total: number;
  succeeded: number;
  failed: number;
}

/** The retrieval overlay can run as a focused page or as a workspace overlay. */
export type RetrieveMode = "page" | "overlay";
