// @vitest-environment jsdom
/**
 * Modal dialogs (plan 3.3, review F11). ui/Dialog.tsx: focus moves in, Tab stays in, Escape closes the
 * top one only, focus goes back to what opened it, a click inside never reaches the page behind, and
 * it stays modal inside a tab's screen. And no `aria-modal` element in the client without useModal's
 * ref on it: the genus notes and the Encyclopedia's found list were modal in name only.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dialog } from "../src/client/ui/Dialog";
import { InTabContext } from "../src/client/tabs/TabHost";

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

/** jsdom lays nothing out and useModal skips controls of no size: buttons and inputs get one. */
const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")!;
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      return this.matches("button, input") ? 10 : 0;
    },
  });
});
afterEach(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", realWidth);
});

let pageClicks = 0;
function Page({ inTab = false, nested = false }: { inTab?: boolean; nested?: boolean }) {
  const [open, setOpen] = useState(0);
  const body = createElement(
    "div",
    { onClick: () => pageClicks++ },
    createElement("button", { id: "opener", onClick: () => setOpen(1) }, "Notes"),
    open >= 1
      ? createElement(Dialog, {
          title: "Stratum — notes",
          onClose: () => setOpen((n) => n - 1),
          children: createElement(
            "div",
            { className: "modal-body" },
            createElement("input", { id: "first-field" }),
            nested ? createElement("button", { id: "open-inner", onClick: () => setOpen(2) }, "Found") : null,
          ),
        })
      : null,
    open >= 2
      ? createElement(Dialog, {
          title: "Found",
          onClose: () => setOpen(1),
          children: createElement(
            "div",
            { className: "modal-body" },
            createElement("button", { id: "inner-btn" }, "ok"),
          ),
        })
      : null,
  );
  return inTab ? createElement(InTabContext.Provider, { value: "encyclopedia" }, body) : body;
}

const key = (k: string, shift = false) =>
  act(() => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, shiftKey: shift, bubbles: true }),
    );
  });

describe("Dialog", () => {
  for (const inTab of [false, true]) {
    it(`traps focus, closes on Escape and gives focus back${inTab ? ", inside a tab too" : ""}`, () => {
      act(() => root!.render(createElement(Page, { inTab })));
      const opener = host.querySelector<HTMLButtonElement>("#opener")!;
      opener.focus();
      act(() => opener.click());
      const dlg = host.querySelector('[role="dialog"]')!;
      expect(dlg.getAttribute("aria-modal")).toBe("true");
      expect(document.getElementById(dlg.getAttribute("aria-labelledby")!)?.textContent).toBe(
        "Stratum — notes",
      );
      // Focus went in, to the close button (the first focusable).
      expect(document.activeElement?.className).toBe("modal-close");
      // Tab from the last wraps to the first; Shift+Tab from the first to the last.
      (host.querySelector("#first-field") as HTMLElement).focus();
      key("Tab");
      expect(document.activeElement?.className).toBe("modal-close");
      key("Tab", true);
      expect(document.activeElement?.id).toBe("first-field");
      key("Escape");
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
    });
  }

  it("a click inside or on the backdrop stays with the dialog; the backdrop closes it", () => {
    pageClicks = 0;
    act(() => root!.render(createElement(Page)));
    act(() => host.querySelector<HTMLButtonElement>("#opener")!.click());
    const before = pageClicks;
    act(() => host.querySelector<HTMLElement>("#first-field")!.click());
    expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => host.querySelector<HTMLElement>(".modal-backdrop")!.click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(pageClicks).toBe(before);
  });

  it("Escape closes only the dialog on top", () => {
    act(() => root!.render(createElement(Page, { nested: true })));
    act(() => host.querySelector<HTMLButtonElement>("#opener")!.click());
    act(() => host.querySelector<HTMLButtonElement>("#open-inner")!.click());
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    key("Escape");
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(host.querySelector('[role="dialog"] h3')?.textContent).toBe("Stratum — notes");
  });
});

describe("no modal in name only", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  };
  walk(path.join(__dirname, "..", "src", "client"));

  it("every aria-modal element carries useModal's ref (or is ui/Dialog.tsx)", () => {
    const bad: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, "utf8");
      for (let i = s.indexOf("aria-modal"); i >= 0; i = s.indexOf("aria-modal", i + 1)) {
        const open = s.lastIndexOf("<", i);
        const close = s.indexOf(">", i);
        const tag = s.slice(open, close);
        if (!/\bref=\{/.test(tag) || !/useModal/.test(s))
          bad.push(`${path.relative(process.cwd(), f)}:${s.slice(0, i).split("\n").length}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
