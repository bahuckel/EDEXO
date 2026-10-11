// @vitest-environment jsdom
/**
 * The keyboard for tab lists (plan 3.3, client review F10): arrows move and wrap, Home / End, the
 * option strips select as focus moves, the screen strip only focuses until Enter or Space, Delete
 * closes a screen tab, and keys on a tab's own close button stay with the button.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { tabListKeyDown, type TabListKeyOptions } from "../src/client/ui/Tabs";

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

const NAMES = ["a", "b", "c"];
let closed: string[] = [];

/** Buttons for the option strips, divs with a close button inside for the screen strip. */
function Strip({ opts, divs }: { opts: TabListKeyOptions; divs?: boolean }) {
  const [sel, setSel] = useState("a");
  return createElement(
    "div",
    { role: "tablist", onKeyDown: (ev: React.KeyboardEvent<HTMLElement>) => tabListKeyDown(ev, opts) },
    NAMES.filter((n) => !closed.includes(n)).map((n) =>
      createElement(
        divs ? "div" : "button",
        {
          key: n,
          id: `t-${n}`,
          role: "tab",
          "aria-selected": sel === n,
          tabIndex: sel === n ? 0 : -1,
          "data-front": n,
          onClick: () => setSel(n),
        },
        n,
        divs ? createElement("button", { id: `x-${n}`, tabIndex: -1 }, "×") : null,
      ),
    ),
    createElement("output", { id: "sel" }, sel),
  );
}

const press = (key: string) =>
  act(() => {
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
const focused = () => document.activeElement?.id;
const selected = () => host.querySelector("#sel")?.textContent;

describe("tab list keys", () => {
  it("option strips: arrows wrap and select as they go, Home and End", () => {
    closed = [];
    act(() => root!.render(createElement(Strip, { opts: { follow: true } })));
    (host.querySelector("#t-a") as HTMLElement).focus();
    press("ArrowRight");
    expect([focused(), selected()]).toEqual(["t-b", "b"]);
    press("End");
    expect([focused(), selected()]).toEqual(["t-c", "c"]);
    press("ArrowRight");
    expect([focused(), selected()]).toEqual(["t-a", "a"]);
    press("ArrowLeft");
    expect([focused(), selected()]).toEqual(["t-c", "c"]);
    press("Home");
    expect([focused(), selected()]).toEqual(["t-a", "a"]);
    // Only the selected tab is in the Tab order.
    expect([...host.querySelectorAll('[role="tab"]')].map((t) => (t as HTMLElement).tabIndex)).toEqual([0, -1, -1]);
  });

  it("screen strip: arrows only focus, Enter and Space open", () => {
    closed = [];
    act(() => root!.render(createElement(Strip, { opts: {}, divs: true })));
    (host.querySelector("#t-a") as HTMLElement).focus();
    press("ArrowRight");
    expect([focused(), selected()]).toEqual(["t-b", "a"]);
    press("Enter");
    expect(selected()).toBe("b");
    press("ArrowRight");
    press(" ");
    expect([focused(), selected()]).toEqual(["t-c", "c"]);
  });

  it("Delete closes the focused tab; keys on its close button stay with the button", () => {
    closed = [];
    const opts: TabListKeyOptions = {
      onDelete: (tab) => {
        closed.push(tab.dataset.front!);
      },
    };
    act(() => root!.render(createElement(Strip, { opts, divs: true })));
    (host.querySelector("#t-b") as HTMLElement).focus();
    press("Delete");
    expect(closed).toEqual(["b"]);
    // Enter on the close button inside tab c does not open tab c.
    (host.querySelector("#x-c") as HTMLElement).focus();
    press("Enter");
    expect(selected()).toBe("a");
  });
});
