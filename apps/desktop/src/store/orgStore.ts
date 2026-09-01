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

  /** False until the initial CLI reconciliation has finished. */
  orgsLoaded: boolean;

  /** Set when the CLI could not be reached and the cached list is in use. */
  orgLoadError: string | null;

  /** Replaces the list and persists it. */
  setOrganizations: (organizations: Organization[]) => void;

  addOrganization: (organization: Organization) => void;

  removeOrganization: (id: string) => void;

  setSelectedOrganization: (organization: Organization | null) => void;
}

export const useOrganizationStore = create<OrganizationState>((set) => ({
  organizations: [],

  selectedOrganization: null,

  selectedOrganizationId: null,

  orgsLoaded: false,

  orgLoadError: null,

  setOrganizations: (organizations) => {
    // Persisting here too: this used to be the one mutation that did not
    // write through, so the store's contract depended on which setter ran.
    void saveOrganizations(organizations);

    set({
      organizations,
    });
  },

  addOrganization: (organization) => {
    set((state) => {
      // Re-connecting an existing org replaced nothing and appended a second
      // entry with the same id, producing duplicate React keys.
      const existing = state.organizations.findIndex(
        (org) => org.id === organization.id,
      );

      const updated =
        existing === -1
          ? [...state.organizations, organization]
          : state.organizations.map((org, index) =>
              index === existing ? organization : org,
            );

      void saveOrganizations(updated);

      return {
        organizations: updated,

        // A freshly connected org is almost always the one you want active.
        selectedOrganization: organization,

        selectedOrganizationId: organization.id,
      };
    });

    void saveSelectedOrganizationId(organization.id);
  },

  removeOrganization: (id) => {
    set((state) => {
      const updated = state.organizations.filter((org) => org.id !== id);

      const selected =
        state.selectedOrganization?.id === id
          ? (updated[0] ?? null)
          : state.selectedOrganization;

      void saveOrganizations(updated);

      void saveSelectedOrganizationId(selected?.id ?? null);

      return {
        organizations: updated,

        selectedOrganization: selected,

        selectedOrganizationId: selected?.id ?? null,
      };
    });
  },

  setSelectedOrganization: (organization) => {
    void saveSelectedOrganizationId(organization?.id ?? null);

    set({
      selectedOrganization: organization,

      selectedOrganizationId: organization?.id ?? null,
    });
  },
}));
