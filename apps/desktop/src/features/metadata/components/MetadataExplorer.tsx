import "./MetadataExplorer.css";

interface Props {
  components: string[];
  componentSearch: string;
  selected: string[];
  onSearchChange: (value: string) => void;
  onToggle: (name: string) => void;
}

export default function MetadataExplorer({
  components,
  componentSearch,
  selected,
  onSearchChange,
  onToggle,
}: Props) {
  const filtered = components.filter((component) =>
    component.toLowerCase().includes(componentSearch.toLowerCase())
  );

  return (
    <>
      <div className="explorer-search-row">
        <input
          className="metadata-search"
          placeholder="Search components..."
          value={componentSearch}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>

      <div className="component-list">
        {filtered.length === 0 ? (
          <p className="component-empty">
            {componentSearch
              ? `No components match "${componentSearch}".`
              : "No components found."}
          </p>
        ) : (
          filtered.map((component) => {
            const isSelected = selected.includes(component);

            return (
              <label
                key={component}
                className={
                  isSelected ? "component-item is-selected" : "component-item"
                }
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggle(component)}
                />

                <span className="component-checkbox" aria-hidden="true" />

                <span className="component-icon">&lt;/&gt;</span>

                <span className="component-name">{component}</span>
              </label>
            );
          })
        )}
      </div>
    </>
  );
}