import { describe, expect, it } from "vitest";

import {
  needsExplicitMembers,
  wildcardCaveat,
  withChildTypes,
  type CatalogType,
} from "./typeCatalog";
import type { MetadataType } from "../types";

const type = (
  xmlName: string,
  overrides: Partial<MetadataType> = {},
): MetadataType => ({
  xmlName,
  directoryName: xmlName.toLowerCase(),
  suffix: null,
  inFolder: false,
  metaFile: false,
  childXmlNames: [],
  ...overrides,
});

describe("withChildTypes", () => {
  it("adds child types under their parent", () => {
    const catalog = withChildTypes([
      type("CustomObject", {
        directoryName: "objects",
        childXmlNames: ["CustomField", "ValidationRule"],
      }),
    ]);

    const field = catalog.find((item) => item.xmlName === "CustomField");
    expect(field?.parent).toBe("CustomObject");
    expect(field?.directoryName).toBe("objects");
    expect(catalog.map((item) => item.xmlName)).toEqual([
      "CustomField",
      "CustomObject",
      "ValidationRule",
    ]);
  });

  it("keeps a type that is also listed at the top level as-is", () => {
    const catalog = withChildTypes([
      type("Workflow", { childXmlNames: ["WorkflowRule"] }),
      type("WorkflowRule", { suffix: "rule" }),
    ]);
    expect(
      catalog.filter((item) => item.xmlName === "WorkflowRule"),
    ).toHaveLength(1);
    expect(
      catalog.find((item) => item.xmlName === "WorkflowRule")?.parent,
    ).toBeUndefined();
  });

  it("tolerates types without childXmlNames", () => {
    const bare = { ...type("ApexClass") } as Partial<MetadataType>;
    delete bare.childXmlNames;
    expect(withChildTypes([bare as MetadataType])).toHaveLength(1);
  });
});

describe("needsExplicitMembers", () => {
  it("is true for folder and child types only", () => {
    const report: CatalogType = type("Report", { inFolder: true });
    const field: CatalogType = {
      ...type("CustomField"),
      parent: "CustomObject",
    };
    expect(needsExplicitMembers(report)).toBe(true);
    expect(needsExplicitMembers(field)).toBe(true);
    expect(needsExplicitMembers(type("ApexClass"))).toBe(false);
    expect(needsExplicitMembers(undefined)).toBe(false);
  });
});

describe("wildcardCaveat", () => {
  it("explains that a CustomObject wildcard skips standard objects", () => {
    expect(wildcardCaveat("CustomObject")).toContain("standard");
    expect(wildcardCaveat("ApexClass")).toBeNull();
  });
});
