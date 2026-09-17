import { beforeEach, describe, expect, it, vi } from "vitest";

// The store talks to Rust through `invoke`; every test scripts the replies.
const invoke = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

// The store schedules its "Saved" → idle reset through `window.setTimeout`.
vi.stubGlobal("window", globalThis);

// Questions go through the in-app dialog service; each test scripts answers.
const confirm = vi.hoisted(() =>
  vi.fn<(options: { title: string; message?: string }) => Promise<boolean>>(),
);
const ask = vi.hoisted(() =>
  vi.fn<(options: { title: string }) => Promise<string | null>>(),
);
vi.mock("../../../components/ui/Confirm/confirm", () => ({
  ask,
  confirm,
  previewList: (items: string[]) => items,
}));

import { useWorkspaceStore, waitForWorkspaceSync } from "./workspaceStore";
import { useOrganizationStore } from "../../../store/orgStore";
import { usePreferencesStore } from "../../../store/preferencesStore";
import type { Organization } from "../../org-manager/types";
import type { Workspace, WorkspaceFile } from "../types";
import type { FileStamp, PickedFolder } from "@/types/generated";
import { findNode, getBaseName } from "../lib/workspaceUtils";

const CLASSES = "force-app/main/default/classes";
const PATH = `${CLASSES}/Foo.cls`;
const META = `${PATH}-meta.xml`;

const STAMP: FileStamp = { modified: 1_000, size: 2 };
const NEWER: FileStamp = { modified: 2_000, size: 6 };

const fileNode = (path: string): WorkspaceFile => ({
  path,
  name: getBaseName(path),
  type: "file",
});
const folderNode = (
  path: string,
  children?: WorkspaceFile[],
): WorkspaceFile => ({
  path,
  name: getBaseName(path),
  type: "folder",
  children,
  hasChildren: true,
});

/** What `read_workspace` returns for a file. */
const listed = (path: string) => ({
  name: getBaseName(path),
  path,
  nodeType: "file",
  hasChildren: false,
});

/** A deferred promise, so a test can act while a save is still in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** An open tab whose content has been loaded from disk. */
function openLoaded(content: string) {
  useWorkspaceStore.setState({
    openFiles: [PATH],
    selectedFile: PATH,
    fileContents: { [PATH]: content },
    savedContents: { [PATH]: content },
    fileStamps: { [PATH]: STAMP },
    loadingContent: {},
    loadErrors: {},
    dirty: {},
  });
}

const writes = () =>
  invoke.mock.calls.filter(([command]) => command === "write_workspace_file");

beforeEach(async () => {
  // A switch started by the previous test must not leak into this one.
  await waitForWorkspaceSync();
  invoke.mockReset();
  confirm.mockReset();
  confirm.mockResolvedValue(true);
  ask.mockReset();
  useOrganizationStore.setState({
    selectedOrganization: null,
    organizations: [],
  });
  useWorkspaceStore.setState({
    openWorkspaceId: null,
    activeWorkspaceId: null,
    workspaces: [],
    loaded: false,
    deploying: false,
    files: [],
    loadedFolders: new Set(),
    loadingFolders: new Set(),
    openFiles: [],
    selectedFile: null,
    fileContents: {},
    savedContents: {},
    loadingContent: {},
    loadErrors: {},
    dirty: {},
    fileStamps: {},
    diskConflicts: {},
    clipboard: null,
    expandedFolders: new Set(),
    explorerSelection: { paths: [], anchor: null, focus: null, focusIndex: 0 },
    logs: [],
    saveStatus: "idle",
  });
});

describe("saveFile", () => {
  it("keeps keystrokes typed during a save dirty", async () => {
    openLoaded("v1");
    useWorkspaceStore.getState().updateFileContent(PATH, "v1 edited");

    const write = deferred<FileStamp>();
    invoke.mockImplementation((command: string) =>
      command === "write_workspace_file" ? write.promise : undefined,
    );

    const saving = useWorkspaceStore.getState().saveFile(PATH);
    // The user keeps typing while the write is still in flight.
    useWorkspaceStore.getState().updateFileContent(PATH, "v1 edited again");
    write.resolve(NEWER);
    await saving;

    const state = useWorkspaceStore.getState();
    expect(state.savedContents[PATH]).toBe("v1 edited");
    expect(state.fileContents[PATH]).toBe("v1 edited again");
    expect(state.dirty[PATH]).toBe(true);
  });

  it("marks the file clean when the buffer still matches what was written", async () => {
    openLoaded("v1");
    useWorkspaceStore.getState().updateFileContent(PATH, "v2");
    invoke.mockResolvedValue(NEWER);

    await expect(useWorkspaceStore.getState().saveFile(PATH)).resolves.toBe(
      true,
    );

    const state = useWorkspaceStore.getState();
    expect(state.dirty[PATH]).toBeUndefined();
    expect(state.savedContents[PATH]).toBe("v2");
    // The next save is checked against what this one wrote.
    expect(state.fileStamps[PATH]).toEqual(NEWER);
  });

  it("sends the stamp the file was read with, so a change on disk is caught", async () => {
    openLoaded("v1");
    useWorkspaceStore.getState().updateFileContent(PATH, "v2");
    invoke.mockResolvedValue(NEWER);

    await useWorkspaceStore.getState().saveFile(PATH);

    expect(writes()[0][1]).toMatchObject({ path: PATH, expected: STAMP });
  });
});

describe("a file that changed on disk", () => {
  /** Writes fail as "changed on disk" unless forced; reads return `disk`. */
  function diskChanged(disk: string) {
    invoke.mockImplementation(
      async (command: string, args: { expected?: FileStamp | null }) => {
        if (command === "write_workspace_file") {
          if (args.expected) {
            // What Rust rejects with.
            throw {
              kind: "changedOnDisk",
              message: "'Foo.cls' changed on disk after it was opened.",
            };
          }
          return NEWER;
        }
        if (command === "read_workspace_file") {
          return { content: disk, stamp: NEWER };
        }
        return undefined;
      },
    );
  }

  it("is only overwritten once the user says so", async () => {
    openLoaded("v1");
    useWorkspaceStore.getState().updateFileContent(PATH, "mine");
    diskChanged("theirs");
    ask.mockResolvedValue("overwrite");

    await expect(useWorkspaceStore.getState().saveFile(PATH)).resolves.toBe(
      true,
    );

    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Foo.cls changed on disk" }),
    );
    expect(writes()).toHaveLength(2);
    expect(writes()[1][1]).toMatchObject({ content: "mine", expected: null });
    const state = useWorkspaceStore.getState();
    expect(state.dirty[PATH]).toBeUndefined();
    expect(state.fileStamps[PATH]).toEqual(NEWER);
  });

  it("can be reloaded instead, dropping the unsaved edits", async () => {
    openLoaded("v1");
    useWorkspaceStore.getState().updateFileContent(PATH, "mine");
    diskChanged("theirs");
    ask.mockResolvedValue("reload");

    await expect(useWorkspaceStore.getState().saveFile(PATH)).resolves.toBe(
      false,
    );

    const state = useWorkspaceStore.getState();
    expect(writes()).toHaveLength(1);
    expect(state.fileContents[PATH]).toBe("theirs");
    expect(state.savedContents[PATH]).toBe("theirs");
    expect(state.dirty[PATH]).toBeUndefined();
  });

  it("keeps the edits, and writes nothing, when the question is dismissed", async () => {
    openLoaded("v1");
    useWorkspaceStore.getState().updateFileContent(PATH, "mine");
    diskChanged("theirs");
    ask.mockResolvedValue(null);

    await expect(useWorkspaceStore.getState().saveFile(PATH)).resolves.toBe(
      false,
    );

    const state = useWorkspaceStore.getState();
    expect(writes()).toHaveLength(1);
    expect(state.fileContents[PATH]).toBe("mine");
    expect(state.dirty[PATH]).toBe(true);
  });
});

describe("changes reported by the file watcher", () => {
  const event = (paths: string[], workspaceId: string | null = "ws") => ({
    workspaceId,
    paths,
    overflow: false,
  });

  beforeEach(() => {
    useWorkspaceStore.setState({ loaded: true, openWorkspaceId: "ws" });
  });

  it("reloads an open file that has no unsaved edits", async () => {
    openLoaded("v1");
    invoke.mockImplementation(async (command: string) =>
      command === "read_workspace_file"
        ? { content: "v2", stamp: NEWER }
        : undefined,
    );

    await useWorkspaceStore.getState().handleFsEvent(event([PATH]));

    const state = useWorkspaceStore.getState();
    expect(state.fileContents[PATH]).toBe("v2");
    expect(state.savedContents[PATH]).toBe("v2");
    expect(state.fileStamps[PATH]).toEqual(NEWER);
    expect(state.diskConflicts[PATH]).toBeUndefined();
  });

  it("flags a conflict instead of replacing unsaved edits", async () => {
    openLoaded("v1");
    useWorkspaceStore.getState().updateFileContent(PATH, "mine");
    invoke.mockImplementation(async (command: string) =>
      command === "read_workspace_file"
        ? { content: "theirs", stamp: NEWER }
        : undefined,
    );

    await useWorkspaceStore.getState().handleFsEvent(event([PATH]));

    const state = useWorkspaceStore.getState();
    expect(state.fileContents[PATH]).toBe("mine");
    expect(state.diskConflicts[PATH]).toBe(true);
    // The stamp stays the one the edits were based on: saving still asks.
    expect(state.fileStamps[PATH]).toEqual(STAMP);
  });

  it("ignores changes in a workspace that is no longer open", async () => {
    openLoaded("v1");
    await useWorkspaceStore
      .getState()
      .handleFsEvent(event([PATH], "another-workspace"));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("re-reads a changed folder, keeping what is loaded beneath it", async () => {
    const MAIN = "force-app/main";
    useWorkspaceStore.setState({
      files: [
        folderNode("force-app", [
          folderNode(MAIN, [fileNode(`${MAIN}/x.cls`)]),
        ]),
      ],
    });
    invoke.mockImplementation(
      async (command: string, args: { path: string }) =>
        command === "read_workspace" && args.path === "force-app"
          ? [
              {
                name: "main",
                path: MAIN,
                nodeType: "folder",
                hasChildren: true,
              },
              listed("force-app/new.cls"),
            ]
          : undefined,
    );

    await useWorkspaceStore
      .getState()
      .handleFsEvent(event(["force-app/new.cls"]));

    const { files } = useWorkspaceStore.getState();
    expect(findNode(files, "force-app/new.cls")).not.toBeNull();
    // `main` was listed again without contents; the loaded ones are kept.
    expect(findNode(files, `${MAIN}/x.cls`)).not.toBeNull();
  });
});

describe("explorer file operations", () => {
  const BAR = `${CLASSES}/Bar.cls`;
  const ARCHIVE = `${CLASSES}/archive`;

  beforeEach(() => {
    useWorkspaceStore.setState({
      loaded: true,
      openWorkspaceId: "ws",
      files: [
        folderNode(CLASSES, [
          folderNode(ARCHIVE, []),
          fileNode(PATH),
          fileNode(META),
        ]),
      ],
      expandedFolders: new Set([CLASSES]),
      explorerSelection: {
        paths: [PATH],
        anchor: PATH,
        focus: PATH,
        focusIndex: 2,
      },
    });
  });

  /** A backend that renames Foo.cls to Bar.cls, whose file declares `declared`. */
  function renameBackend(declared: string | null, renamedUses = 0) {
    invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "apex_declared_name":
          return declared;
        case "rename_workspace_item":
          return {
            changes: [
              { from: PATH, to: BAR },
              { from: META, to: `${BAR}-meta.xml` },
            ],
            renamedUses,
          };
        case "read_workspace_file":
          return { content: "public class Bar {}", stamp: NEWER };
        case "write_workspace_file":
          return NEWER;
        default:
          return undefined;
      }
    });
  }
  const renameCall = () =>
    invoke.mock.calls.find(([command]) => command === "rename_workspace_item");

  it("renames a class with its metadata, and the open tab follows", async () => {
    openLoaded("v1");
    useWorkspaceStore.getState().updateFileContent(PATH, "unsaved");
    renameBackend(null);

    await useWorkspaceStore.getState().renameItem(PATH, "Bar.cls");

    const state = useWorkspaceStore.getState();
    expect(state.openFiles).toEqual([BAR]);
    expect(state.selectedFile).toBe(BAR);
    expect(state.fileContents[BAR]).toBe("unsaved");
    expect(state.dirty[BAR]).toBe(true);
    expect(state.fileStamps[BAR]).toEqual(STAMP);
    expect(findNode(state.files, BAR)?.name).toBe("Bar.cls");
    expect(findNode(state.files, `${BAR}-meta.xml`)).not.toBeNull();
    expect(findNode(state.files, PATH)).toBeNull();
    expect(state.explorerSelection.paths).toEqual([BAR]);
    // The file declares no class named Foo, so nothing was asked.
    expect(ask).not.toHaveBeenCalled();
    expect(renameCall()?.[1]).toMatchObject({ renameInFile: false });
  });

  it("asks before renaming the class inside, and renames both when told to", async () => {
    openLoaded("public class Foo {}");
    renameBackend("Foo", 1);
    ask.mockResolvedValue("both");

    await useWorkspaceStore.getState().renameItem(PATH, "Bar.cls");

    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Rename the class inside Foo.cls too?",
      }),
    );
    expect(renameCall()?.[1]).toMatchObject({
      newName: "Bar.cls",
      renameInFile: true,
    });
    // The open tab shows the renamed class without a reload.
    expect(useWorkspaceStore.getState().fileContents[BAR]).toBe(
      "public class Bar {}",
    );
  });

  it("saves unsaved edits first, so the rename works on what is on screen", async () => {
    openLoaded("public class Foo {}");
    useWorkspaceStore
      .getState()
      .updateFileContent(PATH, "public class Foo { Integer x; }");
    renameBackend("Foo", 1);
    ask.mockResolvedValue("both");

    await useWorkspaceStore.getState().renameItem(PATH, "Bar.cls");

    const order = invoke.mock.calls.map(([command]) => command);
    expect(order.indexOf("write_workspace_file")).toBeLessThan(
      order.indexOf("rename_workspace_item"),
    );
    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        actions: expect.arrayContaining([
          expect.objectContaining({ label: "Save and rename both" }),
        ]),
      }),
    );
  });

  it("renames only the file when told to, and nothing when cancelled", async () => {
    renameBackend("Foo");
    ask.mockResolvedValueOnce("file");
    await useWorkspaceStore.getState().renameItem(PATH, "Bar.cls");
    expect(renameCall()?.[1]).toMatchObject({ renameInFile: false });

    invoke.mockClear();
    ask.mockResolvedValueOnce(null);
    await expect(
      useWorkspaceStore.getState().renameItem(PATH, "Bar.cls"),
    ).resolves.toBeNull();
    expect(renameCall()).toBeUndefined();
  });

  it("does not ask about a change of letter case, which deploys as it is", async () => {
    renameBackend("Foo");
    await useWorkspaceStore.getState().renameItem(PATH, "FOO.cls");
    expect(ask).not.toHaveBeenCalled();
  });

  it("forgets the tabs, buffers and selection of deleted files", async () => {
    openLoaded("v1");
    invoke.mockResolvedValue([PATH, META]);

    await expect(
      useWorkspaceStore.getState().deleteItems([PATH]),
    ).resolves.toBe(true);

    const state = useWorkspaceStore.getState();
    expect(invoke).toHaveBeenCalledWith(
      "delete_workspace_items",
      expect.objectContaining({ itemPaths: [PATH] }),
    );
    expect(state.openFiles).toEqual([]);
    expect(state.selectedFile).toBeNull();
    expect(state.fileContents[PATH]).toBeUndefined();
    expect(state.fileStamps[PATH]).toBeUndefined();
    expect(findNode(state.files, META)).toBeNull();
    expect(state.explorerSelection.paths).toEqual([]);
  });

  it("moves files into a folder, opening it and selecting them there", async () => {
    openLoaded("v1");
    invoke.mockImplementation(async (command: string) => {
      if (command === "move_workspace_items") {
        return [
          { from: PATH, to: `${ARCHIVE}/Foo.cls` },
          { from: META, to: `${ARCHIVE}/Foo.cls-meta.xml` },
        ];
      }
      if (command === "read_workspace") {
        return [
          listed(`${ARCHIVE}/Foo.cls`),
          listed(`${ARCHIVE}/Foo.cls-meta.xml`),
        ];
      }
      return undefined;
    });

    await useWorkspaceStore.getState().moveItems([PATH], ARCHIVE);

    const state = useWorkspaceStore.getState();
    expect(state.selectedFile).toBe(`${ARCHIVE}/Foo.cls`);
    expect(state.expandedFolders.has(ARCHIVE)).toBe(true);
    expect(state.explorerSelection.paths).toEqual([`${ARCHIVE}/Foo.cls`]);
    expect(findNode(state.files, PATH)).toBeNull();
    expect(findNode(state.files, `${ARCHIVE}/Foo.cls-meta.xml`)).not.toBeNull();
  });

  it("uses up a cut when it is pasted, but keeps a copy", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "move_workspace_items") {
        return [{ from: PATH, to: `${ARCHIVE}/Foo.cls` }];
      }
      if (command === "copy_workspace_items") {
        return { created: [`${ARCHIVE}/FooCopy.cls`], renamedIn: [] };
      }
      if (command === "read_workspace") return [];
      return undefined;
    });
    const store = useWorkspaceStore.getState();

    store.setClipboard({ mode: "copy", paths: [PATH] });
    await expect(store.pasteInto(ARCHIVE)).resolves.toEqual({
      copied: [`${ARCHIVE}/FooCopy.cls`],
      moved: [],
    });
    expect(useWorkspaceStore.getState().clipboard?.mode).toBe("copy");

    store.setClipboard({ mode: "cut", paths: [PATH] });
    const result = await store.pasteInto(ARCHIVE);
    expect(result?.moved).toHaveLength(1);
    expect(useWorkspaceStore.getState().clipboard).toBeNull();
  });

  it("keeps a clipboard entry pointing at a renamed file", async () => {
    renameBackend(null);
    useWorkspaceStore.getState().setClipboard({ mode: "cut", paths: [PATH] });

    await useWorkspaceStore.getState().renameItem(PATH, "Bar.cls");

    expect(useWorkspaceStore.getState().clipboard?.paths).toEqual([BAR]);
  });

  it("says when a copied class was renamed inside to match its file", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "copy_workspace_items") {
        return {
          created: [
            `${CLASSES}/FooCopy.cls`,
            `${CLASSES}/FooCopy.cls-meta.xml`,
          ],
          renamedIn: [`${CLASSES}/FooCopy.cls`],
        };
      }
      return command === "read_workspace" ? [] : undefined;
    });

    await useWorkspaceStore.getState().copyItems([PATH], CLASSES);

    const texts = useWorkspaceStore.getState().logs.map((entry) => entry.text);
    expect(texts).toContain(
      `Renamed FooCopy inside ${CLASSES}/FooCopy.cls, to match its file name`,
    );
  });
});

describe("closeFiles", () => {
  it("saves or drops unsaved edits as asked, and keeps a tab whose save failed", async () => {
    const OTHER = `${CLASSES}/Other.cls`;
    useWorkspaceStore.setState({
      openFiles: [PATH, OTHER],
      fileContents: { [PATH]: "edited", [OTHER]: "clean" },
      savedContents: { [PATH]: "v1", [OTHER]: "clean" },
      dirty: { [PATH]: true },
    });
    ask.mockResolvedValue("save");
    invoke.mockRejectedValue(new Error("The disk is full."));

    await useWorkspaceStore.getState().closeFiles([PATH, OTHER]);

    expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Save changes to Foo.cls?" }),
    );
    expect(useWorkspaceStore.getState().openFiles).toEqual([PATH]);
  });
});

describe("editor positions", () => {
  it("opens a file and asks the editor to show a match in it", async () => {
    invoke.mockResolvedValue({ content: "a\nAccount acc;", stamp: STAMP });

    await useWorkspaceStore
      .getState()
      .openFileAt(PATH, { line: 2, column: 9, length: 3, focus: false });

    const state = useWorkspaceStore.getState();
    expect(state.selectedFile).toBe(PATH);
    expect(state.editorReveal).toMatchObject({
      path: PATH,
      line: 2,
      column: 9,
      length: 3,
      focus: false,
    });

    const first = state.editorReveal!.seq;
    await state.openFileAt(PATH);
    expect(useWorkspaceStore.getState().editorReveal).toMatchObject({
      line: null,
      focus: true,
      seq: first + 1,
    });
  });
});

describe("closeFile", () => {
  it("discards a dirty buffer the user chose not to save", () => {
    openLoaded("v1");
    useWorkspaceStore.getState().updateFileContent(PATH, "unsaved");

    useWorkspaceStore.getState().closeFile(PATH);

    const state = useWorkspaceStore.getState();
    expect(state.openFiles).toEqual([]);
    expect(state.dirty[PATH]).toBeUndefined();
    expect(state.fileContents[PATH]).toBeUndefined();
    expect(state.savedContents[PATH]).toBeUndefined();
  });
});

describe("unreadable files", () => {
  it("never saves a file whose content could not be read", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "read_workspace_file") {
        throw new Error("Not a text file (binary content).");
      }
      return PATH;
    });

    await useWorkspaceStore.getState().selectFile(PATH);
    expect(useWorkspaceStore.getState().loadErrors[PATH]).toContain("binary");

    // Typing into the (hidden) buffer and saving must not touch the disk.
    useWorkspaceStore.getState().updateFileContent(PATH, "oops");
    const saved = await useWorkspaceStore.getState().saveFile(PATH);

    expect(saved).toBe(false);
    expect(writes()).toHaveLength(0);
    expect(useWorkspaceStore.getState().dirty[PATH]).toBeUndefined();
  });

  it("retries the read when the file is selected again", async () => {
    invoke
      .mockRejectedValueOnce(new Error("The file is locked."))
      .mockResolvedValueOnce({ content: "public class Foo {}", stamp: STAMP });

    await useWorkspaceStore.getState().selectFile(PATH);
    expect(useWorkspaceStore.getState().loadErrors[PATH]).toBeDefined();

    await useWorkspaceStore.getState().selectFile(PATH);
    const state = useWorkspaceStore.getState();
    expect(state.loadErrors[PATH]).toBeUndefined();
    expect(state.fileContents[PATH]).toBe("public class Foo {}");
  });
});

/* ── Org ↔ workspace integrity ─────────────────────────────────── */

const orgNamed = (
  alias: string,
  orgType: Organization["orgType"] = "Sandbox",
): Organization => ({
  id: `00D-${alias}`,
  alias,
  username: `admin@${alias}.com`,
  instanceUrl: `https://${alias}.my.salesforce.com`,
  orgType,
  isDefault: false,
  status: "Connected",
});

const workspaceFor = (org: Organization): Workspace => ({
  id: `ws-${org.alias}`,
  name: org.alias,
  path: `/workspaces/${org.alias}`,
  orgId: org.id,
  lastOrgId: org.id,
  managed: true,
  lastRetrievedOrgId: null,
  createdAt: 0,
});

/**
 * A fake backend holding a workspace registry: `workspace_for_org` activates
 * the org's folder, and tree reads return nothing.
 */
function fakeRegistry(
  orgs: Organization[],
  delays: Record<string, Promise<void>> = {},
) {
  let activeId: string | null = null;
  const workspaces = orgs.map(workspaceFor);

  invoke.mockImplementation(
    async (command: string, args: Record<string, unknown>) => {
      switch (command) {
        case "workspace_for_org": {
          const entry = workspaces.find((item) => item.orgId === args.orgId)!;
          await delays[entry.orgId!];
          activeId = entry.id;
          return entry;
        }
        case "list_workspaces":
          return { version: 3, activeId, workspaces };
        case "read_workspace":
          return [];
        case "get_workspace_root":
          return `/workspaces/${String(args.workspaceId)}`;
        default:
          return undefined;
      }
    },
  );
}

describe("org switching", () => {
  it("ends on the last org picked, even while an earlier switch is in flight", async () => {
    const [a, b, c] = [orgNamed("a"), orgNamed("b"), orgNamed("c")];
    const slowA = deferred<void>();
    fakeRegistry([a, b, c], { [a.id]: slowA.promise });
    useOrganizationStore.setState({ organizations: [a, b, c] });

    const orgs = useOrganizationStore.getState();
    orgs.setSelectedOrganization(a);
    orgs.setSelectedOrganization(b);
    orgs.setSelectedOrganization(c);
    slowA.resolve();
    await waitForWorkspaceSync();

    const state = useWorkspaceStore.getState();
    expect(state.openWorkspaceId).toBe("ws-c");
    expect(useOrganizationStore.getState().selectedOrganization?.id).toBe(c.id);
  });

  it("drops a file read that finishes after a different workspace opened", async () => {
    const [a, b] = [orgNamed("a"), orgNamed("b")];
    fakeRegistry([a, b]);
    useOrganizationStore.setState({ organizations: [a, b] });
    useOrganizationStore.getState().setSelectedOrganization(a);
    await waitForWorkspaceSync();

    // A read of org A's file is still in flight when org B is picked.
    const read = deferred<{ content: string; stamp: FileStamp }>();
    const backend = invoke.getMockImplementation()!;
    invoke.mockImplementation(
      (command: string, args: Record<string, unknown>) =>
        command === "read_workspace_file"
          ? read.promise
          : backend(command, args),
    );
    const reading = useWorkspaceStore.getState().selectFile(PATH);

    useOrganizationStore.getState().setSelectedOrganization(b);
    await waitForWorkspaceSync();
    read.resolve({ content: "org A's source", stamp: STAMP });
    await reading;

    const state = useWorkspaceStore.getState();
    expect(state.openWorkspaceId).toBe("ws-b");
    expect(state.fileContents[PATH]).toBeUndefined();
    expect(state.savedContents[PATH]).toBeUndefined();
  });

  it("names the open workspace on every file request", async () => {
    const a = orgNamed("a");
    fakeRegistry([a]);
    useOrganizationStore.setState({ organizations: [a] });
    useOrganizationStore.getState().setSelectedOrganization(a);
    await waitForWorkspaceSync();

    await useWorkspaceStore.getState().selectFile(PATH);

    const readCall = invoke.mock.calls.find(
      ([command]) => command === "read_workspace_file",
    );
    expect(readCall?.[1]).toMatchObject({ path: PATH, workspaceId: "ws-a" });
  });

  it("puts the selection back when discarding unsaved edits is declined", async () => {
    const [a, b] = [orgNamed("a"), orgNamed("b")];
    fakeRegistry([a, b]);
    useOrganizationStore.setState({ organizations: [a, b] });
    useOrganizationStore.getState().setSelectedOrganization(a);
    await waitForWorkspaceSync();

    useWorkspaceStore.setState({ dirty: { [PATH]: true } });
    confirm.mockResolvedValue(false);
    useOrganizationStore.getState().setSelectedOrganization(b);
    await waitForWorkspaceSync();

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Discard unsaved changes in 1 file?" }),
    );
    expect(useWorkspaceStore.getState().openWorkspaceId).toBe("ws-a");
    expect(useOrganizationStore.getState().selectedOrganization?.id).toBe(a.id);
  });
});

describe("opening a folder", () => {
  const PICKED: Workspace = {
    id: "ws-picked",
    name: "picked",
    path: "C:/repos/picked",
    orgId: null,
    lastOrgId: null,
    lastRetrievedOrgId: null,
    managed: false,
    createdAt: 0,
  };

  /** A backend whose folder picker returns `folder`, and which registers it. */
  function pickerReturns(folder: PickedFolder | null) {
    invoke.mockImplementation(async (command: string) => {
      switch (command) {
        case "pick_workspace_folder":
          return folder;
        case "add_workspace":
          return PICKED;
        case "list_workspaces":
          return { version: 3, activeId: PICKED.id, workspaces: [PICKED] };
        case "read_workspace":
          return [];
        case "get_workspace_root":
          return PICKED.path;
        default:
          return undefined;
      }
    });
  }

  const folder = (isSalesforceProject: boolean): PickedFolder => ({
    path: PICKED.path,
    name: PICKED.name,
    isSalesforceProject,
  });
  const addCall = () =>
    invoke.mock.calls.find(([command]) => command === "add_workspace");

  it("asks before adding a project file to a folder without one", async () => {
    pickerReturns(folder(false));
    confirm.mockResolvedValue(false);

    await useWorkspaceStore.getState().addWorkspace();

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Make picked a Salesforce project?" }),
    );
    expect(addCall()).toBeUndefined();
  });

  it("adds the project file once the user agrees", async () => {
    pickerReturns(folder(false));

    await useWorkspaceStore.getState().addWorkspace();

    expect(addCall()?.[1]).toEqual({
      path: PICKED.path,
      orgId: null,
      createProject: true,
      // No org selected, so the new project falls back to the API version
      // preference — and to the shipped default when that is unset too —
      // rather than asking an org for its own.
      label: null,
      fallbackApiVersion: null,
    });
  });

  it("sends the API version preference for a project it creates", async () => {
    // The preference used to be written, persisted and read by nothing, so a
    // new project silently took whatever version this build shipped with.
    usePreferencesStore.setState({ defaultApiVersion: "63.0" });
    pickerReturns(folder(false));
    confirm.mockResolvedValue(true);

    await useWorkspaceStore.getState().addWorkspace();

    expect(addCall()?.[1]).toMatchObject({ fallbackApiVersion: "63.0" });
    usePreferencesStore.setState({ defaultApiVersion: "" });
    expect(useWorkspaceStore.getState().openWorkspaceId).toBe(PICKED.id);
  });

  it("opens a Salesforce project without asking or writing anything", async () => {
    pickerReturns(folder(true));

    await useWorkspaceStore.getState().addWorkspace();

    expect(confirm).not.toHaveBeenCalled();
    expect(addCall()?.[1]).toMatchObject({ createProject: false });
  });

  it("does nothing when the picker is cancelled", async () => {
    pickerReturns(null);

    await useWorkspaceStore.getState().addWorkspace();

    expect(confirm).not.toHaveBeenCalled();
    expect(addCall()).toBeUndefined();
  });
});

describe("deploy guards", () => {
  it("asks before deploying one org's workspace to another org", async () => {
    const uat = orgNamed("uat");
    const prod = orgNamed("prod", "Production");
    useOrganizationStore.setState({
      organizations: [uat, prod],
      selectedOrganization: prod,
    });
    // Selecting prod queues a switch; let it settle (it fails against the
    // empty backend) before arranging the mismatched workspace.
    await waitForWorkspaceSync();
    useWorkspaceStore.setState({
      workspaces: [workspaceFor(uat)],
      openWorkspaceId: "ws-uat",
    });
    confirm.mockResolvedValue(false);

    await useWorkspaceStore.getState().deployPathsAction([PATH]);

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("belongs to uat"),
      }),
    );
    expect(
      invoke.mock.calls.some(([command]) => command === "deploy_start"),
    ).toBe(false);
  });

  it("asks again for a production org, and stops when declined", async () => {
    const prod = orgNamed("prod", "Production");
    useOrganizationStore.setState({
      organizations: [prod],
      selectedOrganization: prod,
    });
    await waitForWorkspaceSync();
    useWorkspaceStore.setState({
      workspaces: [workspaceFor(prod)],
      openWorkspaceId: "ws-prod",
    });
    confirm.mockResolvedValue(false);

    await useWorkspaceStore.getState().deployPathsAction([PATH]);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Deploy Foo.cls on a production org?" }),
    );
    expect(
      invoke.mock.calls.some(([command]) => command === "deploy_start"),
    ).toBe(false);
  });

  it("refuses a whole-workspace deploy with no org instead of passing an empty username", async () => {
    await useWorkspaceStore.getState().runDeploy("", false);
    expect(
      invoke.mock.calls.some(([command]) => command === "deploy_start"),
    ).toBe(false);
  });
});

describe("terminal", () => {
  it("does not run an org-changing command whose target it cannot identify when declined", async () => {
    confirm.mockResolvedValue(false);

    await useWorkspaceStore
      .getState()
      .runTerminalCommand("sf data delete record --target-org nowhere");

    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: "Run anyway" }),
    );
    expect(
      invoke.mock.calls.some(([command]) => command === "run_terminal_command"),
    ).toBe(false);
    expect(useWorkspaceStore.getState().logs.at(-1)?.text).toBe("Cancelled.");
  });

  const texts = () =>
    useWorkspaceStore
      .getState()
      .logs.map((entry) => `${entry.kind}: ${entry.text}`);

  /** Starts `sf org list`; resolves once the command is running. */
  async function startOrgList() {
    useWorkspaceStore.setState({ terminalRun: null, terminalHistory: [] });
    invoke.mockResolvedValue(undefined);
    await useWorkspaceStore.getState().runTerminalCommand("sf org list");
    const call = invoke.mock.calls
      .filter(([command]) => command === "run_terminal_command")
      .at(-1);
    return call?.[1] as { args: string[]; runId: string };
  }

  it("shows output as it streams in, and how the command ended", async () => {
    const { args, runId } = await startOrgList();
    expect(args).toEqual(["org", "list"]);
    expect(useWorkspaceStore.getState().terminalRun?.runId).toBe(runId);

    const store = useWorkspaceStore.getState();
    store.handleTerminalEvent({
      runId,
      chunks: [{ stream: "stdout", text: "ALIAS  USERNAME" }],
      exit: null,
    });
    // Output from some other run is not this terminal's.
    store.handleTerminalEvent({
      runId: "someone-else",
      chunks: [{ stream: "stdout", text: "stray" }],
      exit: null,
    });
    store.handleTerminalEvent({
      runId,
      chunks: [{ stream: "stderr", text: "Warning: 1 org expired" }],
      exit: { code: 0, cancelled: false, timedOut: false, truncated: false },
    });

    expect(texts().slice(-4)).toEqual([
      "cmd: $ sf org list",
      "info: ALIAS  USERNAME",
      "warning: Warning: 1 org expired",
      "success: Command finished.",
    ]);
    expect(useWorkspaceStore.getState().terminalRun).toBeNull();
  });

  it("reports a failure with its exit code, and a cancel as cancelled", async () => {
    const first = await startOrgList();
    useWorkspaceStore.getState().handleTerminalEvent({
      runId: first.runId,
      chunks: [],
      exit: { code: 2, cancelled: false, timedOut: false, truncated: false },
    });
    expect(texts().at(-1)).toBe("error: The command failed (exit code 2).");

    const second = await startOrgList();
    useWorkspaceStore.getState().cancelTerminalCommand();
    expect(invoke).toHaveBeenCalledWith("cancel_sf_command", {
      runId: second.runId,
    });
    useWorkspaceStore.getState().handleTerminalEvent({
      runId: second.runId,
      chunks: [],
      exit: { code: null, cancelled: true, timedOut: false, truncated: false },
    });
    expect(texts().slice(-2)).toEqual([
      "warning: Cancelling…",
      "warning: Cancelled.",
    ]);
  });

  it("runs one command at a time", async () => {
    await startOrgList();
    await useWorkspaceStore.getState().runTerminalCommand("sf org display");

    expect(
      invoke.mock.calls.filter(
        ([command]) => command === "run_terminal_command",
      ),
    ).toHaveLength(1);
    expect(texts().at(-1)).toMatch(/still running/);
  });

  it("says why a command could not start, and is ready for the next", async () => {
    useWorkspaceStore.setState({ terminalRun: null });
    invoke.mockRejectedValue(
      new Error("The Salesforce CLI (sf) was not found."),
    );

    await useWorkspaceStore.getState().runTerminalCommand("sf org list");

    expect(texts().at(-1)).toBe(
      "error: The Salesforce CLI (sf) was not found.",
    );
    expect(useWorkspaceStore.getState().terminalRun).toBeNull();
  });

  it("remembers lines for ↑/↓, the newest last and without repeats", async () => {
    useWorkspaceStore.setState({ terminalHistory: [] });
    invoke.mockResolvedValue(undefined);
    const store = useWorkspaceStore.getState();

    for (const line of ["sf org list", "sf org display", "sf org list"]) {
      await store.runTerminalCommand(line);
      useWorkspaceStore.setState({ terminalRun: null });
    }

    expect(useWorkspaceStore.getState().terminalHistory).toEqual([
      "sf org display",
      "sf org list",
    ]);
  });
});

describe("typing", () => {
  it("replaces the unsaved-changes map only when a file turns dirty or clean", () => {
    openLoaded("v1");
    const store = useWorkspaceStore.getState();

    store.updateFileContent(PATH, "v1 a");
    const dirtyMap = useWorkspaceStore.getState().dirty;
    store.updateFileContent(PATH, "v1 ab");
    store.updateFileContent(PATH, "v1 abc");
    // Same object: nothing that shows unsaved dots renders for these keystrokes.
    expect(useWorkspaceStore.getState().dirty).toBe(dirtyMap);
    expect(useWorkspaceStore.getState().fileContents[PATH]).toBe("v1 abc");

    store.updateFileContent(PATH, "v1");
    expect(useWorkspaceStore.getState().dirty).not.toBe(dirtyMap);
    expect(useWorkspaceStore.getState().dirty[PATH]).toBeUndefined();
  });
});
