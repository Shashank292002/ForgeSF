import { invoke } from "@tauri-apps/api/core";

import type { SObjectDescribe } from "@/types/generated";

/** Every object in the org, sorted. */
export function listSObjects(username: string): Promise<string[]> {
  return invoke<string[]>("list_sobjects", { username });
}

/** One object's fields and child relationships. */
export function describeSObject(
  username: string,
  sobject: string,
  tooling = false,
): Promise<SObjectDescribe> {
  return invoke<SObjectDescribe>("describe_sobject", {
    username,
    sobject,
    tooling,
  });
}

/**
 * Writes text to a file the user picks in the native save dialog. Resolves
 * with the path, or null when they dismissed it.
 *
 * The webview cannot write files and a download link inside it does nothing,
 * so the dialog and the write both happen in Rust.
 */
export function saveTextFile(
  suggestedName: string,
  contents: string,
): Promise<string | null> {
  return invoke<string | null>("save_text_file", { suggestedName, contents });
}
