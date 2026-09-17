import type { DeployRecord, DeployReport } from "@/types/generated";

const TERMINAL = ["Succeeded", "SucceededPartial", "Failed", "Canceled"];

/** Whether a job has stopped changing. */
export function isTerminal(status: string, done = false): boolean {
  return (
    done ||
    TERMINAL.some((terminal) => terminal.toLowerCase() === status.toLowerCase())
  );
}

export function succeeded(status: string): boolean {
  return /^Succeeded/i.test(status);
}

/** How long Salesforce keeps a validation available for quick deploy. */
export const QUICK_DEPLOY_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

/**
 * Whether a validation can still be promoted without re-running it: it
 * succeeded, has not been promoted already, and is inside Salesforce's
 * ten-day window.
 */
export function canQuickDeploy(
  record: DeployRecord,
  now = Date.now(),
): boolean {
  return (
    record.checkOnly &&
    record.status === "Succeeded" &&
    !record.promotedBy &&
    now - (record.completedAt ?? record.createdAt) < QUICK_DEPLOY_WINDOW_MS
  );
}

/** Folds a fresh report into its history record. */
export function withReport(
  record: DeployRecord,
  report: DeployReport,
): DeployRecord {
  const done = isTerminal(report.status, report.done);
  return {
    ...record,
    status: report.status,
    done,
    componentsTotal: report.componentsTotal,
    componentsDeployed: report.componentsDeployed,
    componentErrors: report.componentErrors,
    testsTotal: report.testsTotal,
    testsCompleted: report.testsCompleted,
    testErrors: report.testErrors,
    completedAt: done ? (record.completedAt ?? Date.now()) : record.completedAt,
    error: succeeded(report.status)
      ? null
      : (report.errorMessage ??
        report.componentFailures[0]?.problem ??
        report.testFailures[0]?.message ??
        record.error),
  };
}

/** A short line summarising where a job is, for logs and lists. */
export function describeProgress(report: DeployReport): string {
  const parts = [report.status];
  if (report.componentsTotal > 0) {
    parts.push(
      `${report.componentsDeployed}/${report.componentsTotal} components`,
    );
  }
  if (report.testsTotal > 0) {
    parts.push(`${report.testsCompleted}/${report.testsTotal} tests`);
  }
  if (report.componentErrors > 0) {
    parts.push(`${report.componentErrors} component error(s)`);
  }
  if (report.testErrors > 0) {
    parts.push(`${report.testErrors} test failure(s)`);
  }
  return parts.join(" · ");
}
