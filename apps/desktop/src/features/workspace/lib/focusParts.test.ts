// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { focusPart } from "./focusParts";

afterEach(() => {
  document.body.innerHTML = "";
});

function workspace() {
  document.body.innerHTML = `
    <div class="fw-activitybar">
      <button>Explorer</button>
      <button class="fw-activitybar__item is-active">Search</button>
    </div>
    <div class="forge-sidebar__content"><input class="fw-search__input" aria-label="query" /></div>
    <div class="workspace-editor">
      <div role="tab" tabindex="0">Foo.cls</div>
      <div class="monaco-editor">
        <textarea aria-label="Fallback input"></textarea>
        <div role="textbox" tabindex="0" aria-label="Editor content"></div>
      </div>
    </div>
    <div class="workspace-panel__body"><input class="workspace-terminal__input" aria-label="command" /></div>
    <div class="workspace-statusbar"><button>AgentOrg</button></div>
  `;
}

const focused = () =>
  document.activeElement?.getAttribute("aria-label") ??
  document.activeElement?.textContent;

describe("focusPart", () => {
  it("steps forward through the parts, starting at the first", () => {
    workspace();
    const order: Array<string | null | undefined> = [];
    for (let i = 0; i < 6; i += 1) {
      focusPart(1);
      order.push(focused());
    }
    expect(order).toEqual([
      "Search",
      "query",
      "Editor content",
      "command",
      "AgentOrg",
      "Search",
    ]);
  });

  it("gets out of the editor in either direction", () => {
    workspace();
    document.querySelector<HTMLElement>('[role="textbox"]')!.focus();

    focusPart(-1);
    expect(focused()).toBe("query");
    focusPart(1);
    focusPart(1);
    expect(focused()).toBe("command");
  });

  it("skips a part with nothing to focus", () => {
    document.body.innerHTML = `
      <div class="fw-activitybar"><button>Explorer</button></div>
      <div class="forge-sidebar__content"><p>Empty</p></div>
      <div class="workspace-statusbar"><button>AgentOrg</button></div>
    `;
    focusPart(1);
    expect(focused()).toBe("Explorer");
    focusPart(1);
    expect(focused()).toBe("AgentOrg");
  });
});
