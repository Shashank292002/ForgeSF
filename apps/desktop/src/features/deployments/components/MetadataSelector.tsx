import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Database,
  Layers,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

import {
  CATEGORY_ORDER,
  categoriesForTypes,
  categoryForType,
  metadataCategoryInfo,
  type MetadataCategoryKey,
} from "../../metadata/lib/categories";
import {
  needsExplicitMembers,
  wildcardCaveat,
  type CatalogType,
} from "../../metadata/lib/typeCatalog";
import {
  memberSummary,
  selectionCount,
} from "../../metadata/lib/metadataSpecs";
import MemberList, {
  type MemberListClasses,
} from "../../metadata/components/MemberList";
import { cls } from "../../../lib/cls";
import styles from "./MetadataSelector.module.css";

const MEMBER_CLASSES: MemberListClasses = {
  scroll: styles.memberScroll,
  viewport: styles.memberViewport,
  row: styles.member,
  selected: styles.memberSelected,
  check: styles.memberCheck,
  name: styles.memberName,
};

interface MetadataSelectorProps {
  metadataTypes: CatalogType[];
  selected: string[];
  /** Components picked per type. A type with none sends all of them. */
  selectedMembers: Record<string, string[]>;
  /** Component lists already fetched, by type. */
  components: Record<string, string[]>;
  /** The expanded type, whose components are being listed. */
  expanded: string | null;
  search: string;
  loading: boolean;
  /** Whether the expanded type's components are still being listed. */
  componentsLoading: boolean;
  componentsError: string | null;
  /** True while a deploy is starting: the selection must not move under it. */
  disabled?: boolean;
  /**
   * Rendered inside the deploy form rather than as a card of its own, so it
   * drops the border and background that would read as a card in a card.
   */
  embedded?: boolean;
  onSearchChange: (search: string) => void;
  onToggle: (xmlName: string) => void;
  onExpand: (xmlName: string | null) => void;
  onToggleMember: (xmlName: string, member: string) => void;
  onSelectAllMembers: (xmlName: string) => void;
  onClearMembers: (xmlName: string) => void;
  onRetryComponents: () => void;
  onClear: () => void;
}

/**
 * Picks metadata to deploy — whole types, or named components within them.
 *
 * A type on its own deploys everything of that type, which is almost never
 * what a release is: expanding one lists its components so only the wanted
 * ones go out. Categories come from the same rules as the retrieve wizard.
 */
export default function MetadataSelector({
  metadataTypes,
  selected,
  selectedMembers,
  components,
  expanded,
  search,
  loading,
  componentsLoading,
  componentsError,
  disabled = false,
  embedded = false,
  onSearchChange,
  onToggle,
  onExpand,
  onToggleMember,
  onSelectAllMembers,
  onClearMembers,
  onRetryComponents,
  onClear,
}: MetadataSelectorProps) {
  const [activeCategory, setActiveCategory] = useState<
    MetadataCategoryKey | "all"
  >("all");
  const [memberSearch, setMemberSearch] = useState("");

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

  const total = useMemo(
    () => selectionCount(selected, selectedMembers, components),
    [selected, selectedMembers, components],
  );

  const expandedMembers = useMemo(
    () => (expanded ? (components[expanded] ?? []) : []),
    [expanded, components],
  );
  const visibleMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return expandedMembers;
    return expandedMembers.filter((member) => member.toLowerCase().includes(q));
  }, [expandedMembers, memberSearch]);

  /** Expanding a different type starts its search fresh. */
  const handleExpand = (xmlName: string) => {
    setMemberSearch("");
    onExpand(expanded === xmlName ? null : xmlName);
  };

  const headerCount = () => {
    const types = `${selected.length} type${selected.length === 1 ? "" : "s"}`;
    if (total.components === 0 && !total.known) return types;
    const suffix = total.known ? "" : "+";
    return `${types} · ${total.components}${suffix} component${
      total.components === 1 && total.known ? "" : "s"
    }`;
  };

  return (
    <div className={cls(styles.wrapper, embedded && styles.embedded)}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Database size={18} />
          <h3>Metadata</h3>
          {selected.length > 0 && (
            <span className={styles.count}>{headerCount()}</span>
          )}
        </div>
        {selected.length > 0 && (
          <button
            type="button"
            className={styles.clearBtn}
            onClick={onClear}
            disabled={disabled}
            aria-label="Clear the whole metadata selection"
          >
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

      {/* List. A plain list, not a listbox: each row holds two controls, and
          an option cannot contain interactive content. */}
      <ul className={styles.list}>
        {loading && (
          <li className={styles.loading}>
            <div className={styles.spinner} />
            <span>Loading metadata types...</span>
          </li>
        )}
        {!loading && filtered.length === 0 && (
          <li className={styles.empty}>
            <Layers size={24} />
            <p>
              {metadataTypes.length === 0
                ? "No metadata types in this org"
                : "No metadata types match your search"}
            </p>
          </li>
        )}
        {!loading &&
          filtered.map((m) => {
            const isSelected = selected.includes(m.xmlName);
            const isExpanded = expanded === m.xmlName;
            const picked = selectedMembers[m.xmlName] ?? [];
            const summary = memberSummary(
              m.xmlName,
              selectedMembers,
              components,
            );
            const caveat = wildcardCaveat(m.xmlName);
            const mustName = needsExplicitMembers(m);

            return (
              <li key={m.xmlName} className={styles.row}>
                <div
                  className={cls(
                    styles.item,
                    isSelected && styles.itemSelected,
                    isExpanded && styles.itemExpanded,
                  )}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    className={styles.itemMain}
                    disabled={disabled}
                    onClick={() => onToggle(m.xmlName)}
                  >
                    <span
                      className={cls(
                        styles.checkbox,
                        isSelected && styles.checkboxChecked,
                      )}
                      aria-hidden="true"
                    >
                      {isSelected && <Check size={12} />}
                    </span>
                    <span className={styles.itemInfo}>
                      <span className={styles.itemName}>{m.xmlName}</span>
                      <span className={styles.itemDir}>
                        {m.parent ? `child of ${m.parent}` : m.directoryName}
                      </span>
                    </span>
                  </button>

                  {isSelected && (
                    <span
                      className={cls(
                        styles.summary,
                        summary.narrowed && styles.summaryNarrowed,
                      )}
                    >
                      {summary.label}
                    </span>
                  )}

                  <button
                    type="button"
                    className={styles.expandBtn}
                    aria-expanded={isExpanded}
                    aria-label={
                      isExpanded
                        ? `Hide ${m.xmlName} components`
                        : `Choose individual ${m.xmlName} components`
                    }
                    title={isExpanded ? "Hide components" : "Choose components"}
                    disabled={disabled}
                    onClick={() => handleExpand(m.xmlName)}
                  >
                    {isExpanded ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                </div>

                {isExpanded && (
                  <div className={styles.panel}>
                    {!isSelected && (
                      <p className={styles.panelHint}>
                        Picking a component selects {m.xmlName} too.
                      </p>
                    )}
                    {caveat && isSelected && picked.length === 0 && (
                      <p className={styles.panelHint}>
                        <AlertTriangle size={12} /> {caveat}
                      </p>
                    )}
                    {mustName && (
                      <p className={styles.panelHint}>
                        This type has no wildcard — every component is named
                        individually.
                      </p>
                    )}

                    <div className={styles.panelBar}>
                      <div className={styles.memberSearchWrap}>
                        <Search size={13} className={styles.searchIcon} />
                        <input
                          className={styles.memberSearchInput}
                          placeholder={`Search ${m.xmlName} components...`}
                          aria-label={`Search ${m.xmlName} components`}
                          value={memberSearch}
                          onChange={(e) => setMemberSearch(e.target.value)}
                        />
                      </div>
                      <button
                        type="button"
                        className={styles.panelBtn}
                        disabled={disabled || visibleMembers.length === 0}
                        onClick={() => onSelectAllMembers(m.xmlName)}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className={styles.panelBtn}
                        disabled={disabled || picked.length === 0}
                        onClick={() => onClearMembers(m.xmlName)}
                      >
                        Clear
                      </button>
                    </div>

                    {componentsLoading && (
                      <div className={styles.panelState}>
                        <div className={styles.spinner} />
                        <span>Listing components…</span>
                      </div>
                    )}

                    {!componentsLoading && componentsError && (
                      <div className={styles.panelError} role="alert">
                        <AlertTriangle size={14} />
                        <span>{componentsError}</span>
                        <button
                          type="button"
                          className={styles.panelBtn}
                          onClick={onRetryComponents}
                        >
                          <RefreshCw size={12} /> Retry
                        </button>
                      </div>
                    )}

                    {!componentsLoading &&
                      !componentsError &&
                      expandedMembers.length === 0 && (
                        <div className={styles.panelState}>
                          <span>This org has no {m.xmlName} components.</span>
                        </div>
                      )}

                    {!componentsLoading &&
                      !componentsError &&
                      expandedMembers.length > 0 &&
                      visibleMembers.length === 0 && (
                        <div className={styles.panelState}>
                          <span>No components match your search.</span>
                        </div>
                      )}

                    {!componentsLoading &&
                      !componentsError &&
                      visibleMembers.length > 0 && (
                        <MemberList
                          members={visibleMembers}
                          picked={picked}
                          classes={MEMBER_CLASSES}
                          label={`${m.xmlName} components`}
                          onToggle={(member) =>
                            onToggleMember(m.xmlName, member)
                          }
                        />
                      )}
                  </div>
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
}
