import { useState, useEffect, useCallback } from "react";
import {
  Rocket,
  GitCommit,
  GitBranch,
  Terminal,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useOrganizationStore } from "../../store/orgStore";
import { useMetadataStore } from "../../store/metadataStore";
import {
  listMetadataTypes,
  deployWorkspace,
  deployQuick,
} from "../../services/tauri";
import { Badge, Card } from "../../components/ui";
import OrgConnector from "./components/OrgConnector";
import MetadataSelector from "./components/MetadataSelector";
import DeploymentPipeline from "./components/DeploymentPipeline";
import DeploymentHistory from "./components/DeploymentHistory";
import type {
  PipelineStep,
  PipelineStatus,
  DeploymentRecord,
  DeployPhase,
} from "./types";
import type { Organization } from "../org-manager/types";
import styles from "./DeploymentsPage.module.css";

const VERSION_PREFIX = "v";
let versionCounter = 1;
function nextVersion(): string {
  return `${VERSION_PREFIX}${versionCounter++}.0.0`;
}

export default function DeploymentsPage() {
  const organizations = useOrganizationStore((s) => s.organizations);
  const [sourceOrg, setSourceOrg] = useState<Organization | null>(null);
  const [targetOrg, setTargetOrg] = useState<Organization | null>(null);

  // One shared selection model with the retrieve flow; `search` and `loading`
  // are this screen's own UI state and no longer live in the global store.
  const metadataTypes = useMetadataStore((s) => s.metadata);
  const selectedMetadata = useMetadataStore((s) => s.selectedTypes);
  const setMetadata = useMetadataStore((s) => s.setMetadata);
  const toggleMetadata = useMetadataStore((s) => s.toggleType);
  const clearSelection = useMetadataStore((s) => s.clearTypes);

  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);

  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [logs, setLogs] = useState("");
  const [deployVersion, setDeployVersion] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [history, setHistory] = useState<DeploymentRecord[]>([]);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([
    {
      id: "validate",
      label: "Validate",
      description: "Run deployment validation (check-only)",
      status: "pending",
    },
    {
      id: "build",
      label: "Build Package",
      description: "Assemble metadata into deployment package",
      status: "pending",
    },
    {
      id: "deploy",
      label: "Deploy",
      description: "Deploy metadata to target org",
      status: "pending",
    },
    {
      id: "verify",
      label: "Verify",
      description: "Verify deployment success in target org",
      status: "pending",
    },
  ]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // Loads the source org's metadata types. The `cancelled` flag drops a
  // superseded org's response, and the failure is surfaced in the console
  // instead of the old `.catch(() => {})`, which showed an empty selector with
  // no explanation.
  useEffect(() => {
    if (!sourceOrg) return;

    let cancelled = false;
    const { username, alias } = sourceOrg;

    const loadTypes = async () => {
      setLoading(true);
      try {
        const types = await listMetadataTypes(username);
        // setMetadata clears the selection itself when the org changed.
        if (!cancelled) setMetadata(username, types);
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setLogs(
          (p) =>
            p +
            `
[${new Date().toLocaleTimeString()}] ⚠ Could not load metadata types from ${alias}: ${message}
`,
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadTypes();

    return () => {
      cancelled = true;
    };
  }, [sourceOrg, setMetadata]);

  const handleSwap = useCallback(() => {
    const temp = sourceOrg;
    setSourceOrg(targetOrg);
    setTargetOrg(temp);
  }, [sourceOrg, targetOrg]);

  const updateStepStatus = (stepId: string, status: PipelineStatus) => {
    setPipelineSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, status } : s)),
    );
  };

  const runDeployment = async () => {
    if (!sourceOrg || !targetOrg || selectedMetadata.length === 0) return;

    // Deploying an org onto itself is never intended and is destructive.
    if (sourceOrg.id === targetOrg.id) {
      setLogs(
        (p) =>
          p +
          `\n[${new Date().toLocaleTimeString()}] ⚠ Source and target are the same org (${targetOrg.alias}). Pick a different target.\n`,
      );
      return;
    }

    // The deploy below writes to a real org. Name it explicitly — the org
    // cards cannot be trusted to distinguish production from sandbox yet.
    const confirmed = window.confirm(
      `Deploy the local workspace to:\n\n` +
        `  ${targetOrg.alias}\n  ${targetOrg.username}\n  ${targetOrg.instanceUrl}\n\n` +
        `This writes metadata to that org. Continue?`,
    );
    if (!confirmed) return;

    setRunning(true);
    setLogs("");
    const version = deployVersion || nextVersion();
    setDeployVersion(version);

    setPipelineSteps((prev) =>
      prev.map((s) => ({
        ...s,
        status: s.id === "validate" ? "active" : "pending",
      })),
    );
    setPhase("validating");

    // Tracked locally, not via `currentStep`: the state setter does not update
    // the value captured by this closure, so the catch block used to blame
    // whichever step the closure was created with (always "deploy").
    let step = "validate";
    const startedAt = Date.now();
    const stamp = () => `[${new Date().toLocaleTimeString()}]`;

    const record = (status: DeploymentRecord["status"]) => {
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      setHistory((prev) => [
        {
          id: `dep-${Date.now()}`,
          version,
          message: commitMessage || `Deploy ${selectedMetadata.length} types`,
          author: sourceOrg.alias,
          sourceOrg: sourceOrg.alias,
          targetOrg: targetOrg.alias,
          status,
          metadataCount: selectedMetadata.length,
          timestamp: new Date().toLocaleString(),
          duration: `${seconds}s`,
        },
        ...prev,
      ]);
    };

    try {
      // ── Validate ──────────────────────────────────────────────
      // Runs `sf project deploy validate`, which registers the deployment
      // server-side and hands back a job id.
      setCurrentStep(step);
      updateStepStatus("validate", "active");
      setLogs(
        (p) =>
          p +
          `${stamp()} 🔍 Validating ${selectedMetadata.length} metadata type(s) against ${targetOrg.alias}...\n`,
      );

      const validation = await deployWorkspace(
        targetOrg.username,
        true,
        selectedMetadata,
      );
      setLogs((p) => p + validation.summary + "\n");
      updateStepStatus("validate", "success");
      setLogs((p) => p + `${stamp()} ✅ Validation passed.\n\n`);

      // ── Prepare ───────────────────────────────────────────────
      // No fake build step: either the validation produced a promotable job
      // id, or the deploy below has to upload from scratch.
      step = "build";
      setPhase("building");
      setCurrentStep(step);
      updateStepStatus("build", "active");
      setLogs(
        (p) =>
          p +
          (validation.jobId
            ? `${stamp()} 📦 Validated deployment ${validation.jobId} is ready to promote.\n\n`
            : `${stamp()} 📦 No promotable job id returned — the deploy will upload the source again.\n\n`),
      );
      updateStepStatus("build", "success");

      // ── Deploy ────────────────────────────────────────────────
      step = "deploy";
      setPhase("deploying");
      setCurrentStep(step);
      updateStepStatus("deploy", "active");
      setLogs(
        (p) =>
          p +
          `${stamp()} 🚀 ${
            validation.jobId ? "Promoting validated deployment" : "Deploying"
          } to ${targetOrg.alias}...\n`,
      );

      const deployment = validation.jobId
        ? await deployQuick(targetOrg.username, validation.jobId)
        : await deployWorkspace(targetOrg.username, false, selectedMetadata);

      setLogs((p) => p + deployment.summary + "\n");
      updateStepStatus("deploy", "success");

      // ── Verify ────────────────────────────────────────────────
      // The CLI already waited for the deploy to reach a terminal state, so
      // this reports that state instead of sleeping and claiming success.
      step = "verify";
      setPhase("verifying");
      setCurrentStep(step);
      updateStepStatus("verify", "active");

      const succeeded = /^(Succeeded|SucceededPartial)$/i.test(
        deployment.status,
      );
      setLogs(
        (p) => p + `${stamp()} 🔎 Target org reports: ${deployment.status}\n`,
      );

      if (!succeeded) {
        throw new Error(
          `Deployment finished with status "${deployment.status}".`,
        );
      }

      updateStepStatus("verify", "success");
      setPhase("done");
      record("success");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setLogs((p) => p + `\n❌ ${message}\n`);
      updateStepStatus(step, "failed");
      setPhase("error");
      record("failed");
    } finally {
      setRunning(false);
      setCurrentStep(null);
    }
  };

  const handleRollback = (id: string) => {
    setLogs(
      (p) =>
        p + `\n[${new Date().toLocaleTimeString()}] 🔄 Rollback for ${id}...\n`,
    );
  };

  const handleViewDetails = (id: string) => {
    setLogs(
      (p) =>
        p + `\n[${new Date().toLocaleTimeString()}] 📋 Details for ${id}...\n`,
    );
  };

  const canDeploy =
    sourceOrg &&
    targetOrg &&
    sourceOrg.id !== targetOrg.id &&
    selectedMetadata.length > 0 &&
    !running;

  return (
    <div className={styles.page}>
      {/* Page Header */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerIcon}>
            <Rocket size={24} />
          </span>
          <div>
            <h1 className={styles.title}>Deployments</h1>
            <p className={styles.subtitle}>
              Deploy metadata across Salesforce organizations with pipeline
              control
            </p>
          </div>
        </div>
        <div className={styles.headerBadges}>
          <Badge tone="info" dot>
            {organizations.length} orgs
          </Badge>
          {deployVersion && <Badge tone="purple">{deployVersion}</Badge>}
        </div>
      </header>

      {/* Org Connector - Wire/Plug UI */}
      <OrgConnector
        organizations={organizations}
        sourceOrg={sourceOrg}
        targetOrg={targetOrg}
        onSourceChange={setSourceOrg}
        onTargetChange={setTargetOrg}
        onSwap={handleSwap}
      />

      {/* Main content grid */}
      <div className={styles.grid}>
        {/* Left Column - Metadata Selection */}
        <div className={styles.leftCol}>
          {/* Version / Commit */}
          <Card
            title="Version & Commit"
            icon={<GitBranch size={18} />}
            className={styles.versionCard}
          >
            <div className={styles.versionRow}>
              <div className={styles.versionInputGroup}>
                <label className={styles.fieldLabel}>Version Tag</label>
                <input
                  className={styles.versionInput}
                  placeholder="v1.0.0"
                  value={deployVersion}
                  onChange={(e) => setDeployVersion(e.target.value)}
                />
              </div>
            </div>
            <div className={styles.commitRow}>
              <label className={styles.fieldLabel}>
                <GitCommit size={12} />
                Deployment Message
              </label>
              <input
                className={styles.commitInput}
                placeholder="e.g. Added new Apex classes and Custom Objects..."
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
              />
            </div>
          </Card>

          {/* Metadata Selector */}
          <MetadataSelector
            metadataTypes={metadataTypes}
            selected={selectedMetadata}
            search={search}
            loading={loading}
            onSearchChange={setSearch}
            onToggle={toggleMetadata}
            onClear={clearSelection}
          />
        </div>

        {/* Right Column - Pipeline + Output */}
        <div className={styles.rightCol}>
          {/* Pipeline */}
          <DeploymentPipeline
            steps={pipelineSteps}
            currentStep={currentStep}
            onRun={runDeployment}
            running={running}
            disabled={!canDeploy}
          />

          {/* Console Output */}
          <div className={styles.console}>
            <div className={styles.consoleHeader}>
              <div className={styles.consoleHeaderLeft}>
                <Terminal size={14} />
                <span>Console Output</span>
                {phase !== "idle" && (
                  <span
                    className={`${styles.phaseBadge} ${styles[`phase-${phase}`]}`}
                  >
                    {phase === "validating" && "Validating"}
                    {phase === "building" && "Building Package"}
                    {phase === "deploying" && "Deploying"}
                    {phase === "verifying" && "Verifying"}
                    {phase === "done" && "Complete"}
                    {phase === "error" && "Failed"}
                  </span>
                )}
              </div>
              {logs && (
                <button
                  className={styles.clearConsole}
                  onClick={() => setLogs("")}
                >
                  <RefreshCw size={12} />
                  Clear
                </button>
              )}
            </div>
            <div className={styles.consoleBody}>
              <pre className={styles.consoleText}>
                {logs || (
                  <span className={styles.consolePlaceholder}>
                    <Sparkles size={16} />
                    <span>
                      Ready — select source/target orgs and metadata, then run a
                      deployment
                    </span>
                  </span>
                )}
              </pre>
            </div>
          </div>

          {/* Quick actions */}
          <div className={styles.quickActions}>
            <button className={styles.quickActionBtn} onClick={handleSwap}>
              <RefreshCw size={14} />
              Swap Orgs
            </button>
            <button
              className={styles.quickActionBtn}
              onClick={() => {
                setLogs(
                  (p) =>
                    p +
                    `\n[${new Date().toLocaleTimeString()}] 📊 Generating diff report...\n`,
                );
              }}
              disabled={!sourceOrg || !targetOrg}
            >
              <GitCommit size={14} />
              Diff Report
            </button>
          </div>
        </div>
      </div>

      {/* Deployment History */}
      <DeploymentHistory
        records={history}
        onRollback={handleRollback}
        onViewDetails={handleViewDetails}
      />
    </div>
  );
}
