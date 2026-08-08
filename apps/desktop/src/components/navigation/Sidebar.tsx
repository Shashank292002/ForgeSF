import { NavLink } from "react-router-dom";

const navItems = [
  { label: "Dashboard", path: "/" },
  { label: "Org Manager", path: "/orgs" },
  { label: "Metadata", path: "/metadata" },
  { label: "Workspace", path: "/workspace" },
  { label: "Deployments", path: "/deployments" },
  { label: "SOQL", path: "/soql" },
  { label: "Apex", path: "/apex" },
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