import { useRef, useState } from "react";
import type { editor } from "monaco-editor";
import Editor from "@monaco-editor/react";
import { FileText, Search, Sparkles } from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import { languageForPath } from "../lib/editorLanguage";
import { registerApexLanguage, defineForgeTheme } from "../lib/apexLanguage";
import type { Monaco } from "../lib/monaco";
import { getBaseName } from "../lib/workspaceUtils";
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
  const openRetrieve = useWorkspaceStore((state) => state.openRetrieve);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [wrap, setWrap] = useState(false);
  const [minimap, setMinimap] = useState(false);

  const runAction = (id: string) => {
    void editorRef.current?.getAction(id)?.run();
  };

  const handleMount = (instance: editor.IStandaloneCodeEditor) => {
    editorRef.current = instance;
    instance.onDidChangeCursorPosition((event) => {
      setCursorPosition({
        line: event.position.lineNumber,
        column: event.position.column,
      });
    });
  };

  if (!file) {
    return (
      <div className="workspace-editor workspace-editor--empty">
        <WorkspaceTabs />
        <div className="workspace-editor__empty-body">
          <span className="workspace-editor__empty-mark">
            <FileText size={34} strokeWidth={1.5} />
          </span>
          <h3>Edit Salesforce source</h3>
          <p>
            Open a file from the explorer, or retrieve metadata from your org to
            bring classes, triggers, LWC, objects and more into the workspace.
          </p>
          <div className="workspace-editor__empty-actions">
            <button
              type="button"
              className="fw-btn fw-btn--primary"
              onClick={openRetrieve}
            >
              Retrieve Metadata
            </button>
            <button type="button" className="fw-btn" onClick={() => void openFolder()}>
              Open Folder
            </button>
          </div>
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
          <p>Loading {getBaseName(file)}…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-editor">
      <WorkspaceTabs />

      <div className="workspace-editor__chrome">
        <div className="workspace-editor__breadcrumbs" title={file}>
          <span className="workspace-editor__lang">{languageForPath(file).toUpperCase()}</span>
          <span className="workspace-editor__sep">/</span>
          <span className="workspace-editor__file">{getBaseName(file)}</span>
        </div>

        <div className="workspace-editor__actions">
          <button
            type="button"
            className="workspace-editor__action"
            title="Format Document (Shift+Alt+F)"
            onClick={() => runAction("editor.action.formatDocument")}
          >
            <Sparkles size={13} /> Format
          </button>
          <button
            type="button"
            className="workspace-editor__action"
            title="Find / Replace (Ctrl+F)"
            onClick={() => runAction("actions.find")}
          >
            <Search size={13} /> Find
          </button>
          <button
            type="button"
            className={`workspace-editor__action ${wrap ? "is-active" : ""}`}
            title="Toggle word wrap"
            onClick={() => setWrap((value) => !value)}
          >
            Wrap
          </button>
          <button
            type="button"
            className={`workspace-editor__action ${minimap ? "is-active" : ""}`}
            title="Toggle minimap"
            onClick={() => setMinimap((value) => !value)}
          >
            Minimap
          </button>
        </div>
      </div>

      <div className="workspace-editor__shell">
        <Editor
          height="100%"
          path={file}
          language={languageForPath(file)}
          theme="forge-dark"
          value={content}
          beforeMount={handleBeforeMount}
          onChange={(value) => updateFileContent(file, value ?? "")}
          onMount={handleMount}
          options={{
            minimap: { enabled: minimap },
            scrollBeyondLastLine: false,
            fontSize: 13,
            fontFamily: "var(--fw-font-mono, 'JetBrains Mono', monospace)",
            fontLigatures: true,
            wordWrap: wrap ? "on" : "off",
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            renderWhitespace: "selection",
            bracketPairColorization: { enabled: true },
            guides: { indentation: true, bracketPairs: true },
            roundedSelection: false,
            padding: { top: 8, bottom: 8 },
            formatOnPaste: true,
            formatOnType: true,
          }}
        />
      </div>
    </div>
  );
}