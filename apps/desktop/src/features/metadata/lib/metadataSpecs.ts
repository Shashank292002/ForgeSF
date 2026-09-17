/**
 * Turning a developer's type-and-component selection into the `Kind:Member`
 * specs the CLI takes.
 *
 * Shared by the retrieve wizard and the Deployments page: both ask an org for
 * a named set of components, and both hit the same rule about which types can
 * be asked for by wildcard.
 */

/**
 * Builds the spec list from a selection, naming every member of the types
 * that cannot be asked for by wildcard (folder and child types — see `needsExplicitMembers`).
 *
 * `fullMembers` holds the complete member list for each such type. A type
 * with no picks and an empty list names nothing and is returned in `empty`
 * instead of being sent to the CLI, where it would fail.
 *
 * A kind is either whole or narrowed, never both: a generated `package.xml`
 * groups its `<types>` by kind, so emitting `ApexClass` alongside
 * `ApexClass:Foo` would put both `*` and `Foo` in one block and send the lot.
 */
export function resolveMetadataSpecs(
  selectedTypes: string[],
  selectedMembers: Record<string, string[]>,
  fullMembers: Record<string, string[]>,
): { specs: string[]; empty: string[] } {
  const specs: string[] = [];
  const empty: string[] = [];

  for (const kind of unique(selectedTypes)) {
    const picked = unique(selectedMembers[kind] ?? []);
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
 * Human summary of what a type contributes, per selected type:
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

/**
 * How many components a selection sends, counting a whole type as every
 * component it has — and as unknown while its list has not been fetched.
 *
 * `known` is false when any selected type's total is still unknown, so the UI
 * can say "7 components + 2 whole types" rather than undercounting.
 */
export function selectionCount(
  selectedTypes: string[],
  selectedMembers: Record<string, string[]>,
  availableComponents: Record<string, string[]>,
): { components: number; wholeTypes: number; known: boolean } {
  let components = 0;
  let wholeTypes = 0;
  let known = true;

  for (const kind of unique(selectedTypes)) {
    const picked = unique(selectedMembers[kind] ?? []);
    if (picked.length > 0) {
      components += picked.length;
      continue;
    }
    wholeTypes += 1;
    const available = availableComponents[kind]?.length;
    if (available === undefined) known = false;
    else components += available;
  }

  return { components, wholeTypes, known };
}

function unique(values: string[]): string[] {
  return values.length > 1 ? [...new Set(values)] : values;
}
