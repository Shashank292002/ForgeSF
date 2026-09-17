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
  retrieveMetadataProgress,
  onRetrieveProgress,
  cancelRetrieve,
} from "../../../../services/tauri";
import type {
  RetrieveMode,
  RetrieveProgressEntry,
  RetrieveResult,
  RetrieveTypeResult,
} from "../../types";
import type { MetadataCategoryKey } from "../../lib/categories";
import { resolveMetadataSpecs } from "../../lib/metadataSpecs";
import { needsExplicitMembers, withChildTypes } from "../../lib/typeCatalog";
import { useWorkspaceStore } from "../../../workspace/store/workspaceStore";
import { errorMessage } from "../../../../lib/errors";
import { recordActivity } from "../../../../store/activityStore";
import { offerReauthentication } from "../../../org-manager/lib/orgErrors";
import { useDialog } from "../../../../hooks/useDialog";
import {
  useComponentLister,
  useComponentsOfTypes,
  useMetadataTypes,
} from "../../hooks/useOrgMetadata";
import { mixingWarningFor } from "../../../workspace/lib/workspaceGuards";
import { setWorkspaceRetrievedOrg } from "../../../workspace/services/workspaceService";
import {
  confirm,
  previewList,
} from "../../../../components/ui/Confirm/confirm";

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

const ITEM_STATUSES = new Set<RetrieveProgressEntry["status"]>([
  "running",
  "completed",
  "failed",
  "skipped",
]);

function summarise(items: RetrieveTypeResult[], cancelled: boolean) {
  const succeeded = items.filter((item) => item.status === "completed").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const skipped = items.filter((item) => item.status === "skipped").length;
  return {
    succeeded,
    failed,
    success: failed === 0 && !cancelled,
    summary: cancelled
      ? `Cancelled — ${succeeded} type(s) retrieved, ${skipped} skipped.`
      : failed === 0
        ? `Retrieved metadata from ${succeeded} type(s) successfully.`
        : `Finished with ${failed} failed type(s).`,
  };
}

/** Folds a retry's outcome into the run it is retrying, keyed by metadata type. */
function mergeRetrieveResults(
  previous: RetrieveResult,
  retry: RetrieveResult,
): RetrieveResult {
  const byKind = new Map(previous.items.map((item) => [item.kind, item]));
  for (const item of retry.items) byKind.set(item.kind, item);

  const items = [...byKind.values()];
  return {
    items,
    total: items.length,
    cancelled: retry.cancelled,
    ...summarise(items, retry.cancelled),
  };
}

/** Adds outcomes decided before the CLI ran (nothing to retrieve, listing failed). */
function withPreflightItems(
  result: RetrieveResult,
  preflight: RetrieveTypeResult[],
): RetrieveResult {
  if (preflight.length === 0) return result;
  const items = [
    ...result.items.filter(
      (item) => !preflight.some((extra) => extra.kind === item.kind),
    ),
    ...preflight,
  ];
  return {
    items,
    total: items.length,
    cancelled: result.cancelled,
    ...summarise(items, result.cancelled),
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

  const setOrg = useMetadataStore((s) => s.setOrg);
  const selectedTypes = useMetadataStore((s) => s.selectedTypes);
  const setSelectedTypes = useMetadataStore((s) => s.setSelectedTypes);
  const toggleType = useMetadataStore((s) => s.toggleType);
  const clearTypes = useMetadataStore((s) => s.clearTypes);
  const selectedMembers = useMetadataStore((s) => s.selectedMembers);
  const toggleMember = useMetadataStore((s) => s.toggleMember);
  const setMembers = useMetadataStore((s) => s.setMembers);
  const clearMemberSelection = useMetadataStore((s) => s.clearMemberSelection);

  const refreshFiles = useWorkspaceStore((s) => s.refreshFiles);
  const reloadCleanBuffers = useWorkspaceStore((s) => s.reloadCleanBuffers);
  const setActiveView = useWorkspaceStore((s) => s.setActiveView);

  // The org's type list, from the shared cache: reopening the wizard, or
  // visiting Deployments after it, reuses the listing instead of re-running
  // `sf org list metadata-types`.
  const username = organization?.username;
  const types = useMetadataTypes(username);

  // Child types (CustomField, ValidationRule…) are only reachable through
  // their parent's `childXmlNames`; offer them as types of their own.
  const catalog = useMemo(() => withChildTypes(types.data ?? []), [types.data]);

  const [step, setStep] = useState<Step>("select");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category>("all");
  // Kept separate from the type list's own error: a failed retrieve used to
  // render as a "could not load metadata types" error when stepping back to
  // step 1.
  const [retrieveError, setRetrieveError] = useState<string | null>(null);
  const [entries, setEntries] = useState<RetrieveProgressEntry[]>([]);
  // Set the moment Cancel is pressed; the run still finishes its batch.
  const [cancelling, setCancelling] = useState(false);
  // Listing the members of folder and child types before the retrieve.
  const [preparing, setPreparing] = useState(false);
  const [result, setResult] = useState<RetrieveResult | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  const [activeTypeRaw, setActiveType] = useState<string | null>(null);

  useEffect(() => () => unlistenRef.current?.(), []);

  // Only the overlay presentation is a modal; the /metadata route is a page.
  const dialogRef = useDialog(() => {
    if (mode === "overlay") onClose?.();
  });

  // Selections belong to one org: switching clears them.
  useEffect(() => {
    if (username) setOrg(username);
  }, [username, setOrg]);

  const activeType =
    activeTypeRaw && selectedTypes.includes(activeTypeRaw)
      ? activeTypeRaw
      : null;

  // The chosen type's components, and the lists already held for the others.
  const components = useComponentsOfTypes(username, selectedTypes, activeType);
  const componentsCache = components.byKind;
  const listComponents = useComponentLister();

  // Listing types or components can fail because the session expired, and the
  // fix is the same wherever it happened.
  const listingError = types.error ?? components.error;
  useEffect(() => {
    if (listingError) offerReauthentication(listingError, organization);
  }, [listingError, organization]);

  // Specs used for the current/last run, keyed by metadata type, so failed
  // types can be retried with exactly the same component selection.
  const specsByKindRef = useRef<Record<string, string[]>>({});

  const runRetrieve = useCallback(
    async (
      specs: string[],
      merge = false,
      preflight: RetrieveTypeResult[] = [],
    ) => {
      if (!organization) return;

      // The workspace the files are written to is fixed at the start, so
      // switching org mid-run cannot redirect — or mislabel — the retrieve.
      const workspaceId = useWorkspaceStore.getState().openWorkspaceId;

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
      // A previous run's Cancel must not leave this one looking cancelled.
      setCancelling(false);
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

      if (kinds.length === 0) {
        // Everything was decided up front (e.g. no components exist).
        setResult(
          withPreflightItems(
            {
              success: true,
              summary: "",
              items: [],
              total: 0,
              succeeded: 0,
              failed: 0,
              cancelled: false,
            },
            preflight,
          ),
        );
        setEntries([]);
        setStep("results");
        return;
      }

      try {
        unlisten = await onRetrieveProgress((event) => {
          if (event.phase === "complete" || !event.kind) return;
          const status = event.status as RetrieveProgressEntry["status"] | null;
          setEntries((prev) =>
            prev.map((entry) =>
              entry.kind === event.kind
                ? {
                    ...entry,
                    status:
                      status && ITEM_STATUSES.has(status)
                        ? status
                        : entry.status,
                    retrieved: event.retrieved ?? entry.retrieved,
                    message: event.message ?? entry.message,
                  }
                : entry,
            ),
          );
        });
        unlistenRef.current = unlisten;

        const res = withPreflightItems(
          await retrieveMetadataProgress(
            organization.username,
            specs,
            workspaceId,
          ),
          preflight,
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
            warnings: item.warnings,
          })),
        );

        // Retrieved files replaced what was on disk. Open tabs without
        // unsaved edits reload, so they show — and later save — the new copy.
        const workspace = useWorkspaceStore.getState();
        if (workspace.openWorkspaceId === workspaceId) {
          void refreshFiles();
          void reloadCleanBuffers();
          // The retrieved files now match the org.
          void workspace.loadChanges();
        }

        // Remember which org wrote this tree, so a later retrieve from a
        // different one can warn first.
        if (workspaceId && organization.id) {
          void setWorkspaceRetrievedOrg(workspaceId, organization.id)
            .then(() => useWorkspaceStore.getState().loadWorkspaces())
            .catch(() => {
              // Best-effort bookkeeping — never fail a completed retrieve.
            });
        }
        // The main retrieve path recorded nothing, so the Dashboard's
        // activity card only ever showed retrieves run from a manifest.
        recordActivity({
          kind: res.failed > 0 ? "error" : "success",
          source: "retrieve",
          title: res.cancelled
            ? `Retrieve from ${organization.alias} cancelled`
            : `Retrieved ${res.succeeded} of ${res.total} metadata type${
                res.total === 1 ? "" : "s"
              }`,
          detail: res.summary || undefined,
          org: organization.alias,
        });
        setStep("results");
      } catch (error) {
        const message = errorMessage(error);
        setRetrieveError(message);
        recordActivity({
          kind: "error",
          source: "retrieve",
          title: `Retrieve from ${organization.alias} failed`,
          detail: message,
          org: organization.alias,
        });
        offerReauthentication(error, organization);
        setResult({
          success: false,
          summary: message,
          cancelled: false,
          items: kinds.map((kind) => ({
            kind,
            status: "failed" as const,
            retrieved: 0,
            message: null,
            warnings: [],
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
    [organization, refreshFiles, reloadCleanBuffers],
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

  const startRetrieve = useCallback(async () => {
    if (!organization) return;

    // Retrieving overwrites local source in place. Files with unsaved editor
    // buffers are the one case the CLI's own conflict detection cannot see —
    // it compares against what is on disk, not what is open — so warn here.
    const workspaceState = useWorkspaceStore.getState();
    const dirty = Object.entries(workspaceState.dirty)
      .filter(([, isDirty]) => isDirty)
      .map(([path]) => path);

    if (dirty.length > 0) {
      const proceed = await confirm({
        title: "Retrieve over unsaved changes?",
        message:
          "Retrieving overwrites files on disk. Your unsaved edits stay in the " +
          "editor, but saving them afterwards overwrites what was just retrieved.",
        details: previewList(dirty),
        confirmLabel: "Retrieve anyway",
        tone: "danger",
      });
      if (!proceed) return;
    }

    // Retrieving from a different org than the one that populated this tree
    // merges two orgs' metadata into one force-app directory, with no way to
    // tell afterwards which file came from where.
    const openWorkspace = workspaceState.workspaces.find(
      (item) => item.id === workspaceState.openWorkspaceId,
    );
    const mixing = mixingWarningFor(openWorkspace, organization.id);

    if (mixing) {
      const previous =
        organizations.find((org) => org.id === mixing.previousOrgId)?.alias ??
        "another org";
      const proceed = await confirm({
        title: "Mix metadata from two orgs?",
        message:
          `"${mixing.workspaceName}" was last retrieved from ${previous}. ` +
          `Retrieving from ${organization.alias} mixes metadata from two orgs ` +
          "in the same force-app tree, with no way to tell afterwards which file came from where.",
        confirmLabel: "Retrieve anyway",
        tone: "danger",
      });
      if (!proceed) return;
    }

    // Folder and child types have no wildcard: with nothing picked, every
    // member has to be named, so list them first.
    const byName = new Map(catalog.map((type) => [type.xmlName, type]));
    const needLists = selectedTypes.filter(
      (kind) =>
        needsExplicitMembers(byName.get(kind)) &&
        (selectedMembers[kind] ?? []).length === 0,
    );

    const fullMembers: Record<string, string[]> = {};
    const preflight: RetrieveTypeResult[] = [];

    if (needLists.length > 0) {
      setPreparing(true);
      try {
        for (const kind of needLists) {
          try {
            // Cached from the picker when the type was opened there.
            fullMembers[kind] = await listComponents(
              organization.username,
              kind,
            );
          } catch (error) {
            preflight.push({
              kind,
              status: "failed",
              retrieved: 0,
              message: `Could not list its components: ${errorMessage(error)}`,
              warnings: [],
            });
          }
        }
      } finally {
        setPreparing(false);
      }
    }

    const failedToList = new Set(preflight.map((item) => item.kind));
    const { specs, empty } = resolveMetadataSpecs(
      selectedTypes.filter((kind) => !failedToList.has(kind)),
      selectedMembers,
      fullMembers,
    );
    for (const kind of empty) {
      preflight.push({
        kind,
        status: "skipped",
        retrieved: 0,
        message: "The org has no components of this type.",
        warnings: [],
      });
    }

    void runRetrieve(specs, false, preflight);
  }, [
    runRetrieve,
    selectedTypes,
    selectedMembers,
    organization,
    organizations,
    catalog,
    listComponents,
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
            metadata={catalog}
            selectedTypes={selectedTypes}
            loading={types.isFetching}
            error={
              types.error
                ? errorMessage(types.error, "Could not load metadata types.")
                : null
            }
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
            metadata={catalog}
            types={selectedTypes}
            activeType={activeType}
            componentsCache={componentsCache}
            loading={components.loading}
            error={
              components.error
                ? errorMessage(
                    components.error,
                    "Could not list components for this type.",
                  )
                : null
            }
            selectedMembers={selectedMembers}
            onActiveType={setActiveType}
            onToggleMember={toggleMember}
            onSelectAll={(kind) =>
              setMembers(kind, componentsCache[kind] ?? [])
            }
            onClear={clearMemberSelection}
            onBack={() => setStep("select")}
          />
        )}

        {step === "retrieve" && (
          <RetrieveProgressView entries={entries} total={entries.length} />
        )}

        {/* The result carries the error in its summary; this only covers a
            failure before any result existed. */}
        {step === "results" && retrieveError && !result && (
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
                <b>{selectedTypes.length}</b> metadata type
                {selectedTypes.length === 1 ? "" : "s"} selected
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
                  disabled={selectedTypes.length === 0 || types.isFetching}
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
                  disabled={preparing}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="mr-btn mr-btn--primary"
                  disabled={selectedTypes.length === 0 || preparing}
                  onClick={() => void startRetrieve()}
                >
                  {preparing ? "Listing components…" : "Retrieve"}
                  {!preparing && <ArrowRight size={14} />}
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
