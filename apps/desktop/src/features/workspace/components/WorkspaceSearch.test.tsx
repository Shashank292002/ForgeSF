// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));

import WorkspaceSearch from "./WorkspaceSearch";
import { useSearchStore } from "../store/searchStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import type { SearchResults } from "@/types/generated";

const ACCOUNT = "force-app/main/default/classes/AccountService.cls";
const ORDER = "force-app/main/default/classes/OrderService.cls";

const match = (line: number, column: number, preview: string) => ({
  line,
  column,
  length: 7,
  preview,
  previewStart: preview.indexOf("Account"),
  previewLength: 7,
});

const RESULTS: SearchResults = {
  files: [
    {
      path: ACCOUNT,
      matches: [
        match(1, 14, "public class AccountService {"),
        match(3, 5, "Account a;"),
      ],
    },
    { path: ORDER, matches: [match(2, 5, "Account owner;")] },
  ],
  matchCount: 3,
  filesSearched: 12,
  limitHit: false,
  cancelled: false,
  durationMs: 5,
};

const openFileAt = vi.fn<(path: string, target?: object) => Promise<void>>(
  async () => {},
);

const offsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
beforeAll(() => {
  // jsdom has no layout; the virtualised results need a height to render.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 400,
  });
  Element.prototype.scrollTo = vi.fn();
});
afterAll(() => {
  if (offsetHeight) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
  }
});

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(RESULTS);
  openFileAt.mockClear();
  useWorkspaceStore.setState({ openFileAt, dirty: {}, openWorkspaceId: "ws" });
  useSearchStore.setState({
    query: "Account",
    matchCase: false,
    wholeWord: false,
    regex: false,
    include: "",
    exclude: "",
    showFilters: false,
    searching: false,
    results: RESULTS,
    error: null,
    collapsed: new Set(),
  });
});

afterEach(() => {
  cleanup();
});

const matchRows = () =>
  screen
    .getAllByRole("treeitem")
    .filter((row) => row.getAttribute("aria-level") === "2");

describe("find in files", () => {
  it("shows results grouped by file, with the match highlighted", () => {
    render(<WorkspaceSearch />);

    expect(screen.getByRole("status").textContent).toBe("3 results in 2 files");
    expect(matchRows()).toHaveLength(3);
    const first = matchRows()[0];
    expect(first.getAttribute("aria-label")).toBe(
      "Line 1: public class AccountService {",
    );
    expect(first.querySelector("mark")?.textContent).toBe("Account");
  });

  it("opens a match at its line and column", () => {
    render(<WorkspaceSearch />);
    fireEvent.click(matchRows()[2]);

    expect(openFileAt).toHaveBeenCalledWith(ORDER, {
      line: 2,
      column: 5,
      length: 7,
      focus: true,
    });
  });

  it("moves through results with the keyboard, folding a file away", () => {
    render(<WorkspaceSearch />);
    const tree = screen.getByRole("tree", { name: "Search results" });
    tree.focus();

    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(matchRows()).toHaveLength(1);
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(matchRows()).toHaveLength(3);

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    // Space shows the match and keeps focus in the results.
    fireEvent.keyDown(tree, { key: " " });
    expect(openFileAt).toHaveBeenCalledWith(ACCOUNT, {
      line: 3,
      column: 5,
      length: 7,
      focus: false,
    });
  });

  it("toggles an option, and searches again with it", async () => {
    vi.useFakeTimers();
    render(<WorkspaceSearch />);
    const toggle = screen.getByRole("button", { name: "Match Case" });

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await vi.advanceTimersByTimeAsync(500);
    expect(invoke).toHaveBeenCalledWith(
      "search_workspace",
      expect.objectContaining({
        request: expect.objectContaining({ query: "Account", matchCase: true }),
      }),
    );
    vi.useRealTimers();
  });

  it("explains a pattern it cannot use", () => {
    useSearchStore.setState({
      results: null,
      error: "Invalid regular expression: unclosed group",
    });
    render(<WorkspaceSearch />);
    expect(screen.getByRole("alert").textContent).toBe(
      "Invalid regular expression: unclosed group",
    );
  });

  it("says when unsaved changes are left out", () => {
    useWorkspaceStore.setState({ dirty: { [ACCOUNT]: true } });
    render(<WorkspaceSearch />);
    expect(
      screen.getByText(/A file has unsaved changes, which aren.t searched/),
    ).toBeTruthy();
  });
});
