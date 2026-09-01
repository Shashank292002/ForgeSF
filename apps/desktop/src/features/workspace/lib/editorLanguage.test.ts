import { describe, expect, it } from "vitest";

import { languageForPath } from "./editorLanguage";

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
