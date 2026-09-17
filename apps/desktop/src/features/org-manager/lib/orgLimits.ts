import type { OrgLimit } from "../../../types/generated/OrgLimit";

/**
 * Turning `sf limits api display` into something readable.
 *
 * The CLI reports a ceiling and what is left; what you actually want to see is
 * how much has gone, and which limits are close to running out.
 */

export type LimitTone = "ok" | "warning" | "critical";

export interface LimitRow {
  name: string;
  /** "DailyApiRequests" shown as "Daily API Requests". */
  label: string;
  used: number;
  max: number;
  remaining: number;
  /** How much of the limit is gone, 0–1. `null` when there is no ceiling. */
  usage: number | null;
  tone: LimitTone;
}

/** Above this much used, a limit is worth noticing; above the second, acting on. */
const WARNING_AT = 0.75;
const CRITICAL_AT = 0.9;

/** Initialisms the CLI runs together, which a plain camelCase split mangles. */
const KEEP_UPPER = new Set(["Api", "Cdp", "Cpu", "Dml", "Soql", "Id", "Url"]);

/** "DailyAsyncApexExecutions" → "Daily Async Apex Executions". */
export function humanLimitName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean);

  return words
    .map((word) => (KEEP_UPPER.has(word) ? word.toUpperCase() : word))
    .join(" ");
}

function toneFor(usage: number | null): LimitTone {
  if (usage === null) return "ok";
  if (usage >= CRITICAL_AT) return "critical";
  if (usage >= WARNING_AT) return "warning";
  return "ok";
}

/**
 * The rows to draw, tightest first — a limit at 98% is the reason you opened
 * this panel, and it should not be somewhere down an alphabetical list.
 */
export function limitRows(limits: OrgLimit[]): LimitRow[] {
  return limits
    .map((limit) => {
      // A negative remaining is possible on a limit that has been exceeded;
      // clamping keeps the bar inside its track.
      const remaining = Math.max(0, Math.min(limit.remaining, limit.max));
      const used = Math.max(0, limit.max - remaining);
      const usage = limit.max > 0 ? used / limit.max : null;

      return {
        name: limit.name,
        label: humanLimitName(limit.name),
        used,
        max: limit.max,
        remaining,
        usage,
        tone: toneFor(usage),
      };
    })
    .sort(
      (a, b) =>
        (b.usage ?? -1) - (a.usage ?? -1) || a.name.localeCompare(b.name),
    );
}

/** Rows whose name or label contains `search`, ignoring case. */
export function filterLimits(rows: LimitRow[], search: string): LimitRow[] {
  const query = search.trim().toLowerCase();
  if (!query) return rows;
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(query) ||
      row.label.toLowerCase().includes(query),
  );
}
