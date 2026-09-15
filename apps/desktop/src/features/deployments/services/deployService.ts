import { invoke } from "@tauri-apps/api/core";

import type {
  CliInfo,
  DeployOptions,
  DeployRecord,
  DeployReport,
  WorkspaceChanges,
} from "@/types/generated";

/**
 * Deploy jobs. A deploy starts with `--async` and returns at once with its job
 * id; `deployReport` then says how far it has got. See `deployJobsStore` for
 * the polling that turns this into live progress.
 */

export function deployStart(
  username: string,
  workspaceId: string | null,
  options: DeployOptions,
  runId?: string,
) {
  return invoke<DeployRecord>("deploy_start", {
    username,
    workspaceId,
    options,
    runId: runId ?? null,
  });
}

/** Promotes a successful validation without re-running it. */
export function deployQuickStart(
  username: string,
  validationJobId: string,
  workspaceId: string | null,
) {
  return invoke<DeployRecord>("deploy_quick_start", {
    username,
    validationJobId,
    workspaceId,
    runId: null,
  });
}

export function deployReport(
  username: string,
  jobId: string,
  workspaceId: string | null,
) {
  return invoke<DeployReport>("deploy_report", {
    username,
    jobId,
    workspaceId,
  });
}

export function deployCancel(
  username: string,
  jobId: string,
  workspaceId: string | null,
) {
  return invoke<void>("deploy_cancel", { username, jobId, workspaceId });
}

/** Every recorded job, newest first. */
export function deployHistory() {
  return invoke<DeployRecord[]>("deploy_history");
}

/** Files changed since the workspace last matched its org. */
export function workspaceChanges(workspaceId: string | null) {
  return invoke<WorkspaceChanges>("workspace_changes", { workspaceId });
}

/** Takes the current tree as matching the org. */
export function resetWorkspaceBaseline(workspaceId: string | null) {
  return invoke<WorkspaceChanges>("reset_workspace_baseline", {
    workspaceId,
  });
}

/** Whether a usable Salesforce CLI is installed. */
export function cliInfo() {
  return invoke<CliInfo>("cli_info");
}
