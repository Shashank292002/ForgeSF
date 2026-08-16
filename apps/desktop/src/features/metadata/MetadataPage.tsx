import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import "./MetadataPage.css";

import OrgGuard from "../../components/OrgGuard/OrgGuard";
import useCurrentOrg from "../../hooks/useCurrentOrg";

import {
  listMetadataTypes,
  listMetadataComponents,
  retrieveMetadata,
} from "../../services/tauri";

import { useMetadataStore } from "../../store/metadataStore";
import { useWorkspaceStore } from "../workspace/store/workspaceStore";

import MetadataTypeList from "./components/MetadataTypeList";
import MetadataExplorer from "./components/MetadataExplorer";
import MetadataToolbar from "./components/MetadataToolbar";

export default function MetadataPage() {
  const navigate = useNavigate();
  const { organization } = useCurrentOrg();

  const metadata = useMetadataStore((state) => state.metadata);
  const setMetadata = useMetadataStore((state) => state.setMetadata);

  const loading = useMetadataStore((state) => state.loading);
  const setLoading = useMetadataStore((state) => state.setLoading);

  const output = useMetadataStore((state) => state.output);
  const setOutput = useMetadataStore((state) => state.setOutput);
  const refreshWorkspaceFiles = useWorkspaceStore((state) => state.refreshFiles);

  const [typesLoading, setTypesLoading] = useState(false);
  const [typesError, setTypesError] = useState<string | null>(null);

  const [metadataSearch, setMetadataSearch] = useState("");
  const [componentSearch, setComponentSearch] = useState("");

  const [selectedType, setSelectedType] = useState("");
  const [components, setComponents] = useState<string[]>([]);
  const [componentsLoading, setComponentsLoading] = useState(false);
  const [componentsError, setComponentsError] = useState<string | null>(null);

  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);

  // Load the list of metadata types available in the connected org.
  const loadTypes = useCallback(async () => {
    if (!organization) return;

    setTypesLoading(true);
    setTypesError(null);

    try {
      const types = await listMetadataTypes(organization.username);
      setMetadata(types);
    } catch (error) {
      console.error("Failed to load metadata types:", error);
      setTypesError(error instanceof Error ? error.message : String(error));
    } finally {
      setTypesLoading(false);
    }
  }, [organization, setMetadata]);

  useEffect(() => {
    // Intentional async fetch on mount / org change. The synchronous
    // `setTypesLoading(true)` inside loadTypes is needed to render the loading
    // state immediately; suppress the cascading-render warning for this case.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTypes();
  }, [loadTypes]);

  const filteredTypes = useMemo(() => {
    const q = metadataSearch.trim().toLowerCase();
    if (!q) return metadata;
    return metadata.filter((item) => item.xmlName.toLowerCase().includes(q));
  }, [metadata, metadataSearch]);

  async function handleMetadataClick(xmlName: string) {
    if (!organization) return;

    setSelectedType(xmlName);
    setSelectedComponents([]);
    setComponents([]);
    setComponentsError(null);
    setComponentSearch("");
    setOutput("");

    setComponentsLoading(true);
    try {
      const result = await listMetadataComponents(xmlName, organization.username);
      setComponents(result);
    } catch (error) {
      console.error("Failed to load components", error);
      setComponentsError(error instanceof Error ? error.message : String(error));
      setComponents([]);
    } finally {
      setComponentsLoading(false);
    }
  }

  const filteredComponents = useMemo(() => {
    const q = componentSearch.trim().toLowerCase();
    if (!q) return components;
    return components.filter((component) => component.toLowerCase().includes(q));
  }, [components, componentSearch]);

  function toggleComponent(name: string) {
    setSelectedComponents((prev) =>
      prev.includes(name) ? prev.filter((item) => item !== name) : [...prev, name],
    );
  }

  function clearSelection() {
    setSelectedComponents([]);
  }

  function refreshComponents() {
    if (selectedType) void handleMetadataClick(selectedType);
  }

  async function handleRetrieve() {
    if (!organization || selectedComponents.length === 0) return;

    setLoading(true);
    setOutput("");

    try {
      const members = selectedComponents.map(
        (component) => `${selectedType}:${component}`,
      );

      await retrieveMetadata(members, organization.username);
      await refreshWorkspaceFiles();

      setOutput(
        `${selectedComponents.length} component(s) retrieved successfully.`,
      );
    } catch (error: unknown) {
      console.error("Retrieve failed:", error);
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
      clearSelection();
    }
  }

  const failed = output.includes("failed") || output.includes("Error");

  return (
<OrgGuard>
      <div className="metadata-page">
        <MetadataTypeList
          metadata={filteredTypes}
          selectedType={selectedType}
          metadataSearch={metadataSearch}
          loading={typesLoading}
          error={typesError}
          total={metadata.length}
          onSearchChange={setMetadataSearch}
          onRefresh={loadTypes}
          onSelect={handleMetadataClick}
        />

        <div className="metadata-right">
          <div className="metadata-right-head">
            {organization && (
              <div className="metadata-eyebrow">{organization.username}</div>
            )}

            <h2>{selectedType || "Select a Metadata Type"}</h2>
          </div>

          {selectedType ? (
            <>
              <MetadataToolbar
                selectedCount={selectedComponents.length}
                loading={loading}
                onRetrieve={handleRetrieve}
                onRefresh={refreshComponents}
                onClear={clearSelection}
                onOpen={() => navigate("/workspace")}
              />

              <MetadataExplorer
                components={filteredComponents}
                componentSearch={componentSearch}
                selected={selectedComponents}
                loading={componentsLoading}
                error={componentsError}
                onSearchChange={setComponentSearch}
                onToggle={toggleComponent}
              />
            </>
          ) : (
            <div className="metadata-panel__empty">
              Select a metadata type from the left to browse its components.
            </div>
          )}

          {output && (
            <div
              className={`retrieve-message ${failed ? "is-error" : ""}`}
              role="status"
            >
              <strong>{failed ? "Retrieve failed" : "Retrieve complete"}</strong>
              <p>{output}</p>
              {!failed && (
                <p>
                  Retrieved components are now in your local workspace. Open the{" "}
                  <b>Workspace</b> page to browse, edit, compare, and deploy
                  them.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </OrgGuard>
  );
}