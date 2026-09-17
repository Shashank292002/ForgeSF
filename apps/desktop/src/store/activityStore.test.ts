import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  normaliseActivity,
  recordActivity,
  relativeTime,
  useActivityStore,
  type ActivityEvent,
} from "./activityStore";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({
    get: async () => null,
    set: async () => {},
    save: async () => {},
  }),
}));

const event = (overrides: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: "1",
  at: 1_000,
  kind: "success",
  source: "deploy",
  title: "Deployed 3 files",
  ...overrides,
});

beforeEach(() => {
  useActivityStore.setState({ events: [], loaded: false });
});

describe("normaliseActivity", () => {
  it("keeps well-formed events and drops the rest", () => {
    const kept = normaliseActivity([
      event(),
      { id: "2", at: 2, kind: "nonsense", source: "deploy", title: "x" },
      { id: "3", at: 3, kind: "error", source: "elsewhere", title: "x" },
      { at: 4, kind: "info", source: "org", title: "no id" },
      "not an event",
      null,
    ]);

    expect(kept).toHaveLength(1);
    expect(kept[0].title).toBe("Deployed 3 files");
  });

  it("is empty for anything that is not a list", () => {
    expect(normaliseActivity(null)).toEqual([]);
    expect(normaliseActivity({ events: [] })).toEqual([]);
  });

  it("keeps only the most recent when a file holds too many", () => {
    const many = Array.from({ length: 260 }, (_, index) =>
      event({ id: String(index), title: `Event ${index}` }),
    );
    const kept = normaliseActivity(many);

    expect(kept).toHaveLength(200);
    // Stored oldest-first, so the tail is what survives.
    expect(kept[kept.length - 1].title).toBe("Event 259");
  });
});

describe("recording", () => {
  it("puts the newest first and stamps it", () => {
    recordActivity({ kind: "success", source: "tests", title: "27 passed" });
    recordActivity({ kind: "error", source: "deploy", title: "Deploy failed" });

    const { events } = useActivityStore.getState();
    expect(events.map((e) => e.title)).toEqual(["Deploy failed", "27 passed"]);
    expect(events[0].at).toBeGreaterThan(0);
    expect(events[0].id).not.toBe(events[1].id);
  });

  it("caps what it holds", () => {
    for (let index = 0; index < 220; index += 1) {
      recordActivity({ kind: "info", source: "org", title: `Event ${index}` });
    }

    const { events } = useActivityStore.getState();
    expect(events).toHaveLength(200);
    expect(events[0].title).toBe("Event 219");
  });

  it("clears", () => {
    recordActivity({ kind: "info", source: "org", title: "Connected" });
    useActivityStore.getState().clear();
    expect(useActivityStore.getState().events).toEqual([]);
  });
});

describe("relativeTime", () => {
  it("says how long ago in words", () => {
    const now = new Date("2026-09-16T12:00:00Z").getTime();
    const ago = (ms: number) => relativeTime(now - ms, now);

    expect(ago(5_000)).toBe("just now");
    expect(ago(12 * 60_000)).toBe("12 min ago");
    expect(ago(3 * 3_600_000)).toBe("3 hours ago");
    expect(ago(1 * 3_600_000)).toBe("1 hour ago");
    expect(ago(2 * 86_400_000)).toBe("2 days ago");
    // Beyond a week, a date is more useful than a count.
    expect(ago(30 * 86_400_000)).toMatch(/\d/);
    // A clock that went backwards must not read "-3 min ago".
    expect(relativeTime(now + 60_000, now)).toBe("just now");
  });
});
