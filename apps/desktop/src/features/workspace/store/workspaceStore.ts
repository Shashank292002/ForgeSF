import { create } from "zustand";
import { loadWorkspaceFileContent, loadWorkspaceFiles, type WorkspaceNode } from "../services/workspaceService";

export interface WorkspaceFile {
    path: string;
    name: string;
    type: "file" | "folder";
    children?: WorkspaceFile[];
}

interface WorkspaceState {
    files: WorkspaceFile[];
    selectedFile: string | null;
    openFiles: string[];
    fileContents: Record<string, string>;
    saveStatus: "idle" | "saved";
    setFiles: (files: WorkspaceFile[]) => void;
    selectFile: (file: string) => void;
    closeFile: (file: string) => void;
    updateFileContent: (file: string, content: string) => void;
    saveFile: (file: string) => void;
    refreshFiles: () => Promise<void>;
}

function mapNode(node: WorkspaceNode): WorkspaceFile {
    return {
        path: node.path.replace(/\\/g, "/").replace(/^\//, ""),
        name: node.name,
        type: node.nodeType === "folder" ? "folder" : "file",
        children: node.children?.map(mapNode),
    };
}

function collectFiles(items: WorkspaceFile[]): WorkspaceFile[] {
    return items.flatMap((item) => {
        const children = item.children ? collectFiles(item.children) : [];
        return [item, ...children];
    });
}

function findFirstFile(items: WorkspaceFile[]): string | null {
    const files = collectFiles(items).filter((item) => item.type === "file");
    return files[0]?.path ?? null;
}

async function loadWorkspaceSnapshot() {
    const nodes = await loadWorkspaceFiles("");
    const files = nodes.map(mapNode);
    const fileContents: Record<string, string> = {};
    const filesToLoad = collectFiles(files).filter((item) => item.type === "file");

    for (const file of filesToLoad) {
        fileContents[file.path] = await loadWorkspaceFileContent(file.path);
    }

    return {
        files,
        firstFile: findFirstFile(files),
        fileContents,
    };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
    files: [],
    selectedFile: null,
    openFiles: [],
    fileContents: {},
    saveStatus: "idle",

    setFiles: (files) => set({ files }),

    selectFile: (file) =>
        set((state) => ({
            selectedFile: file,
            openFiles: state.openFiles.includes(file) ? state.openFiles : [...state.openFiles, file],
        })),

    closeFile: (file) =>
        set((state) => {
            const nextOpenFiles = state.openFiles.filter((openFile) => openFile !== file);
            return {
                openFiles: nextOpenFiles,
                selectedFile: state.selectedFile === file ? nextOpenFiles[0] ?? null : state.selectedFile,
            };
        }),

    updateFileContent: (file, content) =>
        set((state) => ({
            fileContents: {
                ...state.fileContents,
                [file]: content,
            },
        })),

    saveFile: (file) => {
        console.log("Saving file:", file);
        set({ saveStatus: "saved" });
    },

    refreshFiles: async () => {
        try {
            const { files, firstFile, fileContents } = await loadWorkspaceSnapshot();
            const currentSelection = get().selectedFile;
            const currentOpenFiles = get().openFiles;
            const availableFiles = new Set(Object.keys(fileContents));
            const nextSelected = currentSelection && availableFiles.has(currentSelection) ? currentSelection : firstFile;
            const nextOpenFiles = currentOpenFiles.filter((file) => availableFiles.has(file));

            if (nextSelected && !nextOpenFiles.includes(nextSelected)) {
                nextOpenFiles.unshift(nextSelected);
            }

            set({
                files,
                selectedFile: nextSelected,
                openFiles: nextOpenFiles,
                fileContents,
                saveStatus: "idle",
            });
        } catch (error) {
            console.error("Failed to load workspace files", error);
        }
    },
}));

void (async () => {
    await useWorkspaceStore.getState().refreshFiles();
})();