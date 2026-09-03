import { useState } from "react";
import { CodeXml, Play, Eraser, TerminalSquare, Loader2 } from "lucide-react";

import { useOrganizationStore } from "../../store/orgStore";
import { runCommand } from "../../services/tauri";
import { Button, Badge } from "../../components/ui";
import OrgGuard from "../../components/OrgGuard/OrgGuard";

import styles from "./ApexPage.module.css";

const SAMPLE = `System.debug('Hello from ForgeSF 👋');
List<Account> accounts = [SELECT Id, Name FROM Account LIMIT 5];
System.debug('Found ' + accounts.size() + ' accounts');
for (Account a : accounts) {
    System.debug('Account: ' + a.Name);
}`;

export default function ApexPage() {
  const org = useOrganizationStore((s) => s.selectedOrganization);

  const [code, setCode] = useState<string>(SAMPLE);
  const [output, setOutput] = useState<string>("");
  const [running, setRunning] = useState(false);

  async function runApex() {
    if (!org) return;

    setRunning(true);
    setOutput("Running anonymous Apex...");

    try {
      const args = ["apex", "execute", "--target-org", org.username, "--json"];
      const res = await runCommand(args, code);
      setOutput(res);
    } catch (err: unknown) {
      setOutput(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function clear() {
    setCode("");
    setOutput("");
  }

  return (
    <OrgGuard>
      <div className={styles.page}>
        <header className={styles.header}>
          <div className={styles.titleBlock}>
            <span className={styles.icon}>
              <CodeXml size={22} />
            </span>
            <div>
              <h1 className={styles.title}>Anonymous Apex</h1>
              <p className={styles.subtitle}>
                Execute anonymous Apex code against your connected organization.
              </p>
            </div>
          </div>

          {org && (
            <Badge tone="success" dot>
              {org.alias}
            </Badge>
          )}
        </header>

        <div className={styles.toolbar}>
          <Button
            variant="gradient"
            leftIcon={
              running ? (
                <Loader2 size={15} className={styles.spin} />
              ) : (
                <Play size={15} />
              )
            }
            onClick={runApex}
            loading={running}
            disabled={!org}
          >
            {running ? "Running..." : "Run Apex"}
          </Button>

          <Button
            variant="secondary"
            leftIcon={<Eraser size={15} />}
            onClick={clear}
          >
            Clear
          </Button>

          <span className={styles.hint}>
            <TerminalSquare size={14} />
            Uses <code>sf apex execute</code>
          </span>
        </div>

        <div className={styles.columns}>
          <section className={styles.editorPanel}>
            <div className={styles.panelHead}>
              <span>Input</span>
              <Badge tone="info">Apex</Badge>
            </div>
            <textarea
              className={styles.editor}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Write anonymous Apex here..."
              spellCheck={false}
            />
          </section>

          <section className={styles.outputPanel}>
            <div className={styles.panelHead}>
              <span>Output</span>
              <Badge tone={running ? "warning" : "default"} dot>
                {running ? "Running" : "Idle"}
              </Badge>
            </div>
            <pre className={styles.output}>
              {output || "Run your anonymous Apex to see results here."}
            </pre>
          </section>
        </div>
      </div>
    </OrgGuard>
  );
}
