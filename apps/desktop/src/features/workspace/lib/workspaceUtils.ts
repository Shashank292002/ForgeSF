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

  return nodes.map((node) => {
    const nodePath = normalizePath(node.path);
    const nextPath = nodePath === fromPath || nodePath.startsWith(`${fromPath}/`)
      ? `${toPath}${nodePath.slice(fromPath.length)}`
      : nodePath;

    return {
      ...node,
      path: nextPath,
      children: node.children
        ? mapTreePaths(node.children, fromPath, toPath)
        : undefined,
    };
  });
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
  if (!targetParent) return [...nodes, child];

  return nodes.map((node) => {
    if (normalizePath(node.path) === targetParent) {
      return {
        ...node,
        children: [...(node.children ?? []), child].sort((a, b) =>
          compareNodes(a, b),
        ),
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