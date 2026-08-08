import { useEffect } from "react";
import type { ReactNode } from "react";

import {
  getOrganizations,
  getSelectedOrganizationId,
} from "../services/storage";

import { useOrganizationStore } from "../store/orgStore";

interface Props {
  children: ReactNode;
}

export default function AppInitializer({
  children,
}: Props) {

  const setOrganizations =
    useOrganizationStore(
      (state) => state.setOrganizations
    );

  useEffect(() => {

    async function initialize() {

      try {

        const organizations =
          await getOrganizations();

        const selectedOrganizationId =
          await getSelectedOrganizationId();

        const selectedOrganization =
          organizations.find(
            (org) => org.id === selectedOrganizationId
          ) ??
          organizations[0] ??
          null;

        useOrganizationStore.setState({

          organizations,

          selectedOrganization,

          selectedOrganizationId:
            selectedOrganization?.id ?? null,

        });

        console.log(
          "Loaded organizations:",
          organizations
        );

        console.log(
          "Active organization:",
          selectedOrganization
        );

      } catch (error) {

        console.error(
          "Failed to initialize application:",
          error
        );

      }

    }

    initialize();

  }, [setOrganizations]);

  return <>{children}</>;
}