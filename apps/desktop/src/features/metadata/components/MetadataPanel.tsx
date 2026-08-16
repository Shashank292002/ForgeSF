import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Search,
  Sparkles,
} from "lucide-react";

import { useMetadataStore } from "../../../store/metadataStore";
import { useWorkspaceStore } from "../../workspace/store/workspaceStore";
import useCurrentOrg from "../../../hooks/useCurrentOrg";
import {
  listMetadataTypes,
  listMetadataComponents,
  retrieveMetadata,
} from "../../../services/tauri";
import {
  categoryForType,
  categoriesForTypes,
  metadataCategoryInfo,
  CATEGORY_ORDER,
  type MetadataCategoryKey,
} from "../lib/categories";

import "./MetadataPanel.css";

interface PendingMessage {
  text: string;
  tone: "info" | "success" | "error";
}

function toggleInList<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

function Stat({
  value,
  label,
  accent,
}: {
  value: number | string;
  label: string;
  accent?: string;
}) {
  return (
    <div className="wmeta__stat">
      <span className="wmeta__stat-value" style={{ color: accent }}>
        {value}
      </span>
      <span className="wmeta__stat-label">{label}</span>
    </div>
  );
}

function CategoryChip({
  active,
  label,
  count,
  color,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`wmeta__chip ${active ? "is-active" : ""}`}
      onClick={onClick}
    >
      <span className="wmeta__chip-dot" style={{ background: color }} />
      <span className="wmeta__chip-label">{label}</span>
      <span className="wmeta__chip-count">{count}</span>
    </button>
  );
}

function Checkbox({
  checked,
  onToggle,
}: {
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={`wmeta__checkbox ${checked ? "is-checked" : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      {checked && <Check size={12} strokeWidth={3} />}
    </button>
  );
}
type View = "types" | "components";

export default function MetadataPanel() {
  const { organization } = useCurrentOrg();
  const metadata = useMetadataStore((state) => state.metadata);
  const setMetadata = useMetadataStore((state) => state.setMetadata);
  const refreshWorkspaceFiles = useWorkspaceStore((state) => state.refreshFiles);

  const [activeCategory, setActiveCategory] = useState<MetadataCategoryKey | "all">(
    "all",
  );
  const [typeSearch, setTypeSearch] = useState("");
  const [view, setView] = useState<View>("types");

  const [selectedType, setSelectedType] = useState<string>("");
  const [components, setComponents] = useState<string[]>([]);
  const [selectedComponents, setSelectedComponents] = useState<string[]>([]);
  const [componentSearch, setComponentSearch] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<PendingMessage | null>(null);

  // Derived data
  const categoryCounts = useMemo(() => categoriesForTypes(metadata), [metadata]);

  const filteredTypes = useMemo(() => {
    const q = typeSearch.trim().toLowerCase();
    return metadata.filter((type) => {
      if (activeCategory !== "all" && categoryForType(type.xmlName).key !== activeCategory) {
        return false;
      }
      return q ? type.xmlName.toLowerCase().includes(q) : true;
    });
  }, [metadata, activeCategory, typeSearch]);

  const filteredComponents = useMemo(() => {
    const q = componentSearch.trim().toLowerCase();
    return q
      ? components.filter((component) => component.toLowerCase().includes(q))
      : components;
  }, [components, componentSearch]);

  const selectedTypeInfo = selectedType ? categoryForType(selectedType) : null;

  // Data loading
  const loadTypes = async () => {
    if (!organization) return;
    setMessage(null);
    try {
      const types = await listMetadataTypes(organization.username);
      setMetadata(types);
    } catch (error) {
      console.error(error);
      setMessage({ text: "Could not load metadata types.", tone: "error" });
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (organization) void loadTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organization]);

  const openType = async (xmlName: string) => {
    if (!organization) return;

    setSelectedType(xmlName);
    setSelectedComponents([]);
    setComponents([]);
    setComponentSearch("");
    setView("components");
    setMessage(null);

    try {
      const items = await listMetadataComponents(xmlName, organization.username);
      setComponents(items);
    } catch (error) {
      console.error(error);
      setMessage({ text: "Could not load metadata components.", tone: "error" });
    }
  };

  const closeType = () => {
    setView("types");
    setSelectedType("");
    setSelectedComponents([]);
    setComponents([]);
    setMessage(null);
  };

  const toggleComponent = (value: string) => {
    setSelectedComponents((current) => toggleInList(current, value));
  };

  const toggleAllComponents = () => {
    setSelectedComponents((current) =>
      current.length === filteredComponents.length ? [] : [...filteredComponents],
    );
  };

  const onRetrieve = async () => {
    if (!organization || selectedComponents.length === 0) return;

    setLoading(true);
    setMessage(null);

    try {
      const members = selectedComponents.map((item) => `${selectedType}:${item}`);
      await retrieveMetadata(members, organization.username);
      await refreshWorkspaceFiles();
      setMessage({
        text: `${selectedComponents.length} item(s) retrieved into the workspace.`,
        tone: "success",
      });
      setSelectedComponents([]);
    } catch (error) {
      console.error(error);
      setMessage({
        text: "Metadata retrieval failed. See the terminal for details.",
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = () => {
    if (view === "components" && selectedType) void openType(selectedType);
    else void loadTypes();
  };

  return (
    <section className="wmeta">
      <header className="wmeta__head">
        <div className="wmeta__head-title">
          <span className="wmeta__eyebrow">Workspace</span>
          <h2 className="wmeta__title">Metadata</h2>
        </div>
        <button
          type="button"
          className="wmeta__icon-btn"
          onClick={onRefresh}
          title="Refresh metadata"
          aria-label="Refresh metadata"
        >
          <RotateCw size={14} className={loading ? "is-spinning" : ""} />
        </button>
      </header>

      {!organization ? (
        <div className="wmeta__placeholder">
          <Sparkles size={22} />
          <p>Connect an org to browse its metadata.</p>
        </div>
      ) : (
        <div className="wmeta__body">
          <div className="wmeta__stats">
            <Stat value={metadata.length} label="Types" accent="#60a5fa" />
            <Stat value={selectedComponents.length} label="Selected" accent="#a78bfa" />
            <Stat
              value={view === "components" ? components.length : "—"}
              label={view === "components" ? "Items" : "Ready"}
              accent="#34d399"
            />
          </div>

          <div className="wmeta__search">
            <Search size={14} className="wmeta__search-icon" />
            <input
              value={view === "components" ? componentSearch : typeSearch}
              onChange={(event) =>
                view === "components"
                  ? setComponentSearch(event.target.value)
                  : setTypeSearch(event.target.value)
              }
              placeholder={
                view === "components"
                  ? `Search ${selectedType}…`
                  : "Search metadata types…"
              }
            />
            {(view === "components" ? componentSearch : typeSearch) && (
              <button
                type="button"
                className="wmeta__search-clear"
                onClick={() =>
                  view === "components"
                    ? setComponentSearch("")
                    : setTypeSearch("")
                }
                aria-label="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          {view === "types" ? (
            <div className="wmeta__types">
              <div className="wmeta__chips">
                <button
                  type="button"
                  className={`wmeta__chip ${activeCategory === "all" ? "is-active" : ""}`}
                  onClick={() => setActiveCategory("all")}
                >
                  <span className="wmeta__chip-dot wmeta__chip-dot--all" />
                  <span className="wmeta__chip-label">All</span>
                  <span className="wmeta__chip-count">{metadata.length}</span>
                </button>

                {CATEGORY_ORDER.map((key) => {
                  const count = categoryCounts[key];
                  if (count === 0) return null;
                  const info = metadataCategoryInfo(key);
                  return (
                    <CategoryChip
                      key={key}
                      active={activeCategory === key}
                      label={info.label}
                      count={count}
                      color={info.color}
                      onClick={() =>
                        setActiveCategory((current) =>
                          current === key ? "all" : key,
                        )
                      }
                    />
                  );
                })}
              </div>

              <div className="wmeta__type-list">
                {filteredTypes.length === 0 ? (
                  <div className="wmeta__empty">
                    {metadata.length === 0
                      ? "No metadata types found in this org."
                      : "No types match your search."}
                  </div>
                ) : (
                  filteredTypes.map((type) => {
                    const info = categoryForType(type.xmlName);
                    const Icon = info.icon;
                    return (
                      <button
                        key={type.xmlName}
                        type="button"
                        className="wmeta__type"
                        onClick={() => void openType(type.xmlName)}
                      >
                        <span
                          className="wmeta__type-icon"
                          style={{ color: info.color }}
                        >
                          <Icon size={15} />
                        </span>
                        <span className="wmeta__type-main">
                          <span className="wmeta__type-name">{type.xmlName}</span>
                          <span className="wmeta__type-meta">
                            {type.suffix ? `.${type.suffix}` : "metadata"}
                            {type.inFolder ? " · folder" : ""}
                            {type.metaFile ? " · -meta.xml" : ""}
                          </span>
                        </span>
                        <ChevronRight size={15} className="wmeta__type-arrow" />
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            <div className="wmeta__components">
              <div className="wmeta__crumb">
                <button
                  type="button"
                  className="wmeta__crumb-back"
                  onClick={closeType}
                  title="Back to types"
                >
                  <ChevronLeft size={15} />
                </button>
                {selectedTypeInfo && (
                  <span
                    className="wmeta__crumb-dot"
                    style={{ background: selectedTypeInfo.color }}
                  />
                )}
                <span className="wmeta__crumb-name">{selectedType}</span>
              </div>

              <div className="wmeta__list-head">
                <span className="wmeta__list-count">
                  {filteredComponents.length.toLocaleString()} item
                  {filteredComponents.length === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  className="wmeta__select-all"
                  onClick={toggleAllComponents}
                >
                  {selectedComponents.length === filteredComponents.length &&
                  filteredComponents.length > 0
                    ? "Deselect all"
                    : "Select all"}
                </button>
              </div>

              <div className="wmeta__components-list">
                {filteredComponents.length === 0 ? (
                  <div className="wmeta__empty">
                    {components.length === 0
                      ? "No components of this type were returned."
                      : "No components match your search."}
                  </div>
                ) : (
                  filteredComponents.map((component) => {
                    const selected = selectedComponents.includes(component);
                    return (
                      <button
                        key={component}
                        type="button"
                        className={`wmeta__component ${selected ? "is-selected" : ""}`}
                        onClick={() => toggleComponent(component)}
                      >
                        <Checkbox
                          checked={selected}
                          onToggle={() => toggleComponent(component)}
                        />
                        <span className="wmeta__component-name">{component}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {message && (
        <div className={`wmeta__message is-${message.tone}`}>{message.text}</div>
      )}

      {view === "components" && (
        <footer className="wmeta__actions">
          <span className="wmeta__actions-info">
            {selectedComponents.length
              ? `${selectedComponents.length} selected`
              : "Nothing selected"}
          </span>
          <button
            type="button"
            className="wmeta__actions-clear"
            onClick={() => setSelectedComponents([])}
            disabled={selectedComponents.length === 0}
          >
            Clear
          </button>
          <button
            type="button"
            className="wmeta__actions-retrieve"
            onClick={onRetrieve}
            disabled={selectedComponents.length === 0 || loading}
          >
            {loading ? "Retrieving…" : "Retrieve"}
            {selectedComponents.length > 0 && !loading
              ? ` ${selectedComponents.length}`
              : ""}
          </button>
        </footer>
      )}
    </section>
  );
}