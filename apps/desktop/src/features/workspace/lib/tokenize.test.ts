import { describe, expect, it } from "vitest";

import { tokenize } from "./tokenize";

describe("tokenize", () => {
  it("splits on whitespace", () => {
    expect(tokenize("org display --json")).toEqual([
      "org",
      "display",
      "--json",
    ]);
  });

  it("keeps a double-quoted value together", () => {
    expect(tokenize('data query --query "SELECT Id FROM Account"')).toEqual([
      "data",
      "query",
      "--query",
      "SELECT Id FROM Account",
    ]);
  });

  it("handles single quotes", () => {
    expect(tokenize("apex run --name 'My Test'")).toEqual([
      "apex",
      "run",
      "--name",
      "My Test",
    ]);
  });

  // Regression: the CLI tab's old regex only stripped quotes at a token's
  // edges, so this reached `sf` as `--query="SELECT Id"` with quotes intact.
  it("strips quotes attached to a flag value", () => {
    expect(tokenize('data query --query="SELECT Id FROM Account"')).toEqual([
      "data",
      "query",
      "--query=SELECT Id FROM Account",
    ]);
  });

  it("collapses runs of whitespace", () => {
    expect(tokenize("  org   display  ")).toEqual(["org", "display"]);
  });

  it("returns nothing for an empty line", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("   ")).toEqual([]);
  });

  it("runs an unbalanced quote to end of line rather than throwing", () => {
    // Better to hand the CLI a best guess and let it complain than to crash
    // the terminal on a half-typed command.
    expect(tokenize('data query --query "SELECT Id')).toEqual([
      "data",
      "query",
      "--query",
      "SELECT Id",
    ]);
  });

  it("treats the other quote character as literal inside a quoted run", () => {
    expect(tokenize(`--where "Name = 'Acme'"`)).toEqual([
      "--where",
      "Name = 'Acme'",
    ]);
  });
});
