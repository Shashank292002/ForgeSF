import { create } from "zustand";

/**
 * Transient notifications.
 *
 * For outcomes nobody is looking at: a background deploy that finished on
 * another page, or a settings write that failed. Before this, such failures
 * only reached the console or borrowed an unrelated banner.
 */

export type ToastTone = "info" | "success" | "warning" | "error";

/** A button on a notice that fixes what it reports: "Re-authenticate". */
export interface ToastAction {
  label: string;
  /** Runs when the button is pressed; the notice then closes. */
  onClick: () => void;
}

export interface Toast {
  id: number;
  tone: ToastTone;
  title?: string;
  message: string;
  /** Milliseconds before it goes away on its own; null to stay until closed. */
  durationMs: number | null;
  action?: ToastAction;
}

export interface ToastOptions {
  title?: string;
  durationMs?: number | null;
  action?: ToastAction;
}

interface ToastState {
  toasts: Toast[];
}

/** How many are kept; the oldest go first. */
const MAX_TOASTS = 4;

const DEFAULT_DURATION: Record<ToastTone, number> = {
  info: 5000,
  success: 5000,
  warning: 8000,
  error: 10000,
};

export const useToastStore = create<ToastState>(() => ({ toasts: [] }));

let nextId = 1;

function push(
  tone: ToastTone,
  message: string,
  options: ToastOptions = {},
): number {
  const id = nextId++;
  const toast: Toast = {
    id,
    tone,
    title: options.title,
    message,
    durationMs:
      options.durationMs === undefined
        ? DEFAULT_DURATION[tone]
        : options.durationMs,
    action: options.action,
  };
  useToastStore.setState((state) => {
    // The same notice again replaces the earlier one rather than stacking: a
    // repeating failure should not fill the screen.
    const others = state.toasts.filter(
      (item) =>
        !(
          item.tone === tone &&
          item.title === toast.title &&
          item.message === message
        ),
    );
    return { toasts: [...others, toast].slice(-MAX_TOASTS) };
  });
  return id;
}

export function dismissToast(id: number) {
  useToastStore.setState((state) => ({
    toasts: state.toasts.filter((item) => item.id !== id),
  }));
}

export const toast = {
  info: (message: string, options?: ToastOptions) =>
    push("info", message, options),
  success: (message: string, options?: ToastOptions) =>
    push("success", message, options),
  warning: (message: string, options?: ToastOptions) =>
    push("warning", message, options),
  error: (message: string, options?: ToastOptions) =>
    push("error", message, options),
  dismiss: dismissToast,
};
