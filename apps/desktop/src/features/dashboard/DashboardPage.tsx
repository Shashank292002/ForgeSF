import { Link, useNavigate } from "react-router-dom";
import {
  Users,
  Database,
  FolderGit2,
  TerminalSquare,
  Rocket,
  CodeXml,
  ArrowRight,
  Cloud,
  CheckCircle2,
  Activity,
  Sparkles,
} from "lucide-react";

import useCurrentOrg from "../../hooks/useCurrentOrg";
import { useOrganizationStore } from "../../store/orgStore";
import { Badge, Button, Card } from "../../components/ui";

import styles from "./DashboardPage.module.css";

const quickActions = [
  {
    label: "Organizations",
    desc: "Connect & manage orgs",
    path: "/organizations",
    icon: Users,
    gradient: "var(--gradient-orgs)",
  },
  {
    label: "Metadata Explorer",
    desc: "Browse & retrieve metadata",
    path: "/metadata",
    icon: Database,
    gradient: "var(--gradient-metadata)",
  },
  {
    label: "Workspace",
    desc: "Edit, compare & deploy files",
    path: "/workspace",
    icon: FolderGit2,
    gradient: "var(--gradient-workspace)",
  },
  {
    label: "Developer Tools",
    desc: "SOQL, SOSL, Apex & CLI",
    path: "/devtools",
    icon: TerminalSquare,
    gradient: "var(--gradient-devtools)",
  },
  {
    label: "Apex",
    desc: "Anonymous Apex runner",
    path: "/apex",
    icon: CodeXml,
    gradient: "var(--gradient-apex)",
  },
  {
    label: "Deployments",
    desc: "Validate & deploy changes",
    path: "/deployments",
    icon: Rocket,
    gradient: "var(--gradient-deploy)",
  },
];

export default function DashboardPage() {
  const navigate = useNavigate();
  const { organization } = useCurrentOrg();
  const orgCount = useOrganizationStore((s) => s.organizations.length);

  const firstName = organization?.username
    ? organization.username.split("@")[0]
    : "Developer";

  return (
    <div className={styles.page}>
      {/* Hero */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroContent}>
          <Badge tone="purple" dot>
            {organization ? "Ready to build" : "Connect an org to begin"}
          </Badge>

          <h1 className={styles.heroTitle}>
            Welcome back,{" "}
            <span className={styles.gradientText}>{firstName}</span>
          </h1>

          <p className={styles.heroSubtitle}>
            A modern Salesforce development toolkit — browse metadata, run code,
            and deploy with confidence, all from one vibrant workspace.
          </p>

          <div className={styles.heroActions}>
            <Button
              variant="gradient"
              size="lg"
              leftIcon={<Sparkles size={16} />}
              onClick={() => navigate("/organizations")}
            >
              {organization ? "Manage Orgs" : "Connect an Org"}
            </Button>
            <Link to="/workspace" className={styles.heroLink}>
              Open Workspace <ArrowRight size={16} />
            </Link>
          </div>
        </div>

        <div className={styles.heroStat}>
          <span className={styles.heroStatValue}>{orgCount}</span>
          <span className={styles.heroStatLabel}>Connected Orgs</span>
        </div>
      </section>

      {/* Stat cards */}
      <section className={styles.statsGrid}>
        <Card accent="primary" interactive className={styles.statCard}>
          <div className={styles.statInner}>
            <span className={`${styles.statIcon} ${styles.statIconPrimary}`}>
              <Cloud size={20} />
            </span>
            <div>
              <span className={styles.statValue}>{orgCount}</span>
              <span className={styles.statLabel}>Organizations</span>
            </div>
          </div>
        </Card>

        <Card accent="accent" interactive className={styles.statCard}>
          <div className={styles.statInner}>
            <span className={`${styles.statIcon} ${styles.statIconAccent}`}>
              <CheckCircle2 size={20} />
            </span>
            <div>
              <span className={styles.statValue}>
                {organization ? "Connected" : "Idle"}
              </span>
              <span className={styles.statLabel}>Org Status</span>
            </div>
          </div>
        </Card>

        <Card accent="warm" interactive className={styles.statCard}>
          <div className={styles.statInner}>
            <span className={`${styles.statIcon} ${styles.statIconWarm}`}>
              <Rocket size={20} />
            </span>
            <div>
              <span className={styles.statValue}>Ready</span>
              <span className={styles.statLabel}>Deploy Pipeline</span>
            </div>
          </div>
        </Card>
      </section>

      {/* Quick actions + org details */}
      <div className={styles.lowerGrid}>
        <section>
          <h2 className={styles.sectionTitle}>Quick Actions</h2>

          <div className={styles.quickGrid}>
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.path}
                  to={action.path}
                  className={styles.quickCard}
                >
                  <span
                    className={styles.quickIcon}
                    style={{ background: action.gradient }}
                  >
                    <Icon size={20} />
                  </span>

                  <div className={styles.quickText}>
                    <span className={styles.quickLabel}>{action.label}</span>
                    <span className={styles.quickDesc}>{action.desc}</span>
                  </div>

                  <ArrowRight size={16} className={styles.quickArrow} />
                </Link>
              );
            })}
          </div>
        </section>

        <section className={styles.sideCol}>
          {/* Connected org */}
          <Card
            title={organization ? organization.alias : "No Org Selected"}
            subtitle={
              organization
                ? "Active organization"
                : "Connect one to get started"
            }
            icon={<Cloud size={20} />}
            action={
              organization ? (
                <Badge tone="success" dot>
                  {organization.orgType}
                </Badge>
              ) : undefined
            }
          >
            {organization ? (
              <ul className={styles.orgList}>
                <li>
                  <span>Username</span>
                  <code>{organization.username}</code>
                </li>
                <li>
                  <span>Instance URL</span>
                  <code className={styles.url}>{organization.instanceUrl}</code>
                </li>
                <li>
                  <span>Type</span>
                  <code>{organization.orgType}</code>
                </li>
                <li>
                  <span>Status</span>
                  <Badge
                    tone={
                      organization.status === "Connected"
                        ? "success"
                        : "warning"
                    }
                  >
                    {organization.status}
                  </Badge>
                </li>
              </ul>
            ) : (
              <p className={styles.emptyOrg}>
                No Salesforce organization connected yet. Head to Organizations
                to sign in.
              </p>
            )}
          </Card>

          {/* Activity */}
          <Card
            title="Recent Activity"
            icon={<Activity size={20} />}
            subtitle="What's happening in your workspace"
          >
            <ul className={styles.activityList}>
              <li>
                <Activity size={14} />
                <span>No recent events — start by connecting your org.</span>
              </li>
            </ul>
          </Card>
        </section>
      </div>
    </div>
  );
}
