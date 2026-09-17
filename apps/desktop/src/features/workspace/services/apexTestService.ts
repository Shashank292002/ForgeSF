import { invoke } from "@tauri-apps/api/core";

import type { ApexTestRun, ApexTestScope } from "@/types/generated";

/**
 * Runs Apex tests in the org and returns results with coverage.
 *
 * `runId` is the same cancel token every other long command uses: cancelling
 * stops ForgeSF waiting, exactly as closing the CLI would. The tests
 * themselves keep running in the org — only Salesforce can stop those.
 */
export function runApexTests(
  username: string,
  scope: ApexTestScope,
  runId?: string,
): Promise<ApexTestRun> {
  return invoke<ApexTestRun>("run_apex_tests", {
    username,
    scope,
    runId: runId ?? null,
  });
}
