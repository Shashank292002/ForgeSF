import { create } from "zustand";

import type { MetadataType } from "../features/metadata/types";

interface MetadataState {

    metadata: MetadataType[];

    selectedMetadata: string[];

    /** Metadata types selected for an upcoming retrieve (whole-type selection). */
    selectedTypes: string[];

    search: string;

    loading: boolean;

    output: string;

    setMetadata: (
        metadata: MetadataType[]
    ) => void;

    setSelectedMetadata: (
        metadata: string[]
    ) => void;

    toggleMetadata: (
        xmlName: string
    ) => void;

    setSelectedTypes: (types: string[]) => void;

    toggleType: (xmlName: string) => void;

    clearTypes: () => void;

    /** Components picked per metadata type (`Kind -> [member, …]`). */
    selectedMembers: Record<string, string[]>;

    /** Toggles one component of a metadata type. */
    toggleMember: (xmlName: string, member: string) => void;

    /** Replaces the whole member selection for one metadata type. */
    setMembers: (xmlName: string, members: string[]) => void;

    /** Clears the member selection for one metadata type (back to "all"). */
    clearMemberSelection: (xmlName: string) => void;

    /** Clears every per-type component selection. */
    clearAllMembers: () => void;

    setSearch: (
        search: string
    ) => void;

    setLoading: (
        loading: boolean
    ) => void;

    setOutput: (
        output: string
    ) => void;

    clearSelection: () => void;

}

export const useMetadataStore =
    create<MetadataState>((set) => ({

        metadata: [],

        selectedMetadata: [],

        selectedTypes: [],

        search: "",

        loading: false,

        output: "",

        setMetadata: (metadata) =>
            set({
                metadata
            }),

        setSelectedMetadata: (selectedMetadata) =>
            set({
                selectedMetadata
            }),

        toggleMetadata: (xmlName) =>
            set((state) => {

                const exists =
                    state.selectedMetadata.includes(xmlName);

                return {

                    selectedMetadata: exists
                        ? state.selectedMetadata.filter(
                              item => item !== xmlName
                          )
                        : [
                              ...state.selectedMetadata,
                              xmlName
                          ]

                };

            }),

        setSelectedTypes: (selectedTypes) =>
            set({ selectedTypes }),

        toggleType: (xmlName) =>
            set((state) => {
                const exists = state.selectedTypes.includes(xmlName);
                if (exists) {
                    const members = { ...state.selectedMembers };
                    delete members[xmlName];
                    return {
                        selectedTypes: state.selectedTypes.filter(
                              item => item !== xmlName
                          ),
                        selectedMembers: members,
                    };
                }
                return {
                    selectedTypes: [...state.selectedTypes, xmlName],
                };
            }),

        clearTypes: () =>
            set({ selectedTypes: [], selectedMembers: {} }),

        selectedMembers: {},

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

        clearAllMembers: () =>
            set({ selectedMembers: {} }),


        setSearch: (search) =>
            set({
                search
            }),

        setLoading: (loading) =>
            set({
                loading
            }),

        setOutput: (output) =>
            set({
                output
            }),

        clearSelection: () =>
            set({
                selectedMetadata: [],
                output: ""
            })

    }));