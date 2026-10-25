"use strict";

/*
  The EDEXO browser (plan 9, owner 2026-10-13): a light, private browser inside the app's Browser tab.

  The main process owns everything. Each page is a WebContentsView (never a <webview>) on its own session,
  `persist:edexo-browser`, apart from the app's; the app's window only draws the toolbar and says where the page
  goes, through a narrow set of calls (preload.cjs `browser`), every argument checked here. Browsed pages get no
  preload, no Node, a sandbox, web security, no insecure content, no permissions but fullscreen, no new windows
  (a link that opens one becomes a tab), no navigation outside http(s), no certificate exceptions.

  Private by default: everything a site stores is cleared at the browser's first use in each run (and at quit),
  except for the sites marked "Remember this site" (and the page cache, when "Keep page cache" is on). Blocking
  (browserBlocker.cjs) is on for every site unless switched off for it. Nothing is collected: no history kept, no
  telemetry, Do Not Track and Global Privacy Control sent, a plain Chrome user agent (no Electron or app name in it).
  "Remember passwords" (off by default) keeps logins encrypted by the operating system (browserPasswords.cjs).

  RAM: nothing until the Browser tab opens; one renderer per page while it is open; when the tab closes every page
  closes and the blocking engine is let go.
*/

const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { httpUrl } = require("./browserPrefs.cjs");
const { createTabPasswords } = require("./browserTabPasswords.cjs");
// The page-side scripts and the address helpers (audit 2026-10-22: moved out, re-exported below).
const {
  cosmeticScript,
  passwordCaptureScript,
  passwordFillScript,
  inaraReadScript,
  inaraOfferScript,
} = require("./browserPageScripts.cjs");
const { isLocalHost, resolveTyped, isInaraCommodityPage, chromeUserAgent } = require("./browserUrls.cjs");

const PARTITION = "persist:edexo-browser";
const MAX_TABS = 30;
/** A Browser tab unmounted (closed, or being moved to another window): pages close unless it comes back by then. */
const DETACH_GRACE_MS = 4000;
/**
 * The script world the page's class names are read in: its own JavaScript world, which the page cannot see or
 * reach (the DOM is shared, the scripts are not), so browsed pages still get no preload.
 */
const COSMETIC_WORLD = 1077;
/**
 * The script world the Inara pop-up ("EDEXO — Read") lives and reads in (1.3.0, C5): its own, like the others, so the page
 * cannot see or change what is read.
 */
const INARA_WORLD = 1079;
/** The most of an Inara results table taken across (a full commodity search is a few hundred kB). */
const INARA_TABLE_MAX = 4_000_000;
/** A pop-up's Read the app window has not answered by then: the pop-up says so instead of "Reading…" for ever. */
const INARA_ANSWER_MS = 15_000;
/*
  "Keep page cache" (owner, 2026-10-16): everything a site stored is cleared as before except the HTTP cache, so a
  site visited in an earlier run loads from disk. Measured with docs/perf/browser/timing.cjs on five sites: a cold
  load took ~775-895 ms, a warm one ~142-300 ms. Every clearData data type but "cache" (Electron 42's list).
*/
const DATA_TYPES_BUT_CACHE = [
  "backgroundFetch",
  "cookies",
  "downloads",
  "fileSystems",
  "indexedDB",
  "localStorage",
  "serviceWorkers",
  "webSQL",
];
/** Looked again after the page loaded, for what it adds later (lazy ad slots). */
const COSMETIC_PASSES_MS = [1500, 4000, 10000];
/** How long a page's request waits for its scriptlets to be registered (they take a few ms). */
const INJECT_WAIT_MS = 1500;
/** Requests of these kinds, once blocked, leave a box on the page: it is collapsed. */
const COLLAPSE_TYPES = new Set(["subFrame", "image", "object", "media"]);

/**
 * @param {object} o
 * @param {typeof import("electron")} o.electron
 * @param {ReturnType<typeof import("./browserPrefs.cjs").createBrowserPrefs>} o.prefs
 * @param {ReturnType<typeof import("./browserBlocker.cjs").createBrowserBlocker>} o.blocker
 * @param {(wc: import("electron").WebContents) => boolean} o.isAppWindow  the sender is one of the app's windows
 * @param {(view: { webContents: import("electron").WebContents }) => void} [o.enableZoom]
 * @param {(msg: string) => void} [o.log]
 */
function createBrowserTabs(o) {
  const { BrowserWindow, WebContentsView, Menu, clipboard, session, app } = o.electron;
  /** @type {Map<number, any>} */
  const tabs = new Map();
  let order = [];
  let active = null;
  let nextId = 1;
  /** @type {import("electron").BrowserWindow | null} */
  let host = null;
  let bounds = null;
  let detachTimer = null;
  /*
    Windows told the pages went to another window ("elsewhere"). When that window lets them go (its Browser tab or the
    window closes), they are told the pages are free and take them back; the pages used to close after the grace while
    the first window still had its Browser tab open (review 2026-10-24).
  */
  const waiting = new Set();
  function offerToWaiting() {
    for (const wc of waiting) {
      if (wc.isDestroyed()) waiting.delete(wc);
      else wc.send("edexo:browser-event", { type: "free" });
    }
  }
  let ses = null;
  let cleared = false;
  /** Hosts whose https upgrade failed and that the commander chose to open over plain HTTP, this run. */
  const plainHttpOk = new Set();
  /** Hosts this run asked for over HTTPS instead of the HTTP a link named: only these may fall back to HTTP. */
  const upgradedHosts = new Set();
  const downloads = [];

  const domainOf = (url) => o.blocker.hostOf(url).domain;

  // ---- session -------------------------------------------------------------------------------------------------
  function getSession() {
    if (ses) return ses;
    ses = session.fromPartition(PARTITION);
    /*
      A plain Chrome user agent, as Electron's default for every page rather than an override on this session: an
      override leaves the page's client hints (navigator.userAgentData) without brands, which Cloudflare's "verify
      you are human" takes for a bot (owner, 2026-10-13: EDSM would not let him in past it). The app's own windows
      get it too, which changes nothing for them.
    */
    app.userAgentFallback = chromeUserAgent();
    ses.setSpellCheckerEnabled(false);
    ses.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === "fullscreen"));
    ses.setPermissionCheckHandler((_wc, permission) => permission === "fullscreen");
    ses.setDevicePermissionHandler(() => false);
    ses.setDisplayMediaRequestHandler((_req, cb) => cb({}));
    ses.webRequest.onBeforeRequest((details, cb) => {
      try {
        // HTTPS first: a page asked for over plain HTTP is asked for over HTTPS (plan 9.2).
        if (details.resourceType === "mainFrame" && details.url.startsWith("http://")) {
          const u = new URL(details.url);
          if (!isLocalHost(u.hostname) && !plainHttpOk.has(u.host)) {
            u.protocol = "https:";
            upgradedHosts.add(u.host);
            return cb({ redirectURL: u.href });
          }
        }
        const wc = details.webContents;
        const tab = wc ? tabOfContents(wc) : null;
        // A page about to load in a tab: its scriptlets are in place before the request goes (see injectFor).
        if (details.resourceType === "mainFrame") {
          if (!tab) {
            if (wc) o.log?.("browser: a page request without its tab");
            return cb({});
          }
          // At most a moment: a page never waits on its scriptlets for long.
          const limit = new Promise((r) => setTimeout(r, INJECT_WAIT_MS));
          return void Promise.race([injectFor(tab, details.url), limit]).finally(() => cb({}));
        }
        const page = tab ? wc.getURL() || tab.url : null;
        if (!page || !o.prefs.site(domainOf(page) ?? "").blocking) return cb({});
        const d = o.blocker.decide(details, page);
        if (d) {
          tab.blocked++;
          if (d.cancel && COLLAPSE_TYPES.has(details.resourceType) && tab.collapse.size < 1000)
            tab.collapse.add(details.url);
          changed();
          return cb(d);
        }
      } catch {
        /* a request the engine cannot read goes through */
      }
      cb({});
    });
    ses.webRequest.onBeforeSendHeaders((details, cb) => {
      const h = details.requestHeaders;
      h.DNT = "1";
      h["Sec-GPC"] = "1";
      cb({ requestHeaders: h });
    });
    // Downloads: asked every time (the save dialog), into Downloads by default, never opened by the app.
    ses.on("will-download", (_e, item) => {
      const name = path.basename(item.getFilename() || "download");
      item.setSaveDialogOptions({
        title: "Save the download",
        defaultPath: path.join(app.getPath("downloads"), name),
      });
      const d = { name, state: "progressing", received: 0, total: item.getTotalBytes() };
      downloads.unshift(d);
      downloads.length = Math.min(downloads.length, 10);
      changed();
      item.on("updated", () => {
        d.received = item.getReceivedBytes();
        d.total = item.getTotalBytes();
        changed();
      });
      item.once("done", (_ev, state) => {
        d.state = state;
        d.name = path.basename(item.getSavePath() || name);
        changed();
      });
    });
    return ses;
  }

  /*
    Scriptlets (browserBlocker.cjs; owner, 2026-10-13: a YouTube ad blocker "like uBlock Origin Lite"): the scripts
    the lists run on a site go in before the page's own code, through Chromium's DevTools protocol on that tab
    (Page.addScriptToEvaluateOnNewDocument) — still no preload, nothing exposed to the page, no Runtime domain
    turned on. Registered while the page's request waits, so the first load has them too; swapped as the tab goes
    from site to site, and each runs only in the top frame of the hostname it was made for. Most sites have none:
    then nothing is attached at all.
  */
  function injectFor(t, url) {
    // One at a time per tab (review 1.2.16: two at once could register a script twice and lose one of them).
    t.injecting = (t.injecting ?? Promise.resolve()).then(() => injectNow(t, url));
    return t.injecting;
  }
  async function injectNow(t, url) {
    const wc = t.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const host = o.blocker.hostOf(url).hostname;
    const on = !!host && o.prefs.site(domainOf(url) ?? "").blocking;
    const scripts = on ? o.blocker.scripts(url) : [];
    const key = scripts.length
      ? `${host}|${scripts.length}|${scripts.reduce((a, x) => a + x.length, 0)}`
      : "";
    if (key === t.injected.key) return;
    const dbg = wc.debugger;
    try {
      if (t.injected.id && dbg.isAttached())
        await dbg.sendCommand("Page.removeScriptToEvaluateOnNewDocument", { identifier: t.injected.id });
      t.injected = { key: "", id: null };
      if (!scripts.length) return;
      if (!dbg.isAttached()) {
        dbg.attach("1.3");
        t.pageDomain = false;
      }
      // Registered scripts run in new documents only once the Page domain is on (Runtime stays off).
      if (!t.pageDomain) {
        await dbg.sendCommand("Page.enable");
        t.pageDomain = true;
      }
      const body = scripts.map((x) => `(function(){try{${x}\n}catch(e){}})();`).join("\n");
      const source = `(function(){if(window.top!==window||location.hostname!==${JSON.stringify(host)})return;\n${body}\n})();`;
      const r = await dbg.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source });
      t.injected = { key, id: r && typeof r.identifier === "string" ? r.identifier : null };
      // No host name: the log is kept on disk, and the browser keeps no history (privacy policy).
      o.log?.(`browser: ${scripts.length} scriptlets registered`);
    } catch (e) {
      // Not attached (DevTools on the tab, a closed page): the page loads without its scriptlets.
      o.log?.(`browser: scriptlets not set: ${e && e.message ? e.message : e}`);
      t.injected = { key: "", id: null };
    }
  }

  /** Everything a site stored, except the remembered sites' (plan 9.2: incognito by default), and the cache if kept. */
  async function clearUnremembered() {
    const keep = o.prefs.keptOrigins();
    const what = {};
    if (o.prefs.keepCache()) what.dataTypes = [...DATA_TYPES_BUT_CACHE];
    if (keep.length) what.excludeOrigins = keep;
    await getSession().clearData(what);
  }

  // ---- tabs ----------------------------------------------------------------------------------------------------
  function tabOfContents(wc) {
    for (const t of tabs.values()) if (t.view && t.view.webContents === wc) return t;
    return null;
  }
  const isBrowserContents = (wc) => tabOfContents(wc) != null;

  let pushQueued = false;
  function changed() {
    if (pushQueued) return;
    pushQueued = true;
    setTimeout(() => {
      pushQueued = false;
      if (host && !host.isDestroyed()) host.webContents.send("edexo:browser-state", state());
    }, 50);
  }

  function tabView(t) {
    const live = t.view?.webContents;
    const wc = live && !live.isDestroyed() ? live : null;
    const dom = t.url ? domainOf(t.url) : null;
    const site = dom ? o.prefs.site(dom) : null;
    return {
      id: t.id,
      title: t.title || "",
      url: t.url || "",
      loading: t.loading,
      canBack: !!wc && wc.navigationHistory.canGoBack(),
      canForward: !!wc && wc.navigationHistory.canGoForward(),
      blocked: t.blocked,
      domain: dom,
      blocking: site ? site.blocking : true,
      remembered: site ? site.remember : false,
      secure: (t.url || "").startsWith("https://"),
      startPage: !!t.startPage,
      error: t.error,
      // Origin and username only: the captured password stays in the main process.
      passwordPrompt: t.pwPrompt
        ? { origin: t.pwPrompt.origin, username: t.pwPrompt.username, update: t.pwPrompt.update }
        : null,
      // The key button: saved usernames for this exact origin, while the page shows a password field.
      logins: t.pw && t.pwField && passwordsOn() ? passwords.usernames(t.pw.origin) : [],
      // Logins saved for this origin that the master password still locks: the key button offers an unlock.
      loginsLocked: t.pw && t.pwField && passwordsOn() ? passwords.lockedCount(t.pw.origin) : 0,
    };
  }

  function state() {
    return {
      tabs: order.map((id) => tabView(tabs.get(id))),
      active,
      blocker: o.blocker.status(),
      downloads: downloads.slice(0, 5),
      links: o.prefs.links(),
      engines: o.prefs.engines(),
      engine: o.prefs.engine(),
      customSearch: o.prefs.customSearch(),
      keepCache: o.prefs.keepCache(),
      rememberPasswords: o.prefs.rememberPasswords(),
      passwords: passwordsView(),
    };
  }

  function makeView(t) {
    const view = new WebContentsView({
      webPreferences: {
        session: getSession(),
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        webviewTag: false,
        experimentalFeatures: false,
        spellcheck: false,
        navigateOnDragDrop: false,
        safeDialogs: true,
        autoplayPolicy: "document-user-activation-required",
      },
    });
    view.setBackgroundColor("#ffffff");
    const wc = view.webContents;
    o.enableZoom?.(view);
    /*
      A new window becomes a tab: in front when he just clicked or typed in the page, else behind, and at most three
      of those a page (review 1.2.16: a page could push ad tabs to the front without a click; there is no pop-up
      blocker in Electron).
    */
    wc.on("input-event", (_e, input) => {
      if (input && (input.type === "mouseDown" || input.type === "keyDown" || input.type === "touchStart"))
        t.lastGesture = Date.now();
    });
    wc.setWindowOpenHandler(({ url }) => {
      if (!httpUrl(url)) return { action: "deny" };
      const asked = Date.now() - (t.lastGesture ?? 0) < 1500;
      if (asked) openTab(url, t.id);
      else if ((t.popups = (t.popups ?? 0) + 1) <= 3) openTab(url, t.id, { background: true });
      return { action: "deny" };
    });
    // A page that closes itself (window.close): its tab goes, cleanly (review 1.2.16: it crashed the main process).
    wc.once("destroyed", () => {
      if (tabs.get(t.id)?.view === view) closeTab(t.id);
    });
    const onlyHttp = (e, url) => {
      if (!httpUrl(url)) e.preventDefault();
    };
    wc.on("will-navigate", onlyHttp);
    wc.on("will-redirect", onlyHttp);
    wc.on("will-frame-navigate", (e) => {
      if (!httpUrl(e.url) && !/^(about:blank|about:srcdoc|data:|blob:)/.test(e.url)) e.preventDefault();
    });
    wc.on("will-attach-webview", (e) => e.preventDefault());
    wc.on("certificate-error", (e, _url, _err, _cert, cb) => {
      e.preventDefault();
      cb(false);
    });
    wc.on("did-start-loading", () => {
      t.loading = true;
      changed();
    });
    wc.on("did-stop-loading", () => {
      t.loading = false;
      changed();
      cosmeticPasses(t);
    });
    wc.on("did-start-navigation", (d) => {
      if (d.isMainFrame && !d.isSameDocument) {
        t.popups = 0;
        t.blocked = 0;
        t.error = null;
        t.collapse.clear();
        t.seen = { classes: new Set(), ids: new Set(), hrefs: new Set() };
        for (const x of t.passTimers.splice(0)) clearTimeout(x);
        /*
          Leaving the page: its password field (the key) goes now, its nonce at the next document's dom-ready. The
          report a sign-in's submit sends can arrive after the navigation it starts; only the old page knows its
          nonce, and that page is gone once the new one is in.
        */
        t.pwField = false;
      }
    });
    // The password world's reports (see onPageConsole); every other console line is ignored, and nothing is logged.
    wc.on("console-message", (details, _level, legacyMessage) => {
      const message = typeof details?.message === "string" ? details.message : legacyMessage;
      onPageConsole(t, wc, message, details?.frame);
      onInaraConsole(t, wc, message, details?.frame);
    });
    wc.on("did-navigate", (_e, url) => {
      t.url = url;
      const dom = domainOf(url);
      if (dom) o.prefs.noteOrigin(dom, new URL(url).origin);
      changed();
    });
    wc.on("did-navigate-in-page", (_e, url, isMain) => {
      if (isMain) t.url = url;
      changed();
    });
    wc.on("page-title-updated", (_e, title) => {
      t.title = String(title).slice(0, 200);
      changed();
    });
    wc.on("did-fail-load", (_e, code, desc, url, isMain) => {
      if (!isMain || code === -3) return; // -3: aborted (a new navigation, a download)
      /*
        "Open it over plain HTTP" only where the link itself said HTTP and this run tried HTTPS for it — never for a
        certificate error (-200 to -299): that is the attack the refusal is for (review 1.2.16).
      */
      let httpFallback = null;
      try {
        const u = new URL(url);
        const certError = code <= -200 && code > -300;
        if (u.protocol === "https:" && upgradedHosts.has(u.host) && !certError && !isLocalHost(u.hostname)) {
          u.protocol = "http:";
          httpFallback = u.href;
        }
      } catch {
        /* no fallback */
      }
      t.error = { code, text: String(desc || "The page could not be loaded."), url, httpFallback };
      t.url = url;
      changed();
    });
    wc.on("dom-ready", () => {
      const url = wc.getURL();
      watchPasswords(t, wc, url);
      offerInara(t, wc, url);
      if (!o.prefs.site(domainOf(url) ?? "").blocking) return;
      const css = o.blocker.cosmetics(url);
      if (css) void wc.insertCSS(css, { cssOrigin: "user" }).catch(() => {});
      void cosmeticPass(t);
    });
    wc.on("enter-html-full-screen", () => {
      if (!host || host.isDestroyed()) return;
      fullscreen = { id: t.id, wasFull: host.isFullScreen() };
      active = t.id;
      if (!fullscreen.wasFull) host.setFullScreen(true);
      placeViews();
      changed();
    });
    wc.on("leave-html-full-screen", () => {
      if (fullscreen?.id !== t.id) return;
      const was = fullscreen.wasFull;
      fullscreen = null;
      if (host && !host.isDestroyed() && !was) host.setFullScreen(false);
      placeViews();
    });
    wc.on("render-process-gone", (_e, d) => {
      t.error = { code: 0, text: `The page stopped (${d.reason}).`, url: t.url, httpFallback: null };
      t.loading = false;
      changed();
    });
    wc.on("before-input-event", (e, input) => {
      if (input.type !== "keyDown") return;
      const ctrl = input.control || input.meta;
      const k = String(input.key).toLowerCase();
      let done = true;
      if (ctrl && k === "t") openTab(null);
      else if (ctrl && k === "w") closeTab(t.id);
      else if (ctrl && k === "l") send("focusAddress");
      else if (k === "f5" || (ctrl && k === "r")) wc.reload();
      else if (input.alt && k === "arrowleft") wc.navigationHistory.goBack();
      else if (input.alt && k === "arrowright") wc.navigationHistory.goForward();
      else if (ctrl && k === "tab") stepTab(input.shift ? -1 : 1);
      // Esc leaves a page's fullscreen (asked in the script world the page cannot see).
      else if (k === "escape" && fullscreen?.id === t.id)
        void wc
          .executeJavaScriptInIsolatedWorld(COSMETIC_WORLD, [
            { code: "document.fullscreenElement && document.exitFullscreen()" },
          ])
          .catch(() => {});
      else done = false;
      if (done) e.preventDefault();
    });
    wc.on("context-menu", (_e, p) => {
      const items = [];
      if (p.linkURL && httpUrl(p.linkURL)) {
        items.push({ label: "Open link in a new tab", click: () => openTab(p.linkURL, t.id) });
        items.push({ label: "Copy link address", click: () => clipboard.writeText(p.linkURL) });
        items.push({ type: "separator" });
      }
      if (p.srcURL && p.mediaType === "image" && httpUrl(p.srcURL))
        items.push(
          { label: "Copy image address", click: () => clipboard.writeText(p.srcURL) },
          { type: "separator" },
        );
      if (p.isEditable)
        items.push({ role: "cut" }, { role: "copy" }, { role: "paste" }, { type: "separator" });
      else if (p.selectionText) items.push({ role: "copy" }, { type: "separator" });
      items.push(
        {
          label: "Back",
          enabled: wc.navigationHistory.canGoBack(),
          click: () => wc.navigationHistory.goBack(),
        },
        {
          label: "Forward",
          enabled: wc.navigationHistory.canGoForward(),
          click: () => wc.navigationHistory.goForward(),
        },
        { label: "Reload", click: () => wc.reload() },
      );
      Menu.buildFromTemplate(items).popup({ window: host && !host.isDestroyed() ? host : undefined });
    });
    return view;
  }

  /*
    The lists' general hiding rules (`##.ad-slot`, `###div-gpt-ad`, …) match on the page's own class names and ids,
    so they are asked for with those, a few times as the page fills; each new set of rules goes in as a user
    stylesheet (`display: none !important`, above the page's own styles), so the element leaves the layout.
  */
  async function cosmeticPass(t) {
    const wc = t.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const url = wc.getURL();
    if (!httpUrl(url) || !o.prefs.site(domainOf(url) ?? "").blocking) return;
    let r;
    try {
      r = await wc.executeJavaScriptInIsolatedWorld(COSMETIC_WORLD, [
        { code: cosmeticScript([...t.collapse]) },
      ]);
    } catch {
      return;
    }
    if (!r || wc.isDestroyed() || wc.getURL() !== url) return;
    const fresh = (list, seen) =>
      (Array.isArray(list) ? list : []).filter((v) => typeof v === "string" && !seen.has(v));
    const classes = fresh(r.classes, t.seen.classes);
    const ids = fresh(r.ids, t.seen.ids);
    const hrefs = fresh(r.hrefs, t.seen.hrefs);
    for (const v of classes) t.seen.classes.add(v);
    for (const v of ids) t.seen.ids.add(v);
    for (const v of hrefs) t.seen.hrefs.add(v);
    if (!classes.length && !ids.length && !hrefs.length) return;
    const css = o.blocker.domCosmetics(url, { classes, ids, hrefs });
    if (css) await wc.insertCSS(css, { cssOrigin: "user" }).catch(() => {});
  }
  function cosmeticPasses(t) {
    for (const x of t.passTimers.splice(0)) clearTimeout(x);
    void cosmeticPass(t);
    for (const ms of COSMETIC_PASSES_MS) t.passTimers.push(setTimeout(() => void cosmeticPass(t), ms));
  }

  // ---- remember passwords (browserTabPasswords.cjs) ----------------------------------------------------------------
  const passwords = o.passwords ?? null;
  const tabPasswords = createTabPasswords({ passwords, prefs: o.prefs, tabs, changed: () => changed(), state: () => state() });
  const { passwordsOn, watchPasswords, onPageConsole, dropPrompt, passwordsView } = tabPasswords;

  /** A tab opened from EDEXO's Inara links (`openInara`): each commodity search it loads gets the pop-up. */
  function offerInara(t, wc, url) {
    t.inara = null;
    if (!t.fromApp || !isInaraCommodityPage(url)) return;
    const nonce = `${randomBytes(16).toString("hex")}:`;
    t.inara = { nonce };
    void wc.executeJavaScriptInIsolatedWorld(INARA_WORLD, [{ code: inaraOfferScript(nonce) }]).catch(() => {});
  }

  /** What "EDEXO — Read" takes: the page's results table, its near star and the commodity picked, as shown. */
  async function readInaraPage(t) {
    const wci = t?.view?.webContents;
    if (!t || t.startPage || !wci || wci.isDestroyed()) return { error: "No page open." };
    const url = wci.getURL();
    if (!isInaraCommodityPage(url)) return { error: "Not an Inara commodity search page." };
    const r = await wci.executeJavaScriptInIsolatedWorld(INARA_WORLD, [{ code: inaraReadScript() }]).catch(() => null);
    const table = typeof r?.table === "string" ? r.table : "";
    if (!table) return { error: "No results on this page yet: run the search on Inara first." };
    if (table.length > INARA_TABLE_MAX) return { error: "The results table is too large to read." };
    const commodities = Array.isArray(r?.commodities)
      ? r.commodities.filter((c) => typeof c === "string" && c.length <= 80).slice(0, 10)
      : [];
    const near = typeof r?.near === "string" ? r.near.slice(0, 120) : "";
    return { ok: true, url, table, near, commodities };
  }

  /** The pop-up's text, in the page. */
  function inaraSay(t, text, ok) {
    const wci = t?.view?.webContents;
    if (!wci || wci.isDestroyed() || !t.inara) return;
    const code = `globalThis.__edexoInaraSay?.(${JSON.stringify(String(text).slice(0, 300))}, ${ok ? "true" : "false"})`;
    void wci.executeJavaScriptInIsolatedWorld(INARA_WORLD, [{ code }]).catch(() => {});
  }

  /**
   * The pop-up's buttons: a console line with this page's Inara nonce, from the top frame. Read: the page is read
   * and handed to the app window, which saves the sellers and answers with `inaraResult`.
   */
  function onInaraConsole(t, wc, message, frame) {
    const inara = t.inara;
    if (!inara || typeof message !== "string" || !message.startsWith(inara.nonce)) return;
    if (frame && frame.parent) return;
    let m;
    try {
      m = JSON.parse(message.slice(inara.nonce.length));
    } catch {
      return;
    }
    if (m?.t === "cancel") {
      t.inara = null;
      return;
    }
    if (m?.t !== "read") return;
    void readInaraPage(t).then((r) => {
      if (r.error) return inaraSay(t, r.error, false);
      if (!host || host.isDestroyed()) return inaraSay(t, "Open EDEXO's Browser tab to read pages into Colonize.", false);
      clearTimeout(t.inaraWait);
      t.inaraWait = setTimeout(
        () => inaraSay(t, "EDEXO did not answer. Open the Browser tab in EDEXO and press Read again.", false),
        INARA_ANSWER_MS,
      );
      host.webContents.send("edexo:browser-event", { type: "inaraRead", data: { id: t.id, read: r } });
    });
  }

  function send(type) {
    if (host && !host.isDestroyed()) host.webContents.send("edexo:browser-event", { type });
  }

  /*
    A page in fullscreen (a video's fullscreen button; owner, 2026-10-13: it filled the app's window, not the
    screen): the window goes fullscreen and that page covers all of it, over the app's toolbar and tabs, until the
    page leaves fullscreen (its button, or Esc). A window already fullscreen stays so afterwards.
  */
  let fullscreen = null;
  function placeViews() {
    if (!host || host.isDestroyed()) return;
    const zoom = host.webContents.getZoomFactor();
    if (fullscreen && tabs.get(fullscreen.id)?.view) {
      const [width, height] = host.getContentSize();
      for (const t of tabs.values()) {
        if (!t.view) continue;
        const on = t.id === fullscreen.id;
        if (on) t.view.setBounds({ x: 0, y: 0, width, height });
        t.view.setVisible(on);
      }
      return;
    }
    for (const t of tabs.values()) {
      if (!t.view) continue;
      const show = t.id === active && bounds && !t.startPage;
      if (show) {
        t.view.setBounds({
          x: Math.round(bounds.x * zoom),
          y: Math.round(bounds.y * zoom),
          width: Math.max(1, Math.round(bounds.width * zoom)),
          height: Math.max(1, Math.round(bounds.height * zoom)),
        });
      }
      t.view.setVisible(!!show);
    }
  }

  /** The host window's listeners, taken off when the pages move to another window (review 1.2.16: they piled up). */
  let hostListeners = null;
  function adopt(win) {
    if (host === win) return;
    for (const t of tabs.values()) {
      if (!t.view) continue;
      if (host && !host.isDestroyed()) host.contentView.removeChildView(t.view);
      win.contentView.addChildView(t.view);
    }
    if (hostListeners && !hostListeners.win.isDestroyed()) {
      hostListeners.win.removeListener("resize", hostListeners.resize);
      hostListeners.win.removeListener("closed", hostListeners.closed);
    }
    host = win;
    waiting.delete(win.webContents);
    // The window's size changes as it goes in and out of fullscreen: the fullscreen page follows it.
    const resize = () => {
      if (fullscreen && host === win) placeViews();
    };
    const closed = () => {
      if (host === win) {
        host = null;
        armDetach();
        offerToWaiting();
      }
    };
    win.on("resize", resize);
    win.once("closed", closed);
    hostListeners = { win, resize, closed };
  }

  /** Out of a page's fullscreen, the window as it was before it. */
  function leaveFullscreen() {
    if (!fullscreen) return;
    if (host && !host.isDestroyed() && !fullscreen.wasFull) host.setFullScreen(false);
    fullscreen = null;
  }

  function load(t, url) {
    t.startPage = false;
    t.error = null;
    t.view?.webContents.setAudioMuted(false);
    if (!t.view) {
      t.view = makeView(t);
      if (host && !host.isDestroyed()) host.contentView.addChildView(t.view);
    }
    t.url = url;
    void t.view.webContents.loadURL(url).catch(() => {});
    placeViews();
    changed();
  }

  /** A new tab after `after` (or at the end), on `url`, or on the start page when url is null; behind if asked. */
  function openTab(url, after, how = {}) {
    if (tabs.size >= MAX_TABS) return null;
    const t = {
      id: nextId++,
      collapse: new Set(),
      injected: { key: "", id: null },
      pageDomain: false,
      seen: { classes: new Set(), ids: new Set(), hrefs: new Set() },
      passTimers: [],
      view: null,
      title: "",
      url: "",
      loading: false,
      blocked: 0,
      error: null,
      startPage: true,
      pw: null,
      pwField: false,
      pwPrompt: null,
      // Opened from EDEXO's Inara links: its Inara commodity searches get the pop-up (offerInara).
      fromApp: false,
      inara: null,
      inaraWait: undefined,
    };
    tabs.set(t.id, t);
    const i = after != null ? order.indexOf(after) : -1;
    if (i >= 0) order.splice(i + 1, 0, t.id);
    else order.push(t.id);
    if (!how.background || active == null) active = t.id;
    if (url) load(t, url);
    placeViews();
    changed();
    return t.id;
  }

  function closeTab(id) {
    const t = tabs.get(id);
    if (!t) return;
    for (const x of t.passTimers.splice(0)) clearTimeout(x);
    clearTimeout(t.inaraWait);
    dropPrompt(t);
    if (fullscreen?.id === id) leaveFullscreen();
    tabs.delete(id);
    if (t.view) {
      /*
        At quit the page goes first and its "destroyed" handler lands here with the view already torn down: its
        webContents reads undefined (owner, 2026-10-16: "Cannot read properties of undefined (reading
        'isDestroyed') at closeTab" on closing the app). Nothing left to close then.
      */
      try {
        if (host && !host.isDestroyed()) host.contentView.removeChildView(t.view);
      } catch {
        /* the window is going away with it */
      }
      const wc = t.view.webContents;
      if (wc && !wc.isDestroyed()) wc.close();
    }
    const i = order.indexOf(id);
    order = order.filter((x) => x !== id);
    if (active === id) active = order[Math.min(i, order.length - 1)] ?? null;
    // The last page closed: a fresh start page, so the Browser tab never shows nothing — not while the window goes.
    if (!order.length && host && !host.isDestroyed()) openTab(null);
    placeViews();
    changed();
  }

  function stepTab(dir) {
    if (order.length < 2) return;
    const i = order.indexOf(active);
    active = order[(i + dir + order.length) % order.length];
    placeViews();
    changed();
  }

  /** Every page closed and the engine let go (the Browser tab closed). */
  function closeAll() {
    leaveFullscreen();
    for (const t of tabs.values()) {
      for (const x of t.passTimers.splice(0)) clearTimeout(x);
      clearTimeout(t.inaraWait);
      dropPrompt(t);
      if (!t.view) continue;
      try {
        if (host && !host.isDestroyed()) host.contentView.removeChildView(t.view);
      } catch {
        /* the window is going away with it */
      }
      // Torn down already at quit (see closeTab).
      const wc = t.view.webContents;
      if (wc && !wc.isDestroyed()) wc.close();
    }
    tabs.clear();
    order = [];
    active = null;
    bounds = null;
    o.blocker.release();
  }

  function armDetach() {
    clearTimeout(detachTimer);
    detachTimer = setTimeout(() => {
      detachTimer = null;
      if (!bounds || !host) closeAll();
    }, DETACH_GRACE_MS);
  }

  // ---- calls from the app's window -------------------------------------------------------------------------------
  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const idOf = (a) => (typeof a?.id === "number" && tabs.has(a.id) ? a.id : null);

  /** @param {import("electron").IpcMainInvokeEvent} e @param {any} a */
  async function handle(e, a) {
    const wc = e.sender;
    if (!o.isAppWindow(wc) || isBrowserContents(wc)) return { error: "Not allowed." };
    const win = BrowserWindow.fromWebContents(wc);
    if (!win) return { error: "No window." };
    const op = typeof a?.op === "string" ? a.op : "";
    const id = idOf(a);
    const t = id != null ? tabs.get(id) : null;
    if (tabPasswords.owns(op)) return tabPasswords.handle(op, a, t);
    switch (op) {
      case "state":
        return state();
      case "start": {
        // The Browser tab is on screen in this window: its pages come here, the engine is read.
        clearTimeout(detachTimer);
        detachTimer = null;
        // The window that had them (Compare and Colonize can both have a Browser tab) is told, so it says so.
        if (host && host !== win && !host.isDestroyed()) {
          host.webContents.send("edexo:browser-event", { type: "elsewhere" });
          waiting.add(host.webContents);
        }
        adopt(win);
        if (!cleared) {
          cleared = true;
          await clearUnremembered().catch((err) => o.log?.(`browser: clear failed: ${err}`));
        }
        await o.blocker.ensure();
        if (!order.length && o.blocker.status().ready) openTab(null);
        changed();
        return state();
      }
      case "stop":
        // Unmounted: closed, or moving to another window (which sends "start" within the grace). A window that no
        // longer holds the pages (the tab was moved on) has nothing to stop (review 1.2.16: it closed them all).
        if (win !== host) return { ok: true };
        leaveFullscreen();
        bounds = null;
        placeViews();
        armDetach();
        offerToWaiting();
        return { ok: true };
      case "downloadLists": {
        const ok = await o.blocker.download();
        if (ok && !order.length) openTab(null);
        changed();
        return state();
      }
      /*
        A picture of the page in front (owner, 2026-10-17: a menu over the browser hid the page, the app's background
        showed through). The page is a native layer above the app window, so anything drawn over it hides it; the app
        shows this still in its place while a menu is open, and the live page comes back when the menu closes.
      */
      case "snapshot": {
        const t2 = active != null ? tabs.get(active) : null;
        const wcs = t2?.view?.webContents;
        if (!wcs || wcs.isDestroyed() || !bounds) return { dataUrl: null };
        try {
          const img = await wcs.capturePage();
          return { dataUrl: img.isEmpty() ? null : `data:image/jpeg;base64,${img.toJPEG(80).toString("base64")}` };
        } catch {
          return { dataUrl: null };
        }
      }
      case "bounds": {
        /*
          Only "start" (a Browser tab opened in that window) moves the pages: a box from another window that still has
          a Browser tab open took them back on its next resize, and the two windows took turns (review 1.3.0).
        */
        if (win !== host) {
          if (host && !host.isDestroyed()) return { ok: true, elsewhere: true };
          adopt(win);
        }
        const r = a?.rect;
        bounds =
          r && num(r.x) != null && num(r.y) != null && num(r.width) > 0 && num(r.height) > 0
            ? { x: r.x, y: r.y, width: r.width, height: r.height }
            : null;
        placeViews();
        return { ok: true };
      }
      case "open":
        if (!o.blocker.status().ready) return { error: "The blocklists are not there yet." };
        return { id: openTab(a?.text ? resolveTyped(a.text, o.prefs.searchUrl) : null) };
      case "close":
        if (id != null) closeTab(id);
        return { ok: true };
      case "select":
        if (id != null) {
          active = id;
          placeViews();
          changed();
        }
        return { ok: true };
      case "go": {
        if (!t || !o.blocker.status().ready) return { error: "No such tab." };
        const url = resolveTyped(a?.text, o.prefs.searchUrl);
        if (url) load(t, url);
        return { ok: true };
      }
      case "back":
      case "forward":
        // From the start page too: the page comes back into view (review 1.2.16: it moved on hidden).
        if (t?.view && !t.view.webContents.isDestroyed()) {
          if (op === "back") t.view.webContents.navigationHistory.goBack();
          else t.view.webContents.navigationHistory.goForward();
          if (t.startPage) {
            t.startPage = false;
            t.view.webContents.setAudioMuted(false);
            placeViews();
            changed();
          }
        }
        return { ok: true };
      case "reload":
        if (t?.view) t.view.webContents.reload();
        return { ok: true };
      case "halt":
        if (t?.view) t.view.webContents.stop();
        return { ok: true };
      case "home":
        if (t) {
          t.startPage = true;
          t.title = "";
          // The page stays (Back brings it back) but is heard no more (review 1.2.16: a video played on unseen).
          if (t.view && !t.view.webContents.isDestroyed()) t.view.webContents.setAudioMuted(true);
          placeViews();
          changed();
        }
        return { ok: true };
      case "plainHttp": {
        const u = t?.error?.httpFallback ? httpUrl(t.error.httpFallback) : null;
        if (!t || !u) return { error: "Nothing to open." };
        plainHttpOk.add(u.host);
        load(t, u.href);
        return { ok: true };
      }
      case "siteBlocking": {
        const dom = t?.url ? domainOf(t.url) : null;
        if (!dom) return { error: "No site." };
        o.prefs.setBlocking(dom, a?.on !== false);
        /*
          A reload after blocking is switched on or off, or a site's data is cleared, skips the cache (owner,
          2026-10-13: the change showed only in a new tab). A normal reload takes the page's scripts and images
          from the page process's own memory cache, which never reaches webRequest, so the blocker was not asked
          again; a new tab has a new process and an empty cache. F5, Ctrl+R and the Reload button are normal
          reloads again (1.2.18, owner: "the browser is slow"): skipping the cache made every reload as slow as a
          first visit — measured 357-514 ms against 142-300 ms (docs/perf/browser/timing.cjs, five sites).
        */
        t.view?.webContents.reloadIgnoringCache();
        changed();
        return { ok: true };
      }
      case "siteRemember": {
        const dom = t?.url ? domainOf(t.url) : null;
        if (!dom) return { error: "No site." };
        const on = a?.on === true;
        const before = o.prefs.site(dom).origins;
        o.prefs.setRemember(dom, on);
        if (on) o.prefs.noteOrigin(dom, new URL(t.url).origin);
        else
          await getSession()
            .clearData({ origins: [`https://${dom}`, `https://www.${dom}`, ...before] })
            .catch(() => {});
        changed();
        return { ok: true };
      }
      case "forgetSite": {
        const dom = t?.url ? domainOf(t.url) : null;
        if (!dom) return { error: "No site." };
        const before = o.prefs.site(dom).origins;
        o.prefs.forget(dom);
        await getSession()
          .clearData({ origins: [`https://${dom}`, `https://www.${dom}`, ...before] })
          .catch(() => {});
        t.view?.webContents.reloadIgnoringCache();
        changed();
        return { ok: true };
      }
      case "clearAll":
        // Every site's cookies, storage and cache, the remembered ones' too; the settings stay.
        await getSession()
          .clearData()
          .catch(() => {});
        for (const x of tabs.values()) x.view?.webContents.reloadIgnoringCache();
        changed();
        return { ok: true };
      case "addLink":
        return { ok: o.prefs.addLink(a?.name, a?.url), state: state() };
      case "removeLink":
        return { ok: o.prefs.removeLink(String(a?.url ?? "")), state: state() };
      case "setEngine":
        return { ok: o.prefs.setEngine(String(a?.key ?? ""), a?.custom), state: state() };
      case "setKeepCache":
        o.prefs.setKeepCache(a?.on === true);
        return { ok: true, state: state() };
      case "openInara": {
        // Colonize's Inara links (1.3.0, C5): Inara's commodity search only, in a tab that offers the pop-up.
        if (!o.blocker.status().ready) return { error: "The blocklists are not there yet." };
        const url = typeof a?.url === "string" ? a.url : "";
        if (!isInaraCommodityPage(url)) return { error: "Not an Inara commodity search page." };
        const nid = openTab(url);
        const nt = nid != null ? tabs.get(nid) : null;
        if (nt) nt.fromApp = true;
        return { id: nid };
      }
      case "inaraResult": {
        // The app window saved (or could not save) what the pop-up read: its answer goes in the pop-up.
        if (!t) return { error: "No such page." };
        clearTimeout(t.inaraWait);
        inaraSay(t, typeof a?.text === "string" ? a.text : "", a?.ok === true);
        return { ok: true };
      }
      default:
        return { error: "Unknown call." };
    }
  }

  return {
    handle,
    isBrowserContents,
    /**
     * F5 while a browsed page is on screen in the window in front: reload it, true when one did (owner, 2026-10-16:
     * F5 did nothing in the browser). The app's F5 key bind (Clear the notices) stays registered while the app is in
     * front, so Windows hands F5 to the bind and the page never sees it; the bind asks here first. Not only when the
     * page has the keyboard (owner, 2026-10-17: F5 cleared the notices instead): a click on the toolbar or a menu
     * takes the keyboard from the page. A menu open over the page (no box) or another tab of the app: the notices.
     */
    reloadShown() {
      const reload = (t) => {
        const wc = t?.view?.webContents;
        if (!wc || wc.isDestroyed()) return false;
        wc.reload();
        return true;
      };
      for (const t of tabs.values()) {
        const wc = t.view?.webContents;
        if (wc && !wc.isDestroyed() && wc.isFocused()) return reload(t);
      }
      if (!host || host.isDestroyed() || !host.isFocused()) return false;
      if (fullscreen) return reload(tabs.get(fullscreen.id));
      const t = active != null ? tabs.get(active) : null;
      return !!(bounds && t && !t.startPage) && reload(t);
    },
    /** Something the toolbar shows changed (the blocklists' download, from browserBlocker.cjs). */
    changed,
    /** At quit: what a site stored goes, as at the next start (best effort; the next start clears it anyway). */
    clearOnQuit() {
      if (ses) void clearUnremembered().catch(() => {});
    },
  };
}

module.exports = {
  createBrowserTabs,
  isInaraCommodityPage,
  inaraReadScript,
  inaraOfferScript,
  resolveTyped,
  isLocalHost,
  chromeUserAgent,
  cosmeticScript,
  passwordCaptureScript,
  passwordFillScript,
  PARTITION,
  DATA_TYPES_BUT_CACHE,
};
