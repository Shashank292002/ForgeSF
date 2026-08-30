import { CheckCircle2, RotateCw, XCircle } from "lucide-react";

import type { RetrieveResult } from "../../types";
import { prettyMetadataKind } from "../../lib/categories";

interface Props {
  result: RetrieveResult;
  onRetry: (kinds: string[]) => void;
  onRetrieveMore: () => void;
  onOpenWorkspace: () => void;
}

export default function RetrieveResultsView({
  result,
  onRetry,
  onRetrieveMore,
  onOpenWorkspace,
}: Props) {
  const totalRetrieved = result.items.reduce(
    (sum, item) => sum + (item.status === "completed" ? item.retrieved : 0),
    0,
  );
  const failures = result.items.filter((item) => item.status === "failed");

  const showCounts = result.items.filter((item) => item.retrieved > 0).slice(0, 5);

  return (
    <div className="mr-results">
      <div className={`mr-results__hero ${result.success ? "" : "is-fail"}`}>
        <span className={`mr-results__hero-icon ${result.success ? "is-ok" : "is-warn"}`}>
          {result.success ? <CheckCircle2 size={24} /> : <XCircle size={24} />}
        </span>
        <div>
          <div className="mr-results__hero-title">
            {result.success ? "Retrieval complete" : "Retrieval finished with errors"}
          </div>
          <div className="mr-results__hero-sub">
            {result.success
              ? "Metadata has been written to your local workspace. Open it in the editor to inspect and edit."
              : "Some metadata could not be retrieved. Review the failures below and retry them."}
          </div>
        </div>
      </div>

      <div className="mr-results__chips">
        <span className="mr-chip is-ok">
          <b>{result.succeeded}</b> types succeeded
        </span>
        <span className="mr-chip is-fail">
          <b>{result.failed}</b> types failed
        </span>
        <span className="mr-chip">
          <b>{totalRetrieved}</b> items written
        </span>
      </div>

      <div className="mr-results__title">By metadata type</div>
      {result.items.map((item) => (
        <div
          key={item.kind}
          className={`mr-result-row ${item.status === "failed" ? "is-failed" : "is-ok"}`}
        >
          <span className="mr-result-row__icon">
            {item.status === "completed" ? (
              <CheckCircle2 size={15} />
            ) : (
              <XCircle size={15} />
            )}
          </span>
          <span className="mr-result-row__name">{prettyMetadataKind(item.kind)}</span>
          {item.status === "completed" ? (
            <span className={`mr-result-row__count is-ok`}>
              {item.retrieved} item{item.retrieved === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="mr-result-row__fail-msg">
              {item.message ?? "Failed to retrieve"}
            </span>
          )}
          {item.status === "failed" && (
            <button
              type="button"
              className="mr-retry"
              onClick={() => onRetry([item.kind])}
            >
              <RotateCw size={12} /> Retry
            </button>
          )}
        </div>
      ))}

      {showCounts.length > 0 && (
        <div className="mr-note">
          {showCounts
            .map((item) => `${item.retrieved} ${prettyMetadataKind(item.kind)}`)
            .join(" · ")}
        </div>
      )}

      <div className="mr-footer">
        <div className="mr-footer__status">
          {failures.length > 0 ? (
            <span>
              <b>{failures.length}</b> failed — you can retry them
            </span>
          ) : (
            <span>All retrieved metadata is ready in your workspace</span>
          )}
        </div>
        <div className="mr-footer__actions">
          {failures.length > 0 && (
            <button
              type="button"
              className="mr-btn"
              onClick={() => onRetry(failures.map((f) => f.kind))}
            >
              <RotateCw size={14} /> Retry failed
            </button>
          )}
          <button type="button" className="mr-btn mr-btn--ghost" onClick={onRetrieveMore}>
            Retrieve more
          </button>
          <button type="button" className="mr-btn mr-btn--success" onClick={onOpenWorkspace}>
            Open in Workspace
          </button>
        </div>
      </div>
    </div>
  );
}