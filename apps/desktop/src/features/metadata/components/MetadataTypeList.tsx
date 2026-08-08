import "./MetadataTypeList.css";
import type { MetadataType } from "../types";

interface Props {
    metadata: MetadataType[];
    selectedType: string;
    metadataSearch: string;
    onSearchChange: (value: string) => void;
    onSelect: (xmlName: string) => void;
}

export default function MetadataTypeList({
    metadata,
    selectedType,
    metadataSearch,
    onSearchChange,
    onSelect,
}: Props) {

    const filtered = metadata.filter(item =>
        item.xmlName
            .toLowerCase()
            .includes(metadataSearch.toLowerCase())
    );

    return (
        <div className="metadata-left">

            <h2>Metadata Types</h2>

            <input
                className="metadata-search"
                placeholder="Search metadata..."
                value={metadataSearch}
                onChange={(e) =>
                    onSearchChange(e.target.value)
                }
            />

            <div className="metadata-types">

                {filtered.map(type => (

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

                ))}

            </div>

        </div>
    );
}