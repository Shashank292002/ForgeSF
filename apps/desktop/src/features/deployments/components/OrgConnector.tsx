import { useState, useEffect } from "react";
import { Cloud, FolderGit2, Zap, CircleDot, AlertTriangle } from "lucide-react";
import type { Organization } from "../../org-manager/types";
import type { Workspace } from "../../workspace/types";
import { cls } from "../../../lib/cls";
import styles from "./OrgConnector.module.css";

interface OrgConnectorProps {
  /** The local workspace that will be deployed. */
  workspace: Workspace | null;
  /** The org that owns `workspace`, when it is connected. */
  workspaceOrg: Organization | null;
  organizations: Organization[];
  targetOrg: Organization | null;
  onTargetChange: (org: Organization | null) => void;
}

/**
 * What goes where: the local workspace on the left, the target org on the
 * right.
 *
 * This used to offer a "Source Org" picker, but the source only chose which
 * org's type list to show — the deploy always sent the local workspace, which
 * could belong to a third org entirely. The left side now shows exactly what
 * is sent.
 */
export default function OrgConnector({
  workspace,
  workspaceOrg,
  organizations,
  targetOrg,
  onTargetChange,
}: OrgConnectorProps) {
  const connected = Boolean(workspace && targetOrg);
  const crossOrg = Boolean(
    workspace?.orgId && targetOrg && workspace.orgId !== targetOrg.id,
  );

  // `settled` is the only real state: whether the plug-in animation has
  // finished. Everything else is derived, so the effect never writes state
  // synchronously in its body (it only schedules a timer and cleans up).
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!connected) return;
    const timer = setTimeout(() => setSettled(true), 600);
    return () => {
      clearTimeout(timer);
      setSettled(false);
    };
  }, [connected]);

  const plugged = connected && settled;
  const animating = connected && !settled;

  return (
    <div className={styles.wrapper}>
      <div className={styles.container}>
        {/* Source: the local workspace */}
        <div className={styles.orgColumn}>
          <div className={styles.orgLabel}>
            <CircleDot
              size={10}
              className={workspace ? styles.connected : styles.disconnected}
            />
            Local workspace
          </div>
          <div className={styles.orgSelector}>
            <div className={styles.cloudIcon}>
              <FolderGit2 size={20} />
            </div>
            <div className={styles.workspaceInfo}>
              <span className={styles.workspaceName}>
                {workspace ? workspace.name : "No workspace open"}
              </span>
              <span className={styles.workspacePath} title={workspace?.path}>
                {workspace
                  ? workspaceOrg
                    ? `Retrieved from ${workspaceOrg.alias}`
                    : workspace.orgId
                      ? "Belongs to an org that is not connected"
                      : "Not bound to an org"
                  : "Open the Workspace to choose one"}
              </span>
            </div>
          </div>
        </div>

        {/* Cable */}
        <div className={styles.cableSection}>
          <div className={styles.cableTrack}>
            <div
              className={cls(
                styles.plugHead,
                animating && styles.plugAnimating,
                plugged && styles.plugPlugged,
              )}
            >
              <div className={styles.plugBody}>
                <Zap size={14} className={styles.plugIcon} />
              </div>
              <div className={styles.plugPoints}>
                <span className={styles.pin} />
                <span className={styles.pin} />
                <span className={styles.pin} />
              </div>
            </div>
            <svg
              className={styles.cableSvg}
              viewBox="0 0 200 60"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="cg" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="var(--color-primary)" />
                  <stop offset="50%" stopColor="var(--color-secondary)" />
                  <stop offset="100%" stopColor="var(--color-pink)" />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <path
                d="M5,30 Q50,10 100,30 Q150,50 195,30"
                fill="none"
                stroke={plugged ? "url(#cg)" : "rgba(148,163,184,0.2)"}
                strokeWidth="3"
                strokeLinecap="round"
                filter={plugged ? "url(#glow)" : undefined}
                className={cls(styles.cablePath, plugged && styles.cableLive)}
              />
            </svg>
            {plugged && (
              <div className={styles.connectionBadge}>
                <Zap size={12} />
                <span>Deploys to</span>
              </div>
            )}
          </div>
        </div>

        {/* Target org */}
        <div className={styles.orgColumn}>
          <div className={styles.orgLabel}>
            <CircleDot
              size={10}
              className={
                targetOrg?.status === "Connected"
                  ? styles.connected
                  : styles.disconnected
              }
            />
            Target Org
          </div>
          <div className={styles.orgSelector}>
            <div className={styles.cloudIcon}>
              <Cloud size={22} />
            </div>
            <select
              className={styles.select}
              value={targetOrg?.id ?? ""}
              aria-label="Target org"
              onChange={(e) => {
                const org =
                  organizations.find((o) => o.id === e.target.value) ?? null;
                onTargetChange(org);
              }}
            >
              <option value="">Select target org...</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.alias} ({org.orgType})
                </option>
              ))}
            </select>
            {targetOrg && (
              <div className={styles.orgMeta}>
                <span className={styles.orgType}>{targetOrg.orgType}</span>
                <span className={styles.orgUrl}>
                  {targetOrg.instanceUrl.replace("https://", "")}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {crossOrg && (
        <p className={styles.crossOrg} role="status">
          <AlertTriangle size={14} />
          This workspace came from {workspaceOrg?.alias ?? "a different org"}.
          Deploying it to {targetOrg?.alias} sends that org&rsquo;s files —
          you&rsquo;ll be asked to confirm.
        </p>
      )}
    </div>
  );
}
