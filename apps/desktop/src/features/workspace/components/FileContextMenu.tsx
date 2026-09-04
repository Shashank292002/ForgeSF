import { useEffect, useRef } from "react";
import {
  Download,
  FilePlus2,
  FolderPlus,
  GitCompare,
  Pencil,
  Rocket,
  Trash2,
} from "lucide-react";

interface FileContextMenuProps {
  x: number;
  y: number;
  path: string;
  /** Folder actions are labelled differently and skip file-only entries. */
  type: "file" | "folder";
  /** Org-backed actions are disabled without a connection. */
  hasOrg: boolean;
  onClose: () => void;
  onDeploy: (path: string) => void;
  onRetrieve: (path: string) => void;
  onDiff: (path: string) => void;
  onNewFile: (path: string) => void;
  onNewFolder: (path: string) => void;
  onRename: (path: string) => void;
  onDelete: (path: string) => void;
}

export default function FileContextMenu({
  x,
  y,
  path,
  type,
  hasOrg,
  onClose,
  onDeploy,
  onRetrieve,
  onDiff,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
}: FileContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  /* Keep the menu inside the viewport and close on outside click / Escape. */
  useEffect(() => {
    const menu = ref.current;
    if (menu) {
      const rect = menu.getBoundingClientRect();
      const left = Math.min(x, window.innerWidth - rect.width - 8);
      const top = Math.min(y, window.innerHeight - rect.height - 8);
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top = `${Math.max(8, top)}px`;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!menu?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [x, y, onClose]);

  const isFolder = type === "folder";

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <div
      ref={ref}
      className="forge-ws__context-menu"
      role="menu"
      aria-label="Explorer item actions"
    >
      <button
        type="button"
        role="menuitem"
        disabled={!hasOrg}
        title={hasOrg ? undefined : "Connect an org first"}
        onClick={() => run(() => onDeploy(path))}
      >
        <Rocket size={14} />
        <span>{isFolder ? "Deploy Folder" : "Deploy"}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!hasOrg}
        title={hasOrg ? undefined : "Connect an org first"}
        onClick={() => run(() => onRetrieve(path))}
      >
        <Download size={14} />
        <span>{isFolder ? "Retrieve Folder" : "Retrieve"}</span>
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!hasOrg}
        title={hasOrg ? undefined : "Connect an org first"}
        onClick={() => run(() => onDiff(path))}
      >
        <GitCompare size={14} />
        <span>Diff Check</span>
      </button>

      <div className="forge-ws__context-menu__sep" role="separator" />

      <button
        type="button"
        role="menuitem"
        onClick={() => run(() => onNewFile(path))}
      >
        <FilePlus2 size={14} />
        <span>New File…</span>
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={() => run(() => onNewFolder(path))}
      >
        <FolderPlus size={14} />
        <span>New Folder…</span>
      </button>
      <div className="forge-ws__context-menu__sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        onClick={() => run(() => onRename(path))}
      >
        <Pencil size={14} />
        <span>Rename…</span>
        <kbd>F2</kbd>
      </button>
      <div className="forge-ws__context-menu__sep" role="separator" />
      <button
        type="button"
        role="menuitem"
        className="is-danger"
        onClick={() => run(() => onDelete(path))}
      >
        <Trash2 size={14} />
        <span>Delete</span>
        <kbd>Del</kbd>
      </button>
    </div>
  );
}
