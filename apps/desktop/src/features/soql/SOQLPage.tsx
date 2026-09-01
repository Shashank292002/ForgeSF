import { useMemo, useRef, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import {
  TerminalSquare,
  Play,
  RotateCcw,
  Loader2,
  Copy,
  Check,
  Trash2,
  Table2,
  FileJson,
  History,
  X,
} from "lucide-react";

import { useOrganizationStore } from "../../store/orgStore";
import { runQuery, runCommand } from "../../services/tauri";
import { Button, Badge } from "../../components/ui";
import OrgGuard from "../../components/OrgGuard/OrgGuard";
import RecordTable from "./RecordTable";

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

const TAB_LABELS: Record<Tab, string> = {
  soql: "SOQL",
  sosl: "SOSL",
  apex: "Anonymous Apex",
  cli: "CLI",
};

interface HistoryEntry {
  tab: Tab;
  value: string;
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

export default function SOQLPage() {
  const org = useOrganizationStore((s) => s.selectedOrganization);
  const [tab, setTab] = useState<Tab>("soql");
  const [input, setInput] = useState<string>(SNIPPETS.soql[0]);
  const [output, setOutput] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<View>("table");
  const [copied, setCopied] = useState(false);
  const [executeMs, setExecuteMs] = useState<number | null>(null);

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
              ? { tab: (item.tab as Tab) ?? "soql", value: item.value }
              : null,
        )
        .filter((item): item is HistoryEntry => item !== null);
    } catch {
      return [];
    }
  });

  const copyTimer = useRef<number | null>(null);

  const records = useMemo(() => tryParseRecords(output), [output]);
  const rowCount = records?.length ?? 0;

  function pushHistory(entryTab: Tab, q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const next = [
        { tab: entryTab, value: trimmed },
        ...prev.filter((h) => !(h.value === trimmed && h.tab === entryTab)),
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
    fn: () => Promise<string>,
    historyTab: Tab,
    historyValue: string,
  ) {
    if (!org || running) return;

    setRunning(true);
    setOutput("");
    setCopied(false);
    setExecuteMs(null);

    const started = performance.now();

    try {
      const res = await fn();
      setOutput(res);
      if (historyValue) pushHistory(historyTab, historyValue.trim());
    } catch (err: unknown) {
      setOutput(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      setExecuteMs(Math.round(performance.now() - started));
    }
  }
  const runForTab = (override: string, forTab: Tab = tab) => {
    if (forTab === "soql")
      void runWith(
        async () => {
          if (!org) return "";
          return runQuery(org.username, override.trim());
        },
        forTab,
        override,
      );
    else if (forTab === "sosl")
      void runWith(
        async () => {
          if (!org) return "";
          return runCommand(
            [
              "data",
              "search",
              "--target-org",
              org.username,
              "--query",
              override.trim(),
              "--json",
            ],
            undefined,
          );
        },
        forTab,
        override,
      );
    else if (forTab === "apex")
      void runWith(
        async () => {
          if (!org) return "";
          return runCommand(
            ["apex", "execute", "--target-org", org.username, "--json"],
            override,
          );
        },
        forTab,
        override,
      );
    else
      void runWith(
        async () => {
          const parts = override.match(/(?:[^"\s]+|"[^"]*")+/g) || [];
          const args = parts.map((p) => p.replace(/^"|"$/g, ""));
          return runCommand(args, undefined);
        },
        forTab,
        override,
      );
  };

  const run = () => runForTab(input);

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
    runForTab(item.value, item.tab);
  }

  async function copyOutput() {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      if (copyTimer.current) window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable in some environments; ignore
    }
  }

  function formatOutput() {
    try {
      setOutput(JSON.stringify(JSON.parse(output), null, 2));
    } catch {
      // not valid JSON; leave as-is
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
                    <textarea
                      className="soql-input"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={onKeyDown}
                      spellCheck={false}
                      placeholder="Enter a query, command, or snippet…"
                    />

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
                        <Badge tone={running ? "warning" : "default"} dot>
                          {running
                            ? "Running"
                            : rowCount > 0 && records
                              ? `${rowCount} row${rowCount === 1 ? "" : "s"}`
                              : executeMs
                                ? `${executeMs}ms`
                                : "Idle"}
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

                        {output && (
                          <>
                            <button
                              className="soql-format-btn"
                              onClick={formatOutput}
                              title="Format JSON"
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
                            >
                              <X size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {running ? (
                      <pre className="soql-output-pre soql-output-muted">
                        Running {TAB_LABELS[tab]}...
                      </pre>
                    ) : output ? (
                      records && view === "table" ? (
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
                      title="Clear history"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                <div className="soql-history-list">
                  {history.length === 0 ? (
                    <p className="soql-history-empty">
                      No history yet. Executed queries will appear here.
                    </p>
                  ) : (
                    history.map((item, i) => (
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
                        >
                          <Play size={13} />
                        </button>
                        <button
                          className="soql-history-x"
                          onClick={() => removeHistory(i)}
                          title="Remove"
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
