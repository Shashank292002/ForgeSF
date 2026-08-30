import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Check, Cloud, CloudOff, FolderOpen, X } from "lucide-react";

import { useMetadataStore } from "../../../../store/metadataStore";
import useCurrentOrg from "../../../../hooks/useCurrentOrg";
import {
  listMetadataComponents,
  listMetadataTypes,
  retrieveMetadataProgress,
  onRetrieveProgress,
} from "../../../../services/tauri";
import type {
  RetrieveMode,
  RetrieveProgressEntry,
  RetrieveResult,
} from "../../types";
import type { MetadataCategoryKey } from "../../lib/categories";
import { buildRetrieveSpecs } from "../../lib/retrieveSpecs";
import { useWorkspaceStore } from "../../../workspace/store/workspaceStore";

import RetrieveSelectStep from "./RetrieveSelectStep";
import RetrieveComponentsStep from "./RetrieveComponentsStep";
import RetrieveProgressView from "./RetrieveProgressView";
import RetrieveResultsView from "./RetrieveResultsView";

import "./MetadataRetriever.css";

type Step = "select" | "components" | "retrieve" | "results";
type Category = MetadataCategoryKey | "all";

interface Props {
  mode?: RetrieveMode;
  onClose?: () => void;
}

const STEPS: Array<{ key: Step; label: string }> = [
  { key: "select", label: "Choose Types" },
  { key: "components", label: "Choose Components" },
  { key: "retrieve", label: "Retrieve" },
  { key: "results", label: "Results" },
];

export default function MetadataRetriever({ mode = "overlay", onClose }: Props) {
  const navigate = useNavigate();
  const { organization } = useCurrentOrg();

  const metadata = useMetadataStore((s) => s.metadata);
  const setMetadata = useMetadataStore((s) => s.setMetadata);
  const selectedTypes = useMetadataStore((s) => s.selectedTypes);
  const setSelectedTypes = useMetadataStore((s) => s.setSelectedTypes);
  const toggleType = useMetadataStore((s) => s.toggleType);
  const clearTypes = useMetadataStore((s) => s.clearTypes);
  const selectedMembers = useMetadataStore((s) => s.selectedMembers);
  const toggleMember = useMetadataStore((s) => s.toggleMember);
  const setMembers = useMetadataStore((s) => s.setMembers);
  const clearMemberSelection = useMetadataStore((s) => s.clearMemberSelection);

  const refreshFiles = useWorkspaceStore((s) => s.refreshFiles);
  const setActiveView = useWorkspaceStore((s) => s.setActiveView);

  const [step, setStep] = useState<Step>("select");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [entries, setEntries] = useState<RetrieveProgressEntry[]>([]);
  const [result, setResult] = useState<RetrieveResult | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Component picker state — cached per type so navigating between steps
  // doesn't refetch `sf org list metadata` for types already loaded.
  const [activeType, setActiveType] = useState<string | null>(null);
  const [componentsCache, setComponentsCache] = useState<Record<string, string[]>>({});
  const [loadingType, setLoadingType] = useState<string | null>(null);
  const [compsError, setCompsError] = useState<string | null>(null);

  useEffect(() => () => unlistenRef.current?.(), []);

  useEffect(() => {
    if (mode !== "overlay") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, onClose]);

  const loadTypes = useCallback(async () => {
    if (!organization) return;
    setLoadingTypes(true);
    setLoadError(null);
    try {
      const types = await listMetadataTypes(organization.username);
      setMetadata(types);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Could not load metadata types.",
      );
    } finally {
      setLoadingTypes(false);
    }
  }, [organization, setMetadata]);

  useEffect(() => {
    void loadTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization?.username]);

  // Specs used for the current/last run, keyed by metadata type, so failed
  // types can be retried with exactly the same component selection.
  const specsByKindRef = useRef<Record<string, string[]>>({});

  const ensureComponents = useCallback(
    async (kind: string) => {
      if (!organization) return;
      if (componentsCache[kind] || loadingType) return;
      setLoadingType(kind);
      setCompsError(null);
      try {
        const members = await listMetadataComponents(kind, organization.username);
        setComponentsCache((prev) => ({ ...prev, [kind]: members }));
      } catch (error) {
        // Some types can't be listed (folder-managed, child types, etc.).
        // Cache an empty list and surface the reason in the picker.
        setComponentsCache((prev) => ({ ...prev, [kind]: [] }));
        setCompsError(
          error instanceof Error
            ? error.message
            : "Could not list components for this type.",
        );
      } finally {
        setLoadingType(null);
      }
    },
    [organization, componentsCache, loadingType],
  );

  const runRetrieve = useCallback(
    async (specs: string[]) => {
      if (!organization || specs.length === 0) return;

      // Remember which specs belong to which type for retry support.
      const byKind: Record<string, string[]> = {};
      for (const spec of specs) {
        const kind = spec.includes(":") ? spec.split(":")[0] : spec;
        (byKind[kind] ??= []).push(spec);
      }
      specsByKindRef.current = byKind;

      const kinds = Object.keys(byKind);
      let unlisten: (() => void) | null = null;
      setResult(null);
      setStep("retrieve");
      setEntries(
        kinds.map((kind) => ({ kind, status: "running", retrieved: 0, message: "" })),
      );
      try {
        unlisten = await onRetrieveProgress((event) => {
          if (event.phase === "complete" || !event.kind) return;
          setEntries((prev) =>
            prev.map((entry) =>
              entry.kind === event.kind
                ? {
                    ...entry,
                    status: event.status ?? entry.status,
                    retrieved: event.retrieved ?? entry.retrieved,
                    message: event.message ?? entry.message,
                  }
                : entry,
            ),
          );
        });
        unlistenRef.current = unlisten;

        const res = await retrieveMetadataProgress(organization.username, specs);
        setResult(res);
        setEntries(
          res.items.map((item) => ({
            kind: item.kind,
            status: item.status,
            retrieved: item.retrieved,
            message: item.message ?? "",
          })),
        );
        void refreshFiles();
        setStep("results");
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : String(error));
        setResult({
          success: false,
          summary: String(error),
          items: kinds.map((kind) => ({ kind, status: "failed", retrieved: 0 })),
          total: kinds.length,
          succeeded: 0,
          failed: kinds.length,
        });
        setEntries([]);
        setStep("results");
      } finally {
        unlisten?.();
        unlistenRef.current = null;
      }
    },
    [organization, refreshFiles],
  );

  /** Retries the failed types using their original component selection. */
  const retryFailed = useCallback(
    (kinds: string[]) => {
      const specs = kinds.flatMap(
        (kind) => specsByKindRef.current[kind] ?? [kind],
      );
      void runRetrieve(specs);
    },
    [runRetrieve],
  );

  const startRetrieve = useCallback(() => {
    void runRetrieve(buildRetrieveSpecs(selectedTypes, selectedMembers));
  }, [runRetrieve, selectedTypes, selectedMembers]);

  const handleSelectAll = () => {
    if (metadata.length > 0 && selectedTypes.length === metadata.length) {
      clearTypes();
    } else {
      setSelectedTypes(metadata.map((t) => t.xmlName));
    }
  };

  const handleOpenWorkspace = () => {
    void refreshFiles();
    if (mode === "overlay") {
      onClose?.();
      setActiveView("explorer");
    } else {
      navigate("/workspace");
    }
  };

  const activeIndex =
    step === "select"
      ? 0
      : step === "components"
        ? 1
        : step === "retrieve"
          ? 2
          : 3;
  const narrowedCount = selectedTypes.filter(
    (kind) => (selectedMembers[kind] ?? []).length > 0,
  ).length;
  const doneCount = entries.filter((e) => e.status !== "running").length;
  const completedCount = entries.filter((e) => e.status === "completed").length;
  const failedCount = entries.filter((e) => e.status === "failed").length;
if (!organization) {
    return (
      <div className="mr mr-card mr-card--page">
        <div className="mr-empty--org">
          <CloudOff size={40} strokeWidth={1.5} />
          <div>
            <h3>No Connected Organization</h3>
            <p>Connect a Salesforce org to start retrieving metadata.</p>
          </div>
          <button
            type="button"
            className="mr-btn mr-btn--primary"
            onClick={() => navigate("/organizations")}
          >
            Go to Organizations <ArrowRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`mr mr-card ${mode === "page" ? "mr-card--page" : ""}`}>
      <header className="mr-head">
        <div className="mr-head__brand">
          <span className="mr-head__mark">
            <Cloud size={18} />
          </span>
          <div className="mr-head__titles">
            <span className="mr-head__title">Retrieve Metadata</span>
            <span className="mr-head__sub">
              Pull source from your org into the workspace
            </span>
          </div>
        </div>

        <div className="mr-head__right">
          <div className="mr-head__org" title={organization.username}>
            <span className="mr-head__org-dot" />
            {organization.alias || organization.username}
          </div>
          {mode === "overlay" && onClose && (
            <button type="button" className="mr-close" title="Close" onClick={onClose}>
              <X size={16} />
            </button>
          )}
        </div>
      </header>

      <div className="mr-steps">
        {STEPS.map((s, i) => (
          <span
            key={s.key}
            className={`mr-step ${i < activeIndex ? "is-done" : ""} ${
              i === activeIndex ? "is-active" : ""
            }`}
          >
            <span className="mr-step__num">
              {i < activeIndex ? <Check size={12} /> : i + 1}
            </span>
            {s.label}
          </span>
        ))}
      </div>

      <div className="mr-body">
        {step === "select" && (
          <RetrieveSelectStep
            metadata={metadata}
            selectedTypes={selectedTypes}
            loading={loadingTypes}
            error={loadError}
            category={category}
            search={search}
            onSearch={setSearch}
            onCategory={setCategory}
            onToggle={toggleType}
            onSelectAll={handleSelectAll}
            onClear={clearTypes}
          />
        )}

        {step === "components" && (
          <RetrieveComponentsStep
            metadata={metadata}
            types={selectedTypes}
            activeType={activeType}
            componentsCache={componentsCache}
            loadingType={loadingType}
            error={compsError}
            selectedMembers={selectedMembers}
            onActiveType={setActiveType}
            onToggleMember={toggleMember}
            onSelectAll={(kind) =>
              setMembers(kind, componentsCache[kind] ?? [])
            }
            onClear={clearMemberSelection}
            onEnsureComponents={(kind) => void ensureComponents(kind)}
            onBack={() => setStep("select")}
          />
        )}

        {step === "retrieve" && (
          <RetrieveProgressView entries={entries} total={entries.length} />
        )}

        {step === "results" && result && (
          <RetrieveResultsView
            result={result}
            onRetry={retryFailed}
            onRetrieveMore={() => setStep(selectedTypes.length > 0 ? "components" : "select")}
            onOpenWorkspace={handleOpenWorkspace}
          />
        )}
      </div>

      {(step === "select" || step === "components" || step === "retrieve") && (
        <div className="mr-footer">
          <div className="mr-footer__status">
            {step === "select" ? (
              <span>
                <b>{selectedTypes.length}</b>
                metadata type{selectedTypes.length === 1 ? "" : "s"} selected
              </span>
            ) : step === "components" ? (
              <span>
                <b>{narrowedCount}</b> of <b>{selectedTypes.length}</b> type
                {selectedTypes.length === 1 ? "" : "s"} narrowed to specific components
              </span>
            ) : (
              <span>
                <b>{doneCount}</b> of <b>{entries.length}</b> processed
                {completedCount > 0 && ` · ${completedCount} ok`}
                {failedCount > 0 && ` · ${failedCount} failed`}
              </span>
            )}
          </div>
          <div className="mr-footer__actions">
            {step === "select" ? (
              <>
                <button
                  type="button"
                  className="mr-btn mr-btn--ghost"
                  onClick={() => navigate("/workspace")}
                >
                  <FolderOpen size={14} /> Workspace
                </button>
                <button
                  type="button"
                  className="mr-btn mr-btn--primary"
                  disabled={selectedTypes.length === 0 || loadingTypes}
                  onClick={() => {
                    if (activeType === null || !selectedTypes.includes(activeType)) {
                      setActiveType(selectedTypes[0] ?? null);
                    }
                    setStep("components");
                  }}
                >
                  Choose Components <ArrowRight size={14} />
                </button>
              </>
            ) : step === "components" ? (
              <>
                <button
                  type="button"
                  className="mr-btn mr-btn--ghost"
                  onClick={() => setStep("select")}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="mr-btn mr-btn--primary"
                  disabled={selectedTypes.length === 0}
                  onClick={startRetrieve}
                >
                  Retrieve <ArrowRight size={14} />
                </button>
              </>
            ) : (
              <span className="mr-footer__status">
                Retrieving from {organization.alias || organization.username}…
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}