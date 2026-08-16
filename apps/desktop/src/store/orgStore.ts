import { create } from "zustand";
import type { Organization } from "../features/org-manager/types";

import {
  saveOrganizations,
  saveSelectedOrganizationId,
} from "../services/storage";

interface OrganizationState {

  organizations: Organization[];

  selectedOrganization: Organization | null;

  selectedOrganizationId: string | null;

  setOrganizations: (
    organizations: Organization[]
  ) => void;

  addOrganization: (
    organization: Organization
  ) => void;

  removeOrganization: (
    id: string
  ) => void;

  setSelectedOrganization: (
    organization: Organization | null
  ) => void;

}

export const useOrganizationStore =
create<OrganizationState>((set) => ({

  organizations: [],

  selectedOrganization: null,

  selectedOrganizationId: null,

  setOrganizations: (organizations) => {

    set({
      organizations
    });

  },

  addOrganization: (organization) => {

    set((state) => {

      const updated = [
        ...state.organizations,
        organization
      ];

      void saveOrganizations(updated);

      return {
        organizations: updated
      };

    });

  },

  removeOrganization: (id) => {

    set((state) => {

      const updated =
        state.organizations.filter(
          org => org.id !== id
        );

      const selected =
        state.selectedOrganization?.id === id
          ? updated[0] ?? null
          : state.selectedOrganization;

      void saveOrganizations(updated);

      void saveSelectedOrganizationId(
        selected?.id ?? null
      );

      return {

        organizations: updated,

        selectedOrganization: selected,

        selectedOrganizationId:
          selected?.id ?? null

      };

    });

  },

  setSelectedOrganization: (
    organization
  ) => {

    void saveSelectedOrganizationId(
      organization?.id ?? null
    );

    set({

      selectedOrganization:
        organization,

      selectedOrganizationId:
        organization?.id ?? null

    });

  },

}));