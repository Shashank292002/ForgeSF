import { describe, expect, it } from "vitest";

import { hasFormatter, languageForPath, languageLabel } from "./editorLanguage";

describe("languageForPath", () => {
  it.each([
    ["force-app/main/default/classes/Foo.cls", "apex"],
    ["Foo.trigger", "apex"],
    ["Foo.cls-meta.xml", "xml"],
    ["package.json", "json"],
    ["script.ts", "typescript"],
    ["component.html", "html"],
    ["README.md", "markdown"],
    ["notes.txt", "plaintext"],
  ])("maps %s to %s", (path, expected) => {
    expect(languageForPath(path)).toBe(expected);
  });
});

describe("formatting and labels", () => {
  it("only offers Format where the editor has a formatter", () => {
    expect(hasFormatter(languageForPath("lwc/list/list.js"))).toBe(true);
    expect(hasFormatter(languageForPath("lwc/list/list.html"))).toBe(true);
    expect(hasFormatter(languageForPath("classes/Foo.cls"))).toBe(false);
    expect(hasFormatter(languageForPath("classes/Foo.cls-meta.xml"))).toBe(
      false,
    );
    expect(hasFormatter(languageForPath("notes.txt"))).toBe(false);
  });

  it("names languages for people", () => {
    expect(languageLabel("apex")).toBe("Apex");
    expect(languageLabel("plaintext")).toBe("Plain Text");
    expect(languageLabel("somethingNew")).toBe("somethingNew");
  });
});
