/** Maps a workspace-relative path to a Monaco language id. */
export function languageForPath(path: string): string {
  const fileName = path.split("/").pop() ?? path;
  const lower = fileName.toLowerCase();
  const ext = lower.split(".").pop() ?? "";
  const full = lower;

  if (full.endsWith(".cls") || full.endsWith(".trigger")) return "apex";
  if (full.endsWith("-meta.xml")) return "xml";
  if (full.endsWith(".soql")) return "sql";
  if (
    full.endsWith(".cmp") ||
    full.endsWith(".page") ||
    full.endsWith(".component")
  ) {
    return "xml";
  }

  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "ts":
      return "typescript";
    case "jsx":
      return "javascript";
    case "tsx":
      return "typescript";
    case "json":
      return "json";
    case "html":
      return "html";
    case "css":
      return "css";
    case "scss":
      return "scss";
    case "less":
      return "less";
    case "xml":
      return "xml";
    case "md":
      return "markdown";
    case "sql":
      return "sql";
    case "yml":
    case "yaml":
      return "yaml";
    case "sh":
    case "bash":
    case "bat":
      return "shell";
    default:
      return "plaintext";
  }
}

export const DEFAULT_LANGUAGE = "plaintext";