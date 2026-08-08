import "./MetadataToolbar.css";

interface Props {
    selectedCount: number;
    loading: boolean;
    onRetrieve: () => void;
}

export default function MetadataToolbar({
    selectedCount,
    loading,
    onRetrieve,
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

                <button disabled title="Open">
                    <span className="toolbar-icon">&#8862;</span> Open
                </button>

                <button disabled title="Refresh">
                    <span className="toolbar-icon">&#8635;</span> Refresh
                </button>

                <button disabled title="Deploy">
                    <span className="toolbar-icon">&#8593;</span> Deploy
                </button>

                <button disabled title="Compare">
                    <span className="toolbar-icon">&#8646;</span> Compare
                </button>

                <button disabled title="Delete" className="toolbar-danger">
                    <span className="toolbar-icon">&#215;</span> Delete
                </button>

            </div>

        </div>

    );

}