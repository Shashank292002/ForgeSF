import { useEffect } from "react";

import OrgList from "./components/OrgList";
import AddOrgButton from "./components/AddOrgButton";

import {
  getOrganizations,
  getSelectedOrganizationId
} from "../../services/storage";

import {
  useOrganizationStore
} from "../../store/orgStore";

export default function OrgManagerPage() {

  const setOrganizations =
    useOrganizationStore(
      state => state.setOrganizations
    );

  const setSelectedOrganization =
    useOrganizationStore(
      state => state.setSelectedOrganization
    );

  useEffect(() => {

    async function loadOrganizations() {

      const organizations =
        await getOrganizations();

      const selectedOrganizationId =
        await getSelectedOrganizationId();

      setOrganizations(
        organizations
      );

      const selectedOrganization =
        organizations.find(
          org => org.id === selectedOrganizationId
        ) ??
        organizations[0] ??
        null;

      setSelectedOrganization(
        selectedOrganization
      );

    }

    loadOrganizations();

  }, [
    setOrganizations,
    setSelectedOrganization
  ]);

  return (
    <>
      <h1>
        Organizations
      </h1>

      <AddOrgButton />

      <OrgList />
    </>
  );

}