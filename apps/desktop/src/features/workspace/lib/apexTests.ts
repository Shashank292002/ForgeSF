import type { WorkspaceFile } from "../types";

/** A test class on disk: its API name and the file to open. */
export interface TestClassFile {
  name: string;
  path: string;
}

/**
 * Every Apex class and trigger in a list of paths, by API name.
 *
 * Takes paths rather than the explorer tree: the tree is loaded a folder at a
 * time, so a class in a folder nobody has expanded is not in it — and coverage
 * names classes wherever they live, not only the ones on screen.
 */
export function apexFilesIn(paths: string[]): Map<string, string> {
  const byName = new Map<string, string>();

  for (const path of paths) {
    const file = path.slice(path.lastIndexOf("/") + 1);
    if (file.endsWith(".cls")) {
      byName.set(file.slice(0, -".cls".length), path);
    } else if (file.endsWith(".trigger")) {
      byName.set(file.slice(0, -".trigger".length), path);
    }
  }

  return byName;
}

/**
 * The Apex classes in the workspace whose names read as tests.
 *
 * Whether a class really is a test is decided by `@isTest` inside it, which
 * would mean reading every file. The naming convention Salesforce projects
 * follow is enough to offer a starting list, and the org rejects anything that
 * turns out not to be a test.
 */
export function testClassesIn(files: WorkspaceFile[]): TestClassFile[] {
  const found: TestClassFile[] = [];

  const walk = (items: WorkspaceFile[]) => {
    for (const item of items) {
      if (item.children) walk(item.children);
      if (item.type !== "file" || !item.name.endsWith(".cls")) continue;

      const name = item.name.slice(0, -".cls".length);
      if (looksLikeTest(name)) found.push({ name, path: item.path });
    }
  };
  walk(files);

  found.sort((a, b) => a.name.localeCompare(b.name));
  return found;
}

/** The conventions: `FooTest`, `TestFoo`, `Foo_Test`. */
export function looksLikeTest(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.endsWith("test") ||
    lower.endsWith("tests") ||
    lower.startsWith("test")
  );
}

/**
 * The lines of `path` the last run never reached.
 *
 * Coverage is reported per Apex class name; the editor knows a file path.
 * Only `.cls` and `.trigger` files can have coverage, so anything else gets
 * nothing rather than a name-collision with a class of the same name.
 */
export function uncoveredLinesFor(
  path: string,
  uncoveredByClass: Record<string, number[]>,
): number[] {
  const file = path.slice(path.lastIndexOf("/") + 1);
  const name = file.endsWith(".cls")
    ? file.slice(0, -".cls".length)
    : file.endsWith(".trigger")
      ? file.slice(0, -".trigger".length)
      : null;

  return name ? (uncoveredByClass[name] ?? []) : [];
}
