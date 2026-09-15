import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));
vi.stubGlobal("window", globalThis);

import { SEARCH_DEBOUNCE_MS, useSearchStore } from "./searchStore";
import { useWorkspaceStore } from "./workspaceStore";
import type { SearchResults } from "@/types/generated";

const results = (path: string): SearchResults => ({
  files: [
    {
      path,
      matches: [
        {
          line: 1,
          column: 8,
          length: 7,
          preview: "public Account a;",
          previewStart: 7,
          previewLength: 7,
        },
      ],
    },
  ],
  matchCount: 1,
  filesSearched: 3,
  limitHit: false,
  cancelled: false,
  durationMs: 4,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const searches = () =>
  invoke.mock.calls.filter(([command]) => command === "search_workspace");

beforeEach(() => {
  invoke.mockReset();
  // Like the real `invoke`, every call returns a promise.
  invoke.mockResolvedValue(undefined);
  useWorkspaceStore.setState({ openWorkspaceId: "ws-a", activeView: "search" });
  useSearchStore.setState({
    query: "",
    matchCase: false,
    wholeWord: false,
    regex: false,
    include: "",
    exclude: "",
    results: null,
    error: null,
    searching: false,
    collapsed: new Set(),
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("search", () => {
  it("waits for typing to pause, then searches once with every option", async () => {
    vi.useFakeTimers();
    invoke.mockResolvedValue(results("a.cls"));
    const store = useSearchStore.getState();

    store.setQuery("Acc");
    store.setQuery("Account");
    store.setOptions({ matchCase: true, include: "*.cls" });
    expect(searches()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    expect(searches()).toHaveLength(1);
    expect(searches()[0][1]).toEqual({
      request: {
        query: "Account",
        matchCase: true,
        wholeWord: false,
        regex: false,
        include: "*.cls",
        exclude: "",
      },
      workspaceId: "ws-a",
    });
    expect(useSearchStore.getState().results?.matchCount).toBe(1);
  });

  it("ignores an older search that finishes after a newer one", async () => {
    const slow = deferred<SearchResults>();
    invoke
      .mockImplementationOnce(() => slow.promise)
      .mockResolvedValueOnce(results("new.cls"));
    const store = useSearchStore.getState();

    useSearchStore.setState({ query: "old" });
    const first = store.run();
    useSearchStore.setState({ query: "new" });
    await store.run();
    slow.resolve(results("old.cls"));
    await first;

    expect(useSearchStore.getState().results?.files[0].path).toBe("new.cls");
    expect(useSearchStore.getState().searching).toBe(false);
  });

  it("shows why a search could not run", async () => {
    invoke.mockRejectedValue(
      new Error("Invalid regular expression: unclosed group"),
    );
    useSearchStore.setState({ query: "(", regex: true });

    await useSearchStore.getState().run();

    const state = useSearchStore.getState();
    expect(state.error).toBe("Invalid regular expression: unclosed group");
    expect(state.results).toBeNull();
  });

  it("stops the running search when the query is cleared", async () => {
    useSearchStore.setState({ query: "Account", results: results("a.cls") });

    useSearchStore.getState().clear();

    expect(invoke).toHaveBeenCalledWith("cancel_workspace_search");
    expect(useSearchStore.getState().results).toBeNull();
  });

  it("folds and unfolds files", () => {
    useSearchStore.setState({ results: results("a.cls") });
    const store = useSearchStore.getState();

    store.toggleFile("a.cls");
    expect(useSearchStore.getState().collapsed.has("a.cls")).toBe(true);
    store.setAllCollapsed(false);
    expect(useSearchStore.getState().collapsed.size).toBe(0);
    store.setAllCollapsed(true);
    expect([...useSearchStore.getState().collapsed]).toEqual(["a.cls"]);
  });

  it("drops results from another workspace, and searches the new one", async () => {
    invoke.mockResolvedValue(results("b.cls"));
    useSearchStore.setState({ query: "Account", results: results("a.cls") });

    useWorkspaceStore.setState({ openWorkspaceId: "ws-b" });
    await vi.waitFor(() =>
      expect(useSearchStore.getState().results?.files[0].path).toBe("b.cls"),
    );
    expect(searches().at(-1)?.[1]).toMatchObject({ workspaceId: "ws-b" });
  });
});
