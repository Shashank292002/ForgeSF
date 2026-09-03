import { Plus } from "lucide-react";

import { Button } from "../../../components/ui";
import { useConnectOrg } from "../hooks/useConnectOrg";

import styles from "./AddOrgButton.module.css";

export default function AddOrgButton() {
  const { connect, loading, error } = useConnectOrg();

  return (
    <div className={styles.wrap}>
      <Button
        variant="gradient"
        size="lg"
        leftIcon={<Plus size={16} />}
        onClick={() => void connect()}
        loading={loading}
      >
        {loading ? "Connecting..." : "Add Organization"}
      </Button>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
