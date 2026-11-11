/**
 * What may happen inside the app's windows (combined plan 1.7): outside pages go to the browser,
 * the app's own pages may open, navigation away is refused, and only the permissions the pages use
 * are granted.
 */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { guardWindowNavigation, restrictPermissions } = require("../electron/windowGuards.cjs") as {
  guardWindowNavigation: (win: unknown, getBase: () => string | null, shell: unknown) => void;
  restrictPermissions: (ses: unknown) => void;
};

type Fake = ReturnType<typeof fakeWindow>;
function fakeWindow() {
  let openHandler: ((d: { url: string }) => { action: string }) | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listeners: Record<string, (...a: any[]) => void> = {};
  return {
    listeners,
    win: {
      webContents: {
        setWindowOpenHandler: (h: typeof openHandler) => (openHandler = h),
        on: (ev: string, fn: (e: { preventDefault: () => void }, url: string) => void) => (listeners[ev] = fn),
      },
    },
    open: (url: string) => openHandler!({ url }).action,
    navigate: (url: string) => {
      let prevented = false;
      listeners["will-navigate"]!({ preventDefault: () => (prevented = true) }, url);
      return prevented;
    },
  };
}

describe("window guards", () => {
  it("opens outside pages in the browser and keeps the app's own", () => {
    const external: string[] = [];
    const shell = { openExternal: async (u: string) => void external.push(u) };
    const w = fakeWindow();
    guardWindowNavigation(w.win, () => "http://127.0.0.1:7111", shell);
    expect(w.open("https://github.com/bahuckel/EDEXO/releases")).toBe("deny");
    expect(w.open("http://127.0.0.1:7111/?screen=triage")).toBe("allow");
    expect(w.open("http://127.0.0.1:71119/")).toBe("deny"); // not a prefix trick
    expect(w.open("file:///C:/Windows/system32/calc.exe")).toBe("deny");
    expect(w.navigate("https://evil.example/")).toBe(true);
    expect(w.navigate("http://127.0.0.1:7111/launcher.html")).toBe(false);
    expect(external).toEqual([
      "https://github.com/bahuckel/EDEXO/releases",
      "http://127.0.0.1:71119/",
      "https://evil.example/",
    ]);
  });

  // Review 2026-11-10 D5: a window a guarded one opens inherits the bridge; it and its own children are guarded too.
  it("guards the windows a guarded window opens, and theirs", () => {
    const external: string[] = [];
    const shell = { openExternal: async (u: string) => void external.push(u) };
    const parent = fakeWindow();
    guardWindowNavigation(parent.win, () => "http://127.0.0.1:7111", shell);
    const child: Fake = fakeWindow();
    parent.listeners["did-create-window"]!(child.win);
    const grandchild: Fake = fakeWindow();
    child.listeners["did-create-window"]!(grandchild.win);
    expect(grandchild.open("https://github.com/bahuckel/EDEXO")).toBe("deny");
    expect(grandchild.navigate("https://evil.example/")).toBe(true);
    expect(external).toEqual(["https://github.com/bahuckel/EDEXO", "https://evil.example/"]);
  });

  it("grants the clipboard, fullscreen and pointer lock, and nothing else", () => {
    let handler: ((wc: unknown, p: string, cb: (ok: boolean) => void) => void) | null = null;
    restrictPermissions({ setPermissionRequestHandler: (h: typeof handler) => (handler = h) });
    const ask = (p: string) => {
      let ok: boolean | null = null;
      handler!(null, p, (v) => (ok = v));
      return ok;
    };
    expect(["clipboard-sanitized-write", "fullscreen", "pointerLock"].map(ask)).toEqual([true, true, true]);
    expect(["media", "geolocation", "notifications", "midi", "openExternal"].map(ask)).toEqual([false, false, false, false, false]);
  });
});
