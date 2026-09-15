import {
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  FilePlus2,
  FolderPlus,
  FolderSearch,
  GitCompare,
  Link,
  Pencil,
  Rocket,
  Scissors,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Menu, MenuItem, MenuSeparator } from "../../../components/ui";
import { getParentPath } from "../lib/workspaceUtils";

/** What the explorer does for each entry; the menu only decides what shows. */
export interface FileMenuActions {
  deploy: (paths: string[]) => void;
  validate: (paths: string[]) => void;
  retrieve: (paths: string[]) => void;
  diff: (path: string) => void;
  newFile: (folder: string) => void;
  newFolder: (folder: string) => void;
  cut: (paths: string[]) => void;
  copy: (paths: string[]) => void;
  paste: (folder: string) => void;
  duplicate: (paths: string[]) => void;
  copyPath: (paths: string[]) => void;
  copyRelativePath: (paths: string[]) => void;
  reveal: (path: string) => void;
  rename: (path: string) => void;
  delete: (paths: string[]) => void;
}

interface FileContextMenuProps {
  x: number;
  y: number;
  /** The items acted on: the whole selection when the clicked row is in it. */
  paths: string[];
  /** The row clicked, or null for the empty space below the rows. */
  target: { path: string; type: "file" | "folder" } | null;
  /** Org-backed actions are disabled without a connection. */
  hasOrg: boolean;
  /** Every item is inside a package directory, so it is metadata. */
  deployable: boolean;
  canPaste: boolean;
  onClose: () => void;
  actions: FileMenuActions;
}

const REVEAL_LABEL =
  typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent)
    ? "Reveal in Finder"
    : typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent)
      ? "Reveal in File Explorer"
      : "Open Containing Folder";

export default function FileContextMenu({
  x,
  y,
  paths,
  target,
  hasOrg,
  deployable,
  canPaste,
  onClose,
  actions,
}: FileContextMenuProps) {
  const count = paths.length;
  // Single-item actions (rename, diff) only apply to a lone clicked item.
  const single = count === 1 ? target : null;
  // New items and pastes go into the clicked folder, or beside a clicked file.
  const folder = target
    ? target.type === "folder"
      ? target.path
      : getParentPath(target.path)
    : "";

  // Deploy, validate and retrieve make no sense for README.md or
  // sfdx-project.json: offering them only produced a CLI error.
  const orgProblem = !hasOrg
    ? "Connect an org first"
    : deployable
      ? undefined
      : "Only metadata inside a package directory can be deployed or retrieved";
  const noun =
    count > 1 ? ` ${count} Items` : single?.type === "folder" ? " Folder" : "";

  return (
    <Menu
      className="forge-ws__context-menu"
      label={
        count > 1
          ? `Actions for ${count} items`
          : target
            ? "Explorer item actions"
            : "Workspace actions"
      }
      at={{ x, y }}
      onClose={onClose}
    >
      {count > 0 && (
        <>
          <MenuItem
            disabled={Boolean(orgProblem)}
            title={orgProblem}
            onSelect={() => actions.deploy(paths)}
          >
            <Rocket size={14} />
            <span>Deploy{noun}</span>
          </MenuItem>
          <MenuItem
            disabled={Boolean(orgProblem)}
            title={
              orgProblem ??
              "Pick an org and test level, then check the deploy without changing the org"
            }
            onSelect={() => actions.validate(paths)}
          >
            <ShieldCheck size={14} />
            <span>Validate{noun}…</span>
          </MenuItem>
          <MenuItem
            disabled={Boolean(orgProblem)}
            title={orgProblem}
            onSelect={() => actions.retrieve(paths)}
          >
            <Download size={14} />
            <span>Retrieve{noun}</span>
          </MenuItem>
          {single && (
            <MenuItem
              disabled={Boolean(orgProblem)}
              title={orgProblem}
              onSelect={() => actions.diff(single.path)}
            >
              <GitCompare size={14} />
              <span>Diff Check</span>
            </MenuItem>
          )}

          <MenuSeparator className="forge-ws__context-menu__sep" />
        </>
      )}

      <MenuItem onSelect={() => actions.newFile(folder)}>
        <FilePlus2 size={14} />
        <span>New File…</span>
      </MenuItem>
      <MenuItem onSelect={() => actions.newFolder(folder)}>
        <FolderPlus size={14} />
        <span>New Folder…</span>
      </MenuItem>

      <MenuSeparator className="forge-ws__context-menu__sep" />

      {count > 0 && (
        <>
          <MenuItem onSelect={() => actions.cut(paths)}>
            <Scissors size={14} />
            <span>Cut</span>
            <kbd>Ctrl+X</kbd>
          </MenuItem>
          <MenuItem onSelect={() => actions.copy(paths)}>
            <Copy size={14} />
            <span>Copy</span>
            <kbd>Ctrl+C</kbd>
          </MenuItem>
        </>
      )}
      <MenuItem
        disabled={!canPaste}
        title={canPaste ? undefined : "Cut or copy something first"}
        onSelect={() => actions.paste(folder)}
      >
        <ClipboardPaste size={14} />
        <span>Paste</span>
        <kbd>Ctrl+V</kbd>
      </MenuItem>
      {count > 0 && (
        <MenuItem onSelect={() => actions.duplicate(paths)}>
          <CopyPlus size={14} />
          <span>Duplicate</span>
        </MenuItem>
      )}

      <MenuSeparator className="forge-ws__context-menu__sep" />

      <MenuItem onSelect={() => actions.copyPath(paths)}>
        <Link size={14} />
        <span>Copy Path</span>
        <kbd>Shift+Alt+C</kbd>
      </MenuItem>
      {count > 0 && (
        <MenuItem onSelect={() => actions.copyRelativePath(paths)}>
          <Link size={14} />
          <span>Copy Relative Path</span>
        </MenuItem>
      )}
      {count <= 1 && (
        <MenuItem onSelect={() => actions.reveal(single?.path ?? "")}>
          <FolderSearch size={14} />
          <span>{REVEAL_LABEL}</span>
          <kbd>Shift+Alt+R</kbd>
        </MenuItem>
      )}

      {count > 0 && (
        <>
          <MenuSeparator className="forge-ws__context-menu__sep" />
          {single && (
            <MenuItem onSelect={() => actions.rename(single.path)}>
              <Pencil size={14} />
              <span>Rename…</span>
              <kbd>F2</kbd>
            </MenuItem>
          )}
          <MenuItem
            className="is-danger"
            onSelect={() => actions.delete(paths)}
          >
            <Trash2 size={14} />
            <span>Delete{count > 1 ? ` ${count} Items` : ""}</span>
            <kbd>Del</kbd>
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
