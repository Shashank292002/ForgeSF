export interface Organization {
  id: string;
  alias: string;
  username: string;
  instanceUrl: string;

  orgType:
    | "Production"
    | "Sandbox"
    | "Scratch Org"
    | "Developer";

  isDefault: boolean;

  status:
    | "Connected"
    | "Disconnected"
    | "Expired";

  connectedAt: string;
}