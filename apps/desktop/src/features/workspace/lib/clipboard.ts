import { toast } from "../../../components/ui/Toast/toast";

/**
 * Puts text on the system clipboard and says so. `what` names it in the
 * notice: "the path", "3 relative paths".
 */
export async function copyText(text: string, what: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    toast.info(`Copied ${what}.`, { durationMs: 2500 });
    return true;
  } catch {
    toast.error("The clipboard could not be written to.", {
      title: `Could not copy ${what}`,
    });
    return false;
  }
}
