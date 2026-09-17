import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Copy,
  Check,
  FileText,
  Loader2,
  RefreshCw,
  Radio,
  Search,
  ScrollText,
  Square,
  X,
} from "lucide-react";

import {
  countByCategory,
  filterLog,
  humanSize,
  LOG_CATEGORIES,
  parseLog,
  readableTime,
  type LogCategory,
} from "./lib/logLines";
import {
  getApexLog,
  listApexLogs,
  onApexLogTail,
  tailApexLogs,
} from "./services/logService";
import { useOrganizationStore } from "../../store/orgStore";
import { offerReauthentication } from "../org-manager/lib/orgErrors";
import { Badge, Button } from "../../components/ui";
import OrgGuard from "../../components/OrgGuard/OrgGuard";
import { errorMessage } from "../../lib/errors";
import { copyText } from "../../lib/clipboard";
import { toast } from "../../components/ui/Toast/toast";
import { cancelSfCommand, newRunId } from "../../services/tauri";
import type { ApexLog } from "@/types/generated";

import "./LogsPage.css";

/** What the viewer is showing: a saved log, or the live tail. */
type Source = { kind: "log"; log: ApexLog } | { kind: "tail" };

export default function LogsPage() {
  const org = useOrganizationStore((state) => state.selectedOrganization);
  const username = org?.username;

  // Keyed by org, so switching orgs fetches that org's logs instead of
  // leaving the previous org's on screen.
  const list = useQuery({
    queryKey: ["apex-logs", username],
    queryFn: () => listApexLogs(username as string),
    enabled: Boolean(username),
    staleTime: 30 * 1000,
  });
  const logs = list.data ?? [];

  const [source, setSource] = useState<Source | null>(null);
  const [body, setBody] = useState("");
  const [loadingBody, setLoadingBody] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [categories, setCategories] = useState<LogCategory[]>([]);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);

  const [tailing, setTailing] = useState(false);
  const tailRun = useRef<string | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => parseLog(body), [body]);
  const counts = useMemo(() => countByCategory(lines), [lines]);
  const shown = useMemo(
    () => filterLog(lines, categories, search),
    [lines, categories, search],
  );

  // The open log belongs to the org it came from. Cleared as the org changes
  // rather than in an effect, which would render the wrong log once first.
  const [shownOrg, setShownOrg] = useState(username);
  if (shownOrg !== username) {
    setShownOrg(username);
    setSource(null);
    setBody("");
    setError(null);
  }

  function refresh() {
    void list.refetch();
  }

  async function open(log: ApexLog) {
    if (!username) return;
    setSource({ kind: "log", log });
    setLoadingBody(true);
    setError(null);
    try {
      setBody(await getApexLog(username, log.id));
    } catch (caught) {
      setBody("");
      setError(errorMessage(caught, "Could not read that log."));
    } finally {
      setLoadingBody(false);
    }
  }

  async function startTail() {
    if (!username || tailing) return;

    const runId = newRunId();
    tailRun.current = runId;
    setSource({ kind: "tail" });
    setBody("");
    setError(null);
    setTailing(true);

    // Subscribed before the tail starts, so nothing it prints is missed.
    const stop = await onApexLogTail((event) => {
      if (event.runId !== runId) return;
      const text = event.chunks.map((chunk) => chunk.text).join("\n");
      if (text) setBody((current) => (current ? `${current}\n${text}` : text));
      if (event.exit) setTailing(false);
    });

    try {
      await tailApexLogs(username, runId);
    } catch (caught) {
      setError(errorMessage(caught, "Could not start watching this org."));
      offerReauthentication(caught, org);
    } finally {
      stop();
      setTailing(false);
      tailRun.current = null;
      // A tail writes logs while it runs; the list is stale the moment it ends.
      refresh();
    }
  }

  function stopTail() {
    // The UI flips to "stopped" either way, so a failed cancel is reported
    // rather than left as an unhandled rejection with the tail still running.
    if (tailRun.current) {
      void cancelSfCommand(tailRun.current).catch((error: unknown) => {
        toast.error(errorMessage(error), { title: "Could not stop the tail" });
      });
    }
    setTailing(false);
  }

  // Follows the tail as it prints, but only while the viewer is already at the
  // bottom: scrolling back to read something should not be yanked away.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !tailing) return;
    const atBottom =
      viewer.scrollHeight - viewer.scrollTop - viewer.clientHeight < 80;
    if (atBottom) viewer.scrollTop = viewer.scrollHeight;
  }, [body, tailing]);

  useEffect(() => () => stopTail(), []);

  function toggleCategory(key: LogCategory) {
    setCategories((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  }

  async function copyLog() {
    // This had no `catch` at all: a clipboard failure was an unhandled
    // rejection, and "Copied" never appeared with nothing to say why.
    if (!(await copyText(body, "the log"))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <OrgGuard>
      <div className="logs-page">
        <header className="logs-head">
          <span className="logs-head__icon">
            <ScrollText size={22} />
          </span>
          <div className="logs-head__text">
            <h1>Debug Logs</h1>
            <p>
              Read what the org recorded, or watch it as it happens. Watching
              sets up the trace flag for you.
            </p>
          </div>
          <div className="logs-head__actions">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<RefreshCw size={14} />}
              onClick={refresh}
              loading={list.isFetching}
            >
              Refresh
            </Button>
            {tailing ? (
              <Button
                variant="danger"
                size="sm"
                leftIcon={<Square size={14} />}
                onClick={stopTail}
              >
                Stop watching
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Radio size={14} />}
                onClick={() => void startTail()}
              >
                Watch live
              </Button>
            )}
          </div>
        </header>

        {(error || list.error) && (
          <p className="logs-error" role="alert">
            <AlertTriangle size={14} />{" "}
            {error ??
              errorMessage(list.error, "Could not list this org's debug logs.")}
          </p>
        )}

        <div className="logs-body">
          <aside className="logs-list">
            <div className="logs-list__head">
              <span>{logs.length} logs</span>
            </div>
            {logs.length === 0 ? (
              <p className="logs-empty">
                {list.isPending
                  ? "Asking the org…"
                  : "No debug logs. Watch live, or run something in the org with a trace flag set."}
              </p>
            ) : (
              <ul>
                {logs.map((log) => {
                  const active =
                    source?.kind === "log" && source.log.id === log.id;
                  return (
                    <li key={log.id}>
                      <button
                        type="button"
                        className={`logs-item ${active ? "is-active" : ""}`}
                        onClick={() => void open(log)}
                      >
                        <span className="logs-item__top">
                          <span className="logs-item__op">{log.operation}</span>
                          {log.status !== "Success" && (
                            <Badge tone="error">{log.status}</Badge>
                          )}
                        </span>
                        <span className="logs-item__meta">
                          {readableTime(log.startTime)} · {log.durationMs} ms ·{" "}
                          {humanSize(log.lengthBytes)}
                        </span>
                        <span className="logs-item__meta">
                          {log.user}
                          {log.application ? ` · ${log.application}` : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="logs-viewer">
            <div className="logs-viewer__bar">
              <span className="logs-viewer__title">
                {source?.kind === "tail" ? (
                  <>
                    <Radio size={14} className={tailing ? "logs-pulse" : ""} />
                    {tailing ? "Watching the org…" : "Watch ended"}
                  </>
                ) : source ? (
                  <>
                    <FileText size={14} />
                    {source.log.operation}
                  </>
                ) : (
                  "No log open"
                )}
              </span>

              {body && (
                <div className="logs-viewer__tools">
                  <div className="logs-filters">
                    {(Object.keys(LOG_CATEGORIES) as LogCategory[]).map(
                      (key) => (
                        <button
                          key={key}
                          type="button"
                          className={`logs-filter ${categories.includes(key) ? "is-on" : ""}`}
                          title={LOG_CATEGORIES[key].hint}
                          aria-pressed={categories.includes(key)}
                          onClick={() => toggleCategory(key)}
                          disabled={counts[key] === 0}
                        >
                          {LOG_CATEGORIES[key].label}
                          <span className="logs-filter__count">
                            {counts[key]}
                          </span>
                        </button>
                      ),
                    )}
                  </div>

                  <div className="logs-search">
                    <Search size={13} />
                    <input
                      type="text"
                      value={search}
                      placeholder="Find in log…"
                      aria-label="Find in log"
                      onChange={(event) => setSearch(event.target.value)}
                    />
                    {search && (
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        aria-label="Clear search"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    className="logs-copy"
                    onClick={() => void copyLog()}
                    title="Copy the whole log"
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />}
                  </button>
                </div>
              )}
            </div>

            <div className="logs-viewer__body" ref={viewerRef}>
              {loadingBody ? (
                <p className="logs-empty">
                  <Loader2 size={15} className="logs-spin" /> Fetching the log…
                </p>
              ) : !body ? (
                <p className="logs-empty">
                  {source?.kind === "tail"
                    ? "Nothing yet. Do something in the org and it will appear here."
                    : "Choose a log on the left, or watch the org live."}
                </p>
              ) : shown.length === 0 ? (
                <p className="logs-empty">Nothing in this log matches.</p>
              ) : (
                <ol className="logs-lines">
                  {shown.map((line) => (
                    <li key={line.number} className="logs-line">
                      <span className="logs-line__number">{line.number}</span>
                      <span
                        className={`logs-line__text ${line.event ? `is-${line.event.toLowerCase()}` : ""}`}
                      >
                        {line.text || " "}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {body && (
              <div className="logs-viewer__foot">
                {shown.length === lines.length
                  ? `${lines.length} lines`
                  : `${shown.length} of ${lines.length} lines`}
              </div>
            )}
          </section>
        </div>
      </div>
    </OrgGuard>
  );
}
