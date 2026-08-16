import { useMemo } from "react";
import { Check, CloudOff, GitBranch, Loader2, RotateCw, Save, Undo2 } from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import { useOrganizationStore } from "../../../store/orgStore";
import { getBaseName } from "../lib/workspaceUtils";

import "./SourceControl.css";

export default function SourceControl() {
  const dirty = useWorkspaceStore((state) => state.dirty);
  const deploying = useWorkspaceStore((state) => state.deploying);
  const refreshFiles = useWorkspaceStore((state) => state.refreshFiles);
  const saveAll = useWorkspaceStore((state) => state.saveAll);
  const revertFile = useWorkspaceStore((state) => state.revertFile);
  const runDeploy = useWorkspaceStore((state) => state.runDeploy);
  const selectFile = useWorkspaceStore((state) => state.selectFile);

  const organization = useOrganizationStore(
    (state) => state.selectedOrganization,
  );

  const dirtyPaths = useMemo(() => Object.keys(dirty), [dirty]);

  return (
    <section className="workspace-scm">
      <div className="workspace-scm__header">
        <div className="workspace-scm__title">
          <GitBranch size={14} /> SOURCE CONTROL
        </div>
        <div className="workspace-scm__tools">
          {dirtyPaths.length > 0 && (
            <button
              type="button"
              className="workspace-scm__tool"
              title="Save All"
              onClick={() => void saveAll()}
            >
              <Save size={14} />
            </button>
          )}
          <button
            type="button"
            className="workspace-scm__tool"
            title="Refresh"
            onClick={() => void refreshFiles()}
          >
            <RotateCw size={14} />
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
            <div className="workspace-scm__changes">
              {dirtyPaths.length === 0 ? (
                <div className="workspace-scm__clean">
                  <Check size={16} /> No changes
                </div>
              ) : (
                <div className="workspace-scm__count">
                  {dirtyPaths.length} changed file{dirtyPaths.length === 1 ? "" : "s"}
                </div>
              )}
            </div>

            {dirtyPaths.length > 0 && (
              <ul className="workspace-scm__list">
                {dirtyPaths.map((path) => (
                  <li key={path} className="workspace-scm__item">
                    <button
                      type="button"
                      className="workspace-scm__file"
                      onClick={() => void selectFile(path)}
                      title={path}
                    >
                      <span className="workspace-scm__marker">M</span>
                      <span className="workspace-scm__name">{getBaseName(path)}</span>
                    </button>
                    <button
                      type="button"
                      className="workspace-scm__op"
                      title="Revert file"
                      onClick={() => void revertFile(path)}
                    >
                      <Undo2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="workspace-scm__deploy">
              <button
                type="button"
                className="workspace-scm__deploy-btn workspace-scm__deploy-btn--secondary"
                disabled={deploying}
                onClick={() => void runDeploy(organization.username, true)}
              >
                {deploying ? <Loader2 size={13} className="spinning" /> : null}
                Validate
              </button>
              <button
                type="button"
                className="workspace-scm__deploy-btn"
                disabled={deploying}
                onClick={() => void runDeploy(organization.username, false)}
              >
                {deploying ? <Loader2 size={13} className="spinning" /> : null}
                Deploy
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}