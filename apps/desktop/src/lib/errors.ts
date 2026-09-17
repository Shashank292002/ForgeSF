import type { AppError, ErrorKind } from "@/types/generated";

/**
 * Reading whatever a failed call threw.
 *
 * A Tauri command rejects with `{ kind, message }`, JavaScript code throws
 * `Error`s, and some libraries reject with plain strings. Five copies of an
 * `error instanceof Error ? error.message : String(error)` helper used to
 * handle only the last two, and would have shown a command's error as
 * "[object Object]".
 */

/** Whether `error` is the error a Tauri command reports. */
export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as AppError).kind === "string" &&
    typeof (error as AppError).message === "string"
  );
}

/**
 * A readable message for anything thrown. `fallback` stands in for a value
 * that carries no message of its own.
 */
export function errorMessage(
  error: unknown,
  fallback = "Something went wrong.",
): string {
  if (isAppError(error)) return error.message;
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

/** What kind of failure a command reported, or null for anything else. */
export function errorKind(error: unknown): ErrorKind | null {
  return isAppError(error) ? error.kind : null;
}
