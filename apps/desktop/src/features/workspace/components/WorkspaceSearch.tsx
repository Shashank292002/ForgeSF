import {
  createElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  CaseSensitive,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Ellipsis,
  Regex,
  RotateCw,
  WholeWord,
  X,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { SearchFileResult, SearchMatch } from "@/types/generated";
import { useSearchStore } from "../store/searchStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { iconForFile } from "../lib/fileIcons";
import { getBaseName, getParentPath } from "../lib/workspaceUtils";
import { cls } from "../../../lib/cls";

import "./WorkspaceSearch.css";

/** Row height in px — must match `.fw-search__row` in WorkspaceSearch.css. */
const ROW_HEIGHT = 22;

type ResultRow =
  | { kind: "file"; file: SearchFileResult; collapsed: boolean }
  | { kind: "match"; file: SearchFileResult; match: SearchMatch };

function OptionToggle({
  label,
  shortcut,
  pressed,
  onToggle,
  children,
}: {
  label: string;
  shortcut: string;
  pressed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cls("fw-search__toggle", pressed && "is-on")}
      title={`${label} (${shortcut})`}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}

function MatchPreview({ match }: { match: SearchMatch }) {
  const { preview, previewStart, previewLength } = match;
  return (
    <span className="fw-search__preview">
      {preview.slice(0, previewStart)}
      <mark>{preview.slice(previewStart, previewStart + previewLength)}</mark>
      {preview.slice(previewStart + previewLength)}
    </span>
  );
}

/**
 * Find in files. Searches what is saved on disk across the whole workspace —
 * the old view only matched names of files in folders already opened.
 */
export default function WorkspaceSearch() {
  const query = useSearchStore((state) => state.query);
  const matchCase = useSearchStore((state) => state.matchCase);
  const wholeWord = useSearchStore((state) => state.wholeWord);
  const regex = useSearchStore((state) => state.regex);
  const include = useSearchStore((state) => state.include);
  const exclude = useSearchStore((state) => state.exclude);
  const showFilters = useSearchStore((state) => state.showFilters);
  const searching = useSearchStore((state) => state.searching);
  const results = useSearchStore((state) => state.results);
  const error = useSearchStore((state) => state.error);
  const collapsed = useSearchStore((state) => state.collapsed);
  const setQuery = useSearchStore((state) => state.setQuery);
  const setOptions = useSearchStore((state) => state.setOptions);
  const toggleFilters = useSearchStore((state) => state.toggleFilters);
  const run = useSearchStore((state) => state.run);
  const clear = useSearchStore((state) => state.clear);
  const toggleFile = useSearchStore((state) => state.toggleFile);
  const setAllCollapsed = useSearchStore((state) => state.setAllCollapsed);

  const openFileAt = useWorkspaceStore((state) => state.openFileAt);
  const focusSeq = useWorkspaceStore((state) => state.searchFocusSeq);
  const unsavedCount = useWorkspaceStore(
    (state) => Object.keys(state.dirty).length,
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // Focus lands in the query when the view opens, and on Ctrl+Shift+F.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusSeq]);

  // A query kept from before — typed in another workspace, say — searches
  // again when the view comes back.
  useEffect(() => {
    const state = useSearchStore.getState();
    if (state.query && !state.results && !state.searching && !state.error) {
      void state.run();
    }
  }, []);

  const rows = useMemo<ResultRow[]>(
    () =>
      (results?.files ?? []).flatMap((file) => {
        const folded = collapsed.has(file.path);
        return [
          { kind: "file" as const, file, collapsed: folded },
          ...(folded
            ? []
            : file.matches.map((match) => ({
                kind: "match" as const,
                file,
                match,
              }))),
        ];
      }),
    [results, collapsed],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Keyboard focus in the results; a new search starts again from the top.
  const [focus, setFocus] = useState({ results, index: 0 });
  const focusIndex =
    focus.results === results
      ? Math.min(focus.index, Math.max(rows.length - 1, 0))
      : 0;
  const focusRow = (index: number) => {
    const next = Math.min(Math.max(index, 0), rows.length - 1);
    setFocus({ results, index: next });
    virtualizer.scrollToIndex(next, { align: "auto" });
  };

  const openMatch = (row: ResultRow, focusEditor: boolean) => {
    if (row.kind === "file") {
      toggleFile(row.file.path);
      return;
    }
    void openFileAt(row.file.path, {
      line: row.match.line,
      column: row.match.column,
      length: row.match.length,
      focus: focusEditor,
    });
  };

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Alt+C / Alt+W / Alt+R flip the options, as in VS Code.
    if (event.altKey && !event.ctrlKey && !event.metaKey) {
      const option =
        event.code === "KeyC"
          ? { matchCase: !matchCase }
          : event.code === "KeyW"
            ? { wholeWord: !wholeWord }
            : event.code === "KeyR"
              ? { regex: !regex }
              : null;
      if (option) {
        event.preventDefault();
        setOptions(option);
      }
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      void run();
    } else if (event.key === "ArrowDown" && rows.length > 0) {
      event.preventDefault();
      listRef.current?.focus();
    } else if (event.key === "Escape" && query) {
      event.preventDefault();
      clear();
    }
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const row = rows[focusIndex];
    if (!row) return;
    let handled = true;
    switch (event.key) {
      case "ArrowDown":
        focusRow(focusIndex + 1);
        break;
      case "ArrowUp":
        if (focusIndex === 0) inputRef.current?.focus();
        else focusRow(focusIndex - 1);
        break;
      case "Home":
        focusRow(0);
        break;
      case "End":
        focusRow(rows.length - 1);
        break;
      case "PageDown":
        focusRow(focusIndex + 10);
        break;
      case "PageUp":
        focusRow(focusIndex - 10);
        break;
      case "ArrowRight":
        if (row.kind === "file") {
          if (row.collapsed) toggleFile(row.file.path);
          else focusRow(focusIndex + 1);
        }
        break;
      case "ArrowLeft":
        if (row.kind === "file") {
          if (!row.collapsed) toggleFile(row.file.path);
        } else {
          focusRow(rows.findIndex((item) => item.file === row.file));
        }
        break;
      case "Enter":
        openMatch(row, true);
        break;
      case " ":
        // Shows the match but keeps focus here, to look through several.
        openMatch(row, false);
        break;
      case "Escape":
        inputRef.current?.focus();
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };

  const fileCount = results?.files.length ?? 0;
  const matchCount = results?.matchCount ?? 0;
  const allCollapsed = fileCount > 0 && collapsed.size >= fileCount;
  const filtersActive = Boolean(include.trim() || exclude.trim());
  const rowId = (index: number) => `${listId}-row-${index}`;

  let summary: ReactNode = null;
  if (error) {
    summary = (
      <p className="fw-search__error" role="alert">
        {error}
      </p>
    );
  } else if (searching && !results) {
    summary = <p className="fw-search__summary">Searching…</p>;
  } else if (results && query) {
    summary = (
      <p className="fw-search__summary" role="status">
        {matchCount === 0
          ? filtersActive
            ? "No results. Check the include and exclude patterns too."
            : "No results."
          : `${matchCount.toLocaleString()} result${matchCount === 1 ? "" : "s"} in ${fileCount} file${fileCount === 1 ? "" : "s"}`}
        {results.limitHit &&
          ` — stopped at ${matchCount.toLocaleString()}. Narrow the search to see the rest.`}
        {searching && " · Searching…"}
      </p>
    );
  }

  return (
    <section className="fw-search">
      <div className="fw-search__form">
        <div className="fw-search__query">
          <div className="fw-search__field">
            <input
              ref={inputRef}
              className="fw-search__input"
              type="text"
              value={query}
              placeholder="Search"
              aria-label="Search in files"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
            />
            <OptionToggle
              label="Match Case"
              shortcut="Alt+C"
              pressed={matchCase}
              onToggle={() => setOptions({ matchCase: !matchCase })}
            >
              <CaseSensitive size={15} />
            </OptionToggle>
            <OptionToggle
              label="Match Whole Word"
              shortcut="Alt+W"
              pressed={wholeWord}
              onToggle={() => setOptions({ wholeWord: !wholeWord })}
            >
              <WholeWord size={15} />
            </OptionToggle>
            <OptionToggle
              label="Use Regular Expression"
              shortcut="Alt+R"
              pressed={regex}
              onToggle={() => setOptions({ regex: !regex })}
            >
              <Regex size={14} />
            </OptionToggle>
          </div>
          <button
            type="button"
            className={cls("fw-search__tool", filtersActive && "is-on")}
            title="Files to include or exclude"
            aria-label="Files to include or exclude"
            aria-expanded={showFilters}
            onClick={toggleFilters}
          >
            <Ellipsis size={15} />
          </button>
        </div>

        {showFilters && (
          <div className="fw-search__filters">
            <label className="fw-search__filter">
              <span>files to include</span>
              <input
                className="fw-search__input fw-search__input--boxed"
                type="text"
                value={include}
                placeholder="e.g. *.cls, lwc"
                spellCheck={false}
                onChange={(event) =>
                  setOptions({ include: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") void run();
                }}
              />
            </label>
            <label className="fw-search__filter">
              <span>files to exclude</span>
              <input
                className="fw-search__input fw-search__input--boxed"
                type="text"
                value={exclude}
                placeholder="e.g. **/__tests__"
                spellCheck={false}
                onChange={(event) =>
                  setOptions({ exclude: event.target.value })
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") void run();
                }}
              />
            </label>
          </div>
        )}

        <div className="fw-search__status">
          {summary ?? (
            <p className="fw-search__summary fw-search__summary--hint">
              Searches file contents across the workspace. Ctrl+P finds files by
              name.
            </p>
          )}
          {results && fileCount > 0 && (
            <div className="fw-search__actions">
              <button
                type="button"
                className="fw-search__tool"
                title="Search again"
                aria-label="Search again"
                onClick={() => void run()}
              >
                <RotateCw
                  size={13}
                  className={searching ? "spinning" : undefined}
                />
              </button>
              <button
                type="button"
                className="fw-search__tool"
                title={allCollapsed ? "Expand all" : "Collapse all"}
                aria-label={allCollapsed ? "Expand all" : "Collapse all"}
                onClick={() => setAllCollapsed(!allCollapsed)}
              >
                {allCollapsed ? (
                  <ChevronsUpDown size={14} />
                ) : (
                  <ChevronsDownUp size={14} />
                )}
              </button>
              <button
                type="button"
                className="fw-search__tool"
                title="Clear search"
                aria-label="Clear search"
                onClick={clear}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
        {unsavedCount > 0 && results && (
          <p className="fw-search__summary fw-search__summary--hint">
            {unsavedCount === 1 ? "A file has" : `${unsavedCount} files have`}{" "}
            unsaved changes, which aren&rsquo;t searched until saved.
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <div
          ref={listRef}
          className="fw-search__results"
          role="tree"
          aria-label="Search results"
          tabIndex={0}
          aria-activedescendant={rowId(focusIndex)}
          onKeyDown={onListKeyDown}
        >
          <div
            className="fw-search__rows"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index];
              const focused = virtualRow.index === focusIndex;
              const style = {
                transform: `translateY(${virtualRow.start}px)`,
                height: ROW_HEIGHT,
              };

              if (row.kind === "file") {
                const name = getBaseName(row.file.path);
                return (
                  <div
                    key={`file:${row.file.path}`}
                    id={rowId(virtualRow.index)}
                    className={cls(
                      "fw-search__row fw-search__row--file",
                      focused && "is-focused",
                    )}
                    style={style}
                    role="treeitem"
                    aria-level={1}
                    aria-expanded={!row.collapsed}
                    aria-selected={focused}
                    title={row.file.path}
                    onClick={() => {
                      setFocus({ results, index: virtualRow.index });
                      toggleFile(row.file.path);
                    }}
                  >
                    <ChevronRight
                      size={14}
                      className={cls(
                        "fw-search__chevron",
                        !row.collapsed && "is-open",
                      )}
                    />
                    {createElement(iconForFile(name, "file"), {
                      size: 14,
                      className: "fw-search__file-icon",
                    })}
                    <span className="fw-search__file-name">{name}</span>
                    <span className="fw-search__file-path">
                      {getParentPath(row.file.path)}
                    </span>
                    <span className="fw-search__count">
                      {row.file.matches.length}
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={`match:${row.file.path}:${row.match.line}:${row.match.column}`}
                  id={rowId(virtualRow.index)}
                  className={cls(
                    "fw-search__row fw-search__row--match",
                    focused && "is-focused",
                  )}
                  style={style}
                  role="treeitem"
                  aria-level={2}
                  aria-selected={focused}
                  aria-label={`Line ${row.match.line}: ${row.match.preview.trim()}`}
                  title={`Line ${row.match.line}, column ${row.match.column}`}
                  onClick={() => {
                    setFocus({ results, index: virtualRow.index });
                    openMatch(row, true);
                  }}
                >
                  <MatchPreview match={row.match} />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
