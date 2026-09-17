import { describe, expect, it } from "vitest";

import {
  apexFilesIn,
  looksLikeTest,
  testClassesIn,
  uncoveredLinesFor,
} from "./apexTests";
import type { WorkspaceFile } from "../types";

const file = (path: string): WorkspaceFile => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  type: "file",
});

const folder = (path: string, children: WorkspaceFile[]): WorkspaceFile => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  type: "folder",
  children,
});

describe("looksLikeTest", () => {
  it("recognises the conventions, and nothing else", () => {
    expect(looksLikeTest("AccountServiceTest")).toBe(true);
    expect(looksLikeTest("AccountServiceTests")).toBe(true);
    expect(looksLikeTest("TestAccountService")).toBe(true);
    expect(looksLikeTest("AccountService")).toBe(false);
    expect(looksLikeTest("Contest")).toBe(true); // ends in "test"; the org decides
  });
});

describe("testClassesIn", () => {
  it("finds test classes anywhere in the tree, sorted", () => {
    const tree = [
      folder("force-app", [
        folder("force-app/classes", [
          file("force-app/classes/ZebraTest.cls"),
          file("force-app/classes/AccountService.cls"),
          file("force-app/classes/AccountServiceTest.cls"),
          file("force-app/classes/AccountServiceTest.cls-meta.xml"),
        ]),
        folder("force-app/lwc", [file("force-app/lwc/card/card.js")]),
      ]),
    ];

    expect(testClassesIn(tree)).toEqual([
      {
        name: "AccountServiceTest",
        path: "force-app/classes/AccountServiceTest.cls",
      },
      { name: "ZebraTest", path: "force-app/classes/ZebraTest.cls" },
    ]);
  });

  it("is empty for a workspace with no classes", () => {
    expect(testClassesIn([])).toEqual([]);
  });
});

describe("apexFilesIn", () => {
  it("indexes every class and trigger, not only the tests", () => {
    // Coverage is reported for the classes a run touched, which are the ones
    // that are not tests — indexing only tests left those rows dead.
    const paths = [
      "force-app/AccountService.cls",
      "force-app/AccountServiceTest.cls",
      "force-app/AccountService.cls-meta.xml",
      "force-app/AccountTrigger.trigger",
      "force-app/notes.txt",
    ];

    expect([...apexFilesIn(paths).entries()].sort()).toEqual([
      ["AccountService", "force-app/AccountService.cls"],
      ["AccountServiceTest", "force-app/AccountServiceTest.cls"],
      ["AccountTrigger", "force-app/AccountTrigger.trigger"],
    ]);
  });
});

describe("uncoveredLinesFor", () => {
  const coverage = { AccountService: [6, 9], AccountTrigger: [2] };

  it("matches a class or trigger file to its coverage", () => {
    expect(
      uncoveredLinesFor("force-app/classes/AccountService.cls", coverage),
    ).toEqual([6, 9]);
    expect(
      uncoveredLinesFor("force-app/triggers/AccountTrigger.trigger", coverage),
    ).toEqual([2]);
  });

  it("gives nothing for a file that cannot have coverage", () => {
    // A metadata file whose stem matches a covered class must not inherit it.
    expect(
      uncoveredLinesFor(
        "force-app/classes/AccountService.cls-meta.xml",
        coverage,
      ),
    ).toEqual([]);
    expect(uncoveredLinesFor("force-app/lwc/card/card.js", coverage)).toEqual(
      [],
    );
    expect(
      uncoveredLinesFor("force-app/classes/Unknown.cls", coverage),
    ).toEqual([]);
  });
});
