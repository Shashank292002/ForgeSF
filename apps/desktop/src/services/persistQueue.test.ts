import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { onPersistFailure, persist } from "./persistQueue";

/**
 * The queue's whole reason for existing is correctness when writes overlap,
 * which is exactly what was never tested.
 */
describe("the persist queue", () => {
  beforeEach(() => {
    // The failure path logs, and a red console in the test output is noise.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** A promise with its resolve exposed, to order things by hand. */
  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
      resolve = res;
    });
    return { promise, resolve };
  }

  /**
   * Lets every already-queued microtask run. The queue is a promise chain, so
   * a single `await` only advances it one link.
   */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  // The queue is module-level state shared by every test here, so each one
  // must leave it settled — a write left pending would stall the next test.
  it("runs writes one at a time, in the order they were queued", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const started: string[] = [];
    const finished: string[] = [];

    const a = persist("a", async () => {
      started.push("a");
      const value = await first.promise;
      finished.push("a");
      return value;
    });
    const b = persist("b", async () => {
      started.push("b");
      const value = await second.promise;
      finished.push("b");
      return value;
    });

    // The second write has not started: it is waiting on the first.
    await flush();
    expect(started).toEqual(["a"]);
    expect(finished).toEqual([]);

    first.resolve("one");
    second.resolve("two");
    expect(await a).toBe("one");
    expect(await b).toBe("two");

    expect(started).toEqual(["a", "b"]);
    expect(finished).toEqual(["a", "b"]);
  });

  it("keeps the queue running after a write fails", async () => {
    const failures: string[] = [];
    const stop = onPersistFailure((message) => failures.push(message));

    const failed = await persist("the org list", () =>
      Promise.reject(new Error("disk full")),
    );
    // A failed write resolves to undefined rather than rejecting, so a
    // caller that cannot await it does not get an unhandled rejection.
    expect(failed).toBeUndefined();

    // The chain must not break: a later write still runs.
    await expect(persist("later", () => Promise.resolve("ok"))).resolves.toBe(
      "ok",
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("the org list");
    expect(failures[0]).toContain("disk full");

    stop();
  });

  it("stops notifying a listener once it unsubscribes", async () => {
    const seen: string[] = [];
    const stop = onPersistFailure((message) => seen.push(message));
    stop();

    await persist("orgs", () => Promise.reject(new Error("nope")));
    expect(seen).toEqual([]);
  });

  it("returns what the write returned when it succeeds", async () => {
    await expect(persist("orgs", () => Promise.resolve(42))).resolves.toBe(42);
  });

  // The interleaving this exists to prevent: a read-modify-write losing a
  // change because another write ran between its read and its write.
  it("does not lose a change when two read-modify-writes overlap", async () => {
    let stored = ["a"];
    const readModifyWrite = (add: string) =>
      persist(`adding ${add}`, async () => {
        const current = [...stored];
        // Yield, so an unserialised version would interleave here.
        await Promise.resolve();
        stored = [...current, add];
        return stored;
      });

    await Promise.all([readModifyWrite("b"), readModifyWrite("c")]);
    expect(stored).toEqual(["a", "b", "c"]);
  });
});
