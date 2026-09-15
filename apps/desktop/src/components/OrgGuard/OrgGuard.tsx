import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CloudOff, ArrowRight } from "lucide-react";

import useCurrentOrg from "../../hooks/useCurrentOrg";
import { useOrganizationStore } from "../../store/orgStore";
import { Button } from "../ui";

import styles from "./OrgGuard.module.css";

interface Props {
  children: ReactNode;
}

export default function OrgGuard({ children }: Props) {
  const { organization } = useCurrentOrg();
  const orgsLoaded = useOrganizationStore((s) => s.orgsLoaded);
  const navigate = useNavigate();

  // Before the first list arrives, "no organization" is not yet known — say
  // it is loading rather than telling the user to go connect one.
  if (!organization && !orgsLoaded) {
    return (
      <div className={styles.empty} role="status">
        <div className={styles.card}>
          <p className={styles.text}>Loading your organizations…</p>
        </div>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className={styles.empty}>
        <div className={styles.card}>
          <span className={styles.icon}>
            <CloudOff size={34} />
          </span>

          <h2 className={styles.title}>No Organization Connected</h2>

          <p className={styles.text}>
            Connect a Salesforce organization to unlock metadata browsing, code
            execution, SOQL queries, and deployments.
          </p>

          <Button
            variant="gradient"
            size="lg"
            rightIcon={<ArrowRight size={16} />}
            onClick={() => navigate("/organizations")}
          >
            Go to Organizations
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
