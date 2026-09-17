import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { ApexLog, TerminalEvent } from "@/types/generated";

/** Every debug log the org is keeping for this user, newest first. */
export function listApexLogs(username: string): Promise<ApexLog[]> {
  return invoke<ApexLog[]>("list_apex_logs", { username });
}

/** One log, in full. */
export function getApexLog(username: string, logId: string): Promise<string> {
  return invoke<string>("get_apex_log", { username, logId });
}

/**
 * Streams the org's logs until stopped with `cancelSfCommand(runId)`.
 *
 * The CLI sets up the trace flag this needs, so watching does not mean a trip
 * to Setup first. Resolves when the tail ends.
 */
export function tailApexLogs(
  username: string,
  runId: string,
  debugLevel?: string | null,
): Promise<void> {
  return invoke<void>("tail_apex_logs", {
    username,
    runId,
    debugLevel: debugLevel ?? null,
  });
}

/** Subscribes to a tail's output. Resolves to an unsubscribe. */
export function onApexLogTail(
  callback: (event: TerminalEvent) => void,
): Promise<UnlistenFn> {
  return listen<TerminalEvent>("apex_log_tail", (event) =>
    callback(event.payload),
  );
}
