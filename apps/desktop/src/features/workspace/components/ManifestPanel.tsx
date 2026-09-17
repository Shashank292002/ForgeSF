import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  DownloadCloud,
  FileCode,
  GitCompare,
  Loader2,
  Plus,
  RefreshCw,
  Rocket,
} from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import {
  generateManifest,
  listManifests,
  retrieveManifest,
} from "../services/manifestService";
import { useOrganizationStore } from "../../../store/orgStore";
import { protectionPrompt } from "../../org-manager/lib/orgProtection";
import { offerReauthentication } from "../../org-manager/lib/orgErrors";
import { ask, confirm, prompt } from "../../../components/ui/Confirm/confirm";
import { toast } from "../../../components/ui/Toast/toast";
import { errorMessage } from "../../../lib/errors";
import { recordActivity } from "../../../store/activityStore";
import type { ManifestFile } from "@/types/generated";

import "./ManifestPanel.css";

/**
 * The project's `package.xml` files, and what can be done with them.
 *
 * A manifest is how a set of metadata travels: it can be committed, reviewed
 * and reused, which a selection made in a wizard cannot. Generating one from
 * the source already on disk is the quickest way to get a real one.
 */
export default function ManifestPanel() {
  const workspaceId = useWorkspaceStore((state) => state.openWorkspaceId);
  const selection = useWorkspaceStore((state) => state.explorerSelection);
  const refreshFiles = useWorkspaceStore((state) => state.refreshFiles);
  const deployManifest = useWorkspaceStore(
    (state) => state.deployManifestAction,
  );
  const compare = useWorkspaceStore((state) => state.compareOrgs);
  const appendLog = useWorkspaceStore((state) => state.appendLog);
  const org = useOrganizationStore((state) => state.selectedOrganization);
  const organizations = useOrganizationStore((state) => state.organizations);

  // Keyed by workspace, so opening another project lists its manifests
  // instead of leaving the previous one's on screen.
  const list = useQuery({
    queryKey: ["manifests", workspaceId],
    queryFn: () => listManifests(workspaceId),
    staleTime: 30 * 1000,
  });
  const manifests = list.data ?? [];

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => void list.refetch();

  async function generate() {
    const picked = selection.paths;
    if (picked.length === 0) {
      toast.info("Select a folder or some files in the Explorer first.", {
        title: "Nothing to describe",
      });
      return;
    }

    const name = await prompt({
      title: "Generate a manifest",
      message: `From ${picked.length} selected item${picked.length === 1 ? "" : "s"}. It is written into manifest/.`,
      details: picked.slice(0, 6),
      label: "Name",
      initialValue: "package",
      confirmLabel: "Generate",
    });
    if (!name) return;

    // Cleared per attempt: the banner was only ever set, so one failure
    // stayed on screen for the panel's life and hid every later error.
    setError(null);
    setBusy("generate");
    try {
      const path = await generateManifest(name, picked, undefined, workspaceId);
      appendLog(`Manifest written — ${path}`, "success", "terminal");
      await refreshFiles();
      load();
    } catch (caught) {
      setError(errorMessage(caught, "Could not generate the manifest."));
    } finally {
      setBusy(null);
    }
  }

  async function retrieve(manifest: ManifestFile) {
    if (!org) {
      toast.error("Connect an org before retrieving.");
      return;
    }

    setError(null);
    setBusy(manifest.path);
    try {
      const files = await retrieveManifest(
        org.username,
        manifest.path,
        workspaceId,
      );
      appendLog(
        `Retrieved ${files.length} file${files.length === 1 ? "" : "s"} from ${manifest.name}`,
        "success",
        "terminal",
      );
      recordActivity({
        kind: "success",
        source: "retrieve",
        title: `Retrieved ${files.length} file${files.length === 1 ? "" : "s"} through ${manifest.name}`,
        org: org.alias,
      });
      await refreshFiles();
    } catch (caught) {
      setError(errorMessage(caught, "The retrieve failed."));
      offerReauthentication(caught, org);
    } finally {
      setBusy(null);
    }
  }

  async function deploy(manifest: ManifestFile) {
    if (!org) {
      toast.error("Connect an org before deploying.");
      return;
    }

    const warning = protectionPrompt(org, "Deploy", "Deploy");
    if (warning && !(await confirm(warning))) return;

    setError(null);
    setBusy(manifest.path);
    try {
      await deployManifest(manifest.path);
    } finally {
      setBusy(null);
    }
  }

  /** Compares this manifest's metadata between the open org and another. */
  async function compareWith(manifest: ManifestFile) {
    if (!org) {
      toast.error("Connect an org before comparing.");
      return;
    }

    const others = organizations.filter((item) => item.id !== org.id);
    if (others.length === 0) {
      toast.info("Connect a second org to compare against.", {
        title: "Only one org",
      });
      return;
    }

    // Every connected org, not the first three: with five orgs connected,
    // two of them simply could not be chosen, with nothing saying so.
    const chosen =
      others.length <= 3
        ? await ask({
            title: `Compare ${manifest.name} against…`,
            message: `${org.alias} is on one side. Both orgs are read into scratch projects — this workspace is not touched.`,
            actions: others.map((item) => ({
              value: item.username,
              label: item.alias,
              variant: "secondary" as const,
            })),
          })
        : await ask({
            title: `Compare ${manifest.name} against…`,
            message: `${org.alias} is on one side. Both orgs are read into scratch projects — this workspace is not touched.`,
            choicesLabel: "Other org",
            choices: others.map((item) => ({
              value: item.username,
              label: `${item.alias} (${item.orgType})`,
            })),
            actions: [{ value: "compare", label: "Compare" }],
          });
    if (!chosen) return;

    setError(null);
    setBusy(manifest.path);
    try {
      await compare({
        sourceUsername: org.username,
        targetUsername: chosen,
        manifestPath: manifest.path,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="fw-manifests">
      <div className="fw-manifests__actions">
        <button
          type="button"
          className="fw-manifests__new"
          onClick={() => void generate()}
          disabled={busy !== null}
          title="Build a package.xml from what is selected in the Explorer"
        >
          {busy === "generate" ? (
            <Loader2 size={13} className="fw-spin" />
          ) : (
            <Plus size={13} />
          )}
          From selection
        </button>
        <button
          type="button"
          className="fw-manifests__ghost"
          onClick={load}
          disabled={list.isFetching}
          title="Look for manifests again"
          aria-label="Look for manifests again"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      {(error || list.error) && (
        <p className="fw-manifests__error" role="alert">
          <AlertTriangle size={13} />{" "}
          {error ??
            errorMessage(
              list.error,
              "Could not list this project's manifests.",
            )}
        </p>
      )}

      {manifests.length === 0 ? (
        <p className="fw-manifests__empty">
          {list.isPending
            ? "Looking…"
            : "No manifests yet. Select a folder in the Explorer and generate one — it lands in manifest/, where it can be committed and reused."}
        </p>
      ) : (
        <ul className="fw-manifests__list">
          {manifests.map((manifest) => (
            <li key={manifest.path} className="fw-manifests__item">
              <span className="fw-manifests__name" title={manifest.path}>
                <FileCode size={13} />
                {manifest.name}
              </span>
              <span className="fw-manifests__summary">
                {manifest.memberCount} member
                {manifest.memberCount === 1 ? "" : "s"} ·{" "}
                {manifest.types.length} type
                {manifest.types.length === 1 ? "" : "s"}
              </span>
              <span
                className="fw-manifests__types"
                title={manifest.types.join(", ")}
              >
                {manifest.types.slice(0, 4).join(", ")}
                {manifest.types.length > 4 ? "…" : ""}
              </span>
              <span className="fw-manifests__buttons">
                <button
                  type="button"
                  onClick={() => void retrieve(manifest)}
                  disabled={busy !== null || !org}
                  title="Retrieve everything this manifest names, into this workspace"
                >
                  {busy === manifest.path ? (
                    <Loader2 size={12} className="fw-spin" />
                  ) : (
                    <DownloadCloud size={12} />
                  )}
                  Retrieve
                </button>
                <button
                  type="button"
                  onClick={() => void deploy(manifest)}
                  disabled={busy !== null || !org}
                  title="Deploy everything this manifest names, from this workspace"
                >
                  <Rocket size={12} />
                  Deploy
                </button>
                <button
                  type="button"
                  onClick={() => void compareWith(manifest)}
                  disabled={busy !== null || !org}
                  title="Compare this metadata between two orgs"
                >
                  <GitCompare size={12} />
                  Compare
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
