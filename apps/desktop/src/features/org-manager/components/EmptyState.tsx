import { CloudOff, Plus } from "lucide-react";
import { useState } from "react";

import { useOrganizationStore } from "../../../store/orgStore";
import { connectSalesforce } from "../../../services/tauri";
import { Button } from "../../../components/ui";

import styles from "./EmptyState.module.css";

export default function EmptyState() {
  const addOrganization = useOrganizationStore((s) => s.addOrganization);
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    try {
      setLoading(true);
      const organization = await connectSalesforce();
      addOrganization(organization);
    } catch (error) {
      console.error("Failed to connect to Salesforce:", error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.empty}>
      <div className={styles.card}>
        <span className={styles.icon}>
          <CloudOff size={36} />
        </span>

        <h3 className={styles.title}>No Organizations Connected</h3>

        <p className={styles.text}>
          Connect your first Salesforce organization to begin exploring
          metadata, running code, and deploying changes from ForgeSF.
        </p>

        <Button
          variant="gradient"
          size="lg"
          leftIcon={<Plus size={16} />}
          onClick={handleConnect}
          loading={loading}
        >
          {loading ? "Connecting..." : "Connect an Organization"}
        </Button>
      </div>
    </div>
  );
}

