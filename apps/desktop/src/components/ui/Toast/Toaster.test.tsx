// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Toaster from "./Toaster";
import { toast, useToastStore } from "./toast";

beforeEach(() => {
  vi.useFakeTimers();
  useToastStore.setState({ toasts: [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Toaster", () => {
  it("shows a notice and removes it when its time is up", () => {
    render(<Toaster />);
    act(() => {
      toast.success("Logged out of acme.", { durationMs: 1000 });
    });

    expect(screen.getByRole("status").textContent).toContain(
      "Logged out of acme.",
    );
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("announces an error as an alert, with its title", () => {
    render(<Toaster />);
    act(() => {
      toast.error("Disk is full.", { title: "A setting was not saved" });
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("A setting was not saved");
    expect(alert.textContent).toContain("Disk is full.");
  });

  it("holds a notice open while the pointer is over it", () => {
    render(<Toaster />);
    act(() => {
      toast.info("Validation succeeded", { durationMs: 1000 });
    });

    fireEvent.mouseEnter(screen.getByRole("status"));
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByRole("status")).toBeTruthy();

    fireEvent.mouseLeave(screen.getByRole("status"));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("closes from its dismiss button", () => {
    render(<Toaster />);
    act(() => {
      toast.warning("Partly succeeded", { durationMs: null });
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("replaces a repeated notice instead of stacking copies", () => {
    render(<Toaster />);
    act(() => {
      toast.error("Could not save the org list: locked");
      toast.error("Could not save the org list: locked");
    });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("runs a notice's action, then closes it", () => {
    render(<Toaster />);
    const onClick = vi.fn();
    act(() => {
      toast.error("The session expired.", {
        durationMs: null,
        action: { label: "Re-authenticate", onClick },
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "Re-authenticate" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps only the newest four", () => {
    render(<Toaster />);
    act(() => {
      for (let index = 1; index <= 6; index += 1) toast.info(`Notice ${index}`);
    });

    const shown = screen.getAllByRole("status").map((item) => item.textContent);
    expect(shown).toHaveLength(4);
    expect(shown[0]).toContain("Notice 3");
    expect(shown[3]).toContain("Notice 6");
  });
});
