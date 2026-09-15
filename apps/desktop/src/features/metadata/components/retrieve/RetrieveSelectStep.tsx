import { createElement, useMemo } from "react";
import { Check, Search, X } from "lucide-react";

import type { CatalogType } from "../../lib/typeCatalog";
import type { MetadataCategoryKey } from "../../lib/categories";
import {
  categoryForType,
  categoriesForTypes,
  metadataCategoryInfo,
  CATEGORY_ORDER,
} from "../../lib/categories";

interface Props {
  metadata: CatalogType[];
  selectedTypes: string[];
  loading: boolean;
  error: string | null;
  category: MetadataCategoryKey | "all";
  search: string;
  onSearch: (value: string) => void;
  onCategory: (value: MetadataCategoryKey | "all") => void;
  onToggle: (xmlName: string) => void;
  onSelectAll: (visible: string[]) => void;
  onClear: () => void;
}

export default function RetrieveSelectStep({
  metadata,
  selectedTypes,
  loading,
  error,
  category,
  search,
  onSearch,
  onCategory,
  onToggle,
  onSelectAll,
  onClear,
}: Props) {
  const categoryCounts = useMemo(
    () => categoriesForTypes(metadata),
    [metadata],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return metadata.filter((type) => {
      if (
        category !== "all" &&
        categoryForType(type.xmlName).key !== category
      ) {
        return false;
      }
      return q ? type.xmlName.toLowerCase().includes(q) : true;
    });
  }, [metadata, category, search]);

  const allSelected =
    filtered.length > 0 &&
    filtered.every((t) => selectedTypes.includes(t.xmlName));

  if (loading) {
    return (
      <div className="mr-loading">
        <span className="mr-spinner" />
        <div>Discovering metadata types…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mr-empty">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="mr-select">
      <div className="mr-select__toolbar">
        <div className="mr-search">
          <Search size={15} className="mr-search__icon" />
          <input
            type="text"
            placeholder="Search metadata types…"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="mr-search__clear"
              onClick={() => onSearch("")}
              title="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div
          className="mr-footer__actions"
          style={{ padding: 0, border: 0, background: "transparent" }}
        >
          <button
            type="button"
            className="mr-btn mr-btn--ghost"
            onClick={onClear}
            disabled={selectedTypes.length === 0}
          >
            Clear
          </button>
          <button
            type="button"
            className="mr-btn mr-btn--ghost"
            onClick={() => onSelectAll(filtered.map((type) => type.xmlName))}
            disabled={filtered.length === 0}
          >
            {allSelected ? "Deselect all" : `Select all (${filtered.length})`}
          </button>
        </div>
      </div>

      <div className="mr-select-cats">
        <button
          type="button"
          className={`mr-cat ${category === "all" ? "is-active" : ""}`}
          onClick={() => onCategory("all")}
        >
          <span
            className="mr-cat__dot"
            style={{ background: "var(--mr-text-2)" }}
          />
          All
          <span className="mr-cat__count">{metadata.length}</span>
        </button>
        {CATEGORY_ORDER.filter((key) => categoryCounts[key] > 0).map((key) => {
          const info = metadataCategoryInfo(key);
          return (
            <button
              type="button"
              key={key}
              className={`mr-cat ${category === key ? "is-active" : ""}`}
              onClick={() => onCategory(category === key ? "all" : key)}
            >
              <span
                className="mr-cat__dot"
                style={{ background: info.color }}
              />
              {info.label}
              <span className="mr-cat__count">{categoryCounts[key]}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="mr-empty">
          <p>No metadata types match your search.</p>
        </div>
      ) : (
        <div className="mr-types">
          {filtered.map((type) => {
            const info = categoryForType(type.xmlName);
            const Icon = info.icon;
            const selected = selectedTypes.includes(type.xmlName);
            return (
              <button
                key={type.xmlName}
                type="button"
                className={`mr-type ${selected ? "is-selected" : ""}`}
                onClick={() => onToggle(type.xmlName)}
              >
                <span className="mr-type__check">
                  {selected && <Check size={12} strokeWidth={3} />}
                </span>
                <span className="mr-type__icon" style={{ color: info.color }}>
                  {createElement(Icon, { size: 16 })}
                </span>
                <span className="mr-type__main">
                  <span className="mr-type__name">{type.xmlName}</span>
                  <span className="mr-type__meta">
                    {type.parent
                      ? `part of ${type.parent}`
                      : type.suffix
                        ? `.${type.suffix}`
                        : "metadata"}
                    {type.inFolder ? " · in folders" : ""}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
