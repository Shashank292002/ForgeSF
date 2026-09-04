/**
 * Splits a command line into argv, honouring quoted values.
 *
 * Used by both the workspace terminal and the Developer Tools CLI tab. The
 * latter previously had its own regex that only stripped quotes sitting at a
 * token's very edges, so `--query="SELECT Id FROM Account"` reached `sf` with
 * the quotes still embedded, and single quotes were not handled at all.
 *
 * Deliberately simple: quotes group, whitespace separates, and an unbalanced
 * quote runs to the end of the line rather than throwing — a terminal should
 * hand the CLI its best guess and let the CLI complain.
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const buffer: string[] = [];
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        buffer.push(char);
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (buffer.length) {
        tokens.push(buffer.join(""));
        buffer.length = 0;
      }
    } else {
      buffer.push(char);
    }
  }

  if (buffer.length) tokens.push(buffer.join(""));
  return tokens;
}
