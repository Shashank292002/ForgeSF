import "./MetadataToolbar.css";

interface Props {
    selectedCount: number;
    loading: boolean;
    onRetrieve: () => void;
    onRefresh?: () => void;
    onClear?: () => void;
    onOpen?: () => void;
}

export default function MetadataToolbar({
    selectedCount,
    loading,
    onRetrieve,
    onRefresh,
    onClear,
    onOpen,
}: Props) {

    return (

        <div className="metadata-toolbar">

            <div className="toolbar-left">

                <button
                    className={loading ? "primary-btn is-loading" : "primary-btn"}
                    disabled={
                        selectedCount === 0 || loading
                    }
                    onClick={onRetrieve}
                >
                    <span className="primary-btn-prompt">
                        {loading ? "&gt;" : "\u25B8"}
                    </span>
                    <span>
                        {loading
                            ? "retrieving"
                            : `retrieve --count=${selectedCount}`}
                    </span>
                </button>

            </div>

            <div className="toolbar-right">

                <button onClick={onOpen} title="Open in Workspace">
                    <span className="toolbar-icon">&#8862;</span> Open
                </button>

                <button
                    onClick={onRefresh}
                    disabled={loading}
                    title="Refresh components"
                >
                    <span className="toolbar-icon">&#8635;</span> Refresh
                </button>

                <button
                    onClick={onClear}
                    disabled={selectedCount === 0}
                    title="Clear selection"
                >
                    <span className="toolbar-icon">&#215;</span> Clear
                </button>

            </div>

        </div>

    );

}