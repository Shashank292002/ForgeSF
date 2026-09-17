/**
 * Reading an Apex debug log.
 *
 * A log is a tab-separated stream of events — thousands of lines for a single
 * page load — and almost all of them are noise when you are looking for one
 * thing. These turn it into filterable lines.
 */

export interface LogLine {
  /** 1-based, so a line can be named the way the log viewer numbers them. */
  number: number;
  /** `16:04:31.2 (2000)`, when the line carries one. */
  time: string | null;
  /** `USER_DEBUG`, `SOQL_EXECUTE_BEGIN`, `LIMIT_USAGE`… */
  event: string | null;
  text: string;
}

/** The categories the filter offers, and which events belong to each. */
export const LOG_CATEGORIES = {
  debug: {
    label: "Debug",
    hint: "System.debug output",
    events: ["USER_DEBUG"],
  },
  soql: {
    label: "SOQL",
    hint: "Queries and how many rows they returned",
    events: [
      "SOQL_EXECUTE_BEGIN",
      "SOQL_EXECUTE_END",
      "SOSL_EXECUTE_BEGIN",
      "SOSL_EXECUTE_END",
    ],
  },
  dml: {
    label: "DML",
    hint: "Inserts, updates and deletes",
    events: ["DML_BEGIN", "DML_END"],
  },
  errors: {
    label: "Errors",
    hint: "Exceptions and fatal errors",
    events: [
      "EXCEPTION_THROWN",
      "FATAL_ERROR",
      "VALIDATION_FAIL",
      "CALLOUT_RESPONSE_ERROR",
    ],
  },
  limits: {
    label: "Limits",
    hint: "Governor limit usage",
    events: ["LIMIT_USAGE", "LIMIT_USAGE_FOR_NS", "CUMULATIVE_LIMIT_USAGE"],
  },
  callouts: {
    label: "Callouts",
    hint: "HTTP requests out of the org",
    events: ["CALLOUT_REQUEST", "CALLOUT_RESPONSE"],
  },
} as const;

export type LogCategory = keyof typeof LOG_CATEGORIES;

/** A log line starts `HH:MM:SS.m (nanos)|EVENT|…`. */
const LINE = /^(\d{2}:\d{2}:\d{2}\.\d+\s*\(\d+\))\|([A-Z_]+)(?:\||$)/;

/** Splits a raw log into lines, naming the event each one reports. */
export function parseLog(raw: string): LogLine[] {
  return raw.split(/\r?\n/).map((text, index) => {
    const match = LINE.exec(text);
    return {
      number: index + 1,
      time: match ? match[1] : null,
      event: match ? match[2] : null,
      text,
    };
  });
}

/** Which categories a line belongs to, if any. */
function categoriesOf(event: string | null): LogCategory[] {
  if (!event) return [];
  return (Object.keys(LOG_CATEGORIES) as LogCategory[]).filter((key) =>
    (LOG_CATEGORIES[key].events as readonly string[]).includes(event),
  );
}

/**
 * The lines to show.
 *
 * With no category chosen everything is shown: a filter that hides by default
 * would make an unfamiliar log look empty. `search` matches the line's text,
 * ignoring case.
 */
export function filterLog(
  lines: LogLine[],
  categories: LogCategory[],
  search: string,
): LogLine[] {
  const query = search.trim().toLowerCase();

  return lines.filter((line) => {
    if (categories.length > 0) {
      const belongs = categoriesOf(line.event);
      if (!belongs.some((key) => categories.includes(key))) return false;
    }
    return query ? line.text.toLowerCase().includes(query) : true;
  });
}

/** How many lines each category has, for the filter's counts. */
export function countByCategory(lines: LogLine[]): Record<LogCategory, number> {
  const counts = Object.fromEntries(
    (Object.keys(LOG_CATEGORIES) as LogCategory[]).map((key) => [key, 0]),
  ) as Record<LogCategory, number>;

  for (const line of lines) {
    for (const key of categoriesOf(line.event)) counts[key] += 1;
  }
  return counts;
}

/** "4096" → "4 KB": log sizes, at a glance. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The org's ISO timestamp, in the reader's own locale. */
export function readableTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}
