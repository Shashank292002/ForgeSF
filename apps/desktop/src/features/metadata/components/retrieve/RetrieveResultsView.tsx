import {
  AlertTriangle,
  CheckCircle2,
  MinusCircle,
  RotateCw,
  XCircle,
} from "lucide-react";

import type { RetrieveResult, RetrieveTypeResult } from "../../types";
import { prettyMetadataKind } from "../../lib/categories";

interface Props {
  result: RetrieveResult;
  onRetry: (kinds: string[]) => void;
  onRetrieveMore: () => void;
  onOpenWorkspace: () => void;
}

const ROW_CLASS: Record<RetrieveTypeResult["status"], string> = {
  completed: "is-ok",
  failed: "is-failed",
  skipped: "is-skipped",
};

function RowIcon({ status }: { status: RetrieveTypeResult["status"] }) {
  if (status === "completed") return <CheckCircle2 size={15} />;
  if (status === "skipped") return <MinusCircle size={15} />;
  return <XCircle size={15} />;
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
  const skipped = result.items.filter((item) => item.status === "skipped");
  const warningCount = result.items.reduce(
    (sum, item) => sum + item.warnings.length,
    0,
  );
  const clean = result.success && warningCount === 0 && skipped.length === 0;

  const showCounts = result.items
    .filter((item) => item.retrieved > 0)
    .slice(0, 5);

  const heroTitle = result.cancelled
    ? "Retrieval cancelled"
    : result.success
      ? warningCount > 0
        ? "Retrieval complete, with warnings"
        : "Retrieval complete"
      : "Retrieval finished with errors";

  const heroSub = result.cancelled
    ? "Types retrieved before the cancel were written to the workspace; the rest were skipped."
    : !result.success
      ? result.summary ||
        "Some metadata could not be retrieved. Review the failures below and retry them."
      : warningCount > 0
        ? "Some requested components were not found in the org — see the warnings below."
        : "Metadata has been written to your local workspace. Open it in the editor to inspect and edit.";

  return (
    <div className="mr-results">
      <div className={`mr-results__hero ${clean ? "" : "is-fail"}`}>
        <span
          className={`mr-results__hero-icon ${clean ? "is-ok" : "is-warn"}`}
        >
          {clean ? (
            <CheckCircle2 size={24} />
          ) : result.success || result.cancelled ? (
            <AlertTriangle size={24} />
          ) : (
            <XCircle size={24} />
          )}
        </span>
        <div>
          <div className="mr-results__hero-title">{heroTitle}</div>
          <div className="mr-results__hero-sub">{heroSub}</div>
        </div>
      </div>

      <div className="mr-results__chips">
        <span className="mr-chip is-ok">
          <b>{result.succeeded}</b> types succeeded
        </span>
        <span className="mr-chip is-fail">
          <b>{result.failed}</b> types failed
        </span>
        {skipped.length > 0 && (
          <span className="mr-chip">
            <b>{skipped.length}</b> skipped
          </span>
        )}
        <span className="mr-chip">
          <b>{totalRetrieved}</b> items written
        </span>
      </div>

      <div className="mr-results__title">By metadata type</div>
      {result.items.map((item) => (
        <div key={item.kind} className="mr-result-group">
          <div className={`mr-result-row ${ROW_CLASS[item.status]}`}>
            <span className="mr-result-row__icon">
              <RowIcon status={item.status} />
            </span>
            <span className="mr-result-row__name">
              {prettyMetadataKind(item.kind)}
            </span>
            {item.status === "completed" ? (
              <span className="mr-result-row__count is-ok">
                {item.retrieved} item{item.retrieved === 1 ? "" : "s"}
              </span>
            ) : (
              <span
                className="mr-result-row__fail-msg"
                title={item.message ?? ""}
              >
                {item.message ??
                  (item.status === "skipped"
                    ? "Skipped"
                    : "Failed to retrieve")}
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
          {item.warnings.length > 0 && (
            <ul className="mr-result-warnings">
              {item.warnings.map((warning) => (
                <li key={warning}>
                  <AlertTriangle size={11} /> {warning}
                </li>
              ))}
            </ul>
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
          <button
            type="button"
            className="mr-btn mr-btn--ghost"
            onClick={onRetrieveMore}
          >
            Retrieve more
          </button>
          <button
            type="button"
            className="mr-btn mr-btn--success"
            onClick={onOpenWorkspace}
          >
            Open in Workspace
          </button>
        </div>
      </div>
    </div>
  );
}
