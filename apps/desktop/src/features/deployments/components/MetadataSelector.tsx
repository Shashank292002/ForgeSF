import { useState, useMemo } from "react";
import { Search, Check, Database, Layers, X } from "lucide-react";
import type { MetadataType } from "../../metadata/types";
import { cls } from "../../../lib/cls";
import styles from "./MetadataSelector.module.css";

interface MetadataSelectorProps {
  metadataTypes: MetadataType[];
  selected: string[];
  search: string;
  loading: boolean;
  onSearchChange: (search: string) => void;
  onToggle: (xmlName: string) => void;
  onClear: () => void;
}

const CATEGORIES = [
  { key: "all", label: "All Types", icon: Layers },
  { key: "objects", label: "Objects", icon: Database },
  { key: "code", label: "Code" },
  { key: "ui", label: "UI" },
  { key: "automation", label: "Automation" },
];

const CATEGORY_MAP: Record<string, string[]> = {
  objects: [
    "CustomObject",
    "CustomField",
    "CustomTab",
    "BusinessProcess",
    "RecordType",
    "ValidationRule",
    "SharingRule",
    "PicklistValue",
  ],
  code: [
    "ApexClass",
    "ApexTrigger",
    "ApexComponent",
    "ApexPage",
    "ApexTestSuite",
    "LightningComponentBundle",
    "StaticResource",
  ],
  ui: [
    "FlexiPage",
    "Layout",
    "QuickAction",
    "GlobalValueSet",
    "HomePageComponent",
    "Flow",
    "ContentAsset",
  ],
  automation: [
    "Flow",
    "Workflow",
    "ProcessBuilder",
    "EmailTemplate",
    "AutoResponseRules",
    "AssignmentRules",
    "EscalationRules",
  ],
};

export default function MetadataSelector({
  metadataTypes,
  selected,
  search,
  loading,
  onSearchChange,
  onToggle,
  onClear,
}: MetadataSelectorProps) {
  const [activeCategory, setActiveCategory] = useState("all");

  const filtered = useMemo(() => {
    let list = metadataTypes;
    if (activeCategory !== "all") {
      const keywords = CATEGORY_MAP[activeCategory] ?? [];
      list = list.filter((m) =>
        keywords.some((k) => m.xmlName.toLowerCase().includes(k.toLowerCase())),
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (m) =>
          m.xmlName.toLowerCase().includes(q) ||
          m.directoryName.toLowerCase().includes(q),
      );
    }
    return list;
  }, [metadataTypes, activeCategory, search]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Database size={18} />
          <h3>Metadata Types</h3>
          {selected.length > 0 && (
            <span className={styles.count}>{selected.length} selected</span>
          )}
        </div>
        {selected.length > 0 && (
          <button className={styles.clearBtn} onClick={onClear}>
            <X size={14} />
            Clear
          </button>
        )}
      </div>

      {/* Search */}
      <div className={styles.searchWrap}>
        <Search size={15} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          placeholder="Search metadata types..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* Category pills */}
      <div className={styles.categories}>
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          return (
            <button
              key={cat.key}
              className={cls(
                styles.categoryPill,
                activeCategory === cat.key && styles.categoryActive,
              )}
              onClick={() => setActiveCategory(cat.key)}
            >
              {Icon && <Icon size={12} />}
              {cat.label}
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className={styles.list}>
        {loading && (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span>Loading metadata types...</span>
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className={styles.empty}>
            <Layers size={24} />
            <p>No metadata types found</p>
          </div>
        )}
        {!loading &&
          filtered.map((m) => {
            const isSelected = selected.includes(m.xmlName);
            return (
              <div
                key={m.xmlName}
                className={cls(styles.item, isSelected && styles.itemSelected)}
                onClick={() => onToggle(m.xmlName)}
              >
                <span
                  className={cls(
                    styles.checkbox,
                    isSelected && styles.checkboxChecked,
                  )}
                >
                  {isSelected && <Check size={12} />}
                </span>
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{m.xmlName}</span>
                  <span className={styles.itemDir}>{m.directoryName}</span>
                </div>
                {m.suffix && (
                  <span className={styles.itemSuffix}>.{m.suffix}</span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}
