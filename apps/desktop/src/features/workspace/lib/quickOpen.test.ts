import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));

import { parseFileQuery, quickItems, quickMode } from "./quickOpen";
import type { WorkspaceCommand } from "./workspaceCommands";

const FILES = [
  "force-app/main/default/classes/AccountService.cls",
  "force-app/main/default/classes/OrderService.cls",
  "force-app/main/default/lwc/accountList/accountList.js",
  "sfdx-project.json",
];

const command = (
  id: string,
  category: string,
  title: string,
  when?: () => boolean,
): WorkspaceCommand => ({ id, category, title, when, run: () => {} });

const COMMANDS = [
  command("file.save", "File", "Save"),
  command("file.saveAll", "File", "Save All"),
  command("sf.deploy", "Salesforce", "Deploy Active File", () => false),
  command("view.toggleTerminal", "View", "Toggle Terminal"),
];

const base = {
  files: FILES,
  filesError: null,
  openFiles: [] as string[],
  activeFile: null as string | null,
  commands: COMMANDS,
};

describe("quick open", () => {
  it("picks the mode from the first character", () => {
    expect(quickMode("acc")).toBe("files");
    expect(quickMode(">save")).toBe("commands");
    expect(quickMode(":12")).toBe("line");
  });

  it("reads a line and column after a file name", () => {
    expect(parseFileQuery("Account.cls:12")).toEqual({
      query: "Account.cls",
      line: 12,
      column: 1,
    });
    expect(parseFileQuery("acc:3:9")).toEqual({
      query: "acc",
      line: 3,
      column: 9,
    });
    expect(parseFileQuery("acc")).toEqual({
      query: "acc",
      line: null,
      column: 1,
    });
  });

  it("lists the best file matches, and the open files before typing", () => {
    const found = quickItems({ ...base, text: "ordserv" });
    expect(found[0]).toMatchObject({
      kind: "file",
      path: "force-app/main/default/classes/OrderService.cls",
    });

    const recent = quickItems({
      ...base,
      text: "",
      activeFile: FILES[1],
      openFiles: [FILES[0], FILES[1]],
    });
    expect(
      recent.map((item) => (item.kind === "file" ? item.path : null)),
    ).toEqual([FILES[1], FILES[0]]);
  });

  it("carries a line through to the file it opens", () => {
    expect(quickItems({ ...base, text: "OrderService:40" })[0]).toMatchObject({
      kind: "file",
      path: FILES[1],
      line: 40,
    });
  });

  it("says so while files load, and when nothing matches", () => {
    expect(quickItems({ ...base, files: null, text: "acc" })).toEqual([
      { kind: "message", text: "Loading files…" },
    ]);
    expect(quickItems({ ...base, text: "zzzz" })).toEqual([
      { kind: "message", text: "No file names match." },
    ]);
  });

  it("offers only the commands that apply, best match first", () => {
    const all = quickItems({ ...base, text: ">" });
    expect(
      all.map((item) => item.kind === "command" && item.command.id),
    ).toEqual(["file.save", "file.saveAll", "view.toggleTerminal"]);

    const matched = quickItems({ ...base, text: "> term" });
    expect(matched[0]).toMatchObject({
      kind: "command",
      command: { id: "view.toggleTerminal" },
    });
    expect(quickItems({ ...base, text: ">deploy" })).toEqual([
      { kind: "message", text: "No matching commands." },
    ]);
  });

  it("goes to a line in the active file", () => {
    expect(
      quickItems({ ...base, text: ":42:7", activeFile: FILES[0] }),
    ).toEqual([{ kind: "line", line: 42, column: 7 }]);
    expect(quickItems({ ...base, text: ":42" })[0]).toMatchObject({
      kind: "message",
    });
    expect(
      quickItems({ ...base, text: ":x", activeFile: FILES[0] })[0],
    ).toMatchObject({
      kind: "message",
    });
  });
});
