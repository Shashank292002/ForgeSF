import type { LucideIcon } from "lucide-react";
import {
  Home,
  Users,
  Database,
  Layers,
  Box,
  CodeXml,
  Rocket,
  Plug,
  Settings,
  TerminalSquare,
  FolderGit2,
  Hammer,
} from "lucide-react";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const navigationGroups: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", path: "/", icon: Home },
    ],
  },
  {
    label: "Org",
    items: [
      { label: "Organizations", path: "/organizations", icon: Users },
    ],
  },
  {
    label: "Develop",
    items: [
      { label: "Workspace", path: "/workspace", icon: FolderGit2 },
      { label: "Developer Tools", path: "/devtools", icon: TerminalSquare },
      { label: "Deployments", path: "/deployments", icon: Rocket },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Plugins", path: "/plugins", icon: Plug },
      { label: "Settings", path: "/settings", icon: Settings },
    ],
  },
];

export const navigation: NavItem[] = navigationGroups.flatMap((g) => g.items);

/** Legacy flat icon lookup kept for backward compatibility. */
export function iconForLabel(label: string): LucideIcon {
  const key = label.toLowerCase();
  if (key.includes("dashboard")) return Home;
  if (key.includes("organ")) return Users;
  if (key.includes("meta")) return Database;
  if (key.includes("workspace")) return Layers;
  if (key.includes("deploy")) return Rocket;
  if (key.includes("dev")) return TerminalSquare;
  if (key.includes("apex")) return CodeXml;
  if (key.includes("plugin")) return Plug;
  if (key.includes("setting")) return Settings;
  return Box;
}

export { Hammer };
