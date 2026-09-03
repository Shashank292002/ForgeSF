import { describe, expect, it } from "vitest";
import { Cpu, Database, FileText, Table2, Zap } from "lucide-react";

import { iconForFile } from "./fileIcons";

describe("iconForFile", () => {
  it("uses the folder icon for folders regardless of name", () => {
    expect(iconForFile("classes", "folder")).not.toBe(FileText);
  });

  it("recognises Apex source", () => {
    expect(iconForFile("Foo.cls")).toBe(Cpu);
    expect(iconForFile("Foo.trigger")).toBe(Zap);
  });

  // Regression: SFDX names metadata `Thing.<suffix>-meta.xml`, so the final
  // extension is "xml" and the whole suffix map never fired. The mixed-case
  // switch arms could not match a lower-cased extension either.
  it("matches the real suffix behind a -meta.xml wrapper", () => {
    expect(iconForFile("Account.object-meta.xml")).toBe(Database);
    expect(iconForFile("Description.field-meta.xml")).toBe(Table2);
  });

  it("still resolves the Apex meta file to the Apex icon", () => {
    expect(iconForFile("Foo.cls-meta.xml")).toBe(Cpu);
  });

  it("falls back to a generic icon for unknown names", () => {
    expect(iconForFile("LICENSE")).toBe(FileText);
  });
});
