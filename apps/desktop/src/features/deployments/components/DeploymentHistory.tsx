import { Clock, CheckCircle2, XCircle, RotateCcw, GitBranch, Tag, User, ChevronDown } from "lucide-react";
import { cls } from "../../../lib/cls";
import type { DeploymentRecord } from "../types";
import styles from "./DeploymentHistory.module.css";

interface DeploymentHistoryProps {
  records: DeploymentRecord[];
  onRollback: (id: string) => void;
  onViewDetails: (id: string) => void;
}

export default function DeploymentHistory({
  records,
  onRollback,
  onViewDetails,
}: DeploymentHistoryProps) {
  if (records.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Clock size={18} />
            <h3>Deployment History</h3>
          </div>
        </div>
        <div className={styles.empty}>
          <GitBranch size={32} />
          <p>No deployments yet</p>
          <span>Run your first deployment to see history here</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Clock size={18} />
          <h3>Deployment History</h3>
          <span className={styles.count}>{records.length} total</span>
        </div>
      </div>

      <div className={styles.list}>
        {records.map((record) => (
          <div key={record.id} className={styles.record}>
            <div className={styles.recordLeft}>
              {/* Version tag */}
              <div className={styles.versionTag}>
                <Tag size={10} />
                <span>{record.version}</span>
              </div>

              {/* Status icon */}
              {record.status === "success" ? (
                <CheckCircle2 size={18} className={styles.successIcon} />
              ) : (
                <XCircle size={18} className={styles.failedIcon} />
              )}
            </div>

            <div className={styles.recordContent}>
              <div className={styles.recordHeader}>
                <span className={styles.recordMessage}>{record.message}</span>
                <span className={styles.recordDuration}>{record.duration}</span>
              </div>

              <div className={styles.recordMeta}>
                <span className={styles.metaItem}>
                  <User size={11} />
                  {record.author}
                </span>
                {record.branch && (
                  <span className={styles.metaItem}>
                    <GitBranch size={11} />
                    {record.branch}
                  </span>
                )}
                <span className={styles.metaItem}>
                  {record.sourceOrg} → {record.targetOrg}
                </span>
                <span className={styles.metaItem}>
                  {record.metadataCount} metadata types
                </span>
                <span className={styles.metaTime}>
                  {record.timestamp}
                </span>
              </div>
            </div>

            <div className={styles.recordActions}>
              <button
                className={styles.actionBtn}
                onClick={() => onViewDetails(record.id)}
                title="View details"
              >
                <ChevronDown size={14} />
              </button>
              {record.status === "success" && (
                <button
                  className={cls(styles.actionBtn, styles.rollbackBtn)}
                  onClick={() => onRollback(record.id)}
                  title="Rollback deployment"
                >
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}