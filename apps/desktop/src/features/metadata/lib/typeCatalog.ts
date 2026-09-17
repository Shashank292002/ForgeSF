import type { MetadataType } from "../types";

/** A metadata type as offered in the picker. */
export interface CatalogType extends MetadataType {
  /**
   * Set on a child type (such as `CustomField`) listed through its parent's
   * `childXmlNames`; the org's type list does not include them on their own.
   */
  parent?: string;
}

/**
 * The org's metadata types plus their child types.
 *
 * `sf org list metadata-types` returns `CustomObject` but not `CustomField`,
 * `ValidationRule`, `ListView` and friends — those only appear in
 * `childXmlNames`. The picker offered the top-level list alone, so a single
 * field or validation rule could not be retrieved.
 */
export function withChildTypes(types: MetadataType[]): CatalogType[] {
  const catalog = new Map<string, CatalogType>();
  for (const type of types) catalog.set(type.xmlName, type);

  for (const type of types) {
    for (const child of type.childXmlNames ?? []) {
      if (!child || catalog.has(child)) continue;
      catalog.set(child, {
        xmlName: child,
        directoryName: type.directoryName,
        suffix: null,
        inFolder: false,
        metaFile: false,
        childXmlNames: [],
        parent: type.xmlName,
      });
    }
  }

  return [...catalog.values()].sort((a, b) =>
    a.xmlName.localeCompare(b.xmlName),
  );
}

/**
 * Whether retrieving a type needs its members named explicitly.
 *
 * The Metadata API has no wildcard for types that live in folders (reports,
 * dashboards, documents, email templates) or for child types, so retrieving
 * the bare type name returned nothing — or failed.
 */
export function needsExplicitMembers(type: CatalogType | undefined): boolean {
  return Boolean(type && (type.inFolder || type.parent));
}

/**
 * Types whose wildcard retrieve omits standard components, with the reason
 * shown to the user.
 */
export function wildcardCaveat(xmlName: string): string | null {
  if (xmlName === "CustomObject") {
    return (
      "Retrieving all objects fetches custom objects only. Pick standard " +
      "objects such as Account explicitly to include them."
    );
  }
  return null;
}
