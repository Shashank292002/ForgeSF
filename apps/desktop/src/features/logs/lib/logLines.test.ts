import { describe, expect, it } from "vitest";

import {
  countByCategory,
  filterLog,
  humanSize,
  parseLog,
  readableTime,
} from "./logLines";

const LOG = [
  "64.0 APEX_CODE,FINEST;APEX_PROFILING,INFO",
  "16:04:31.0 (1000)|EXECUTION_STARTED",
  "16:04:31.0 (2000)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex",
  "16:04:31.1 (3000)|USER_DEBUG|[1]|DEBUG|Hello from Apex",
  "16:04:31.1 (4000)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Account",
  "16:04:31.2 (5000)|SOQL_EXECUTE_END|[3]|Rows:12",
  "16:04:31.3 (6000)|EXCEPTION_THROWN|[7]|System.NullPointerException",
  "16:04:31.4 (7000)|LIMIT_USAGE|[8]|SOQL|1|100",
  "  continued line with no event",
].join("\n");

describe("parseLog", () => {
  it("names the event on each line and keeps the rest verbatim", () => {
    const lines = parseLog(LOG);

    expect(lines).toHaveLength(9);
    expect(lines[0]).toMatchObject({ number: 1, event: null, time: null });
    expect(lines[3]).toMatchObject({
      number: 4,
      event: "USER_DEBUG",
      time: "16:04:31.1 (3000)",
    });
    // A wrapped line belongs to the log but reports no event of its own.
    expect(lines[8]).toMatchObject({ event: null });
    expect(lines[8].text).toBe("  continued line with no event");
  });

  it("handles an empty log without inventing a line", () => {
    expect(parseLog("")).toEqual([
      { number: 1, time: null, event: null, text: "" },
    ]);
  });
});

describe("filterLog", () => {
  const lines = parseLog(LOG);

  it("shows everything until a category is chosen", () => {
    expect(filterLog(lines, [], "")).toHaveLength(9);
  });

  it("narrows to the chosen categories", () => {
    expect(filterLog(lines, ["debug"], "").map((l) => l.event)).toEqual([
      "USER_DEBUG",
    ]);
    expect(filterLog(lines, ["soql"], "").map((l) => l.event)).toEqual([
      "SOQL_EXECUTE_BEGIN",
      "SOQL_EXECUTE_END",
    ]);
    // Several categories together, not one after the other.
    expect(filterLog(lines, ["debug", "errors"], "")).toHaveLength(2);
  });

  it("searches the line text, ignoring case", () => {
    expect(filterLog(lines, [], "hello from apex")).toHaveLength(1);
    expect(filterLog(lines, [], "nothing here")).toHaveLength(0);
    // A search and a category narrow together.
    expect(filterLog(lines, ["soql"], "Rows:12")).toHaveLength(1);
  });
});

describe("countByCategory", () => {
  it("counts what each filter would show", () => {
    expect(countByCategory(parseLog(LOG))).toEqual({
      debug: 1,
      soql: 2,
      dml: 0,
      errors: 1,
      limits: 1,
      callouts: 0,
    });
  });
});

describe("humanSize", () => {
  it("reads sizes the way a person would say them", () => {
    expect(humanSize(512)).toBe("512 B");
    expect(humanSize(4096)).toBe("4 KB");
    expect(humanSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("readableTime", () => {
  it("keeps a value it cannot parse rather than showing Invalid Date", () => {
    expect(readableTime("not a date")).toBe("not a date");
    expect(readableTime("2026-09-16T09:00:00.000+0000")).not.toMatch(/Invalid/);
  });
});
