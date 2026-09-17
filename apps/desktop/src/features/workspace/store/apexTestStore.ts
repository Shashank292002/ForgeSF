import { create } from "zustand";

import { runApexTests } from "../services/apexTestService";
import { useOrganizationStore } from "../../../store/orgStore";
import { protectionPrompt } from "../../org-manager/lib/orgProtection";
import { offerReauthentication } from "../../org-manager/lib/orgErrors";
import { confirm } from "../../../components/ui/Confirm/confirm";
import { errorMessage } from "../../../lib/errors";
import { recordActivity } from "../../../store/activityStore";
import { newRunId, cancelSfCommand } from "../../../services/tauri";
import type { ApexTestRun, ApexTestScope } from "@/types/generated";

/**
 * The last Apex test run: what was asked for, what came back, and the coverage
 * the editor draws in its gutter.
 *
 * Kept outside the workspace store because it belongs to the org, not the
 * folder: switching workspaces does not invalidate a run, switching orgs does.
 */

export type TestLevel = ApexTestScope["level"];

interface ApexTestState {
  running: boolean;
  /** The run in flight, so Cancel can stop waiting on it. */
  runId: string | null;
  run: ApexTestRun | null;
  error: string | null;
  /** The org the current results came from; cleared when it changes. */
  orgId: string | null;
  /** Class name → line numbers the last run never reached. */
  uncoveredByClass: Record<string, number[]>;

  start: (scope: ApexTestScope) => Promise<void>;
  cancel: () => void;
  clear: () => void;
  /** Drops results that belong to another org. */
  syncToOrg: (orgId: string | null) => void;
}

function uncoveredByClass(run: ApexTestRun): Record<string, number[]> {
  const byClass: Record<string, number[]> = {};
  for (const item of run.coverage) byClass[item.name] = item.uncovered;
  return byClass;
}

export const useApexTestStore = create<ApexTestState>((set, get) => ({
  running: false,
  runId: null,
  run: null,
  error: null,
  orgId: null,
  uncoveredByClass: {},

  start: async (scope) => {
    if (get().running) return;

    const org = useOrganizationStore.getState().selectedOrganization;
    if (!org) {
      set({ error: "Connect an org before running tests." });
      return;
    }

    // Tests roll back their own data, but `RunAllTestsInOrg` against
    // production is a long, heavy job someone should choose deliberately.
    if (scope.level === "RunAllTestsInOrg") {
      const prompt = protectionPrompt(
        org,
        "Run every Apex test",
        "Run all tests",
      );
      if (prompt && !(await confirm(prompt))) return;
    }

    const runId = newRunId();
    set({ running: true, runId, error: null });

    try {
      const run = await runApexTests(org.username, scope, runId);
      set({
        run,
        orgId: org.id,
        uncoveredByClass: uncoveredByClass(run),
        error: null,
      });
      recordActivity({
        kind: run.summary.failing > 0 ? "error" : "success",
        source: "tests",
        title: `${run.summary.passing}/${run.summary.testsRan} Apex tests passed`,
        detail: run.summary.runCoverage
          ? `${run.summary.runCoverage} coverage`
          : undefined,
        org: org.alias,
      });
    } catch (error) {
      const message = errorMessage(error, "The test run failed.");
      set({ error: message });
      recordActivity({
        kind: "error",
        source: "tests",
        title: "Apex test run failed",
        detail: message,
        org: org.alias,
      });
      offerReauthentication(error, org);
    } finally {
      set({ running: false, runId: null });
    }
  },

  cancel: () => {
    const { runId } = get();
    if (runId) cancelSfCommand(runId);
  },

  clear: () =>
    set({ run: null, error: null, uncoveredByClass: {}, orgId: null }),

  syncToOrg: (orgId) => {
    // Coverage from one org drawn over another org's source would be a lie.
    if (get().orgId && get().orgId !== orgId) {
      set({ run: null, error: null, uncoveredByClass: {}, orgId: null });
    }
  },
}));
