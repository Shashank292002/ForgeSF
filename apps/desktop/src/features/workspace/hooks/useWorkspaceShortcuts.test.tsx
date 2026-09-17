// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useWorkspaceShortcuts } from "./useWorkspaceShortcuts";
import { useAskStore } from "../../../components/ui/Confirm/confirm";
import type { WorkspaceCommand } from "../lib/workspaceCommands";

const openQuick = vi.fn();
const save = vi.fn();
let canSave = true;

const COMMANDS: WorkspaceCommand[] = [
  {
    id: "go.file",
    category: "Go",
    title: "Go to File…",
    keys: "Ctrl+P",
    run: openQuick,
  },
  {
    id: "file.save",
    category: "File",
    title: "Save",
    keys: "Ctrl+S",
    when: () => canSave,
    run: save,
  },
];

function Harness() {
  useWorkspaceShortcuts(COMMANDS);
  return null;
}

beforeEach(() => {
  openQuick.mockClear();
  save.mockClear();
  canSave = true;
  render(<Harness />);
});

afterEach(() => {
  cleanup();
  useAskStore.setState({ queue: [] });
});

const press = (key: string, init: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent("keydown", {
    key,
    code: `Key${key.toUpperCase()}`,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  fireEvent(window, event);
  return event;
};

describe("workspace shortcuts", () => {
  it("runs the command bound to a key press, and keeps the webview's default", () => {
    const event = press("p", { ctrlKey: true });
    expect(openQuick).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("claims the key even when the command doesn't apply, so Ctrl+S never saves the page", () => {
    canSave = false;
    const event = press("s", { ctrlKey: true });
    expect(save).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves keys it doesn't bind alone", () => {
    const event = press("p");
    expect(openQuick).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does nothing while a question is waiting for an answer", () => {
    useAskStore.setState({
      queue: [
        {
          id: 1,
          options: { title: "Delete?", actions: [] },
          resolve: () => {},
        },
      ],
    });
    press("p", { ctrlKey: true });
    expect(openQuick).not.toHaveBeenCalled();
  });
});
