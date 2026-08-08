import Editor from "@monaco-editor/react";
import "./WorkspaceEditor.css";
import WorkspaceTabs from "./WorkspaceTabs";
import { useWorkspaceStore } from "../store/workspaceStore";

function getLanguage(fileName: string | null) {
    if (!fileName) {
        return "plaintext";
    }

    const ext = fileName.split(".").pop()?.toLowerCase();

    switch (ext) {
        case "js":
            return "javascript";
        case "ts":
            return "typescript";
        case "json":
            return "json";
        case "html":
            return "html";
        case "css":
            return "css";
        case "xml":
            return "xml";
        case "md":
            return "markdown";
        default:
            return "plaintext";
    }
}

export default function WorkspaceEditor() {
    const file = useWorkspaceStore((state) => state.selectedFile);
    const updateFileContent = useWorkspaceStore((state) => state.updateFileContent);
    const content = useWorkspaceStore((state) => (file ? state.fileContents[file] ?? "" : ""));

    return (
        <div className="workspace-editor">
            <div className="editor-topbar">
                <div>
                    <p className="editor-label">Editor</p>
                    <h3>{file ?? "Select a file"}</h3>
                </div>
                <div className="editor-pill">Auto-save ready</div>
            </div>

            <WorkspaceTabs />

            {file ? (
                <div className="editor-shell">
                    <Editor
                        height="100%"
                        language={getLanguage(file)}
                        theme="vs-dark"
                        value={content}
                        onChange={(value) => updateFileContent(file, value ?? "")}
                        options={{
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            wordWrap: "on",
                            automaticLayout: true,
                            fontSize: 13,
                        }}
                    />
                </div>
            ) : (
                <div className="empty-editor">
                    <div>
                        <h4>Choose a file to start editing</h4>
                        <p>Open a class, component, or metadata file from the explorer to continue.</p>
                    </div>
                </div>
            )}
        </div>
    );
}
