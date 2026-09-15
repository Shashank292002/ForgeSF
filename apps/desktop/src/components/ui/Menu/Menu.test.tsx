// @vitest-environment jsdom
import { StrictMode, useRef, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Menu, MenuItem, MenuSeparator } from "./Menu";

afterEach(cleanup);

function Harness({
  onSelect = () => {},
  withAnchor = false,
}: {
  onSelect?: (name: string) => void;
  withAnchor?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        Actions
      </button>
      <button type="button">Elsewhere</button>
      {open && (
        <Menu
          label="Item actions"
          at={withAnchor ? undefined : { x: 40, y: 40 }}
          anchorRef={withAnchor ? anchorRef : undefined}
          onClose={() => setOpen(false)}
        >
          <MenuItem onSelect={() => onSelect("Deploy")}>Deploy</MenuItem>
          <MenuItem onSelect={() => onSelect("Retrieve")} disabled>
            Retrieve
          </MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => onSelect("Rename")}>Rename…</MenuItem>
          <MenuItem onSelect={() => onSelect("Delete")}>Delete</MenuItem>
        </Menu>
      )}
    </>
  );
}

function openMenu() {
  const trigger = screen.getByRole("button", { name: "Actions" });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole("menu", { name: "Item actions" });
}

const focused = () => document.activeElement?.textContent;

describe("Menu", () => {
  it("focuses the first item when it opens", () => {
    render(<Harness />);
    openMenu();
    expect(focused()).toBe("Deploy");
  });

  it("moves with the arrow keys, Home and End, skipping disabled items", () => {
    render(<Harness />);
    const menu = openMenu();

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(focused()).toBe("Rename…");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(focused()).toBe("Delete");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(focused()).toBe("Deploy");
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(focused()).toBe("Delete");
    fireEvent.keyDown(menu, { key: "Home" });
    expect(focused()).toBe("Deploy");
    fireEvent.keyDown(menu, { key: "End" });
    expect(focused()).toBe("Delete");
  });

  it("jumps to the next item starting with a typed letter", () => {
    render(<Harness />);
    const menu = openMenu();

    fireEvent.keyDown(menu, { key: "r" });
    expect(focused()).toBe("Rename…");
    fireEvent.keyDown(menu, { key: "d" });
    expect(focused()).toBe("Delete");
  });

  it("closes after an item is chosen, then runs it", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: "Rename…" }));

    expect(onSelect).toHaveBeenCalledWith("Rename");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and hands focus back", () => {
    render(<Harness />);
    const menu = openMenu();

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe("Actions");
  });

  it("hands focus back under StrictMode too, where effects run twice", () => {
    // The app renders in StrictMode. The second run of the mount effect found
    // focus already on the first item and remembered that as where to return,
    // so Escape dropped focus on the page instead of the explorer tree.
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    const menu = openMenu();

    fireEvent.keyDown(menu, { key: "Escape" });

    expect(screen.queryByRole("menu")).toBeNull();
    expect(focused()).toBe("Actions");
  });

  it("closes on a click outside it", () => {
    render(<Harness />);
    openMenu();

    fireEvent.mouseDown(screen.getByRole("button", { name: "Elsewhere" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("lets its own trigger toggle it shut instead of reopening it", () => {
    render(<Harness withAnchor />);
    openMenu();
    const trigger = screen.getByRole("button", { name: "Actions" });

    fireEvent.mouseDown(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens above its trigger in viewport coordinates, so no parent clips it", () => {
    function Dropdown() {
      const anchorRef = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <>
          <button ref={anchorRef} type="button" onClick={() => setOpen(true)}>
            Workspace
          </button>
          {open && (
            <Menu
              label="Workspaces"
              anchorRef={anchorRef}
              placement="above"
              onClose={() => setOpen(false)}
            >
              <MenuItem onSelect={() => {}}>AgentOrg</MenuItem>
            </Menu>
          )}
        </>
      );
    }
    render(<Dropdown />);
    const trigger = screen.getByRole("button", { name: "Workspace" });
    // jsdom has no layout: the trigger sits at the bottom, the menu is 120px tall.
    trigger.getBoundingClientRect = () =>
      ({
        top: 700,
        left: 90,
        bottom: 724,
        right: 190,
        width: 100,
        height: 24,
      }) as DOMRect;
    vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue(
      {
        top: 0,
        left: 0,
        bottom: 120,
        right: 300,
        width: 300,
        height: 120,
      } as DOMRect,
    );

    fireEvent.click(trigger);

    const menu = screen.getByRole("menu");
    expect(menu.style.top).toBe(`${700 - 120 - 4}px`);
    expect(menu.style.left).toBe("90px");
    vi.restoreAllMocks();
  });
});
