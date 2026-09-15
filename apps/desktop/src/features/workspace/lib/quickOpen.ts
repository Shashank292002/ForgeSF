import { fuzzyMatch, matchPath } from "./fuzzy";
import { commandLabel, type WorkspaceCommand } from "./workspaceCommands";

/**
 * What Quick Open lists for the text typed into it. As in VS Code, the first
 * character picks the mode: `>` for commands, `:` for a line in the active
 * file, anything else searches file names (`Foo.cls:12` opens at a line).
 */

export type QuickMode = "files" | "commands" | "line";

export type QuickItem =
  | {
      kind: "file";
      path: string;
      positions: number[];
      line: number | null;
      column: number;
    }
  | { kind: "command"; command: WorkspaceCommand; positions: number[] }
  | { kind: "line"; line: number; column: number }
  | { kind: "message"; text: string };

/** Enough to find a file; more would only slow typing down. */
export const MAX_QUICK_RESULTS = 50;

export function quickMode(text: string): QuickMode {
  if (text.startsWith(">")) return "commands";
  if (text.startsWith(":")) return "line";
  return "files";
}

/** "Foo.cls:12:4" as the name to find and the place to open it at. */
export function parseFileQuery(text: string): {
  query: string;
  line: number | null;
  column: number;
} {
  const match = /^(.*?):(\d+)(?::(\d+))?$/.exec(text.trim());
  if (!match) return { query: text.trim(), line: null, column: 1 };
  return {
    query: match[1],
    line: Number(match[2]),
    column: match[3] ? Number(match[3]) : 1,
  };
}

interface QuickItemsInput {
  text: string;
  /** Every workspace file, or null while the list is loading. */
  files: string[] | null;
  filesError: string | null;
  /** Open editor tabs. */
  openFiles: string[];
  activeFile: string | null;
  commands: WorkspaceCommand[];
}

function commandItems(
  query: string,
  commands: WorkspaceCommand[],
): QuickItem[] {
  const available = commands.filter(
    (command) => !command.when || command.when(),
  );
  if (!query) {
    return available
      .map((command) => ({ kind: "command" as const, command, positions: [] }))
      .sort((a, b) =>
        commandLabel(a.command).localeCompare(commandLabel(b.command)),
      );
  }

  const scored = available.flatMap((command) => {
    const label = commandLabel(command);
    const titleStart = label.length - command.title.length;
    // A match in the title beats one that leans on the category.
    const inTitle = fuzzyMatch(query, command.title);
    if (inTitle) {
      return [
        {
          command,
          score: inTitle.score + 10,
          positions: inTitle.positions.map((index) => index + titleStart),
        },
      ];
    }
    const inLabel = fuzzyMatch(query, label);
    return inLabel ? [{ command, ...inLabel }] : [];
  });
  if (scored.length === 0) {
    return [{ kind: "message", text: "No matching commands." }];
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        commandLabel(a.command).localeCompare(commandLabel(b.command)),
    )
    .map(({ command, positions }) => ({ kind: "command", command, positions }));
}

function lineItems(text: string, activeFile: string | null): QuickItem[] {
  if (!activeFile) {
    return [{ kind: "message", text: "Open a file to go to a line in it." }];
  }
  const match = /^:\s*(\d+)(?::(\d+))?\s*$/.exec(text);
  if (!match) {
    return [
      {
        kind: "message",
        text: "Type a line number to go to, like :42 — or :42:7 for a column.",
      },
    ];
  }
  return [
    {
      kind: "line",
      line: Number(match[1]),
      column: match[2] ? Number(match[2]) : 1,
    },
  ];
}

function fileItems(input: QuickItemsInput): QuickItem[] {
  const { query, line, column } = parseFileQuery(input.text);
  const recent = [
    ...new Set(
      [input.activeFile, ...input.openFiles].filter(
        (path): path is string => path !== null,
      ),
    ),
  ];

  if (!query) {
    if (recent.length > 0) {
      return recent.map((path) => ({
        kind: "file",
        path,
        positions: [],
        line,
        column,
      }));
    }
    if (input.files === null) {
      return [{ kind: "message", text: input.filesError ?? "Loading files…" }];
    }
    return [{ kind: "message", text: "Type part of a file name." }];
  }
  if (input.files === null) {
    return [{ kind: "message", text: input.filesError ?? "Loading files…" }];
  }

  const open = new Set(recent);
  const scored: Array<{ path: string; score: number; positions: number[] }> =
    [];
  for (const path of input.files) {
    const match = matchPath(query, path);
    // Files already open are usually the ones wanted.
    if (match) {
      scored.push({
        path,
        score: match.score + (open.has(path) ? 5 : 0),
        positions: match.positions,
      });
    }
  }
  if (scored.length === 0) {
    return [{ kind: "message", text: "No file names match." }];
  }
  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.path.length - b.path.length ||
        a.path.localeCompare(b.path),
    )
    .slice(0, MAX_QUICK_RESULTS)
    .map(({ path, positions }) => ({
      kind: "file",
      path,
      positions,
      line,
      column,
    }));
}

export function quickItems(input: QuickItemsInput): QuickItem[] {
  switch (quickMode(input.text)) {
    case "commands":
      return commandItems(input.text.slice(1).trim(), input.commands);
    case "line":
      return lineItems(input.text, input.activeFile);
    case "files":
      return fileItems(input);
  }
}
