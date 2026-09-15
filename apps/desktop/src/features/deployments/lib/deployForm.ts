import type { DeployRecord } from "@/types/generated";

import type { BadgeTone } from "../../../components/ui/Badge/Badge";

/**
 * What a deploy from the Deployments page sends. `paths` is the selection an
 * explorer "Validate…" brought along.
 */
export type ScopeKind = "workspace" | "changed" | "paths" | "metadata";

/** `""` leaves the choice to the org. */
export type TestLevelValue =
  | ""
  | "NoTestRun"
  | "RunSpecifiedTests"
  | "RunLocalTests"
  | "RunAllTestsInOrg"
  | "RunRelevantTests";

export const TEST_LEVELS: Array<{
  value: TestLevelValue;
  label: string;
  hint: string;
}> = [
  {
    value: "",
    label: "Org default",
    hint: "A validation runs local tests. A deploy runs none in a sandbox; in production, local tests run when it includes Apex.",
  },
  {
    value: "NoTestRun",
    label: "No tests",
    hint: "Sandboxes only. Production and validations always run tests.",
  },
  {
    value: "RunSpecifiedTests",
    label: "Specified tests",
    hint: "Only the test classes you list. Each class and trigger deployed needs 75% coverage.",
  },
  {
    value: "RunLocalTests",
    label: "Local tests",
    hint: "Every test in the org except those from managed packages.",
  },
  {
    value: "RunAllTestsInOrg",
    label: "All tests",
    hint: "Every test in the org, managed packages included.",
  },
  {
    value: "RunRelevantTests",
    label: "Relevant tests",
    hint: "Tests Salesforce judges relevant to the deployed components.",
  },
];

/** Test class names typed as a list: commas, spaces or new lines. */
export function parseTestNames(input: string): string[] {
  const names = input
    .split(/[\s,;]+/)
    .map((name) => name.trim())
    .filter(Boolean);
  return [...new Set(names)];
}

const TEST_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.]*$/;

/**
 * Why the form cannot be submitted as a validation or deploy, or null.
 * Mirrors the backend's checks, so the problem shows before the CLI starts.
 */
export function deployFormProblem(input: {
  checkOnly: boolean;
  testLevel: TestLevelValue;
  tests: string[];
  scope: ScopeKind;
  changedCount: number;
  pathsCount: number;
  metadataCount: number;
}): string | null {
  if (input.scope === "changed" && input.changedCount === 0) {
    return "No modified or added files to deploy.";
  }
  if (input.scope === "paths" && input.pathsCount === 0) {
    return "Select files in the Workspace explorer, then choose Validate… there.";
  }
  if (input.scope === "metadata" && input.metadataCount === 0) {
    return "Pick at least one metadata type.";
  }
  if (input.checkOnly && input.testLevel === "NoTestRun") {
    return "A validation has to run tests — pick another test level.";
  }
  if (input.testLevel === "RunSpecifiedTests") {
    if (input.tests.length === 0) {
      return "List at least one test class to run.";
    }
    const bad = input.tests.find((name) => !TEST_NAME.test(name));
    if (bad) return `"${bad}" is not a valid Apex test class name.`;
  }
  return null;
}

/** A short label for history, e.g. "3 changed files" or "ApexClass, Flow". */
export function scopeLabel(
  scope: ScopeKind,
  counts: { changed: number; metadata: string[]; paths?: string[] },
): string {
  switch (scope) {
    case "workspace":
      return "Whole workspace";
    case "changed":
      return `${counts.changed} changed file${counts.changed === 1 ? "" : "s"}`;
    case "paths": {
      // Named like an explorer deploy: the path itself, or a count.
      const paths = counts.paths ?? [];
      return paths.length === 1 ? paths[0] : `${paths.length} items`;
    }
    case "metadata":
      return counts.metadata.length <= 3
        ? counts.metadata.join(", ")
        : `${counts.metadata.length} metadata types`;
  }
}

export function jobKind(record: DeployRecord): string {
  if (record.quickDeployOf) return "Quick deploy";
  return record.checkOnly ? "Validation" : "Deployment";
}

const STATUS_LABELS: Record<string, string> = {
  Pending: "Queued",
  InProgress: "In progress",
  Succeeded: "Succeeded",
  SucceededPartial: "Partly succeeded",
  Failed: "Failed",
  Canceling: "Cancelling",
  Canceled: "Cancelled",
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case "Succeeded":
      return "success";
    case "SucceededPartial":
    case "Canceling":
      return "warning";
    case "Failed":
      return "error";
    case "Canceled":
      return "default";
    default:
      return "info";
  }
}

/** "4s", "3m 20s", "1h 05m". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Share of `part` in `total` as a whole percentage, clamped to 0–100. */
export function percent(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((part / total) * 100)));
}
