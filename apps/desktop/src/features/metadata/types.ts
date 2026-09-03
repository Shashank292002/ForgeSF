export interface MetadataType {
  xmlName: string;
  directoryName: string;
  suffix?: string;
  inFolder: boolean;
  metaFile: boolean;
  childXmlNames: string[];
}

export interface MetadataRetrieveResult {
  success: boolean;

  message: string;

  files?: string[];
}

/** Progress row shown while metadata is being retrieved. */
export interface RetrieveProgressEntry {
  kind: string;
  /** "cancelled" marks a type skipped because the run was stopped early. */
  status: "running" | "completed" | "failed" | "cancelled";
  retrieved: number;
  message: string;
}

/** Outcome of a completed retrieval for a single metadata type. */
export interface RetrieveTypeResult {
  kind: string;
  status: "completed" | "failed";
  retrieved: number;
  message?: string;
}

/** Aggregated outcome of a retrieve run. */
export interface RetrieveResult {
  /** True when the run stopped early because the user cancelled it. */
  cancelled?: boolean;
  success: boolean;
  summary: string;
  items: RetrieveTypeResult[];
  total: number;
  succeeded: number;
  failed: number;
}

/** The retrieval overlay can run as a focused page or as a workspace overlay. */
export type RetrieveMode = "page" | "overlay";
