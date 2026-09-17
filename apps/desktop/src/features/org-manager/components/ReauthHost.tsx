import { closeReauthentication, useReauthStore } from "../store/reauthStore";
import ConnectOrgDialog from "./ConnectOrgDialog";

/** The login dialog for re-authenticating an org. Mount once, at the root. */
export default function ReauthHost() {
  const org = useReauthStore((state) => state.org);
  if (!org) return null;

  return (
    <ConnectOrgDialog
      key={org.id}
      reauthenticate={org}
      onClose={closeReauthentication}
    />
  );
}
