import "./MetadataTypeList.css";
import type { MetadataType } from "../types";

interface Props {
    metadata: MetadataType[];
    selectedType: string;
    metadataSearch: string;
    loading?: boolean;
    error?: string | null;
    total?: number;
    onSearchChange: (value: string) => void;
    onSelect: (xmlName: string) => void;
    onRefresh?: () => void;
}

export default function MetadataTypeList({
    metadata,
    selectedType,
    metadataSearch,
    loading,
    error,
    total,
    onSearchChange,
    onSelect,
    onRefresh,
}: Props) {

    const filtered = metadata.filter(item =>
        item.xmlName
            .toLowerCase()
            .includes(metadataSearch.toLowerCase())
    );

    return (
        <div className="metadata-left">

            <div className="metadata-left-head">
                <h2>Metadata Types</h2>

                <span className="metadata-count">{total ?? metadata.length}</span>
            </div>

            <div className="metadata-search-row">
                <input
                    className="metadata-search"
                    placeholder="Search metadata..."
                    value={metadataSearch}
                    onChange={(e) =>
                        onSearchChange(e.target.value)
                    }
                />

                <button
                    className="metadata-refresh"
                    onClick={onRefresh}
                    disabled={loading}
                    title="Refresh metadata types"
                    aria-label="Refresh metadata types"
                >
                    &#8635;
                </button>
            </div>

            <div className="metadata-types">

                {error ? (
                    <p className="metadata-empty metadata-error">{error}</p>
                ) : loading ? (
                    <p className="metadata-empty">Loading metadata types…</p>
                ) : filtered.length === 0 ? (
                    <p className="metadata-empty">
                        {metadataSearch
                            ? `No types match "${metadataSearch}".`
                            : "No metadata types found."}
                    </p>
                ) : (
                    filtered.map(type => (

                        <button
                            key={type.xmlName}
                            className={
                                selectedType === type.xmlName
                                    ? "metadata-type active"
                                    : "metadata-type"
                            }
                            onClick={() =>
                                onSelect(type.xmlName)
                            }
                        >

                            {type.xmlName}

                        </button>

                    ))
                )}

            </div>

        </div>
    );
}