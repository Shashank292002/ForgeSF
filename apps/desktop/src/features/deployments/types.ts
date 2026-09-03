export interface DeploymentRecord {
  id: string;
  version: string;
  message: string;
  author: string;
  sourceOrg: string;
  targetOrg: string;
  status: "success" | "failed";
  metadataCount: number;
  timestamp: string;
  duration: string;
  branch?: string;
}

export type DeployPhase =
  | "idle"
  | "validating"
  | "building"
  | "deploying"
  | "verifying"
  | "done"
  | "error";

export type PipelineStatus =
  "pending" | "active" | "success" | "failed" | "skipped";

export interface PipelineStep {
  id: string;
  label: string;
  description: string;
  status: PipelineStatus;
  duration?: string;
}
