import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle, Rocket, X } from "lucide-react";

import type { DeployRecord, DeployScope } from "@/types/generated";
import { useNow } from "../../hooks/useNow";
import { useOrganizationStore } from "../../store/orgStore";
import { usePreferencesStore } from "../../store/preferencesStore";
import { useWorkspaceStore } from "../workspace/store/workspaceStore";
import { Badge } from "../../components/ui";
import OrgConnector from "./components/OrgConnector";
import MetadataSelector from "./components/MetadataSelector";
import DeployForm, { type DeployFormValue } from "./components/DeployForm";
import DeployJobPanel from "./components/DeployJobPanel";
import DeploymentHistory from "./components/DeploymentHistory";
import { useDeployJobsStore } from "./store/deployJobsStore";
import { succeeded } from "./lib/deployStatus";
import {
  TEST_LEVELS,
  deployFormProblem,
  jobKind,
  parseTestNames,
  scopeLabel,
} from "./lib/deployForm";
import { workspaceOrgMismatchPrompt } from "../workspace/lib/deployGuards";
import {
  isProtectedOrg,
  protectionPrompt,
} from "../org-manager/lib/orgProtection";
import { confirm } from "../../components/ui/Confirm/confirm";
import { errorMessage } from "../../lib/errors";
import { offerReauthentication } from "../org-manager/lib/orgErrors";
import {
  useComponentLister,
  useComponentsOfTypes,
  useMetadataTypes,
} from "../metadata/hooks/useOrgMetadata";
import {
  needsExplicitMembers,
  withChildTypes,
} from "../metadata/lib/typeCatalog";
import {
  resolveMetadataSpecs,
  selectionCount,
} from "../metadata/lib/metadataSpecs";
import type { Organization } from "../org-manager/types";
import styles from "./DeploymentsPage.module.css";

const INITIAL_FORM: DeployFormValue = {
  scope: "workspace",
  testLevel: "",
  testsInput: "",
  ignoreWarnings: false,
};

/** The form a visit starts with, before the test-level preference applies. */
function initialForm(paths: string[]): DeployFormValue {
  return {
    ...INITIAL_FORM,
    scope: paths.length > 0 ? "paths" : INITIAL_FORM.scope,
  };
}

/** What the explorer's "Validate…" sends along when it opens this page. */
interface DeploymentsLocationState {
  deployPaths?: string[];
}

function pathsFrom(state: unknown): string[] {
  const paths = (state as DeploymentsLocationState | null)?.deployPaths;
  return Array.isArray(paths)
    ? paths.filter((path): path is string => typeof path === "string")
    : [];
}

/** The picks without `kind` — leaving that type whole rather than narrowed. */
function withoutType(
  members: Record<string, string[]>,
  kind: string,
): Record<string, string[]> {
  if (!(kind in members)) return members;
  const next = { ...members };
  delete next[kind];
  return next;
}

/** Refreshes Pending Changes once a deploy that committed files finishes. */
function refreshChangesWhenDone(record: DeployRecord) {
  if (record.checkOnly) return;
  void useDeployJobsStore
    .getState()
    .watch(record)
    .then((report) => {
      if (report && succeeded(report.status)) {
        void useWorkspaceStore.getState().loadChanges();
      }
    });
}

/**
 * Validates and deploys the local workspace to an org, as background jobs.
 *
 * Jobs start with `--async` and are followed by polling, so a deploy longer
 * than the old ten-minute wait is no longer reported as failed while it keeps
 * running; it can be cancelled, its component and test results are shown,
 * and a successful validation can be quick deployed later — across restarts.
 */
export default function DeploymentsPage() {
  const organizations = useOrganizationStore((s) => s.organizations);
  const selectedOrganization = useOrganizationStore(
    (s) => s.selectedOrganization,
  );
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const openWorkspaceId = useWorkspaceStore((s) => s.openWorkspaceId);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const changes = useWorkspaceStore((s) => s.changes);
  const changesLoading = useWorkspaceStore((s) => s.changesLoading);
  const changesError = useWorkspaceStore((s) => s.changesError);
  const loadChanges = useWorkspaceStore((s) => s.loadChanges);

  const history = useDeployJobsStore((s) => s.history);
  const reports = useDeployJobsStore((s) => s.reports);
  const reportErrors = useDeployJobsStore((s) => s.errors);
  const selectedJobId = useDeployJobsStore((s) => s.selectedJobId);
  const selectJob = useDeployJobsStore((s) => s.select);
  const loadReport = useDeployJobsStore((s) => s.loadReport);

  // The folder shown in the editor is the one deployed.
  const workspaceId = openWorkspaceId ?? activeWorkspaceId;
  const workspace = workspaces.find((item) => item.id === workspaceId) ?? null;
  const workspaceOrg =
    organizations.find((org) => org.id === workspace?.orgId) ?? null;

  // Defaults to the selected org — the one the open workspace follows.
  const [targetId, setTargetId] = useState<string | null>(null);
  const targetOrg =
    organizations.find(
      (org) => org.id === (targetId ?? selectedOrganization?.id),
    ) ?? null;

  // Files chosen in the explorer arrive preselected, as their own scope.
  const location = useLocation();
  const [selectedPaths, setSelectedPaths] = useState<string[]>(() =>
    pathsFrom(location.state),
  );
  const defaultTestLevel = usePreferencesStore((s) => s.defaultTestLevel);
  const [stored, setStored] = useState<DeployFormValue>(() =>
    initialForm(selectedPaths),
  );

  // The Settings default stands until a level is picked here. Derived rather
  // than copied into state by an effect: preferences load asynchronously, so
  // the stored level usually arrives *after* the first render, and syncing it
  // across would be a setState cascade on every load.
  const [testLevelTouched, setTestLevelTouched] = useState(false);
  const form: DeployFormValue = testLevelTouched
    ? stored
    : { ...stored, testLevel: defaultTestLevel };

  const setForm = (update: (current: DeployFormValue) => DeployFormValue) =>
    setStored((current) => update(current));
  const updateForm = (patch: Partial<DeployFormValue>) => {
    if (patch.testLevel !== undefined) setTestLevelTouched(true);
    setStored((current) => ({ ...current, ...patch }));
  };
  const clearSelectedPaths = () => {
    setSelectedPaths([]);
    setForm((current) =>
      current.scope === "paths" ? { ...current, scope: "workspace" } : current,
    );
  };

  // Local to this page: the selection used to live in the store shared with
  // the retrieve wizard, so choices made in one leaked into the other.
  const [selectedMetadata, setSelectedMetadata] = useState<string[]>([]);
  // Components picked within a type. A type with no entry deploys all of them.
  const [selectedMembers, setSelectedMembers] = useState<
    Record<string, string[]>
  >({});
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [starting, setStarting] = useState<"validate" | "deploy" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [acting, setActing] = useState<"cancel" | "quick" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const now = useNow(
    1000,
    history.some((record) => !record.done),
  );

  // History is loaded at startup; reading it again picks up anything a
  // background poll wrote since.
  useEffect(() => {
    void useDeployJobsStore
      .getState()
      .loadHistory()
      .catch(() => {});
    void loadChanges();
  }, [loadChanges]);

  // The metadata scope is org → org: the components come out of the source
  // org, so its type list is the one to show. It comes from the cache the
  // Retrieve wizard fills, so picking this scope right after a retrieve costs
  // no CLI call at all.
  const sourceOrg = organizations.find((org) => org.id === sourceId) ?? null;
  const metadataScope = form.scope === "metadata";
  const sourceUsername = sourceOrg?.username;
  const types = useMetadataTypes(metadataScope ? sourceUsername : undefined);
  const typesError = types.error ? errorMessage(types.error) : null;
  useEffect(() => {
    if (types.error) offerReauthentication(types.error, sourceOrg);
  }, [types.error, sourceOrg]);

  // Child types (CustomField, ValidationRule, ListView) only appear in a
  // parent's `childXmlNames`, so without this the page cannot deploy a single
  // field at all.
  const catalog = useMemo(() => withChildTypes(types.data ?? []), [types.data]);

  // Only the expanded type is listed from the org; the rest come from cache.
  const listed = useComponentsOfTypes(
    metadataScope ? sourceUsername : undefined,
    expandedType
      ? [...new Set([...selectedMetadata, expandedType])]
      : selectedMetadata,
    expandedType,
  );
  // Lists a type's components outside the render flow — the check a deploy
  // runs before it starts, for a type that was never expanded.
  const listComponents = useComponentLister();
  const componentsError = listed.error ? errorMessage(listed.error) : null;
  useEffect(() => {
    if (listed.error) offerReauthentication(listed.error, sourceOrg);
  }, [listed.error, sourceOrg]);

  // Folder and child types have no wildcard, so one with no components in the
  // source org would be sent as a spec the CLI rejects. Caught before submit.
  const emptyTypes = useMemo(
    () =>
      selectedMetadata.filter((kind) => {
        const type = catalog.find((item) => item.xmlName === kind);
        if (!needsExplicitMembers(type)) return false;
        if ((selectedMembers[kind] ?? []).length > 0) return false;
        return listed.byKind[kind]?.length === 0;
      }),
    [selectedMetadata, selectedMembers, catalog, listed.byKind],
  );

  const selectedRecord =
    history.find((record) => record.jobId === selectedJobId) ??
    history[0] ??
    null;
  const selectedReport = selectedRecord
    ? reports[selectedRecord.jobId]
    : undefined;
  const selectedError = selectedRecord
    ? reportErrors[selectedRecord.jobId]
    : undefined;

  // A job finished in an earlier session has no results in memory yet.
  useEffect(() => {
    if (!selectedRecord || selectedReport || selectedError) return;
    void loadReport(selectedRecord);
  }, [selectedRecord, selectedReport, selectedError, loadReport]);

  const orgFor = useCallback(
    (username: string): Organization | undefined =>
      organizations.find((org) => org.username === username),
    [organizations],
  );
  const orgAlias = useCallback(
    (username: string) => orgFor(username)?.alias ?? username,
    [orgFor],
  );

  const changedPaths = useMemo(
    () => (changes ? [...changes.modified, ...changes.added] : []),
    [changes],
  );
  const tests = useMemo(
    () => parseTestNames(form.testsInput),
    [form.testsInput],
  );

  // An org → org deploy reads nothing on disk, so it does not need a project
  // open — only the file scopes do.
  const problemFor = (checkOnly: boolean): string | null => {
    if (!workspace && !metadataScope) return "Open a workspace first.";
    if (!targetOrg) return "Pick a target org.";
    return deployFormProblem({
      checkOnly,
      testLevel: form.testLevel,
      tests,
      scope: form.scope,
      changedCount: changes?.baselineAt != null ? changedPaths.length : 0,
      pathsCount: selectedPaths.length,
      metadataCount: selectedMetadata.length,
      sourceUsername: sourceUsername ?? null,
      targetUsername: targetOrg.username,
      emptyTypes,
    });
  };
  const validateProblem = problemFor(true);
  const deployProblem = problemFor(false);

  const submit = async (checkOnly: boolean) => {
    if (!targetOrg || problemFor(checkOnly)) return;
    if (!workspace && !metadataScope) return;
    setNotice(null);

    // Only the picked components, named one by one. A type left whole sends
    // the bare kind — except folder and child types, which have no wildcard
    // and have to name every member instead.
    //
    // Those lists are fetched here when the type was never expanded: taking
    // the cache alone would treat an unlisted type as having no components
    // and quietly leave it out of the deploy.
    const fullMembers: Record<string, string[]> = {};
    const unlistable: string[] = [];
    if (metadataScope) {
      for (const kind of selectedMetadata) {
        const type = catalog.find((item) => item.xmlName === kind);
        if (!needsExplicitMembers(type)) continue;
        if ((selectedMembers[kind] ?? []).length > 0) continue;
        const cached = listed.byKind[kind];
        if (cached) {
          fullMembers[kind] = cached;
          continue;
        }
        try {
          fullMembers[kind] = await listComponents(
            sourceUsername as string,
            kind,
          );
        } catch {
          unlistable.push(kind);
        }
      }
    }
    if (unlistable.length > 0) {
      setNotice(
        `Could not list the components of ${unlistable.join(", ")}. Open ${
          unlistable.length === 1 ? "that type" : "those types"
        } to pick components, or clear them.`,
      );
      return;
    }

    const { specs, empty } = resolveMetadataSpecs(
      selectedMetadata,
      selectedMembers,
      fullMembers,
    );
    if (metadataScope && empty.length > 0) {
      setNotice(
        `${sourceOrg?.alias ?? "The source org"} has no components of ${empty.join(", ")}, and ${
          empty.length === 1 ? "that type" : "those types"
        } cannot be deployed as a whole. Clear ${empty.length === 1 ? "it" : "them"} and try again.`,
      );
      return;
    }

    const scope: DeployScope =
      form.scope === "workspace"
        ? { kind: "workspace" }
        : form.scope === "changed"
          ? { kind: "paths", paths: changedPaths }
          : form.scope === "paths"
            ? { kind: "paths", paths: selectedPaths }
            : {
                kind: "orgSource",
                sourceUsername: sourceUsername as string,
                metadata: specs,
              };
    const counted = selectionCount(
      selectedMetadata,
      selectedMembers,
      listed.byKind,
    );
    const label = scopeLabel(form.scope, {
      changed: changedPaths.length,
      metadata: selectedMetadata,
      paths: selectedPaths,
      components: counted.known ? counted.components : undefined,
    });

    // A validation commits nothing, so only a real deploy asks first.
    if (!checkOnly) {
      // Another org's folder is a legitimate promotion (sandbox → production),
      // but it is also what a stale selection looks like: always name it.
      // An org → org deploy sends no workspace files, so it cannot mismatch.
      const mismatch = metadataScope
        ? null
        : workspaceOrgMismatchPrompt(workspace, targetOrg, organizations);
      if (mismatch && !(await confirm(mismatch))) return;

      const level =
        TEST_LEVELS.find((item) => item.value === form.testLevel)?.label ??
        "Org default";
      const production = isProtectedOrg(targetOrg);
      const confirmed = await confirm({
        title: `Deploy to ${targetOrg.alias}?`,
        message: production
          ? "This writes metadata to a live production environment."
          : "This writes metadata to the org.",
        details: [
          `What:  ${label}`,
          `From:  ${metadataScope ? (sourceOrg?.alias ?? sourceUsername) : workspace?.name}`,
          `To:    ${targetOrg.alias} (${targetOrg.orgType}) · ${targetOrg.username}`,
          `Tests: ${level}`,
        ],
        confirmLabel: "Deploy",
        tone: production ? "danger" : "default",
      });
      if (!confirmed) return;
    }

    // Unsaved editor buffers only matter when the workspace is what is sent.
    if (
      !metadataScope &&
      !(await useWorkspaceStore.getState().saveBeforeDeploy())
    ) {
      return;
    }

    setStarting(checkOnly ? "validate" : "deploy");
    try {
      const record = await useDeployJobsStore.getState().start({
        username: targetOrg.username,
        workspaceId: metadataScope ? null : (workspace?.id ?? null),
        options: {
          scope,
          checkOnly,
          testLevel: form.testLevel || null,
          tests: form.testLevel === "RunSpecifiedTests" ? tests : [],
          ignoreWarnings: form.ignoreWarnings,
          label,
        },
      });
      setActionError(null);
      refreshChangesWhenDone(record);
    } catch (error) {
      setNotice(errorMessage(error));
      offerReauthentication(error, targetOrg);
    } finally {
      setStarting(null);
    }
  };

  const cancelJob = async (record: DeployRecord) => {
    const proceed = await confirm({
      title: `Cancel this ${jobKind(record).toLowerCase()}?`,
      message:
        `"${record.label}" on ${orgAlias(record.username)} stops at the next ` +
        "step. Components already written stay in the org until the job rolls back.",
      confirmLabel: "Cancel job",
      cancelLabel: "Keep running",
      tone: "danger",
    });
    if (!proceed) return;

    setActing("cancel");
    setActionError(null);
    try {
      await useDeployJobsStore.getState().cancel(record);
    } catch (error) {
      setActionError(errorMessage(error));
      offerReauthentication(error, orgFor(record.username));
    } finally {
      setActing(null);
    }
  };

  const quickDeploy = async (validation: DeployRecord) => {
    const org = orgFor(validation.username);
    if (!org) {
      setActionError(
        `Connect ${validation.username} again to quick deploy this validation.`,
      );
      return;
    }

    const prompt = protectionPrompt(
      org,
      "Quick deploy the validated components",
      "Quick deploy",
    ) ?? {
      title: `Quick deploy to ${org.alias}?`,
      message: `"${validation.label}" is committed to the org without running its tests again.`,
      confirmLabel: "Quick deploy",
    };
    if (!(await confirm(prompt))) return;

    setActing("quick");
    setActionError(null);
    try {
      const record = await useDeployJobsStore
        .getState()
        .quickDeploy(validation);
      refreshChangesWhenDone(record);
    } catch (error) {
      setActionError(errorMessage(error));
      offerReauthentication(error, org);
    } finally {
      setActing(null);
    }
  };

  const clearMetadataSelection = () => {
    setSelectedMetadata([]);
    setSelectedMembers({});
    setExpandedType(null);
  };

  const handleTargetChange = (org: Organization | null) => {
    setTargetId(org?.id ?? "");
    clearMetadataSelection();
  };

  // A selection means nothing against a different org's components.
  const handleSourceChange = (org: Organization | null) => {
    setSourceId(org?.id ?? null);
    clearMetadataSelection();
  };

  const toggleMetadata = (xmlName: string) =>
    setSelectedMetadata((current) => {
      if (!current.includes(xmlName)) return [...current, xmlName];
      // Deselecting a type drops the components picked inside it, so
      // reselecting it later does not resurrect a stale narrowing.
      setSelectedMembers((members) => withoutType(members, xmlName));
      return current.filter((item) => item !== xmlName);
    });

  /** Picking a component implies the type it belongs to. */
  const toggleMember = (xmlName: string, member: string) => {
    setSelectedMembers((current) => {
      const picked = current[xmlName] ?? [];
      const next = picked.includes(member)
        ? picked.filter((item) => item !== member)
        : [...picked, member];
      // The last component unpicked leaves the type whole again.
      if (next.length === 0) return withoutType(current, xmlName);
      return { ...current, [xmlName]: next };
    });
    setSelectedMetadata((current) =>
      current.includes(xmlName) ? current : [...current, xmlName],
    );
  };

  const selectAllMembers = (xmlName: string) => {
    const all = listed.byKind[xmlName] ?? [];
    if (all.length === 0) return;
    setSelectedMembers((current) => ({ ...current, [xmlName]: all }));
    setSelectedMetadata((current) =>
      current.includes(xmlName) ? current : [...current, xmlName],
    );
  };

  /** Clearing a type's components leaves the type whole, not deselected. */
  const clearMembers = (xmlName: string) =>
    setSelectedMembers((current) => withoutType(current, xmlName));

  const running = history.filter((record) => !record.done).length;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>
            <Rocket size={24} />
          </span>
          <div>
            <h1 className={styles.title}>Deployments</h1>
            <p className={styles.subtitle}>
              Validate and deploy metadata from your local workspace to an org
            </p>
          </div>
        </div>
        <div className={styles.headerBadges}>
          {running > 0 && (
            <Badge tone="info" dot>
              {running} running
            </Badge>
          )}
        </div>
      </header>

      <OrgConnector
        workspace={workspace}
        workspaceOrg={workspaceOrg}
        organizations={organizations}
        targetOrg={targetOrg}
        onTargetChange={handleTargetChange}
        fromOrg={metadataScope}
        sourceOrg={sourceOrg}
        onSourceChange={handleSourceChange}
      />

      {notice && (
        <div className={styles.notice} role="alert">
          <AlertTriangle size={16} />
          <span>{notice}</span>
          <button
            type="button"
            className={styles.noticeClose}
            aria-label="Dismiss"
            onClick={() => setNotice(null)}
          >
            <X size={14} />
          </button>
        </div>
      )}

      <div className={styles.grid}>
        <div className={styles.leftCol}>
          <DeployForm
            value={form}
            onChange={updateForm}
            workspace={workspace}
            changes={changes}
            changesLoading={changesLoading}
            changesError={changesError}
            onRefreshChanges={() => void loadChanges()}
            selectedPaths={selectedPaths}
            onClearSelectedPaths={clearSelectedPaths}
            metadataCount={selectedMetadata.length}
            starting={starting}
            validateProblem={validateProblem}
            deployProblem={deployProblem}
            onValidate={() => void submit(true)}
            onDeploy={() => void submit(false)}
          >
            {metadataScope && (
              <>
                {!sourceOrg && (
                  <p className={styles.inlineError} role="status">
                    Choose a source org above to list its metadata.
                  </p>
                )}
                {typesError && (
                  <p className={styles.inlineError} role="alert">
                    Could not load metadata types from {sourceOrg?.alias}:{" "}
                    {typesError}
                  </p>
                )}
                {sourceOrg && (
                  <MetadataSelector
                    metadataTypes={catalog}
                    selected={selectedMetadata}
                    selectedMembers={selectedMembers}
                    components={listed.byKind}
                    expanded={expandedType}
                    search={search}
                    loading={types.isFetching}
                    componentsLoading={listed.loading}
                    componentsError={componentsError}
                    disabled={starting !== null}
                    embedded
                    onSearchChange={setSearch}
                    onToggle={toggleMetadata}
                    onExpand={setExpandedType}
                    onToggleMember={toggleMember}
                    onSelectAllMembers={selectAllMembers}
                    onClearMembers={clearMembers}
                    onRetryComponents={listed.refetch}
                    onClear={clearMetadataSelection}
                  />
                )}
              </>
            )}
          </DeployForm>
        </div>

        <div className={styles.rightCol}>
          <DeployJobPanel
            record={selectedRecord}
            report={selectedReport}
            reportError={selectedError}
            orgAlias={selectedRecord ? orgAlias(selectedRecord.username) : ""}
            now={now}
            acting={acting}
            actionError={actionError}
            onCancel={() => selectedRecord && void cancelJob(selectedRecord)}
            onQuickDeploy={() =>
              selectedRecord && void quickDeploy(selectedRecord)
            }
            onLoadReport={() =>
              selectedRecord && void loadReport(selectedRecord)
            }
          />
        </div>
      </div>

      <DeploymentHistory
        records={history}
        selectedJobId={selectedRecord?.jobId ?? null}
        onSelect={(jobId) => {
          setActionError(null);
          selectJob(jobId);
        }}
        orgAlias={orgAlias}
      />
    </div>
  );
}
