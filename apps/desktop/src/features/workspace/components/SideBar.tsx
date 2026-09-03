import type { ReactNode } from "react";
import { PanelLeftClose } from "lucide-react";

import "./SideBar.css";

interface SideBarProps {
  title: string;
  onCollapse: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export default function SideBar({
  title,
  onCollapse,
  actions,
  children,
}: SideBarProps) {
  return (
    <aside className="forge-sidebar">
      <header className="forge-sidebar__header">
        <span className="forge-sidebar__title">{title}</span>
        <div className="forge-sidebar__actions">
          {actions}
          <button
            type="button"
            className="forge-sidebar__icon-btn"
            title="Collapse Side Bar (Ctrl+B)"
            aria-label="Collapse side bar"
            onClick={onCollapse}
          >
            <PanelLeftClose size={15} />
          </button>
        </div>
      </header>
      <div className="forge-sidebar__content">{children}</div>
    </aside>
  );
}
