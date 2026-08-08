import { useEffect, useState } from "react";

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
  const { organization } = useCurrentOrg();

  const metadata = useMetadataStore((state) => state.metadata);
  const setMetadata = useMetadataStore((state) => state.setMetadata);

  const loading = useMetadataStore((state) => state.loading);
  const setLoading = useMetadataStore((state) => state.setLoading);

  const output = useMetadataStore((state) => state.output);
  const setOutput = useMetadataStore((state) => state.setOutput);
  const refreshWorkspaceFiles = useWorkspaceStore((state) => state.refreshFiles);
  const [metadataSearch, setMetadataSearch] = useState("");
  const [componentSearch, setComponentSearch] = useState("");

  const [selectedType, setSelectedType] = useState("");

  const [components, setComponents] = useState<string[]>([]);

  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);

  useEffect(() => {
    if (!organization) {
      return;
    }

    const currentOrg = organization;

    async function loadMetadataTypes() {
      try {
        const types = await listMetadataTypes(currentOrg.username);

        setMetadata(types);
      } catch (error) {
        console.error("Failed to load metadata types:", error);
      }
    }

    loadMetadataTypes();
  }, [organization, setMetadata]);

  //   const filteredMetadata = useMemo(() => {
  //     return metadata.filter((item) =>
  //       item.xmlName.toLowerCase().includes(metadataSearch.toLowerCase()),
  //     );
  //   }, [metadata, metadataSearch]);

  async function handleMetadataClick(xmlName: string) {
    if (!organization) {
      return;
    }

    setSelectedType(xmlName);
    setSelectedComponents([]);
    setComponents([]);
    setOutput("");

    try {
      console.log("Loading metadata:", xmlName);

      const result = await listMetadataComponents(
        xmlName,
        organization.username,
      );

      console.log("Components:", result);

      setComponents(result);
    } catch (error) {
      console.error("Failed to load components", error);
    }
  }

  //   const filteredComponents = useMemo(() => {
  //     return components.filter((component) =>
  //       component.toLowerCase().includes(componentSearch.toLowerCase()),
  //     );
  //   }, [components, componentSearch]);

  function toggleComponent(name: string) {
    if (selectedComponents.includes(name)) {
      setSelectedComponents(selectedComponents.filter((item) => item !== name));
    } else {
      setSelectedComponents([...selectedComponents, name]);
    }
  }

  async function handleRetrieve() {
    if (!organization) {
      return;
    }

    if (selectedComponents.length === 0) {
      return;
    }

    setLoading(true);
    setOutput("");

    try {
      const members = selectedComponents.map(
        (component) => `${selectedType}:${component}`,
      );

      console.log("Username:", organization.username);
      console.log("Selected Type:", selectedType);
      console.log("Members:", members);

      await retrieveMetadata(members, organization.username);
      await refreshWorkspaceFiles();

      setOutput(
        `${selectedComponents.length} component(s) retrieved successfully.`,
      );
    } catch (error: unknown) {
      console.error("Retrieve failed:", error);

      if (error instanceof Error) {
        console.error(error.message);
        setOutput(error.message);
      } else {
        console.error(String(error));
        setOutput(String(error));
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <OrgGuard>
      <div className="metadata-page">
        <MetadataTypeList
          metadata={metadata}
          selectedType={selectedType}
          metadataSearch={metadataSearch}
          onSearchChange={setMetadataSearch}
          onSelect={handleMetadataClick}
        />

        <div className="metadata-right">
          {organization && (
            <div className="metadata-eyebrow">{organization.username}</div>
          )}

          <h2>{selectedType || "Select a Metadata Type"}</h2>

          {selectedType && (
            <>
              <MetadataToolbar
                selectedCount={selectedComponents.length}
                loading={loading}
                onRetrieve={handleRetrieve}
              />

              <MetadataExplorer
                components={components}
                componentSearch={componentSearch}
                selected={selectedComponents}
                onSearchChange={setComponentSearch}
                onToggle={toggleComponent}
              />
            </>
          )}

          {output && (
            <div className="retrieve-message">
              <strong>Retrieve complete</strong>

              <p>
                Retrieved <b>{selectedComponents.length}</b> component(s) into
                your local workspace.
              </p>

              <p>
                Open the <b>Workspace</b> page from the sidebar to browse, edit,
                compare, and deploy your metadata.
              </p>
            </div>
          )}
        </div>
      </div>
    </OrgGuard>
  );
}