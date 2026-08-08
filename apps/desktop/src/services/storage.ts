import { load } from "@tauri-apps/plugin-store";
import type { Organization } from "../features/org-manager/types";


const STORE_FILE = "forgesf.json";


async function getStore() {
  return await load(STORE_FILE);
}



export async function saveOrganizations(
  organizations: Organization[]
) {

  const store = await getStore();

  await store.set(
    "organizations",
    organizations
  );

  await store.save();
}




export async function getOrganizations()
: Promise<Organization[]> {

  const store = await getStore();

  const organizations =
    await store.get<Organization[]>(
      "organizations"
    );

  return organizations ?? [];
}




export async function removeOrganization(
  id: string
) {

  const organizations =
    await getOrganizations();


  const updated =
    organizations.filter(
      org => org.id !== id
    );


  await saveOrganizations(
    updated
  );

}




export async function updateOrganization(
  updatedOrg: Organization
) {

  const organizations =
    await getOrganizations();


  const updated =
    organizations.map(
      org =>
      org.id === updatedOrg.id
      ? updatedOrg
      : org
    );


  await saveOrganizations(
    updated
  );

}




export async function clearOrganizations(){

  const store = await getStore();

  await store.delete(
    "organizations"
  );

  await store.save();

}

export async function saveSelectedOrganizationId(
    id: string | null
) {

    const store = await load(STORE_FILE);

    await store.set(
        "selectedOrganizationId",
        id
    );

    await store.save();

}

export async function getSelectedOrganizationId() {

    const store = await load(STORE_FILE);

    return (
        await store.get<string>(
            "selectedOrganizationId"
        )
    ) ?? null;

}