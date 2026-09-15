import { memo, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Loader2, Play, Square, Trash2 } from "lucide-react";

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

/** One line of output. Memoised: streaming appends lines, and the ones
    already shown should not render again for each batch. */
const TerminalLine = memo(function TerminalLine({
  entry,
}: {
  entry: TerminalEntry;
}) {
  return (
    <div className={`workspace-terminal__line ${KIND_CLASS[entry.kind]}`}>
      <span className="workspace-terminal__time">{entry.time}</span>
      <span className="workspace-terminal__text">{entry.text}</span>
    </div>
  );
});

export default function WorkspaceTerminal() {
  const logs = useWorkspaceStore((state) => state.logs);
  const clearLogs = useWorkspaceStore((state) => state.clearLogs);
  const runTerminalCommand = useWorkspaceStore(
    (state) => state.runTerminalCommand,
  );
  const cancelTerminalCommand = useWorkspaceStore(
    (state) => state.cancelTerminalCommand,
  );
  const running = useWorkspaceStore((state) => state.terminalRun);
  const history = useWorkspaceStore((state) => state.terminalHistory);
  const deploying = useWorkspaceStore((state) => state.deploying);

  const [input, setInput] = useState("");
  // Where ↑/↓ is in the history; null while typing a new line.
  const [recall, setRecall] = useState<{ index: number; draft: string } | null>(
    null,
  );
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
    if (!line || running) return;
    stickBottom.current = true;
    void runTerminalCommand(line);
    setInput("");
    setRecall(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const field = event.currentTarget;
    if (event.key === "Enter") {
      event.preventDefault();
      handleSubmit();
      return;
    }

    // Ctrl+C stops the running command, as in a shell — unless text is
    // selected, when it copies as usual.
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "c" &&
      running &&
      field.selectionStart === field.selectionEnd
    ) {
      event.preventDefault();
      cancelTerminalCommand();
      return;
    }

    if (event.key === "ArrowUp" && history.length > 0) {
      event.preventDefault();
      const index = recall ? Math.max(recall.index - 1, 0) : history.length - 1;
      setRecall({ index, draft: recall?.draft ?? input });
      setInput(history[index]);
    } else if (event.key === "ArrowDown" && recall) {
      event.preventDefault();
      const index = recall.index + 1;
      if (index >= history.length) {
        // Past the newest: back to what was being typed.
        setInput(recall.draft);
        setRecall(null);
      } else {
        setRecall({ ...recall, index });
        setInput(history[index]);
      }
    }
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
            aria-label="Clear terminal"
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
        role="log"
        aria-label="Terminal output"
        // Output can stream by the hundreds of lines; how a command ended is
        // announced on its own, below.
        aria-live="off"
        // Scrollable from the keyboard.
        tabIndex={0}
      >
        {logs.length === 0 ? (
          <div className="workspace-terminal__placeholder">
            ForgeSF Terminal — type an <code>sf</code> command below.
          </div>
        ) : (
          logs.map((entry) => <TerminalLine key={entry.id} entry={entry} />)
        )}
      </div>

      <p className="workspace-terminal__sr-only" role="status">
        {running ? `Running ${running.line}` : ""}
      </p>

      <div className="workspace-terminal__input-row">
        <span className="workspace-terminal__prompt" aria-hidden>
          {running ? <Loader2 size={13} className="spinning" /> : "❯"}
        </span>
        <input
          type="text"
          className="workspace-terminal__input"
          placeholder={
            running
              ? "Running… Ctrl+C stops it"
              : "e.g. org display — ↑ for earlier commands"
          }
          aria-label="Terminal command"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setRecall(null);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        {running ? (
          <button
            type="button"
            className="workspace-terminal__run is-cancel"
            onClick={cancelTerminalCommand}
            title="Stop the running command (Ctrl+C)"
          >
            <Square size={12} /> Cancel
          </button>
        ) : (
          <button
            type="button"
            className="workspace-terminal__run"
            onClick={handleSubmit}
            disabled={!input.trim()}
            title="Run the command (Enter)"
          >
            <Play size={13} /> Run
          </button>
        )}
      </div>
    </div>
  );
}
