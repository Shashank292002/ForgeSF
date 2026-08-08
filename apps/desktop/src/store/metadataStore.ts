import { create } from "zustand";

import type { MetadataType } from "../features/metadata/types";

interface MetadataState {

    metadata: MetadataType[];

    selectedMetadata: string[];

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