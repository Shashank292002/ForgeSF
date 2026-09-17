import { useEffect, useEffectEvent } from "react";

import { useAskStore } from "../../../components/ui/Confirm/confirm";
import { matchesKeys } from "../lib/keybindings";
import { commandKeys, type WorkspaceCommand } from "../lib/workspaceCommands";

/**
 * The workspace's keyboard shortcuts: each command's `keys`, run while the
 * workspace is on screen. Ctrl+P, Ctrl+Shift+P, Ctrl+G and Ctrl+Shift+F are
 * new; the rest (Ctrl+S, Ctrl+B, Ctrl+`, Ctrl+Shift+E/G/M…) keep working as
 * before, now declared in the command list the palette shows.
 */
export function useWorkspaceShortcuts(commands: WorkspaceCommand[]): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    // Handled already: the editor's own bindings (its Ctrl+G, say) win.
    if (event.defaultPrevented) return;
    // A question is waiting for an answer; nothing else happens meanwhile.
    if (useAskStore.getState().queue.length > 0) return;

    const command = commands.find((item) =>
      commandKeys(item).some((keys) => matchesKeys(event, keys)),
    );
    if (!command) return;

    // The shortcut is the app's even when the command doesn't apply right
    // now, so the webview never prints (Ctrl+P) or saves the page (Ctrl+S).
    event.preventDefault();
    if (command.when && !command.when()) return;
    void command.run();
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
}
