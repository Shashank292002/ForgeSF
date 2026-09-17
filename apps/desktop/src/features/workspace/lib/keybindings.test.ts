import { describe, expect, it } from "vitest";

import { matchesKeys, parseKeys } from "./keybindings";

const press = (
  key: string,
  modifiers: Partial<{
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }> = {},
  code = "",
) => ({
  key,
  code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe("keybindings", () => {
  it("reads a shortcut", () => {
    expect(parseKeys("Ctrl+Shift+P")).toEqual({
      ctrl: true,
      shift: true,
      alt: false,
      key: "p",
    });
    expect(parseKeys("F2").key).toBe("f2");
  });

  it("matches only the exact modifiers", () => {
    expect(matchesKeys(press("p", { ctrlKey: true }), "Ctrl+P")).toBe(true);
    // Shift turns the letter upper case; it is still the same shortcut.
    expect(
      matchesKeys(
        press("P", { ctrlKey: true, shiftKey: true }),
        "Ctrl+Shift+P",
      ),
    ).toBe(true);
    expect(
      matchesKeys(press("P", { ctrlKey: true, shiftKey: true }), "Ctrl+P"),
    ).toBe(false);
    expect(matchesKeys(press("p"), "Ctrl+P")).toBe(false);
  });

  it("takes Cmd for Ctrl", () => {
    expect(matchesKeys(press("s", { metaKey: true }), "Ctrl+S")).toBe(true);
  });

  it("recognises a key by where it is when a modifier changed what it types", () => {
    expect(
      matchesKeys(
        press("~", { ctrlKey: true, shiftKey: true }, "Backquote"),
        "Ctrl+Shift+`",
      ),
    ).toBe(true);
    expect(
      matchesKeys(
        press("ç", { altKey: true, shiftKey: true }, "KeyC"),
        "Shift+Alt+C",
      ),
    ).toBe(true);
    expect(matchesKeys(press("`", { ctrlKey: true }), "Ctrl+`")).toBe(true);
  });
});
