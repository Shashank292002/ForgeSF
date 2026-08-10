import { useMemo, useState } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { TerminalSquare, Play, RotateCcw, Loader2 } from "lucide-react";

import { useOrganizationStore } from "../../store/orgStore";
import { runQuery, runCommand } from "../../services/tauri";
import { Button, Badge } from "../../components/ui";
import OrgGuard from "../../components/OrgGuard/OrgGuard";

import "./SOQLPage.css";

type Tab = "soql" | "sosl" | "apex" | "cli";

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

function tryParseRecords(output: string) {
  try {
    const parsed = JSON.parse(output);
    if (parsed?.result?.records) return parsed.result.records;
    if (parsed?.records) return parsed.records;
    if (Array.isArray(parsed)) return parsed;
  } catch {
    return null;
  }
  return null;
}

const TAB_LABELS: Record<Tab, string> = {
  soql: "SOQL",
  sosl: "SOSL",
  apex: "Anonymous Apex",
  cli: "CLI",
};

export default function SOQLPage() {
  const org = useOrganizationStore((s) => s.selectedOrganization);
  const [tab, setTab] = useState<Tab>("soql");
  const [input, setInput] = useState<string>(SNIPPETS.soql[0]);
  const [output, setOutput] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("devtools.history") || "[]");
    } catch {
      return [];
    }
  });

  const records = useMemo(() => tryParseRecords(output), [output]);

  function pushHistory(q: string) {
    const h = [q, ...history].slice(0, 50);
    setHistory(h);
    localStorage.setItem("devtools.history", JSON.stringify(h));
  }

  async function executeSOQL() {
    if (!org) return;
    setRunning(true);
    setOutput("");
    try {
      const res = await runQuery(org.username, input);
      setOutput(res);
      pushHistory(input);
    } catch (err: unknown) {
      setOutput(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function executeSOSL() {
    if (!org) return;
    setRunning(true);
    setOutput("");
    try {
      const res = await runQuery(org.username, input);
      setOutput(res);
      pushHistory(input);
    } catch (err: unknown) {
      setOutput(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function executeApex() {
    if (!org) return;
    setRunning(true);
    setOutput("");
    try {
      const args = ["apex", "execute", "--target-org", org.username, "--json"];
      const res = await runCommand(args, input);
      setOutput(res);
    } catch (err: unknown) {
      setOutput(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function executeCLI() {
    if (!org) return;
    setRunning(true);
    setOutput("");
    try {
      const parts = input.match(/(?:[^"\s]+|"[^"]*")+/g) || [];
      const args = parts.map((p) => p.replace(/^"|"$/g, ""));
      const res = await runCommand(args, undefined);
      setOutput(res);
    } catch (err: unknown) {
      setOutput(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function run() {
    if (tab === "soql") void executeSOQL();
    else if (tab === "sosl") void executeSOSL();
    else if (tab === "apex") void executeApex();
    else void executeCLI();
  }

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
                Query and execute against your connected org.
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
              onClick={() => {
                setTab(t);
                setInput(SNIPPETS[t][0]);
              }}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        <PanelGroup direction="vertical" className="soql-panel-group">
          <Panel defaultSize={48} minSize={20}>
            <div className="soql-panel-content">
              <textarea
                className="soql-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                spellCheck={false}
              />

              <div className="soql-actions">
                <Button
                  variant="gradient"
                  leftIcon={running ? <Loader2 size={15} /> : <Play size={15} />}
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
              </div>
            </div>
          </Panel>

          <PanelResizeHandle className="soql-resize-handle" />

          <Panel>
            <div className="soql-output-panel">
              <div className="soql-output-header">
                <strong>Output</strong>
                <Badge tone={running ? "warning" : "default"} dot>
                  {running ? "Running" : "Idle"}
                </Badge>
              </div>

              {records ? (
                <div className="soql-records">
                  <table className="soql-record-table">
                    <thead>
                      <tr>
                        {Object.keys(records[0] || {}).map((k) => (
                          <th key={k}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((r: Record<string, unknown>, i: number) => (
                        <tr key={i}>
                          {Object.keys(records[0] || {}).map((k) => (
                            <td key={k}>
                              {String((r as Record<string, unknown>)[k] ?? "")}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <pre className="soql-output-pre">
                  {output || "No output yet. Run a query to see results."}
                </pre>
              )}
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </OrgGuard>
  );
}

