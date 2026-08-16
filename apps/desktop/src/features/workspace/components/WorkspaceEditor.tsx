import Editor from "@monaco-editor/react";
import { FileText } from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import { languageForPath } from "../lib/editorLanguage";
import { registerApexLanguage, defineForgeTheme } from "../lib/apexLanguage";
import type { Monaco } from "../lib/monaco";
import WorkspaceTabs from "./WorkspaceTabs";

import "./WorkspaceEditor.css";

function handleBeforeMount(monaco: Monaco) {
  registerApexLanguage(monaco);
  defineForgeTheme(monaco);
}

export default function WorkspaceEditor() {
  const file = useWorkspaceStore((state) => state.selectedFile);
  const content = useWorkspaceStore((state) =>
    file ? state.fileContents[file] ?? "" : "",
  );
  const loadingContent = useWorkspaceStore((state) =>
    file ? Boolean(state.loadingContent[file]) : false,
  );
  const updateFileContent = useWorkspaceStore((state) => state.updateFileContent);
  const setCursorPosition = useWorkspaceStore((state) => state.setCursorPosition);
  const openFolder = useWorkspaceStore((state) => state.openFolder);

  if (!file) {
    return (
      <div className="workspace-editor workspace-editor--empty">
        <WorkspaceTabs />
        <div className="workspace-editor__empty-body">
          <FileText size={40} className="workspace-editor__empty-icon" />
          <h3>Choose a file to start editing</h3>
          <p>
            Open a class, component, or metadata file from the explorer — or
            open a folder to get started.
          </p>
          <button
            type="button"
            className="fw-btn fw-btn--primary"
            onClick={() => void openFolder()}
          >
            Open Folder
          </button>
        </div>
      </div>
    );
  }

  if (loadingContent) {
    return (
      <div className="workspace-editor workspace-editor--loading">
        <WorkspaceTabs />
        <div className="workspace-editor__loading-body">
          <span className="forge-ws__boot-spinner" />
          <p>Loading {file.split("/").pop()}…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-editor">
      <WorkspaceTabs />
      <div className="workspace-editor__shell">
        <Editor
          height="100%"
          path={file}
          language={languageForPath(file)}
          theme="forge-dark"
          value={content}
          beforeMount={handleBeforeMount}
          onChange={(value) => updateFileContent(file, value ?? "")}
          onMount={(editor) => {
            editor.onDidChangeCursorPosition((event) => {
              setCursorPosition({
                line: event.position.lineNumber,
                column: event.position.column,
              });
            });
          }}
          options={{
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: "var(--fw-font-mono, 'JetBrains Mono', monospace)",
            fontLigatures: true,
            wordWrap: "off",
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            renderWhitespace: "selection",
            bracketPairColorization: { enabled: true },
            guides: { indentation: true, bracketPairs: true },
            roundedSelection: false,
            padding: { top: 8, bottom: 8 },
          }}
        />
      </div>
    </div>
  );
}