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
 * Human summary of what a retrieve will pull, per selected type:
 * `"3 of 120"` when members are narrowed, or `"all"` otherwise.
 */
export function memberSummary(
  kind: string,
  selectedMembers: Record<string, string[]>,
  availableCounts: Record<string, unknown>,
): { label: string; narrowed: boolean } {
  const members = selectedMembers[kind] ?? [];
  const available =
    typeof availableCounts[kind] === "number"
      ? (availableCounts[kind] as number)
      : undefined;
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
