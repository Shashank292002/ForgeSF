// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ConfirmHost from "./ConfirmHost";
import { ask, confirm, previewList, prompt, useAskStore } from "./confirm";

afterEach(() => {
  cleanup();
  useAskStore.setState({ queue: [] });
});

/** Starts a question inside `act`, so the dialog has rendered on return. */
function start<T>(question: () => Promise<T>): Promise<T> {
  let pending!: Promise<T>;
  act(() => {
    pending = question();
  });
  return pending;
}

describe("confirm", () => {
  it("resolves true when confirmed, and closes", async () => {
    render(<ConfirmHost />);
    const result = start(() =>
      confirm({ title: "Mark as synced?", confirmLabel: "Mark as synced" }),
    );

    expect(
      screen.getByRole("dialog", { name: "Mark as synced?" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Mark as synced" }));

    await expect(result).resolves.toBe(true);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("resolves false from Cancel, Escape and the close button", async () => {
    render(<ConfirmHost />);

    const cancelled = start(() => confirm({ title: "One?" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(cancelled).resolves.toBe(false);

    const escaped = start(() => confirm({ title: "Two?" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await expect(escaped).resolves.toBe(false);

    const closed = start(() => confirm({ title: "Three?" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await expect(closed).resolves.toBe(false);
  });

  it("starts on Cancel for a destructive action, and on the action otherwise", () => {
    render(<ConfirmHost />);

    void start(() =>
      confirm({
        title: "Delete Foo.cls?",
        confirmLabel: "Delete",
        tone: "danger",
      }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Cancel" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    void start(() => confirm({ title: "Save first?", confirmLabel: "Save" }));
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Save" }),
    );
  });

  it("shows questions one at a time, in the order they were asked", async () => {
    render(<ConfirmHost />);
    const first = start(() => confirm({ title: "First?" }));
    const second = start(() => confirm({ title: "Second?" }));

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "First?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await expect(first).resolves.toBe(true);
    expect(screen.getByRole("dialog", { name: "Second?" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(second).resolves.toBe(false);
  });

  it("lays out paragraphs and a detail list", () => {
    render(<ConfirmHost />);
    void start(() =>
      confirm({
        title: "Discard?",
        message: "These files close.\n\nTheir edits are lost.",
        details: ["classes/A.cls", "classes/B.cls"],
      }),
    );

    const dialog = screen.getByRole("dialog");
    expect(
      [...dialog.querySelectorAll("p")].map((p) => p.textContent),
    ).toContain("Their edits are lost.");
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(
      ["classes/A.cls", "classes/B.cls"],
    );
  });
});

describe("ask", () => {
  it("resolves with the chosen action, or null when dismissed", async () => {
    render(<ConfirmHost />);
    const options = {
      title: "Save changes to Foo.cls?",
      actions: [
        {
          value: "discard" as const,
          label: "Don't save",
          variant: "secondary" as const,
        },
        { value: "save" as const, label: "Save" },
      ],
    };

    const discarded = start(() => ask(options));
    fireEvent.click(screen.getByRole("button", { name: "Don't save" }));
    await expect(discarded).resolves.toBe("discard");

    const dismissed = start(() => ask(options));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await expect(dismissed).resolves.toBeNull();
  });
});

describe("prompt", () => {
  it("resolves with the trimmed text, from the button or Enter", async () => {
    render(<ConfirmHost />);

    const typed = start(() =>
      prompt({ title: "Rename workspace", initialValue: "acme" }),
    );
    const field = screen.getByRole("textbox");
    expect(document.activeElement).toBe(field);

    fireEvent.change(field, { target: { value: "  acme uat  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await expect(typed).resolves.toBe("acme uat");

    const entered = start(() => prompt({ title: "Rename workspace" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "dev" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    await expect(entered).resolves.toBe("dev");
  });

  it("cannot be confirmed while empty, and dismisses to null", async () => {
    render(<ConfirmHost />);
    const result = start(() =>
      prompt({ title: "Rename workspace", initialValue: "acme" }),
    );

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  " } });
    const save = screen.getByRole("button", { name: "Save" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(screen.queryByRole("dialog")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(result).resolves.toBeNull();
  });
});

describe("previewList", () => {
  it("shows the first few and counts the rest", () => {
    expect(previewList(["a", "b"], 3)).toEqual(["a", "b"]);
    expect(previewList(["a", "b", "c", "d", "e"], 3)).toEqual([
      "a",
      "b",
      "c",
      "…and 2 more",
    ]);
  });
});
