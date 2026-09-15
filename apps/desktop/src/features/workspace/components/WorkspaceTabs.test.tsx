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

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));

import WorkspaceTabs from "./WorkspaceTabs";
import ConfirmHost from "../../../components/ui/Confirm/ConfirmHost";
import { useAskStore } from "../../../components/ui/Confirm/confirm";
import { useWorkspaceStore } from "../store/workspaceStore";

const A = "force-app/main/default/classes/A.cls";
const B = "force-app/main/default/classes/B.cls";
const C = "force-app/main/default/classes/C.cls";

const closeFile = vi.fn();
const saveFile = vi.fn<(path: string) => Promise<boolean>>();

beforeEach(() => {
  closeFile.mockReset();
  saveFile.mockReset();
  saveFile.mockResolvedValue(true);
  useWorkspaceStore.setState({
    openFiles: [A, B, C],
    selectedFile: A,
    dirty: { A: false },
    closeFile,
    saveFile,
    selectFile: vi.fn(async () => {}),
  });
  // jsdom has no layout; the active tab scrolls itself into view on render.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  useAskStore.setState({ queue: [] });
});

function renderTabs(dirty: Record<string, boolean>) {
  useWorkspaceStore.setState({ dirty });
  render(
    <>
      <WorkspaceTabs />
      <ConfirmHost />
    </>,
  );
}

const closeButton = (name: string) =>
  screen.getByRole("button", { name: `Close ${name}` });

describe("closing tabs", () => {
  it("closes a tab with no unsaved changes without asking", () => {
    renderTabs({});
    fireEvent.click(closeButton("A.cls"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(closeFile).toHaveBeenCalledWith(A);
  });

  it("offers to save, and closes after saving", async () => {
    renderTabs({ [A]: true });
    fireEvent.click(closeButton("A.cls"));

    expect(
      screen.getByRole("dialog", { name: "Save changes to A.cls?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(closeFile).toHaveBeenCalledWith(A));
    expect(saveFile).toHaveBeenCalledWith(A);
  });

  it("closes without saving when told not to", async () => {
    renderTabs({ [A]: true });
    fireEvent.click(closeButton("A.cls"));
    fireEvent.click(screen.getByRole("button", { name: "Don't save" }));

    await waitFor(() => expect(closeFile).toHaveBeenCalledWith(A));
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("keeps the tab when the save fails", async () => {
    saveFile.mockResolvedValue(false);
    renderTabs({ [A]: true });
    fireEvent.click(closeButton("A.cls"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(A));
    expect(closeFile).not.toHaveBeenCalled();
  });

  it("closes nothing when the question is dismissed", async () => {
    renderTabs({ [A]: true });
    fireEvent.click(closeButton("A.cls"));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(closeFile).not.toHaveBeenCalled();
  });

  it("moves between tabs with the arrow keys, and closes one with Delete", () => {
    const selectFile = vi.fn(async () => {});
    useWorkspaceStore.setState({ selectFile });
    renderTabs({});
    const tab = (name: RegExp) => screen.getByRole("tab", { name });

    // One Tab stop: only the active tab is in the tab order.
    expect(tab(/A\.cls/).tabIndex).toBe(0);
    expect(tab(/B\.cls/).tabIndex).toBe(-1);
    expect(closeButton("A.cls").tabIndex).toBe(-1);

    tab(/A\.cls/).focus();
    fireEvent.keyDown(tab(/A\.cls/), { key: "ArrowRight" });
    expect(selectFile).toHaveBeenLastCalledWith(B);
    expect(document.activeElement).toBe(tab(/B\.cls/));

    fireEvent.keyDown(tab(/A\.cls/), { key: "ArrowLeft" });
    expect(selectFile).toHaveBeenLastCalledWith(C);
    fireEvent.keyDown(tab(/C\.cls/), { key: "Home" });
    expect(selectFile).toHaveBeenLastCalledWith(A);

    fireEvent.keyDown(tab(/B\.cls/), { key: "Delete" });
    expect(closeFile).toHaveBeenCalledWith(B);
  });

  it("names unsaved tabs in words, not only with a dot", () => {
    renderTabs({ [B]: true });
    expect(
      screen.getByRole("tab", { name: "B.cls, unsaved changes" }),
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: "A.cls" })).toBeTruthy();
  });

  it("asks once for Close All, listing every unsaved file", async () => {
    renderTabs({ [A]: true, [B]: true });

    fireEvent.contextMenu(screen.getByRole("tab", { name: /C\.cls/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Close All" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Save changes to 2 files?",
    });
    expect(
      [...dialog.querySelectorAll("li")].map((li) => li.textContent),
    ).toEqual(["A.cls", "B.cls"]);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Don't save" }));
    });
    await waitFor(() => expect(closeFile).toHaveBeenCalledTimes(3));
    expect(saveFile).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
