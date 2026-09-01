import {
  BookOpen,
  Cloud,
  Code,
  CodeXml,
  Cpu,
  Database,
  FileCode,
  FileJson,
  FileText,
  FileType,
  Folder,
  FunctionSquare,
  GitBranch,
  KeyRound,
  Layout,
  Link2,
  Package,
  Package2,
  ShieldAlert,
  Table2,
  Terminal,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";

/**
 * Returns a Lucide icon appropriate for a given file name or path.
 * Salesforce-metadata extensions get recognisable icons so retrieved
 * source renders the way developers expect in a VS Code-style explorer.
 */
export function iconForFile(
  name: string,
  type: "file" | "folder" = "file",
): LucideIcon {
  if (type === "folder") return Folder;

  const lower = name.toLowerCase();

  // SFDX source format names metadata `Thing.<suffix>-meta.xml`, so the final
  // extension is almost always "xml". Strip the wrapper first and match on the
  // real suffix — otherwise every object, field, layout and flow fell through
  // to the generic XML icon.
  const stem = lower.endsWith("-meta.xml") ? lower.slice(0, -9) : lower;
  const suffix = stem.includes(".") ? stem.split(".").pop()! : "";

  // Salesforce metadata (suffix-based). Labels are lower-case because `suffix`
  // is; the previous map used camelCase arms that could never match.
  switch (suffix) {
    case "cls":
      return Cpu;
    case "trigger":
      return Zap;
    case "object":
    case "objecttranslation":
      return Database;
    case "field":
      return Table2;
    case "profile":
    case "permissionset":
      return ShieldAlert;
    case "layout":
      return Layout;
    case "recordtype":
      return Link2;
    case "flow":
    case "flowdefinition":
      return Workflow;
    case "process":
      return GitBranch;
    case "resource":
    case "resourcebundle":
      return Package;
    case "labels":
      return BookOpen;
    case "quickaction":
      return Zap;
    case "globalvalueset":
    case "standardvalueset":
      return Package2;
    case "remotesite":
      return Cloud;
    case "custommetadata":
      return Database;
    case "function":
      return FunctionSquare;
    case "page":
    case "component":
    case "cmp":
      return CodeXml;
    default:
      break;
  }

  const ext = lower.includes(".") ? lower.split(".").pop()! : "";

  // Generic by extension
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return Code;
    case "ts":
      return CodeXml;
    case "jsx":
    case "tsx":
      return Code;
    case "json":
      return FileJson;
    case "html":
    case "xml":
      return FileCode;
    case "css":
    case "scss":
    case "less":
      return FileType;
    case "md":
      return BookOpen;
    case "sh":
    case "bash":
    case "bat":
      return Terminal;
    case "env":
    case "key":
      return KeyRound;
    default:
      return FileText;
  }
}
