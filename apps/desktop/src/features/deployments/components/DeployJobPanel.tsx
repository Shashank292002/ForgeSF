import { useMemo } from "react";
import {
  AlertTriangle,
  Ban,
  FileWarning,
  FlaskConical,
  Gauge,
  Loader2,
  RefreshCw,
  Rocket,
  Zap,
} from "lucide-react";

import type { DeployRecord, DeployReport } from "@/types/generated";
import { Badge, Button } from "../../../components/ui";
import { cls } from "../../../lib/cls";
import { canQuickDeploy, QUICK_DEPLOY_WINDOW_MS } from "../lib/deployStatus";
import {
  TEST_LEVELS,
  formatDuration,
  jobKind,
  percent,
  statusLabel,
  statusTone,
} from "../lib/deployForm";
import styles from "./DeployJobPanel.module.css";

interface DeployJobPanelProps {
  record: DeployRecord | null;
  report: DeployReport | undefined;
  /** Why the job's progress could not be read. */
  reportError: string | undefined;
  orgAlias: string;
  /** The current time, ticking while a job runs. */
  now: number;
  /** Set while a cancel or quick deploy request is being sent. */
  acting: "cancel" | "quick" | null;
  actionError: string | null;
  onCancel: () => void;
  onQuickDeploy: () => void;
  onLoadReport: () => void;
}

/** Salesforce requires this much coverage per class for production. */
const COVERAGE_TARGET = 75;

function Progress({
  label,
  done,
  failed,
  total,
}: {
  label: string;
  done: number;
  failed: number;
  total: number;
}) {
  return (
    <div className={styles.progress}>
      <div className={styles.progressHead}>
        <span>{label}</span>
        <span className={styles.progressCount}>
          {done + failed}/{total}
          {failed > 0 && (
            <span className={styles.failed}> · {failed} failed</span>
          )}
        </span>
      </div>
      <div
        className={styles.bar}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done + failed}
      >
        <span
          className={styles.barDone}
          style={{ width: `${percent(done, total)}%` }}
        />
        <span
          className={styles.barFailed}
          style={{ width: `${percent(failed, total)}%` }}
        />
      </div>
    </div>
  );
}

/** Progress and results of the selected deploy job. */
export default function DeployJobPanel({
  record,
  report,
  reportError,
  orgAlias,
  now,
  acting,
  actionError,
  onCancel,
  onQuickDeploy,
  onLoadReport,
}: DeployJobPanelProps) {
  const coverage = useMemo(
    () =>
      [...(report?.coverage ?? [])]
        .map((entry) => ({
          ...entry,
          covered: percent(
            entry.totalLines - entry.uncoveredLines,
            entry.totalLines,
          ),
        }))
        .sort((a, b) => a.covered - b.covered || a.name.localeCompare(b.name)),
    [report],
  );

  if (!record) {
    return (
      <section className={cls(styles.card, styles.empty)}>
        <Rocket size={28} />
        <p>No deployments yet</p>
        <span>
          Validate or deploy to follow its progress here. Jobs keep running in
          the org if you close ForgeSF, and pick up again when you reopen it.
        </span>
      </section>
    );
  }

  const running = !record.done;
  const quickDeployable = canQuickDeploy(record, now);
  const level =
    TEST_LEVELS.find((item) => item.value === (record.testLevel ?? ""))
      ?.label ?? record.testLevel;
  const finishedAt = record.completedAt ?? now;
  const componentFailures = report?.componentFailures ?? [];
  const testFailures = report?.testFailures ?? [];

  return (
    <section className={styles.card} aria-live="polite">
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <Badge tone={statusTone(record.status)} dot>
            {statusLabel(record.status)}
          </Badge>
          <span className={styles.kind}>{jobKind(record)}</span>
        </div>
        <div className={styles.actions}>
          {running && (
            <Button
              variant="danger"
              size="sm"
              leftIcon={<Ban size={14} />}
              loading={acting === "cancel"}
              disabled={acting !== null || record.status === "Canceling"}
              onClick={onCancel}
            >
              Cancel
            </Button>
          )}
          {quickDeployable && (
            <Button
              variant="gradient"
              size="sm"
              leftIcon={<Zap size={14} />}
              loading={acting === "quick"}
              disabled={acting !== null}
              title="Deploy the validated components without running the tests again"
              onClick={onQuickDeploy}
            >
              Quick deploy
            </Button>
          )}
        </div>
      </header>

      <h3 className={styles.title} title={record.label}>
        {record.label}
      </h3>

      <dl className={styles.meta}>
        <div>
          <dt>Org</dt>
          <dd>{orgAlias}</dd>
        </div>
        <div>
          <dt>Workspace</dt>
          <dd>{record.workspaceName || "—"}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{new Date(record.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>{running ? "Running for" : "Took"}</dt>
          <dd>{formatDuration(finishedAt - record.createdAt)}</dd>
        </div>
        <div>
          <dt>Tests</dt>
          <dd>{level ?? "Org default"}</dd>
        </div>
        <div>
          <dt>Job id</dt>
          <dd className={styles.mono}>{record.jobId}</dd>
        </div>
      </dl>

      {(record.componentsTotal > 0 || running) && (
        <Progress
          label="Components"
          done={record.componentsDeployed}
          failed={record.componentErrors}
          total={record.componentsTotal}
        />
      )}
      {record.testsTotal > 0 && (
        <Progress
          label="Apex tests"
          done={record.testsCompleted}
          failed={record.testErrors}
          total={record.testsTotal}
        />
      )}

      {running && (
        <p className={styles.note}>
          <Loader2 size={13} className={styles.spin} />
          Checking progress every few seconds.
        </p>
      )}

      {record.quickDeployOf && (
        <p className={styles.note}>
          Promoted from validation{" "}
          <span className={styles.mono}>{record.quickDeployOf}</span>.
        </p>
      )}
      {record.promotedBy && (
        <p className={styles.note}>
          Quick deployed as job{" "}
          <span className={styles.mono}>{record.promotedBy}</span>.
        </p>
      )}
      {quickDeployable && (
        <p className={styles.note}>
          Salesforce allows a quick deploy until{" "}
          {new Date(
            (record.completedAt ?? record.createdAt) + QUICK_DEPLOY_WINDOW_MS,
          ).toLocaleDateString()}{" "}
          if the tests met its coverage rules — with specified tests, 75% of
          each class deployed — and nothing else is deployed to the org first.
        </p>
      )}

      {record.error && !running && (
        <div className={styles.errorBox} role="alert">
          <AlertTriangle size={15} />
          <span>{record.error}</span>
        </div>
      )}
      {actionError && (
        <div className={styles.errorBox} role="alert">
          <AlertTriangle size={15} />
          <span>{actionError}</span>
        </div>
      )}
      {reportError && (
        <div className={styles.warningBox}>
          <FileWarning size={15} />
          <span>Could not read the results: {reportError}</span>
          <button
            type="button"
            className={styles.linkButton}
            onClick={onLoadReport}
          >
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}

      {componentFailures.length > 0 && (
        <details className={styles.details} open>
          <summary>
            <FileWarning size={14} />
            Component errors
            <span className={styles.count}>{componentFailures.length}</span>
          </summary>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <colgroup>
                <col className={styles.colName} />
                <col className={styles.colLine} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Line</th>
                  <th>Problem</th>
                </tr>
              </thead>
              <tbody>
                {componentFailures.map((failure, index) => (
                  <tr
                    key={`${failure.componentType}-${failure.fullName}-${index}`}
                  >
                    <td>
                      <span className={styles.type}>
                        {failure.componentType}
                      </span>
                      <span
                        className={styles.mono}
                        title={failure.fileName ?? undefined}
                      >
                        {failure.fullName}
                      </span>
                    </td>
                    <td className={styles.mono}>
                      {failure.line
                        ? `${failure.line}${failure.column ? `:${failure.column}` : ""}`
                        : "—"}
                    </td>
                    <td className={styles.problemCell}>{failure.problem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {testFailures.length > 0 && (
        <details className={styles.details} open>
          <summary>
            <FlaskConical size={14} />
            Test failures
            <span className={styles.count}>{testFailures.length}</span>
          </summary>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <colgroup>
                <col className={styles.colName} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {testFailures.map((failure, index) => (
                  <tr
                    key={`${failure.className}-${failure.methodName}-${index}`}
                  >
                    <td className={styles.mono}>
                      {failure.className}.{failure.methodName}
                    </td>
                    <td className={styles.problemCell}>
                      {failure.message}
                      {failure.stackTrace && (
                        <pre className={styles.stack}>{failure.stackTrace}</pre>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {coverage.length > 0 && (
        <details className={styles.details}>
          <summary>
            <Gauge size={14} />
            Code coverage
            <span className={styles.count}>
              {report?.coveragePercent != null
                ? `${report.coveragePercent}%`
                : coverage.length}
            </span>
          </summary>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <colgroup>
                <col />
                <col className={styles.colNumber} />
                <col className={styles.colNumber} />
              </colgroup>
              <thead>
                <tr>
                  <th>Class or trigger</th>
                  <th>Lines</th>
                  <th>Covered</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((entry) => (
                  <tr key={entry.name}>
                    <td className={styles.mono}>{entry.name}</td>
                    <td className={styles.mono}>
                      {entry.totalLines - entry.uncoveredLines}/
                      {entry.totalLines}
                    </td>
                    <td
                      className={cls(
                        styles.mono,
                        entry.totalLines > 0 &&
                          entry.covered < COVERAGE_TARGET &&
                          styles.lowCoverage,
                      )}
                    >
                      {entry.totalLines > 0 ? `${entry.covered}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {!report && !reportError && record.done && (
        <p className={styles.note}>
          <Loader2 size={13} className={styles.spin} />
          Loading results…
        </p>
      )}
    </section>
  );
}
