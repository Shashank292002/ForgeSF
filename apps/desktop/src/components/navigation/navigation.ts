import type { LucideIcon } from "lucide-react";
import {
  Home,
  Users,
  Rocket,
  Plug,
  Settings,
  TerminalSquare,
  FolderGit2,
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
    items: [{ label: "Dashboard", path: "/", icon: Home }],
  },
  {
    label: "Org",
    items: [{ label: "Organizations", path: "/organizations", icon: Users }],
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
