/**
 * Working out what a half-typed SOQL query is asking for.
 *
 * Autocomplete needs to know whether the cursor is somewhere an object name
 * belongs, a field name, or neither — and for a field, which object's fields.
 * That is a small amount of parsing on a query that is usually incomplete and
 * often invalid, so this reads the text around the cursor rather than trying
 * to build a syntax tree.
 */

export type SoqlContextKind = "object" | "field" | "none";

export interface SoqlContext {
  kind: SoqlContextKind;
  /** The object whose fields belong here, for `kind: "field"`. */
  object: string | null;
  /** What has been typed of the word so far. */
  prefix: string;
  /**
   * The relationship path before the cursor, without its trailing dot:
   * `Account` in `SELECT Account.|`. Empty when there is none.
   */
  path: string[];
}

/** Clauses after which a field name is expected. */
const FIELD_CLAUSES = /\b(SELECT|WHERE|ORDER\s+BY|GROUP\s+BY|HAVING)\b/gi;
const FROM_CLAUSE = /\bFROM\b/gi;

/** The word being typed at `offset`, and where it starts. */
function wordBefore(
  text: string,
  offset: number,
): { word: string; start: number } {
  let start = offset;
  while (start > 0 && /[A-Za-z0-9_.]/.test(text[start - 1])) start -= 1;
  return { word: text.slice(start, offset), start };
}

/** The last match of `pattern` that ends at or before `offset`. */
function lastClauseBefore(
  text: string,
  offset: number,
  pattern: RegExp,
): number {
  const search = new RegExp(
    pattern.source,
    pattern.flags.replace("g", "") + "g",
  );
  let last = -1;
  let match: RegExpExecArray | null;
  while ((match = search.exec(text)) !== null) {
    if (match.index + match[0].length > offset) break;
    last = match.index;
  }
  return last;
}

/**
 * The object a query selects from: the word after the last `FROM` that starts
 * before the cursor, or the first `FROM` when the cursor is before it — which
 * is the usual case while still typing the field list.
 */
export function objectOfQuery(text: string, offset: number): string | null {
  const froms = [...text.matchAll(/\bFROM\s+([A-Za-z0-9_]+)/gi)];
  if (froms.length === 0) return null;

  const before = froms.filter((match) => (match.index ?? 0) < offset);
  const chosen = before.length > 0 ? before[before.length - 1] : froms[0];
  return chosen[1] ?? null;
}

/**
 * What belongs at `offset`.
 *
 * Deliberately simple: the last clause keyword before the cursor decides, so
 * `SELECT Id, | FROM Account` asks for a field of Account and `FROM |` asks for
 * an object. Nothing is offered inside a string literal.
 */
export function soqlContextAt(text: string, offset: number): SoqlContext {
  const upToCursor = text.slice(0, offset);

  // Inside a quoted value there is nothing useful to suggest.
  const quotes = (upToCursor.match(/'/g) ?? []).length;
  if (quotes % 2 === 1)
    return { kind: "none", object: null, prefix: "", path: [] };

  const { word } = wordBefore(text, offset);
  const segments = word.split(".");
  const prefix = segments[segments.length - 1];
  const path = segments.slice(0, -1).filter(Boolean);

  const lastFrom = lastClauseBefore(text, offset - word.length, FROM_CLAUSE);
  const lastField = lastClauseBefore(text, offset - word.length, FIELD_CLAUSES);

  // After FROM, and nothing since: an object name.
  if (lastFrom > lastField) {
    return { kind: "object", object: null, prefix, path };
  }

  if (lastField >= 0) {
    return {
      kind: "field",
      object: objectOfQuery(text, offset),
      prefix,
      path,
    };
  }

  return { kind: "none", object: null, prefix, path: [] };
}
