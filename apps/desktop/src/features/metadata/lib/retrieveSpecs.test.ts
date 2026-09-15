import { describe, expect, it } from "vitest";

import {
  buildRetrieveSpecs,
  memberSummary,
  resolveRetrieveSpecs,
} from "./retrieveSpecs";

describe("resolveRetrieveSpecs", () => {
  it("names every member of a type that has no wildcard", () => {
    expect(
      resolveRetrieveSpecs(
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
      resolveRetrieveSpecs(
        ["CustomField"],
        { CustomField: ["Account.Tier__c"] },
        { CustomField: ["Account.Tier__c", "Account.Region__c"] },
      ).specs,
    ).toEqual(["CustomField:Account.Tier__c"]);
  });

  it("reports a no-wildcard type with no members instead of sending it", () => {
    expect(resolveRetrieveSpecs(["Dashboard"], {}, { Dashboard: [] })).toEqual({
      specs: [],
      empty: ["Dashboard"],
    });
  });
});

describe("buildRetrieveSpecs", () => {
  it("uses the bare type when no components are picked", () => {
    expect(buildRetrieveSpecs(["ApexClass"], {})).toEqual(["ApexClass"]);
  });

  it("emits one Kind:Member entry per picked component", () => {
    expect(
      buildRetrieveSpecs(["ApexClass"], { ApexClass: ["Foo", "Bar"] }),
    ).toEqual(["ApexClass:Foo", "ApexClass:Bar"]);
  });

  it("mixes narrowed and whole types in one batch", () => {
    expect(
      buildRetrieveSpecs(["ApexClass", "Flow"], { ApexClass: ["Foo"] }),
    ).toEqual(["ApexClass:Foo", "Flow"]);
  });

  it("treats an empty member list as 'all components'", () => {
    expect(buildRetrieveSpecs(["Flow"], { Flow: [] })).toEqual(["Flow"]);
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
