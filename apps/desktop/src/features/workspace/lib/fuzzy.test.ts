import { describe, expect, it } from "vitest";

import { fuzzyMatch, highlightParts, matchPath } from "./fuzzy";

const rank = (query: string, paths: string[]) =>
  paths
    .map((path) => ({ path, match: matchPath(query, path) }))
    .filter((item) => item.match !== null)
    .sort((a, b) => b.match!.score - a.match!.score)
    .map((item) => item.path);

describe("fuzzyMatch", () => {
  it("needs the query's letters in order", () => {
    expect(fuzzyMatch("zx", "xyz")).toBeNull();
    expect(fuzzyMatch("longer", "long")).toBeNull();
    expect(fuzzyMatch("", "anything")).toEqual({ score: 0, positions: [] });
  });

  it("prefers the capitals of a camelCase name over scattered letters", () => {
    expect(fuzzyMatch("acs", "AccountService.cls")?.positions).toEqual([
      0, 1, 7,
    ]);
    expect(fuzzyMatch("as", "AccountService")?.positions).toEqual([0, 7]);
  });

  it("prefers a run of letters and the start of a path segment", () => {
    expect(fuzzyMatch("lwc", "force-app/main/lwc/list.js")?.positions).toEqual([
      15, 16, 17,
    ]);
  });
});

describe("matchPath", () => {
  const paths = [
    "force-app/main/default/lwc/myAccordion/myAccordion.js",
    "force-app/main/default/classes/AccountService.cls",
    "force-app/main/default/classes/AccountServiceTest.cls",
    "force-app/main/default/classes/OrderService.cls",
    "scripts/accounts.apex",
  ];

  it("ranks a file whose name starts with the query first", () => {
    expect(rank("accountser", paths).slice(0, 2)).toEqual([
      "force-app/main/default/classes/AccountService.cls",
      "force-app/main/default/classes/AccountServiceTest.cls",
    ]);
  });

  it("finds a file by its initials", () => {
    expect(rank("os", paths)[0]).toBe(
      "force-app/main/default/classes/OrderService.cls",
    );
    expect(rank("ast", paths)[0]).toBe(
      "force-app/main/default/classes/AccountServiceTest.cls",
    );
  });

  it("matches folders when the query has a slash, in either direction", () => {
    expect(rank("lwc/acc", paths)).toEqual([
      "force-app/main/default/lwc/myAccordion/myAccordion.js",
    ]);
    expect(rank("classes\\order", paths)).toEqual([
      "force-app/main/default/classes/OrderService.cls",
    ]);
  });

  it("reports positions in the whole path, so the name part can be highlighted", () => {
    const path = "force-app/main/default/classes/OrderService.cls";
    const match = matchPath("os", path)!;
    expect(match.positions.map((index) => path[index])).toEqual(["O", "S"]);
  });
});

describe("highlightParts", () => {
  it("groups matched and unmatched runs", () => {
    expect(highlightParts("AccountService", [0, 1, 7])).toEqual([
      { text: "Ac", match: true },
      { text: "count", match: false },
      { text: "S", match: true },
      { text: "ervice", match: false },
    ]);
  });

  it("takes positions relative to a longer string", () => {
    expect(highlightParts("Foo.cls", [8, 9], 8)).toEqual([
      { text: "Fo", match: true },
      { text: "o.cls", match: false },
    ]);
  });
});
