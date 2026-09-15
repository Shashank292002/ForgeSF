import { create } from "zustand";

/**
 * In-app confirmation dialogs, as promises.
 *
 * Replaces `window.confirm`: native, unstyled, blocking the whole webview, and
 * limited to OK/Cancel with the message as one block of text. `ask` and
 * `confirm` can be awaited from stores and components alike; `ConfirmHost`,
 * mounted once at the root, renders whichever question is first in line.
 */

export type AskVariant = "primary" | "secondary" | "danger";

export interface AskAction<T extends string> {
  value: T;
  label: string;
  variant?: AskVariant;
}

export interface AskOptions<T extends string> {
  title: string;
  /** Body text. Blank lines separate paragraphs. */
  message?: string;
  /** Items shown as a list under the message — file paths, org identity. */
  details?: string[];
  /** The choices, besides dismissing; the last one is the main action. */
  actions: AskAction<T>[];
  /** Label of the button that dismisses without choosing. */
  cancelLabel?: string;
  /** What has focus when the dialog opens. Defaults to the last action. */
  focus?: T | "cancel";
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  details?: string[];
  /** Defaults to "Continue". */
  confirmLabel?: string;
  cancelLabel?: string;
  /**
   * `danger` styles the confirm button as destructive and starts focus on
   * Cancel, so an Enter pressed out of habit does not destroy anything.
   */
  tone?: "default" | "danger";
}

export interface PendingAsk {
  id: number;
  options: AskOptions<string>;
  resolve: (value: string | null) => void;
}

interface AskState {
  /** Open questions, oldest first; only the first is shown. */
  queue: PendingAsk[];
}

export const useAskStore = create<AskState>(() => ({ queue: [] }));

let nextId = 1;

/**
 * Asks a question with several answers. Resolves with the chosen action's
 * value, or null when dismissed (Cancel, Escape, the close button).
 */
export function ask<T extends string>(
  options: AskOptions<T>,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const entry: PendingAsk = {
      id: nextId++,
      options: options as AskOptions<string>,
      resolve: resolve as (value: string | null) => void,
    };
    useAskStore.setState((state) => ({ queue: [...state.queue, entry] }));
  });
}

/** Settles an open question and shows the next one. */
export function answer(id: number, value: string | null) {
  const entry = useAskStore.getState().queue.find((item) => item.id === id);
  if (!entry) return;
  useAskStore.setState((state) => ({
    queue: state.queue.filter((item) => item.id !== id),
  }));
  entry.resolve(value);
}

/** An OK/Cancel question. Resolves true only when confirmed. */
export async function confirm(options: ConfirmOptions): Promise<boolean> {
  const danger = options.tone === "danger";
  const result = await ask({
    title: options.title,
    message: options.message,
    details: options.details,
    cancelLabel: options.cancelLabel,
    actions: [
      {
        value: "confirm",
        label: options.confirmLabel ?? "Continue",
        variant: danger ? "danger" : "primary",
      },
    ],
    focus: danger ? "cancel" : "confirm",
  });
  return result === "confirm";
}

/** A preview of paths for a dialog's detail list: the first few, then a count. */
export function previewList(items: string[], limit = 8): string[] {
  if (items.length <= limit) return items;
  return [...items.slice(0, limit), `…and ${items.length - limit} more`];
}
