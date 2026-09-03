import { describe, expect, it } from "vitest";

import {
  categoryForType,
  categoriesForTypes,
  prettyMetadataKind,
} from "./categories";

describe("categoryForType", () => {
  it.each([
    ["CustomObject", "objects"],
    ["CustomField", "objects"],
    ["ApexClass", "apex"],
    ["LightningComponentBundle", "apex"],
    // Regression: this rule was spelled "auraddefinitionbundle" (double d),
    // so Aura bundles silently fell through to "other".
    ["AuraDefinitionBundle", "apex"],
    ["Flow", "automation"],
    ["PermissionSet", "access"],
    ["ConnectedApp", "integration"],
    ["FlexiPage", "ui"],
  ])("puts %s in %s", (xmlName, expected) => {
    expect(categoryForType(xmlName).key).toBe(expected);
  });

  it("falls back to 'other' for unknown types", () => {
    expect(categoryForType("ZzzUnknownThing").key).toBe("other");
  });
});

describe("categoriesForTypes", () => {
  it("counts every category, including empty ones", () => {
    const counts = categoriesForTypes([
      { xmlName: "ApexClass" },
      { xmlName: "ApexTrigger" },
      { xmlName: "CustomObject" },
    ]);
    expect(counts.apex).toBe(2);
    expect(counts.objects).toBe(1);
    expect(counts.integration).toBe(0);
  });
});

describe("prettyMetadataKind", () => {
  it("uses the curated label when there is one", () => {
    expect(prettyMetadataKind("ApexClass")).toBe("Apex Classes");
  });

  it("splits camel case and pluralises otherwise", () => {
    expect(prettyMetadataKind("SomeCustomThing")).toBe("Some Custom Things");
  });

  it("does not double-pluralise names already ending in s", () => {
    expect(prettyMetadataKind("MyThings")).toBe("My Things");
  });
});
