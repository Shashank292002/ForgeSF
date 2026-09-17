import { create } from "zustand";

import { errorMessage } from "@/lib/errors";
import type { SearchRequest, SearchResults } from "@/types/generated";
import {
  cancelWorkspaceSearch,
  searchWorkspace,
} from "../services/workspaceService";
import { useWorkspaceStore } from "./workspaceStore";

/**
 * Find in files: the query, its options and the last results.
 *
 * Kept in a store rather than the Search view, so switching to the explorer
 * and back keeps both the query and what it found.
 */

export interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Comma-separated globs, e.g. `*.cls, lwc`. */
  include: string;
  exclude: string;
}

interface SearchState extends SearchOptions {
  query: string;
  /** Whether the include/exclude fields are shown. */
  showFilters: boolean;
  searching: boolean;
  results: SearchResults | null;
  /** Why the search could not run: a bad pattern, an unreadable workspace. */
  error: string | null;
  /** Files whose matches are folded away. */
  collapsed: Set<string>;

  /** Changes the query; the search runs once typing pauses. */
  setQuery: (query: string) => void;
  setOptions: (options: Partial<SearchOptions>) => void;
  toggleFilters: () => void;
  /** Searches now. */
  run: () => Promise<void>;
  clear: () => void;
  toggleFile: (path: string) => void;
  setAllCollapsed: (collapsed: boolean) => void;
}

/** Typing pauses this long before a search starts. */
export const SEARCH_DEBOUNCE_MS = 300;

let timer: ReturnType<typeof setTimeout> | undefined;
/** Numbers each search, so a slow one cannot overwrite a newer one's results. */
let latest = 0;

export const useSearchStore = create<SearchState>((set, get) => {
  /** Runs the search once typing pauses, or clears the results for no query. */
  function schedule() {
    clearTimeout(timer);
    if (!get().query) {
      latest += 1;
      void cancelWorkspaceSearch().catch(() => {});
      set({ results: null, error: null, searching: false });
      return;
    }
    timer = setTimeout(() => void get().run(), SEARCH_DEBOUNCE_MS);
  }

  return {
    query: "",
    matchCase: false,
    wholeWord: false,
    regex: false,
    include: "",
    exclude: "",
    showFilters: false,
    searching: false,
    results: null,
    error: null,
    collapsed: new Set<string>(),

    setQuery: (query) => {
      set({ query });
      schedule();
    },

    setOptions: (options) => {
      set(options);
      schedule();
    },

    toggleFilters: () => set((state) => ({ showFilters: !state.showFilters })),

    run: async () => {
      clearTimeout(timer);
      const { query, matchCase, wholeWord, regex, include, exclude } = get();
      if (!query) {
        schedule();
        return;
      }

      const request: SearchRequest = {
        query,
        matchCase,
        wholeWord,
        regex,
        include,
        exclude,
      };
      const id = ++latest;
      set({ searching: true, error: null });
      try {
        const results = await searchWorkspace(
          request,
          useWorkspaceStore.getState().openWorkspaceId,
        );
        if (id !== latest) return;
        set({ results, searching: false, collapsed: new Set<string>() });
      } catch (error) {
        if (id !== latest) return;
        set({ error: errorMessage(error), results: null, searching: false });
      }
    },

    clear: () => {
      set({ query: "" });
      schedule();
    },

    toggleFile: (path) =>
      set((state) => {
        const collapsed = new Set(state.collapsed);
        if (collapsed.has(path)) collapsed.delete(path);
        else collapsed.add(path);
        return { collapsed };
      }),

    setAllCollapsed: (collapsed) =>
      set((state) => ({
        collapsed: collapsed
          ? new Set(state.results?.files.map((file) => file.path) ?? [])
          : new Set<string>(),
      })),
  };
});

// Results name files in the workspace that was open; another one's paths
// would open the wrong files. The query stays: it runs again when the Search
// view is next on screen, or now if it is.
useWorkspaceStore.subscribe((state, previous) => {
  if (state.openWorkspaceId === previous.openWorkspaceId) return;
  latest += 1;
  useSearchStore.setState({ results: null, error: null, searching: false });
  if (useSearchStore.getState().query && state.activeView === "search") {
    void useSearchStore.getState().run();
  }
});
