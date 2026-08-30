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
    status: "running" | "completed" | "failed";
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
    success: boolean;
    summary: string;
    items: RetrieveTypeResult[];
    total: number;
    succeeded: number;
    failed: number;
}

/** The retrieval overlay can run as a focused page or as a workspace overlay. */
export type RetrieveMode = "page" | "overlay";