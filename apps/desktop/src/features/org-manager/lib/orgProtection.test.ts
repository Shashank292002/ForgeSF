import { describe, expect, it } from "vitest";

import { isProtectedOrg, protectionPrompt } from "./orgProtection";
import type { Organization } from "../types";

const org = (orgType: Organization["orgType"]): Organization => ({
  id: "00D",
  alias: "acme",
  username: "me@acme.com",
  instanceUrl: "https://acme.my.salesforce.com",
  orgType,
  isDefault: false,
  status: "Connected",
});

describe("isProtectedOrg", () => {
  it("protects Production", () => {
    expect(isProtectedOrg(org("Production"))).toBe(true);
  });

  it.each(["Sandbox", "Scratch Org", "Developer"] as const)(
    "leaves %s unprotected",
    (orgType) => {
      expect(isProtectedOrg(org(orgType))).toBe(false);
    },
  );

  it("treats no org as unprotected", () => {
    expect(isProtectedOrg(null)).toBe(false);
    expect(isProtectedOrg(undefined)).toBe(false);
  });
});

describe("protectionPrompt", () => {
  it("names the org and the action, as a destructive confirmation", () => {
    const prompt = protectionPrompt(org("Production"), "Log out");
    expect(prompt?.title).toBe("Log out on a production org?");
    expect(prompt?.details).toEqual([
      "acme",
      "me@acme.com",
      "https://acme.my.salesforce.com",
    ]);
    expect(prompt?.confirmLabel).toBe("Log out");
    expect(prompt?.tone).toBe("danger");
  });

  it("takes a shorter button label", () => {
    expect(
      protectionPrompt(org("Production"), "Run anonymous Apex", "Run Apex")
        ?.confirmLabel,
    ).toBe("Run Apex");
  });

  it("returns null when no confirmation is warranted", () => {
    expect(protectionPrompt(org("Sandbox"), "Log out")).toBeNull();
    expect(protectionPrompt(null, "Log out")).toBeNull();
  });
});
