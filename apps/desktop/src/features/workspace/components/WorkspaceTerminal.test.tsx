// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));

import WorkspaceTerminal from "./WorkspaceTerminal";
import { useWorkspaceStore } from "../store/workspaceStore";

const runTerminalCommand = vi.fn<(line: string) => Promise<void>>(
  async () => {},
);
const cancelTerminalCommand = vi.fn();

beforeEach(() => {
  runTerminalCommand.mockClear();
  cancelTerminalCommand.mockClear();
  useWorkspaceStore.setState({
    logs: [],
    terminalRun: null,
    terminalHistory: ["sf org list", "sf org display --verbose"],
    runTerminalCommand,
    cancelTerminalCommand,
  });
});

afterEach(cleanup);

const commandInput = () =>
  screen.getByRole("textbox", { name: "Terminal command" }) as HTMLInputElement;

describe("the terminal", () => {
  it("runs a line with Enter", () => {
    render(<WorkspaceTerminal />);
    fireEvent.change(commandInput(), { target: { value: "sf org list" } });
    fireEvent.keyDown(commandInput(), { key: "Enter" });

    expect(runTerminalCommand).toHaveBeenCalledWith("sf org list");
    expect(commandInput().value).toBe("");
  });

  it("recalls earlier lines with the arrow keys, then what was being typed", () => {
    render(<WorkspaceTerminal />);
    const input = commandInput();
    fireEvent.change(input, { target: { value: "sf pro" } });

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("sf org display --verbose");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("sf org list");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.value).toBe("sf org list");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.value).toBe("sf pro");
  });

  it("offers Cancel while a command runs, and stops it with Ctrl+C", () => {
    useWorkspaceStore.setState({
      terminalRun: { runId: "run-1", line: "sf project retrieve start" },
    });
    render(<WorkspaceTerminal />);

    expect(screen.getByRole("status").textContent).toBe(
      "Running sf project retrieve start",
    );
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(cancelTerminalCommand).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(commandInput(), { key: "c", ctrlKey: true });
    expect(cancelTerminalCommand).toHaveBeenCalledTimes(2);

    // A new line waits: one command at a time.
    fireEvent.change(commandInput(), { target: { value: "sf org list" } });
    fireEvent.keyDown(commandInput(), { key: "Enter" });
    expect(runTerminalCommand).not.toHaveBeenCalled();
  });

  it("copies selected text with Ctrl+C instead of cancelling", () => {
    useWorkspaceStore.setState({
      terminalRun: { runId: "run-1", line: "sf org list" },
    });
    render(<WorkspaceTerminal />);
    const input = commandInput();
    fireEvent.change(input, { target: { value: "copy me" } });
    input.setSelectionRange(0, 4);

    fireEvent.keyDown(input, { key: "c", ctrlKey: true });
    expect(cancelTerminalCommand).not.toHaveBeenCalled();
  });
});
