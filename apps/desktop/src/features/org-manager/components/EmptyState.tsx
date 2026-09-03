import { CloudOff, Plus } from "lucide-react";

import { Button } from "../../../components/ui";
import { useConnectOrg } from "../hooks/useConnectOrg";

import styles from "./EmptyState.module.css";

export default function EmptyState() {
  const { connect, loading, error } = useConnectOrg();

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
          onClick={() => void connect()}
          loading={loading}
        >
          {loading ? "Connecting..." : "Connect an Organization"}
        </Button>

        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
