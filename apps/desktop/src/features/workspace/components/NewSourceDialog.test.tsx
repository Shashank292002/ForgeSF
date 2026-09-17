// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NewSourceDialog from "./NewSourceDialog";
import { useWorkspaceStore } from "../store/workspaceStore";

const generateSource = vi.fn();

beforeEach(() => {
  generateSource.mockReset().mockResolvedValue(true);
  useWorkspaceStore.setState({ generateSource });
});

afterEach(cleanup);

/** Types a name into the dialog's Name field. */
function type(name: string) {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: name } });
}

describe("NewSourceDialog", () => {
  it("asks for an Apex class with the chosen template", async () => {
    const onClose = vi.fn();
    render(<NewSourceDialog onClose={onClose} />);

    type("AccountService");
    fireEvent.change(screen.getByLabelText("Template"), {
      target: { value: "ApexUnitTest" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await vi.waitFor(() =>
      expect(generateSource).toHaveBeenCalledWith({
        kind: "apexClass",
        name: "AccountService",
        template: "ApexUnitTest",
        sobject: null,
        events: null,
        label: null,
      }),
    );
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("asks for a trigger with its object and events", async () => {
    render(<NewSourceDialog onClose={() => {}} />);

    fireEvent.click(screen.getByRole("radio", { name: /Apex Trigger/ }));
    type("AccountTrigger");
    fireEvent.change(screen.getByLabelText("Object"), {
      target: { value: "Account" },
    });
    fireEvent.click(screen.getByLabelText("after update"));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await vi.waitFor(() =>
      expect(generateSource).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "apexTrigger",
          sobject: "Account",
          events: ["before insert", "after update"],
        }),
      ),
    );
  });

  it("refuses a name Salesforce would not accept", () => {
    render(<NewSourceDialog onClose={() => {}} />);

    type("1Account");
    expect(screen.getByRole("alert").textContent).toMatch(
      /start with a letter/i,
    );
    expect(
      (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    type("Account__c");
    expect(screen.getByRole("alert").textContent).toMatch(/double underscore/i);

    type("AccountService");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Create" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("switching kind drops a template that belonged to the last one", async () => {
    render(<NewSourceDialog onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText("Template"), {
      target: { value: "Batchable" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /Lightning Web/ }));
    type("accountCard");
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await vi.waitFor(() =>
      expect(generateSource).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "lwc", template: null }),
      ),
    );
  });
});
