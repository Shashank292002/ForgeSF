import type { ConfirmOptions } from "@/components/ui/Confirm/confirm";
import { protectionPrompt } from "@/features/org-manager/lib/orgProtection";
import type { Organization } from "@/features/org-manager/types";

/**
 * Helpers for the free-form `sf` commands typed into the Developer Tools CLI
 * tab and the workspace terminal.
 */

/**
 * Argv for the CLI with a leading `sf` / `sfdx` removed.
 *
 * The terminal stripped it and the CLI tab did not, so typing
 * `sf org display` in Developer Tools ran `sf sf org display`.
 */
export function stripCliName(tokens: string[]): string[] {
  const first = tokens[0]?.toLowerCase();
  return first === "sf" || first === "sfdx" ? tokens.slice(1) : tokens;
}

/** The command's topic words (`project deploy start`), lower-cased. */
export function commandWords(args: string[]): string[] {
  const words: string[] = [];
  for (const token of args) {
    if (token.startsWith("-")) break;
    // `project:deploy:start` and legacy `force:source:deploy` use colons.
    words.push(...token.toLowerCase().split(":").filter(Boolean));
  }
  return words;
}

const TARGET_ORG_FLAGS = new Set([
  "--target-org",
  "-o",
  "--targetusername",
  "-u",
]);

/**
 * The org a command runs against: the one named with `--target-org` (or its
 * short and legacy forms), otherwise the CLI's default org. Returns undefined
 * when the named org is not one the app knows.
 */
export function targetOrgFor(
  args: string[],
  organizations: Organization[],
): Organization | undefined {
  let named: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const [flag, inline] = token.split(/=(.*)/s, 2);
    if (TARGET_ORG_FLAGS.has(flag)) {
      named = inline ?? args[index + 1];
      break;
    }
  }

  if (named === undefined) {
    return organizations.find((org) => org.isDefault);
  }
  const wanted = named.toLowerCase();
  return organizations.find(
    (org) =>
      org.alias.toLowerCase() === wanted ||
      org.username.toLowerCase() === wanted,
  );
}

/** Commands that write to an org, as topic-word prefixes. */
const ORG_CHANGING_COMMANDS: string[][] = [
  ["project", "deploy", "start"],
  ["project", "deploy", "quick"],
  ["project", "deploy", "resume"],
  ["project", "delete", "source"],
  ["data", "create"],
  ["data", "update"],
  ["data", "delete"],
  ["data", "upsert"],
  ["data", "import"],
  ["apex", "run"],
  ["org", "delete"],
  ["package", "install"],
  ["package", "uninstall"],
  ["force", "source", "deploy"],
  ["force", "source", "push"],
  ["force", "source", "delete"],
  ["force", "mdapi", "deploy"],
  ["force", "data", "record", "create"],
  ["force", "data", "record", "update"],
  ["force", "data", "record", "delete"],
  ["force", "data", "bulk", "upsert"],
  ["force", "data", "bulk", "delete"],
  ["force", "data", "tree", "import"],
  ["force", "apex", "execute"],
  ["force", "org", "delete"],
  ["force", "package", "install"],
];

/**
 * Whether a command can change data or metadata in an org.
 *
 * Deliberately conservative: it exists to put a confirmation in front of
 * Production, so a false positive costs a click and a false negative can cost
 * an outage. `apex run test` is excluded — tests roll their changes back.
 */
export function changesOrg(args: string[]): boolean {
  const words = commandWords(args);
  if (words[0] === "apex" && words[1] === "run" && words[2] === "test") {
    return false;
  }
  return ORG_CHANGING_COMMANDS.some((prefix) =>
    prefix.every((word, index) => words[index] === word),
  );
}

/**
 * The confirmation for running a free-form command, or null when it needs
 * none.
 *
 * Only commands that change an org ask, and only when the target is protected
 * — or when the target cannot be identified, because then it might be.
 */
export function cliProtectionPrompt(
  args: string[],
  organizations: Organization[],
): ConfirmOptions | null {
  if (!changesOrg(args)) return null;

  const action = `Run "sf ${commandWords(args).join(" ")}"`;
  const target = targetOrgFor(args, organizations);
  if (target) return protectionPrompt(target, action, "Run");

  return {
    title: `${action}?`,
    message:
      "This command changes an org, and ForgeSF cannot tell which org it " +
      "targets, so it cannot rule out a production org.",
    confirmLabel: "Run anyway",
    tone: "danger",
  };
}
