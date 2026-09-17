import { describe, expect, it } from "vitest";

import {
  changesOrg,
  cliProtectionPrompt,
  commandWords,
  stripCliName,
  targetOrgFor,
} from "./sfCli";
import type { Organization } from "@/features/org-manager/types";

const org = (
  alias: string,
  username: string,
  isDefault = false,
): Organization => ({
  id: `00D-${alias}`,
  alias,
  username,
  instanceUrl: `https://${alias}.my.salesforce.com`,
  orgType: "Production",
  isDefault,
  status: "Connected",
});

const prod = org("prod", "admin@acme.com", true);
const uat: Organization = {
  ...org("uat", "admin@acme.com.uat"),
  orgType: "Sandbox",
};
const orgs = [prod, uat];

describe("cliProtectionPrompt", () => {
  it("asks before a production org is changed", () => {
    const prompt = cliProtectionPrompt(
      ["apex", "run", "--target-org", "prod"],
      orgs,
    );
    expect(prompt?.title).toBe('Run "sf apex run" on a production org?');
    expect(prompt?.confirmLabel).toBe("Run");
    expect(prompt?.tone).toBe("danger");
  });

  it("asks when the default org is production and none is named", () => {
    expect(
      cliProtectionPrompt(["project", "deploy", "start"], orgs)?.title,
    ).toContain("production org");
  });

  it("lets a sandbox change run without asking", () => {
    expect(
      cliProtectionPrompt(["data", "delete", "record", "-o", "uat"], orgs),
    ).toBeNull();
  });

  it("asks when the target cannot be identified", () => {
    expect(
      cliProtectionPrompt(["data", "delete", "record", "-o", "unknown"], orgs)
        ?.message,
    ).toContain("cannot tell which org");
  });

  it("never asks for a read-only command", () => {
    expect(
      cliProtectionPrompt(["org", "display", "-o", "prod"], orgs),
    ).toBeNull();
  });
});

describe("stripCliName", () => {
  it("removes a leading sf or sfdx", () => {
    expect(stripCliName(["sf", "org", "display"])).toEqual(["org", "display"]);
    expect(stripCliName(["SFDX", "force:org:list"])).toEqual([
      "force:org:list",
    ]);
  });

  it("leaves a command without the CLI name alone", () => {
    expect(stripCliName(["org", "display"])).toEqual(["org", "display"]);
  });
});

describe("commandWords", () => {
  it("stops at the first flag and splits colon syntax", () => {
    expect(commandWords(["project:deploy:start", "--target-org", "x"])).toEqual(
      ["project", "deploy", "start"],
    );
  });
});

describe("targetOrgFor", () => {
  it("uses the org named by --target-org or -o", () => {
    expect(
      targetOrgFor(["data", "delete", "record", "--target-org", "uat"], orgs),
    ).toBe(uat);
    expect(
      targetOrgFor(["apex", "run", "-o", "admin@acme.com.uat"], orgs),
    ).toBe(uat);
  });

  it("reads the inline --flag=value form", () => {
    expect(
      targetOrgFor(["project", "deploy", "start", "--target-org=UAT"], orgs),
    ).toBe(uat);
  });

  it("falls back to the CLI default org", () => {
    expect(targetOrgFor(["project", "deploy", "start"], orgs)).toBe(prod);
  });

  it("returns undefined for an org the app does not know", () => {
    expect(
      targetOrgFor(["apex", "run", "-o", "stranger"], orgs),
    ).toBeUndefined();
  });
});

describe("changesOrg", () => {
  it.each([
    "project deploy start --source-dir force-app",
    "project deploy quick --job-id 0Af",
    "data delete record --sobject Account --record-id 001",
    "data upsert bulk --sobject Account --file a.csv",
    "apex run --file script.apex",
    "force:source:deploy -p force-app",
    "org delete scratch",
  ])("flags %s", (line) => {
    expect(changesOrg(line.split(" "))).toBe(true);
  });

  it.each([
    "org display",
    "data query --query SELECT",
    "project retrieve start --metadata ApexClass",
    "project deploy validate --source-dir force-app",
    "apex run test --class-names FooTest",
    "org list",
  ])("does not flag %s", (line) => {
    expect(changesOrg(line.split(" "))).toBe(false);
  });
});
