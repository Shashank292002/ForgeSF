// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import OrgDetailsDialog from "./OrgDetailsDialog";
import type { Organization } from "../types";

const getOrgDetails = vi.fn();
const getOrgLimits = vi.fn();

vi.mock("../../../services/tauri", () => ({
  getOrgDetails: (username: string) => getOrgDetails(username),
  getOrgLimits: (username: string) => getOrgLimits(username),
}));

const ORG: Organization = {
  id: "00Dxx0000000001EAA",
  alias: "AgentOrg",
  username: "dev@example.com",
  instanceUrl: "https://example.my.salesforce.com",
  orgType: "Developer",
  isDefault: true,
  status: "Connected",
};

function show(org: Organization = ORG) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OrgDetailsDialog org={org} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  getOrgDetails.mockReset();
  getOrgLimits.mockReset();
});

describe("OrgDetailsDialog", () => {
  it("shows what the org says about itself, and its tightest limits first", async () => {
    getOrgDetails.mockResolvedValue({
      instanceUrl: "https://example.my.salesforce.com",
      apiVersion: "67.0",
      username: "dev@example.com",
      orgId: "00Dxx0000000001EAA",
      alias: "AgentOrg",
      connectedStatus: "Connected",
      loginUrl: null,
      orgName: null,
      edition: null,
      status: null,
      createdDate: null,
      expirationDate: null,
    });
    getOrgLimits.mockResolvedValue([
      { name: "DailyApiRequests", max: 15000, remaining: 14000 },
      { name: "ActiveScratchOrgs", max: 3, remaining: 0 },
    ]);

    show();

    expect(await screen.findByText("67.0")).toBeTruthy();
    expect(screen.getByText("00Dxx0000000001EAA")).toBeTruthy();

    // Sorted by how full they are: the exhausted one leads.
    const names = screen
      .getAllByRole("meter")
      .map((meter) => meter.getAttribute("aria-label"));
    expect(names).toEqual(["Active Scratch Orgs", "Daily API Requests"]);
    expect(screen.getByText("1 running low")).toBeTruthy();

    // The filter narrows to one.
    fireEvent.change(screen.getByLabelText("Filter limits"), {
      target: { value: "daily" },
    });
    await waitFor(() => expect(screen.getAllByRole("meter")).toHaveLength(1));
    expect(screen.queryByText("No limit matches that filter.")).toBeNull();
  });

  it("reports a failure instead of showing an empty panel", async () => {
    getOrgDetails.mockRejectedValue({
      kind: "AuthRequired",
      message: "This org needs to be authorized again.",
    });
    getOrgLimits.mockRejectedValue({
      kind: "AuthRequired",
      message: "This org needs to be authorized again.",
    });

    show();

    expect(
      await screen.findByText("This org needs to be authorized again."),
    ).toBeTruthy();
    // Falls back to what the org list already knew rather than showing blanks:
    // the username appears in the header and again as a fact.
    expect(screen.getAllByText("dev@example.com").length).toBe(2);
    expect(screen.getByText("00Dxx0000000001EAA")).toBeTruthy();
  });
});
