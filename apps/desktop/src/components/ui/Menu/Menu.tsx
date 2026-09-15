import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

/**
 * Menu behaviour for context menus and dropdowns: focus moves into the menu,
 * arrow keys, Home/End and first letters move between items, Escape and Tab
 * close it, and focus goes back to where it was.
 *
 * The explorer, tab and workspace menus each hand-rolled outside-click and
 * Escape handling and could not be used from the keyboard at all. Looks stay
 * with the caller's class names; this owns only behaviour and positioning.
 */

type CloseReason = "select" | "keyboard" | "outside";

const DismissContext = createContext<(reason: CloseReason) => void>(() => {});

const ITEMS = '[role="menuitem"]:not(:disabled)';

interface MenuProps {
  /** Accessible name, e.g. "Explorer item actions". */
  label: string;
  onClose: () => void;
  /**
   * Viewport point for a context menu, nudged to stay inside the window. Omit
   * for a dropdown positioned by its class.
   */
  at?: { x: number; y: number };
  /**
   * The control that opened the menu: pressing it is not an outside click
   * (so it can toggle the menu), and focus returns to it.
   */
  anchorRef?: RefObject<HTMLElement | null>;
  /**
   * Opens against `anchorRef`, above it (for a control at the bottom of the
   * window) or below. Placed in viewport coordinates, so a parent with
   * `overflow: hidden` cannot clip it — the status bar did, and its workspace
   * menu never showed.
   */
  placement?: "above" | "below";
  className?: string;
  children: ReactNode;
}

export function Menu({
  label,
  onClose,
  at,
  anchorRef,
  placement,
  className,
  children,
}: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const x = at?.x;
  const y = at?.y;

  const items = () =>
    Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEMS) ?? []);

  const dismiss = (reason: CloseReason) => {
    // Only a keyboard dismissal hands focus back. After choosing an item the
    // action decides where focus goes (a rename puts it in an input), and
    // after an outside click it is wherever the user clicked.
    if (reason === "keyboard") {
      (anchorRef?.current ?? previousFocus.current)?.focus?.();
    }
    onClose();
  };

  // Placed before paint, so a menu opened near an edge never flashes past it.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();

    let point: { x: number; y: number } | null = null;
    if (x !== undefined && y !== undefined) {
      point = { x, y };
    } else if (placement && anchorRef?.current) {
      const anchor = anchorRef.current.getBoundingClientRect();
      point = {
        x: anchor.left,
        y:
          placement === "above"
            ? anchor.top - rect.height - 4
            : anchor.bottom + 4,
      };
    }
    if (!point) return;

    const left = Math.min(point.x, window.innerWidth - rect.width - 8);
    const top = Math.min(point.y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }, [x, y, placement, anchorRef]);

  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    // StrictMode runs this twice in development. The second time focus is
    // already on the first item, and remembering *that* as where to return
    // lost focus entirely once the menu closed.
    if (!ref.current?.contains(active)) previousFocus.current = active;
    ref.current?.querySelector<HTMLElement>(ITEMS)?.focus();
  }, []);

  const closeFromWindow = useEffectEvent(() => onClose());
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      closeFromWindow();
    };
    const onWindowChange = () => closeFromWindow();

    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("blur", onWindowChange);
    window.addEventListener("resize", onWindowChange);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("blur", onWindowChange);
      window.removeEventListener("resize", onWindowChange);
    };
  }, [anchorRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const focusAt = (next: number) => {
      if (list.length === 0) return;
      list[(next + list.length) % list.length].focus();
    };

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusAt(index + 1);
        return;
      case "ArrowUp":
        event.preventDefault();
        focusAt(index < 0 ? -1 : index - 1);
        return;
      case "Home":
        event.preventDefault();
        focusAt(0);
        return;
      case "End":
        event.preventDefault();
        focusAt(-1);
        return;
      case "Escape":
      case "Tab":
        event.preventDefault();
        // Kept from reaching a dialog or page handler behind the menu.
        event.stopPropagation();
        dismiss("keyboard");
        return;
    }

    // A letter jumps to the next item starting with it.
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const letter = event.key.toLowerCase();
      for (let step = 1; step <= list.length; step += 1) {
        const candidate = list[(Math.max(index, 0) + step) % list.length];
        if (candidate.textContent?.trim().toLowerCase().startsWith(letter)) {
          candidate.focus();
          return;
        }
      }
    }
  };

  return (
    <DismissContext.Provider value={dismiss}>
      <div
        ref={ref}
        className={className}
        role="menu"
        aria-label={label}
        aria-orientation="vertical"
        onKeyDown={onKeyDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        {children}
      </div>
    </DismissContext.Provider>
  );
}

interface MenuItemProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onSelect" | "onClick" | "role" | "type"
> {
  /** Runs after the menu closes. */
  onSelect: () => void;
}

export function MenuItem({ onSelect, children, ...rest }: MenuItemProps) {
  const dismiss = useContext(DismissContext);
  return (
    <button
      {...rest}
      type="button"
      role="menuitem"
      tabIndex={-1}
      onClick={() => {
        dismiss("select");
        onSelect();
      }}
    >
      {children}
    </button>
  );
}

export function MenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={className} />;
}
