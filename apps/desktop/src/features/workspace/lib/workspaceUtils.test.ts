import { describe, expect, it } from "vitest";

import {
  addNode,
  compareNodes,
  getAncestors,
  getBaseName,
  getParentPath,
  findNode,
  mapTreePaths,
  normalizePath,
  removeNode,
  setChildren,
  flattenVisible,
} from "./workspaceUtils";
import type { WorkspaceFile } from "../types";

const file = (path: string): WorkspaceFile => ({
  path,
  name: getBaseName(path),
  type: "file",
});

const folder = (
  path: string,
  children: WorkspaceFile[] = [],
): WorkspaceFile => ({
  path,
  name: getBaseName(path),
  type: "folder",
  children,
});

describe("path helpers", () => {
  it("normalises separators and strips leading slashes", () => {
    expect(normalizePath("\\force-app\\main")).toBe("force-app/main");
    expect(normalizePath("///a/b")).toBe("a/b");
  });

  it("returns the last segment", () => {
    expect(getBaseName("force-app/main/Foo.cls")).toBe("Foo.cls");
    expect(getBaseName("Foo.cls")).toBe("Foo.cls");
  });

  it("returns an empty parent for top-level entries", () => {
    expect(getParentPath("Foo.cls")).toBe("");
    expect(getParentPath("a/b/Foo.cls")).toBe("a/b");
  });

  it("lists ancestors outermost first, excluding the node itself", () => {
    expect(getAncestors("a/b/c/Foo.cls")).toEqual(["a", "a/b", "a/b/c"]);
    expect(getAncestors("Foo.cls")).toEqual([]);
  });
});

describe("tree operations", () => {
  const tree = [
    folder("a", [folder("a/b", [file("a/b/c.cls")]), file("a/d.cls")]),
  ];

  it("finds a nested node", () => {
    expect(findNode(tree, "a/b/c.cls")?.name).toBe("c.cls");
    expect(findNode(tree, "nope")).toBeNull();
  });

  it("removes a node and its descendants", () => {
    const next = removeNode(tree, "a/b");
    expect(findNode(next, "a/b")).toBeNull();
    expect(findNode(next, "a/b/c.cls")).toBeNull();
    expect(findNode(next, "a/d.cls")).not.toBeNull();
  });

  it("rewrites descendant paths on rename", () => {
    const next = mapTreePaths(tree, "a/b", "a/renamed");
    expect(findNode(next, "a/renamed/c.cls")).not.toBeNull();
    expect(findNode(next, "a/b/c.cls")).toBeNull();
  });

  it("adds a child under a folder, keeping order", () => {
    const next = addNode(tree, "a", file("a/aaa.cls"));
    const children = findNode(next, "a")?.children ?? [];
    // Folders sort before files, then alphabetically.
    expect(children.map((node) => node.name)).toEqual([
      "b",
      "aaa.cls",
      "d.cls",
    ]);
  });

  it("adds to the root when the parent path is empty", () => {
    expect(addNode(tree, "", file("top.cls"))).toHaveLength(2);
  });
});

describe("compareNodes", () => {
  it("puts folders before files", () => {
    expect(compareNodes(folder("z"), file("a"))).toBeLessThan(0);
  });

  it("sorts case-insensitively within a type", () => {
    expect(compareNodes(file("Beta"), file("alpha"))).toBeGreaterThan(0);
  });
});

describe("lazy-loading helpers", () => {
  const lazyTree: WorkspaceFile[] = [
    { path: "a", name: "a", type: "folder", hasChildren: true },
    { path: "b.cls", name: "b.cls", type: "file" },
  ];

  it("fills in a folder's children without touching siblings", () => {
    const next = setChildren(lazyTree, "a", [file("a/x.cls")]);
    expect(next[0].children).toHaveLength(1);
    expect(next[0].hasChildren).toBe(true);
    expect(next[1]).toBe(lazyTree[1]);
  });

  it("marks a folder as empty when the read returns nothing", () => {
    const next = setChildren(lazyTree, "a", []);
    expect(next[0].hasChildren).toBe(false);
  });

  it("only shows children of expanded folders", () => {
    const loaded = setChildren(lazyTree, "a", [file("a/x.cls")]);
    expect(flattenVisible(loaded, () => false).map((r) => r.node.path)).toEqual([
      "a",
      "b.cls",
    ]);
    expect(flattenVisible(loaded, () => true).map((r) => r.node.path)).toEqual([
      "a",
      "a/x.cls",
      "b.cls",
    ]);
  });

  it("reports nesting depth for indent guides", () => {
    const loaded = setChildren(lazyTree, "a", [file("a/x.cls")]);
    expect(flattenVisible(loaded, () => true).map((r) => r.depth)).toEqual([
      0, 1, 0,
    ]);
  });

  it("treats an unloaded folder as having no visible children", () => {
    expect(flattenVisible(lazyTree, () => true)).toHaveLength(2);
  });
});
