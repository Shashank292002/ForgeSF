import { describe, expect, it, vi, beforeEach } from "vitest";

import { forgetWorkspaceWithFiles, renameWorkspacePrompt } from "./manage";
import type { Workspace } from "../types";

const ask = vi.fn();
const confirm = vi.fn();
const prompt = vi.fn();

vi.mock("../../../components/ui/Confirm/confirm", () => ({
  ask: (...args: unknown[]) => ask(...args),
  confirm: (...args: unknown[]) => confirm(...args),
  prompt: (...args: unknown[]) => prompt(...args),
}));

const project = (overrides: Partial<Workspace> = {}): Workspace => ({
  id: "C:/dev/acme",
  name: "acme",
  path: "C:/dev/acme",
  orgId: null,
  lastOrgId: null,
  lastRetrievedOrgId: null,
  createdAt: 0,
  managed: false,
  ...overrides,
});

beforeEach(() => {
  ask.mockReset();
  confirm.mockReset();
  prompt.mockReset();
});

describe("renameWorkspacePrompt", () => {
  it("renames to what was typed", async () => {
    prompt.mockResolvedValue("acme uat");
    const rename = vi.fn().mockResolvedValue(undefined);

    await renameWorkspacePrompt(project(), rename);

    expect(prompt).toHaveBeenCalledWith(
      expect.objectContaining({ initialValue: "acme" }),
    );
    expect(rename).toHaveBeenCalledWith("C:/dev/acme", "acme uat");
  });

  it("does nothing when dismissed or unchanged", async () => {
    const rename = vi.fn();

    prompt.mockResolvedValue(null);
    await renameWorkspacePrompt(project(), rename);

    prompt.mockResolvedValue("acme");
    await renameWorkspacePrompt(project(), rename);

    expect(rename).not.toHaveBeenCalled();
  });
});

describe("forgetWorkspaceWithFiles", () => {
  it("only offers to forget a folder the user picked", async () => {
    confirm.mockResolvedValue(true);
    const remove = vi.fn().mockResolvedValue(undefined);

    await forgetWorkspaceWithFiles(project(), remove);

    expect(ask).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith("C:/dev/acme", false);
  });

  it("keeps the entry when that is declined", async () => {
    confirm.mockResolvedValue(false);
    const remove = vi.fn();

    await forgetWorkspaceWithFiles(project(), remove);

    expect(remove).not.toHaveBeenCalled();
  });

  it("offers to delete a folder ForgeSF created, and can keep it", async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const managed = project({ managed: true });

    ask.mockResolvedValue("delete");
    await forgetWorkspaceWithFiles(managed, remove);
    expect(remove).toHaveBeenLastCalledWith("C:/dev/acme", true);

    ask.mockResolvedValue("keep");
    await forgetWorkspaceWithFiles(managed, remove);
    expect(remove).toHaveBeenLastCalledWith("C:/dev/acme", false);

    ask.mockResolvedValue(null);
    await forgetWorkspaceWithFiles(managed, remove);
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
