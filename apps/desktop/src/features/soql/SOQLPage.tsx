import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  AlertTriangle,
  TerminalSquare,
  Play,
  RotateCcw,
  Loader2,
  Copy,
  Check,
  Trash2,
  Download,
  Table2,
  FileJson,
  History,
  X,
} from "lucide-react";

import { useOrganizationStore } from "../../store/orgStore";
import {
  runQuery,
  runSearch,
  runCommand,
  runSfJson,
  cancelSfCommand,
  newRunId,
} from "../../services/tauri";
import { Button, Badge } from "../../components/ui";
import OrgGuard from "../../components/OrgGuard/OrgGuard";
import RecordTable from "./RecordTable";
import { tokenize } from "../workspace/lib/tokenize";
import { protectionPrompt } from "../org-manager/lib/orgProtection";
import { offerReauthentication } from "../org-manager/lib/orgErrors";
import { errorMessage } from "../../lib/errors";
import { copyText } from "../../lib/clipboard";
import { cliProtectionPrompt, stripCliName } from "../../lib/sfCli";
import { confirm } from "../../components/ui/Confirm/confirm";
import { toast } from "../../components/ui/Toast/toast";
import SoqlEditor from "./SoqlEditor";
import { objectOfQuery } from "./lib/soqlContext";
import { exportFileName, toCsv, toJson } from "./lib/exportRecords";
import { saveTextFile } from "./services/describeService";

import "./SOQLPage.css";

type Tab = "soql" | "sosl" | "apex" | "cli";
type View = "table" | "raw";

const SNIPPETS: Record<Tab, string[]> = {
  soql: [
    "SELECT Id, Name FROM Account LIMIT 10",
    "SELECT Id, Name, Type FROM Lead LIMIT 5",
    "SELECT Id, Subject, Status FROM Case ORDER BY CreatedDate DESC LIMIT 10",
    "SELECT Account.Name, COUNT(Id) cnt FROM Contact GROUP BY Account.Name LIMIT 10",
  ],
  sosl: ["FIND {Acme} IN ALL FIELDS RETURNING Account(Id, Name)"],
  apex: ["System.debug('Hello from anonymous Apex!');"],
  cli: ["org display --json"],
};

/**
 * The row count past which a result is worth a warning. Everything a query
 * matches crosses the IPC boundary and is drawn in one go, so a result this
 * size is slow to fetch and slow to scroll. `LIMIT` is the cure.
 */
const LARGE_RESULT_ROWS = 2000;

const TAB_LABELS: Record<Tab, string> = {
  soql: "SOQL",
  sosl: "SOSL",
  apex: "Anonymous Apex",
  cli: "CLI",
};

interface HistoryEntry {
  tab: Tab;
  value: string;
  /**
   * The org this ran against. Absent on entries written before history was
   * scoped — those stay visible everywhere until they age out of the list.
   */
  orgId?: string;
}

function tryParseRecords(output: string): Record<string, unknown>[] | null {
  try {
    const parsed = JSON.parse(output);
    if (parsed?.result?.records) return parsed.result.records;
    if (parsed?.result?.searchRecords) return parsed.result.searchRecords;
    if (parsed?.records) return parsed.records;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    return null;
  }
  return null;
}

function isTab(value: string | null): value is Tab {
  return value !== null && value in TAB_LABELS;
}

export default function SOQLPage() {
  const org = useOrganizationStore((s) => s.selectedOrganization);
  const organizations = useOrganizationStore((s) => s.organizations);
  // `?tab=apex` opens a tab directly — the Dashboard's Anonymous Apex link
  // lands here now that the separate Apex page is gone.
  const [searchParams] = useSearchParams();
  const initialTab = isTab(searchParams.get("tab"))
    ? (searchParams.get("tab") as Tab)
    : "soql";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [input, setInput] = useState<string>(SNIPPETS[initialTab][0]);
  const [output, setOutput] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<View>("table");
  const [copied, setCopied] = useState(false);
  const [executeMs, setExecuteMs] = useState<number | null>(null);
  const [cancelling, setCancelling] = useState(false);
  /** Tooling objects are invisible to a plain query, and have their own describes. */
  const [tooling, setTooling] = useState(false);

  // Entries remember the tab they were run from. A single flat list replayed
  // SOQL through whichever tab happened to be open — sending a query to the
  // `sf` binary as argv.
  const [history, setHistory] = useState<HistoryEntry[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("devtools.history") || "[]");
      if (!Array.isArray(raw)) return [];
      return raw
        .map((item): HistoryEntry | null =>
          typeof item === "string"
            ? { tab: "soql", value: item } // migrate the old flat format
            : item && typeof item.value === "string"
              ? {
                  tab: (item.tab as Tab) ?? "soql",
                  value: item.value,
                  orgId:
                    typeof item.orgId === "string" ? item.orgId : undefined,
                }
              : null,
        )
        .filter((item): item is HistoryEntry => item !== null);
    } catch {
      return [];
    }
  });

  const copyTimer = useRef<number | null>(null);
  // The run Cancel should stop. Scoped per run so cancelling here can never
  // stop a command started elsewhere (e.g. the workspace terminal).
  const activeRunId = useRef<string | null>(null);

  /**
   * History for the active org only.
   *
   * Entries used to be offered regardless of which org was connected, so a
   * sandbox query could be replayed — with one click — against Production.
   */
  const visibleHistory = useMemo(
    () =>
      history
        .map((item, index) => ({ item, index }))
        .filter(
          ({ item }) => item.orgId === undefined || item.orgId === org?.id,
        ),
    [history, org?.id],
  );

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const records = useMemo(() => tryParseRecords(output), [output]);
  const rowCount = records?.length ?? 0;

  /** "12 rows · 340ms" — whichever parts are known. */
  const summary = useMemo(() => {
    const parts: string[] = [];
    if (records) parts.push(`${rowCount} row${rowCount === 1 ? "" : "s"}`);
    if (executeMs !== null) parts.push(`${executeMs}ms`);
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [records, rowCount, executeMs]);

  /** Saves the rows to a file the user picks. */
  async function exportRecords(format: "csv" | "json") {
    if (!records || records.length === 0) return;
    const object = objectOfQuery(input, input.length);
    const name = exportFileName(object, format);
    try {
      const written = await saveTextFile(
        name,
        format === "csv" ? toCsv(records) : toJson(records),
      );
      if (written) {
        toast.success(`${records.length} rows saved`, { title: written });
      }
    } catch (error) {
      toast.error(errorMessage(error, "Could not save the file."));
    }
  }

  function pushHistory(entryTab: Tab, q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const next = [
        { tab: entryTab, value: trimmed, orgId: org?.id },
        ...prev.filter(
          (h) =>
            !(h.value === trimmed && h.tab === entryTab && h.orgId === org?.id),
        ),
      ].slice(0, 50);
      localStorage.setItem("devtools.history", JSON.stringify(next));
      return next;
    });
  }

  function clearHistory() {
    setHistory([]);
    localStorage.removeItem("devtools.history");
  }

  function removeHistory(index: number) {
    setHistory((prev) => {
      const next = prev.filter((_, i) => i !== index);
      localStorage.setItem("devtools.history", JSON.stringify(next));
      return next;
    });
  }

  async function runWith(
    fn: (runId: string) => Promise<string>,
    historyTab: Tab,
    historyValue: string,
  ) {
    if (!org || running) return;

    const runId = newRunId();
    activeRunId.current = runId;

    setRunning(true);
    setCancelling(false);
    setOutput("");
    setCopied(false);
    setExecuteMs(null);

    const started = performance.now();

    try {
      const res = await fn(runId);
      setOutput(res);
      if (historyValue) pushHistory(historyTab, historyValue.trim());
    } catch (err: unknown) {
      setOutput(errorMessage(err));
      offerReauthentication(err, org);
    } finally {
      activeRunId.current = null;
      setRunning(false);
      setCancelling(false);
      setExecuteMs(Math.round(performance.now() - started));
    }
  }
  const runForTab = async (override: string, forTab: Tab = tab) => {
    if (forTab === "soql")
      void runWith(
        async (runId) => {
          if (!org) return "";
          return runQuery(org.username, override.trim(), runId, tooling);
        },
        forTab,
        override,
      );
    else if (forTab === "sosl")
      void runWith(
        async (runId) => {
          if (!org) return "";
          return runSearch(org.username, override.trim(), runId);
        },
        forTab,
        override,
      );
    else if (forTab === "apex") {
      // Anonymous Apex can run DML. It went straight to Production, while
      // deploys to the same org already asked first.
      const prompt = protectionPrompt(org, "Run anonymous Apex", "Run Apex");
      if (prompt && !(await confirm(prompt))) return;
      void runWith(
        async (runId) => {
          if (!org) return "";
          return runSfJson(
            ["apex", "execute", "--target-org", org.username, "--json"],
            override,
            runId,
          );
        },
        forTab,
        override,
      );
    } else {
      // A leading `sf` is dropped, as in the workspace terminal; it used to
      // run `sf sf …`.
      const args = stripCliName(tokenize(override));
      const prompt = cliProtectionPrompt(args, organizations);
      if (prompt && !(await confirm(prompt))) return;
      void runWith(
        async (runId) => runCommand(args, undefined, runId),
        forTab,
        override,
      );
    }
  };

  const run = () => void runForTab(input);

  // Each tab keeps its own buffer. Resetting `input` to the tab's first
  // snippet meant one misclick threw away whatever had been typed.
  const [drafts, setDrafts] = useState<Record<Tab, string>>(() => ({
    soql: SNIPPETS.soql[0],
    sosl: SNIPPETS.sosl[0],
    apex: SNIPPETS.apex[0],
    cli: SNIPPETS.cli[0],
  }));

  function handleTabChange(next: Tab) {
    setDrafts((prev) => ({ ...prev, [tab]: input }));
    setInput(drafts[next]);
    setTab(next);
    setOutput("");
    setView("table");
    setExecuteMs(null);
  }

  function loadFromHistory(item: HistoryEntry) {
    if (item.tab !== tab) {
      setDrafts((prev) => ({ ...prev, [tab]: input }));
      setTab(item.tab);
    }
    setInput(item.value);
    setOutput("");
  }

  function runFromHistory(item: HistoryEntry) {
    loadFromHistory(item);
    // Runs against the tab the entry was recorded from, not the active one.
    void runForTab(item.value, item.tab);
  }

  async function copyOutput() {
    if (!output) return;
    // Through the shared helper, which says so either way: a failed copy used
    // to be swallowed, so the button simply did nothing.
    if (!(await copyText(output, "the output"))) return;
    setCopied(true);
    if (copyTimer.current) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
  }

  function formatOutput() {
    try {
      setOutput(JSON.stringify(JSON.parse(output), null, 2));
    } catch {
      // Not JSON — a CLI error message, or plain text. Saying so beats a
      // button that visibly does nothing.
      toast.info("This output is not JSON, so there is nothing to format.");
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      run();
    }
  }

  // Union the keys across every row, minus Salesforce's `attributes`
  // envelope: taking `Object.keys(records[0])` dropped columns that only
  // appear on later rows, and rendered `attributes` as "[object Object]".
  const headers = useMemo(() => {
    if (!records) return [];
    const seen = new Set<string>();
    for (const row of records) {
      for (const key of Object.keys(row)) {
        if (key !== "attributes") seen.add(key);
      }
    }
    return [...seen];
  }, [records]);

  /** Renders a SOQL cell, flattening the nested objects relationships return. */
  const renderCell = (value: unknown): string => {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") {
      const nested = { ...(value as Record<string, unknown>) };
      delete nested.attributes;
      const entries = Object.entries(nested);
      // A single-field relationship (`Account.Name`) reads better unwrapped.
      if (entries.length === 1) return String(entries[0][1] ?? "");
      return JSON.stringify(nested);
    }
    return String(value);
  };

  return (
    <OrgGuard>
      <div className="soql-page">
        <div className="soql-header">
          <div className="soql-titleRow">
            <span className="soql-icon">
              <TerminalSquare size={22} />
            </span>
            <div>
              <h1>Developer Tools</h1>
              <p className="soql-subtitle">
                Query, run Apex, and execute Salesforce CLI commands against
                your connected org.
              </p>
            </div>
          </div>

          {org ? (
            <Badge tone="success" dot>
              {org.alias}
            </Badge>
          ) : null}
        </div>

        <div className="soql-tabs">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              className={`soql-tab-button ${tab === t ? "active" : ""}`}
              onClick={() => handleTabChange(t)}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="soql-layout">
          <PanelGroup direction="horizontal" className="soql-editor-group">
            <Panel defaultSize={72} minSize={50}>
              <PanelGroup direction="vertical" className="soql-panel-group">
                <Panel defaultSize={48} minSize={20}>
                  <div className="soql-panel-content">
                    {/* SOQL gets the real editor: highlighting, and a
                        completion list built from the connected org's own
                        objects and fields. The other tabs are a line or two
                        of text, where a textarea is the better fit. */}
                    {tab === "soql" ? (
                      <SoqlEditor
                        value={input}
                        onChange={setInput}
                        onRun={() => void runForTab(input)}
                        username={org?.username}
                        tooling={tooling}
                        placeholder="SELECT Id, Name FROM Account LIMIT 10"
                        readOnly={running}
                      />
                    ) : (
                      <textarea
                        className="soql-input"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={onKeyDown}
                        spellCheck={false}
                        placeholder="Enter a query, command, or snippet…"
                      />
                    )}

                    <div className="soql-actions">
                      <Button
                        variant="gradient"
                        leftIcon={
                          running ? <Loader2 size={15} /> : <Play size={15} />
                        }
                        onClick={run}
                        loading={running}
                        disabled={!org}
                      >
                        {running ? "Running..." : `Execute ${TAB_LABELS[tab]}`}
                      </Button>

                      {running && (
                        <Button
                          variant="secondary"
                          leftIcon={<X size={15} />}
                          onClick={() => {
                            const runId = activeRunId.current;
                            if (!runId) return;
                            setCancelling(true);
                            void cancelSfCommand(runId);
                          }}
                          disabled={cancelling}
                        >
                          {cancelling ? "Stopping…" : "Cancel"}
                        </Button>
                      )}

                      <Button
                        variant="secondary"
                        leftIcon={<RotateCcw size={15} />}
                        onClick={() => setInput(SNIPPETS[tab][0])}
                      >
                        Reset Snippet
                      </Button>

                      <select
                        className="soql-snippets"
                        value=""
                        onChange={(e) => {
                          if (e.target.value) setInput(e.target.value);
                        }}
                      >
                        <option value="">Quick snippets</option>
                        {SNIPPETS[tab].map((s) => (
                          <option key={s} value={s}>
                            {s.split(/[(\n]/)[0]}
                          </option>
                        ))}
                      </select>

                      {tab === "soql" && (
                        <label
                          className="soql-tooling"
                          title="Query Tooling API objects — ApexClass, ApexTrigger, Flow and the rest, which a plain query cannot see"
                        >
                          <input
                            type="checkbox"
                            checked={tooling}
                            onChange={(event) =>
                              setTooling(event.target.checked)
                            }
                          />
                          Tooling API
                        </label>
                      )}

                      <span className="soql-shortcut">
                        <kbd>Ctrl</kbd>+<kbd>↵</kbd> to run
                      </span>
                    </div>
                  </div>
                </Panel>

                <PanelResizeHandle className="soql-resize-handle" />

                <Panel>
                  <div className="soql-output-panel">
                    <div className="soql-output-header">
                      <div className="soql-output-title">
                        <strong>Output</strong>
                        {/* Rows *and* duration: the badge used to show one or
                            the other, so a successful query never reported how
                            long it took — the number you want when tuning. */}
                        <Badge tone={running ? "warning" : "default"} dot>
                          {running ? "Running" : (summary ?? "Idle")}
                        </Badge>
                      </div>

                      <div className="soql-output-tools">
                        {records && (
                          <div className="soql-view-toggle">
                            <button
                              className={view === "table" ? "active" : ""}
                              onClick={() => setView("table")}
                              title="Table view"
                            >
                              <Table2 size={14} /> Table
                            </button>
                            <button
                              className={view === "raw" ? "active" : ""}
                              onClick={() => setView("raw")}
                              title="Raw view"
                            >
                              <FileJson size={14} /> Raw
                            </button>
                          </div>
                        )}

                        {records && records.length > 0 && (
                          <div className="soql-export">
                            <button
                              className="soql-export-btn"
                              onClick={() => void exportRecords("csv")}
                              title="Save these rows as CSV"
                            >
                              <Download size={14} /> CSV
                            </button>
                            <button
                              className="soql-export-btn"
                              onClick={() => void exportRecords("json")}
                              title="Save these rows as JSON"
                            >
                              <Download size={14} /> JSON
                            </button>
                          </div>
                        )}

                        {output && (
                          <>
                            <button
                              className="soql-format-btn"
                              onClick={formatOutput}
                              title="Format JSON"
                              // Its only child is the glyph "{}", which is
                              // what a screen reader would otherwise read out.
                              aria-label="Format the JSON output"
                            >
                              {"{}"}
                            </button>
                            <button
                              className="soql-copy-btn"
                              onClick={copyOutput}
                              title="Copy output"
                            >
                              {copied ? (
                                <Check size={14} />
                              ) : (
                                <Copy size={14} />
                              )}
                              {copied ? "Copied" : "Copy"}
                            </button>
                            <button
                              className="soql-clear-btn"
                              onClick={() => setOutput("")}
                              title="Clear output"
                              aria-label="Clear the output"
                            >
                              <X size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {!running && rowCount >= LARGE_RESULT_ROWS && (
                      <div className="soql-output-warning">
                        <AlertTriangle size={14} />
                        <span>
                          {rowCount.toLocaleString()} rows came back. The whole
                          result is held in memory and drawn at once, so it is
                          slow to scroll and to copy — add a <code>LIMIT</code>{" "}
                          to keep it quick.
                        </span>
                      </div>
                    )}

                    {running ? (
                      <pre className="soql-output-pre soql-output-muted">
                        Running {TAB_LABELS[tab]}...
                      </pre>
                    ) : output ? (
                      records && records.length === 0 ? (
                        <pre className="soql-output-pre soql-output-muted">
                          0 rows — the query ran but matched nothing.
                        </pre>
                      ) : records && view === "table" ? (
                        <RecordTable
                          records={records}
                          headers={headers}
                          renderCell={renderCell}
                        />
                      ) : (
                        <pre className="soql-output-pre">{output}</pre>
                      )
                    ) : (
                      <pre className="soql-output-pre soql-output-muted">
                        No output yet. Run a query to see results.
                      </pre>
                    )}
                  </div>
                </Panel>
              </PanelGroup>
            </Panel>
            <PanelResizeHandle className="soql-h-resize-handle" />

            <Panel defaultSize={28} minSize={18} collapsible>
              <div className="soql-history-panel">
                <div className="soql-history-head">
                  <span className="soql-history-title">
                    <History size={14} /> History
                  </span>
                  <div className="soql-history-actions">
                    <button
                      onClick={clearHistory}
                      disabled={history.length === 0}
                      title="Clear history (all orgs)"
                      aria-label="Clear the query history for all orgs"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="soql-history-list">
                  {visibleHistory.length === 0 ? (
                    <p className="soql-history-empty">
                      {history.length === 0
                        ? "No history yet. Executed queries will appear here."
                        : `No history for ${org?.alias ?? "this org"} yet.`}
                    </p>
                  ) : (
                    visibleHistory.map(({ item, index: i }) => (
                      <div
                        className="soql-history-item"
                        key={`${i}-${item.value}`}
                      >
                        <button
                          className="soql-history-load"
                          onClick={() => loadFromHistory(item)}
                          title={`Load into the ${TAB_LABELS[item.tab]} tab`}
                        >
                          <span className="soql-history-tag">
                            {TAB_LABELS[item.tab]}
                          </span>
                          {item.value}
                        </button>
                        <button
                          className="soql-history-run"
                          onClick={() => runFromHistory(item)}
                          title="Run again"
                          aria-label="Run this query again"
                        >
                          <Play size={13} />
                        </button>
                        <button
                          className="soql-history-x"
                          onClick={() => removeHistory(i)}
                          title="Remove"
                          aria-label="Remove this query from the history"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </Panel>
          </PanelGroup>
        </div>
      </div>
    </OrgGuard>
  );
}
