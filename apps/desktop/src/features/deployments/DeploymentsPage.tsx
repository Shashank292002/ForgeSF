import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { AlertTriangle, Rocket, X } from "lucide-react";

import type { DeployRecord, DeployScope } from "@/types/generated";
import { useNow } from "../../hooks/useNow";
import { useOrganizationStore } from "../../store/orgStore";
import { useWorkspaceStore } from "../workspace/store/workspaceStore";
import { listMetadataTypes } from "../../services/tauri";
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
import type { MetadataType } from "../metadata/types";
import type { Organization } from "../org-manager/types";
import styles from "./DeploymentsPage.module.css";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const INITIAL_FORM: DeployFormValue = {
  scope: "workspace",
  testLevel: "",
  testsInput: "",
  ignoreWarnings: false,
};

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
  const [form, setForm] = useState<DeployFormValue>(() =>
    selectedPaths.length > 0
      ? { ...INITIAL_FORM, scope: "paths" }
      : INITIAL_FORM,
  );
  const updateForm = (patch: Partial<DeployFormValue>) =>
    setForm((current) => ({ ...current, ...patch }));
  const clearSelectedPaths = () => {
    setSelectedPaths([]);
    setForm((current) =>
      current.scope === "paths" ? { ...current, scope: "workspace" } : current,
    );
  };

  // Local to this page: the selection used to live in the store shared with
  // the retrieve wizard, so choices made in one leaked into the other.
  const [metadataTypes, setMetadataTypes] = useState<MetadataType[]>([]);
  const [selectedMetadata, setSelectedMetadata] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [typesLoading, setTypesLoading] = useState(false);
  const [typesError, setTypesError] = useState<string | null>(null);

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

  // The type list is the target org's, and only needed for that scope.
  const targetUsername = targetOrg?.username;
  const wantTypes = form.scope === "metadata";
  useEffect(() => {
    if (!targetUsername || !wantTypes) return;

    let cancelled = false;
    const loadTypes = async () => {
      setTypesLoading(true);
      setTypesError(null);
      try {
        const types = await listMetadataTypes(targetUsername);
        if (!cancelled) setMetadataTypes(types);
      } catch (error) {
        if (!cancelled) setTypesError(errorMessage(error));
      } finally {
        if (!cancelled) setTypesLoading(false);
      }
    };
    void loadTypes();

    return () => {
      cancelled = true;
    };
  }, [targetUsername, wantTypes]);

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

  const problemFor = (checkOnly: boolean): string | null => {
    if (!workspace) return "Open a workspace first.";
    if (!targetOrg) return "Pick a target org.";
    return deployFormProblem({
      checkOnly,
      testLevel: form.testLevel,
      tests,
      scope: form.scope,
      changedCount: changes?.baselineAt != null ? changedPaths.length : 0,
      pathsCount: selectedPaths.length,
      metadataCount: selectedMetadata.length,
    });
  };
  const validateProblem = problemFor(true);
  const deployProblem = problemFor(false);

  const submit = async (checkOnly: boolean) => {
    if (!workspace || !targetOrg || problemFor(checkOnly)) return;
    setNotice(null);

    const scope: DeployScope =
      form.scope === "workspace"
        ? { kind: "workspace" }
        : form.scope === "changed"
          ? { kind: "paths", paths: changedPaths }
          : form.scope === "paths"
            ? { kind: "paths", paths: selectedPaths }
            : { kind: "metadata", metadata: selectedMetadata };
    const label = scopeLabel(form.scope, {
      changed: changedPaths.length,
      metadata: selectedMetadata,
      paths: selectedPaths,
    });

    // A validation commits nothing, so only a real deploy asks first.
    if (!checkOnly) {
      // Another org's folder is a legitimate promotion (sandbox → production),
      // but it is also what a stale selection looks like: always name it.
      const mismatch = workspaceOrgMismatchPrompt(
        workspace,
        targetOrg,
        organizations,
      );
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
          `From:  ${workspace.name}`,
          `To:    ${targetOrg.alias} (${targetOrg.orgType}) · ${targetOrg.username}`,
          `Tests: ${level}`,
        ],
        confirmLabel: "Deploy",
        tone: production ? "danger" : "default",
      });
      if (!confirmed) return;
    }

    if (!(await useWorkspaceStore.getState().saveBeforeDeploy())) return;

    setStarting(checkOnly ? "validate" : "deploy");
    try {
      const record = await useDeployJobsStore.getState().start({
        username: targetOrg.username,
        workspaceId: workspace.id,
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
    } finally {
      setActing(null);
    }
  };

  const handleTargetChange = (org: Organization | null) => {
    setTargetId(org?.id ?? "");
    setSelectedMetadata([]);
  };

  const toggleMetadata = (xmlName: string) =>
    setSelectedMetadata((current) =>
      current.includes(xmlName)
        ? current.filter((item) => item !== xmlName)
        : [...current, xmlName],
    );

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
          />

          {form.scope === "metadata" && (
            <>
              {typesError && (
                <p className={styles.inlineError} role="alert">
                  Could not load metadata types from {targetOrg?.alias}:{" "}
                  {typesError}
                </p>
              )}
              <MetadataSelector
                metadataTypes={metadataTypes}
                selected={selectedMetadata}
                search={search}
                loading={typesLoading}
                onSearchChange={setSearch}
                onToggle={toggleMetadata}
                onClear={() => setSelectedMetadata([])}
              />
            </>
          )}
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
