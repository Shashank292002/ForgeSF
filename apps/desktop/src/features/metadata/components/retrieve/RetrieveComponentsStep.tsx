import { createElement, useEffect, useMemo, useState } from "react";
import {
  CheckCheck,
  ChevronLeft,
  Layers,
  Loader2,
  Search,
  X,
} from "lucide-react";

import type { MetadataType } from "../../types";
import { categoryForType } from "../../lib/categories";
import { memberSummary } from "../../lib/retrieveSpecs";
import MemberList from "./MemberList";

interface Props {
  metadata: MetadataType[];
  types: string[];
  activeType: string | null;
  componentsCache: Record<string, string[]>;
  loadingType: string | null;
  error: string | null;
  selectedMembers: Record<string, string[]>;
  onActiveType: (kind: string) => void;
  onToggleMember: (kind: string, member: string) => void;
  onSelectAll: (kind: string) => void;
  onClear: (kind: string) => void;
  onEnsureComponents: (kind: string) => void;
  onBack: () => void;
}

/**
 * Second step of the retrieval flow — pick the exact components to pull for
 * each selected metadata type. Leaving a type untouched retrieves every
 * component of that type; narrowing it retrieves only the chosen members.
 */
export default function RetrieveComponentsStep({
  metadata,
  types,
  activeType,
  componentsCache,
  loadingType,
  error,
  selectedMembers,
  onActiveType,
  onToggleMember,
  onSelectAll,
  onClear,
  onEnsureComponents,
  onBack,
}: Props) {
  const [search, setSearch] = useState("");

  // Make sure a component list exists for the active type.
  useEffect(() => {
    if (activeType) onEnsureComponents(activeType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType]);

  const members = useMemo(
    () => (activeType ? (componentsCache[activeType] ?? []) : []),
    [activeType, componentsCache],
  );
  const picked = activeType ? (selectedMembers[activeType] ?? []) : [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((member) => member.toLowerCase().includes(q));
  }, [members, search]);

  const activeInfo = activeType ? categoryForType(activeType) : null;
  const ActiveIcon = activeInfo?.icon;

  const typeLabel = (kind: string) =>
    metadata.find((t) => t.xmlName === kind)?.xmlName ?? kind;

  return (
    <div className="mr-comps">
      {/* ── Left: selected types ─────────────────────────────── */}
      <div className="mr-comps__types">
        <div className="mr-comps__pane-head">
          <span>Selected types</span>
          <button
            type="button"
            className="mr-comps__back"
            onClick={onBack}
            title="Back to type selection"
          >
            <ChevronLeft size={13} /> Types
          </button>
        </div>
        <div className="mr-comps__type-list">
          {types.map((kind) => {
            const info = categoryForType(kind);
            const Icon = info.icon;
            const summary = memberSummary(
              kind,
              selectedMembers,
              componentsCache,
            );
            const isActive = kind === activeType;
            return (
              <button
                key={kind}
                type="button"
                className={`mr-comps__type ${isActive ? "is-active" : ""}`}
                onClick={() => onActiveType(kind)}
              >
                <span
                  className="mr-comps__type-icon"
                  style={{ color: info.color }}
                >
                  {createElement(Icon, { size: 15 })}
                </span>
                <span className="mr-comps__type-name">{typeLabel(kind)}</span>
                <span
                  className={`mr-comps__type-badge ${summary.narrowed ? "is-narrow" : ""}`}
                >
                  {summary.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Right: component picker ──────────────────────────── */}
      <div className="mr-comps__picker">
        <div className="mr-comps__pane-head">
          <span className="mr-comps__picker-title">
            {ActiveIcon && createElement(ActiveIcon, { size: 14 })}
            {activeType ? typeLabel(activeType) : "Components"}
          </span>
          <div className="mr-comps__picker-tools">
            <button
              type="button"
              className="mr-btn mr-btn--ghost"
              disabled={!activeType || members.length === 0}
              onClick={() => activeType && onSelectAll(activeType)}
              title="Select every listed component"
            >
              <CheckCheck size={13} /> All
            </button>
            <button
              type="button"
              className="mr-btn mr-btn--ghost"
              disabled={!activeType || picked.length === 0}
              onClick={() => activeType && onClear(activeType)}
              title="Clear — retrieve every component of this type"
            >
              <X size={13} /> Clear
            </button>
          </div>
        </div>

        <div className="mr-search">
          <Search size={15} className="mr-search__icon" />
          <input
            type="text"
            placeholder={`Filter components${activeType ? ` of ${typeLabel(activeType)}` : ""}…`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            disabled={!activeType}
          />
          {search && (
            <button
              type="button"
              className="mr-search__clear"
              onClick={() => setSearch("")}
              title="Clear filter"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="mr-comps__hint">
          {picked.length > 0
            ? `${picked.length} component${picked.length === 1 ? "" : "s"} selected — only these will be retrieved.`
            : "No components picked — every component of this type will be retrieved."}
        </div>

        <div className="mr-comps__list">
          {loadingType === activeType && (
            <div className="mr-comps__state">
              <Loader2 size={16} className="mr-spin" /> Loading components…
            </div>
          )}
          {loadingType !== activeType && error && (
            <div className="mr-comps__state is-error">{error}</div>
          )}
          {loadingType !== activeType &&
            !error &&
            activeType &&
            filtered.length === 0 && (
              <div className="mr-comps__state">
                {members.length === 0
                  ? "No components found for this type in the org."
                  : "No components match your filter."}
              </div>
            )}
          {!activeType && (
            <div className="mr-comps__state">
              <Layers size={18} /> Select a metadata type to choose its
              components.
            </div>
          )}
          {filtered.length > 0 && activeType && (
            <MemberList
              members={filtered}
              picked={picked}
              onToggle={(member) => onToggleMember(activeType, member)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
