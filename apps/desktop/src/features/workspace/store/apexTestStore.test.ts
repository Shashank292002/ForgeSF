import { beforeEach, describe, expect, it, vi } from "vitest";

import { useApexTestStore } from "./apexTestStore";
import { useOrganizationStore } from "../../../store/orgStore";
import type { ApexTestRun } from "@/types/generated";
import type { Organization } from "../../org-manager/types";

const runApexTests = vi.fn();
const confirm = vi.fn();
const cancelSfCommand = vi.fn();

vi.mock("../services/apexTestService", () => ({
  runApexTests: (...args: unknown[]) => runApexTests(...args),
}));
vi.mock("../../../components/ui/Confirm/confirm", () => ({
  confirm: (...args: unknown[]) => confirm(...args),
}));
vi.mock("../../../services/tauri", () => ({
  newRunId: () => "run-1",
  cancelSfCommand: (...args: unknown[]) => cancelSfCommand(...args),
}));
vi.mock("../../org-manager/lib/orgErrors", () => ({
  offerReauthentication: () => {},
}));

const org = (overrides: Partial<Organization> = {}): Organization => ({
  id: "00D-dev",
  alias: "dev",
  username: "dev@example.com",
  instanceUrl: "https://dev.my.salesforce.com",
  orgType: "Developer",
  isDefault: false,
  status: "Connected",
  ...overrides,
});

const RUN: ApexTestRun = {
  summary: {
    outcome: "Passed",
    testsRan: 1,
    passing: 1,
    failing: 0,
    skipped: 0,
    runTimeMs: 12,
    testRunId: "707",
    runCoverage: "80%",
    orgCoverage: "2%",
  },
  tests: [],
  coverage: [
    {
      name: "AccountService",
      coveredPercent: 80,
      totalLines: 5,
      coveredLines: 4,
      uncovered: [7],
    },
  ],
};

beforeEach(() => {
  runApexTests.mockReset().mockResolvedValue(RUN);
  confirm.mockReset().mockResolvedValue(true);
  cancelSfCommand.mockReset();
  useApexTestStore.setState({
    running: false,
    runId: null,
    run: null,
    error: null,
    orgId: null,
    uncoveredByClass: {},
  });
  useOrganizationStore.setState({ selectedOrganization: org() });
});

describe("apexTestStore", () => {
  it("runs against the selected org and keeps the coverage the editor draws", async () => {
    await useApexTestStore.getState().start({
      level: "RunSpecifiedTests",
      tests: ["AccountServiceTest"],
      suites: null,
    });

    expect(runApexTests).toHaveBeenCalledWith(
      "dev@example.com",
      {
        level: "RunSpecifiedTests",
        tests: ["AccountServiceTest"],
        suites: null,
      },
      "run-1",
    );

    const state = useApexTestStore.getState();
    expect(state.run).toEqual(RUN);
    expect(state.uncoveredByClass).toEqual({ AccountService: [7] });
    expect(state.running).toBe(false);
    expect(state.error).toBeNull();
  });

  it("asks before running every test in a production org", async () => {
    useOrganizationStore.setState({
      selectedOrganization: org({ orgType: "Production" }),
    });
    confirm.mockResolvedValue(false);

    await useApexTestStore
      .getState()
      .start({ level: "RunAllTestsInOrg", tests: null, suites: null });

    expect(confirm).toHaveBeenCalled();
    expect(runApexTests).not.toHaveBeenCalled();
  });

  it("does not ask for a scoped run, even on production", async () => {
    useOrganizationStore.setState({
      selectedOrganization: org({ orgType: "Production" }),
    });

    await useApexTestStore.getState().start({
      level: "RunSpecifiedTests",
      tests: ["AccountServiceTest"],
      suites: null,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(runApexTests).toHaveBeenCalled();
  });

  it("reports a failure and stops running", async () => {
    runApexTests.mockRejectedValue({
      kind: "Failed",
      message: "No tests found.",
    });

    await useApexTestStore
      .getState()
      .start({ level: "RunLocalTests", tests: null, suites: null });

    expect(useApexTestStore.getState().error).toBe("No tests found.");
    expect(useApexTestStore.getState().running).toBe(false);
  });

  it("drops results when the org changes, so coverage is never drawn from another org", () => {
    useApexTestStore.setState({
      run: RUN,
      orgId: "00D-dev",
      uncoveredByClass: { AccountService: [7] },
    });

    useApexTestStore.getState().syncToOrg("00D-dev");
    expect(useApexTestStore.getState().run).not.toBeNull();

    useApexTestStore.getState().syncToOrg("00D-other");
    expect(useApexTestStore.getState().run).toBeNull();
    expect(useApexTestStore.getState().uncoveredByClass).toEqual({});
  });

  it("cancels the run in flight", async () => {
    let finish: (value: ApexTestRun) => void = () => {};
    runApexTests.mockReturnValue(
      new Promise<ApexTestRun>((resolve) => {
        finish = resolve;
      }),
    );

    const pending = useApexTestStore
      .getState()
      .start({ level: "RunLocalTests", tests: null, suites: null });

    expect(useApexTestStore.getState().running).toBe(true);
    useApexTestStore.getState().cancel();
    expect(cancelSfCommand).toHaveBeenCalledWith("run-1");

    finish(RUN);
    await pending;
    expect(useApexTestStore.getState().running).toBe(false);
  });
});
