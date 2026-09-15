import { create } from "zustand";

import type {
  DeployOptions,
  DeployRecord,
  DeployReport,
} from "@/types/generated";
import {
  deployCancel,
  deployHistory,
  deployQuickStart,
  deployReport,
  deployStart,
} from "../services/deployService";
import { isTerminal, withReport } from "../lib/deployStatus";
import { jobKind, statusLabel } from "../lib/deployForm";
import { toast } from "../../../components/ui/Toast/toast";
import { useOrganizationStore } from "../../../store/orgStore";

/**
 * Says how a job ended, whichever page is open: jobs run in the background,
 * and a deploy started from the Workspace can finish while you are elsewhere.
 */
function announceFinished(record: DeployRecord, report: DeployReport) {
  const org =
    useOrganizationStore
      .getState()
      .organizations.find((item) => item.username === record.username)?.alias ??
    record.username;
  const title = `${jobKind(record)} ${statusLabel(report.status).toLowerCase()}`;
  const where = `${record.label} · ${org}`;
  const problem =
    report.errorMessage ??
    report.componentFailures[0]?.problem ??
    report.testFailures[0]?.message;

  switch (report.status) {
    case "Succeeded":
      toast.success(where, { title });
      break;
    case "SucceededPartial":
      toast.warning(problem ? `${where}\n${problem}` : where, { title });
      break;
    case "Failed":
      toast.error(problem ? `${where}\n${problem}` : where, { title });
      break;
    default:
      toast.info(where, { title });
  }
}

interface DeployJobsState {
  /** Every recorded job, newest first. Kept by Rust across restarts. */
  history: DeployRecord[];
  /** The latest report per job id. */
  reports: Record<string, DeployReport>;
  /** Why a job's progress could not be read, per job id. */
  errors: Record<string, string>;
  /** The job shown in the Deployments page's detail panel. */
  selectedJobId: string | null;

  loadHistory: () => Promise<void>;
  /** Starts a deploy or validation and begins following it. */
  start: (input: {
    username: string;
    workspaceId: string | null;
    options: DeployOptions;
  }) => Promise<DeployRecord>;
  /** Promotes a successful validation without re-running it. */
  quickDeploy: (validation: DeployRecord) => Promise<DeployRecord>;
  cancel: (record: DeployRecord) => Promise<void>;
  /**
   * Follows a job until it finishes. Resolves with its final report, or null
   * when progress stopped being readable. Watching the same job twice shares
   * one poll.
   */
  watch: (record: DeployRecord) => Promise<DeployReport | null>;
  /**
   * Fetches a job's results once, for a job finished before this session.
   * A running job is followed instead.
   */
  loadReport: (record: DeployRecord) => Promise<void>;
  /** Resumes following every job that was still running. */
  resumeRunning: () => void;
  select: (jobId: string | null) => void;
}

/** Delay between status checks. Each check starts the CLI, so not too eager. */
let pollDelayMs = 4000;

/** Consecutive failed status checks before a job is left alone. */
const MAX_POLL_FAILURES = 5;

/** For tests: poll without waiting. */
export function setPollDelay(ms: number) {
  pollDelayMs = ms;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const watchers = new Map<string, Promise<DeployReport | null>>();
/** Finished jobs whose results are being fetched. */
const reportRequests = new Set<string>();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const useDeployJobsStore = create<DeployJobsState>((set, get) => {
  function upsertRecord(record: DeployRecord) {
    set((state) => {
      const exists = state.history.some((item) => item.jobId === record.jobId);
      const history = exists
        ? state.history.map((item) =>
            item.jobId === record.jobId ? record : item,
          )
        : [record, ...state.history];
      return { history };
    });
  }

  /** Fetches one report and folds it into the job's record. */
  async function fetchReport(record: DeployRecord): Promise<DeployReport> {
    const report = await deployReport(
      record.username,
      record.jobId,
      record.workspaceId,
    );
    const current =
      get().history.find((item) => item.jobId === record.jobId) ?? record;
    upsertRecord(withReport(current, report));
    set((state) => {
      const errors = { ...state.errors };
      delete errors[record.jobId];
      return {
        reports: { ...state.reports, [record.jobId]: report },
        errors,
      };
    });
    return report;
  }

  async function follow(record: DeployRecord): Promise<DeployReport | null> {
    let failures = 0;
    let latest: DeployReport | null = null;

    for (;;) {
      try {
        const report = await fetchReport(record);
        failures = 0;
        latest = report;
        if (isTerminal(report.status, report.done)) {
          // Only a job seen running: reopening an old result is not news.
          if (!record.done) announceFinished(record, report);
          return report;
        }
      } catch (error) {
        failures += 1;
        if (failures >= MAX_POLL_FAILURES) {
          set((state) => ({
            errors: { ...state.errors, [record.jobId]: errorMessage(error) },
          }));
          return latest;
        }
      }
      await sleep(pollDelayMs);
    }
  }

  return {
    history: [],
    reports: {},
    errors: {},
    selectedJobId: null,

    loadHistory: async () => {
      const history = await deployHistory();
      set({ history });
    },

    start: async ({ username, workspaceId, options }) => {
      const record = await deployStart(username, workspaceId, options);
      upsertRecord(record);
      set({ selectedJobId: record.jobId });
      void get().watch(record);
      return record;
    },

    quickDeploy: async (validation) => {
      const record = await deployQuickStart(
        validation.username,
        validation.jobId,
        validation.workspaceId,
      );
      upsertRecord(record);
      upsertRecord({ ...validation, promotedBy: record.jobId });
      set({ selectedJobId: record.jobId });
      void get().watch(record);
      return record;
    },

    cancel: async (record) => {
      await deployCancel(record.username, record.jobId, record.workspaceId);
      const current =
        get().history.find((item) => item.jobId === record.jobId) ?? record;
      if (!current.done) upsertRecord({ ...current, status: "Canceling" });
    },

    watch: (record) => {
      const existing = watchers.get(record.jobId);
      if (existing) return existing;
      const watching = follow(record).finally(() => {
        watchers.delete(record.jobId);
      });
      watchers.set(record.jobId, watching);
      return watching;
    },

    loadReport: async (record) => {
      if (!record.done) {
        void get().watch(record);
        return;
      }
      if (watchers.has(record.jobId) || reportRequests.has(record.jobId)) {
        return;
      }
      reportRequests.add(record.jobId);
      try {
        await fetchReport(record);
      } catch (error) {
        set((state) => ({
          errors: { ...state.errors, [record.jobId]: errorMessage(error) },
        }));
      } finally {
        reportRequests.delete(record.jobId);
      }
    },

    resumeRunning: () => {
      for (const record of get().history) {
        if (!record.done) void get().watch(record);
      }
    },

    select: (jobId) => set({ selectedJobId: jobId }),
  };
});
