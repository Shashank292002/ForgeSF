import {
  createElement,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { CornerDownLeft, Terminal } from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import { useDialog } from "../../../hooks/useDialog";
import { listWorkspaceFiles } from "../services/workspaceService";
import { highlightParts } from "../lib/fuzzy";
import { iconForFile } from "../lib/fileIcons";
import { getBaseName } from "../lib/workspaceUtils";
import {
  commandKeys,
  commandLabel,
  type WorkspaceCommand,
} from "../lib/workspaceCommands";
import { quickItems, quickMode, type QuickItem } from "../lib/quickOpen";
import { cls } from "../../../lib/cls";

import "./QuickInput.css";

/* ─── The file list, loaded when Quick Open needs it ──────────── */

/** The last list read, shown straight away while a fresh one loads. */
let lastIndex: { workspaceId: string | null; files: string[] } | null = null;

function useFileIndex(workspaceId: string | null, wanted: boolean) {
  const [index, setIndex] = useState(() => ({
    files:
      lastIndex && lastIndex.workspaceId === workspaceId
        ? lastIndex.files
        : null,
    error: null as string | null,
  }));

  useEffect(() => {
    if (!wanted) return;
    let current = true;
    listWorkspaceFiles(workspaceId).then(
      (list) => {
        lastIndex = { workspaceId, files: list.files };
        if (current) setIndex({ files: list.files, error: null });
      },
      (error: unknown) => {
        if (!current) return;
        setIndex((previous) => ({
          ...previous,
          error: `Could not list the workspace's files — ${error instanceof Error ? error.message : String(error)}`,
        }));
      },
    );
    return () => {
      current = false;
    };
  }, [workspaceId, wanted]);

  return index;
}

/* ─── Rendering helpers ───────────────────────────────────────── */

function Highlighted({
  text,
  positions,
  offset = 0,
}: {
  text: string;
  positions: number[];
  offset?: number;
}) {
  return (
    <>
      {highlightParts(text, positions, offset).map((part, index) =>
        part.match ? (
          <mark key={index}>{part.text}</mark>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </>
  );
}

function ItemContent({
  item,
  activeFile,
}: {
  item: Exclude<QuickItem, { kind: "message" }>;
  activeFile: string | null;
}) {
  if (item.kind === "command") {
    return (
      <>
        <Terminal size={14} className="fw-quick__icon" />
        <span className="fw-quick__label">
          <Highlighted
            text={commandLabel(item.command)}
            positions={item.positions}
          />
        </span>
        {commandKeys(item.command).length > 0 && (
          <kbd className="fw-quick__keys">{commandKeys(item.command)[0]}</kbd>
        )}
      </>
    );
  }

  if (item.kind === "line") {
    return (
      <>
        <CornerDownLeft size={14} className="fw-quick__icon" />
        <span className="fw-quick__label">
          Go to line {item.line}
          {item.column > 1 ? `, column ${item.column}` : ""}
        </span>
        <span className="fw-quick__detail">
          {activeFile ? getBaseName(activeFile) : ""}
        </span>
      </>
    );
  }

  const name = getBaseName(item.path);
  const nameStart = item.path.length - name.length;
  const folder = item.path.slice(0, Math.max(0, nameStart - 1));
  return (
    <>
      {createElement(iconForFile(name, "file"), {
        size: 15,
        className: "fw-quick__icon",
      })}
      <span className="fw-quick__label">
        <Highlighted
          text={name}
          positions={item.positions}
          offset={nameStart}
        />
      </span>
      <span className="fw-quick__detail">
        <Highlighted text={folder} positions={item.positions} />
      </span>
      {item.line !== null && (
        <span className="fw-quick__keys">Line {item.line}</span>
      )}
    </>
  );
}

/**
 * An option's name for assistive technology. The visible label is split up
 * by the highlighted characters, which would otherwise be read in pieces.
 */
function itemLabel(
  item: Exclude<QuickItem, { kind: "message" }>,
  activeFile: string | null,
): string {
  if (item.kind === "command") {
    const [keys] = commandKeys(item.command);
    return keys
      ? `${commandLabel(item.command)}, ${keys}`
      : commandLabel(item.command);
  }
  if (item.kind === "line") {
    const where = activeFile ? ` in ${getBaseName(activeFile)}` : "";
    return `Go to line ${item.line}${item.column > 1 ? `, column ${item.column}` : ""}${where}`;
  }
  const folder = item.path.slice(0, item.path.lastIndexOf("/"));
  const at = item.line !== null ? `, line ${item.line}` : "";
  return `${getBaseName(item.path)}${folder ? `, ${folder}` : ""}${at}`;
}

const PLACEHOLDERS = {
  files:
    "Search files by name — add :line to go to a line, type > for commands",
  commands: "Type a command",
  line: "Type a line number",
} as const;

const LABELS = {
  files: "Go to file",
  commands: "Command palette",
  line: "Go to line",
} as const;

/* ─── Quick Open / command palette ────────────────────────────── */

function QuickInputPanel({
  initialText,
  commands,
}: {
  initialText: string;
  commands: WorkspaceCommand[];
}) {
  const close = useWorkspaceStore((state) => state.closeQuickInput);
  const openFileAt = useWorkspaceStore((state) => state.openFileAt);
  const activeFile = useWorkspaceStore((state) => state.selectedFile);
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  const workspaceId = useWorkspaceStore((state) => state.openWorkspaceId);

  const [text, setText] = useState(initialText);
  const [active, setActive] = useState(0);
  const mode = quickMode(text);
  const index = useFileIndex(workspaceId, mode === "files");
  // Escape closes it, Tab stays inside, and focus goes back where it was.
  const dialogRef = useDialog(close);
  const listId = useId();

  const items = useMemo(
    () =>
      quickItems({
        text,
        files: index.files,
        filesError: index.error,
        openFiles,
        activeFile,
        commands,
      }),
    [text, index, openFiles, activeFile, commands],
  );
  const choices = items[0]?.kind === "message" ? 0 : items.length;
  const activeIndex = choices === 0 ? -1 : Math.min(active, choices - 1);

  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(`${listId}-option-${activeIndex}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, listId]);

  const run = (item: QuickItem | undefined) => {
    if (!item || item.kind === "message") return;
    close();
    if (item.kind === "command") {
      void item.command.run();
    } else if (item.kind === "line") {
      if (activeFile) {
        void openFileAt(activeFile, { line: item.line, column: item.column });
      }
    } else {
      void openFileAt(
        item.path,
        item.line === null
          ? undefined
          : { line: item.line, column: item.column },
      );
    }
  };

  const move = (delta: number) => {
    if (choices === 0) return;
    setActive((current) => {
      const from = Math.min(current, choices - 1);
      return (from + delta + choices) % choices;
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "PageDown":
        event.preventDefault();
        setActive(() => Math.min(Math.max(activeIndex, 0) + 10, choices - 1));
        break;
      case "PageUp":
        event.preventDefault();
        setActive(() => Math.max(activeIndex - 10, 0));
        break;
      case "Enter":
        event.preventDefault();
        run(items[activeIndex]);
        break;
    }
  };

  return (
    <div
      className="fw-quick__backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        className="fw-quick"
        role="dialog"
        aria-modal="true"
        aria-label={LABELS[mode]}
      >
        <input
          data-autofocus
          className="fw-quick__input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined
          }
          value={text}
          placeholder={PLACEHOLDERS[mode]}
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul
          id={listId}
          className="fw-quick__list"
          role="listbox"
          aria-label={LABELS[mode]}
        >
          {items.map((item, position) =>
            item.kind === "message" ? (
              <li
                key="message"
                className="fw-quick__message"
                role="presentation"
              >
                {item.text}
              </li>
            ) : (
              <li
                key={
                  item.kind === "command"
                    ? item.command.id
                    : item.kind === "line"
                      ? "line"
                      : item.path
                }
                id={`${listId}-option-${position}`}
                className={cls(
                  "fw-quick__item",
                  position === activeIndex && "is-active",
                )}
                role="option"
                aria-label={itemLabel(item, activeFile)}
                aria-selected={position === activeIndex}
                onMouseMove={() => {
                  if (position !== activeIndex) setActive(position);
                }}
                // Keeps focus in the input, so typing can go on after a click.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => run(item)}
              >
                <ItemContent item={item} activeFile={activeFile} />
              </li>
            ),
          )}
        </ul>
      </div>
    </div>
  );
}

/**
 * Quick Open (Ctrl+P) and the command palette (Ctrl+Shift+P): one input,
 * whose first character picks what it lists.
 */
export default function QuickInput({
  commands,
}: {
  commands: WorkspaceCommand[];
}) {
  const request = useWorkspaceStore((state) => state.quickInput);
  if (!request) return null;
  // Keyed, so opening it again — Ctrl+Shift+P while it lists files — starts
  // afresh with the new text.
  return (
    <QuickInputPanel
      key={request.seq}
      initialText={request.text}
      commands={commands}
    />
  );
}
