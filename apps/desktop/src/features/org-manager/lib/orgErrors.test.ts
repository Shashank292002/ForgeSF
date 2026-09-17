import { beforeEach, describe, expect, it } from "vitest";

import { useToastStore } from "../../../components/ui/Toast/toast";
import { useReauthStore } from "../store/reauthStore";
import type { Organization } from "../types";
import { offerReauthentication } from "./orgErrors";

const org: Organization = {
  id: "00Dxx",
  alias: "uat",
  username: "admin@uat.com",
  instanceUrl: "https://acme--uat.sandbox.my.salesforce.com",
  orgType: "Sandbox",
  isDefault: false,
  status: "Connected",
};

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  useReauthStore.setState({ org: null });
});

describe("offerReauthentication", () => {
  it("offers to log in again when the session expired", () => {
    const offered = offerReauthentication(
      {
        kind: "authRequired",
        message: "Error authenticating with the refresh token.",
      },
      org,
    );

    expect(offered).toBe(true);
    const [notice] = useToastStore.getState().toasts;
    expect(notice.title).toBe("uat needs you to log in again");
    expect(notice.durationMs).toBeNull();

    notice.action?.onClick();
    expect(useReauthStore.getState().org).toBe(org);
  });

  it("leaves other failures to the caller", () => {
    expect(
      offerReauthentication({ kind: "failed", message: "Bad SOQL." }, org),
    ).toBe(false);
    expect(offerReauthentication(new Error("boom"), org)).toBe(false);
    expect(
      offerReauthentication({ kind: "authRequired", message: "x" }, null),
    ).toBe(false);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});
