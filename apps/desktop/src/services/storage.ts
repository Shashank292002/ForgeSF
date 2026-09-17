import { load } from "@tauri-apps/plugin-store";
import type { Organization } from "../features/org-manager/types";

const STORE_FILE = "forgesf.json";

/**
 * Persisted-schema version.
 *
 * The store previously held a bare `Organization[]` with no version marker, so
 * the first shape change would have loaded malformed objects with no way to
 * detect or migrate them. Bump this and add a `migrate` branch when the shape
 * changes.
 */
const SCHEMA_VERSION = 1;

const KEY_ORGS = "organizations";
const KEY_VERSION = "schemaVersion";
const KEY_SELECTED = "selectedOrganizationId";

async function getStore() {
  return await load(STORE_FILE);
}

/** Upgrades persisted data written by an older version of the app. */
function migrate(raw: unknown, version: number): Organization[] {
  if (!Array.isArray(raw)) return [];

  // v0 (unversioned) is shape-compatible with v1; it simply predates the
  // marker. Later versions add their transforms here.
  if (version <= SCHEMA_VERSION) {
    return raw.filter(
      (org): org is Organization =>
        typeof org === "object" &&
        org !== null &&
        typeof (org as Organization).id === "string" &&
        typeof (org as Organization).username === "string",
    );
  }

  // Written by a newer build than this one — safer to start clean than to
  // guess at a shape we do not know.
  return [];
}

export async function saveOrganizations(organizations: Organization[]) {
  const store = await getStore();
  await store.set(KEY_VERSION, SCHEMA_VERSION);
  await store.set(KEY_ORGS, organizations);
  await store.save();
}

export async function getOrganizations(): Promise<Organization[]> {
  const store = await getStore();
  const version = (await store.get<number>(KEY_VERSION)) ?? 0;
  const raw = await store.get<unknown>(KEY_ORGS);
  return migrate(raw, version);
}

export async function saveSelectedOrganizationId(id: string | null) {
  const store = await getStore();
  await store.set(KEY_SELECTED, id);
  await store.save();
}

export async function getSelectedOrganizationId() {
  const store = await getStore();
  return (await store.get<string>(KEY_SELECTED)) ?? null;
}
