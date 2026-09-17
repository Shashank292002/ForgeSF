import { useEffect, useEffectEvent, useState } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Modal dialog behaviour: focus moves in, stays in, and returns on close.
 *
 * The overlays previously had no dialog semantics at all — Tab walked straight
 * out into the page behind them, and a screen reader announced nothing to say
 * the rest of the app was inert.
 *
 * Returns a callback ref to spread onto the dialog container.
 *
 * The effect is keyed on the container node only. It used to depend on
 * `onClose`, and callers pass inline arrows, so every re-render — each
 * keystroke in the retrieve overlay's search box — tore the trap down and
 * rebuilt it, yanking focus to the first control mid-typing. `onClose` is read
 * through an effect event instead, and a callback ref (rather than a
 * `useRef`) lets the trap attach when the container mounts after the first
 * render.
 */
export function useDialog(onClose: () => void) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const close = useEffectEvent(onClose);

  useEffect(() => {
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Focus the control marked `data-autofocus`, else the first control, else
    // the container itself. Confirmations mark theirs: the first control is
    // the header's close button, which is rarely what a keyboard user wants.
    const focusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => node.offsetParent !== null,
      );
    const preferred = container.querySelector<HTMLElement>("[data-autofocus]");
    (preferred ?? focusable()[0] ?? container).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const nodes = focusable();
      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }

      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;

      // Wrap at both ends so focus cannot escape the dialog.
      if (event.shiftKey && (active === first || active === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener("keydown", onKeyDown);
    return () => {
      container.removeEventListener("keydown", onKeyDown);
      // Returning focus to the trigger is what makes keyboard use continuous.
      previouslyFocused?.focus?.();
    };
  }, [container]);

  return setContainer;
}
