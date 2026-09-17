import { useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Gauge,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import type { Organization } from "../types";
import {
  useOrgDetails,
  useOrgLimits,
  useRefreshOrgInfo,
} from "../hooks/useOrgInfo";
import { filterLimits, limitRows } from "../lib/orgLimits";
import { offerReauthentication } from "../lib/orgErrors";
import { Badge, Button, Dialog } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";

import styles from "./OrgDetailsDialog.module.css";

interface Props {
  org: Organization;
  onClose: () => void;
}

/** A date the CLI reports, in the reader's own locale; the raw value if not. */
function readableDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

const NUMBER = new Intl.NumberFormat();

/**
 * What an org is and how much of it is left: identity and instance from
 * `sf org display`, governor limits from `sf limits api display`.
 *
 * Both were previously only reachable by dropping into a terminal, which is
 * the thing this app exists to avoid.
 */
export default function OrgDetailsDialog({ org, onClose }: Props) {
  const details = useOrgDetails(org.username);
  const limits = useOrgLimits(org.username);
  const refresh = useRefreshOrgInfo();
  const [search, setSearch] = useState("");

  const error = details.error ?? limits.error;
  const rows = limitRows(limits.data ?? []);
  const shown = filterLimits(rows, search);
  const tight = rows.filter((row) => row.tone !== "ok").length;

  // Fields the CLI only reports for some kinds of org — a Developer Edition
  // has no expiry, a production org no scratch-org edition.
  const facts: { label: string; value: string; mono?: boolean }[] = [
    { label: "Org ID", value: details.data?.orgId ?? org.id, mono: true },
    {
      label: "Username",
      value: details.data?.username ?? org.username,
      mono: true,
    },
    { label: "Alias", value: details.data?.alias ?? org.alias },
    { label: "Type", value: org.orgType },
    ...(details.data?.orgName
      ? [{ label: "Name", value: details.data.orgName }]
      : []),
    ...(details.data?.edition
      ? [{ label: "Edition", value: details.data.edition }]
      : []),
    {
      label: "API version",
      value: details.data?.apiVersion ?? (details.isPending ? "…" : "unknown"),
    },
    {
      label: "Instance",
      value: details.data?.instanceUrl ?? org.instanceUrl,
      mono: true,
    },
    ...(details.data?.loginUrl
      ? [{ label: "Login URL", value: details.data.loginUrl, mono: true }]
      : []),
    ...(details.data?.createdDate
      ? [{ label: "Created", value: readableDate(details.data.createdDate) }]
      : []),
    ...(details.data?.expirationDate
      ? [{ label: "Expires", value: readableDate(details.data.expirationDate) }]
      : []),
  ];

  return (
    <Dialog
      title={org.alias}
      description={
        <span className={styles.subtitle}>
          {org.username}
          {org.isDefault && <Badge tone="purple">CLI default</Badge>}
          <Badge tone={org.status === "Connected" ? "success" : "warning"} dot>
            {org.status}
          </Badge>
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<RefreshCw size={14} />}
            onClick={() => refresh(org.username)}
            disabled={details.isFetching || limits.isFetching}
          >
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {error && (
        <div className={styles.error} role="alert">
          <AlertTriangle size={15} />
          <span>{errorMessage(error, "Could not read this org.")}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => offerReauthentication(error, org)}
          >
            Fix
          </Button>
        </div>
      )}

      <dl className={styles.facts}>
        {facts.map((fact) => (
          <div key={fact.label} className={styles.fact}>
            <dt>{fact.label}</dt>
            <dd className={fact.mono ? styles.mono : undefined}>
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>

      <section className={styles.limits}>
        <header className={styles.limitsHead}>
          <span className={styles.limitsTitle}>
            <Gauge size={15} />
            Limits
            {tight > 0 && <Badge tone="warning">{tight} running low</Badge>}
          </span>

          {rows.length > 0 && (
            <div className={styles.search}>
              <Search size={13} />
              <input
                type="text"
                value={search}
                placeholder="Filter limits…"
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Filter limits"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  aria-label="Clear filter"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          )}
        </header>

        {limits.isPending ? (
          <p className={styles.state}>
            <Loader2 size={15} className={styles.spin} /> Asking the org…
          </p>
        ) : rows.length === 0 ? (
          <p className={styles.state}>This org reported no limits.</p>
        ) : shown.length === 0 ? (
          <p className={styles.state}>No limit matches that filter.</p>
        ) : (
          <ul className={styles.limitList}>
            {shown.map((row) => (
              <li key={row.name} className={styles.limit}>
                <span className={styles.limitName} title={row.name}>
                  {row.label}
                </span>
                <span className={styles.limitCount}>
                  {row.usage === null
                    ? "no limit"
                    : `${NUMBER.format(row.used)} / ${NUMBER.format(row.max)}`}
                </span>
                <span
                  className={styles.track}
                  role="meter"
                  aria-label={row.label}
                  aria-valuenow={row.used}
                  aria-valuemin={0}
                  aria-valuemax={row.max}
                  aria-valuetext={
                    row.usage === null
                      ? "No limit"
                      : `${NUMBER.format(row.remaining)} of ${NUMBER.format(row.max)} left`
                  }
                >
                  <span
                    className={`${styles.bar} ${styles[row.tone]}`}
                    style={{ width: `${(row.usage ?? 0) * 100}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className={styles.footnote}>
        <ExternalLink size={12} />
        Read from the Salesforce CLI (`org display`, `limits api display`). The
        org&apos;s access token stays in the CLI and never reaches this window.
      </p>
    </Dialog>
  );
}
