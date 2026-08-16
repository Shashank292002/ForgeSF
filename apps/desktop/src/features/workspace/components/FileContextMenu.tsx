import { useEffect, useRef } from "react";
import { FilePlus2, FolderPlus, Pencil, Trash2 } from "lucide-react";

import { useWorkspaceStore } from "../store/workspaceStore";

interface FileContextMenuProps {
  x: number;
  y: number;
  path: string;
  onClose: () => void;
}

export default function FileContextMenu({
  x,
  y,
  path,
  onClose,
}: FileContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { renameItem, deleteItem, createItem } = useWorkspaceStore();

  useEffect(() => {
    if (!ref.current) return;
    const menu = ref.current;
    const width = 170;
    const height = 160;
    const left = Math.min(x, window.innerWidth - width - 8);
    const top = Math.min(y, window.innerHeight - height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }, [x, y]);

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  const handleRename = () => {
    const newName = window.prompt("Rename", path.split("/").pop() ?? "");
    if (newName && newName.trim()) {
      void renameItem(path, newName.trim());
    }
  };

  const handleDelete = () => {
    if (window.confirm(`Delete "${path}"? This cannot be undone.`)) {
      void deleteItem(path);
    }
  };

  const handleNewFile = () => {
    const name = window.prompt("New file name");
    if (name && name.trim()) {
      void createItem(path, name.trim(), false);
    }
  };

  const handleNewFolder = () => {
    const name = window.prompt("New folder name");
    if (name && name.trim()) {
      void createItem(path, name.trim(), true);
    }
  };

  return (
    <div ref={ref} className="forge-ws__context-menu" onMouseLeave={onClose}>
      <button type="button" onClick={() => handleAction(handleNewFile)}>
        <FilePlus2 size={13} /> New File…
      </button>
      <button type="button" onClick={() => handleAction(handleNewFolder)}>
        <FolderPlus size={13} /> New Folder…
      </button>
      <div className="forge-ws__context-menu__sep" />
      <button type="button" onClick={() => handleAction(handleRename)}>
        <Pencil size={13} /> Rename…
      </button>
      <button type="button" onClick={() => handleAction(handleDelete)}>
        <Trash2 size={13} className="danger" /> Delete
      </button>
    </div>
  );
}