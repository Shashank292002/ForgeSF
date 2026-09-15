import { useRef, useState } from "react";
import { Check, FolderGit2, FolderPlus } from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import { useOrganizationStore } from "../../../store/orgStore";
import { Menu, MenuItem, MenuSeparator } from "../../../components/ui";

import "./WorkspaceSwitcher.css";

/**
 * Status-bar control for switching between registered projects.
 *
 * Each project lists the org it is associated with, since that is what opening
 * it will restore.
 */
export default function WorkspaceSwitcher() {
  const workspaces = useWorkspaceStore((state) => state.workspaces);
  const activeWorkspaceId = useWorkspaceStore(
    (state) => state.activeWorkspaceId,
  );
  const workspaceName = useWorkspaceStore((state) => state.workspaceName);
  const switchWorkspace = useWorkspaceStore((state) => state.switchWorkspace);
  const addWorkspace = useWorkspaceStore((state) => state.addWorkspace);
  const organizations = useOrganizationStore((state) => state.organizations);

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Each folder belongs to an org; the label is what switching to it selects.
  const orgLabelFor = (orgId: string | null | undefined) => {
    if (!orgId) return null;
    return organizations.find((org) => org.id === orgId)?.alias ?? null;
  };

  return (
    <div className="workspace-switcher">
      <button
        ref={triggerRef}
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
        <Menu
          className="workspace-switcher__menu"
          label="Workspaces"
          anchorRef={triggerRef}
          placement="above"
          onClose={() => setOpen(false)}
        >
          <div className="workspace-switcher__heading" aria-hidden>
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
                <MenuItem
                  key={workspace.id}
                  className={`workspace-switcher__item ${
                    isActive ? "is-active" : ""
                  }`}
                  title={workspace.path}
                  aria-current={isActive ? "true" : undefined}
                  onSelect={() => void switchWorkspace(workspace.id)}
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
                  {org && (
                    <span className="workspace-switcher__org">{org}</span>
                  )}
                </MenuItem>
              );
            })
          )}

          <MenuSeparator className="workspace-switcher__sep" />

          <MenuItem
            className="workspace-switcher__item workspace-switcher__add"
            onSelect={() => void addWorkspace()}
          >
            <span className="workspace-switcher__check">
              <FolderPlus size={13} />
            </span>
            <span className="workspace-switcher__label">
              Use a different folder for this org…
            </span>
          </MenuItem>
        </Menu>
      )}
    </div>
  );
}
