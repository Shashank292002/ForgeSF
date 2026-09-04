import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Cloud,
  CloudOff,
  FolderOpen,
  X,
} from "lucide-react";

import { useMetadataStore } from "../../../../store/metadataStore";
import useCurrentOrg from "../../../../hooks/useCurrentOrg";
import { useOrganizationStore } from "../../../../store/orgStore";
import {
  listMetadataComponents,
  listMetadataTypes,
  retrieveMetadataProgress,
  onRetrieveProgress,
  cancelRetrieve,
} from "../../../../services/tauri";
import type {
  RetrieveMode,
  RetrieveProgressEntry,
  RetrieveResult,
} from "../../types";
import type { MetadataCategoryKey } from "../../lib/categories";
import { buildRetrieveSpecs } from "../../lib/retrieveSpecs";
import { useWorkspaceStore } from "../../../workspace/store/workspaceStore";
import { useDialog } from "../../../../hooks/useDialog";
import { mixingWarningFor } from "../../../workspace/lib/workspaceGuards";
import { setWorkspaceRetrievedOrg } from "../../../workspace/services/workspaceService";

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

/** Folds a retry's outcome into the run it is retrying, keyed by metadata type. */
function mergeRetrieveResults(
  previous: RetrieveResult,
  retry: RetrieveResult,
): RetrieveResult {
  const byKind = new Map(previous.items.map((item) => [item.kind, item]));
  for (const item of retry.items) byKind.set(item.kind, item);

  const items = [...byKind.values()];
  const succeeded = items.filter((item) => item.status === "completed").length;
  const failed = items.length - succeeded;

  return {
    items,
    total: items.length,
    succeeded,
    failed,
    success: failed === 0,
    summary:
      failed === 0
        ? `Retrieved metadata from ${succeeded} type(s) successfully.`
        : `Finished with ${failed} failed type(s).`,
  };
}

export default function MetadataRetriever({
  mode = "overlay",
  onClose,
}: Props) {
  const navigate = useNavigate();
  const { organization } = useCurrentOrg();
  // Needed to name the previous org in the mixing warning.
  const organizations = useOrganizationStore((s) => s.organizations);

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
  // Kept separate from `loadError`: a failed retrieve used to render as a
  // "could not load metadata types" error when stepping back to step 1.
  const [retrieveError, setRetrieveError] = useState<string | null>(null);
  const [entries, setEntries] = useState<RetrieveProgressEntry[]>([]);
  // Set the moment Cancel is pressed; the run still finishes its batch.
  const [cancelling, setCancelling] = useState(false);
  const [result, setResult] = useState<RetrieveResult | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  // Mirrors `cancelling` for reads inside the async run, which does not
  // see state updates made after its closure was created.
  const cancelledRef = useRef(false);

  // Component picker state — cached per type so navigating between steps
  // doesn't refetch `sf org list metadata` for types already loaded.
  //
  // The cache carries the org it was listed from and is *derived* away when the
  // org changes, rather than being cleared from an effect. Components belong to
  // one org; keeping them across a switch showed — and would have retrieved —
  // the previous org's members.
  const [cache, setCache] = useState<{
    org: string | null;
    byKind: Record<string, string[]>;
  }>({ org: null, byKind: {} });
  const [activeTypeRaw, setActiveType] = useState<string | null>(null);
  const [loadingType, setLoadingType] = useState<string | null>(null);
  const [compsError, setCompsError] = useState<string | null>(null);

  useEffect(() => () => unlistenRef.current?.(), []);

  // Only the overlay presentation is a modal; the /metadata route is a page.
  const dialogRef = useDialog(() => {
    if (mode === "overlay") onClose?.();
  });

  // Loads the org's metadata types. The `cancelled` flag drops results from a
  // superseded org: switching orgs mid-fetch used to let the slower response
  // land and overwrite the newer org's type list.
  const username = organization?.username;

  useEffect(() => {
    if (!username) return;

    let cancelled = false;

    const loadTypes = async () => {
      setLoadingTypes(true);
      setLoadError(null);
      try {
        const types = await listMetadataTypes(username);
        if (!cancelled) setMetadata(username, types);
      } catch (error) {
        if (!cancelled) {
          setLoadError(
            error instanceof Error
              ? error.message
              : "Could not load metadata types.",
          );
        }
      } finally {
        if (!cancelled) setLoadingTypes(false);
      }
    };

    void loadTypes();

    return () => {
      cancelled = true;
    };
  }, [username, setMetadata]);

  // Both derived: an org switch invalidates the cache and any active type
  // without an effect having to reset them.
  const componentsCache = useMemo(
    () => (cache.org === username ? cache.byKind : {}),
    [cache, username],
  );
  const activeType =
    activeTypeRaw && selectedTypes.includes(activeTypeRaw)
      ? activeTypeRaw
      : null;

  // Specs used for the current/last run, keyed by metadata type, so failed
  // types can be retried with exactly the same component selection.
  const specsByKindRef = useRef<Record<string, string[]>>({});

  const ensureComponents = useCallback(
    async (kind: string) => {
      if (!organization) return;
      // Only skip when this exact type is already cached or already in
      // flight. The old `|| loadingType` guard dropped the request whenever
      // *any* type was loading, so clicking a second type did nothing.
      if (componentsCache[kind] || loadingType === kind) return;
      const org = organization.username;
      setLoadingType(kind);
      setCompsError(null);

      // Writes are scoped to the org that was current when the request
      // started, so a slow response cannot land in a newer org's cache.
      const store = (members: string[]) =>
        setCache((prev) =>
          prev.org === org
            ? { org, byKind: { ...prev.byKind, [kind]: members } }
            : { org, byKind: { [kind]: members } },
        );

      try {
        const members = await listMetadataComponents(kind, org);
        store(members);
      } catch (error) {
        // Some types can't be listed (folder-managed, child types, etc.).
        // Cache an empty list and surface the reason in the picker.
        store([]);
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
    async (specs: string[], merge = false) => {
      if (!organization || specs.length === 0) return;

      // Remember which specs belong to which type for retry support.
      const byKind: Record<string, string[]> = {};
      for (const spec of specs) {
        const kind = spec.includes(":") ? spec.split(":")[0] : spec;
        (byKind[kind] ??= []).push(spec);
      }
      // A retry must not forget the specs of the types it is *not* re-running,
      // or a second retry would fall back to retrieving the whole type.
      specsByKindRef.current = merge
        ? { ...specsByKindRef.current, ...byKind }
        : byKind;

      const kinds = Object.keys(byKind);
      let unlisten: (() => void) | null = null;
      setResult(null);
      setRetrieveError(null);
      setStep("retrieve");
      setEntries(
        kinds.map((kind) => ({
          kind,
          status: "running",
          retrieved: 0,
          message: "",
        })),
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

        const res = await retrieveMetadataProgress(
          organization.username,
          specs,
        );
        // Retrying one failed type used to replace the whole result, wiping
        // every type that had already succeeded from the summary.
        setResult((prev) =>
          merge && prev ? mergeRetrieveResults(prev, res) : res,
        );
        setEntries(
          res.items.map((item) => ({
            kind: item.kind,
            status: item.status,
            retrieved: item.retrieved,
            message: item.message ?? "",
          })),
        );
        void refreshFiles();

        // Remember which org wrote this tree, so a later retrieve from a
        // different one can warn first.
        const { activeWorkspaceId } = useWorkspaceStore.getState();
        if (activeWorkspaceId && organization.id) {
          void setWorkspaceRetrievedOrg(activeWorkspaceId, organization.id)
            .then(() => useWorkspaceStore.getState().loadWorkspaces())
            .catch(() => {
              // Best-effort bookkeeping — never fail a completed retrieve.
            });
        }
        setStep("results");
      } catch (error) {
        setRetrieveError(
          error instanceof Error ? error.message : String(error),
        );
        setResult({
          success: false,
          summary: String(error),
          items: kinds.map((kind) => ({
            kind,
            status: "failed" as const,
            retrieved: 0,
            message: null,
          })),
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
      void runRetrieve(specs, true);
    },
    [runRetrieve],
  );

  const startRetrieve = useCallback(() => {
    // Retrieving overwrites local source in place. Files with unsaved editor
    // buffers are the one case the CLI's own conflict detection cannot see —
    // it compares against what is on disk, not what is open — so warn here.
    const dirty = Object.entries(useWorkspaceStore.getState().dirty)
      .filter(([, isDirty]) => isDirty)
      .map(([path]) => path);

    if (dirty.length > 0) {
      const preview = dirty.slice(0, 8).join("\n  ");
      const more = dirty.length > 8 ? `\n  …and ${dirty.length - 8} more` : "";
      const proceed = window.confirm(
        `${dirty.length} file(s) have unsaved changes:\n\n  ${preview}${more}\n\n` +
          "Retrieving overwrites files on disk. Your unsaved edits stay in the " +
          "editor, but saving afterwards will overwrite what was just retrieved.\n\n" +
          "Continue?",
      );
      if (!proceed) return;
    }

    // Retrieving from a different org than the one that populated this tree
    // merges two orgs' metadata into one force-app directory, with no way to
    // tell afterwards which file came from where.
    const workspaceState = useWorkspaceStore.getState();
    const activeWorkspace = workspaceState.workspaces.find(
      (item) => item.id === workspaceState.activeWorkspaceId,
    );
    const mixing = mixingWarningFor(activeWorkspace, organization?.id);

    if (mixing) {
      const previous =
        organizations.find((org) => org.id === mixing.previousOrgId)?.alias ??
        "another org";
      const proceed = window.confirm(
        `"${mixing.workspaceName}" was last retrieved from ${previous}.

` +
          `Retrieving from ${organization?.alias ?? "this org"} will mix metadata ` +
          `from two orgs in the same force-app tree.

Continue?`,
      );
      if (!proceed) return;
    }

    void runRetrieve(buildRetrieveSpecs(selectedTypes, selectedMembers));
  }, [
    runRetrieve,
    selectedTypes,
    selectedMembers,
    organization,
    organizations,
  ]);

  /**
   * Selects or clears the types currently visible.
   *
   * This used to select every type in the org regardless of the active filter
   * while its own label was computed from the filtered list — so narrowing to
   * "Code" and pressing Select all queued ~200 sequential retrievals.
   */
  const handleSelectAll = (visible: string[]) => {
    const allVisibleSelected =
      visible.length > 0 &&
      visible.every((name) => selectedTypes.includes(name));

    if (allVisibleSelected) {
      setSelectedTypes(selectedTypes.filter((name) => !visible.includes(name)));
    } else {
      setSelectedTypes([...new Set([...selectedTypes, ...visible])]);
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
    <div
      className={`mr mr-card ${mode === "page" ? "mr-card--page" : ""}`}
      ref={mode === "overlay" ? dialogRef : undefined}
      role={mode === "overlay" ? "dialog" : undefined}
      aria-modal={mode === "overlay" ? true : undefined}
      aria-label={mode === "overlay" ? "Retrieve Metadata" : undefined}
      tabIndex={mode === "overlay" ? -1 : undefined}
    >
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
            <button
              type="button"
              className="mr-close"
              title="Close"
              onClick={onClose}
            >
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

        {step === "results" && retrieveError && (
          <div className="mr-empty">
            <p>{retrieveError}</p>
          </div>
        )}

        {step === "results" && result && (
          <RetrieveResultsView
            result={result}
            onRetry={retryFailed}
            onRetrieveMore={() =>
              setStep(selectedTypes.length > 0 ? "components" : "select")
            }
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
                {selectedTypes.length === 1 ? "" : "s"} narrowed to specific
                components
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
                    if (
                      activeType === null ||
                      !selectedTypes.includes(activeType)
                    ) {
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
              <>
                <span className="mr-footer__status">
                  {cancelling
                    ? "Finishing the current batch…"
                    : `Retrieving from ${organization.alias || organization.username}…`}
                </span>
                <button
                  type="button"
                  className="mr-btn mr-btn--ghost"
                  disabled={cancelling}
                  onClick={() => {
                    setCancelling(true);
                    cancelledRef.current = true;
                    void cancelRetrieve();
                  }}
                >
                  <X size={14} /> Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
