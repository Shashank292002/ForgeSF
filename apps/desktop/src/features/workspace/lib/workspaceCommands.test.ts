import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));

import { commandKeys, workspaceCommands } from "./workspaceCommands";
import { parseKeys } from "./keybindings";
import { useWorkspaceStore } from "../store/workspaceStore";
import { useOrganizationStore } from "../../../store/orgStore";
import type { Organization } from "../../org-manager/types";

const CLASS = "force-app/main/default/classes/Foo.cls";
const ORG: Organization = {
  id: "00D1",
  alias: "dev",
  username: "admin@dev.com",
  instanceUrl: "https://dev.my.salesforce.com",
  orgType: "Sandbox",
  isDefault: false,
  status: "Connected",
};

const navigate = vi.fn();
const commands = workspaceCommands(navigate);
const byId = (id: string) => commands.find((command) => command.id === id)!;

beforeEach(() => {
  navigate.mockClear();
  useOrganizationStore.setState({ selectedOrganization: ORG });
  useWorkspaceStore.setState({
    selectedFile: CLASS,
    packageDirectories: ["force-app"],
    dirty: {},
    openFiles: [CLASS],
  });
});

describe("workspace commands", () => {
  it("never binds one shortcut to two commands", () => {
    const keys = commands
      .flatMap(commandKeys)
      .map((binding) => JSON.stringify(parseKeys(binding)));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps every shortcut the workspace had", () => {
    const bound = commands.flatMap(commandKeys);
    for (const keys of [
      "Ctrl+S",
      "Ctrl+Shift+S",
      "Ctrl+B",
      "Ctrl+`",
      "Ctrl+,",
      "Ctrl+Shift+E",
      "Ctrl+Shift+F",
      "Ctrl+Shift+G",
      "Ctrl+Shift+M",
    ]) {
      expect(bound).toContain(keys);
    }
  });

  it("offers Salesforce actions only for metadata, with an org connected", () => {
    const deploy = byId("sf.deployFile");
    expect(deploy.when!()).toBe(true);

    useWorkspaceStore.setState({ selectedFile: "sfdx-project.json" });
    expect(deploy.when!()).toBe(false);

    useWorkspaceStore.setState({ selectedFile: CLASS });
    useOrganizationStore.setState({ selectedOrganization: null });
    expect(deploy.when!()).toBe(false);
  });

  it("opens Deployments with the active file to validate", () => {
    byId("sf.validateFile").run();
    expect(navigate).toHaveBeenCalledWith("/deployments", {
      state: { deployPaths: [CLASS] },
    });
  });

  it("opens Quick Open in the right mode", () => {
    byId("go.commands").run();
    expect(useWorkspaceStore.getState().quickInput?.text).toBe(">");
    byId("go.line").run();
    expect(useWorkspaceStore.getState().quickInput?.text).toBe(":");
    useWorkspaceStore.getState().closeQuickInput();
  });

  it("moves between editor tabs, wrapping around", async () => {
    const OTHER = "force-app/main/default/classes/Other.cls";
    const selectFile = vi.fn(async () => {});
    useWorkspaceStore.setState({ openFiles: [CLASS, OTHER], selectFile });

    await byId("view.nextEditor").run();
    expect(selectFile).toHaveBeenLastCalledWith(OTHER);
    await byId("view.previousEditor").run();
    expect(selectFile).toHaveBeenLastCalledWith(OTHER);

    useWorkspaceStore.setState({ openFiles: [CLASS] });
    expect(byId("view.nextEditor").when!()).toBe(false);
  });

  it("offers Save All only with unsaved changes", () => {
    expect(byId("file.saveAll").when!()).toBe(false);
    useWorkspaceStore.setState({ dirty: { [CLASS]: true } });
    expect(byId("file.saveAll").when!()).toBe(true);
  });
});
