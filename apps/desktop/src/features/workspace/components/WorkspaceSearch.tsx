import { createElement, useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import type { WorkspaceFile } from "../types";
import { collectFiles } from "../lib/workspaceUtils";
import { iconForFile } from "../lib/fileIcons";

import "./WorkspaceSearch.css";

export default function WorkspaceSearch() {
  const [query, setQuery] = useState("");
  const files = useWorkspaceStore((state) => state.files);
  const selectFile = useWorkspaceStore((state) => state.selectFile);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return collectFiles(files).filter(
      (item) =>
        item.type === "file" &&
        (item.name.toLowerCase().includes(normalized) ||
          item.path.toLowerCase().includes(normalized)),
    );
  }, [files, query]);

  return (
    <section className="workspace-search">
      <div className="workspace-search__input-wrap">
        <Search size={13} className="workspace-search__icon" />
        <input
          type="text"
          className="workspace-search__input"
          placeholder="Search files…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button
            type="button"
            className="workspace-search__clear"
            onClick={() => setQuery("")}
            title="Clear"
          >
            <X size={13} />
          </button>
        )}
      </div>

      <div className="workspace-search__meta">
        {results.length} result{results.length === 1 ? "" : "s"}
      </div>

      <div className="workspace-search__results">
        {query.trim() ? (
          results.length > 0 ? (
            results.map((file) => (
              <SearchResult key={file.path} file={file} onSelect={selectFile} />
            ))
          ) : (
            <div className="workspace-search__empty">No matches</div>
          )
        ) : (
          <div className="workspace-search__empty">
            Type to search files in the workspace.
          </div>
        )}
      </div>
    </section>
  );
}

function SearchResult({
  file,
  onSelect,
}: {
  file: WorkspaceFile;
  onSelect: (path: string) => void;
}) {
  const icon = iconForFile(file.name, "file");
  return (
    <button
      type="button"
      className="workspace-search__result"
      onClick={() => void onSelect(file.path)}
      title={file.path}
    >
      {createElement(icon, { size: 13 })}
      <span className="workspace-search__result-name">{file.name}</span>
      <span className="workspace-search__result-path">{file.path}</span>
    </button>
  );
}
