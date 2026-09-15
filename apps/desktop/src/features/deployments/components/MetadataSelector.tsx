import { useState, useMemo } from "react";
import { Search, Check, Database, Layers, X } from "lucide-react";
import type { MetadataType } from "../../metadata/types";
import {
  CATEGORY_ORDER,
  categoriesForTypes,
  categoryForType,
  metadataCategoryInfo,
  type MetadataCategoryKey,
} from "../../metadata/lib/categories";
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

/**
 * Picks whole metadata types to deploy.
 *
 * Categories come from the same rules as the retrieve wizard. This used to
 * keep its own keyword list, matched by substring — "Flow" also caught
 * "FlowDefinition", and one entry was a type that does not exist.
 */
export default function MetadataSelector({
  metadataTypes,
  selected,
  search,
  loading,
  onSearchChange,
  onToggle,
  onClear,
}: MetadataSelectorProps) {
  const [activeCategory, setActiveCategory] = useState<
    MetadataCategoryKey | "all"
  >("all");

  const counts = useMemo(
    () => categoriesForTypes(metadataTypes),
    [metadataTypes],
  );

  const filtered = useMemo(() => {
    let list = metadataTypes;
    if (activeCategory !== "all") {
      list = list.filter(
        (m) => categoryForType(m.xmlName).key === activeCategory,
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (m) =>
          m.xmlName.toLowerCase().includes(q) ||
          m.directoryName.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) => a.xmlName.localeCompare(b.xmlName));
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
          <button type="button" className={styles.clearBtn} onClick={onClear}>
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
          aria-label="Search metadata types"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      {/* Category pills — only categories this org has types in */}
      <div className={styles.categories}>
        <button
          type="button"
          className={cls(
            styles.categoryPill,
            activeCategory === "all" && styles.categoryActive,
          )}
          aria-pressed={activeCategory === "all"}
          onClick={() => setActiveCategory("all")}
        >
          <Layers size={12} />
          All
        </button>
        {CATEGORY_ORDER.filter((key) => counts[key] > 0).map((key) => {
          const info = metadataCategoryInfo(key);
          const Icon = info.icon;
          return (
            <button
              key={key}
              type="button"
              className={cls(
                styles.categoryPill,
                activeCategory === key && styles.categoryActive,
              )}
              aria-pressed={activeCategory === key}
              title={info.description}
              onClick={() => setActiveCategory(key)}
            >
              <Icon size={12} />
              {info.label}
              <span className={styles.pillCount}>{counts[key]}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className={styles.list} role="listbox" aria-multiselectable="true">
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
              <button
                key={m.xmlName}
                type="button"
                role="option"
                aria-selected={isSelected}
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
                <span className={styles.itemInfo}>
                  <span className={styles.itemName}>{m.xmlName}</span>
                  <span className={styles.itemDir}>{m.directoryName}</span>
                </span>
                {m.suffix && (
                  <span className={styles.itemSuffix}>.{m.suffix}</span>
                )}
              </button>
            );
          })}
      </div>
    </div>
  );
}
