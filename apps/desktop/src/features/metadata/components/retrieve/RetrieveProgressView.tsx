import { Check, Loader2, X } from "lucide-react";

import type { RetrieveProgressEntry } from "../../types";
import { prettyMetadataKind } from "../../lib/categories";

interface Props {
  entries: RetrieveProgressEntry[];
  total: number;
}

export default function RetrieveProgressView({ entries, total }: Props) {
  const completed = entries.filter((e) => e.status === "completed").length;
  const failed = entries.filter((e) => e.status === "failed").length;
  const done = completed + failed;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const totalRetrieved = entries.reduce(
    (sum, e) => sum + (e.status === "completed" ? e.retrieved : 0),
    0,
  );

  return (
    <div className="mr-progress">
      <div className="mr-progress__summary">
        <div className="mr-prog-stat">
          <span className="mr-prog-stat__label">Overall</span>
          <span className="mr-prog-stat__value">{percent}%</span>
        </div>
        <div className="mr-prog-stat">
          <span className="mr-prog-stat__label">Retrieved</span>
          <span className="mr-prog-stat__value" style={{ color: "var(--mr-success)" }}>
            {totalRetrieved}
            <small>items</small>
          </span>
        </div>
        <div className="mr-prog-stat">
          <span className="mr-prog-stat__label">Types</span>
          <span className="mr-prog-stat__value">
            {done}
            <small>/ {total}</small>
          </span>
        </div>
      </div>

      <div className="mr-progress__bar">
        <div className="mr-progress__bar-fill" style={{ width: `${percent}%` }} />
      </div>

      <div className="mr-progress__list">
        {entries.map((entry) => (
          <div
            key={entry.kind}
            className={`mr-prog-row is-${entry.status}`}
          >
            <span className="mr-prog-row__icon">
              {entry.status === "running" && <Loader2 size={14} />}
              {entry.status === "completed" && <Check size={14} />}
              {entry.status === "failed" && <X size={14} />}
            </span>
            <span className="mr-prog-row__name">
              {prettyMetadataKind(entry.kind)}
            </span>
            {entry.status === "completed" ? (
              <span className="mr-prog-row__count">
                {entry.retrieved} item{entry.retrieved === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="mr-prog-row__msg">
                {entry.status === "running" ? "Retrieving…" : "Failed"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}