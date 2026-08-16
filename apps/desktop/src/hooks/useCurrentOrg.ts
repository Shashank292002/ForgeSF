import { useOrganizationStore } from "../store/orgStore";


export default function useCurrentOrg() {

    const organization =
        useOrganizationStore(
            state => state.selectedOrganization
        );


    return {
        organization,
        hasOrg: organization !== null
    };

}