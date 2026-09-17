/**
 * Turning query results into a file someone can open elsewhere.
 *
 * Copying the raw JSON out of the output pane was the only way to get results
 * into a spreadsheet, and it carried the CLI's envelope and Salesforce's
 * `attributes` noise with it.
 */

/** Salesforce adds this to every record; nobody wants it in their spreadsheet. */
const ENVELOPE = "attributes";

/** The columns of a result set, in the order the first records introduce them. */
export function columnsOf(records: Record<string, unknown>[]): string[] {
  const columns: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record)) {
      if (key === ENVELOPE || columns.includes(key)) continue;
      columns.push(key);
    }
  }
  return columns;
}

/** One cell: nested records and lists become JSON rather than "[object Object]". */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const nested = value as Record<string, unknown>;
    // A relationship field is a record of its own; its own envelope goes too.
    const cleaned = Object.fromEntries(
      Object.entries(nested).filter(([key]) => key !== ENVELOPE),
    );
    return JSON.stringify(cleaned);
  }
  return String(value);
}

/** RFC 4180: quotes doubled, and anything with a comma, quote or newline quoted. */
function csvCell(value: unknown): string {
  const text = cellText(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * The records as CSV, with a header row.
 *
 * Line endings are CRLF, which is what the format says and what Excel expects.
 */
export function toCsv(records: Record<string, unknown>[]): string {
  const columns = columnsOf(records);
  if (columns.length === 0) return "";

  const rows = records.map((record) =>
    columns.map((column) => csvCell(record[column])).join(","),
  );
  return [columns.map(csvCell).join(","), ...rows].join("\r\n");
}

/** The records as JSON, without Salesforce's per-record envelope. */
export function toJson(records: Record<string, unknown>[]): string {
  const cleaned = records.map((record) =>
    Object.fromEntries(
      Object.entries(record).filter(([key]) => key !== ENVELOPE),
    ),
  );
  return JSON.stringify(cleaned, null, 2);
}

/** `Account-2026-09-16.csv` — a name that says what it holds and when. */
export function exportFileName(
  object: string | null,
  extension: string,
): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const base = (object ?? "query").replace(/[^A-Za-z0-9_-]/g, "");
  return `${base || "query"}-${stamp}.${extension}`;
}
