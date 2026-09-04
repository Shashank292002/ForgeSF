import { useEffect, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { ArrowLeft, Check, FileWarning, GitCompare, X } from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import { useDialog } from "../../../hooks/useDialog";
import { readDiffPair } from "../services/workspaceService";
import { languageForPath } from "../lib/editorLanguage";
import { registerApexLanguage, defineForgeTheme } from "../lib/apexLanguage";
import type { Monaco } from "../lib/monaco";
import { getBaseName } from "../lib/workspaceUtils";
import type { DiffEntry, DiffPair, DiffStatus } from "../types";

import "./WorkspaceDiff.css";

const STATUS_LABEL: Record<DiffStatus, string> = {
  changed: "Changed",
  identical: "Identical",
  localOnly: "Local only",
  orgOnly: "Org only",
  binary: "Not a text file",
};

/** Sort order: what needs attention first. */
const STATUS_RANK: Record<DiffStatus, number> = {
  changed: 0,
  localOnly: 1,
  orgOnly: 2,
  binary: 3,
  identical: 4,
};

function handleBeforeMount(monaco: Monaco) {
  registerApexLanguage(monaco);
  defineForgeTheme(monaco);
}

/**
 * Diff Check overlay: the workspace on the right, the org on the left.
 *
 * A folder opens on its changed-file list — a `classes/` folder can hold
 * hundreds of files, so opening every diff at once would be unusable.
 */
export default function WorkspaceDiff() {
  const session = useWorkspaceStore((state) => state.diffSession);
  const loading = useWorkspaceStore((state) => state.diffLoading);
  const error = useWorkspaceStore((state) => state.diffError);
  const closeDiff = useWorkspaceStore((state) => state.closeDiff);

  const [selected, setSelected] = useState<string | null>(null);
  const [pair, setPair] = useState<DiffPair | null>(null);
  const [pairError, setPairError] = useState<string | null>(null);

  const entries: DiffEntry[] = session
    ? [...session.entries].sort(
        (a, b) =>
          STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
          a.path.localeCompare(b.path),
      )
    : [];

  // A single-file check has nowhere to drill into, so open its diff directly.
  const single =
    session && session.entries.length === 1 ? session.entries[0] : null;
  const active = selected ?? single?.path ?? null;

  // Escape steps back out of a file before closing the whole overlay.
  const dialogRef = useDialog(() => {
    if (selected && !single) setSelected(null);
    else closeDiff();
  });

  useEffect(() => {
    if (!session || !active) return;

    let cancelled = false;

    // Reads happen inside the async function rather than the effect body, so
    // nothing is set synchronously during render.
    const load = async () => {
      setPair(null);
      setPairError(null);
      try {
        const result = await readDiffPair(session.sessionDir, active);
        if (!cancelled) setPair(result);
      } catch (caught) {
        if (!cancelled) {
          setPairError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [session, active]);

  const changedCount = entries.filter((e) => e.status !== "identical").length;

  return (
    <div
      className="fw-diff-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeDiff();
      }}
    >
      <div
        className="fw-diff"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Diff Check"
        tabIndex={-1}
      >
        <header className="fw-diff__head">
          {active && !single && (
            <button
              type="button"
              className="fw-diff__back"
              title="Back to the file list"
              onClick={() => setSelected(null)}
            >
              <ArrowLeft size={15} />
            </button>
          )}

          <span className="fw-diff__mark">
            <GitCompare size={16} />
          </span>

          <div className="fw-diff__titles">
            <span className="fw-diff__title">
              {active ? getBaseName(active) : (session?.target ?? "Diff Check")}
            </span>
            <span className="fw-diff__sub">
              {active ?? "Local workspace compared with the org"}
            </span>
          </div>

          <button
            type="button"
            className="fw-diff__close"
            title="Close"
            onClick={closeDiff}
          >
            <X size={16} />
          </button>
        </header>

        <div className="fw-diff__body">
          {loading && (
            <div className="fw-diff__state">
              <span className="forge-ws__boot-spinner" />
              <p>Retrieving the org&rsquo;s version to compare…</p>
            </div>
          )}

          {!loading && error && (
            <div className="fw-diff__state is-error">
              <FileWarning size={26} />
              <p>{error}</p>
            </div>
          )}

          {!loading && !error && session && !active && (
            <>
              <div className="fw-diff__summary">
                {changedCount === 0
                  ? "No differences — the workspace matches the org."
                  : `${changedCount} file(s) differ from the org.`}
              </div>

              <div className="fw-diff__list">
                {entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    className={`fw-diff__row is-${entry.status}`}
                    disabled={
                      entry.status === "identical" || entry.status === "binary"
                    }
                    onClick={() => setSelected(entry.path)}
                    title={entry.path}
                  >
                    <span className="fw-diff__status">
                      {STATUS_LABEL[entry.status]}
                    </span>
                    <span className="fw-diff__path">{entry.path}</span>
                    <span className="fw-diff__lines">
                      {entry.status === "identical" ? (
                        <Check size={13} />
                      ) : (
                        `${entry.orgLines} → ${entry.localLines}`
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {!loading && !error && active && pairError && (
            <div className="fw-diff__state is-error">
              <FileWarning size={26} />
              <p>{pairError}</p>
            </div>
          )}

          {!loading && !error && active && !pairError && pair && (
            <div className="fw-diff__editor">
              <div className="fw-diff__legend">
                <span>Org</span>
                <span>Workspace</span>
              </div>
              <DiffEditor
                height="100%"
                theme="forge-dark"
                language={languageForPath(active)}
                original={pair.org}
                modified={pair.local}
                beforeMount={handleBeforeMount}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  fontSize: 13,
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  minimap: { enabled: false },
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
