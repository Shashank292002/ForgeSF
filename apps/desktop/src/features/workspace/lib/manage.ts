import { ask, confirm, prompt } from "../../../components/ui/Confirm/confirm";
import type { Workspace } from "../types";

/**
 * Renaming and forgetting a registered project.
 *
 * Both the status-bar switcher and the Settings list offer these, and the
 * wording — especially around deleting files — should not differ between them.
 * The store action is passed in so these can be tested without a store.
 */

/**
 * Asks for a new display name and renames. Nothing happens when the dialog is
 * dismissed or the name is unchanged.
 */
export async function renameWorkspacePrompt(
  workspace: Workspace,
  rename: (id: string, name: string) => Promise<void>,
): Promise<void> {
  const name = await prompt({
    title: "Rename workspace",
    message:
      "This is the name ForgeSF shows. The folder on disk keeps its own name.",
    details: [workspace.path],
    label: "Name",
    initialValue: workspace.name,
    confirmLabel: "Rename",
  });

  if (!name || name === workspace.name) return;
  await rename(workspace.id, name);
}

/**
 * Forgets a project, offering to delete the folder as well when ForgeSF
 * created it for an org in its own data — those are otherwise left behind
 * forever. A folder the user picked is only ever forgotten.
 */
export async function forgetWorkspaceWithFiles(
  workspace: Workspace,
  remove: (id: string, deleteFiles?: boolean) => Promise<void>,
): Promise<void> {
  if (!workspace.managed) {
    const proceed = await confirm({
      title: `Remove "${workspace.name}" from ForgeSF?`,
      message:
        "The folder and its files stay on disk — only this entry is forgotten.",
      details: [workspace.path],
      confirmLabel: "Remove",
    });
    if (proceed) await remove(workspace.id, false);
    return;
  }

  const choice = await ask({
    title: `Remove "${workspace.name}" from ForgeSF?`,
    message:
      "ForgeSF created this folder for the org, inside its own data.\n\n" +
      "Deleting it throws away the metadata retrieved into it — anything not " +
      "deployed back to the org is gone.",
    details: [workspace.path],
    actions: [
      { value: "keep", label: "Remove, keep folder", variant: "secondary" },
      { value: "delete", label: "Remove and delete", variant: "danger" },
    ],
    focus: "cancel",
  });

  if (!choice) return;
  await remove(workspace.id, choice === "delete");
}
