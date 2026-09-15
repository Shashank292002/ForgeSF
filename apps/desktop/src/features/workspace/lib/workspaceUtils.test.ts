import { describe, expect, it } from "vitest";

import {
  absolutePath,
  addNode,
  childWithin,
  compareNodes,
  entryNameProblem,
  getAncestors,
  getBaseName,
  getParentPath,
  findNode,
  isDeployablePath,
  mapTreePaths,
  normalizePath,
  pathsBetween,
  removeNode,
  setChildren,
  flattenVisible,
  remapPathSet,
  topLevelPaths,
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

  it("shows the new name on the renamed node, not its children", () => {
    const next = mapTreePaths(tree, "a/b", "a/renamed");
    expect(findNode(next, "a/renamed")?.name).toBe("renamed");
    expect(findNode(next, "a/renamed/c.cls")?.name).toBe("c.cls");
  });

  it("remaps expanded folders after a rename", () => {
    const expanded = new Set(["a", "a/b", "a/b/deep", "a/bb"]);
    expect([...remapPathSet(expanded, "a/b", "a/x")].sort()).toEqual([
      "a",
      "a/bb",
      "a/x",
      "a/x/deep",
    ]);
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

  it("sorts a new top-level entry into place", () => {
    const root = [folder("b"), file("c.cls")];
    expect(addNode(root, "", folder("a")).map((node) => node.path)).toEqual([
      "a",
      "b",
      "c.cls",
    ]);
  });

  it("does not fill in a folder that has not been read", () => {
    const lazy: WorkspaceFile[] = [
      { path: "a", name: "a", type: "folder", hasChildren: false },
    ];
    const next = addNode(lazy, "a", file("a/new.cls"));
    // Still unread, so its other entries load when it is opened.
    expect(next[0].children).toBeUndefined();
    expect(next[0].hasChildren).toBe(true);
  });

  it("moves a renamed entry to where its new name sorts", () => {
    const next = mapTreePaths(tree, "a/d.cls", "a/0first.cls");
    expect(findNode(next, "a")?.children?.map((node) => node.name)).toEqual([
      "b",
      "0first.cls",
    ]);
    const renamed = mapTreePaths(
      [file("x/Apple.cls"), file("x/Mango.cls")],
      "x/Apple.cls",
      "x/Zebra.cls",
    );
    expect(renamed.map((node) => node.name)).toEqual([
      "Mango.cls",
      "Zebra.cls",
    ]);
  });
});

describe("selection and path helpers", () => {
  it("names the entry directly inside a folder that holds a path", () => {
    expect(childWithin("a/b/c/d.cls", "a")).toBe("a/b");
    expect(childWithin("a/b", "")).toBe("a");
    expect(childWithin("a", "a")).toBeNull();
    expect(childWithin("ab/c", "a")).toBeNull();
  });

  it("drops duplicates and entries inside another listed folder", () => {
    expect(
      topLevelPaths(["a/x.cls", "b", "a", "b/y.cls", "a", "ab.cls"]),
    ).toEqual(["b", "a", "ab.cls"]);
  });

  it("selects a range in either direction", () => {
    const order = ["a", "b", "c", "d"];
    expect(pathsBetween(order, "b", "d")).toEqual(["b", "c", "d"]);
    expect(pathsBetween(order, "d", "b")).toEqual(["b", "c", "d"]);
    expect(pathsBetween(order, null, "c")).toEqual(["c"]);
    expect(pathsBetween(order, "gone", "c")).toEqual(["c"]);
    expect(pathsBetween(order, "a", "gone")).toEqual([]);
  });

  it("only treats paths in a package directory as deployable", () => {
    const dirs = ["force-app", "libs/shared"];
    expect(isDeployablePath("force-app/main/default/classes/A.cls", dirs)).toBe(
      true,
    );
    expect(isDeployablePath("force-app", dirs)).toBe(true);
    expect(isDeployablePath("libs/shared/x.cls", dirs)).toBe(true);
    expect(isDeployablePath("sfdx-project.json", dirs)).toBe(false);
    expect(isDeployablePath("force-app-old/A.cls", dirs)).toBe(false);
    // Nothing known: everything is offered, and the CLI decides.
    expect(isDeployablePath("README.md", [])).toBe(true);
  });

  it("builds absolute paths in the root's own style", () => {
    expect(absolutePath("C:\\Work\\proj\\", "force-app/A.cls")).toBe(
      "C:\\Work\\proj\\force-app\\A.cls",
    );
    expect(absolutePath("/home/me/proj", "force-app/A.cls")).toBe(
      "/home/me/proj/force-app/A.cls",
    );
    expect(absolutePath("C:\\Work\\proj", "")).toBe("C:\\Work\\proj");
  });
});

describe("entryNameProblem", () => {
  const siblings = [file("classes/Foo.cls"), folder("classes/lib")];

  it("accepts a free name, and an empty one (which cancels)", () => {
    expect(entryNameProblem("Bar.cls", { siblings })).toBeNull();
    expect(entryNameProblem("   ", { siblings })).toBeNull();
  });

  it("refuses characters and endings the OS would reject", () => {
    expect(entryNameProblem("a/b", {})).toMatch(/can't contain/);
    expect(entryNameProblem("what?", {})).toMatch(/can't contain/);
    expect(entryNameProblem("trailing.", {})).toMatch(/end with a dot/);
    expect(entryNameProblem("..", {})).toMatch(/can't be used/);
  });

  it("refuses a name already taken, ignoring case", () => {
    expect(entryNameProblem("foo.CLS", { siblings })).toMatch(
      /Foo\.cls already exists/,
    );
    // A case-only rename of the entry itself is fine.
    expect(
      entryNameProblem("FOO.cls", { siblings, current: "classes/Foo.cls" }),
    ).toBeNull();
  });

  it("checks Apex and Visualforce names on new files", () => {
    expect(entryNameProblem("my-service.cls", { newFile: true })).toMatch(
      /Apex class name/,
    );
    expect(entryNameProblem("Bad__Name.trigger", { newFile: true })).toMatch(
      /Apex trigger name/,
    );
    expect(entryNameProblem("Trailing_.page", { newFile: true })).toMatch(
      /Visualforce page name/,
    );
    expect(
      entryNameProblem("AccountService.cls", { newFile: true }),
    ).toBeNull();
    // Only Apex extensions have API name rules.
    expect(entryNameProblem("my-notes.txt", { newFile: true })).toBeNull();
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
    expect(flattenVisible(loaded, () => false).map((r) => r.node.path)).toEqual(
      ["a", "b.cls"],
    );
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

  it("gives each row its position among its siblings", () => {
    const loaded = setChildren(lazyTree, "a", [
      file("a/x.cls"),
      file("a/y.cls"),
    ]);
    expect(
      flattenVisible(loaded, () => true).map((row) => [
        row.node.path,
        row.posInSet,
        row.setSize,
      ]),
    ).toEqual([
      ["a", 1, 2],
      ["a/x.cls", 1, 2],
      ["a/y.cls", 2, 2],
      ["b.cls", 2, 2],
    ]);
  });
});
