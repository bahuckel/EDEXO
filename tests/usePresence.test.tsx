/**
 * @vitest-environment jsdom
 *
 * Out as they came in (owner, 2026-11-06: "not all buttons and menus are animated both ways, opens with an animation
 * but closes instantly"): a panel rendered only while open stays for its exit, marked data-closing, then goes; at
 * Motion "off" it goes at once (ui/usePresence.ts).
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setMotionLevel } from "../src/client/motionCore";
import { closingAttr, PRESENCE_EXIT_MS, usePresence } from "../src/client/ui/usePresence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Panel({ open }: { open: boolean }) {
  const p = usePresence(open);
  return p.mounted ? <div className="panel" {...closingAttr(p.closing)} /> : null;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  setMotionLevel("full");
});

const panel = () => host.querySelector(".panel");

describe("usePresence", () => {
  it("keeps a closing panel for its exit, marked data-closing, then lets it go", () => {
    setMotionLevel("full");
    act(() => root.render(<Panel open />));
    expect(panel()?.hasAttribute("data-closing")).toBe(false);
    act(() => root.render(<Panel open={false} />));
    expect(panel()?.hasAttribute("data-closing")).toBe(true);
    act(() => vi.advanceTimersByTime(PRESENCE_EXIT_MS + 10));
    expect(panel()).toBeNull();
  });

  it("opening again while it leaves keeps it, no longer closing", () => {
    setMotionLevel("full");
    act(() => root.render(<Panel open />));
    act(() => root.render(<Panel open={false} />));
    act(() => root.render(<Panel open />));
    act(() => vi.advanceTimersByTime(PRESENCE_EXIT_MS + 10));
    expect(panel()?.hasAttribute("data-closing")).toBe(false);
  });

  it("goes at once with Motion off", () => {
    setMotionLevel("off");
    act(() => root.render(<Panel open />));
    act(() => root.render(<Panel open={false} />));
    expect(panel()).toBeNull();
  });
});
