import { describe, expect, it } from "vitest";

import {
  deployFormProblem,
  formatDuration,
  parseTestNames,
  percent,
  scopeLabel,
  statusLabel,
  statusTone,
} from "./deployForm";

const form = (
  overrides: Partial<Parameters<typeof deployFormProblem>[0]> = {},
) => ({
  checkOnly: false,
  testLevel: "" as const,
  tests: [],
  scope: "workspace" as const,
  changedCount: 0,
  pathsCount: 0,
  metadataCount: 0,
  ...overrides,
});

describe("the deploy form", () => {
  it("reads test class names from commas, spaces and new lines", () => {
    expect(
      parseTestNames(" AccountTest, OrderTest\nns.InvoiceTest;;AccountTest "),
    ).toEqual(["AccountTest", "OrderTest", "ns.InvoiceTest"]);
    expect(parseTestNames("   ")).toEqual([]);
  });

  it("accepts a plain workspace deploy", () => {
    expect(deployFormProblem(form())).toBeNull();
  });

  it("needs something to send", () => {
    expect(deployFormProblem(form({ scope: "changed" }))).toMatch(
      /No modified or added/,
    );
    expect(
      deployFormProblem(form({ scope: "changed", changedCount: 2 })),
    ).toBeNull();
    expect(deployFormProblem(form({ scope: "metadata" }))).toMatch(
      /metadata type/,
    );
    expect(deployFormProblem(form({ scope: "paths" }))).toMatch(
      /Workspace explorer/,
    );
    expect(
      deployFormProblem(form({ scope: "paths", pathsCount: 1 })),
    ).toBeNull();
  });

  it("does not let a validation skip tests", () => {
    expect(
      deployFormProblem(form({ checkOnly: true, testLevel: "NoTestRun" })),
    ).toMatch(/validation has to run tests/);
    expect(
      deployFormProblem(form({ checkOnly: false, testLevel: "NoTestRun" })),
    ).toBeNull();
  });

  it("needs valid class names for specified tests", () => {
    expect(deployFormProblem(form({ testLevel: "RunSpecifiedTests" }))).toMatch(
      /at least one/,
    );
    expect(
      deployFormProblem(
        form({ testLevel: "RunSpecifiedTests", tests: ["--wait"] }),
      ),
    ).toMatch(/not a valid Apex test class/);
    expect(
      deployFormProblem(
        form({ testLevel: "RunSpecifiedTests", tests: ["ns.AccountTest"] }),
      ),
    ).toBeNull();
  });

  it("labels what was sent", () => {
    expect(scopeLabel("workspace", { changed: 0, metadata: [] })).toBe(
      "Whole workspace",
    );
    expect(scopeLabel("changed", { changed: 1, metadata: [] })).toBe(
      "1 changed file",
    );
    expect(
      scopeLabel("metadata", { changed: 0, metadata: ["ApexClass", "Flow"] }),
    ).toBe("ApexClass, Flow");
    expect(
      scopeLabel("metadata", { changed: 0, metadata: ["A", "B", "C", "D"] }),
    ).toBe("4 metadata types");
    expect(
      scopeLabel("paths", {
        changed: 0,
        metadata: [],
        paths: ["force-app/main/default/classes/Foo.cls"],
      }),
    ).toBe("force-app/main/default/classes/Foo.cls");
    expect(
      scopeLabel("paths", { changed: 0, metadata: [], paths: ["a", "b"] }),
    ).toBe("2 items");
  });
});

describe("job display helpers", () => {
  it("names and colours statuses", () => {
    expect(statusLabel("InProgress")).toBe("In progress");
    expect(statusLabel("SomethingNew")).toBe("SomethingNew");
    expect(statusTone("Succeeded")).toBe("success");
    expect(statusTone("SucceededPartial")).toBe("warning");
    expect(statusTone("Failed")).toBe("error");
    expect(statusTone("Pending")).toBe("info");
  });

  it("formats durations and percentages", () => {
    expect(formatDuration(4_200)).toBe("4s");
    expect(formatDuration(200_000)).toBe("3m 20s");
    expect(formatDuration(3_900_000)).toBe("1h 05m");
    expect(percent(3, 4)).toBe(75);
    expect(percent(5, 0)).toBe(0);
    expect(percent(12, 10)).toBe(100);
  });
});
