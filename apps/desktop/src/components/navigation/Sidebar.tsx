import { NavLink } from "react-router-dom";

const navItems = [
  { label: "Dashboard", path: "/" },
  { label: "Organizations", path: "/organizations" },
  { label: "Workspace", path: "/workspace" },
  { label: "Deployments", path: "/deployments" },
  { label: "Developer Tools", path: "/devtools" },
  { label: "Plugins", path: "/plugins" },
  { label: "Settings", path: "/settings" },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <h2>ForgeSF</h2>

      <nav>
        {navItems.map((item) => (
          <NavLink key={item.path} to={item.path}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}