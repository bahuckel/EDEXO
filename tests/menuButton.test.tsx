// @vitest-environment jsdom
/**
 * ui/Menu.tsx (plan 3.3): the menu-button keys. Enter / Arrow Down open on the first entry, Arrow Up on
 * the last; arrows wrap, Home / End, a letter jumps by the entry's name; Escape closes and gives focus
 * back to the button; Tab closes; entries are menuitems out of the Tab order.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MENU_ITEM, useMenuButton } from "../src/client/ui/Menu";

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

const ENTRIES = ["Galaxy map", "System map", "Boxels", "Statistics", "Session log"];

function Plus() {
  const [open, setOpen] = useState(false);
  const menu = useMenuButton<HTMLButtonElement, HTMLUListElement>(open, setOpen);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", id: "plus", ...menu.buttonProps, onClick: menu.toggle }, "+"),
    open
      ? createElement(
          "ul",
          menu.menuProps,
          ENTRIES.map((e) =>
            createElement(
              "li",
              { key: e, role: "none" },
              createElement("button", { type: "button", ...MENU_ITEM, "aria-label": e }, e),
            ),
          ),
        )
      : null,
  );
}

const key = (k: string) =>
  act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
const at = () => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.id;
const plus = () => host.querySelector<HTMLButtonElement>("#plus")!;

describe("menu button", () => {
  it("opens on the first entry, moves, jumps by letter, Escape gives focus back", () => {
    act(() => root!.render(createElement(Plus)));
    expect(plus().getAttribute("aria-haspopup")).toBe("menu");
    plus().focus();
    key("Enter");
    expect(plus().getAttribute("aria-expanded")).toBe("true");
    expect(plus().getAttribute("aria-controls")).toBe(host.querySelector('[role="menu"]')!.id);
    expect(at()).toBe("Galaxy map");
    key("ArrowDown");
    expect(at()).toBe("System map");
    key("ArrowUp");
    key("ArrowUp");
    expect(at()).toBe("Session log");
    key("Home");
    expect(at()).toBe("Galaxy map");
    key("s"); // the next entry starting with "s" after Galaxy map
    expect(at()).toBe("System map");
    key("s");
    expect(at()).toBe("Statistics");
    expect(
      [...host.querySelectorAll('[role="menuitem"]')].every((e) => (e as HTMLElement).tabIndex === -1),
    ).toBe(true);
    key("Escape");
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(plus());
  });

  it("Arrow Up opens on the last entry; Tab closes", () => {
    act(() => root!.render(createElement(Plus)));
    plus().focus();
    key("ArrowUp");
    expect(at()).toBe("Session log");
    key("Tab");
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it("a click opens on the first entry too", () => {
    act(() => root!.render(createElement(Plus)));
    act(() => plus().click());
    expect(at()).toBe("Galaxy map");
  });
});
