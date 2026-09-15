/**
 * Moving keyboard focus between the workspace's parts, as F6 does in VS Code.
 *
 * The code editor keeps Tab for indenting, so Tab alone never leaves it —
 * a keyboard user who tabbed in was stuck there. F6 and Shift+F6 step from
 * part to part: activity bar, side bar, editor, terminal, status bar.
 */

interface Part {
  /** The part's container. */
  selector: string;
  /** Where focus goes in it, in order of preference, when present. */
  preferred?: string[];
}

const PARTS: Part[] = [
  {
    selector: ".fw-activitybar",
    preferred: [".fw-activitybar__item.is-active"],
  },
  {
    selector: ".forge-sidebar__content",
    preferred: ['[role="tree"]', ".fw-search__input"],
  },
  {
    // The text itself, as F6 does in VS Code; the tabs when no file is open.
    // The editor types into an element with the textbox role — in Chromium an
    // EditContext element, beside a textarea that only serves as a fallback
    // and does not give the editor focus.
    selector: ".workspace-editor",
    preferred: [
      '.monaco-editor [role="textbox"]',
      ".monaco-editor textarea",
      '[role="tab"][tabindex="0"]',
    ],
  },
  {
    selector: ".workspace-panel__body",
    preferred: [".workspace-terminal__input"],
  },
  { selector: ".workspace-statusbar" },
];

const FOCUSABLE = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Focuses the next (`1`) or previous (`-1`) part that has something to
 * focus. Returns whether focus moved.
 */
export function focusPart(step: 1 | -1, root: ParentNode = document): boolean {
  const parts = PARTS.flatMap((part) => {
    const element = root.querySelector<HTMLElement>(part.selector);
    return element ? [{ part, element }] : [];
  });
  if (parts.length === 0) return false;

  const active = document.activeElement;
  const current = parts.findIndex(({ element }) => element.contains(active));
  // From outside every part, F6 starts at the first and Shift+F6 at the last.
  const start = current === -1 ? (step === 1 ? -1 : parts.length) : current;

  for (let offset = 1; offset <= parts.length; offset += 1) {
    const index =
      (((start + step * offset) % parts.length) + parts.length) % parts.length;
    const { part, element } = parts[index];
    const preferred = (part.preferred ?? [])
      .map((selector) => element.querySelector<HTMLElement>(selector))
      .find((candidate) => candidate !== null);
    const target = preferred ?? element.querySelector<HTMLElement>(FOCUSABLE);
    if (target) {
      target.focus();
      return true;
    }
  }
  return false;
}
