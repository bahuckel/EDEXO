/**
 * The HUD host (electron/hudHost.cjs; owner, 2026-10-26: memory): every HUD panel window opened from one hidden page,
 * so they share its renderer process. Driven with fake Electron windows that act out window.open.
 */
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createHudHost } = require("../electron/hudHost.cjs") as {
  createHudHost: (o: unknown) => { open: (w: number, h: number, icon?: unknown) => Promise<FakeWin | null>; dispose: () => void; hostWindow: () => FakeWin | null };
};

type Handler = (details: { url: string; frameName: string }) => { action: string; overrideBrowserWindowOptions?: object };
let mode: "ok" | "silent" = "ok";
class FakeWin {
  static all: FakeWin[] = [];
  destroyed = false;
  url = "";
  handler: Handler | null = null;
  listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  webContents = {
    setWindowOpenHandler: (h: Handler) => (this.handler = h),
    on: (ev: string, fn: (...a: unknown[]) => void) => (this.listeners[ev] ??= []).push(fn),
    loadURL: (u: string) => {
      this.url = u;
      return Promise.resolve();
    },
    executeJavaScript: (code: string) => {
      const name = /window\.open\("about:blank", "([^"]+)"/.exec(code)?.[1] ?? "";
      if (mode === "silent") return Promise.resolve(0);
      const answer = this.handler!({ url: "about:blank", frameName: name });
      if (answer.action === "allow") {
        const child = new FakeWin(answer.overrideBrowserWindowOptions ?? {});
        for (const fn of this.listeners["did-create-window"] ?? []) fn(child, { frameName: name, url: "about:blank" });
      }
      return Promise.resolve(0);
    },
  };
  constructor(public options: object) {
    FakeWin.all.push(this);
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
  emit(ev: string, ...a: unknown[]) {
    for (const fn of this.listeners[ev] ?? []) fn(...a);
  }
}

const make = (extra: object = {}) =>
  createHudHost({
    BrowserWindow: FakeWin,
    windowOptions: (w: number, h: number, icon?: unknown) => ({ width: w, height: h, icon, transparent: true, alwaysOnTop: true }),
    baseUrl: () => "http://127.0.0.1:7111",
    ...extra,
  });

afterEach(() => {
  FakeWin.all = [];
  mode = "ok";
  vi.useRealTimers();
});

describe("the HUD host", () => {
  it("opens each panel window from one hidden page, with the HUD window's options", async () => {
    const host = make();
    const a = await host.open(404, 200, "icon");
    const b = await host.open(404, 120);
    const page = host.hostWindow()!;
    expect(page.url).toBe("http://127.0.0.1:7111/hud-host.html");
    expect(page.options).toMatchObject({ show: false });
    expect(a!.options).toMatchObject({ width: 404, height: 200, icon: "icon", transparent: true, alwaysOnTop: true });
    expect(b!.options).toMatchObject({ height: 120 });
    // One host page for both, and nothing but about:blank may be opened from it.
    expect(FakeWin.all.filter((w) => w.url.endsWith("/hud-host.html"))).toHaveLength(1);
    expect(page.handler!({ url: "https://example.com/", frameName: "x" })).toEqual({ action: "deny" });
  });

  it("answers null (the caller makes a window of its own) when the page never opens one", async () => {
    vi.useFakeTimers();
    mode = "silent";
    const host = make();
    const p = host.open(404, 200);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await p).toBeNull();
  });

  it("answers null without a server", async () => {
    const host = make({ baseUrl: () => null });
    expect(await host.open(404, 200)).toBeNull();
  });

  it("reports its process gone and makes a new page for the next window", async () => {
    let gone = 0;
    const host = make({ onGone: () => gone++ });
    await host.open(404, 200);
    const first = host.hostWindow()!;
    first.emit("render-process-gone", {}, { reason: "crashed" });
    expect(gone).toBe(1);
    expect(first.destroyed).toBe(true);
    await host.open(404, 200);
    expect(host.hostWindow()).not.toBe(first);
    host.dispose();
    expect(host.hostWindow()).toBeNull();
  });
});
