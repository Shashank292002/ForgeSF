import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "../../../components/ui";
import ConnectOrgDialog from "./ConnectOrgDialog";

import styles from "./AddOrgButton.module.css";

export default function AddOrgButton() {
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.wrap}>
      <Button
        variant="gradient"
        size="lg"
        leftIcon={<Plus size={16} />}
        onClick={() => setOpen(true)}
      >
        Add Organization
      </Button>

      {open && <ConnectOrgDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
