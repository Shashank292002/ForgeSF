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

/** A single-line text field in a dialog. See `prompt`. */
export interface AskInput {
  /** Label above the field. */
  label?: string;
  initialValue?: string;
  placeholder?: string;
}

/** One entry of a dialog's drop-down. See `AskOptions.choices`. */
export interface AskChoice<T extends string> {
  value: T;
  label: string;
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
  /**
   * Adds a text field, focused on open. The promise then resolves with the
   * typed text rather than the action's value, and the action is disabled
   * while the field is empty. Use `prompt` rather than passing this directly.
   */
  input?: AskInput;
  /**
   * A drop-down in the body, for more answers than fit as buttons. The
   * promise then resolves with the selected value rather than the action's.
   *
   * Without this, a caller with many answers had to cap them at a handful of
   * buttons — which silently dropped the rest.
   */
  choices?: AskChoice<T>[];
  /** Label above the drop-down. */
  choicesLabel?: string;
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

export interface PromptOptions {
  title: string;
  message?: string;
  details?: string[];
  /** Label above the field. */
  label?: string;
  /** What the field starts with — selected, so typing replaces it. */
  initialValue?: string;
  placeholder?: string;
  /** Defaults to "Save". */
  confirmLabel?: string;
  cancelLabel?: string;
}

/**
 * Asks for one line of text. Resolves with the trimmed text, or null when
 * dismissed. Replaces `window.prompt`, which some webviews do not show at all.
 */
export async function prompt(options: PromptOptions): Promise<string | null> {
  const result = await ask({
    title: options.title,
    message: options.message,
    details: options.details,
    cancelLabel: options.cancelLabel,
    actions: [{ value: "save", label: options.confirmLabel ?? "Save" }],
    input: {
      label: options.label,
      initialValue: options.initialValue,
      placeholder: options.placeholder,
    },
  });
  return result === null ? null : result.trim();
}

/** A preview of paths for a dialog's detail list: the first few, then a count. */
export function previewList(items: string[], limit = 8): string[] {
  if (items.length <= limit) return items;
  return [...items.slice(0, limit), `…and ${items.length - limit} more`];
}
