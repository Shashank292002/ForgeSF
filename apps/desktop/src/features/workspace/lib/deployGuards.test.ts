import { describe, expect, it } from "vitest";

import { buffersAffectedBy, needsDeployConfirmation } from "./deployGuards";
import type { Organization } from "../../org-manager/types";

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
