import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  GitBranch,
  Loader2,
  Network,
  Search,
} from "lucide-react";

import {
  dependencyTypes,
  metadataDependencies,
} from "./services/dependencyService";
import { useOrganizationStore } from "../../store/orgStore";
import { offerReauthentication } from "../org-manager/lib/orgErrors";
import { Badge, Button } from "../../components/ui";
import OrgGuard from "../../components/OrgGuard/OrgGuard";
import { errorMessage } from "../../lib/errors";
import type { DependencyNode } from "@/types/generated";

import "./DependenciesPage.css";

/**
 * What uses a component, and what it uses.
 *
 * Shown as two lists rather than a graph: the question people actually ask is
 * "what breaks if I change this", and a list of names answers it directly,
 * where a hairball of nodes has to be read before it says anything. Each name
 * is a link, so following a chain is a click at a time — and the trail of
 * where you have been stays on screen.
 */
export default function DependenciesPage() {
  const org = useOrganizationStore((state) => state.selectedOrganization);

  const [search, setSearch] = useState("");
  const [type, setType] = useState("ApexClass");

  // Which types can be looked up at all — the resolver decides, not the UI.
  const types = useQuery({
    queryKey: ["dependency-types"],
    queryFn: dependencyTypes,
    staleTime: Infinity,
  });
  /** Where the trail has been; the last is what is shown. */
  const [trail, setTrail] = useState<DependencyNode[]>([]);
  const current = trail[trail.length - 1] ?? null;

  const dependencies = useQuery({
    queryKey: [
      "dependencies",
      org?.username,
      current?.name,
      current?.componentType,
    ],
    queryFn: () =>
      metadataDependencies(
        org?.username as string,
        current?.name as string,
        current?.componentType as string,
      ),
    enabled:
      Boolean(org?.username) &&
      Boolean(current?.name) &&
      Boolean(current?.componentType),
    staleTime: 5 * 60 * 1000,
  });

  // In an effect, not the render body: offering re-authentication shows a
  // sticky toast, and calling it during render re-created that toast on every
  // keystroke for as long as the error stayed in state.
  useEffect(() => {
    if (dependencies.error) offerReauthentication(dependencies.error, org);
  }, [dependencies.error, org]);

  function look(node: DependencyNode) {
    setTrail((current) => [...current, node]);
  }

  function back() {
    setTrail((current) => current.slice(0, -1));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const name = search.trim();
    if (!name) return;
    setTrail([{ name, componentType: type }]);
  }

  const list = (
    title: string,
    hint: string,
    nodes: DependencyNode[] | undefined,
  ) => (
    <section className="deps-list">
      <header>
        <h2>{title}</h2>
        <span>{hint}</span>
        {nodes && <Badge tone="default">{nodes.length}</Badge>}
      </header>

      {dependencies.isPending ? (
        <p className="deps-state">
          <Loader2 size={15} className="deps-spin" /> Asking the org…
        </p>
      ) : !nodes || nodes.length === 0 ? (
        <p className="deps-state">Nothing.</p>
      ) : (
        <ul>
          {nodes.map((node) => (
            <li key={`${node.componentType}:${node.name}`}>
              <button type="button" onClick={() => look(node)}>
                <span className="deps-name">{node.name}</span>
                <span className="deps-type">{node.componentType}</span>
                <ArrowRight size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <OrgGuard>
      <div className="deps-page">
        <header className="deps-head">
          <span className="deps-head__icon">
            <Network size={22} />
          </span>
          <div className="deps-head__text">
            <h1>Dependencies</h1>
            <p>
              What uses a component, and what it uses — from the org&apos;s own
              dependency records.
            </p>
          </div>
        </header>

        <form className="deps-search" onSubmit={submit}>
          <Search size={15} />
          <input
            type="text"
            value={search}
            placeholder="A component's API name — AccountService, Status__c, My_Flow…"
            aria-label="Component name"
            spellCheck={false}
            onChange={(event) => setSearch(event.target.value)}
          />
          <select
            value={type}
            aria-label="Component type"
            onChange={(event) => setType(event.target.value)}
          >
            {(types.data ?? ["ApexClass"]).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!search.trim()}
          >
            Look up
          </Button>
        </form>

        {trail.length > 1 && (
          <nav className="deps-trail" aria-label="Where you have been">
            <button type="button" onClick={back}>
              <ArrowLeft size={13} /> Back
            </button>
            <span>
              {trail.map((node, index) => (
                <span key={`${node.name}-${index}`}>
                  {index > 0 && " → "}
                  {node.name}
                </span>
              ))}
            </span>
          </nav>
        )}

        {dependencies.error && (
          <p className="deps-error" role="alert">
            <AlertTriangle size={14} />{" "}
            {errorMessage(
              dependencies.error,
              "Could not read this org's dependencies.",
            )}
          </p>
        )}

        {dependencies.data?.truncated && (
          <p className="deps-warning" role="status">
            <AlertTriangle size={14} /> The org returned as many rows as it
            will; there may be more than are listed.
          </p>
        )}

        {!current ? (
          <p className="deps-empty">
            <GitBranch size={18} />
            Name a component above and say what kind it is. Dependencies come
            from the org&apos;s own records, so they reflect the org rather than
            the files on disk.
          </p>
        ) : (
          <>
            <div className="deps-current">
              <strong>{current.name}</strong>
              {current.componentType && (
                <Badge tone="info">{current.componentType}</Badge>
              )}
            </div>

            <div className="deps-columns">
              {list(
                "Used by",
                "These break if it changes",
                dependencies.data?.usedBy,
              )}
              {list("Uses", "It depends on these", dependencies.data?.uses)}
            </div>
          </>
        )}
      </div>
    </OrgGuard>
  );
}
