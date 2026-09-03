export interface Organization {
  id: string;
  alias: string;
  username: string;
  instanceUrl: string;

  orgType: "Production" | "Sandbox" | "Scratch Org" | "Developer";

  isDefault: boolean;

  /**
   * Set by the app when an org is added, not by the CLI — optional because
   * orgs discovered via `sf org list` have no such timestamp.
   */
  connectedAt?: string;

  status: "Connected" | "Disconnected" | "Expired";
}
