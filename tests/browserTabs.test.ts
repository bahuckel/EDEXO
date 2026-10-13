/**
 * The EDEXO browser (plan 9; electron/browserTabs.cjs, browserPrefs.cjs): what the address bar opens, the isolation
 * every page gets, the session's guards (permissions, HTTPS first, per-site blocking, DNT / GPC), incognito by
 * default, and calls refused from anything but the app's own window. Electron is faked: nothing opens.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { createBrowserTabs, resolveTyped, isLocalHost } = require("../electron/browserTabs.cjs") as {
  createBrowserTabs: (o: unknown) => {
    handle: (e: { sender: FakeContents }, a: unknown) => Promise<Record<string, unknown>>;
    isBrowserContents: (wc: unknown) => boolean;
  };
  resolveTyped: (t: string, s: (q: string) => string) => string | null;
  isLocalHost: (h: string) => boolean;
};
const { createBrowserPrefs } = require("../electron/browserPrefs.cjs") as {
  createBrowserPrefs: (o: { dir: string }) => {
    site(d: string): { remember: boolean; blocking: boolean; origins: string[] };
    setRemember(d: string, on: boolean): void;
    setBlocking(d: string, on: boolean): void;
    noteOrigin(d: string, o: string): void;
    keptOrigins(): string[];
    addLink(n: string, u: string): boolean;
    links(): { name: string; url: string; builtIn: boolean }[];
    setEngine(k: string, c?: string): boolean;
    searchUrl(t: string): string;
  };
};

type Listener = (...a: never[]) => unknown;
class FakeContents {
  handlers = new Map<string, Listener[]>();
  sent: [string, unknown][] = [];
  url = "";
  zoom = 1;
  session: unknown = null;
  openHandler: ((d: { url: string }) => { action: string }) | null = null;
  closed = false;
  navigationHistory = { canGoBack: () => false, canGoForward: () => false, goBack() {}, goForward() {} };
  constructor(public prefs: Record<string, unknown> = {}) {}
  on(ev: string, cb: Listener) {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb]);
  }
  emit(ev: string, ...a: unknown[]) {
    for (const cb of this.handlers.get(ev) ?? []) (cb as (...x: unknown[]) => unknown)(...a);
  }
  send(ch: string, v: unknown) {
    this.sent.push([ch, v]);
  }
  getURL() {
    return this.url;
  }
  getZoomFactor() {
    return this.zoom;
  }
  setWindowOpenHandler(h: (d: { url: string }) => { action: string }) {
    this.openHandler = h;
  }
  loadURL(u: string) {
    this.url = u;
    return Promise.resolve();
  }
  close() {
    this.closed = true;
  }
  isDestroyed() {
    return this.closed;
  }
  insertCSS() {
    return Promise.resolve("");
  }
  reload() {}
  stop() {}
}
class FakeView {
  static made: FakeView[] = [];
  webContents: FakeContents;
  bounds: unknown = null;
  visible = false;
  constructor(public opts: { webPreferences: Record<string, unknown> }) {
    this.webContents = new FakeContents(opts.webPreferences);
    FakeView.made.push(this);
  }
  setBackgroundColor() {}
  setBounds(b: unknown) {
    this.bounds = b;
  }
  setVisible(v: boolean) {
    this.visible = v;
  }
}
class FakeWindow {
  webContents = new FakeContents();
  children: FakeView[] = [];
  contentView = {
    addChildView: (v: FakeView) => this.children.push(v),
    removeChildView: (v: FakeView) => (this.children = this.children.filter((c) => c !== v)),
  };
  once() {}
  isDestroyed() {
    return false;
  }
}
type PermissionHandler = (wc: unknown, p: string, cb: (ok: boolean) => void) => void;
type CheckHandler = (wc: unknown, p: string) => boolean;
type BeforeHandler = (d: Record<string, unknown>, cb: (r: unknown) => void) => void;
type HeadersHandler = (d: { requestHeaders: Record<string, string> }, cb: (r: unknown) => void) => void;
interface FakeSessionState {
  ua: string;
  cleared: unknown[];
  permission: PermissionHandler | null;
  check: CheckHandler | null;
  before: BeforeHandler | null;
  headers: HeadersHandler | null;
}
function fakeSession() {
  const s: FakeSessionState = {
    ua: "",
    cleared: [],
    permission: null,
    check: null,
    before: null,
    headers: null,
  };
  return Object.assign(s, {
    setUserAgent(u: string) {
      s.ua = u;
    },
    setSpellCheckerEnabled() {},
    setPermissionRequestHandler(h: PermissionHandler) {
      s.permission = h;
    },
    setPermissionCheckHandler(h: CheckHandler) {
      s.check = h;
    },
    setDevicePermissionHandler() {},
    setDisplayMediaRequestHandler() {},
    webRequest: {
      onBeforeRequest: (h: BeforeHandler) => (s.before = h),
      onBeforeSendHeaders: (h: HeadersHandler) => (s.headers = h),
    },
    on() {},
    clearData(o?: unknown) {
      s.cleared.push(o ?? null);
      return Promise.resolve();
    },
  });
}
const ask = (fn: (cb: (r: unknown) => void) => void) => {
  let out: unknown;
  fn((r) => (out = r));
  return out;
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-browser-"));
  FakeView.made = [];
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

function setup() {
  const ses = fakeSession();
  const appWin = new FakeWindow();
  const prefs = createBrowserPrefs({ dir });
  const decided: string[] = [];
  const blocker = {
    status: () => ({ ready: true }),
    ensure: async () => true,
    hostOf: (u: string) => {
      try {
        const h = new URL(u).hostname;
        return { hostname: h, domain: h.replace(/^www\./, "") };
      } catch {
        return { hostname: null, domain: null };
      }
    },
    decide: (d: { url: string }) => (
      decided.push(d.url),
      /ads\.example/.test(d.url) ? { cancel: true } : null
    ),
    cosmetics: () => "",
    release: vi.fn(),
  };
  const tabs = createBrowserTabs({
    electron: {
      BrowserWindow: { fromWebContents: (wc: unknown) => (wc === appWin.webContents ? appWin : null) },
      WebContentsView: FakeView,
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      clipboard: { writeText() {} },
      session: { fromPartition: () => ses },
      app: { getPath: () => dir },
    },
    prefs,
    blocker,
    isAppWindow: (wc: unknown) => wc === appWin.webContents,
  });
  const call = (a: Record<string, unknown>) => tabs.handle({ sender: appWin.webContents }, a);
  return { ses, appWin, prefs, blocker, decided, tabs, call };
}

describe("the address bar", () => {
  const search = (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
  it("opens addresses, searches words, and never opens another scheme", () => {
    expect(resolveTyped("https://www.edsm.net/en", search)).toBe("https://www.edsm.net/en");
    expect(resolveTyped("edsm.net", search)).toBe("https://edsm.net/");
    expect(resolveTyped("spansh.co.uk/plotter", search)).toBe("https://spansh.co.uk/plotter");
    expect(resolveTyped("localhost:7111", search)).toBe("http://localhost:7111");
    expect(resolveTyped("guardian ruins", search)).toBe(search("guardian ruins"));
    expect(resolveTyped("file:///C:/Windows/win.ini", search)).toBe(search("file:///C:/Windows/win.ini"));
    expect(resolveTyped("javascript:alert(1)", search)).toBe(search("javascript:alert(1)"));
    expect(resolveTyped("chrome://settings", search)).toBe(search("chrome://settings"));
    expect(resolveTyped("   ", search)).toBeNull();
  });
  it("keeps plain HTTP for this machine and the home network only", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("192.168.1.20")).toBe(true);
    expect(isLocalHost("10.1.2.3")).toBe(true);
    expect(isLocalHost("172.20.0.1")).toBe(true);
    expect(isLocalHost("example.com")).toBe(false);
    expect(isLocalHost("172.40.0.1")).toBe(false);
  });
});

describe("a browsed page", () => {
  it("runs sandboxed, isolated, without Node, on the browser's own session", async () => {
    const t = setup();
    await t.call({ op: "start" });
    const { id } = (await t.call({ op: "open", text: "edsm.net" })) as { id: number };
    expect(id).toBeGreaterThan(0);
    const p = FakeView.made[0]!.opts.webPreferences;
    expect(p).toMatchObject({
      session: t.ses,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      experimentalFeatures: false,
    });
    expect(p.preload).toBeUndefined();
    expect(t.appWin.children).toHaveLength(1);
    expect(t.ses.ua).toMatch(/^Mozilla\/5\.0 .* Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
    expect(t.ses.ua).not.toMatch(/Electron|edexo/i);
  });

  it("opens a new window as a tab, and goes nowhere but http(s)", async () => {
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://edastro.com/" });
    const wc = FakeView.made[0]!.webContents;
    expect(wc.openHandler!({ url: "https://spansh.co.uk/" })).toEqual({ action: "deny" });
    expect(FakeView.made).toHaveLength(2);
    expect(wc.openHandler!({ url: "file:///etc/passwd" })).toEqual({ action: "deny" });
    expect(FakeView.made).toHaveLength(2);
    let prevented = 0;
    const ev = { preventDefault: () => prevented++ };
    wc.emit("will-navigate", ev, "file:///C:/x");
    wc.emit("will-navigate", ev, "ms-settings:privacy");
    wc.emit("will-navigate", ev, "https://edastro.com/next");
    expect(prevented).toBe(2);
    let certOk: boolean | null = null;
    wc.emit("certificate-error", ev, "https://bad", "ERR", {}, (ok: boolean) => (certOk = ok));
    expect(certOk).toBe(false);
  });

  it("gets no permission but fullscreen", async () => {
    const t = setup();
    await t.call({ op: "start" });
    for (const p of [
      "media",
      "geolocation",
      "notifications",
      "clipboard-read",
      "midi",
      "hid",
      "serial",
      "usb",
    ])
      expect(ask((cb) => t.ses.permission!(null, p, cb as (ok: boolean) => void))).toBe(false);
    expect(ask((cb) => t.ses.permission!(null, "fullscreen", cb as (ok: boolean) => void))).toBe(true);
    expect(t.ses.check!(null, "geolocation")).toBe(false);
  });
});

describe("the browser's session", () => {
  it("asks for a page over HTTPS first, except on this machine and the home network", async () => {
    const t = setup();
    await t.call({ op: "start" });
    const r = ask((cb) => t.ses.before!({ resourceType: "mainFrame", url: "http://edsm.net/x" }, cb));
    expect(r).toEqual({ redirectURL: "https://edsm.net/x" });
    expect(
      ask((cb) => t.ses.before!({ resourceType: "mainFrame", url: "http://192.168.1.20:8741/" }, cb)),
    ).toEqual({});
  });

  it("blocks on a page's behalf, and nothing on a site with blocking off", async () => {
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://www.edsm.net/" });
    const wc = FakeView.made[0]!.webContents;
    const req = { resourceType: "script", url: "https://ads.example/a.js", webContents: wc };
    expect(ask((cb) => t.ses.before!(req, cb))).toEqual({ cancel: true });
    // The start page "start" opened, then edsm.net.
    expect((await t.call({ op: "state" })).tabs).toMatchObject([
      { startPage: true },
      { blocked: 1, blocking: true },
    ]);
    t.prefs.setBlocking("edsm.net", false);
    t.decided.length = 0;
    expect(ask((cb) => t.ses.before!(req, cb))).toEqual({});
    expect(t.decided).toEqual([]);
  });

  it("says Do Not Track and Global Privacy Control on every request", async () => {
    const t = setup();
    await t.call({ op: "start" });
    const r = ask((cb) => t.ses.headers!({ requestHeaders: { Accept: "*/*" } }, cb)) as {
      requestHeaders: Record<string, string>;
    };
    expect(r.requestHeaders).toMatchObject({ DNT: "1", "Sec-GPC": "1", Accept: "*/*" });
  });

  it("clears what sites stored at the first start of a run, keeping only the remembered sites'", async () => {
    const t = setup();
    t.prefs.setRemember("edsm.net", true);
    t.prefs.noteOrigin("edsm.net", "https://beta.edsm.net");
    await t.call({ op: "start" });
    await t.call({ op: "start" });
    expect(t.ses.cleared).toEqual([
      { excludeOrigins: ["https://edsm.net", "https://www.edsm.net", "https://beta.edsm.net"] },
    ]);
  });
});

describe("the toolbar's calls", () => {
  it("are refused from any window but the app's, and from a browsed page", async () => {
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://edsm.net/" });
    const page = FakeView.made[0]!.webContents;
    expect(await t.tabs.handle({ sender: page }, { op: "clearAll" })).toEqual({ error: "Not allowed." });
    expect(await t.tabs.handle({ sender: new FakeContents() }, { op: "state" })).toEqual({
      error: "Not allowed.",
    });
    expect(await t.call({ op: "nonsense" })).toEqual({ error: "Unknown call." });
  });

  it("place the page where the toolbar says, scaled by the window's zoom, and hide it on the start page", async () => {
    const t = setup();
    await t.call({ op: "start" });
    const { id } = (await t.call({ op: "open", text: "https://edsm.net/" })) as { id: number };
    t.appWin.webContents.zoom = 1.25;
    await t.call({ op: "bounds", rect: { x: 0, y: 100, width: 800, height: 600 } });
    const v = FakeView.made[0]!;
    expect(v.bounds).toEqual({ x: 0, y: 125, width: 1000, height: 750 });
    expect(v.visible).toBe(true);
    await t.call({ op: "home", id });
    expect(v.visible).toBe(false);
    await t.call({ op: "bounds", rect: { x: "x" } });
    expect(v.visible).toBe(false);
  });

  it("close every page when the Browser tab goes and does not come back", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://edsm.net/" });
    await t.call({ op: "stop" });
    vi.advanceTimersByTime(5000);
    expect(FakeView.made[0]!.webContents.closed).toBe(true);
    expect(t.blocker.release).toHaveBeenCalled();
  });
});

describe("the browser's settings", () => {
  it("keep start-page links that are http(s) only, and the search engine", () => {
    const p = createBrowserPrefs({ dir });
    expect(p.addLink("Inara", "https://inara.cz")).toBe(true);
    expect(p.addLink("Bad", "javascript:alert(1)")).toBe(false);
    expect(p.addLink("", "https://x.y")).toBe(false);
    expect(
      p
        .links()
        .filter((l) => !l.builtIn)
        .map((l) => l.url),
    ).toEqual(["https://inara.cz/"]);
    expect(p.searchUrl("a b")).toBe("https://duckduckgo.com/?q=a%20b");
    expect(p.setEngine("custom", "file:///%s")).toBe(false);
    expect(p.setEngine("custom", "https://search.example/?q=%s")).toBe(true);
    expect(createBrowserPrefs({ dir }).searchUrl("x")).toBe("https://search.example/?q=x");
  });
});
