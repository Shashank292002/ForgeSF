import { useState } from "react";
import {
  Plug,
  Search,
  Package,
  Shield,
  Wand2,
  Box,
  Download,
  Check,
} from "lucide-react";

import { Button, Badge, Card, Input } from "../../components/ui";

import styles from "./PluginsPage.module.css";

interface Plugin {
  name: string;
  desc: string;
  author: string;
  version: string;
  icon: "brand" | "accent" | "warm" | "info";
  installed: boolean;
}

const plugins: Plugin[] = [
  {
    name: "Bulk Data Exporter",
    desc: "Export large data volumes to CSV in parallel for performance.",
    author: "ForgeSF",
    version: "1.4.0",
    icon: "accent",
    installed: true,
  },
  {
    name: "Flow Diagram View",
    desc: "Visualize Salesforce Flows as an interactive diagram.",
    author: "Community",
    version: "0.9.2",
    icon: "accent",
    installed: false,
  },
  {
    name: "Snippet Library",
    desc: "Reusable SOQL and Apex snippets shared across your team.",
    author: "ForgeSF",
    version: "2.1.0",
    icon: "brand",
    installed: true,
  },
  {
    name: "Code Formatter",
    desc: "Auto-format Apex and XML metadata before deployment.",
    author: "Community",
    version: "1.0.4",
    icon: "warm",
    installed: false,
  },
  {
    name: "Permission Scanner",
    desc: "Scan profiles and permission sets for unused access.",
    author: "ForgeSF",
    version: "0.5.0",
    icon: "info",
    installed: false,
  },
];

const iconMap: Record<Plugin["icon"], { class: string; Icon: typeof Plug }> = {
  brand: { class: styles.iconBrand, Icon: Shield },
  accent: { class: styles.iconAccent, Icon: Box },
  warm: { class: styles.iconWarm, Icon: Wand2 },
  info: { class: styles.iconInfo, Icon: Package },
};

export default function PluginsPage() {
  const [installed, setInstalled] = useState<Record<string, boolean>>(
    Object.fromEntries(plugins.map((p) => [p.name, p.installed])),
  );
  const [query, setQuery] = useState("");

  const filtered = plugins.filter((p) =>
    p.name.toLowerCase().includes(query.toLowerCase()),
  );

  function toggle(name: string) {
    setInstalled((s) => ({ ...s, [name]: !s[name] }));
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.headingIcon}>
            <Plug size={22} />
          </span>
          <div>
            <h1 className={styles.title}>Plugins</h1>
            <p className={styles.subtitle}>
              Extend ForgeSF with powerful community and first-party plugins.
            </p>
          </div>
        </div>

        <div className={styles.search}>
          <Search size={16} />
          <Input
            placeholder="Search plugins..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={styles.searchInput}
          />
        </div>
      </header>

      <div className={styles.grid}>
        {filtered.map((plugin) => {
          const { class: iconClass, Icon } = iconMap[plugin.icon];
          const isInstalled = installed[plugin.name];

          return (
            <Card key={plugin.name} interactive className={styles.card}>
              <div className={styles.cardTop}>
                <span className={`${styles.cardIcon} ${iconClass}`}>
                  <Icon size={22} />
                </span>

                <Badge tone={isInstalled ? "success" : "default"} dot>
                  {isInstalled ? "Installed" : "Not installed"}
                </Badge>
              </div>

              <div>
                <h3 className={styles.cardTitle}>{plugin.name}</h3>
                <p className={styles.cardDesc}>{plugin.desc}</p>
              </div>

              <div className={styles.meta}>
                <span>{plugin.author}</span>
                <span>v{plugin.version}</span>
              </div>

              <Button
                variant={isInstalled ? "secondary" : "gradient"}
                leftIcon={
                  isInstalled ? <Check size={15} /> : <Download size={15} />
                }
                onClick={() => toggle(plugin.name)}
              >
                {isInstalled ? "Uninstall" : "Install"}
              </Button>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
