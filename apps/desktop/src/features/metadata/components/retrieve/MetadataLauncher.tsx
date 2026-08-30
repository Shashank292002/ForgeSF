import { ArrowRight, Cloud, Database, FolderOpen, Layers } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useMetadataStore } from "../../../../store/metadataStore";
import { useOrganizationStore } from "../../../../store/orgStore";
import { useWorkspaceStore } from "../../../workspace/store/workspaceStore";
import { prettyMetadataKind } from "../../lib/categories";

import "./MetadataRetriever.css";

export default function MetadataLauncher() {
  const navigate = useNavigate();
  const openRetrieve = useWorkspaceStore((s) => s.openRetrieve);
  const selectedTypes = useMetadataStore((s) => s.selectedTypes);
  const files = useWorkspaceStore((s) => s.files);
  const organization = useOrganizationStore((s) => s.selectedOrganization);

  const fileCount = (() => {
    let count = 0;
    const walk = (nodes: typeof files) => {
      for (const node of nodes) {
        if (node.type === "file") count += 1;
        else if (node.children) walk(node.children);
      }
    };
    walk(files);
    return count;
  })();

  const topKinds = selectedTypes.slice(0, 3);

  return (
    <div className="mr-launcher">
      <span className="mr-launcher__icon">
        <Database size={24} />
      </span>
      <div>
        <div className="mr-launcher__title">Retrieve Metadata</div>
        <div className="mr-launcher__desc">
          Pull source from your org — classes, triggers, LWC, objects, flows and
          more — straight into your project.
        </div>
      </div>

      <button type="button" className="mr-launcher__btn" onClick={openRetrieve}>
        <Database size={15} /> Start Retrieve <ArrowRight size={14} />
      </button>

      <div className="mr-launcher__meta">
        {organization && (
          <span className="mr-launcher__badge">
            <Cloud size={12} style={{ color: "var(--mr-success)" }} />
            {organization.alias || organization.username}
          </span>
        )}
        <span className="mr-launcher__badge">
          <FolderOpen size={12} /> {fileCount} file{fileCount === 1 ? "" : "s"}
        </span>
        {selectedTypes.length > 0 && (
          <span className="mr-launcher__badge">
            <Layers size={12} style={{ color: "var(--mr-brand)" }} />
            {selectedTypes.length} selected
          </span>
        )}
      </div>

      {topKinds.length > 0 && (
        <div className="mr-launcher__hint">
          Ready: {topKinds.map(prettyMetadataKind).join(", ")}
          {selectedTypes.length > topKinds.length ? "…" : ""}
        </div>
      )}

      <button type="button" className="mr-btn mr-btn--ghost" onClick={() => navigate("/workspace")} style={{ justifyContent: "center" }}>
        Go to Workspace <ArrowRight size={14} />
      </button>
    </div>
  );
}