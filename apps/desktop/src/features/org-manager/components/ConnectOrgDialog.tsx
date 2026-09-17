import { useId, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { Button, Dialog, Input } from "../../../components/ui";
import { useConnectOrg } from "../hooks/useConnectOrg";
import type { Organization } from "../types";

import styles from "./ConnectOrgDialog.module.css";

type Environment = "production" | "sandbox" | "custom";

const ENVIRONMENTS: Array<{ key: Environment; label: string; hint: string }> = [
  {
    key: "production",
    label: "Production / Developer",
    hint: "login.salesforce.com",
  },
  { key: "sandbox", label: "Sandbox", hint: "test.salesforce.com" },
  { key: "custom", label: "My Domain", hint: "Your org's own login URL" },
];

const SANDBOX_LOGIN = "https://test.salesforce.com";

export interface ConnectOrgDialogProps {
  onClose: () => void;
  /** Called with the org once it is connected. */
  onConnected?: (organization: Organization) => void;
  /** Re-authenticating an existing org: log in at its URL, keep its alias. */
  reauthenticate?: Organization;
}

/**
 * Where to log in, and under which alias.
 *
 * Connecting used to always open production's login page, so sandboxes and
 * orgs that require their My Domain login could not be added at all.
 */
export default function ConnectOrgDialog({
  onClose,
  onConnected,
  reauthenticate,
}: ConnectOrgDialogProps) {
  const { connect, cancel, loading, error } = useConnectOrg();
  const idPrefix = useId();

  const [environment, setEnvironment] = useState<Environment>(
    reauthenticate ? "custom" : "production",
  );
  const [customUrl, setCustomUrl] = useState(reauthenticate?.instanceUrl ?? "");
  const [alias, setAlias] = useState(
    reauthenticate && reauthenticate.alias !== reauthenticate.username
      ? reauthenticate.alias
      : "",
  );
  const [setDefault, setSetDefault] = useState(false);

  const customMissing = environment === "custom" && !customUrl.trim();

  async function submit() {
    if (loading || customMissing) return;
    const organization = await connect({
      instanceUrl:
        environment === "sandbox"
          ? SANDBOX_LOGIN
          : environment === "custom"
            ? customUrl.trim()
            : null,
      alias: alias.trim() || null,
      setDefault,
    });
    if (organization) {
      onConnected?.(organization);
      onClose();
    }
  }

  // Closing mid-login abandons it rather than leaving the CLI waiting.
  function close() {
    if (loading) cancel();
    onClose();
  }

  return (
    <Dialog
      title={
        reauthenticate
          ? `Re-authenticate ${reauthenticate.alias}`
          : "Connect a Salesforce org"
      }
      description="You'll finish signing in in your browser. ForgeSF stores the connection through the Salesforce CLI."
      onClose={close}
      footer={
        loading ? (
          <>
            <span className={styles.waiting} role="status">
              <Loader2 size={14} className={styles.spin} />
              Waiting for you to finish in the browser…
            </span>
            <Button variant="secondary" onClick={cancel}>
              Cancel login
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
            <Button
              variant="gradient"
              rightIcon={<ExternalLink size={15} />}
              onClick={() => void submit()}
              disabled={customMissing}
            >
              Continue in browser
            </Button>
          </>
        )
      }
    >
      <fieldset className={styles.fieldset} disabled={loading}>
        <legend className={styles.label}>Log in to</legend>
        <div className={styles.environments}>
          {ENVIRONMENTS.map((option) => (
            <label
              key={option.key}
              className={`${styles.environment} ${
                environment === option.key ? styles.environmentActive : ""
              }`}
            >
              <input
                type="radio"
                name={`${idPrefix}-environment`}
                value={option.key}
                checked={environment === option.key}
                onChange={() => setEnvironment(option.key)}
              />
              <span className={styles.environmentLabel}>{option.label}</span>
              <span className={styles.environmentHint}>{option.hint}</span>
            </label>
          ))}
        </div>

        {environment === "custom" && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor={`${idPrefix}-url`}>
              Login URL
            </label>
            <Input
              id={`${idPrefix}-url`}
              placeholder="https://acme.my.salesforce.com"
              value={customUrl}
              onChange={(event) => setCustomUrl(event.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${idPrefix}-alias`}>
            Alias <span className={styles.optional}>(optional)</span>
          </label>
          <Input
            id={`${idPrefix}-alias`}
            placeholder="e.g. uat"
            value={alias}
            onChange={(event) => setAlias(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <label className={styles.checkbox}>
          <input
            type="checkbox"
            checked={setDefault}
            onChange={(event) => setSetDefault(event.target.checked)}
          />
          Make this the Salesforce CLI's default org
        </label>
      </fieldset>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
