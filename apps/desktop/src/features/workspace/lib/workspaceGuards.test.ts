import { describe, expect, it } from "vitest";

import { mixingWarningFor } from "./workspaceGuards";
import type { Workspace } from "../types";

const project = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: "C:/dev/acme",
  name: "acme",
  path: "C:/dev/acme",
  orgId: null,
  lastOrgId: null,
  lastRetrievedOrgId: null,
  createdAt: 0,
  managed: false,
  ...overrides,
});

describe("mixingWarningFor", () => {
  it("stays silent on a never-retrieved workspace", () => {
    expect(mixingWarningFor(project(), "org-1")).toBeNull();
  });

  it("stays silent when retrieving from the same org again", () => {
    expect(
      mixingWarningFor(project({ lastRetrievedOrgId: "org-1" }), "org-1"),
    ).toBeNull();
  });

  it("warns when a different org populated the tree", () => {
    expect(
      mixingWarningFor(project({ lastRetrievedOrgId: "org-1" }), "org-2"),
    ).toEqual({ workspaceName: "acme", previousOrgId: "org-1" });
  });

  it("stays silent without a workspace or an org", () => {
    expect(mixingWarningFor(undefined, "org-1")).toBeNull();
    expect(
      mixingWarningFor(project({ lastRetrievedOrgId: "org-1" }), undefined),
    ).toBeNull();
  });

  it("treats a null lastRetrievedOrgId as never retrieved", () => {
    expect(
      mixingWarningFor(project({ lastRetrievedOrgId: null }), "org-2"),
    ).toBeNull();
  });
});

describe("per-org isolation", () => {
  // Each org owns a folder, so the tree can only ever be written by its own
  // org. The guard still matters for a folder bound to an org by hand after
  // another org had already populated it.
  it("warns on a folder rebound to a different org", () => {
    const rebound = project({
      orgId: "org-2",
      lastRetrievedOrgId: "org-1",
    });
    expect(mixingWarningFor(rebound, "org-2")).toEqual({
      workspaceName: "acme",
      previousOrgId: "org-1",
    });
  });

  it("stays silent once that folder has been retrieved by its owner", () => {
    const settled = project({ orgId: "org-2", lastRetrievedOrgId: "org-2" });
    expect(mixingWarningFor(settled, "org-2")).toBeNull();
  });
});
