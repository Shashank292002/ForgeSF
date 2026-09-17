import type { DeployRecord } from "@/types/generated";

import type { BadgeTone } from "../../../components/ui/Badge/Badge";

/**
 * What a deploy from the Deployments page sends. `paths` is the selection an
 * explorer "Validate…" brought along.
 */
export type ScopeKind = "workspace" | "changed" | "paths" | "metadata";

// The levels live in `lib/testLevels` so Settings, the deploy form and the
// Apex test panel name them the same way. Re-exported here because this is
// where the deploy form has always imported them from.
export {
  TEST_LEVELS,
  COVERAGE_TARGET,
  type TestLevelValue,
} from "../../../lib/testLevels";
import type { TestLevelValue } from "../../../lib/testLevels";

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
  /** Metadata scope: the org the components are taken from. */
  sourceUsername?: string | null;
  /** Metadata scope: the org they are deployed to, to catch source = target. */
  targetUsername?: string | null;
  /**
   * Metadata scope: selected types that must name their members (folder and
   * child types) and have none in the source org. Sending one fails in the
   * CLI, so it is caught here with the type named.
   */
  emptyTypes?: string[];
}): string | null {
  if (input.scope === "changed" && input.changedCount === 0) {
    return "No modified or added files to deploy.";
  }
  if (input.scope === "paths" && input.pathsCount === 0) {
    return "Select files in the Workspace explorer, then choose Validate… there.";
  }
  if (input.scope === "metadata") {
    if (!input.sourceUsername) {
      return "Choose the org to take the components from.";
    }
    if (input.targetUsername && input.sourceUsername === input.targetUsername) {
      return "The source and target orgs are the same. Choose a different target.";
    }
    if (input.metadataCount === 0) {
      return "Pick at least one metadata type.";
    }
    const empty = input.emptyTypes ?? [];
    if (empty.length > 0) {
      return empty.length === 1
        ? `The source org has no ${empty[0]} components. Clear that type or pick another.`
        : `The source org has no components of ${empty.length} selected types (${empty.slice(0, 3).join(", ")}…). Clear them or pick others.`;
    }
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
  counts: {
    changed: number;
    metadata: string[];
    paths?: string[];
    /** Metadata scope: how many components the selection sends, when known. */
    components?: number;
  },
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
    case "metadata": {
      const types =
        counts.metadata.length <= 3
          ? counts.metadata.join(", ")
          : `${counts.metadata.length} metadata types`;
      // Now that components can be picked one by one, the type names alone no
      // longer say what went out: "ApexClass" could be one class or four
      // hundred.
      const components = counts.components;
      if (components === undefined || components <= 0) return types;
      return `${types} (${components} component${components === 1 ? "" : "s"})`;
    }
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
