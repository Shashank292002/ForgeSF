import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaceStore } from "../../workspace/store/workspaceStore";
import useCurrentOrg from "../../../hooks/useCurrentOrg";
import {
  listMetadataTypes,
  listMetadataComponents,
  retrieveMetadata,
} from "../../../services/tauri";
import { useMetadataStore } from "../../../store/metadataStore";
import MetadataExplorer from "./MetadataExplorer";
import MetadataToolbar from "./MetadataToolbar";
import "./MetadataPanel.css";

export default function MetadataPanel() {
  const { organization } = useCurrentOrg();
  const metadata = useMetadataStore((state) => state.metadata);
  const setMetadata = useMetadataStore((state) => state.setMetadata);

  const [selectedType, setSelectedType] = useState<string>("");
  const [typeSearch, setTypeSearch] = useState<string>("");
  const [componentSearch, setComponentSearch] = useState<string>("");
  const [components, setComponents] = useState<string[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");

  const refreshWorkspaceFiles = useWorkspaceStore((state) => state.refreshFiles);

  const filteredTypes = useMemo(
    () =>
      metadata.filter((type) =>
        type.xmlName.toLowerCase().includes(typeSearch.toLowerCase()),
      ),
    [metadata, typeSearch],
  );

  const filteredComponents = useMemo(
    () =>
      components.filter((component) =>
        component.toLowerCase().includes(componentSearch.toLowerCase()),
      ),
    [components, componentSearch],
  );

  const loadTypes = useCallback(async () => {
    if (!organization) return;

    try {
      setMessage("");
      const types = await listMetadataTypes(organization.username);
      setMetadata(types);
    } catch (error) {
      console.error(error);
      setMessage("Could not load metadata types.");
    }
  }, [organization, setMetadata]);

  useEffect(() => {
    if (!organization) return;

    void loadTypes();
  }, [organization, loadTypes]);

  async function loadComponents(xmlName: string) {
    if (!organization) return;

    setSelectedType(xmlName);
    setSelectedComponents([]);
    setComponents([]);
    setComponentSearch("");
    setMessage("");

    try {
      const items = await listMetadataComponents(xmlName, organization.username);
      setComponents(items);
    } catch (error) {
      console.error(error);
      setMessage("Could not load metadata components.");
    }
  }

  function toggleComponent(value: string) {
    setSelectedComponents((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }

  async function onRetrieve() {
    if (!organization || selectedComponents.length === 0) {
      return;
    }

    setLoading(true);
    setMessage("");

    try {
      const members = selectedComponents.map((item) => `${selectedType}:${item}`);
      await retrieveMetadata(members, organization.username);
      await refreshWorkspaceFiles();
      setMessage(`Retrieved ${selectedComponents.length} item(s) into workspace.`);
      setSelectedComponents([]);
    } catch (error) {
      console.error(error);
      setMessage("Metadata retrieval failed. See logs for details.");
    } finally {
      setLoading(false);
    }
  }

  function onRefresh() {
    if (selectedType) {
      void loadComponents(selectedType);
      return;
    }

    void loadTypes();
  }

  return (
    <aside className="metadata-panel">
      <div className="metadata-panel__header">
        <div>
          <p className="metadata-panel__label">Metadata</p>
          <h3>Explorer</h3>
        </div>
        <button className="metadata-panel__refresh" onClick={onRefresh} type="button">
          Refresh
        </button>
      </div>

      <div className="metadata-panel__body">
        <div className="metadata-panel__section metadata-panel__types-section">
          <div className="metadata-panel__section-title">Types</div>
          <input
            className="metadata-panel__search"
            placeholder="Filter metadata types"
            value={typeSearch}
            onChange={(event) => setTypeSearch(event.target.value)}
          />

          <div className="metadata-panel__list metadata-panel__list--scroll">
            {filteredTypes.length === 0 ? (
              <div className="metadata-panel__empty">No matching metadata types found.</div>
            ) : (
              filteredTypes.map((type) => (
                <button
                  key={type.xmlName}
                  className={`metadata-panel__item ${selectedType === type.xmlName ? "active" : ""}`}
                  onClick={() => loadComponents(type.xmlName)}
                  type="button"
                >
                  {type.xmlName}
                </button>
              ))
            )}
          </div>
        </div>

        <div className="metadata-panel__section metadata-panel__components-section">
          <div className="metadata-panel__section-title">Components</div>

          {selectedType ? (
            <>
              <MetadataToolbar
                selectedCount={selectedComponents.length}
                loading={loading}
                onRetrieve={onRetrieve}
              />

              <MetadataExplorer
                components={filteredComponents}
                componentSearch={componentSearch}
                selected={selectedComponents}
                onSearchChange={setComponentSearch}
                onToggle={toggleComponent}
              />
            </>
          ) : (
            <div className="metadata-panel__empty">Select a type to browse components.</div>
          )}
        </div>
      </div>

      {message && <div className="metadata-panel__message">{message}</div>}
    </aside>
  );
}
