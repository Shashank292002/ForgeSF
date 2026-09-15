import { useState } from "react";
import { CloudOff, Plus } from "lucide-react";

import { Button } from "../../../components/ui";
import ConnectOrgDialog from "./ConnectOrgDialog";

import styles from "./EmptyState.module.css";

export default function EmptyState() {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.empty}>
      <div className={styles.card}>
        <span className={styles.icon}>
          <CloudOff size={36} />
        </span>

        <h3 className={styles.title}>No Organizations Connected</h3>

        <p className={styles.text}>
          Connect your first Salesforce organization — production, sandbox, or a
          My Domain login — to begin exploring metadata, running code, and
          deploying changes from ForgeSF.
        </p>

        <Button
          variant="gradient"
          size="lg"
          leftIcon={<Plus size={16} />}
          onClick={() => setOpen(true)}
        >
          Connect an Organization
        </Button>

        {open && <ConnectOrgDialog onClose={() => setOpen(false)} />}
      </div>
    </div>
  );
}
