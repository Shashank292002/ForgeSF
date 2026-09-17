import { describe, expect, it } from "vitest";

import { filterLimits, humanLimitName, limitRows } from "./orgLimits";

describe("humanLimitName", () => {
  it("splits the CLI's run-together names and keeps initialisms", () => {
    expect(humanLimitName("DailyApiRequests")).toBe("Daily API Requests");
    expect(humanLimitName("DailyAsyncApexExecutions")).toBe(
      "Daily Async Apex Executions",
    );
    expect(humanLimitName("ActiveScratchOrgs")).toBe("Active Scratch Orgs");
    expect(humanLimitName("MassEmail")).toBe("Mass Email");
  });
});

describe("limitRows", () => {
  it("reports what has been used, tightest limit first", () => {
    const rows = limitRows([
      { name: "DailyApiRequests", max: 15000, remaining: 14000 },
      { name: "ActiveScratchOrgs", max: 3, remaining: 0 },
      { name: "DataStorageMB", max: 1000, remaining: 200 },
    ]);

    expect(rows.map((row) => row.name)).toEqual([
      "ActiveScratchOrgs",
      "DataStorageMB",
      "DailyApiRequests",
    ]);

    const [scratch, storage, api] = rows;
    expect(scratch).toMatchObject({ used: 3, usage: 1, tone: "critical" });
    expect(storage).toMatchObject({ used: 800, usage: 0.8, tone: "warning" });
    expect(api).toMatchObject({ used: 1000, tone: "ok" });
  });

  it("handles a limit with no ceiling, and one already exceeded", () => {
    // Sorted tightest first, so the exceeded one leads and the one with no
    // ceiling — which cannot be "close to full" — comes last.
    const [exceeded, unlimited] = limitRows([
      { name: "NoCeiling", max: 0, remaining: 0 },
      // A limit can report more remaining than its own maximum, or less than
      // none; neither should draw a bar outside its track.
      { name: "Exceeded", max: 10, remaining: -5 },
    ]);

    expect(exceeded).toMatchObject({ used: 10, remaining: 0, usage: 1 });
    expect(unlimited).toMatchObject({ usage: null, tone: "ok" });
  });
});

describe("filterLimits", () => {
  it("matches the raw name and the readable one", () => {
    const rows = limitRows([
      { name: "DailyApiRequests", max: 10, remaining: 10 },
      { name: "ActiveScratchOrgs", max: 10, remaining: 10 },
    ]);

    expect(filterLimits(rows, "  ").length).toBe(2);
    expect(filterLimits(rows, "scratch").map((row) => row.name)).toEqual([
      "ActiveScratchOrgs",
    ]);
    // "API Requests" with the space only exists in the readable label.
    expect(filterLimits(rows, "api requests").map((row) => row.name)).toEqual([
      "DailyApiRequests",
    ]);
  });
});
