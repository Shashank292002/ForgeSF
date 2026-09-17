import type { LucideIcon } from "lucide-react";
import {
  Database,
  Home,
  Users,
  Rocket,
  Plug,
  Settings,
  TerminalSquare,
  FolderGit2,
  Network,
  ScrollText,
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
      // A real route that had no way in but a Dashboard tile.
      { label: "Metadata", path: "/metadata", icon: Database },
      { label: "Developer Tools", path: "/devtools", icon: TerminalSquare },
      { label: "Debug Logs", path: "/logs", icon: ScrollText },
      { label: "Dependencies", path: "/dependencies", icon: Network },
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
