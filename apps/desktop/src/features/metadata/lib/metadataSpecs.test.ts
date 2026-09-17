import { describe, expect, it } from "vitest";

import {
  memberSummary,
  resolveMetadataSpecs,
  selectionCount,
} from "./metadataSpecs";

describe("resolveMetadataSpecs", () => {
  it("names every member of a type that has no wildcard", () => {
    expect(
      resolveMetadataSpecs(
        ["Report", "ApexClass"],
        {},
        {
          Report: ["Sales", "Sales/Pipeline"],
        },
      ),
    ).toEqual({
      specs: ["Report:Sales", "Report:Sales/Pipeline", "ApexClass"],
      empty: [],
    });
  });

  it("prefers the user's picks over the full list", () => {
    expect(
      resolveMetadataSpecs(
        ["CustomField"],
        { CustomField: ["Account.Tier__c"] },
        { CustomField: ["Account.Tier__c", "Account.Region__c"] },
      ).specs,
    ).toEqual(["CustomField:Account.Tier__c"]);
  });

  it("reports a no-wildcard type with no members instead of sending it", () => {
    expect(resolveMetadataSpecs(["Dashboard"], {}, { Dashboard: [] })).toEqual({
      specs: [],
      empty: ["Dashboard"],
    });
  });

  // A generated package.xml groups <types> by kind, so a kind that appeared
  // both whole and narrowed would emit `*` next to the member and send the
  // whole type — the opposite of what was picked.
  it("never sends a kind both whole and narrowed", () => {
    const { specs } = resolveMetadataSpecs(
      ["ApexClass", "ApexClass"],
      { ApexClass: ["Foo"] },
      {},
    );
    expect(specs).toEqual(["ApexClass:Foo"]);
    expect(specs).not.toContain("ApexClass");
  });
});

describe("memberSummary", () => {
  // Regression: the old signature took `Record<string, unknown>` and tested
  // `typeof value === "number"`, which was never true for the components cache
  // it was actually handed — so the "n of m" label could never render.
  it("counts against the cached component list", () => {
    expect(
      memberSummary(
        "ApexClass",
        { ApexClass: ["A", "B"] },
        {
          ApexClass: ["A", "B", "C", "D"],
        },
      ),
    ).toEqual({ label: "2 of 4", narrowed: true });
  });

  it("reports the available total when nothing is narrowed", () => {
    expect(memberSummary("Flow", {}, { Flow: ["A", "B"] })).toEqual({
      label: "all (2)",
      narrowed: false,
    });
  });

  it("falls back when the type has not been listed yet", () => {
    expect(memberSummary("Flow", {}, {})).toEqual({
      label: "all components",
      narrowed: false,
    });
  });
});

describe("selectionCount", () => {
  it("adds picked components to the totals of whole types", () => {
    expect(
      selectionCount(
        ["ApexClass", "Flow"],
        { ApexClass: ["A", "B"] },
        { ApexClass: ["A", "B", "C"], Flow: ["F1", "F2", "F3", "F4"] },
      ),
    ).toEqual({ components: 6, wholeTypes: 1, known: true });
  });

  it("says the count is partial while a whole type is unlisted", () => {
    expect(selectionCount(["Flow"], {}, {})).toEqual({
      components: 0,
      wholeTypes: 1,
      known: false,
    });
  });

  it("is exact when every type is narrowed, listed or not", () => {
    expect(
      selectionCount(["ApexClass"], { ApexClass: ["A", "B"] }, {}),
    ).toEqual({ components: 2, wholeTypes: 0, known: true });
  });
});
