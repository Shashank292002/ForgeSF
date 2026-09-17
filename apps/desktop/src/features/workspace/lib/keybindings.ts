/**
 * Keyboard shortcuts written as text — "Ctrl+Shift+P" — so a command's
 * binding is declared once and shown in the palette exactly as it works.
 * `Ctrl` also accepts Cmd, for macOS.
 */

export interface KeyChord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** The key itself, lower case: "p", "`", "f2", "enter". */
  key: string;
}

type KeyEventLike = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

export function parseKeys(keys: string): KeyChord {
  const parts = keys.split("+");
  // "Ctrl++" would be a plus key; none of the app's bindings use one.
  const key = parts.pop()!.toLowerCase();
  const modifiers = new Set(parts.map((part) => part.toLowerCase()));
  return {
    ctrl: modifiers.has("ctrl"),
    shift: modifiers.has("shift"),
    alt: modifiers.has("alt"),
    key,
  };
}

/** Whether a key press is the shortcut `keys`, with no extra modifiers. */
export function matchesKeys(event: KeyEventLike, keys: string): boolean {
  const chord = parseKeys(keys);
  if (chord.ctrl !== (event.ctrlKey || event.metaKey)) return false;
  if (chord.shift !== event.shiftKey || chord.alt !== event.altKey)
    return false;

  if (event.key.toLowerCase() === chord.key) return true;
  // Shift and Alt can change what a key types (Shift+` is ~), so a letter
  // or digit is also recognised by the key it sits on.
  if (/^[a-z]$/.test(chord.key))
    return event.code === `Key${chord.key.toUpperCase()}`;
  if (/^[0-9]$/.test(chord.key)) return event.code === `Digit${chord.key}`;
  if (chord.key === "`") return event.code === "Backquote";
  return false;
}
