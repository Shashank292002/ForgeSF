import type { NavigateFunction } from "react-router-dom";

import { useOrganizationStore } from "../../../store/orgStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import { copyText } from "./clipboard";
import { focusPart } from "./focusParts";
import { absolutePath, isDeployablePath } from "./workspaceUtils";

/**
 * Everything the command palette offers, and the workspace's keyboard
 * shortcuts: one list, so a shortcut shown in the palette is the one that
 * works, and a shortcut always does what its command does.
 */
export interface WorkspaceCommand {
  id: string;
  /** Shown before the title: "File: Save". */
  category: string;
  title: string;
  /**
   * e.g. "Ctrl+Shift+P"; Ctrl is also Cmd on macOS. Several bind
   * alternatives, the first shown in the palette.
   */
  keys?: string | string[];
  /**
   * Whether the command applies right now. One that doesn't is left out of
   * the palette, and its shortcut does nothing.
   */
  when?: () => boolean;
  run: () => unknown;
}

export const commandLabel = (command: WorkspaceCommand) =>
  `${command.category}: ${command.title}`;

/** Every shortcut bound to a command. */
export const commandKeys = (command: WorkspaceCommand): string[] =>
  command.keys === undefined
    ? []
    : Array.isArray(command.keys)
      ? command.keys
      : [command.keys];

export function workspaceCommands(
  navigate: NavigateFunction,
): WorkspaceCommand[] {
  const store = () => useWorkspaceStore.getState();
  const org = () => useOrganizationStore.getState().selectedOrganization;
  const activeFile = () => store().selectedFile;
  const hasActiveFile = () => activeFile() !== null;
  // Deploy, retrieve and diff only mean something for metadata.
  const metadataFile = () => {
    const file = activeFile();
    return (
      file !== null &&
      org() !== null &&
      isDeployablePath(file, store().packageDirectories)
    );
  };
  const withActiveFile = (action: (file: string) => unknown) => () => {
    const file = activeFile();
    if (file) return action(file);
  };
  /** Moves to the next or previous editor tab, wrapping around. */
  const cycleEditor = (step: 1 | -1) => {
    const { openFiles, selectedFile } = store();
    if (openFiles.length < 2) return;
    const index = selectedFile === null ? -1 : openFiles.indexOf(selectedFile);
    const next = (index + step + openFiles.length) % openFiles.length;
    return store().selectFile(openFiles[next]);
  };

  return [
    /* ── Go ──────────────────────────────────────────────────────── */
    {
      id: "go.file",
      category: "Go",
      title: "Go to File…",
      keys: "Ctrl+P",
      run: () => store().openQuickInput(""),
    },
    {
      id: "go.commands",
      category: "Go",
      title: "Show All Commands",
      keys: "Ctrl+Shift+P",
      run: () => store().openQuickInput(">"),
    },
    {
      id: "go.line",
      category: "Go",
      title: "Go to Line…",
      keys: "Ctrl+G",
      when: hasActiveFile,
      run: () => store().openQuickInput(":"),
    },
    {
      id: "search.files",
      category: "Search",
      title: "Find in Files",
      keys: "Ctrl+Shift+F",
      run: () => store().focusSearch(),
    },

    /* ── File ────────────────────────────────────────────────────── */
    {
      id: "file.save",
      category: "File",
      title: "Save",
      keys: "Ctrl+S",
      when: hasActiveFile,
      run: withActiveFile((file) => store().saveFile(file)),
    },
    {
      id: "file.saveAll",
      category: "File",
      title: "Save All",
      keys: "Ctrl+Shift+S",
      when: () => Object.keys(store().dirty).length > 0,
      run: () => store().saveAll(),
    },
    {
      id: "file.revert",
      category: "File",
      title: "Revert File",
      when: () => {
        const file = activeFile();
        return file !== null && Boolean(store().dirty[file]);
      },
      run: withActiveFile((file) => store().revertFile(file)),
    },
    {
      id: "file.close",
      category: "File",
      title: "Close Editor",
      keys: ["Ctrl+W", "Ctrl+F4"],
      when: hasActiveFile,
      run: withActiveFile((file) => store().closeFiles([file])),
    },
    {
      id: "view.nextEditor",
      category: "View",
      title: "Open Next Editor",
      keys: ["Ctrl+Tab", "Ctrl+PageDown"],
      when: () => store().openFiles.length > 1,
      run: () => cycleEditor(1),
    },
    {
      id: "view.previousEditor",
      category: "View",
      title: "Open Previous Editor",
      keys: ["Ctrl+Shift+Tab", "Ctrl+PageUp"],
      when: () => store().openFiles.length > 1,
      run: () => cycleEditor(-1),
    },
    {
      id: "file.closeAll",
      category: "File",
      title: "Close All Editors",
      when: () => store().openFiles.length > 0,
      run: () => store().closeFiles([...store().openFiles]),
    },
    {
      id: "file.copyPath",
      category: "File",
      title: "Copy Path of Active File",
      when: hasActiveFile,
      run: withActiveFile((file) =>
        copyText(absolutePath(store().workspaceRoot, file), "the path"),
      ),
    },
    {
      id: "file.copyRelativePath",
      category: "File",
      title: "Copy Relative Path of Active File",
      when: hasActiveFile,
      run: withActiveFile((file) => copyText(file, "the relative path")),
    },
    {
      id: "file.revealInExplorer",
      category: "File",
      title: "Reveal Active File in Explorer",
      when: hasActiveFile,
      run: withActiveFile((file) => store().revealFile(file)),
    },
    {
      id: "file.revealInOs",
      category: "File",
      title: "Reveal Active File in File Explorer",
      when: hasActiveFile,
      run: withActiveFile((file) => store().revealItem(file)),
    },

    /* ── View ────────────────────────────────────────────────────── */
    {
      id: "view.explorer",
      category: "View",
      title: "Show Explorer",
      keys: "Ctrl+Shift+E",
      run: () => store().setActiveView("explorer"),
    },
    {
      id: "view.scm",
      category: "View",
      title: "Show Pending Changes",
      keys: "Ctrl+Shift+G",
      run: () => store().setActiveView("scm"),
    },
    {
      id: "view.metadata",
      category: "View",
      title: "Show Metadata",
      keys: "Ctrl+Shift+M",
      run: () => store().setActiveView("metadata"),
    },
    {
      id: "view.settings",
      category: "View",
      title: "Show Workspace Settings",
      keys: "Ctrl+,",
      run: () => store().setActiveView("settings"),
    },
    {
      id: "view.toggleSidebar",
      category: "View",
      title: "Toggle Side Bar",
      keys: "Ctrl+B",
      run: () => store().toggleSidebar(),
    },
    {
      id: "view.toggleTerminal",
      category: "View",
      title: "Toggle Terminal",
      keys: "Ctrl+`",
      run: () => store().togglePanel(),
    },
    {
      // Tab stays inside the code editor to indent; F6 is the way out.
      id: "view.focusNextPart",
      category: "View",
      title: "Focus Next Part",
      keys: "F6",
      run: () => focusPart(1),
    },
    {
      id: "view.focusPreviousPart",
      category: "View",
      title: "Focus Previous Part",
      keys: "Shift+F6",
      run: () => focusPart(-1),
    },
    {
      id: "explorer.collapse",
      category: "Explorer",
      title: "Collapse Folders",
      run: () => store().collapseFolders(),
    },
    {
      id: "explorer.refresh",
      category: "Explorer",
      title: "Refresh",
      run: () => store().refreshFiles(),
    },

    /* ── Salesforce ──────────────────────────────────────────────── */
    {
      id: "sf.deployFile",
      category: "Salesforce",
      title: "Deploy Active File",
      when: metadataFile,
      run: withActiveFile((file) => store().deployPathsAction([file])),
    },
    {
      id: "sf.validateFile",
      category: "Salesforce",
      title: "Validate Active File…",
      when: metadataFile,
      run: withActiveFile((file) =>
        navigate("/deployments", { state: { deployPaths: [file] } }),
      ),
    },
    {
      id: "sf.retrieveFile",
      category: "Salesforce",
      title: "Retrieve Active File",
      when: metadataFile,
      run: withActiveFile((file) => store().retrievePathsAction([file])),
    },
    {
      id: "sf.diffFile",
      category: "Salesforce",
      title: "Diff Check Active File",
      when: metadataFile,
      run: withActiveFile((file) => store().openDiff(file)),
    },
    {
      id: "sf.deployChanged",
      category: "Salesforce",
      title: "Deploy Changed Files",
      when: () => org() !== null,
      run: async () => {
        // The list may be stale; deploy what has actually changed.
        await store().loadChanges();
        await store().deployChangedFiles();
      },
    },
    {
      id: "sf.retrieveMetadata",
      category: "Salesforce",
      title: "Retrieve Metadata…",
      when: () => org() !== null,
      run: () => store().openRetrieve(),
    },

    /* ── App ─────────────────────────────────────────────────────── */
    {
      id: "app.deployments",
      category: "Go",
      title: "Open Deployments",
      run: () => navigate("/deployments"),
    },
    {
      id: "app.devtools",
      category: "Go",
      title: "Open Developer Tools",
      run: () => navigate("/devtools"),
    },
    {
      id: "app.organizations",
      category: "Go",
      title: "Open Organizations",
      run: () => navigate("/organizations"),
    },
    {
      id: "workspace.openFolder",
      category: "Workspace",
      title: "Open Folder…",
      run: () => store().openFolder(),
    },
  ];
}
