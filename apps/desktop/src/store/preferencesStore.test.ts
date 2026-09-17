import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_PREFERENCES,
  editorOptions,
  normalisePreferences,
} from "./preferencesStore";
import { isTestLevel, TEST_LEVELS } from "../lib/testLevels";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    get: async () => null,
    set: async () => {},
    save: async () => {},
  }),
}));

describe("normalisePreferences", () => {
  it("keeps what was stored", () => {
    const stored = {
      theme: "light",
      editorFontSize: 16,
      editorTabSize: 2,
      editorWordWrap: true,
      editorMinimap: true,
      sfPath: "  C:/tools/sf.cmd  ",
      defaultApiVersion: "67.0",
      defaultTestLevel: "RunLocalTests",
    };

    expect(normalisePreferences(stored)).toEqual({
      ...stored,
      sfPath: "C:/tools/sf.cmd",
    });
  });

  it("falls back to the defaults for anything missing or nonsense", () => {
    expect(normalisePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(normalisePreferences("not an object")).toEqual(DEFAULT_PREFERENCES);
    expect(normalisePreferences({})).toEqual(DEFAULT_PREFERENCES);

    // A theme this build does not know falls back rather than rendering
    // against a stylesheet that does not exist.
    expect(normalisePreferences({ theme: "solarized" }).theme).toBe("dark");
  });

  it("clamps sizes to what is readable", () => {
    expect(normalisePreferences({ editorFontSize: 200 }).editorFontSize).toBe(
      24,
    );
    expect(normalisePreferences({ editorFontSize: 1 }).editorFontSize).toBe(10);
    expect(normalisePreferences({ editorTabSize: 99 }).editorTabSize).toBe(8);
    expect(normalisePreferences({ editorFontSize: 13.6 }).editorFontSize).toBe(
      14,
    );
  });

  it("only accepts an API version that looks like one", () => {
    expect(
      normalisePreferences({ defaultApiVersion: "67.0" }).defaultApiVersion,
    ).toBe("67.0");
    expect(
      normalisePreferences({ defaultApiVersion: "v67" }).defaultApiVersion,
    ).toBe("");
    expect(
      normalisePreferences({ defaultApiVersion: "67" }).defaultApiVersion,
    ).toBe("");
    // Empty means "ask the org", which is the better default.
    expect(
      normalisePreferences({ defaultApiVersion: "" }).defaultApiVersion,
    ).toBe("");
  });

  // This preference was written, persisted and never read: the deploy form
  // hard-coded "Org default" whatever Settings said. Now that it is wired up,
  // only a level the form and the CLI accept may come out of here.
  it("only accepts a test level the deploy form offers", () => {
    for (const level of TEST_LEVELS) {
      expect(
        normalisePreferences({ defaultTestLevel: level.value })
          .defaultTestLevel,
      ).toBe(level.value);
    }

    // "" is a real choice — it means "let the org decide" — not a missing one.
    expect(
      normalisePreferences({ defaultTestLevel: "" }).defaultTestLevel,
    ).toBe("");

    // A level from a newer build, or a hand-edited file, would be refused by
    // the CLI. It falls back rather than failing every deploy.
    expect(
      normalisePreferences({ defaultTestLevel: "RunEverything" })
        .defaultTestLevel,
    ).toBe(DEFAULT_PREFERENCES.defaultTestLevel);
    expect(normalisePreferences({ defaultTestLevel: 7 }).defaultTestLevel).toBe(
      DEFAULT_PREFERENCES.defaultTestLevel,
    );
  });

  // The form seeds itself from the preference and then sends that level on
  // the deploy, so a level Settings cannot express could never be deployed.
  it("can express every level the deploy form accepts", () => {
    const offered = TEST_LEVELS.map((level) => level.value);
    for (const level of offered) {
      expect(isTestLevel(level)).toBe(true);
    }
    expect(offered).toContain("");
    expect(offered).toContain("RunRelevantTests");
  });
});

describe("editorOptions", () => {
  it("translates preferences into what Monaco takes", () => {
    expect(
      editorOptions({
        ...DEFAULT_PREFERENCES,
        editorFontSize: 15,
        editorTabSize: 2,
        editorWordWrap: true,
        editorMinimap: true,
      }),
    ).toEqual({
      fontSize: 15,
      tabSize: 2,
      wordWrap: "on",
      minimap: { enabled: true },
    });

    expect(editorOptions(DEFAULT_PREFERENCES).wordWrap).toBe("off");
  });
});
