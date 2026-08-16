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
  FolderOpen,
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
  const ext = lower.split(".").pop() ?? "";
  const full = lower;

  // Salesforce metadata (suffix-based)
  switch (ext) {
    case "cls":
      return Cpu;
    case "trigger":
      return Zap;
    case "object":
    case "objectTranslation":
      return Database;
    case "field":
      return Table2;
    case "profile":
    case "permissionSet":
    case "permissionset":
      return ShieldAlert;
    case "layout":
      return Layout;
    case "recordType":
      return Link2;
    case "flow":
    case "flowDefinition":
      return Workflow;
    case "process":
      return GitBranch;
    case "resource":
    case "resourceBundle":
      return Package;
    case "labels":
      return BookOpen;
    case "quickAction":
      return Zap;
    case "globalValueSet":
    case "standardValueSet":
      return Package2;
    case "remoteSite":
      return Cloud;
    case "customMetadata":
      return Database;
    case "static":
      return FileText;
    case "function":
      return FunctionSquare;
    default:
      break;
  }

  // LWC / Aura folders
  if (full.endsWith("__c")) return CodeXml;

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

export const IconFolder = Folder;
export const IconFolderOpen = FolderOpen;
export const IconSearch = CodeXml;
