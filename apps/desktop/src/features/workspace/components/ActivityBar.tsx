import { useNavigate } from "react-router-dom";
import {
  Cloud,
  Database,
  Files,
  FileCode,
  FlaskConical,
  UploadCloud,
  Loader2,
  Search,
  Settings,
} from "lucide-react";

import { useOrganizationStore } from "../../../store/orgStore";
import { useWorkspaceStore } from "../store/workspaceStore";
import type { SidebarView } from "../types";

import "./ActivityBar.css";

interface Item {
  id: SidebarView;
  label: string;
  icon: typeof Files;
  shortcut: string;
}

const ITEMS: Item[] = [
  { id: "explorer", label: "Explorer", icon: Files, shortcut: "Ctrl+Shift+E" },
  { id: "search", label: "Search", icon: Search, shortcut: "Ctrl+Shift+F" },
  {
    id: "scm",
    label: "Pending Changes",
    icon: UploadCloud,
    shortcut: "Ctrl+Shift+G",
  },
  {
    id: "tests",
    label: "Apex Tests",
    icon: FlaskConical,
    shortcut: "Ctrl+Shift+T",
  },
  {
    id: "manifests",
    label: "Manifests",
    icon: FileCode,
    shortcut: "Ctrl+Shift+X",
  },
  {
    id: "metadata",
    label: "Metadata",
    icon: Database,
    shortcut: "Ctrl+Shift+M",
  },
  { id: "settings", label: "Settings", icon: Settings, shortcut: "Ctrl+," },
];

export default function ActivityBar() {
  const navigate = useNavigate();
  const activeView = useWorkspaceStore((state) => state.activeView);
  const setActiveView = useWorkspaceStore((state) => state.setActiveView);
  const sidebarVisible = useWorkspaceStore((state) => state.sidebarVisible);
  const deploying = useWorkspaceStore((state) => state.deploying);
  const dirtyCount = useWorkspaceStore(
    (state) => Object.keys(state.dirty).length,
  );
  const organization = useOrganizationStore(
    (state) => state.selectedOrganization,
  );

  return (
    <div className="fw-activitybar">
      <div className="fw-activitybar__top">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive =
            activeView === item.id &&
            (item.id !== "explorer" || sidebarVisible);
          const badge = item.id === "scm" && dirtyCount > 0 ? dirtyCount : null;

          return (
            <button
              key={item.id}
              type="button"
              className={`fw-activitybar__item ${isActive ? "is-active" : ""}`}
              title={`${item.label} (${item.shortcut})`}
              // The badge is a number in a dot; the label says what it counts.
              aria-label={
                badge === null ? item.label : `${item.label}, ${badge} unsaved`
              }
              aria-pressed={isActive}
              onClick={() => setActiveView(item.id)}
            >
              <Icon size={22} strokeWidth={1.75} />
              {badge !== null && (
                <span className="fw-activitybar__badge">{badge}</span>
              )}
            </button>
          );
        })}

        {deploying && (
          <div
            className="fw-activitybar__deploy"
            title="Deployment in progress"
          >
            <Loader2 size={18} className="spinning" />
          </div>
        )}
      </div>

      <div className="fw-activitybar__bottom">
        <button
          type="button"
          className={`fw-activitybar__item fw-activitybar__org ${
            organization ? "is-org" : ""
          }`}
          title={
            organization
              ? `Connected to ${organization.alias}`
              : "No org connected — open Org Manager"
          }
          // The green dot means connected; the label has to say it.
          aria-label={
            organization
              ? `Organization ${organization.alias}, connected`
              : "No organization connected"
          }
          onClick={() => navigate("/organizations")}
        >
          <Cloud size={19} strokeWidth={1.75} />
          <span
            className={`fw-activitybar__dot ${organization ? "is-online" : ""}`}
          />
        </button>
      </div>
    </div>
  );
}
