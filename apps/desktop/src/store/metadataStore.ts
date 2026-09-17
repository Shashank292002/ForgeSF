import { create } from "zustand";

/**
 * What the user picked to retrieve. The listings themselves are cached by
 * `useOrgMetadata`, which shares them with the Deployments page.
 */
interface MetadataState {
  /**
   * Username of the org the selection belongs to.
   *
   * Selections are scoped to it: the store previously kept one global
   * selection, so switching orgs left you able to retrieve or deploy types
   * and components belonging to the *previous* org.
   */
  orgUsername: string | null;

  /** Metadata types selected for an upcoming retrieve or deploy. */
  selectedTypes: string[];

  /** Components picked per metadata type (`Kind -> [member, …]`). */
  selectedMembers: Record<string, string[]>;

  /** Notes which org is being picked from, clearing a previous org's picks. */
  setOrg: (orgUsername: string) => void;

  setSelectedTypes: (types: string[]) => void;
  toggleType: (xmlName: string) => void;
  clearTypes: () => void;

  /** Toggles one component of a metadata type. */
  toggleMember: (xmlName: string, member: string) => void;

  /** Replaces the whole member selection for one metadata type. */
  setMembers: (xmlName: string, members: string[]) => void;

  /** Clears the member selection for one metadata type (back to "all"). */
  clearMemberSelection: (xmlName: string) => void;
}

export const useMetadataStore = create<MetadataState>((set) => ({
  orgUsername: null,

  selectedTypes: [],

  selectedMembers: {},

  setOrg: (orgUsername) =>
    set((state) =>
      state.orgUsername === orgUsername
        ? state
        : { orgUsername, selectedTypes: [], selectedMembers: {} },
    ),

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
}));
