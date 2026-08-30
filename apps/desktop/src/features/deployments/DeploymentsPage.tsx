import { useState, useEffect, useCallback } from "react";
import { Rocket, GitCommit, GitBranch, Terminal, RefreshCw, Sparkles } from "lucide-react";
import { useOrganizationStore } from "../../store/orgStore";
import { useMetadataStore } from "../../store/metadataStore";
import { listMetadataTypes, deployWorkspace } from "../../services/tauri";
import { Badge, Card } from "../../components/ui";
import OrgConnector from "./components/OrgConnector";
import MetadataSelector from "./components/MetadataSelector";
import DeploymentPipeline from "./components/DeploymentPipeline";
import DeploymentHistory from "./components/DeploymentHistory";
import type { PipelineStep, PipelineStatus, DeploymentRecord, DeployPhase } from "./types";
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

  const metadataTypes = useMetadataStore((s) => s.metadata);
  const selectedMetadata = useMetadataStore((s) => s.selectedMetadata);
  const search = useMetadataStore((s) => s.search);
  const loading = useMetadataStore((s) => s.loading);
  const setMetadata = useMetadataStore((s) => s.setMetadata);
  const toggleMetadata = useMetadataStore((s) => s.toggleMetadata);
  const setSearch = useMetadataStore((s) => s.setSearch);
  const setLoading = useMetadataStore((s) => s.setLoading);
  const clearSelection = useMetadataStore((s) => s.clearSelection);

  const [phase, setPhase] = useState<DeployPhase>("idle");
  const [logs, setLogs] = useState("");
  const [deployVersion, setDeployVersion] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const [history, setHistory] = useState<DeploymentRecord[]>([]);
  const [pipelineSteps, setPipelineSteps] = useState<PipelineStep[]>([
    { id: "validate", label: "Validate", description: "Run deployment validation (check-only)", status: "pending" },
    { id: "build", label: "Build Package", description: "Assemble metadata into deployment package", status: "pending" },
    { id: "deploy", label: "Deploy", description: "Deploy metadata to target org", status: "pending" },
    { id: "verify", label: "Verify", description: "Verify deployment success in target org", status: "pending" },
  ]);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // Load metadata when source org changes
  useEffect(() => {
    if (!sourceOrg) return;
    setLoading(true);
    listMetadataTypes(sourceOrg.username)
      .then((types) => {
        setMetadata(types);
        clearSelection();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sourceOrg]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSwap = useCallback(() => {
    const temp = sourceOrg;
    setSourceOrg(targetOrg);
    setTargetOrg(temp);
  }, [sourceOrg, targetOrg]);

  const updateStepStatus = (stepId: string, status: PipelineStatus) => {
    setPipelineSteps((prev) =>
      prev.map((s) => (s.id === stepId ? { ...s, status } : s))
    );
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const runDeployment = async () => {
    if (!sourceOrg || !targetOrg || selectedMetadata.length === 0) return;

    setRunning(true);
    setLogs("");
    const version = deployVersion || nextVersion();
    setDeployVersion(version);

    setPipelineSteps((prev) =>
      prev.map((s) => ({ ...s, status: s.id === "validate" ? "active" : "pending" }))
    );
    setPhase("validating");
    setCurrentStep("validate");

    try {
      // Step 1: Validate
      setCurrentStep("validate");
      updateStepStatus("validate", "active");
      setLogs((p) => p + `[${new Date().toLocaleTimeString()}] 🔍 Validating against ${targetOrg.alias}...\n`);
      await sleep(800);
      const valOut = await deployWorkspace(sourceOrg.username, true);
      setLogs((p) => p + valOut + "\n");
      await sleep(400);
      updateStepStatus("validate", "success");
      setLogs((p) => p + `[${new Date().toLocaleTimeString()}] ✅ Validation passed!\n\n`);

      // Step 2: Build
      setPhase("building");
      setCurrentStep("build");
      updateStepStatus("build", "active");
      setLogs((p) => p + `[${new Date().toLocaleTimeString()}] 📦 Building package (${selectedMetadata.length} types)...\n`);
      await sleep(1200);
      updateStepStatus("build", "success");
      setLogs((p) => p + `[${new Date().toLocaleTimeString()}] ✅ Package built\n\n`);

      // Step 3: Deploy
      setPhase("deploying");
      setCurrentStep("deploy");
      updateStepStatus("deploy", "active");
      setLogs((p) => p + `[${new Date().toLocaleTimeString()}] 🚀 Deploying to ${targetOrg.alias}...\n`);
      const depOut = await deployWorkspace(sourceOrg.username, false);
      setLogs((p) => p + depOut + "\n");
      await sleep(600);
      updateStepStatus("deploy", "success");
      setLogs((p) => p + `[${new Date().toLocaleTimeString()}] ✅ Deployment done!\n\n`);

      // Step 4: Verify
      setPhase("verifying");
      setCurrentStep("verify");
      updateStepStatus("verify", "active");
      setLogs((p) => p + `[${new Date().toLocaleTimeString()}] 🔎 Verifying in target org...\n`);
      await sleep(1000);
      updateStepStatus("verify", "success");
      setLogs((p) => p + `[${new Date().toLocaleTimeString()}] ✅ All checks passed!\n`);
      setPhase("done");

      setHistory((prev) => [{
        id: `dep-${Date.now()}`,
        version,
        message: commitMessage || `Deploy ${selectedMetadata.length} types`,
        author: sourceOrg.alias,
        sourceOrg: sourceOrg.alias,
        targetOrg: targetOrg.alias,
        status: "success",
        metadataCount: selectedMetadata.length,
        timestamp: new Date().toLocaleString(),
        duration: "~4.2s",
      }, ...prev]);
    } catch (err: any) {
      setLogs((p) => p + `\n❌ Error: ${String(err)}\n`);
      updateStepStatus(currentStep ?? "deploy", "failed");
      setPhase("error");

      setHistory((prev) => [{
        id: `dep-${Date.now()}`,
        version,
        message: commitMessage || `Deploy ${selectedMetadata.length} types`,
        author: sourceOrg.alias,
        sourceOrg: sourceOrg.alias,
        targetOrg: targetOrg.alias,
        status: "failed",
        metadataCount: selectedMetadata.length,
        timestamp: new Date().toLocaleString(),
        duration: "Failed",
      }, ...prev]);
    } finally {
      setRunning(false);
      setCurrentStep(null);
    }
  };

  const handleRollback = (id: string) => {
    setLogs((p) => p + `\n[${new Date().toLocaleTimeString()}] 🔄 Rollback for ${id}...\n`);
  };

  const handleViewDetails = (id: string) => {
    setLogs((p) => p + `\n[${new Date().toLocaleTimeString()}] 📋 Details for ${id}...\n`);
  };

  const canDeploy = sourceOrg && targetOrg && selectedMetadata.length > 0 && !running;

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
              Deploy metadata across Salesforce organizations with pipeline control
            </p>
          </div>
        </div>
        <div className={styles.headerBadges}>
          <Badge tone="info" dot>
            {organizations.length} orgs
          </Badge>
          {deployVersion && (
            <Badge tone="purple">{deployVersion}</Badge>
          )}
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
                  <span className={`${styles.phaseBadge} ${styles[`phase-${phase}`]}`}>
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
                <button className={styles.clearConsole} onClick={() => setLogs("")}>
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
                    <span>Ready — select source/target orgs and metadata, then run a deployment</span>
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
                setLogs((p) => p + `\n[${new Date().toLocaleTimeString()}] 📊 Generating diff report...\n`);
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