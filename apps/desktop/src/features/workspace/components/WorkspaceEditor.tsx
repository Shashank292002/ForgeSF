import { useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import Editor from "@monaco-editor/react";
import {
  AlertTriangle,
  FileText,
  FileWarning,
  Search,
  Sparkles,
} from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";
import {
  hasFormatter,
  languageForPath,
  languageLabel,
} from "../lib/editorLanguage";
import { registerApexLanguage, defineForgeTheme } from "../lib/apexLanguage";
// Side-effect import: points @monaco-editor/react at the bundled Monaco and
// its workers. The `import type` below is erased at compile time, so without
// this line the editor fell back to a CDN that the app's CSP blocks.
import "../lib/monaco";
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
    file ? (state.fileContents[file] ?? "") : "",
  );
  const loadingContent = useWorkspaceStore((state) =>
    file ? Boolean(state.loadingContent[file]) : false,
  );
  const loadError = useWorkspaceStore((state) =>
    file ? (state.loadErrors[file] ?? null) : null,
  );
  const diskConflict = useWorkspaceStore((state) =>
    file ? Boolean(state.diskConflicts[file]) : false,
  );
  const reloadFromDisk = useWorkspaceStore((state) => state.reloadFromDisk);
  const keepBufferOverDisk = useWorkspaceStore(
    (state) => state.keepBufferOverDisk,
  );
  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const updateFileContent = useWorkspaceStore(
    (state) => state.updateFileContent,
  );
  const setCursorPosition = useWorkspaceStore(
    (state) => state.setCursorPosition,
  );
  const openFolder = useWorkspaceStore((state) => state.openFolder);
  const openRetrieve = useWorkspaceStore((state) => state.openRetrieve);

  const reveal = useWorkspaceStore((state) => state.editorReveal);
  const openFiles = useWorkspaceStore((state) => state.openFiles);
  const setEditorInfo = useWorkspaceStore((state) => state.setEditorInfo);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  // Counts editor mounts: the editor unmounts while a file loads, and a
  // position waiting to be shown needs the new instance.
  const [mounts, setMounts] = useState(0);
  const revealedSeq = useRef(0);
  /** Files the editor has created a model for, so closed ones can be freed. */
  const modelPaths = useRef(new Set<string>());
  const [wrap, setWrap] = useState(false);
  const [minimap, setMinimap] = useState(false);

  const language = file ? languageForPath(file) : "plaintext";
  const canFormat = hasFormatter(language);

  const runAction = (id: string) => {
    void editorRef.current?.getAction(id)?.run();
  };

  const handleMount = (
    instance: editor.IStandaloneCodeEditor,
    monaco: Monaco,
  ) => {
    editorRef.current = instance;
    monacoRef.current = monaco;
    setMounts((count) => count + 1);
    instance.onDidChangeCursorPosition((event) => {
      setCursorPosition({
        line: event.position.lineNumber,
        column: event.position.column,
      });
    });

    // The status bar shows what the editor detected, not a fixed "Spaces: 4".
    const reportInfo = () => {
      const model = instance.getModel();
      if (!model) return;
      const options = model.getOptions();
      setEditorInfo({
        insertSpaces: options.insertSpaces,
        tabSize: options.tabSize,
        eol: model.getEOL() === "\r\n" ? "CRLF" : "LF",
      });
    };
    reportInfo();
    instance.onDidChangeModel(reportInfo);
    instance.onDidChangeModelOptions(reportInfo);
  };

  // Nothing to describe without an editor on screen.
  const showsEditor = Boolean(file) && !loadingContent && !loadError;
  useEffect(() => {
    if (!showsEditor) setEditorInfo(null);
  }, [showsEditor, setEditorInfo]);

  // Frees the model of each closed tab, and its undo history with it. They
  // used to stay in memory for the whole session — and since workspaces for
  // different orgs share paths, a file opened later at the same path in
  // another workspace inherited the old model's undo history.
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    if (file) modelPaths.current.add(file);
    const open = new Set(openFiles);
    for (const path of modelPaths.current) {
      if (open.has(path)) continue;
      monaco.editor.getModel(monaco.Uri.parse(path))?.dispose();
      modelPaths.current.delete(path);
    }
  }, [openFiles, file, mounts]);

  // Puts the cursor on a search match or a Quick Open line. The file may
  // still be loading when the request arrives, so this waits until the editor
  // holds that file, then acts once.
  useEffect(() => {
    const instance = editorRef.current;
    const monaco = monacoRef.current;
    if (!reveal || reveal.seq === revealedSeq.current) return;
    if (!instance || !monaco || !file || reveal.path !== file) return;
    if (loadingContent) return;
    const model = instance.getModel();
    if (!model || model.uri.toString() !== monaco.Uri.parse(file).toString()) {
      return;
    }
    revealedSeq.current = reveal.seq;

    if (reveal.line !== null) {
      // The file may have changed since it was searched.
      const line = Math.min(Math.max(reveal.line, 1), model.getLineCount());
      const lastColumn = model.getLineMaxColumn(line);
      const column = Math.min(Math.max(reveal.column, 1), lastColumn);
      const end = Math.min(column + reveal.length, lastColumn);
      const range = new monaco.Range(line, column, line, end);
      instance.setSelection(range);
      instance.revealRangeInCenterIfOutsideViewport(range);
    }
    if (reveal.focus) instance.focus();
  }, [reveal, file, loadingContent, mounts]);

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
            <button
              type="button"
              className="fw-btn"
              onClick={() => void openFolder()}
            >
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

  // An unreadable file gets a notice, never an editor: an empty buffer here
  // could be typed into and saved over the real (binary or missing) file.
  if (loadError) {
    return (
      <div className="workspace-editor workspace-editor--empty">
        <WorkspaceTabs />
        <div className="workspace-editor__empty-body" role="alert">
          <span className="workspace-editor__empty-mark">
            <FileWarning size={34} strokeWidth={1.5} />
          </span>
          <h3>{getBaseName(file)} can&rsquo;t be opened in the editor</h3>
          <p>{loadError}</p>
          <div className="workspace-editor__empty-actions">
            <button
              type="button"
              className="fw-btn"
              onClick={() => void selectFile(file)}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-editor">
      <WorkspaceTabs />

      <div className="workspace-editor__chrome">
        <div className="workspace-editor__breadcrumbs" title={file}>
          <span className="workspace-editor__lang">
            {language.toUpperCase()}
          </span>
          <span className="workspace-editor__sep">/</span>
          <span className="workspace-editor__file">{getBaseName(file)}</span>
        </div>

        <div className="workspace-editor__actions">
          <button
            type="button"
            className="workspace-editor__action"
            title={
              canFormat
                ? "Format Document (Shift+Alt+F)"
                : `There is no formatter for ${languageLabel(language)} files yet`
            }
            disabled={!canFormat}
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
            aria-pressed={wrap}
            onClick={() => setWrap((value) => !value)}
          >
            Wrap
          </button>
          <button
            type="button"
            className={`workspace-editor__action ${minimap ? "is-active" : ""}`}
            title="Toggle minimap"
            aria-pressed={minimap}
            onClick={() => setMinimap((value) => !value)}
          >
            Minimap
          </button>
        </div>
      </div>

      {/* The file changed on disk while it had unsaved edits here — a
          retrieve, git, another editor. Neither side is overwritten until
          the user picks one. */}
      {diskConflict && (
        <div className="workspace-editor__conflict" role="alert">
          <AlertTriangle
            size={15}
            className="workspace-editor__conflict-icon"
          />
          <span className="workspace-editor__conflict-text">
            <strong>{getBaseName(file)} changed on disk</strong> after you
            started editing it. Your unsaved changes are still here.
          </span>
          <div className="workspace-editor__conflict-actions">
            <button
              type="button"
              className="workspace-editor__action"
              title="Discard your unsaved changes and show the file as it is on disk"
              onClick={() => void reloadFromDisk(file)}
            >
              Reload from disk
            </button>
            <button
              type="button"
              className="workspace-editor__action is-active"
              title="Keep editing; saving replaces the version on disk"
              onClick={() => void keepBufferOverDisk(file)}
            >
              Keep my changes
            </button>
          </div>
        </div>
      )}

      <div className="workspace-editor__shell">
        <Editor
          height="100%"
          path={file}
          language={language}
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
            // Where no formatter exists these did nothing, silently.
            formatOnPaste: canFormat,
            formatOnType: canFormat,
          }}
        />
      </div>
    </div>
  );
}
