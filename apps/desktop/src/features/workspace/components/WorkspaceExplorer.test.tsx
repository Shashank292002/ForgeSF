// @vitest-environment jsdom
import { Profiler } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
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

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));

import WorkspaceExplorer from "./WorkspaceExplorer";
import ConfirmHost from "../../../components/ui/Confirm/ConfirmHost";
import { useAskStore } from "../../../components/ui/Confirm/confirm";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useOrganizationStore } from "../../../store/orgStore";
import type { Organization } from "../../org-manager/types";
import type { WorkspaceFile } from "../types";
import type { PathChange } from "@/types/generated";

const BAR = "force-app/Bar.cls";
const FOO = "force-app/Foo.cls";
const FOO_META = "force-app/Foo.cls-meta.xml";

const file = (path: string): WorkspaceFile => ({
  path,
  name: path.split("/").pop()!,
  type: "file",
});

const TREE: WorkspaceFile[] = [
  {
    path: "force-app",
    name: "force-app",
    type: "folder",
    hasChildren: true,
    children: [file(BAR), file(FOO), file(FOO_META)],
  },
  file("README.md"),
];

const ORG: Organization = {
  id: "00D1",
  alias: "dev",
  username: "admin@dev.com",
  instanceUrl: "https://dev.my.salesforce.com",
  orgType: "Sandbox",
  isDefault: false,
  status: "Connected",
};

const selectFile = vi.fn<(path: string) => Promise<void>>(async () => {});
const deleteItems = vi.fn<(paths: string[]) => Promise<boolean>>(
  async () => true,
);
const withCompanions = vi.fn(async (paths: string[]) => paths);
const renameItem = vi.fn<
  (path: string, name: string) => Promise<PathChange[] | null>
>(async () => []);
const deployPathsAction = vi.fn<(paths: string[]) => Promise<void>>(
  async () => {},
);

// jsdom does no layout. The virtualised tree renders rows only for a
// scroll area with a height, and scrolls rows into view with scrollTo.
const offsetHeight = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "offsetHeight",
);
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => 600,
  });
  Element.prototype.scrollTo = vi.fn();
});
afterAll(() => {
  if (offsetHeight) {
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", offsetHeight);
  }
});

beforeEach(() => {
  for (const mock of [
    selectFile,
    deleteItems,
    withCompanions,
    renameItem,
    deployPathsAction,
  ]) {
    mock.mockClear();
  }
  useOrganizationStore.setState({
    selectedOrganization: ORG,
    organizations: [ORG],
  });
  useWorkspaceStore.setState({
    loaded: true,
    files: TREE,
    workspaceName: "dev",
    workspaceRoot: "C:\\Work\\dev",
    selectedFile: null,
    openFiles: [],
    dirty: {},
    packageDirectories: ["force-app"],
    clipboard: null,
    expandedFolders: new Set(["force-app"]),
    explorerSelection: { paths: [], anchor: null, focus: null, focusIndex: 0 },
    loadingFolders: new Set(),
    deploying: false,
    selectFile,
    deleteItems,
    withCompanions,
    renameItem,
    deployPathsAction,
    loadFolder: vi.fn(async () => {}),
    loadFullTree: vi.fn(async () => {}),
  });
});

afterEach(() => {
  cleanup();
  useAskStore.setState({ queue: [] });
});

function renderExplorer() {
  render(
    <MemoryRouter>
      <WorkspaceExplorer />
      <ConfirmHost />
    </MemoryRouter>,
  );
  const tree = screen.getByRole("tree");
  act(() => tree.focus());
  return tree;
}

const row = (name: string) => screen.getByRole("treeitem", { name });
const selectedNames = () =>
  screen
    .getAllByRole("treeitem")
    .filter((item) => item.getAttribute("aria-selected") === "true")
    .map((item) => item.getAttribute("aria-label"));
const press = (tree: HTMLElement, key: string, init: object = {}) =>
  fireEvent.keyDown(tree, { key, ...init });

describe("keyboard navigation", () => {
  it("moves the selection with the arrow keys and opens a file with Enter", () => {
    const tree = renderExplorer();

    press(tree, "ArrowDown");
    expect(selectedNames()).toEqual(["Bar.cls"]);
    expect(tree.getAttribute("aria-activedescendant")).toBe(row("Bar.cls").id);

    press(tree, "ArrowDown");
    press(tree, "Enter");
    expect(selectedNames()).toEqual(["Foo.cls"]);
    expect(selectFile).toHaveBeenCalledWith(FOO);
  });

  it("closes and opens folders with the left and right arrows", () => {
    const tree = renderExplorer();
    press(tree, "Home");
    expect(row("force-app").getAttribute("aria-expanded")).toBe("true");

    press(tree, "ArrowLeft");
    expect(row("force-app").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("treeitem", { name: "Bar.cls" })).toBeNull();

    press(tree, "ArrowRight");
    expect(row("Bar.cls")).toBeTruthy();
    // From an open folder, right moves into it; left goes back to the folder.
    press(tree, "ArrowRight");
    expect(selectedNames()).toEqual(["Bar.cls"]);
    press(tree, "ArrowLeft");
    expect(selectedNames()).toEqual(["force-app"]);
  });

  it("extends the selection with Shift and selects everything with Ctrl+A", () => {
    const tree = renderExplorer();
    press(tree, "ArrowDown");
    press(tree, "ArrowDown", { shiftKey: true });
    press(tree, "ArrowDown", { shiftKey: true });
    expect(selectedNames()).toEqual(["Bar.cls", "Foo.cls", "Foo.cls-meta.xml"]);

    press(tree, "a", { ctrlKey: true });
    expect(selectedNames()).toHaveLength(5);
  });

  it("jumps to a row by typing its name", () => {
    const tree = renderExplorer();
    press(tree, "r");
    expect(selectedNames()).toEqual(["README.md"]);
  });
});

describe("mouse selection", () => {
  it("adds rows with Ctrl+click and selects a range with Shift+click", () => {
    renderExplorer();

    fireEvent.click(row("Bar.cls"));
    expect(selectFile).toHaveBeenCalledWith(BAR);

    fireEvent.click(row("Foo.cls-meta.xml"), { shiftKey: true });
    expect(selectedNames()).toEqual(["Bar.cls", "Foo.cls", "Foo.cls-meta.xml"]);

    fireEvent.click(row("Foo.cls"), { ctrlKey: true });
    expect(selectedNames()).toEqual(["Bar.cls", "Foo.cls-meta.xml"]);
    // Only the plain click opened anything.
    expect(selectFile).toHaveBeenCalledTimes(1);
  });
});

describe("deleting", () => {
  it("lists the companion files it will delete, and deletes only when confirmed", async () => {
    withCompanions.mockResolvedValueOnce([FOO, FOO_META]);
    const tree = renderExplorer();
    fireEvent.click(row("Foo.cls"));

    press(tree, "Delete");
    const dialog = await screen.findByRole("dialog", {
      name: "Delete Foo.cls?",
    });
    expect(
      [...dialog.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual([FOO, FOO_META]);
    expect(dialog.textContent).toMatch(/belong with it/);
    expect(deleteItems).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(deleteItems).toHaveBeenCalledWith([FOO]));
  });

  it("deletes nothing when cancelled", async () => {
    const tree = renderExplorer();
    fireEvent.click(row("Bar.cls"));
    press(tree, "Delete");

    await screen.findByRole("dialog", { name: "Delete Bar.cls?" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deleteItems).not.toHaveBeenCalled();
  });
});

describe("the context menu", () => {
  it("does not offer Deploy for files outside a package directory", () => {
    renderExplorer();
    fireEvent.contextMenu(row("README.md"));

    const deploy = screen.getByRole("menuitem", { name: "Deploy" });
    expect(deploy.hasAttribute("disabled")).toBe(true);
    expect(deploy.getAttribute("title")).toMatch(/package directory/);
    // And no inline rocket on the row either.
    expect(
      row("README.md").querySelector('button[aria-label^="Deploy"]'),
    ).toBeNull();
  });

  it("acts on the whole selection when a selected row is right-clicked", async () => {
    renderExplorer();
    fireEvent.click(row("Bar.cls"));
    fireEvent.click(row("Foo.cls"), { ctrlKey: true });

    fireEvent.contextMenu(row("Foo.cls"));
    expect(
      screen.getByRole("menu", { name: "Actions for 2 items" }),
    ).toBeTruthy();
    // Renaming and Diff Check only make sense for one item.
    expect(screen.queryByRole("menuitem", { name: /Rename/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Diff Check/ })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "Deploy 2 Items" }));
    await waitFor(() =>
      expect(deployPathsAction).toHaveBeenCalledWith([BAR, FOO]),
    );
  });

  it("opens from the keyboard with Shift+F10", () => {
    const tree = renderExplorer();
    press(tree, "ArrowDown");
    press(tree, "F10", { shiftKey: true });
    expect(
      screen.getByRole("menu", { name: "Explorer item actions" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Rename/ })).toBeTruthy();
  });
});

describe("renaming", () => {
  it("renames with F2, refusing a name another file already has", async () => {
    const tree = renderExplorer();
    press(tree, "ArrowDown");
    press(tree, "F2");

    const input = screen.getByRole("textbox", { name: "Rename Bar.cls" });
    fireEvent.change(input, { target: { value: "foo.cls" } });
    expect(screen.getByRole("alert").textContent).toMatch(
      /Foo\.cls already exists/,
    );
    fireEvent.keyDown(input, { key: "Enter" });
    expect(renameItem).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Baz.cls" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(renameItem).toHaveBeenCalledWith(BAR, "Baz.cls"),
    );
    expect(renameItem).toHaveBeenCalledTimes(1);
  });
});

describe("creating", () => {
  it("puts the new name's input in its own row instead of over an entry", () => {
    renderExplorer();
    fireEvent.click(
      screen.getByRole("button", { name: "New file in force-app" }),
    );

    expect(screen.getByRole("textbox", { name: "New file name" })).toBeTruthy();
    // Every entry is still there to see.
    for (const name of ["Bar.cls", "Foo.cls", "Foo.cls-meta.xml"]) {
      expect(row(name)).toBeTruthy();
    }
  });
});

describe("typing in the editor", () => {
  it("does not render the explorer again for each keystroke", () => {
    useWorkspaceStore.setState({
      openFiles: [FOO],
      selectedFile: FOO,
      fileContents: { [FOO]: "public class Foo {}" },
      savedContents: { [FOO]: "public class Foo {}" },
      dirty: {},
    });
    let commits = 0;
    render(
      <MemoryRouter>
        <Profiler id="explorer" onRender={() => (commits += 1)}>
          <WorkspaceExplorer />
        </Profiler>
      </MemoryRouter>,
    );

    // The first edit shows the unsaved dot: that renders, once.
    act(() =>
      useWorkspaceStore
        .getState()
        .updateFileContent(FOO, "public class Foo { }"),
    );
    expect(row("Foo.cls, unsaved changes")).toBeTruthy();
    const afterFirstEdit = commits;

    act(() => {
      for (const text of ["x", "xy", "xyz", "xyza"]) {
        useWorkspaceStore
          .getState()
          .updateFileContent(FOO, `public class Foo { ${text} }`);
      }
    });
    expect(commits).toBe(afterFirstEdit);
  });
});

describe("an empty workspace", () => {
  it("says the folder is empty rather than that no workspace is open", () => {
    useWorkspaceStore.setState({ files: [] });
    render(
      <MemoryRouter>
        <WorkspaceExplorer />
      </MemoryRouter>,
    );
    expect(screen.getByText("This folder is empty.")).toBeTruthy();
    expect(screen.queryByText(/No workspace open/)).toBeNull();
  });
});
