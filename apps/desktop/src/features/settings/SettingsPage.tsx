import {
  Settings as SettingsIcon,
  Moon,
  Sun,
  Monitor,
  Palette,
  Info,
  DatabaseZap,
  FolderGit2,
  Trash2,
} from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useWorkspaceStore } from "../workspace/store/workspaceStore";

import { useOrganizationStore } from "../../store/orgStore";
import { Card, Badge, Button } from "../../components/ui";

import styles from "./SettingsPage.module.css";

type Theme = "dark" | "light" | "system";

export default function SettingsPage() {
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace);
  const organization = useOrganizationStore((s) => s.selectedOrganization);
  const organizations = useOrganizationStore((s) => s.organizations);

  const theme: Theme = "dark";

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.headingIcon}>
          <SettingsIcon size={22} />
        </span>
        <div>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.subtitle}>
            Configure ForgeSF to match your workflow.
          </p>
        </div>
      </header>

      <div className={styles.grid}>
        {/* Appearance */}
        <Card
          title="Appearance"
          subtitle="Theme preferences"
          icon={<Palette size={20} />}
        >
          <div className={styles.themeRow}>
            {(
              [
                { key: "dark", label: "Dark", icon: Moon },
                { key: "light", label: "Light", icon: Sun },
                { key: "system", label: "System", icon: Monitor },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                disabled={key !== theme}
                title={
                  key === theme
                    ? "Current theme"
                    : "Theme switching is not implemented yet"
                }
                className={`${styles.themeOption} ${
                  theme === key ? styles.themeActive : ""
                }`}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className={styles.note}>
            <Badge tone="info" dot>
              Coming soon
            </Badge>
            <span>
              Light theme is on the roadmap — dark mode is optimized for
              developers.
            </span>
          </div>
        </Card>

        {/* Organization */}
        <Card
          title="Organization"
          subtitle="Default connection details"
          icon={<DatabaseZap size={20} />}
          action={
            organization ? (
              <Badge tone="success" dot>
                {organization.orgType}
              </Badge>
            ) : undefined
          }
        >
          {organization ? (
            <ul className={styles.list}>
              <li>
                <span>Alias</span>
                <code>{organization.alias}</code>
              </li>
              <li>
                <span>Username</span>
                <code>{organization.username}</code>
              </li>
            </ul>
          ) : (
            <p className={styles.emptyText}>
              No organization connected. Visit the Organizations page to connect
              one.
            </p>
          )}

          <div className={styles.metaRow}>
            <span>
              {organizations.length} org{organizations.length === 1 ? "" : "s"}{" "}
              connected
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate("/organizations")}
            >
              Manage Orgs
            </Button>
          </div>
        </Card>

        {/* Workspaces */}
        <Card
          title="Workspaces"
          subtitle="One folder per org — metadata is never mixed between them"
          icon={<FolderGit2 size={20} />}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void addWorkspace()}
            >
              Add folder
            </Button>
          }
        >
          {workspaces.length === 0 ? (
            <p className={styles.emptyText}>
              No projects yet. Add a folder containing an SFDX project — each
              one remembers the org you last used it with.
            </p>
          ) : (
            <ul className={styles.workspaceList}>
              {workspaces.map((workspace) => {
                const isActive = workspace.id === activeWorkspaceId;
                const org = organizations.find(
                  (item) =>
                    item.id === (workspace.orgId ?? workspace.lastOrgId),
                );

                return (
                  <li key={workspace.id} className={styles.workspaceItem}>
                    <button
                      type="button"
                      className={`${styles.workspaceMain} ${
                        isActive ? styles.workspaceActive : ""
                      }`}
                      title={workspace.path}
                      onClick={() => void switchWorkspace(workspace.id)}
                    >
                      <span className={styles.workspaceName}>
                        {workspace.name}
                        {isActive && (
                          <Badge tone="success" dot>
                            Active
                          </Badge>
                        )}
                      </span>
                      <code className={styles.workspacePath}>
                        {workspace.path}
                      </code>
                    </button>

                    <span className={styles.workspaceOrg}>
                      {org ? org.alias : "Unassigned"}
                    </span>

                    <button
                      type="button"
                      className={styles.workspaceRemove}
                      title="Forget this workspace (files are not deleted)"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove "${workspace.name}" from ForgeSF?

` +
                              "The folder and its files stay on disk — only this " +
                              "entry is forgotten.",
                          )
                        ) {
                          void removeWorkspace(workspace.id);
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* About */}
        <Card
          title="About ForgeSF"
          subtitle="The modern Salesforce toolkit"
          icon={<Info size={20} />}
          action={<Badge tone="purple">v0.0.0</Badge>}
        >
          <p className={styles.aboutText}>
            ForgeSF is built for Salesforce developers who want a fast, local,
            and developer-friendly workspace for metadata, code, and deployment
            workflows.
          </p>

          <ul className={styles.aboutList}>
            <li>Metadata retrieval & browsing</li>
            <li>SOQL / SOSL / Anonymous Apex console</li>
            <li>Local file workspace with deploy to org</li>
            <li>CLI-backed connection management</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
