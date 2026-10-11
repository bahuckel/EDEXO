// @vitest-environment jsdom
/**
 * ui/Popover.tsx (plan 3.3): the button opens it and says so (aria-expanded, aria-controls), the panel
 * is a dialog named by `label` with focus inside, Escape closes it and gives focus back to the button,
 * and the screen's own open state follows (the notices list closes it after a pick).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Popover } from "../src/client/ui/Popover";

let root: Root | null = null;
let host: HTMLDivElement;

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

function Bell() {
  const [open, setOpen] = useState(false);
  return createElement(Popover, {
    open,
    onOpenChange: setOpen,
    label: "Notices",
    className: "exo-data-alerts-popover",
    trigger: createElement("button", { type: "button", id: "bell" }, "Bell"),
    children: createElement(
      "button",
      { type: "button", id: "pick", onClick: () => setOpen(false) },
      "Show it",
    ),
  });
}

const panel = () => document.querySelector<HTMLElement>('[role="dialog"]');

describe("Popover", () => {
  it("opens from its button, names itself, takes focus, and Escape gives it back", async () => {
    act(() => root!.render(createElement(Bell)));
    const bell = host.querySelector<HTMLButtonElement>("#bell")!;
    expect(bell.getAttribute("aria-expanded")).toBe("false");
    expect(bell.getAttribute("aria-haspopup")).toBe("dialog");
    bell.focus();
    await act(async () => bell.click());
    expect(bell.getAttribute("aria-expanded")).toBe("true");
    const p = panel()!;
    expect(p.getAttribute("aria-label")).toBe("Notices");
    expect(bell.getAttribute("aria-controls")).toBe(p.id);
    expect(p.className).toContain("exo-data-alerts-popover");
    expect(p.className).toContain("tw:static");
    expect(p.contains(document.activeElement)).toBe(true);
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(bell);
  });

  it("closes when the screen closes it (a pick in the list)", async () => {
    act(() => root!.render(createElement(Bell)));
    await act(async () => host.querySelector<HTMLButtonElement>("#bell")!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("#pick")!.click());
    expect(panel()).toBeNull();
  });
});
