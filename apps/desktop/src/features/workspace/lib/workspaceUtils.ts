import type { WorkspaceFile, WorkspaceFileType } from "../types";

/** Normalises a path to forward slashes without a leading slash. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

/** Returns the last path segment. */
export function getBaseName(path: string): string {
  const normalized = normalizePath(path);
  const segments = normalized.split("/");
  return segments[segments.length - 1] ?? "";
}

/** Returns the parent directory of a path ("" for top-level entries). */
export function getParentPath(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index === -1 ? "" : normalized.slice(0, index);
}

/** Flattens a file tree into a single list (depth-first). */
export function collectFiles(items: WorkspaceFile[]): WorkspaceFile[] {
  return items.flatMap((item) => [
    item,
    ...(item.children ? collectFiles(item.children) : []),
  ]);
}

/** All ancestor directory paths of a file/folder, outermost first. */
export function getAncestors(path: string): string[] {
  const normalized = normalizePath(path);
  const segments = normalized.split("/").filter(Boolean);
  const ancestors: string[] = [];
  let acc = "";
  for (let index = 0; index < segments.length - 1; index += 1) {
    acc = acc ? `${acc}/${segments[index]}` : segments[index];
    ancestors.push(acc);
  }
  return ancestors;
}

/** Finds the first matching node in a tree. */
export function findNode(
  nodes: WorkspaceFile[],
  path: string,
): WorkspaceFile | null {
  for (const node of nodes) {
    if (node.path === path) return node;
    if (node.children) {
      const match = findNode(node.children, path);
      if (match) return match;
    }
  }
  return null;
}

/**
 * Maps a tree, replacing paths that start with `from` (or equal it).
 * Used after name/path changes so the store stays consistent.
 */
export function mapTreePaths(
  nodes: WorkspaceFile[],
  from: string,
  to: string,
): WorkspaceFile[] {
  const fromPath = normalizePath(from);
  const toPath = normalizePath(to);
  let renamedHere = false;

  const mapped = nodes.map((node) => {
    const nodePath = normalizePath(node.path);
    const nextPath = remapPath(nodePath, fromPath, toPath);
    if (nodePath === fromPath) renamedHere = true;

    return {
      ...node,
      path: nextPath,
      // The renamed node itself shows its new name. Only the path used to be
      // updated, so the explorer row kept the old name until a refresh.
      name: nodePath === fromPath ? getBaseName(toPath) : node.name,
      children: node.children
        ? mapTreePaths(node.children, fromPath, toPath)
        : undefined,
    };
  });
  // The renamed entry moves to where its new name sorts.
  return renamedHere ? mapped.sort(compareNodes) : mapped;
}

/** `path` with a `from` prefix (or exact match) replaced by `to`. */
export function remapPath(path: string, from: string, to: string): string {
  return path === from || path.startsWith(`${from}/`)
    ? `${to}${path.slice(from.length)}`
    : path;
}

/**
 * A set of paths after `from` was renamed to `to` — used for the explorer's
 * expanded folders, so renaming an open folder does not collapse it.
 */
export function remapPathSet(
  paths: ReadonlySet<string>,
  from: string,
  to: string,
): Set<string> {
  return new Set([...paths].map((path) => remapPath(path, from, to)));
}

/** Removes a node (and all of its descendants) from a tree. */
export function removeNode(
  nodes: WorkspaceFile[],
  path: string,
): WorkspaceFile[] {
  const target = normalizePath(path);
  return nodes.flatMap((node) => {
    if (normalizePath(node.path) === target) return [];
    return [
      {
        ...node,
        children: node.children ? removeNode(node.children, target) : undefined,
      },
    ];
  });
}

/** Adds a child node under a folder path, creating it when needed. */
export function addNode(
  nodes: WorkspaceFile[],
  parentPath: string,
  child: WorkspaceFile,
): WorkspaceFile[] {
  const targetParent = normalizePath(parentPath);
  // Sorted at the root too: it used to append, so a new top-level item sat at
  // the bottom until the next refresh.
  if (!targetParent) {
    return [...nodes.filter((node) => node.path !== child.path), child].sort(
      compareNodes,
    );
  }

  return nodes.map((node) => {
    if (normalizePath(node.path) === targetParent) {
      // A folder not read yet only learns it has contents. Giving it a list
      // of just the new child would mark it loaded, hiding its other entries.
      if (node.children === undefined) return { ...node, hasChildren: true };
      return {
        ...node,
        hasChildren: true,
        children: [
          ...node.children.filter((item) => item.path !== child.path),
          child,
        ].sort(compareNodes),
      };
    }
    return {
      ...node,
      children: node.children
        ? addNode(node.children, targetParent, child)
        : undefined,
    };
  });
}

/** VS Code style ordering: folders first, then files, both alphabetical. */
export function compareNodes(a: WorkspaceFile, b: WorkspaceFile): number {
  const typeRank = (t: WorkspaceFileType) => (t === "folder" ? 0 : 1);
  if (typeRank(a.type) !== typeRank(b.type)) {
    return typeRank(a.type) - typeRank(b.type);
  }
  return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
}

/** Collapses overlapping ranges back into a singleton list. */
export function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Replaces one folder's `children` in place, leaving the rest of the tree
 * untouched. Used when a folder's contents arrive from a lazy read.
 */
export function setChildren(
  nodes: WorkspaceFile[],
  path: string,
  children: WorkspaceFile[],
): WorkspaceFile[] {
  const target = normalizePath(path);

  return nodes.map((node) => {
    if (normalizePath(node.path) === target) {
      return { ...node, children, hasChildren: children.length > 0 };
    }
    // Only descend where the target could actually live.
    if (node.children && target.startsWith(`${normalizePath(node.path)}/`)) {
      return {
        ...node,
        children: setChildren(node.children, target, children),
      };
    }
    return node;
  });
}

/**
 * A folder's fresh listing, keeping the contents already loaded for its
 * subfolders — re-reading one folder after a change must not collapse
 * everything open beneath it into "not loaded yet".
 */
export function mergeLoaded(
  previous: WorkspaceFile[] | undefined,
  next: WorkspaceFile[],
): WorkspaceFile[] {
  if (!previous) return next;
  const known = new Map(previous.map((node) => [node.path, node]));
  return next.map((node) => {
    const old = known.get(node.path);
    return node.type === "folder" &&
      old?.type === "folder" &&
      old.children !== undefined
      ? { ...node, children: old.children }
      : node;
  });
}

/** Marks a folder as having contents, without loading them. */
export function markHasChildren(
  nodes: WorkspaceFile[],
  path: string,
): WorkspaceFile[] {
  return nodes.map((node) => {
    if (node.path === path) return { ...node, hasChildren: true };
    if (node.children && path.startsWith(`${node.path}/`)) {
      return { ...node, children: markHasChildren(node.children, path) };
    }
    return node;
  });
}

/** Whether `path` is `folder` or inside it. "" contains everything. */
export function isWithin(path: string, folder: string): boolean {
  return folder === "" || path === folder || path.startsWith(`${folder}/`);
}

/**
 * The entry directly inside `folder` that holds `path` — `a/b` for `a/b/c/d`
 * in `a` — or null when `path` is not below `folder`.
 */
export function childWithin(path: string, folder: string): string | null {
  if (path === folder || !isWithin(path, folder)) return null;
  const rest = folder ? path.slice(folder.length + 1) : path;
  const first = rest.split("/")[0];
  return folder ? `${folder}/${first}` : first;
}

/**
 * Paths without duplicates, or entries inside another listed folder — acting
 * on a folder already covers its contents. Keeps the original order.
 */
export function topLevelPaths(paths: string[]): string[] {
  const unique = [...new Set(paths)];
  return unique.filter(
    (path) => !unique.some((other) => other !== path && isWithin(path, other)),
  );
}

/**
 * Every path from `from` to `to` inclusive, in `order` — a Shift+click range.
 * Just `to` when `from` is not in the list.
 */
export function pathsBetween(
  order: string[],
  from: string | null,
  to: string,
): string[] {
  const end = order.indexOf(to);
  if (end === -1) return [];
  const start = from === null ? -1 : order.indexOf(from);
  if (start === -1) return [to];
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/**
 * Whether deploy, retrieve and diff can act on `path`: only what lies in a
 * package directory is metadata. With none known, everything is offered and
 * the CLI has the last word.
 */
export function isDeployablePath(
  path: string,
  packageDirectories: string[],
): boolean {
  return (
    packageDirectories.length === 0 ||
    packageDirectories.some((directory) => isWithin(path, directory))
  );
}

/** A workspace-relative path as an absolute one, in the root's own style. */
export function absolutePath(root: string, relative: string): string {
  const separator = root.includes("\\") ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "");
  const rest = normalizePath(relative);
  return rest ? `${base}${separator}${rest.split("/").join(separator)}` : root;
}

const FORBIDDEN_NAME_CHARACTERS = /[/\\<>:"|?*]/;
const APEX_EXTENSIONS: Record<string, string> = {
  cls: "an Apex class",
  trigger: "an Apex trigger",
  page: "a Visualforce page",
  component: "a Visualforce component",
};
const APEX_NAME = /^[A-Za-z](?!.*__)[A-Za-z0-9_]{0,39}$/;

/**
 * An Apex API name: a letter, then letters, digits and single underscores,
 * not ending in one, at most 40 characters.
 */
export function isApexName(name: string): boolean {
  return APEX_NAME.test(name) && !name.endsWith("_");
}

/** "cls" or "trigger" for an Apex class or trigger file name, else null. */
export function apexKind(fileName: string): "cls" | "trigger" | null {
  if (fileName.endsWith(".cls")) return "cls";
  if (fileName.endsWith(".trigger")) return "trigger";
  return null;
}

/** An Apex file name without its extension: `Foo` for `Foo.cls`. */
export function apexStem(fileName: string): string {
  return fileName.replace(/\.(cls|trigger)$/, "");
}

/**
 * Why `name` can't be used for a new or renamed entry, or null. Mirrors the
 * backend's checks, so the problem shows while typing rather than as an
 * error after Enter. An empty name is not a problem: it cancels.
 */
export function entryNameProblem(
  name: string,
  options: {
    /** The entries already in the folder, when it has been read. */
    siblings?: WorkspaceFile[];
    /** The renamed entry itself, which its own name never clashes with. */
    current?: string;
    /** A new file: Apex and Visualforce names follow API name rules. */
    newFile?: boolean;
  } = {},
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (trimmed === "." || trimmed === "..") {
    return `"${trimmed}" can't be used as a name.`;
  }
  if (
    FORBIDDEN_NAME_CHARACTERS.test(trimmed) ||
    [...trimmed].some((character) => character.charCodeAt(0) < 32)
  ) {
    return "A name can't contain / \\ < > : \" | ? or *.";
  }
  if (/[. ]$/.test(trimmed)) {
    return "A name can't end with a dot or a space.";
  }

  const clash = options.siblings?.find(
    (node) =>
      node.path !== options.current &&
      node.name.toLowerCase() === trimmed.toLowerCase(),
  );
  if (clash) {
    return `${clash.name} already exists here. Choose a different name.`;
  }

  if (options.newFile) {
    const dot = trimmed.lastIndexOf(".");
    const kind = dot > 0 ? APEX_EXTENSIONS[trimmed.slice(dot + 1)] : undefined;
    const stem = trimmed.slice(0, dot);
    if (kind && !isApexName(stem)) {
      return `"${stem}" can't be ${kind} name. Start with a letter, then use letters, digits and single underscores (at most 40 characters).`;
    }
  }
  return null;
}

/** A tree row the explorer will actually draw, given what is expanded. */
export interface FlatNode {
  node: WorkspaceFile;
  depth: number;
  /** Entries in this row's folder, and this row's place among them (1-based). */
  setSize: number;
  posInSet: number;
}

/**
 * Flattens the tree into the ordered list of currently visible rows.
 *
 * Virtualising the explorer needs a flat list: a recursive component tree has
 * no stable index to map a scroll offset onto.
 */
export function flattenVisible(
  nodes: WorkspaceFile[],
  isExpanded: (path: string) => boolean,
  depth = 0,
): FlatNode[] {
  const rows: FlatNode[] = [];

  for (const [index, node] of nodes.entries()) {
    // Screen readers are told the position explicitly: with virtualised rows
    // the siblings they would otherwise count are mostly not in the DOM.
    rows.push({ node, depth, setSize: nodes.length, posInSet: index + 1 });
    if (
      node.type === "folder" &&
      isExpanded(node.path) &&
      node.children &&
      node.children.length > 0
    ) {
      rows.push(...flattenVisible(node.children, isExpanded, depth + 1));
    }
  }

  return rows;
}
