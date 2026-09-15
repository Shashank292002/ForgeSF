// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));

import QuickInput from "./QuickInput";
import { useWorkspaceStore } from "../store/workspaceStore";
import type { WorkspaceCommand } from "../lib/workspaceCommands";

const ORDER = "force-app/main/default/classes/OrderService.cls";
const ACCOUNT = "force-app/main/default/classes/AccountService.cls";

const openFileAt = vi.fn<
  (path: string, target?: { line: number; column?: number }) => Promise<void>
>(async () => {});
const toggleTerminal = vi.fn();
const deploy = vi.fn();

const COMMANDS: WorkspaceCommand[] = [
  {
    id: "view.toggleTerminal",
    category: "View",
    title: "Toggle Terminal",
    keys: "Ctrl+`",
    run: toggleTerminal,
  },
  {
    id: "sf.deployFile",
    category: "Salesforce",
    title: "Deploy Active File",
    when: () => false,
    run: deploy,
  },
];

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ files: [ACCOUNT, ORDER], truncated: false });
  openFileAt.mockClear();
  toggleTerminal.mockClear();
  useWorkspaceStore.setState({
    quickInput: null,
    selectedFile: null,
    openFiles: [],
    openWorkspaceId: "ws",
    openFileAt,
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

function openWith(text: string) {
  render(<QuickInput commands={COMMANDS} />);
  act(() => useWorkspaceStore.getState().openQuickInput(text));
  return screen.getByRole("combobox");
}

const type = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });

describe("Quick Open", () => {
  it("finds a file by part of its name and opens it with Enter", async () => {
    const input = openWith("");
    expect(screen.getByRole("dialog", { name: "Go to file" })).toBeTruthy();

    type(input, "ordserv");
    const option = await screen.findByRole("option", { name: /OrderService/ });
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(input.getAttribute("aria-activedescendant")).toBe(option.id);

    fireEvent.keyDown(input, { key: "Enter" });
    expect(openFileAt).toHaveBeenCalledWith(ORDER, undefined);
    expect(useWorkspaceStore.getState().quickInput).toBeNull();
  });

  it("opens a file at the line typed after its name", async () => {
    const input = openWith("");
    type(input, "account:12");
    await screen.findByRole("option", { name: /AccountService/ });

    fireEvent.keyDown(input, { key: "Enter" });
    expect(openFileAt).toHaveBeenCalledWith(ACCOUNT, { line: 12, column: 1 });
  });

  it("goes to a line in the active file", () => {
    useWorkspaceStore.setState({ selectedFile: ACCOUNT });
    const input = openWith(":");
    type(input, ":40");

    expect(screen.getByRole("option", { name: /Go to line 40/ })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(openFileAt).toHaveBeenCalledWith(ACCOUNT, { line: 40, column: 1 });
  });

  it("closes on Escape and on a click outside it", () => {
    openWith("");
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(useWorkspaceStore.getState().quickInput).toBeNull();

    act(() => useWorkspaceStore.getState().openQuickInput(""));
    const backdrop = screen.getByRole("dialog").parentElement!;
    fireEvent.mouseDown(backdrop);
    expect(useWorkspaceStore.getState().quickInput).toBeNull();
  });
});

describe("the command palette", () => {
  it("lists the commands that apply, with their shortcuts, and runs one", () => {
    const input = openWith(">");
    expect(
      screen.getByRole("dialog", { name: "Command palette" }),
    ).toBeTruthy();

    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.getAttribute("aria-label"))).toEqual([
      "View: Toggle Terminal, Ctrl+`",
    ]);

    type(input, ">term");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(toggleTerminal).toHaveBeenCalledTimes(1);
    expect(deploy).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().quickInput).toBeNull();
  });

  it("switches to files when the > is deleted", async () => {
    const input = openWith(">");
    type(input, "order");
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: "Go to file" })).toBeTruthy(),
    );
    expect(
      await screen.findByRole("option", { name: /OrderService/ }),
    ).toBeTruthy();
  });
});
