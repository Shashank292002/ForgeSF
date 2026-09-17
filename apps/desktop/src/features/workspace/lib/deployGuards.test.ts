import { describe, expect, it } from "vitest";

import {
  buffersAffectedBy,
  needsDeployConfirmation,
  workspaceOrgMismatchPrompt,
} from "./deployGuards";
import type { Organization } from "../../org-manager/types";
import type { Workspace } from "../types";

const org = (orgType: Organization["orgType"]): Organization => ({
  id: "00D",
  alias: "acme",
  username: "me@acme.com",
  instanceUrl: "https://acme.my.salesforce.com",
  orgType,
  isDefault: false,
  status: "Connected",
});

describe("needsDeployConfirmation", () => {
  it("confirms for Production", () => {
    expect(needsDeployConfirmation(org("Production"))).toBe(true);
  });

  it.each(["Sandbox", "Scratch Org", "Developer"] as const)(
    "does not interrupt the inner loop on %s",
    (orgType) => {
      expect(needsDeployConfirmation(org(orgType))).toBe(false);
    },
  );

  it("does not confirm when no org is selected", () => {
    expect(needsDeployConfirmation(null)).toBe(false);
    expect(needsDeployConfirmation(undefined)).toBe(false);
  });
});

describe("workspaceOrgMismatchPrompt", () => {
  const uat: Organization = { ...org("Sandbox"), id: "00D-uat", alias: "uat" };
  const prod: Organization = {
    ...org("Production"),
    id: "00D-prod",
    alias: "prod",
  };
  const workspace = (orgId: string | null): Workspace => ({
    id: "ws",
    name: "uat",
    path: "/ws/uat",
    orgId,
    lastOrgId: orgId,
    lastRetrievedOrgId: null,
    managed: false,
    createdAt: 0,
  });

  it("stays silent when the workspace belongs to the target org", () => {
    expect(
      workspaceOrgMismatchPrompt(workspace("00D-uat"), uat, [uat, prod]),
    ).toBeNull();
  });

  it("names both orgs when the workspace belongs to another one", () => {
    const prompt = workspaceOrgMismatchPrompt(workspace("00D-uat"), prod, [
      uat,
      prod,
    ]);
    expect(prompt?.title).toBe("Deploy uat's files to prod?");
    expect(prompt?.message).toContain("belongs to uat");
    expect(prompt?.message).toContain("targets prod");
    expect(prompt?.tone).toBe("danger");
  });

  it("does not guess for a workspace with no owning org", () => {
    expect(
      workspaceOrgMismatchPrompt(workspace(null), prod, [uat, prod]),
    ).toBeNull();
  });

  it("still warns when the owning org is no longer connected", () => {
    expect(
      workspaceOrgMismatchPrompt(workspace("00D-gone"), prod, [prod])?.message,
    ).toContain("a different org");
  });
});

describe("buffersAffectedBy", () => {
  const dirty = {
    "force-app/classes/A.cls": true,
    "force-app/classes/B.cls": true,
    "force-app/lwc/thing.js": true,
    "force-app/classes/Clean.cls": false,
  };

  it("matches the file itself", () => {
    expect(buffersAffectedBy("force-app/classes/A.cls", dirty)).toEqual([
      "force-app/classes/A.cls",
    ]);
  });

  it("matches everything under a folder", () => {
    expect(buffersAffectedBy("force-app/classes", dirty)).toEqual([
      "force-app/classes/A.cls",
      "force-app/classes/B.cls",
    ]);
  });

  it("ignores buffers outside the selection", () => {
    expect(buffersAffectedBy("force-app/lwc", dirty)).toEqual([
      "force-app/lwc/thing.js",
    ]);
  });

  it("ignores files edited back to their saved content", () => {
    expect(buffersAffectedBy("force-app/classes/Clean.cls", dirty)).toEqual([]);
  });

  // "classes" must not match "classes-old".
  it("does not match a sibling with a shared prefix", () => {
    expect(
      buffersAffectedBy("force-app/class", { "force-app/classes/A.cls": true }),
    ).toEqual([]);
  });
});
