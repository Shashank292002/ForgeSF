import { useWorkspaceStore } from "../store/workspaceStore";

export default function WorkspaceTabs() {
    const openFiles = useWorkspaceStore((state) => state.openFiles);
    const selectedFile = useWorkspaceStore((state) => state.selectedFile);
    const selectFile = useWorkspaceStore((state) => state.selectFile);
    const closeFile = useWorkspaceStore((state) => state.closeFile);

    return (
        <div className="editor-tabs">
            {openFiles.map((file) => (
                <button
                    key={file}
                    type="button"
                    className={`editor-tab ${selectedFile === file ? "active" : ""}`}
                    onClick={() => selectFile(file)}
                >
                    <span>{file.split("/").pop()}</span>
                    <span className="tab-close" onClick={(event) => {
                        event.stopPropagation();
                        closeFile(file);
                    }}>
                        ×
                    </span>
                </button>
            ))}
        </div>
    );
}
