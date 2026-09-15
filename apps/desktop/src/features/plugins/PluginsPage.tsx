import { useState } from "react";
import { Plug, Search, Package, Shield, Wand2, Box } from "lucide-react";

import { Badge, Card, Input } from "../../components/ui";

import styles from "./PluginsPage.module.css";

interface PluginIdea {
  name: string;
  desc: string;
  icon: "brand" | "accent" | "warm" | "info";
}

/**
 * Plugin ideas, not installable plugins.
 *
 * This page used to present a catalogue with authors, version numbers,
 * "Installed" badges and working Install/Uninstall toggles — none of which did
 * anything. Until the plugin SDK exists it says what it is: a preview of what
 * extensions could look like.
 */
const ideas: PluginIdea[] = [
  {
    name: "Bulk Data Exporter",
    desc: "Export large data volumes to CSV in parallel for performance.",
    icon: "accent",
  },
  {
    name: "Flow Diagram View",
    desc: "Visualize Salesforce Flows as an interactive diagram.",
    icon: "accent",
  },
  {
    name: "Snippet Library",
    desc: "Reusable SOQL and Apex snippets shared across your team.",
    icon: "brand",
  },
  {
    name: "Code Formatter",
    desc: "Auto-format Apex and XML metadata before deployment.",
    icon: "warm",
  },
  {
    name: "Permission Scanner",
    desc: "Scan profiles and permission sets for unused access.",
    icon: "info",
  },
];

const iconMap: Record<
  PluginIdea["icon"],
  { class: string; Icon: typeof Plug }
> = {
  brand: { class: styles.iconBrand, Icon: Shield },
  accent: { class: styles.iconAccent, Icon: Box },
  warm: { class: styles.iconWarm, Icon: Wand2 },
  info: { class: styles.iconInfo, Icon: Package },
};

export default function PluginsPage() {
  const [query, setQuery] = useState("");

  const filtered = ideas.filter((idea) =>
    idea.name.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <span className={styles.headingIcon}>
            <Plug size={22} />
          </span>
          <div>
            <h1 className={styles.title}>
              Plugins{" "}
              <Badge tone="info" dot>
                Preview
              </Badge>
            </h1>
            <p className={styles.subtitle}>
              Plugin support is on the roadmap. These are ideas for what
              extensions could do — nothing here can be installed yet.
            </p>
          </div>
        </div>

        <div className={styles.search}>
          <Search size={16} />
          <Input
            placeholder="Search ideas..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={styles.searchInput}
          />
        </div>
      </header>

      <div className={styles.grid}>
        {filtered.map((idea) => {
          const { class: iconClass, Icon } = iconMap[idea.icon];

          return (
            <Card key={idea.name} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={`${styles.cardIcon} ${iconClass}`}>
                  <Icon size={22} />
                </span>

                <Badge tone="default" dot>
                  Planned
                </Badge>
              </div>

              <div>
                <h3 className={styles.cardTitle}>{idea.name}</h3>
                <p className={styles.cardDesc}>{idea.desc}</p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
