/**
 * Fuzzy matching for Quick Open and the command palette.
 *
 * The query's characters must appear in the target in order, ignoring case.
 * Among the ways they can, the best one wins: characters that start a word or
 * a path segment, run together, or match case score higher — so "acs" finds
 * AccountService by its capitals rather than some scattered a, c and s.
 */

export interface FuzzyMatch {
  score: number;
  /** Index in the target of each matched query character, ascending. */
  positions: number[];
}

const NO_MATCH = -1e9;
/** Per character skipped between two matched characters. */
const GAP_PENALTY = 0.05;
const CONSECUTIVE_BONUS = 6;

const isUpper = (char: string) => char !== char.toLowerCase();
const isLower = (char: string) => char !== char.toUpperCase();

/** What matching the character at `index` is worth, apart from runs. */
function positionBonus(target: string, index: number): number {
  if (index === 0) return 8;
  const previous = target[index - 1];
  if (previous === "/" || previous === "\\") return 9;
  if (
    previous === "." ||
    previous === "_" ||
    previous === "-" ||
    previous === " "
  ) {
    return 7;
  }
  // A camelCase hump: the S in AccountService.
  if (isLower(previous) && isUpper(target[index])) return 6;
  return 0;
}

// Reused between calls: this runs for every file on every keystroke.
let scores = new Float64Array(0);
let from = new Int32Array(0);

/** The best match of `query` in `target`, or null when there is none. */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const m = query.length;
  const n = target.length;
  if (m === 0) return { score: 0, positions: [] };
  if (m > n) return null;

  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();

  // Most targets don't contain the letters in order at all; say so cheaply.
  let found = 0;
  for (let j = 0; j < n && found < m; j += 1) {
    if (lowerTarget[j] === lowerQuery[found]) found += 1;
  }
  if (found < m) return null;

  if (scores.length < m * n) {
    scores = new Float64Array(m * n);
    from = new Int32Array(m * n);
  }

  // scores[i * n + j]: the best score for query[0..i] with query[i] at j.
  for (let i = 0; i < m; i += 1) {
    // Best predecessor at least two characters back, gap-adjusted so the
    // penalty for the distance can be applied once j is known.
    let bestGapped = NO_MATCH;
    let bestGappedAt = -1;

    for (let j = 0; j < n; j += 1) {
      const cell = i * n + j;
      if (i > 0 && j >= 2) {
        const candidate = scores[(i - 1) * n + (j - 2)];
        if (candidate > NO_MATCH) {
          const adjusted = candidate + (j - 2) * GAP_PENALTY;
          if (adjusted > bestGapped) {
            bestGapped = adjusted;
            bestGappedAt = j - 2;
          }
        }
      }

      if (lowerTarget[j] !== lowerQuery[i]) {
        scores[cell] = NO_MATCH;
        continue;
      }
      const bonus =
        1 + positionBonus(target, j) + (target[j] === query[i] ? 1 : 0);

      if (i === 0) {
        // An earlier start is slightly better.
        scores[cell] = bonus - j * GAP_PENALTY;
        from[cell] = -1;
        continue;
      }

      let best = NO_MATCH;
      let bestFrom = -1;
      const run = scores[(i - 1) * n + (j - 1)];
      if (j >= 1 && run > NO_MATCH) {
        best = run + CONSECUTIVE_BONUS;
        bestFrom = j - 1;
      }
      if (bestGappedAt !== -1) {
        const gapped = bestGapped - (j - 1) * GAP_PENALTY;
        if (gapped > best) {
          best = gapped;
          bestFrom = bestGappedAt;
        }
      }
      if (bestFrom === -1) {
        scores[cell] = NO_MATCH;
        continue;
      }
      scores[cell] = best + bonus;
      from[cell] = bestFrom;
    }
  }

  const last = (m - 1) * n;
  let end = -1;
  let score = NO_MATCH;
  for (let j = m - 1; j < n; j += 1) {
    if (scores[last + j] > score) {
      score = scores[last + j];
      end = j;
    }
  }
  if (end === -1) return null;

  const positions = new Array<number>(m);
  for (let i = m - 1, j = end; i >= 0; i -= 1) {
    positions[i] = j;
    j = from[i * n + j];
  }
  return { score, positions };
}

/**
 * Matches a Quick Open query against a workspace path. Without a slash the
 * query is about the file name first; spaces are ignored.
 */
export function matchPath(query: string, path: string): FuzzyMatch | null {
  const wanted = query.replace(/\s+/g, "").replace(/\\/g, "/");
  if (!wanted) return { score: 0, positions: [] };

  const nameStart = path.lastIndexOf("/") + 1;
  if (!wanted.includes("/")) {
    const inName = fuzzyMatch(wanted, path.slice(nameStart));
    if (inName) {
      const prefix = path
        .slice(nameStart)
        .toLowerCase()
        .startsWith(wanted.toLowerCase());
      return {
        score: inName.score + 20 + (prefix ? 15 : 0),
        positions: inName.positions.map((index) => index + nameStart),
      };
    }
  }
  return fuzzyMatch(wanted, path);
}

/** `text` split into runs of matched and unmatched characters, for display. */
export function highlightParts(
  text: string,
  positions: number[],
  offset = 0,
): Array<{ text: string; match: boolean }> {
  const matched = new Set(positions.map((position) => position - offset));
  const parts: Array<{ text: string; match: boolean }> = [];
  for (let index = 0; index < text.length; index += 1) {
    const match = matched.has(index);
    const last = parts.at(-1);
    if (last && last.match === match) last.text += text[index];
    else parts.push({ text: text[index], match });
  }
  return parts;
}
