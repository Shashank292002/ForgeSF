import { describe, expect, it } from "vitest";

import { errorKind, errorMessage, isAppError } from "./errors";

describe("errors", () => {
  const commandError = { kind: "authRequired", message: "Log in again." };

  it("reads a command's error", () => {
    expect(isAppError(commandError)).toBe(true);
    expect(errorMessage(commandError)).toBe("Log in again.");
    expect(errorKind(commandError)).toBe("authRequired");
  });

  it("reads Errors and strings, which have no kind", () => {
    expect(errorMessage(new Error("broke"))).toBe("broke");
    expect(errorMessage("plain")).toBe("plain");
    expect(errorKind(new Error("broke"))).toBeNull();
    expect(errorKind("plain")).toBeNull();
  });

  it("falls back for values with no message", () => {
    expect(errorMessage(undefined)).toBe("Something went wrong.");
    expect(errorMessage({ code: 42 }, "Could not load.")).toBe(
      "Could not load.",
    );
    expect(isAppError({ kind: "failed" })).toBe(false);
  });
});
