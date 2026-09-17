import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

import { setPollDelay, useDeployJobsStore } from "./deployJobsStore";
import {
  canQuickDeploy,
  describeProgress,
  isTerminal,
} from "../lib/deployStatus";
import { useToastStore } from "../../../components/ui/Toast/toast";
import type { DeployRecord, DeployReport } from "@/types/generated";

const JOB = "0AfKj00000abcdEFGH";

const record = (overrides: Partial<DeployRecord> = {}): DeployRecord => ({
  jobId: JOB,
  username: "me@acme.com",
  workspaceId: "ws-acme",
  workspaceName: "acme",
  checkOnly: false,
  label: "Whole workspace",
  testLevel: null,
  quickDeployOf: null,
  promotedBy: null,
  status: "Pending",
  done: false,
  createdAt: Date.now(),
  completedAt: null,
  componentsTotal: 0,
  componentsDeployed: 0,
  componentErrors: 0,
  testsTotal: 0,
  testsCompleted: 0,
  testErrors: 0,
  error: null,
  ...overrides,
});

const report = (overrides: Partial<DeployReport> = {}): DeployReport => ({
  jobId: JOB,
  status: "InProgress",
  done: false,
  success: false,
  checkOnly: false,
  componentsTotal: 10,
  componentsDeployed: 0,
  componentErrors: 0,
  testsTotal: 0,
  testsCompleted: 0,
  testErrors: 0,
  componentFailures: [],
  testFailures: [],
  coverage: [],
  coveragePercent: null,
  errorMessage: null,
  deployedFiles: [],
  ...overrides,
});

beforeEach(() => {
  invoke.mockReset();
  setPollDelay(0);
  useDeployJobsStore.setState({
    history: [],
    reports: {},
    errors: {},
    selectedJobId: null,
  });
  useToastStore.setState({ toasts: [] });
});

describe("following a deploy job", () => {
  it("polls until the job finishes and records the outcome", async () => {
    const reports = [
      report({ status: "InProgress", componentsDeployed: 4 }),
      report({ status: "InProgress", componentsDeployed: 9 }),
      report({
        status: "Succeeded",
        done: true,
        success: true,
        componentsDeployed: 10,
      }),
    ];
    invoke.mockImplementation(async (command: string) => {
      if (command === "deploy_start") return record();
      if (command === "deploy_report") return reports.shift();
      throw new Error(`unexpected ${command}`);
    });

    const started = await useDeployJobsStore.getState().start({
      username: "me@acme.com",
      workspaceId: "ws-acme",
      options: {
        scope: { kind: "workspace" },
        checkOnly: false,
        testLevel: null,
        tests: [],
        ignoreWarnings: false,
        label: "Whole workspace",
      },
    });
    const final = await useDeployJobsStore.getState().watch(started);

    expect(final?.status).toBe("Succeeded");
    const state = useDeployJobsStore.getState();
    expect(state.selectedJobId).toBe(JOB);
    expect(state.history[0]).toMatchObject({
      status: "Succeeded",
      done: true,
      componentsDeployed: 10,
    });
    expect(
      invoke.mock.calls.filter(([c]) => c === "deploy_report"),
    ).toHaveLength(3);

    // It finished while being followed, so it is announced — once.
    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({
        tone: "success",
        title: "Deployment succeeded",
        message: "Whole workspace · me@acme.com",
      }),
    ]);
  });

  it("shares one poll between callers watching the same job", async () => {
    invoke.mockResolvedValue(
      report({ status: "Failed", done: true, errorMessage: "No access" }),
    );
    const job = record();

    const [first, second] = await Promise.all([
      useDeployJobsStore.getState().watch(job),
      useDeployJobsStore.getState().watch(job),
    ]);

    expect(first).toBe(second);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(useDeployJobsStore.getState().history[0].error).toBe("No access");
  });

  it("gives up after repeated failures and says why", async () => {
    invoke.mockRejectedValue(new Error("The session has expired."));

    const final = await useDeployJobsStore.getState().watch(record());

    expect(final).toBeNull();
    expect(useDeployJobsStore.getState().errors[JOB]).toBe(
      "The session has expired.",
    );
  });

  it("resumes jobs that were still running when the app closed", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "deploy_history") {
        return [
          record(),
          record({
            jobId: "0AfKj00000doneXYZ1",
            status: "Succeeded",
            done: true,
          }),
        ];
      }
      return report({ status: "Succeeded", done: true, success: true });
    });

    await useDeployJobsStore.getState().loadHistory();
    useDeployJobsStore.getState().resumeRunning();
    await vi.waitFor(() =>
      expect(
        useDeployJobsStore.getState().history.find((r) => r.jobId === JOB)
          ?.done,
      ).toBe(true),
    );

    const polled = invoke.mock.calls.filter(([c]) => c === "deploy_report");
    expect(polled).toHaveLength(1);
    expect(polled[0][1]).toMatchObject({ jobId: JOB });
  });

  it("fetches a finished job's results once, and says why when it cannot", async () => {
    const finished = record({ status: "Failed", done: true });
    useDeployJobsStore.setState({ history: [finished] });
    invoke.mockResolvedValue(
      report({
        status: "Failed",
        done: true,
        componentFailures: [
          {
            componentType: "ApexClass",
            fullName: "AccountService",
            fileName: null,
            problem: "Variable does not exist: acct",
            problemType: "Error",
            line: 42,
            column: 9,
          },
        ],
      }),
    );

    // Two panels asking at once share one CLI call.
    await Promise.all([
      useDeployJobsStore.getState().loadReport(finished),
      useDeployJobsStore.getState().loadReport(finished),
    ]);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(
      useDeployJobsStore.getState().reports[JOB].componentFailures,
    ).toHaveLength(1);

    invoke.mockReset();
    invoke.mockRejectedValue(new Error("INVALID_CROSS_REFERENCE_KEY"));
    useDeployJobsStore.setState({ reports: {} });
    await useDeployJobsStore.getState().loadReport(finished);
    // Once, not the five retries a running job gets.
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(useDeployJobsStore.getState().errors[JOB]).toBe(
      "INVALID_CROSS_REFERENCE_KEY",
    );
    // Reading an old result is not announced.
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("marks the validation promoted after a quick deploy", async () => {
    const validation = record({
      checkOnly: true,
      status: "Succeeded",
      done: true,
    });
    useDeployJobsStore.setState({ history: [validation] });
    invoke.mockImplementation(async (command: string) => {
      if (command === "deploy_quick_start") {
        return record({ jobId: "0AfKj00000quickXYZ", quickDeployOf: JOB });
      }
      return report({
        jobId: "0AfKj00000quickXYZ",
        status: "Succeeded",
        done: true,
      });
    });

    await useDeployJobsStore.getState().quickDeploy(validation);

    const history = useDeployJobsStore.getState().history;
    expect(history.find((r) => r.jobId === JOB)?.promotedBy).toBe(
      "0AfKj00000quickXYZ",
    );
    expect(useDeployJobsStore.getState().selectedJobId).toBe(
      "0AfKj00000quickXYZ",
    );
  });
});

describe("deploy status helpers", () => {
  it("knows which statuses are final", () => {
    expect(isTerminal("SucceededPartial")).toBe(true);
    expect(isTerminal("Canceled")).toBe(true);
    expect(isTerminal("InProgress")).toBe(false);
    expect(isTerminal("Canceling")).toBe(false);
    expect(isTerminal("Canceling", true)).toBe(true);
  });

  it("offers quick deploy only for a fresh, successful, unpromoted validation", () => {
    const now = Date.now();
    const fresh = record({
      checkOnly: true,
      status: "Succeeded",
      done: true,
      completedAt: now,
    });
    expect(canQuickDeploy(fresh, now)).toBe(true);
    expect(canQuickDeploy({ ...fresh, promotedBy: "0AfX" }, now)).toBe(false);
    expect(canQuickDeploy({ ...fresh, checkOnly: false }, now)).toBe(false);
    expect(canQuickDeploy({ ...fresh, status: "Failed" }, now)).toBe(false);
    expect(canQuickDeploy(fresh, now + 11 * 24 * 60 * 60 * 1000)).toBe(false);
  });

  it("summarises progress", () => {
    expect(
      describeProgress(
        report({
          componentsDeployed: 3,
          testsTotal: 20,
          testsCompleted: 5,
          testErrors: 1,
        }),
      ),
    ).toBe("InProgress · 3/10 components · 5/20 tests · 1 test failure(s)");
  });
});
