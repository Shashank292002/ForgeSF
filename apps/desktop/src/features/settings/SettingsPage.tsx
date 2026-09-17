import {
  Settings as SettingsIcon,
  Moon,
  Sun,
  Monitor,
  Palette,
  Info,
  DatabaseZap,
  Code2,
  FolderGit2,
  Pencil,
  TerminalSquare,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";

import { useWorkspaceStore } from "../workspace/store/workspaceStore";
import {
  forgetWorkspaceWithFiles,
  renameWorkspacePrompt,
} from "../workspace/lib/manage";

import { useOrgDetails } from "../org-manager/hooks/useOrgInfo";
import { usePreferencesStore } from "../../store/preferencesStore";
import {
  cliInfo,
  setSalesforceCliPath,
} from "../deployments/services/deployService";
import { toast } from "../../components/ui/Toast/toast";
import { errorMessage } from "../../lib/errors";
import { isTestLevel, TEST_LEVELS } from "../../lib/testLevels";

import { useOrganizationStore } from "../../store/orgStore";
import { Card, Badge, Button } from "../../components/ui";

import styles from "./SettingsPage.module.css";

export default function SettingsPage() {
  const navigate = useNavigate();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const addWorkspace = useWorkspaceStore((s) => s.addWorkspace);
  const removeWorkspace = useWorkspaceStore((s) => s.removeWorkspace);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const organization = useOrganizationStore((s) => s.selectedOrganization);
  const organizations = useOrganizationStore((s) => s.organizations);

  const preferences = usePreferencesStore();
  const setPreference = usePreferencesStore((state) => state.set);

  // What the CLI reports, so the path field can be checked against reality.
  const cli = useQuery({ queryKey: ["cli-info"], queryFn: cliInfo });
  const [sfPath, setSfPath] = useState(preferences.sfPath);
  const [sfProblem, setSfProblem] = useState<string | null>(null);
  const [checkingSf, setCheckingSf] = useState(false);

  /** Probes the path before keeping it, so a typo is caught here. */
  async function applySfPath() {
    setCheckingSf(true);
    setSfProblem(null);
    try {
      const info = await setSalesforceCliPath(sfPath);
      setPreference("sfPath", sfPath.trim());
      void cli.refetch();
      toast.success(
        info.version
          ? `Salesforce CLI ${info.version}`
          : "The CLI answered, but did not say which version.",
        { title: sfPath.trim() ? "Using your path" : "Back to discovery" },
      );
    } catch (error) {
      setSfProblem(errorMessage(error, "That path did not answer as the CLI."));
    } finally {
      setCheckingSf(false);
    }
  }

  // The org's own API version and instance, rather than the login payload's:
  // new projects are created at this version, so it is worth showing. Shared
  // with the org details panel, so opening both is one CLI call.
  const details = useOrgDetails(organization?.username);

  // The build's own version. It was hard-coded as v0.0.0 and never moved.
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    getVersion()
      .then((value) => current && setVersion(value))
      .catch(() => current && setVersion(null));
    return () => {
      current = false;
    };
  }, []);

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
                disabled={key !== "dark"}
                title={
                  key === "dark"
                    ? "The theme ForgeSF ships with"
                    : "Only the dark theme is built; the light one is on the roadmap"
                }
                className={`${styles.themeOption} ${
                  preferences.theme === key ? styles.themeActive : ""
                }`}
                onClick={() => setPreference("theme", key)}
              >
                <Icon size={18} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <div className={styles.note}>
            <Badge tone="info" dot>
              Dark only
            </Badge>
            <span>
              The light theme is not built yet — every surface is styled for
              dark. See ROADMAP.md.
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
              <li>
                <span>API version</span>
                <code>
                  {details.isPending
                    ? "…"
                    : (details.data?.apiVersion ?? "unknown")}
                </code>
              </li>
              <li>
                <span>Instance</span>
                <code>
                  {details.data?.instanceUrl ?? organization.instanceUrl}
                </code>
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
                      className={styles.workspaceAction}
                      title="Rename this workspace"
                      aria-label={`Rename ${workspace.name}`}
                      onClick={() =>
                        void renameWorkspacePrompt(workspace, renameWorkspace)
                      }
                    >
                      <Pencil size={14} />
                    </button>

                    <button
                      type="button"
                      className={`${styles.workspaceAction} ${styles.workspaceRemove}`}
                      title={
                        workspace.managed
                          ? "Forget this workspace, and optionally delete the folder ForgeSF created"
                          : "Forget this workspace (files are not deleted)"
                      }
                      aria-label={`Remove ${workspace.name} from ForgeSF`}
                      onClick={() =>
                        void forgetWorkspaceWithFiles(
                          workspace,
                          removeWorkspace,
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {/* Editor */}
        <Card
          title="Editor"
          subtitle="How the workspace editor behaves"
          icon={<Code2 size={20} />}
        >
          <ul className={styles.list}>
            <li>
              <span>Font size</span>
              <span className={styles.control}>
                <input
                  type="range"
                  min={10}
                  max={24}
                  value={preferences.editorFontSize}
                  aria-label="Editor font size"
                  onChange={(event) =>
                    setPreference("editorFontSize", Number(event.target.value))
                  }
                />
                <code>{preferences.editorFontSize}px</code>
              </span>
            </li>
            <li>
              <span>Tab size</span>
              <span className={styles.control}>
                <input
                  type="range"
                  min={1}
                  max={8}
                  value={preferences.editorTabSize}
                  aria-label="Editor tab size"
                  onChange={(event) =>
                    setPreference("editorTabSize", Number(event.target.value))
                  }
                />
                <code>{preferences.editorTabSize}</code>
              </span>
            </li>
            <li>
              <label htmlFor="pref-wrap">Wrap long lines</label>
              <input
                id="pref-wrap"
                type="checkbox"
                checked={preferences.editorWordWrap}
                onChange={(event) =>
                  setPreference("editorWordWrap", event.target.checked)
                }
              />
            </li>
            <li>
              <label htmlFor="pref-minimap">Show the minimap</label>
              <input
                id="pref-minimap"
                type="checkbox"
                checked={preferences.editorMinimap}
                onChange={(event) =>
                  setPreference("editorMinimap", event.target.checked)
                }
              />
            </li>
          </ul>
        </Card>

        {/* Salesforce CLI */}
        <Card
          title="Salesforce CLI"
          subtitle="Everything ForgeSF does runs through it"
          icon={<TerminalSquare size={20} />}
          action={
            cli.data?.version ? (
              <Badge tone={cli.data.supported ? "success" : "warning"} dot>
                v{cli.data.version}
              </Badge>
            ) : undefined
          }
        >
          {cli.data?.message && (
            <p className={styles.emptyText}>{cli.data.message}</p>
          )}

          <div className={styles.field}>
            <label htmlFor="pref-sf-path">Path to `sf`</label>
            <input
              id="pref-sf-path"
              type="text"
              value={sfPath}
              spellCheck={false}
              placeholder="Found automatically — set this only if it is not"
              onChange={(event) => setSfPath(event.target.value)}
            />
            {sfProblem && (
              <p className={styles.problem} role="alert">
                {sfProblem}
              </p>
            )}
          </div>

          <div className={styles.metaRow}>
            <span>
              {preferences.sfPath
                ? "Using the path you set."
                : "Looking in the usual places, then PATH."}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void applySfPath()}
              loading={checkingSf}
            >
              Use this path
            </Button>
          </div>

          <div className={styles.field}>
            <label htmlFor="pref-api-version">Default API version</label>
            <input
              id="pref-api-version"
              type="text"
              value={preferences.defaultApiVersion}
              spellCheck={false}
              placeholder="Ask the org (recommended)"
              onChange={(event) =>
                setPreference("defaultApiVersion", event.target.value)
              }
            />
            <p className={styles.note}>
              Used when an org cannot be asked. Leave it empty and new projects
              take the org&apos;s own version.
            </p>
          </div>

          <div className={styles.field}>
            <label htmlFor="pref-test-level">Default deploy test level</label>
            <select
              id="pref-test-level"
              value={preferences.defaultTestLevel}
              onChange={(event) => {
                if (isTestLevel(event.target.value)) {
                  setPreference("defaultTestLevel", event.target.value);
                }
              }}
            >
              {/* The same list the deploy form offers. It used to hold four
                  entries with their own labels, so two levels the form
                  accepts could not be chosen here at all. */}
              {TEST_LEVELS.map((level) => (
                <option key={level.value} value={level.value}>
                  {level.label}
                </option>
              ))}
            </select>
            <p className={styles.note}>
              {TEST_LEVELS.find(
                (level) => level.value === preferences.defaultTestLevel,
              )?.hint ?? "The level the Deployments page starts on."}
            </p>
          </div>
        </Card>

        {/* About */}
        <Card
          title="About ForgeSF"
          subtitle="The modern Salesforce toolkit"
          icon={<Info size={20} />}
          action={version ? <Badge tone="purple">v{version}</Badge> : undefined}
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

          <div className={styles.credit}>
            <span className={styles.creditMark} aria-hidden="true" />
            <div>
              <p className={styles.creditName}>
                ForgeSF™ — built by Shashank Venkateshappa
              </p>
              <p className={styles.creditNote}>
                Copyright &copy; {new Date().getFullYear()} Shashank
                Venkateshappa. All rights reserved. ForgeSF is not affiliated
                with, nor endorsed by, Salesforce, Inc.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
