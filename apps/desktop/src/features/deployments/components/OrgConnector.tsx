import { useState, useEffect } from "react";
import { Cloud, ArrowLeftRight, Zap, CircleDot } from "lucide-react";
import type { Organization } from "../../org-manager/types";
import { cls } from "../../../lib/cls";
import styles from "./OrgConnector.module.css";

interface OrgConnectorProps {
  organizations: Organization[];
  sourceOrg: Organization | null;
  targetOrg: Organization | null;
  onSourceChange: (org: Organization | null) => void;
  onTargetChange: (org: Organization | null) => void;
  onSwap: () => void;
}

export default function OrgConnector({
  organizations,
  sourceOrg,
  targetOrg,
  onSourceChange,
  onTargetChange,
  onSwap,
}: OrgConnectorProps) {
  const [plugged, setPlugged] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (sourceOrg && targetOrg) {
      setAnimating(true);
      const timer = setTimeout(() => {
        setPlugged(true);
        setAnimating(false);
      }, 600);
      return () => clearTimeout(timer);
    } else {
      setPlugged(false);
    }
  }, [sourceOrg, targetOrg]);

  const dot = (org: Organization | null) => {
    if (!org) return "disconnected";
    return org.status === "Connected" ? "connected" : "disconnected";
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.container}>
        {/* Source */}
        <div className={styles.orgColumn}>
          <div className={styles.orgLabel}>
            <CircleDot size={10} className={styles[dot(sourceOrg)]} />
            Source Org
          </div>
          <div className={styles.orgSelector}>
            <div className={styles.cloudIcon}><Cloud size={22} /></div>
            <select
              className={styles.select}
              value={sourceOrg?.id ?? ""}
              onChange={(e) => {
                const org = organizations.find((o) => o.id === e.target.value) ?? null;
                onSourceChange(org);
              }}
            >
              <option value="">Select source org...</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>{org.alias} ({org.orgType})</option>
              ))}
            </select>
            {sourceOrg && (
              <div className={styles.orgMeta}>
                <span className={styles.orgType}>{sourceOrg.orgType}</span>
                <span className={styles.orgUrl}>{sourceOrg.instanceUrl.replace("https://","")}</span>
              </div>
            )}
          </div>
        </div>

        {/* Cable */}
        <div className={styles.cableSection}>
          <div className={styles.cableTrack}>
            <div className={cls(styles.plugHead, animating && styles.plugAnimating, plugged && styles.plugPlugged)}>
              <div className={styles.plugBody}><Zap size={14} className={styles.plugIcon} /></div>
              <div className={styles.plugPoints}>
                <span className={styles.pin} /><span className={styles.pin} /><span className={styles.pin} />
              </div>
            </div>
            <svg className={styles.cableSvg} viewBox="0 0 200 60" preserveAspectRatio="none">
              <defs>
                <linearGradient id="cg" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#6d5bff" /><stop offset="50%" stopColor="#9d4dff" /><stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <path d="M5,30 Q50,10 100,30 Q150,50 195,30" fill="none"
                stroke={plugged ? "url(#cg)" : "rgba(148,163,184,0.2)"} strokeWidth="3" strokeLinecap="round"
                filter={plugged ? "url(#glow)" : undefined}
                className={cls(styles.cablePath, plugged && styles.cableLive)} />
              {plugged && (
                <><circle r="3" fill="#6d5bff" filter="url(#glow)" className={styles.p1} />
                <circle r="2.5" fill="#9d4dff" filter="url(#glow)" className={styles.p2} />
                <circle r="2" fill="#ec4899" filter="url(#glow)" className={styles.p3} /></>
              )}
            </svg>
            {plugged && (
              <div className={styles.connectionBadge}><Zap size={12} /><span>Connected</span></div>
            )}
          </div>
          <button className={styles.swapBtn} onClick={onSwap} title="Swap source and target"
            disabled={!sourceOrg && !targetOrg}>
            <ArrowLeftRight size={16} />
          </button>
        </div>

        {/* Target */}
        <div className={styles.orgColumn}>
          <div className={styles.orgLabel}>
            <CircleDot size={10} className={styles[dot(targetOrg)]} />
            Target Org
          </div>
          <div className={styles.orgSelector}>
            <div className={styles.cloudIcon}><Cloud size={22} /></div>
            <select
              className={styles.select}
              value={targetOrg?.id ?? ""}
              onChange={(e) => {
                const org = organizations.find((o) => o.id === e.target.value) ?? null;
                onTargetChange(org);
              }}
            >
              <option value="">Select target org...</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>{org.alias} ({org.orgType})</option>
              ))}
            </select>
            {targetOrg && (
              <div className={styles.orgMeta}>
                <span className={styles.orgType}>{targetOrg.orgType}</span>
                <span className={styles.orgUrl}>{targetOrg.instanceUrl.replace("https://","")}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}