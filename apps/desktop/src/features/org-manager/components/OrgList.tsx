import OrgCard from "./OrgCard";
import { useOrganizationStore } from "../../../store/orgStore";

export default function OrgList() {

  const organizations = useOrganizationStore(
    (state) => state.organizations
  );

  if (organizations.length === 0) {
    return (
      <p>
        No organizations connected yet.
      </p>
    );
  }

  return (
    <div>
      {organizations.map((org) => (
        <OrgCard
          key={org.id}
          org={org}
        />
      ))}
    </div>
  );
}