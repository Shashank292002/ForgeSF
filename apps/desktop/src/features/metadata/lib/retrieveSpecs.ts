/**
 * Builds the `sf project retrieve start --metadata` spec list from a
 * developer's selection.
 *
 * For each selected metadata type:
 *  - if specific components were chosen → one `Kind:Member` entry each,
 *    so only those components are pulled from the org;
 *  - otherwise → the bare `Kind`, retrieving every component of that type.
 */
export function buildRetrieveSpecs(
  selectedTypes: string[],
  selectedMembers: Record<string, string[]>,
): string[] {
  const specs: string[] = [];
  for (const kind of selectedTypes) {
    const members = selectedMembers[kind] ?? [];
    if (members.length === 0) {
      specs.push(kind);
    } else {
      for (const member of members) {
        specs.push(`${kind}:${member}`);
      }
    }
  }
  return specs;
}

/**
 * `buildRetrieveSpecs`, but naming every member of the types that cannot be
 * retrieved by wildcard (folder and child types — see `needsExplicitMembers`).
 *
 * `fullMembers` holds the complete member list for each such type. A type
 * with no picks and an empty list has nothing to retrieve and is returned in
 * `empty` instead of being sent to the CLI, where it would fail.
 */
export function resolveRetrieveSpecs(
  selectedTypes: string[],
  selectedMembers: Record<string, string[]>,
  fullMembers: Record<string, string[]>,
): { specs: string[]; empty: string[] } {
  const specs: string[] = [];
  const empty: string[] = [];

  for (const kind of selectedTypes) {
    const picked = selectedMembers[kind] ?? [];
    const all = fullMembers[kind];

    if (picked.length > 0) {
      for (const member of picked) specs.push(`${kind}:${member}`);
    } else if (all === undefined) {
      specs.push(kind);
    } else if (all.length === 0) {
      empty.push(kind);
    } else {
      for (const member of all) specs.push(`${kind}:${member}`);
    }
  }

  return { specs, empty };
}

/**
 * Human summary of what a retrieve will pull, per selected type:
 * `"3 of 120"` when members are narrowed, or `"all"` otherwise.
 */
export function memberSummary(
  kind: string,
  selectedMembers: Record<string, string[]>,
  availableComponents: Record<string, string[]>,
): { label: string; narrowed: boolean } {
  const members = selectedMembers[kind] ?? [];
  // Callers pass the components cache — arrays, not counts. The old signature
  // asked for `Record<string, unknown>` and tested `typeof … === "number"`,
  // which was never true, so the "3 of 120" label could never render.
  const available = availableComponents[kind]?.length;
  if (members.length === 0) {
    return {
      label: available !== undefined ? `all (${available})` : "all components",
      narrowed: false,
    };
  }
  return {
    label:
      available !== undefined
        ? `${members.length} of ${available}`
        : `${members.length} selected`,
    narrowed: true,
  };
}
