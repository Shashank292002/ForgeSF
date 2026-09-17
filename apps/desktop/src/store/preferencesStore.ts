import { create } from "zustand";
import { load } from "@tauri-apps/plugin-store";

import { isTestLevel, type TestLevelValue } from "../lib/testLevels";

/**
 * The settings a person chooses once and expects to stick.
 *
 * Kept in the same plugin-store file as the org list, under its own key with
 * its own version, so a shape change here cannot disturb the orgs.
 */

const STORE_FILE = "forgesf.json";
const KEY = "preferences";
const KEY_VERSION = "preferencesVersion";
const SCHEMA_VERSION = 1;

export type ThemeChoice = "dark" | "light" | "system";

export interface Preferences {
  theme: ThemeChoice;
  /** Monaco's font size, in pixels. */
  editorFontSize: number;
  editorTabSize: number;
  editorWordWrap: boolean;
  editorMinimap: boolean;
  /**
   * Full path to the `sf` executable, when discovery cannot find it.
   * Empty means "look in the usual places".
   */
  sfPath: string;
  /**
   * API version new projects are created at, when the org cannot be asked.
   * Empty means "ask the org, then fall back to the shipped default".
   */
  defaultApiVersion: string;
  /** The test level the deploy form starts on. `""` means the org decides. */
  defaultTestLevel: TestLevelValue;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "dark",
  editorFontSize: 13,
  editorTabSize: 4,
  editorWordWrap: false,
  editorMinimap: false,
  sfPath: "",
  defaultApiVersion: "",
  // The deploy form's own default, so a fresh install behaves as it did
  // before the preference was wired up.
  defaultTestLevel: "",
};

/** Bounds Monaco is willing to render, and a person can read. */
const FONT_RANGE = { min: 10, max: 24 };
const TAB_RANGE = { min: 1, max: 8 };

function clamp(value: number, { min, max }: { min: number; max: number }) {
  return Math.min(Math.max(Math.round(value), min), max);
}

/**
 * Reads stored preferences, keeping what is valid and defaulting the rest.
 *
 * A file written by a newer build, or edited by hand, should leave the app
 * usable rather than half-configured.
 */
export function normalisePreferences(raw: unknown): Preferences {
  if (typeof raw !== "object" || raw === null)
    return { ...DEFAULT_PREFERENCES };
  const stored = raw as Partial<Preferences>;

  const theme: ThemeChoice =
    stored.theme === "light" || stored.theme === "system"
      ? stored.theme
      : "dark";

  return {
    theme,
    editorFontSize:
      typeof stored.editorFontSize === "number"
        ? clamp(stored.editorFontSize, FONT_RANGE)
        : DEFAULT_PREFERENCES.editorFontSize,
    editorTabSize:
      typeof stored.editorTabSize === "number"
        ? clamp(stored.editorTabSize, TAB_RANGE)
        : DEFAULT_PREFERENCES.editorTabSize,
    editorWordWrap: stored.editorWordWrap === true,
    editorMinimap: stored.editorMinimap === true,
    sfPath: typeof stored.sfPath === "string" ? stored.sfPath.trim() : "",
    defaultApiVersion:
      typeof stored.defaultApiVersion === "string" &&
      /^\d{2,3}\.0$/.test(stored.defaultApiVersion.trim())
        ? stored.defaultApiVersion.trim()
        : "",
    // Checked against the list the deploy form offers: a level it does not
    // accept would be sent to the CLI and refused there.
    defaultTestLevel: isTestLevel(stored.defaultTestLevel)
      ? stored.defaultTestLevel
      : DEFAULT_PREFERENCES.defaultTestLevel,
  };
}

interface PreferencesState extends Preferences {
  /** Whether the stored values have been read yet. */
  loaded: boolean;
  load: () => Promise<void>;
  set: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  reset: () => void;
}

/** The stored fields alone — the actions and `loaded` are not preferences. */
function currentPreferences(state: Preferences): Preferences {
  const picked = {} as Preferences;
  for (const key of Object.keys(DEFAULT_PREFERENCES) as (keyof Preferences)[]) {
    // Each key keeps its own type; a mapped copy would widen them all.
    (picked[key] as Preferences[typeof key]) = state[key];
  }
  return picked;
}

/** Writes are debounced: a slider should not hit the disk on every pixel. */
let writeTimer: ReturnType<typeof setTimeout> | null = null;

function persist(preferences: Preferences) {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    void (async () => {
      try {
        const store = await load(STORE_FILE);
        await store.set(KEY_VERSION, SCHEMA_VERSION);
        await store.set(KEY, preferences);
        await store.save();
      } catch {
        // A settings write that fails should not take the app down; the
        // choice stays in memory for this session.
      }
    })();
  }, 250);
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...DEFAULT_PREFERENCES,
  loaded: false,

  load: async () => {
    try {
      const store = await load(STORE_FILE);
      const raw = await store.get<unknown>(KEY);
      set({ ...normalisePreferences(raw), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  set: (key, value) => {
    set({ [key]: value } as Pick<Preferences, typeof key>);
    persist(currentPreferences(get()));
  },

  reset: () => {
    set({ ...DEFAULT_PREFERENCES });
    persist({ ...DEFAULT_PREFERENCES });
  },
}));

/** The editor options Monaco takes, from the current preferences. */
export function editorOptions(preferences: Preferences) {
  return {
    fontSize: preferences.editorFontSize,
    tabSize: preferences.editorTabSize,
    wordWrap: preferences.editorWordWrap ? ("on" as const) : ("off" as const),
    minimap: { enabled: preferences.editorMinimap },
  };
}
