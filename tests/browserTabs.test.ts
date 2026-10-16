/**
 * The EDEXO browser (plan 9; electron/browserTabs.cjs, browserPrefs.cjs): what the address bar opens, the isolation
 * every page gets, the session's guards (permissions, HTTPS first, per-site blocking, DNT / GPC), incognito by
 * default, and calls refused from anything but the app's own window. Electron is faked: nothing opens.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  createBrowserTabs,
  resolveTyped,
  isLocalHost,
  cosmeticScript,
  passwordCaptureScript,
  passwordFillScript,
  DATA_TYPES_BUT_CACHE,
} = require("../electron/browserTabs.cjs") as {
  cosmeticScript: (blocked: string[]) => string;
  passwordCaptureScript: (nonce: string) => string;
  passwordFillScript: (origin: string, username: string, password: string, auto?: boolean) => string;
  DATA_TYPES_BUT_CACHE: string[];
  createBrowserTabs: (o: unknown) => {
    handle: (e: { sender: FakeContents }, a: unknown) => Promise<Record<string, unknown>>;
    isBrowserContents: (wc: unknown) => boolean;
    reloadFocused: () => boolean;
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
    keepCache(): boolean;
    setKeepCache(on: boolean): void;
    rememberPasswords(): boolean;
    setRememberPasswords(on: boolean): void;
    passwordNever(): string[];
    addPasswordNever(o: string): boolean;
    removePasswordNever(o: string): boolean;
  };
};
const { createBrowserPasswords } = require("../electron/browserPasswords.cjs") as {
  createBrowserPasswords: (o: { dir: string; safeStorage: unknown; platform?: string }) => {
    list(): { origin: string; username: string }[];
    save(origin: string, username: string, password: string): { ok?: boolean; error?: string };
  };
};
/** safeStorage, faked: a reversible scramble (browserPasswords.test.ts covers the store itself). */
const fakeSafeStorage = () => ({
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "gnome_libsecret",
  encryptString: (s: string) => Buffer.from(`ENC1${[...s].reverse().join("")}`, "utf8"),
  decryptString: (b: Buffer) => [...b.toString("utf8").slice(4)].reverse().join(""),
});
/** The Electron 42 clearData types (electron.d.ts, ClearDataOptions.dataTypes). */
const ELECTRON_DATA_TYPES = [
  "backgroundFetch",
  "cache",
  "cookies",
  "downloads",
  "fileSystems",
  "indexedDB",
  "localStorage",
  "serviceWorkers",
  "webSQL",
];

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
  once(ev: string, cb: Listener) {
    this.on(ev, cb);
  }
  muted = false;
  setAudioMuted(on: boolean) {
    this.muted = on;
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
    this.emit("destroyed");
  }
  isDestroyed() {
    return this.closed;
  }
  focused = false;
  isFocused() {
    return this.focused;
  }
  css: string[] = [];
  isolated: { world: number; code: string }[] = [];
  dom = { classes: ["ad-slot", "article"], ids: ["main"], hrefs: [], collapsed: 0 };
  insertCSS(css: string) {
    this.css.push(css);
    return Promise.resolve("");
  }
  commands: [string, Record<string, unknown>][] = [];
  attached = false;
  debugger = {
    isAttached: () => this.attached,
    attach: () => {
      this.attached = true;
    },
    sendCommand: (method: string, params: Record<string, unknown>) => {
      this.commands.push([method, params]);
      return Promise.resolve(
        method === "Page.addScriptToEvaluateOnNewDocument" ? { identifier: `id${this.commands.length}` } : {},
      );
    },
  };
  /** What a script in the password world returns (a fill: whether it found the fields). */
  pwResult: unknown = true;
  executeJavaScriptInIsolatedWorld(world: number, scripts: { code: string }[]) {
    this.isolated.push({ world, code: scripts[0]!.code });
    return Promise.resolve(world === 1078 ? this.pwResult : this.dom);
  }
  reloads = 0;
  /** F5 and the Reload button: a normal reload, the cache kept (1.2.18). */
  plainReloads = 0;
  reload() {
    this.plainReloads++;
  }
  reloadIgnoringCache() {
    this.reloads++;
  }
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
  full = false;
  isFullScreen() {
    return this.full;
  }
  setFullScreen(on: boolean) {
    this.full = on;
  }
  getContentSize() {
    return [1920, 1080];
  }
  listeners = 0;
  on() {
    this.listeners++;
  }
  removeListener() {
    this.listeners--;
  }
  contentView = {
    addChildView: (v: FakeView) => this.children.push(v),
    removeChildView: (v: FakeView) => (this.children = this.children.filter((c) => c !== v)),
  };
  once() {
    this.listeners++;
  }
  destroyed = false;
  isDestroyed() {
    return this.destroyed;
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

function setup(opts: { passwords?: boolean } = {}) {
  const ses = fakeSession();
  const fakeApp = {
    getPath: () => dir,
    userAgentFallback: "Mozilla/5.0 edexo-compare/1.2.16 Electron/42.0.0",
  };
  const appWin = new FakeWindow();
  // A window a tab was dragged into: an app window too.
  const appWin2 = new FakeWindow();
  const prefs = createBrowserPrefs({ dir });
  const passwords = opts.passwords
    ? createBrowserPasswords({ dir, safeStorage: fakeSafeStorage(), platform: "win32" })
    : undefined;
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
    scripts: (u: string) => (/youtube\.com/.test(u) ? ["window.__noAds = 1;"] : []),
    domCosmetics: (_u: string, d: { classes: string[] }) =>
      d.classes.includes("ad-slot") ? ".ad-slot { display: none !important; }" : "",
    release: vi.fn(),
  };
  const tabs = createBrowserTabs({
    electron: {
      BrowserWindow: {
        fromWebContents: (wc: unknown) =>
          wc === appWin.webContents ? appWin : wc === appWin2.webContents ? appWin2 : null,
      },
      WebContentsView: FakeView,
      Menu: { buildFromTemplate: () => ({ popup() {} }) },
      clipboard: { writeText() {} },
      session: { fromPartition: () => ses },
      app: fakeApp,
    },
    prefs,
    blocker,
    isAppWindow: (wc: unknown) => wc === appWin.webContents || wc === appWin2.webContents,
    passwords,
  });
  const call = (a: Record<string, unknown>) => tabs.handle({ sender: appWin.webContents }, a);
  return { ses, appWin, appWin2, prefs, blocker, decided, tabs, call, fakeApp, passwords };
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
    // The default user agent, not a session override (an override leaves the client hints without brands).
    expect(t.ses.ua).toBe("");
    expect(t.fakeApp.userAgentFallback).toMatch(/^Mozilla\/5\.0 .* Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
    expect(t.fakeApp.userAgentFallback).not.toMatch(/Electron|edexo/i);
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
    // Switched off from the toolbar: the page loads again past every cache, so the change shows at once.
    await t.call({ op: "siteBlocking", id: 2, on: false });
    expect(wc.reloads).toBe(1);
    expect(wc.plainReloads).toBe(0);
    // The Reload button is a normal reload again, the cache kept (1.2.18: skipping it made every reload a first visit).
    await t.call({ op: "reload", id: 2 });
    expect(wc.reloads).toBe(1);
    expect(wc.plainReloads).toBe(1);
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
    expect(p.addLink("Canonn", "https://canonn.science")).toBe(true);
    expect(p.addLink("Bad", "javascript:alert(1)")).toBe(false);
    expect(p.addLink("", "https://x.y")).toBe(false);
    expect(
      p
        .links()
        .filter((l) => !l.builtIn)
        .map((l) => l.url),
    ).toEqual(["https://canonn.science/"]);
    expect(p.searchUrl("a b")).toBe("https://duckduckgo.com/?q=a%20b");
    expect(p.setEngine("custom", "file:///%s")).toBe(false);
    expect(p.setEngine("custom", "https://search.example/?q=%s")).toBe(true);
    expect(createBrowserPrefs({ dir }).searchUrl("x")).toBe("https://search.example/?q=x");
  });
});

describe("hiding what was blocked", () => {
  it("collapses the frames and images whose request was blocked, and reads the page's class names and ids", async () => {
    // jsdom has no type declarations here; only the page's document is needed.
    const { JSDOM } = require("jsdom") as {
      JSDOM: new (
        html: string,
        o: { url: string; runScripts: string },
      ) => { window: Window & { eval: (code: string) => unknown } };
    };
    const dom = new JSDOM(
      `<div class="ad-slot top"><iframe src="https://ads.example/f.html"></iframe></div>
       <img src="https://ads.example/b.png"><img id="logo" src="https://site.example/logo.png">
       <a href="https://shop.example/x">x</a>`,
      { url: "https://site.example/", runScripts: "outside-only" },
    );
    const r = dom.window.eval(
      cosmeticScript(["https://ads.example/f.html", "https://ads.example/b.png"]),
    ) as {
      classes: string[];
      ids: string[];
      hrefs: string[];
      collapsed: number;
    };
    expect(r.collapsed).toBe(2);
    expect(dom.window.document.querySelector("iframe")!.style.getPropertyValue("display")).toBe("none");
    expect(dom.window.document.querySelector("#logo")!.getAttribute("style")).toBeNull();
    expect(r.classes).toEqual(expect.arrayContaining(["ad-slot", "top"]));
    expect(r.ids).toEqual(["logo"]);
    expect(r.hrefs).toEqual(["https://shop.example/x"]);
  });

  it("asks for the general rules with the page's names, in its own world, and inserts them as a user stylesheet", async () => {
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://news.example/" });
    const wc = FakeView.made[0]!.webContents;
    // A blocked ad frame: collapsed by the next look at the page.
    const req = { resourceType: "subFrame", url: "https://ads.example/f.html", webContents: wc };
    expect(ask((cb) => t.ses.before!(req, cb))).toEqual({ cancel: true });
    wc.emit("dom-ready");
    await new Promise((r) => setTimeout(r, 0));
    expect(wc.isolated[0]!.world).toBeGreaterThan(0);
    expect(wc.isolated[0]!.code).toContain("https://ads.example/f.html");
    expect(wc.css).toContain(".ad-slot { display: none !important; }");
    // Names seen once are not asked for again on the same page.
    const before = wc.css.length;
    wc.emit("did-stop-loading");
    await new Promise((r) => setTimeout(r, 0));
    expect(wc.css.length).toBe(before);
  });

  it("leaves a site with blocking off alone", async () => {
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://news.example/" });
    t.prefs.setBlocking("news.example", false);
    const wc = FakeView.made[0]!.webContents;
    wc.emit("dom-ready");
    await new Promise((r) => setTimeout(r, 0));
    expect(wc.isolated).toEqual([]);
    expect(wc.css).toEqual([]);
  });
});

describe("scriptlets (YouTube)", () => {
  const page = async (t: ReturnType<typeof setup>, url: string) => {
    await t.call({ op: "open", text: url });
    const wc = FakeView.made[FakeView.made.length - 1]!.webContents;
    await new Promise<void>((done) =>
      t.ses.before!({ resourceType: "mainFrame", url, webContents: wc }, () => done()),
    );
    return wc;
  };

  it("go in before the page's own code, only in the top frame of their own site, through the DevTools protocol", async () => {
    const t = setup();
    await t.call({ op: "start" });
    const wc = await page(t, "https://www.youtube.com/watch?v=x");
    expect(wc.attached).toBe(true);
    expect(wc.commands[0]![0]).toBe("Page.enable");
    const [method, params] = wc.commands[1]!;
    expect(method).toBe("Page.addScriptToEvaluateOnNewDocument");
    const src = String(params.source);
    expect(src).toContain("window.__noAds = 1;");
    expect(src).toContain('location.hostname!=="www.youtube.com"');
    expect(src).toContain("window.top!==window");
    // Nothing of ours a page could notice: no console line, no global of our own.
    expect(src).not.toMatch(/console\.|edexo/i);
    // Never the Runtime domain (pages can notice it).
    expect(wc.commands.some(([m]) => m.startsWith("Runtime."))).toBe(false);
  });

  it("attach nothing on a site without any, and come off when blocking is switched off there", async () => {
    const t = setup();
    await t.call({ op: "start" });
    const plain = await page(t, "https://www.edsm.net/");
    expect(plain.attached).toBe(false);
    expect(plain.commands).toEqual([]);
    const yt = await page(t, "https://www.youtube.com/");
    t.prefs.setBlocking("youtube.com", false);
    await new Promise<void>((done) =>
      t.ses.before!({ resourceType: "mainFrame", url: "https://www.youtube.com/", webContents: yt }, () =>
        done(),
      ),
    );
    expect(yt.commands.map(([m]) => m)).toEqual([
      "Page.enable",
      "Page.addScriptToEvaluateOnNewDocument",
      "Page.removeScriptToEvaluateOnNewDocument",
    ]);
  });
});

describe("a page in fullscreen", () => {
  it("takes the whole screen, then gives the window back as it was", async () => {
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://www.youtube.com/watch?v=x" });
    await t.call({ op: "bounds", rect: { x: 0, y: 100, width: 800, height: 600 } });
    const v = FakeView.made[0]!;
    v.webContents.emit("enter-html-full-screen");
    expect(t.appWin.full).toBe(true);
    expect(v.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(v.visible).toBe(true);
    v.webContents.emit("leave-html-full-screen");
    expect(t.appWin.full).toBe(false);
    expect(v.bounds).toEqual({ x: 0, y: 100, width: 800, height: 600 });
  });

  it("leaves a window that was fullscreen already as it was", async () => {
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://www.youtube.com/watch?v=x" });
    t.appWin.full = true;
    const v = FakeView.made[0]!;
    v.webContents.emit("enter-html-full-screen");
    v.webContents.emit("leave-html-full-screen");
    expect(t.appWin.full).toBe(true);
  });
});

describe("review 1.2.16", () => {
  it("drops the tab of a page that closes itself, and the toolbar's state reads fine after", async () => {
    const t = setup();
    await t.call({ op: "start" });
    const { id } = (await t.call({ op: "open", text: "https://pay.example/" })) as { id: number };
    // window.close(): Electron destroys the page's contents.
    FakeView.made[0]!.webContents.close();
    const st = (await t.call({ op: "state" })) as { tabs: { id: number }[] };
    expect(st.tabs.map((x) => x.id)).not.toContain(id);
    await t.call({ op: "close", id });
  });

  it("opens a window a page asks for without a click behind the current tab, three a page at most", async () => {
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://ads.example/" });
    const page = FakeView.made[0]!.webContents;
    const before = ((await t.call({ op: "state" })) as { active: number }).active;
    for (let i = 0; i < 5; i++) page.openHandler!({ url: `https://pop${i}.example/` });
    const st = (await t.call({ op: "state" })) as { active: number; tabs: unknown[] };
    expect(st.active).toBe(before);
    // The start page, the page, and three pop-ups.
    expect(st.tabs).toHaveLength(5);
    // A click first: in front.
    page.emit("input-event", {}, { type: "mouseDown" });
    page.openHandler!({ url: "https://wanted.example/" });
    expect(((await t.call({ op: "state" })) as { active: number }).active).not.toBe(before);
  });

  it("offers plain HTTP only for a link that said HTTP, never after a certificate error", async () => {
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://bad-cert.example/" });
    const wc = FakeView.made[0]!.webContents;
    wc.emit("did-fail-load", {}, -202, "ERR_CERT_AUTHORITY_INVALID", "https://bad-cert.example/", true);
    let tab = (
      (await t.call({ op: "state" })) as { tabs: { error: { httpFallback: string | null } | null }[] }
    ).tabs[1]!;
    expect(tab.error?.httpFallback).toBeNull();
    // A link to http://old.example, asked for over HTTPS by this run, failing to connect: the choice is offered.
    ask((cb) =>
      t.ses.before!({ resourceType: "mainFrame", url: "http://old.example/", webContents: wc }, cb),
    );
    wc.emit("did-fail-load", {}, -102, "ERR_CONNECTION_REFUSED", "https://old.example/", true);
    tab = ((await t.call({ op: "state" })) as { tabs: { error: { httpFallback: string | null } | null }[] })
      .tabs[1]!;
    expect(tab.error?.httpFallback).toBe("http://old.example/");
  });

  it("ignores a stop from a window that no longer holds the pages", async () => {
    vi.useFakeTimers();
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://edsm.net/" });
    // The Browser tab dragged onto the second window: it starts there and takes the pages …
    await t.tabs.handle({ sender: t.appWin2.webContents }, { op: "start" });
    await t.tabs.handle(
      { sender: t.appWin2.webContents },
      { op: "bounds", rect: { x: 0, y: 90, width: 900, height: 600 } },
    );
    expect(t.appWin2.children).toHaveLength(1);
    // … and the first window's late "stop" as its tab unmounts changes nothing.
    await t.call({ op: "stop" });
    vi.advanceTimersByTime(5000);
    expect(FakeView.made[0]!.webContents.closed).toBe(false);
    expect(FakeView.made[0]!.visible).toBe(true);
  });

  it("keeps the remembered sites' origins valid, an address site too", () => {
    const p = createBrowserPrefs({ dir });
    p.setRemember("192.168.1.20", true);
    p.setRemember("edsm.net", true);
    expect(p.keptOrigins()).toEqual(["https://192.168.1.20", "https://edsm.net", "https://www.edsm.net"]);
  });

  it("mutes a page left for the start page, and shows it again with Back", async () => {
    const t = setup();
    await t.call({ op: "start" });
    const { id } = (await t.call({ op: "open", text: "https://www.youtube.com/" })) as { id: number };
    const wc = FakeView.made[0]!.webContents;
    await t.call({ op: "home", id });
    expect(wc.muted).toBe(true);
    await t.call({ op: "back", id });
    expect(wc.muted).toBe(false);
    expect(
      ((await t.call({ op: "state" })) as { tabs: { id: number; startPage: boolean }[] }).tabs.find(
        (x) => x.id === id,
      )?.startPage,
    ).toBe(false);
  });
});

describe("keep page cache (owner, 2026-10-16)", () => {
  it("is off by default and kept with the other settings", () => {
    const p = createBrowserPrefs({ dir });
    expect(p.keepCache()).toBe(false);
    expect(p.rememberPasswords()).toBe(false);
    expect(p.passwordNever()).toEqual([]);
    p.setKeepCache(true);
    p.setRememberPasswords(true);
    expect(p.addPasswordNever("https://inara.cz")).toBe(true);
    expect(p.addPasswordNever("https://inara.cz")).toBe(false);
    // Exact https origins only: no path, no plain HTTP.
    expect(p.addPasswordNever("https://inara.cz/login")).toBe(false);
    expect(p.addPasswordNever("http://inara.cz")).toBe(false);
    p.setEngine("brave");
    const again = createBrowserPrefs({ dir });
    expect(again.keepCache()).toBe(true);
    expect(again.rememberPasswords()).toBe(true);
    expect(again.passwordNever()).toEqual(["https://inara.cz"]);
    // The rest of the settings merge in unchanged.
    expect(again.searchUrl("x")).toBe("https://search.brave.com/search?q=x");
    expect(again.removePasswordNever("https://inara.cz")).toBe(true);
    again.setKeepCache(false);
    expect(createBrowserPrefs({ dir }).keepCache()).toBe(false);
  });

  it("off: clears everything as before; on: everything but the cache, the remembered sites still kept", async () => {
    const off = setup();
    await off.call({ op: "start" });
    expect(off.ses.cleared).toEqual([{}]);

    const on = setup();
    on.prefs.setKeepCache(true);
    on.prefs.setRemember("edsm.net", true);
    await on.call({ op: "start" });
    expect(on.ses.cleared).toEqual([
      { dataTypes: DATA_TYPES_BUT_CACHE, excludeOrigins: ["https://edsm.net", "https://www.edsm.net"] },
    ]);
    expect(DATA_TYPES_BUT_CACHE).not.toContain("cache");
    expect([...DATA_TYPES_BUT_CACHE, "cache"].sort()).toEqual([...ELECTRON_DATA_TYPES].sort());
    // Switched from the menu; "Clear everything now" still takes the cache too.
    const r = (await on.call({ op: "setKeepCache", on: false })) as { state: { keepCache: boolean } };
    expect(r.state.keepCache).toBe(false);
    await on.call({ op: "clearAll" });
    expect(on.ses.cleared.at(-1)).toBeNull();
  });
});

describe("remember passwords (owner, 2026-10-16)", () => {
  type St = {
    tabs: {
      id: number;
      passwordPrompt: { origin: string; username: string; update: boolean } | null;
      logins: string[];
    }[];
    rememberPasswords: boolean;
    passwords: { available: boolean; saved: { origin: string; username: string }[]; never: string[] };
  };
  const SECRET = "hunter2-very-secret";

  /** A login page on the browser, the option on, its dom-ready done: the tab, its page and the page's nonce. */
  async function loginPage(url = "https://inara.cz/login", on = true) {
    const t = setup({ passwords: true });
    if (on) t.prefs.setRememberPasswords(true);
    await t.call({ op: "start" });
    const { id } = (await t.call({ op: "open", text: url })) as { id: number };
    const wc = FakeView.made.at(-1)!.webContents;
    wc.emit("dom-ready");
    const script = wc.isolated.find((x) => x.world === 1078)?.code ?? "";
    const nonce = /const N = "([^"]+)";/.exec(script)?.[1] ?? null;
    const state = async () => (await t.call({ op: "state" })) as unknown as St;
    const tab = async () => (await state()).tabs.find((x) => x.id === id)!;
    const say = (message: string, frame: unknown = { parent: null }) =>
      wc.emit("console-message", { message, frame }, 0, message, 1, "");
    return { t, id, wc, nonce, state, tab, say };
  }
  const submit = (nonce: string, o: Record<string, unknown> = {}) =>
    nonce +
    JSON.stringify({ t: "submit", origin: "https://inara.cz", username: "cmdr", password: SECRET, ...o });

  it("watches nothing while off, and nothing on plain HTTP", async () => {
    const off = await loginPage("https://inara.cz/login", false);
    expect(off.nonce).toBeNull();
    expect(off.wc.isolated.filter((x) => x.world === 1078)).toEqual([]);
    const http = await loginPage("http://192.168.1.20/login");
    expect(http.nonce).toBeNull();
  });

  it("takes a report only with this page's nonce, from the top frame, for the page's origin", async () => {
    const p = await loginPage();
    expect(p.nonce).toMatch(/^[0-9a-f]{32}:$/);
    const nonce = p.nonce!;
    // The page's own console.log cannot know the nonce.
    p.say(submit("0123456789abcdef0123456789abcdef:"));
    p.say(JSON.stringify({ t: "submit", origin: "https://inara.cz", username: "x", password: "y" }));
    p.say(submit(nonce), { parent: { url: "https://ads.example/" } });
    p.say(submit(nonce, { origin: "https://evil.example" }));
    expect((await p.tab()).passwordPrompt).toBeNull();
    // Electron 42's details object …
    p.say(submit(nonce));
    expect((await p.tab()).passwordPrompt).toEqual({
      origin: "https://inara.cz",
      username: "cmdr",
      update: false,
    });
    // … and the older positional message (no details.message) both count.
    await p.t.call({ op: "passwordAnswer", id: p.id, answer: "later" });
    p.wc.emit("console-message", { frame: { parent: null } }, 0, submit(nonce), 1, "");
    expect((await p.tab()).passwordPrompt).toMatchObject({ origin: "https://inara.cz" });
    await p.t.call({ op: "passwordAnswer", id: p.id, answer: "later" });
    // The navigation a submit starts does not lose its report (it can arrive after) …
    p.wc.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    p.say(submit(nonce));
    expect((await p.tab()).passwordPrompt).toMatchObject({ origin: "https://inara.cz" });
    await p.t.call({ op: "passwordAnswer", id: p.id, answer: "later" });
    // … but the next document has its own nonce, and the old one counts no more.
    p.wc.emit("dom-ready");
    const fresh = /const N = "([^"]+)";/.exec(
      p.wc.isolated.filter((x) => x.world === 1078).at(-1)!.code,
    )?.[1];
    expect(fresh).toMatch(/^[0-9a-f]{32}:$/);
    expect(fresh).not.toBe(nonce);
    p.say(submit(nonce));
    expect((await p.tab()).passwordPrompt).toBeNull();
    p.say(submit(fresh!));
    expect((await p.tab()).passwordPrompt).toMatchObject({ origin: "https://inara.cz" });
  });

  it("never puts a password in the toolbar's state, and saves it encrypted on Save", async () => {
    const p = await loginPage();
    p.say(submit(p.nonce!));
    const before = await p.state();
    expect(JSON.stringify(before)).not.toContain(SECRET);
    expect(JSON.stringify(p.t.appWin.webContents.sent)).not.toContain(SECRET);
    const r = (await p.t.call({ op: "passwordAnswer", id: p.id, answer: "save" })) as unknown as {
      ok: boolean;
      state: St;
    };
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(r.state.passwords.saved).toEqual([{ origin: "https://inara.cz", username: "cmdr" }]);
    expect(r.state.tabs.find((x) => x.id === p.id)!.passwordPrompt).toBeNull();
    expect(readFileSync(path.join(dir, "browser", "passwords.json"), "utf8")).not.toContain(SECRET);
    // The same login again: no prompt; another password for it: "update".
    p.say(submit(p.nonce!));
    expect((await p.tab()).passwordPrompt).toBeNull();
    p.say(submit(p.nonce!, { password: "new-one" }));
    expect((await p.tab()).passwordPrompt).toMatchObject({ update: true });
  });

  it("remembers Never for this site, and Not now forgets the password", async () => {
    const p = await loginPage();
    p.say(submit(p.nonce!));
    await p.t.call({ op: "passwordAnswer", id: p.id, answer: "later" });
    expect((await p.tab()).passwordPrompt).toBeNull();
    expect(p.t.passwords!.list()).toEqual([]);
    p.say(submit(p.nonce!, { password: "second" }));
    await p.t.call({ op: "passwordAnswer", id: p.id, answer: "never" });
    expect(p.t.prefs.passwordNever()).toEqual(["https://inara.cz"]);
    p.say(submit(p.nonce!, { password: "third" }));
    expect((await p.tab()).passwordPrompt).toBeNull();
  });

  it("fills a lone saved login on its own once per page, through the password world (owner, 2026-10-16)", async () => {
    const p = await loginPage();
    p.t.passwords!.save("https://inara.cz", "cmdr", SECRET);
    p.say(`${p.nonce}${JSON.stringify({ t: "field", has: true })}`);
    const fills = () => p.wc.isolated.filter((x) => x.world === 1078).slice(1);
    expect(fills()).toHaveLength(1);
    expect(fills()[0]!.code).toContain("const AUTO = true;");
    expect(fills()[0]!.code).toContain(JSON.stringify(SECRET));
    // The field going and coming back on the same page does not fill again.
    p.say(`${p.nonce}${JSON.stringify({ t: "field", has: false })}`);
    p.say(`${p.nonce}${JSON.stringify({ t: "field", has: true })}`);
    expect(fills()).toHaveLength(1);
  });

  it("fills nothing on its own when several logins are saved for the site: the key button chooses", async () => {
    const p = await loginPage();
    p.t.passwords!.save("https://inara.cz", "a", "1");
    p.t.passwords!.save("https://inara.cz", "b", "2");
    p.say(`${p.nonce}${JSON.stringify({ t: "field", has: true })}`);
    expect(p.wc.isolated.filter((x) => x.world === 1078)).toHaveLength(1);
  });

  it("shows the key on a page with a password field and fills through the password world when asked", async () => {
    const p = await loginPage();
    p.t.passwords!.save("https://inara.cz", "cmdr", SECRET);
    expect((await p.tab()).logins).toEqual([]);
    p.say(`${p.nonce}${JSON.stringify({ t: "field", has: true })}`);
    expect((await p.tab()).logins).toEqual(["cmdr"]);
    const r = await p.t.call({ op: "passwordFill", id: p.id });
    expect(r).toEqual({ ok: true });
    const fill = p.wc.isolated.at(-1)!;
    expect(fill.world).toBe(1078);
    expect(fill.code).toContain(JSON.stringify(SECRET));
    expect(fill.code).toContain('location.origin !== "https://inara.cz"');
    // Off: no key, no fill, the saved login kept.
    await p.t.call({ op: "setRememberPasswords", on: false });
    expect((await p.tab()).logins).toEqual([]);
    expect(await p.t.call({ op: "passwordFill", id: p.id })).toEqual({ error: "Nothing to fill." });
    expect((await p.state()).passwords.saved).toHaveLength(1);
  });

  it("deletes one saved password, or all", async () => {
    const p = await loginPage();
    p.t.passwords!.save("https://inara.cz", "a", "1");
    p.t.passwords!.save("https://inara.cz", "b", "2");
    let r = (await p.t.call({
      op: "passwordDelete",
      origin: "https://inara.cz",
      username: "a",
    })) as unknown as {
      state: St;
    };
    expect(r.state.passwords.saved).toEqual([{ origin: "https://inara.cz", username: "b" }]);
    r = (await p.t.call({ op: "passwordDeleteAll" })) as unknown as { state: St };
    expect(r.state.passwords.saved).toEqual([]);
  });
});

describe("the password world's scripts, on a page", () => {
  // jsdom has no type declarations here; only the page's document and its console are needed.
  type Dom = {
    window: Window & {
      eval: (code: string) => unknown;
      close: () => void;
      Event: typeof Event;
      MouseEvent: typeof MouseEvent;
    };
  };
  const { JSDOM, VirtualConsole } = require("jsdom") as {
    JSDOM: new (html: string, o: Record<string, unknown>) => Dom;
    VirtualConsole: new () => { on(ev: string, cb: (...a: unknown[]) => void): void };
  };
  function page(html: string) {
    const logs: string[] = [];
    const vc = new VirtualConsole();
    vc.on("log", (...a) => logs.push(a.map(String).join(" ")));
    const dom = new JSDOM(html, {
      url: "https://inara.cz/login",
      runScripts: "outside-only",
      virtualConsole: vc,
    });
    // jsdom lays nothing out: every element counts as shown.
    (
      dom.window as unknown as { Element: { prototype: { getClientRects: () => unknown[] } } }
    ).Element.prototype.getClientRects = () => [{}];
    return { dom, logs, doc: dom.window.document };
  }

  it("reports a form's login with the nonce, and says the page has a password field", () => {
    const { dom, logs, doc } = page(
      `<form><input name="q"><input id="u" type="email" autocomplete="username"><input id="p" type="password"><button>Sign in</button></form>`,
    );
    dom.window.eval(passwordCaptureScript("abc:"));
    expect(logs).toEqual([`abc:${JSON.stringify({ t: "field", has: true })}`]);
    (doc.querySelector("#u") as HTMLInputElement).value = "cmdr";
    (doc.querySelector("#p") as HTMLInputElement).value = "pw1";
    doc
      .querySelector("form")!
      .dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    const report = logs.at(-1)!;
    expect(report.startsWith("abc:")).toBe(true);
    expect(JSON.parse(report.slice(4))).toEqual({
      t: "submit",
      origin: "https://inara.cz",
      username: "cmdr",
      password: "pw1",
    });
    // A click on the button as well as the submit: reported once.
    doc.querySelector("button")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(logs.filter((l) => l.includes('"submit"'))).toHaveLength(1);
    dom.window.close();
  });

  it("takes the nearest text input before the password when nothing says username", () => {
    const { dom, logs, doc } = page(
      `<div><input id="other" type="text"><input id="u" type="text"><input id="p" type="password"><div role="button">Go</div></div>`,
    );
    dom.window.eval(passwordCaptureScript("n:"));
    (doc.querySelector("#u") as HTMLInputElement).value = "cmdr";
    (doc.querySelector("#p") as HTMLInputElement).value = "pw";
    doc.querySelector("[role=button]")!.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(JSON.parse(logs.at(-1)!.slice(2))).toMatchObject({ username: "cmdr", password: "pw" });
    dom.window.close();
  });

  it("fills the username and password as typed input, on its own origin only", () => {
    const { dom, doc } = page(`<form><input id="u" type="text"><input id="p" type="password"></form>`);
    const seen: string[] = [];
    doc.addEventListener("input", (e) => seen.push((e.target as HTMLInputElement).id), true);
    expect(dom.window.eval(passwordFillScript("https://other.example", "cmdr", "pw"))).toBe(false);
    expect((doc.querySelector("#p") as HTMLInputElement).value).toBe("");
    expect(dom.window.eval(passwordFillScript("https://inara.cz", "cmdr", 'p"w\\'))).toBe(true);
    expect((doc.querySelector("#u") as HTMLInputElement).value).toBe("cmdr");
    expect((doc.querySelector("#p") as HTMLInputElement).value).toBe('p"w\\');
    expect(seen).toEqual(["u", "p"]);
    dom.window.close();
  });

  it("on its own, fills only empty fields and leaves the keyboard focus alone", () => {
    const { dom, doc } = page(`<form><input id="u" type="text"><input id="p" type="password"><input id="x" type="text"></form>`);
    const x = doc.querySelector("#x") as HTMLInputElement;
    x.focus();
    (doc.querySelector("#u") as HTMLInputElement).value = "typed";
    expect(dom.window.eval(passwordFillScript("https://inara.cz", "cmdr", "pw", true))).toBe(true);
    expect((doc.querySelector("#u") as HTMLInputElement).value).toBe("typed");
    expect((doc.querySelector("#p") as HTMLInputElement).value).toBe("pw");
    expect(doc.activeElement).toBe(x);
    // A password already typed is never replaced.
    (doc.querySelector("#p") as HTMLInputElement).value = "mine";
    expect(dom.window.eval(passwordFillScript("https://inara.cz", "cmdr", "pw", true))).toBe(false);
    expect((doc.querySelector("#p") as HTMLInputElement).value).toBe("mine");
    dom.window.close();
  });
});

describe("F5 in a browsed page (owner, 2026-10-16: F5 did nothing in the browser)", () => {
  it("reloads the page that has the keyboard, and only when one has it", async () => {
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://www.edsm.net/" });
    const wc = FakeView.made[FakeView.made.length - 1]!.webContents;
    expect(t.tabs.reloadFocused()).toBe(false);
    expect(wc.plainReloads).toBe(0);
    wc.focused = true;
    expect(t.tabs.reloadFocused()).toBe(true);
    expect(wc.plainReloads).toBe(1);
  });
});

describe("closing the app (owner, 2026-10-16: \"Cannot read properties of undefined (reading 'isDestroyed') at closeTab\")", () => {
  it("a page torn down at quit closes its tab without touching its gone webContents, and opens no new page", async () => {
    const t = setup();
    await t.call({ op: "start" });
    await t.call({ op: "open", text: "https://www.edsm.net/" });
    const before = FakeView.made.length;
    const view = FakeView.made[before - 1]!;
    const wc = view.webContents;
    t.appWin.destroyed = true;
    (view as unknown as { webContents: unknown }).webContents = undefined;
    expect(() => wc.close()).not.toThrow();
    expect(FakeView.made.length).toBe(before);
  });
});
