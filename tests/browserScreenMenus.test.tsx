/**
 * @vitest-environment jsdom
 *
 * The browser toolbar's ⋯ menu closes on Escape, like any menu (owner, 2026-10-18: it closed only when the mouse
 * left it). src/client/BrowserScreen.tsx with a fake main-process bridge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { BrowserScreen, type BrowserBridge, type BrowserState } from "../src/client/BrowserScreen";

let host: HTMLDivElement;
let root: Root;

const state: BrowserState = {
  tabs: [
    {
      id: 1,
      title: "Example Domain",
      url: "https://example.com/",
      loading: false,
      canBack: false,
      canForward: false,
      blocked: 0,
      domain: "example.com",
      blocking: true,
      remembered: false,
      secure: true,
      startPage: false,
      error: null,
      passwordPrompt: null,
      logins: [],
      loginsLocked: 0,
    },
  ],
  active: 1,
  blocker: { ready: true, haveLists: true, busy: null, progress: null, error: null, fetchedAt: null, bytes: 0, lists: [] },
  downloads: [],
  links: [],
  engines: [{ key: "ddg", label: "DuckDuckGo" }],
  engine: "ddg",
  customSearch: null,
  keepCache: false,
  rememberPasswords: false,
  passwords: { available: true, reason: null, saved: [], savedCount: 0, master: { set: false, unlocked: false }, never: [] },
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const api = new Proxy({} as BrowserBridge, {
    get: (_t, k) =>
      k === "on" ? () => () => {} : k === "snapshot" ? async () => ({ dataUrl: null }) : vi.fn(async () => state),
  });
  (window as unknown as { edexoElectron: unknown }).edexoElectron = { browser: api };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as unknown as { edexoElectron?: unknown }).edexoElectron;
});

describe("browser toolbar menus", () => {
  it("Escape closes the ⋯ menu", async () => {
    await act(async () => root.render(<BrowserScreen />));
    const more = host.querySelector<HTMLButtonElement>('button[aria-label="More"]')!;
    act(() => more.click());
    expect(host.querySelector(".ebr-menu")).not.toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(host.querySelector(".ebr-menu")).toBeNull();
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });
});
