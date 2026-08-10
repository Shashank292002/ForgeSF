import { useState } from "react";
import { useOrganizationStore } from "../../store/orgStore";
import { deployWorkspace } from "../../services/tauri";
import styles from "./DeploymentsPage.module.css";

type Status =
  | "ready"
  | "validating"
  | "deploying"
  | "success"
  | "failed";

export default function DeploymentsPage() {
  const org = useOrganizationStore((s) => s.selectedOrganization);
  const [status, setStatus] = useState<Status>("ready");
  const [logs, setLogs] = useState<string>("");

  async function runValidate() {
    if (!org) return;
    setLogs("");
    setStatus("validating");

    try {
      const out = await deployWorkspace(org.username, true);
      setLogs(out);
      setStatus("success");
    } catch (err: any) {
      setLogs(String(err));
      setStatus("failed");
    }
  }

  async function runDeploy() {
    if (!org) return;
    setLogs("");
    setStatus("deploying");

    try {
      const out = await deployWorkspace(org.username, false);
      setLogs(out);
      setStatus("success");
    } catch (err: any) {
      setLogs(String(err));
      setStatus("failed");
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1>Deployments</h1>
        <div className={styles.controls}>
          <div className={styles.orgLabel}>{org ? org.alias : "No org selected"}</div>
          <button
            className={styles.validate}
            onClick={runValidate}
            disabled={!org || status === "validating" || status === "deploying"}
          >
            Validate
          </button>
          <button
            className={styles.deploy}
            onClick={runDeploy}
            disabled={!org || status === "deploying"}
          >
            Deploy
          </button>
        </div>
      </header>

      <section className={styles.statusRow}>
        <div className={`${styles.statusPill} ${styles[status]}`}>{status}</div>
      </section>

      <section className={styles.output}>
        <pre>{logs || "No output yet."}</pre>
      </section>
    </div>
  );
}