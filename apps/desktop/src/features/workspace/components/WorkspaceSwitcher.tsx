import { useEffect, useRef, useState } from "react";
import { Check, FolderGit2, FolderPlus } from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import { useOrganizationStore } from "../../../store/orgStore";

import "./WorkspaceSwitcher.css";

/**
 * Status-bar control for switching between registered projects.
 *
 * Each project lists the org it is associated with, since that is what opening
 * it will restore.
 */
export default function WorkspaceSwitcher() {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore((state) => state.activeWorkspaceId);
  const workspaceName = useWorkspaceStore((state) => state.workspaceName);
  const switchWorkspace = useWorkspaceStore((state) => state.switchWorkspace);
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace);
  const organizations = useOrganizationStore((state) => state.organizations);

  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      // Checking containment rather than closing on any mousedown: a bare
      // listener swallows the click before the menu button ever receives it.
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Each folder belongs to an org; the label is what switching to it selects.
  const orgLabelFor = (orgId: string | null | undefined) => {
    if (!orgId) return null;
    return organizations.find((org) => org.id === orgId)?.alias ?? null;
  };

  return (
    <div className="workspace-switcher" ref={rootRef}>
      <button
        type="button"
        className="workspace-statusbar__item workspace-switcher__trigger"
        title="Switch workspace"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <FolderGit2 size={12} />
        {workspaceName || "workspace"}
      </button>

      {open && (
        <div className="workspace-switcher__menu" role="menu">
          <div className="workspace-switcher__heading">
            Workspaces · one per org
          </div>

          {workspaces.length === 0 ? (
            <div className="workspace-switcher__empty">
              No folders yet — connect an org and one is created for it.
            </div>
          ) : (
            workspaces.map((workspace) => {
              const isActive = workspace.id === activeWorkspaceId;
              const org = orgLabelFor(workspace.orgId ?? workspace.lastOrgId);

              return (
                <button
                  key={workspace.id}
                  type="button"
                  role="menuitem"
                  className={`workspace-switcher__item ${
                    isActive ? "is-active" : ""
                  }`}
                  title={workspace.path}
                  onClick={() => {
                    setOpen(false);
                    void switchWorkspace(workspace.id);
                  }}
                >
                  <span className="workspace-switcher__check">
                    {isActive && <Check size={12} strokeWidth={3} />}
                  </span>
                  <span className="workspace-switcher__label">
                    <span className="workspace-switcher__name">
                      {workspace.name}
                    </span>
                    <span className="workspace-switcher__path">
                      {workspace.path}
                    </span>
                  </span>
                  {org && <span className="workspace-switcher__org">{org}</span>}
                </button>
              );
            })
          )}

          <div className="workspace-switcher__sep" role="separator" />

          <button
            type="button"
            role="menuitem"
            className="workspace-switcher__item workspace-switcher__add"
            onClick={() => {
              setOpen(false);
              void addWorkspace();
            }}
          >
            <span className="workspace-switcher__check">
              <FolderPlus size={13} />
            </span>
            <span className="workspace-switcher__label">
              Use a different folder for this org…
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
