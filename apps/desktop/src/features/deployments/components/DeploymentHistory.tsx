import {
  Ban,
  CheckCircle2,
  CircleAlert,
  Clock,
  FolderGit2,
  GitBranch,
  Loader2,
  XCircle,
} from "lucide-react";

import type { DeployRecord } from "@/types/generated";
import { cls } from "../../../lib/cls";
import {
  formatDuration,
  jobKind,
  statusLabel,
  statusTone,
} from "../lib/deployForm";
import styles from "./DeploymentHistory.module.css";

interface DeploymentHistoryProps {
  records: DeployRecord[];
  selectedJobId: string | null;
  onSelect: (jobId: string) => void;
  /** The display name of the org a job ran against. */
  orgAlias: (username: string) => string;
}

function StatusIcon({ record }: { record: DeployRecord }) {
  if (!record.done) {
    return <Loader2 size={18} className={cls(styles.info, styles.spin)} />;
  }
  switch (statusTone(record.status)) {
    case "success":
      return <CheckCircle2 size={18} className={styles.successIcon} />;
    case "warning":
      return <CircleAlert size={18} className={styles.warningIcon} />;
    case "error":
      return <XCircle size={18} className={styles.failedIcon} />;
    default:
      return <Ban size={18} className={styles.mutedIcon} />;
  }
}

/**
 * Every deploy, validation and quick deploy, newest first.
 *
 * Kept on disk by the backend, so it survives restarts — the list used to be
 * held in page state and was gone on closing ForgeSF, taking job ids with it.
 */
export default function DeploymentHistory({
  records,
  selectedJobId,
  onSelect,
  orgAlias,
}: DeploymentHistoryProps) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Clock size={18} />
          <h3>History</h3>
          {records.length > 0 && (
            <span className={styles.count}>{records.length}</span>
          )}
        </div>
      </div>

      {records.length === 0 ? (
        <div className={styles.empty}>
          <GitBranch size={32} />
          <p>No deployments yet</p>
          <span>Validations and deployments are listed here, with results</span>
        </div>
      ) : (
        <ul className={styles.list}>
          {records.map((record) => {
            const selected = record.jobId === selectedJobId;
            const counts = [
              record.componentsTotal > 0 &&
                `${record.componentsDeployed}/${record.componentsTotal} components`,
              record.testsTotal > 0 &&
                `${record.testsCompleted}/${record.testsTotal} tests`,
            ].filter(Boolean);
            return (
              <li key={record.jobId}>
                <button
                  type="button"
                  className={cls(styles.record, selected && styles.selected)}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => onSelect(record.jobId)}
                >
                  <span className={styles.recordLeft}>
                    <StatusIcon record={record} />
                  </span>

                  <span className={styles.recordContent}>
                    <span className={styles.recordHeader}>
                      <span className={styles.recordMessage}>
                        {jobKind(record)} · {record.label}
                      </span>
                      <span className={styles.recordStatus}>
                        {statusLabel(record.status)}
                      </span>
                    </span>

                    <span className={styles.recordMeta}>
                      <span className={styles.metaItem}>
                        {orgAlias(record.username)}
                      </span>
                      {record.workspaceName && (
                        <span className={styles.metaItem}>
                          <FolderGit2 size={11} />
                          {record.workspaceName}
                        </span>
                      )}
                      {counts.length > 0 && (
                        <span className={styles.metaItem}>
                          {counts.join(" · ")}
                        </span>
                      )}
                      {record.error && record.done && (
                        <span
                          className={cls(styles.metaItem, styles.metaError)}
                          title={record.error}
                        >
                          {record.error}
                        </span>
                      )}
                      <span className={styles.metaTime}>
                        {new Date(record.createdAt).toLocaleString()}
                        {record.completedAt != null &&
                          ` · ${formatDuration(record.completedAt - record.createdAt)}`}
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
