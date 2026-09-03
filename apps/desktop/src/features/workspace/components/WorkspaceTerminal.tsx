import { useEffect, useRef, useState } from "react";
import { Play, Trash2 } from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import type { TerminalEntry } from "../types";

import "./WorkspaceTerminal.css";

const KIND_CLASS: Record<TerminalEntry["kind"], string> = {
  info: "is-info",
  success: "is-success",
  error: "is-error",
  cmd: "is-cmd",
  warning: "is-warning",
};

export default function WorkspaceTerminal() {
  const logs = useWorkspaceStore((state) => state.logs);
  const clearLogs = useWorkspaceStore((state) => state.clearLogs);
  const runTerminalCommand = useWorkspaceStore(
    (state) => state.runTerminalCommand,
  );
  const deploying = useWorkspaceStore((state) => state.deploying);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickBottom = useRef(true);

  useEffect(() => {
    if (!stickBottom.current || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [logs]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  const handleSubmit = () => {
    const line = input.trim();
    if (!line) return;
    void runTerminalCommand(line);
    setInput("");
  };

  return (
    <div className="workspace-terminal">
      <header className="workspace-terminal__header">
        <span className="workspace-terminal__title">TERMINAL</span>
        <div className="workspace-terminal__actions">
          {deploying && (
            <span className="workspace-terminal__deploying">Deploying…</span>
          )}
          <button
            type="button"
            title="Clear Terminal"
            onClick={clearLogs}
            className="workspace-terminal__action"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </header>

      <div
        className="workspace-terminal__output"
        ref={scrollRef}
        onScroll={handleScroll}
      >
        {logs.length === 0 ? (
          <div className="workspace-terminal__placeholder">
            ForgeSF Terminal — type an <code>sf</code> command below.
          </div>
        ) : (
          logs.map((entry) => (
            <div
              key={entry.id}
              className={`workspace-terminal__line ${KIND_CLASS[entry.kind]}`}
            >
              <span className="workspace-terminal__time">{entry.time}</span>
              <span className="workspace-terminal__text">{entry.text}</span>
            </div>
          ))
        )}
      </div>

      <div className="workspace-terminal__input-row">
        <span className="workspace-terminal__prompt">❯</span>
        <input
          type="text"
          className="workspace-terminal__input"
          placeholder="e.g. org display"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") handleSubmit();
          }}
          spellCheck={false}
        />
        <button
          type="button"
          className="workspace-terminal__run"
          onClick={handleSubmit}
          disabled={!input.trim()}
          title="Execute command"
        >
          <Play size={13} /> Run
        </button>
      </div>
    </div>
  );
}
