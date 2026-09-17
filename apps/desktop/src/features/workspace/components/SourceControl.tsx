import { useEffect, useMemo } from "react";
import {
  Check,
  CloudOff,
  GitBranch,
  History,
  Loader2,
  RotateCw,
  Save,
  Undo2,
} from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import { useOrganizationStore } from "../../../store/orgStore";
import { getBaseName } from "../lib/workspaceUtils";
import { confirm } from "../../../components/ui/Confirm/confirm";

import "./SourceControl.css";

type Marker = "M" | "A" | "D";

const MARKER_TITLE: Record<Marker, string> = {
  M: "Modified since the last retrieve or deploy",
  A: "Added since the last retrieve or deploy",
  D: "Deleted locally since the last retrieve or deploy",
};

/**
 * What differs from the org, and the actions to send it.
 *
 * Two lists: buffers not yet saved, and files changed on disk since the
 * workspace last matched its org (a retrieve or deploy). The panel used to
 * show only the first, so a file vanished from "pending" the moment it was
 * saved even though it had never been deployed.
 */
export default function SourceControl() {
  const dirty = useWorkspaceStore((state) => state.dirty);
  const deploying = useWorkspaceStore((state) => state.deploying);
  const saveAll = useWorkspaceStore((state) => state.saveAll);
  const revertFile = useWorkspaceStore((state) => state.revertFile);
  const runDeploy = useWorkspaceStore((state) => state.runDeploy);
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const changes = useWorkspaceStore((state) => state.changes);
  const changesLoading = useWorkspaceStore((state) => state.changesLoading);
  const changesError = useWorkspaceStore((state) => state.changesError);
  const loadChanges = useWorkspaceStore((state) => state.loadChanges);
  const resetBaseline = useWorkspaceStore((state) => state.resetBaseline);
  const deployChangedFiles = useWorkspaceStore(
    (state) => state.deployChangedFiles,
  );
  const openWorkspaceId = useWorkspaceStore((state) => state.openWorkspaceId);

  const organization = useOrganizationStore(
    (state) => state.selectedOrganization,
  );

  // Rescan whenever the panel opens or a different workspace is shown.
  useEffect(() => {
    void loadChanges();
  }, [loadChanges, openWorkspaceId]);

  const dirtyPaths = useMemo(() => Object.keys(dirty), [dirty]);

  const changed = useMemo(() => {
    if (!changes) return [];
    const rows: Array<{ path: string; marker: Marker }> = [
      ...changes.modified.map((path) => ({ path, marker: "M" as const })),
      ...changes.added.map((path) => ({ path, marker: "A" as const })),
      ...changes.deleted.map((path) => ({ path, marker: "D" as const })),
    ];
    return rows.sort((a, b) => a.path.localeCompare(b.path));
  }, [changes]);

  const deployableCount = changes
    ? changes.modified.length + changes.added.length
    : 0;

  return (
    <section className="workspace-scm">
      {/* The sidebar frame already titles this view; this row holds its tools. */}
      <div className="workspace-scm__header">
        <div className="workspace-scm__tools">
          {dirtyPaths.length > 0 && (
            <button
              type="button"
              className="workspace-scm__tool"
              title="Save All"
              aria-label="Save all files"
              onClick={() => void saveAll()}
            >
              <Save size={14} />
            </button>
          )}
          <button
            type="button"
            className="workspace-scm__tool"
            title="Rescan for changes"
            aria-label="Rescan for changes"
            onClick={() => void loadChanges()}
          >
            {changesLoading ? (
              <Loader2 size={14} className="spinning" />
            ) : (
              <RotateCw size={14} />
            )}
          </button>
        </div>
      </div>

      <div className="workspace-scm__body">
        {!organization ? (
          <div className="workspace-scm__empty">
            <CloudOff size={26} />
            <p>Connect an org to deploy changes.</p>
          </div>
        ) : (
          <>
            {/* ── Unsaved in the editor ─────────────────────────── */}
            {dirtyPaths.length > 0 && (
              <>
                <div className="workspace-scm__section">
                  Unsaved · {dirtyPaths.length}
                </div>
                <ul className="workspace-scm__list">
                  {dirtyPaths.map((path) => (
                    <li key={path} className="workspace-scm__item">
                      <button
                        type="button"
                        className="workspace-scm__file"
                        onClick={() => void selectFile(path)}
                        title={path}
                      >
                        <span
                          className="workspace-scm__marker"
                          title="Unsaved edits in the editor"
                        >
                          ●
                        </span>
                        <span className="workspace-scm__name">
                          {getBaseName(path)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="workspace-scm__op"
                        title="Discard unsaved edits"
                        aria-label={`Discard unsaved edits in ${getBaseName(path)}`}
                        onClick={() => void revertFile(path)}
                      >
                        <Undo2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/* ── Changed since the last sync ───────────────────── */}
            <div className="workspace-scm__section">
              Changed since last sync
              {changes?.baselineAt ? ` · ${changed.length}` : ""}
            </div>

            {changesError ? (
              <p className="workspace-scm__note is-error">{changesError}</p>
            ) : !changes ? (
              <p className="workspace-scm__note">Scanning…</p>
            ) : changes.baselineAt === null ? (
              <div className="workspace-scm__note">
                <p>
                  Changes are tracked from the next retrieve or deploy. If the
                  files already match the org, start tracking now.
                </p>
                <button
                  type="button"
                  className="workspace-scm__link"
                  onClick={() => void resetBaseline()}
                >
                  Start tracking from here
                </button>
              </div>
            ) : changed.length === 0 ? (
              <div className="workspace-scm__clean">
                <Check size={16} /> Matches the last retrieve or deploy
              </div>
            ) : (
              <ul className="workspace-scm__list">
                {changed.map(({ path, marker }) => (
                  <li key={`${marker}-${path}`} className="workspace-scm__item">
                    <button
                      type="button"
                      className="workspace-scm__file"
                      onClick={() => marker !== "D" && void selectFile(path)}
                      title={`${path}\n${MARKER_TITLE[marker]}`}
                      disabled={marker === "D"}
                    >
                      <span
                        className={`workspace-scm__marker is-${marker.toLowerCase()}`}
                      >
                        {marker}
                      </span>
                      <span className="workspace-scm__name">
                        {getBaseName(path)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {changes && changes.deleted.length > 0 && (
              <p className="workspace-scm__note">
                Deleted files are not removed from the org by a deploy.
              </p>
            )}

            {changes?.baselineAt && (
              <p className="workspace-scm__meta">
                <History size={12} />
                Tracking since {new Date(changes.baselineAt).toLocaleString()}
                <button
                  type="button"
                  className="workspace-scm__link"
                  onClick={async () => {
                    const proceed = await confirm({
                      title: "Mark the workspace as synced?",
                      message:
                        "The current files are taken as matching the org, and the changed list is cleared. Use this only when you know nothing here still needs deploying.",
                      confirmLabel: "Mark as synced",
                    });
                    if (proceed) void resetBaseline();
                  }}
                >
                  Mark as synced
                </button>
              </p>
            )}

            {changes?.git && (
              <p className="workspace-scm__meta">
                <GitBranch size={12} />
                git: {changes.git.length} uncommitted change
                {changes.git.length === 1 ? "" : "s"} in package directories
              </p>
            )}

            <div className="workspace-scm__deploy">
              <button
                type="button"
                className="workspace-scm__deploy-btn"
                disabled={deploying || deployableCount === 0}
                title={
                  deployableCount === 0
                    ? "No modified or added files"
                    : `Deploy ${deployableCount} file(s) to ${organization.alias}`
                }
                onClick={() => void deployChangedFiles()}
              >
                {deploying ? <Loader2 size={13} className="spinning" /> : null}
                Deploy changed ({deployableCount})
              </button>
            </div>
            <div className="workspace-scm__deploy">
              <button
                type="button"
                className="workspace-scm__deploy-btn workspace-scm__deploy-btn--secondary"
                disabled={deploying}
                onClick={() => void runDeploy(organization.username, true)}
              >
                Validate all
              </button>
              <button
                type="button"
                className="workspace-scm__deploy-btn workspace-scm__deploy-btn--secondary"
                disabled={deploying}
                onClick={() => void runDeploy(organization.username, false)}
              >
                Deploy all
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
