import { create } from "zustand";

import type { MetadataType } from "../features/metadata/types";

interface MetadataState {
  /**
   * Username of the org `metadata` was loaded from.
   *
   * Selections are scoped to it: the store previously kept one global
   * selection, so switching orgs left you able to retrieve or deploy types
   * and components belonging to the *previous* org.
   */
  orgUsername: string | null;

  /** Metadata types available in `orgUsername`'s org. */
  metadata: MetadataType[];

  /** Metadata types selected for an upcoming retrieve or deploy. */
  selectedTypes: string[];

  /** Components picked per metadata type (`Kind -> [member, …]`). */
  selectedMembers: Record<string, string[]>;

  /** Replaces the type list, clearing selections when the org changed. */
  setMetadata: (orgUsername: string, metadata: MetadataType[]) => void;

  setSelectedTypes: (types: string[]) => void;
  toggleType: (xmlName: string) => void;
  clearTypes: () => void;

  /** Toggles one component of a metadata type. */
  toggleMember: (xmlName: string, member: string) => void;

  /** Replaces the whole member selection for one metadata type. */
  setMembers: (xmlName: string, members: string[]) => void;

  /** Clears the member selection for one metadata type (back to "all"). */
  clearMemberSelection: (xmlName: string) => void;

  /** Clears every per-type component selection. */
  clearAllMembers: () => void;
}

export const useMetadataStore = create<MetadataState>((set) => ({
  orgUsername: null,

  metadata: [],

  selectedTypes: [],

  selectedMembers: {},

  setMetadata: (orgUsername, metadata) =>
    set((state) => {
      const sameOrg = state.orgUsername === orgUsername;
      return {
        orgUsername,
        metadata,
        selectedTypes: sameOrg ? state.selectedTypes : [],
        selectedMembers: sameOrg ? state.selectedMembers : {},
      };
    }),

  setSelectedTypes: (selectedTypes) => set({ selectedTypes }),

  toggleType: (xmlName) =>
    set((state) => {
      if (!state.selectedTypes.includes(xmlName)) {
        return { selectedTypes: [...state.selectedTypes, xmlName] };
      }

      // Deselecting a type also drops its component selection, so
      // re-selecting it later starts from "all components".
      const selectedMembers = { ...state.selectedMembers };
      delete selectedMembers[xmlName];
      return {
        selectedTypes: state.selectedTypes.filter((item) => item !== xmlName),
        selectedMembers,
      };
    }),

  clearTypes: () => set({ selectedTypes: [], selectedMembers: {} }),

  toggleMember: (xmlName, member) =>
    set((state) => {
      const current = state.selectedMembers[xmlName] ?? [];
      const next = current.includes(member)
        ? current.filter((item) => item !== member)
        : [...current, member];
      return {
        selectedMembers: { ...state.selectedMembers, [xmlName]: next },
      };
    }),

  setMembers: (xmlName, members) =>
    set((state) => ({
      selectedMembers: { ...state.selectedMembers, [xmlName]: members },
    })),

  clearMemberSelection: (xmlName) =>
    set((state) => {
      const next = { ...state.selectedMembers };
      delete next[xmlName];
      return { selectedMembers: next };
    }),

  clearAllMembers: () => set({ selectedMembers: {} }),
}));
