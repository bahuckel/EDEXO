"use strict";

/*
  The EDEXO browser (plan 9, owner 2026-10-13): a light, private browser inside the app's Browser tab.

  The main process owns everything. Each page is a WebContentsView (never a <webview>) on its own session,
  `persist:edexo-browser`, apart from the app's; the app's window only draws the toolbar and says where the page
  goes, through a narrow set of calls (preload.cjs `browser`), every argument checked here. Browsed pages get no
  preload, no Node, a sandbox, web security, no insecure content, no permissions but fullscreen, no new windows
  (a link that opens one becomes a tab), no navigation outside http(s), no certificate exceptions.

  Private by default: everything a site stores is cleared at the browser's first use in each run (and at quit),
  except for the sites marked "Remember this site". Blocking (browserBlocker.cjs) is on for every site unless
  switched off for it. Nothing is collected: no history kept, no telemetry, Do Not Track and Global Privacy
  Control sent, a plain Chrome user agent (no Electron or app name in it).

  RAM: nothing until the Browser tab opens; one renderer per page while it is open; when the tab closes every page
  closes and the blocking engine is let go.
*/

const path = require("node:path");
const { httpUrl } = require("./browserPrefs.cjs");

const PARTITION = "persist:edexo-browser";
const MAX_TABS = 30;
/** A Browser tab unmounted (closed, or being moved to another window): pages close unless it comes back by then. */
const DETACH_GRACE_MS = 4000;
/**
 * The script world the page's class names are read in: its own JavaScript world, which the page cannot see or
 * reach (the DOM is shared, the scripts are not), so browsed pages still get no preload.
 */
const COSMETIC_WORLD = 1077;
/** Looked again after the page loaded, for what it adds later (lazy ad slots). */
const COSMETIC_PASSES_MS = [1500, 4000, 10000];
/*
  Every reload here skips the cache (owner, 2026-10-13: blocking switched on or off showed only in a new tab). A
  normal reload takes the page's scripts and images from the page process's own memory cache, which never reaches
  webRequest, so the blocker was not asked again; a new tab has a new process and an empty cache.
*/
/** How long a page's request waits for its scriptlets to be registered (they take a few ms). */
const INJECT_WAIT_MS = 1500;
/** Requests of these kinds, once blocked, leave a box on the page: it is collapsed. */
const COLLAPSE_TYPES = new Set(["subFrame", "image", "object", "media"]);

/**
 * Reads the page's class names, ids and links (for the lists' general hiding rules, which match on them), and
 * collapses the frames and images whose request was blocked, as uBlock does: the element goes, not only its
 * content (owner, 2026-10-13: "it only removes its contents").
 */
function cosmeticScript(blocked) {
  return `(() => {
  const blocked = new Set(${JSON.stringify(blocked)});
  let collapsed = 0;
  for (const el of document.querySelectorAll("iframe[src], img[src], embed[src], object[data], video[src]")) {
    const src = el.src || el.data;
    if (src && blocked.has(src)) {
      el.style.setProperty("display", "none", "important");
      collapsed++;
    }
  }
  const classes = new Set(), ids = new Set(), hrefs = new Set();
  const all = document.querySelectorAll("[class], [id], a[href]");
  for (let k = 0; k < all.length && k < 30000; k++) {
    const el = all[k];
    if (el.id) ids.add(el.id);
    if (el.classList) for (const c of el.classList) classes.add(c);
    if (el.tagName === "A") {
      const h = el.getAttribute("href");
      if (h) hrefs.add(h);
    }
  }
  return { classes: [...classes].slice(0, 8000), ids: [...ids].slice(0, 4000), hrefs: [...hrefs].slice(0, 4000), collapsed };
})()`;
}

/** Hosts plain HTTP is never upgraded for: this machine and the home network. */
function isLocalHost(host) {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    host === "[::1]"
  );
}

/**
 * What the address bar's text means: an http(s) URL, a host name ("edsm.net", "localhost:7111"), or a search.
 * Anything with another scheme (file:, javascript:, chrome: …) is searched for, never opened.
 */
function resolveTyped(text, searchUrl) {
  const t = String(text ?? "")
    .trim()
    .slice(0, 2048);
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return httpUrl(t)?.href ?? searchUrl(t);
  if (!/\s/.test(t) && /^[^/:]+(:\d{1,5})?(\/.*)?$/.test(t)) {
    const host = t.split(/[/:]/)[0].toLowerCase();
    if (host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return `http://${t}`;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,63}$/i.test(host))
      return httpUrl(`https://${t}`)?.href ?? searchUrl(t);
  }
  return searchUrl(t);
}

function chromeUserAgent() {
  const os =
    process.platform === "win32"
      ? "Windows NT 10.0; Win64; x64"
      : process.platform === "darwin"
        ? "Macintosh; Intel Mac OS X 10_15_7"
        : "X11; Linux x86_64";
  // Chrome freezes the minor parts of its version in the user agent.
  const major = String(process.versions.chrome || "130").split(".")[0];
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

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
  let ses = null;
  let cleared = false;
  /** Hosts whose https upgrade failed and that the commander chose to open over plain HTTP, this run. */
  const plainHttpOk = new Set();
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
            return cb({ redirectURL: u.href });
          }
        }
        const wc = details.webContents;
        const tab = wc ? tabOfContents(wc) : null;
        // A page about to load in a tab: its scriptlets are in place before the request goes (see injectFor).
        if (details.resourceType === "mainFrame") {
          if (!tab) return cb({});
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
  async function injectFor(t, url) {
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
      if (!dbg.isAttached()) dbg.attach("1.3");
      const body = scripts.map((x) => `(function(){try{${x}\n}catch(e){}})();`).join("\n");
      const source = `(function(){if(window.top!==window||location.hostname!==${JSON.stringify(host)})return;\n${body}\n})();`;
      const r = await dbg.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source });
      t.injected = { key, id: r && typeof r.identifier === "string" ? r.identifier : null };
    } catch (e) {
      // Not attached (DevTools on the tab, a closed page): the page loads without its scriptlets.
      o.log?.(`browser: scriptlets for ${host} not set: ${e && e.message ? e.message : e}`);
      t.injected = { key: "", id: null };
    }
  }

  /** Everything a site stored, except the remembered sites' (plan 9.2: incognito by default). */
  async function clearUnremembered() {
    const keep = o.prefs.keptOrigins();
    await getSession().clearData(keep.length ? { excludeOrigins: keep } : {});
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
    const wc = t.view?.webContents;
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
    wc.setWindowOpenHandler(({ url }) => {
      if (httpUrl(url)) openTab(url, t.id);
      return { action: "deny" };
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
        t.blocked = 0;
        t.error = null;
        t.collapse.clear();
        t.seen = { classes: new Set(), ids: new Set(), hrefs: new Set() };
        for (const x of t.passTimers.splice(0)) clearTimeout(x);
      }
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
      let httpFallback = null;
      try {
        const u = new URL(url);
        if (u.protocol === "https:" && !isLocalHost(u.hostname)) {
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
      if (!o.prefs.site(domainOf(url) ?? "").blocking) return;
      const css = o.blocker.cosmetics(url);
      if (css) void wc.insertCSS(css, { cssOrigin: "user" }).catch(() => {});
      void cosmeticPass(t);
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
      else if (k === "f5" || (ctrl && k === "r")) wc.reloadIgnoringCache();
      else if (input.alt && k === "arrowleft") wc.navigationHistory.goBack();
      else if (input.alt && k === "arrowright") wc.navigationHistory.goForward();
      else if (ctrl && k === "tab") stepTab(input.shift ? -1 : 1);
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
        { label: "Reload", click: () => wc.reloadIgnoringCache() },
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

  function send(type) {
    if (host && !host.isDestroyed()) host.webContents.send("edexo:browser-event", { type });
  }

  function placeViews() {
    if (!host || host.isDestroyed()) return;
    const zoom = host.webContents.getZoomFactor();
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

  function adopt(win) {
    if (host === win) return;
    for (const t of tabs.values()) {
      if (!t.view) continue;
      if (host && !host.isDestroyed()) host.contentView.removeChildView(t.view);
      win.contentView.addChildView(t.view);
    }
    host = win;
    host.once("closed", () => {
      if (host === win) {
        host = null;
        armDetach();
      }
    });
  }

  function load(t, url) {
    t.startPage = false;
    t.error = null;
    if (!t.view) {
      t.view = makeView(t);
      if (host && !host.isDestroyed()) host.contentView.addChildView(t.view);
    }
    t.url = url;
    void t.view.webContents.loadURL(url).catch(() => {});
    placeViews();
    changed();
  }

  /** A new tab after `after` (or at the end), on `url`, or on the start page when url is null. */
  function openTab(url, after) {
    if (tabs.size >= MAX_TABS) return null;
    const t = {
      id: nextId++,
      collapse: new Set(),
      injected: { key: "", id: null },
      seen: { classes: new Set(), ids: new Set(), hrefs: new Set() },
      passTimers: [],
      view: null,
      title: "",
      url: "",
      loading: false,
      blocked: 0,
      error: null,
      startPage: true,
    };
    tabs.set(t.id, t);
    const i = after != null ? order.indexOf(after) : -1;
    if (i >= 0) order.splice(i + 1, 0, t.id);
    else order.push(t.id);
    active = t.id;
    if (url) load(t, url);
    placeViews();
    changed();
    return t.id;
  }

  function closeTab(id) {
    const t = tabs.get(id);
    if (!t) return;
    for (const x of t.passTimers.splice(0)) clearTimeout(x);
    if (t.view) {
      if (host && !host.isDestroyed()) host.contentView.removeChildView(t.view);
      t.view.webContents.close();
    }
    tabs.delete(id);
    const i = order.indexOf(id);
    order = order.filter((x) => x !== id);
    if (active === id) active = order[Math.min(i, order.length - 1)] ?? null;
    // The last page closed: a fresh start page, so the Browser tab never shows nothing.
    if (!order.length) openTab(null);
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
    for (const t of tabs.values()) {
      for (const x of t.passTimers.splice(0)) clearTimeout(x);
      if (!t.view) continue;
      if (host && !host.isDestroyed()) host.contentView.removeChildView(t.view);
      if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
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
    switch (op) {
      case "state":
        return state();
      case "start": {
        // The Browser tab is on screen in this window: its pages come here, the engine is read.
        clearTimeout(detachTimer);
        detachTimer = null;
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
        // Unmounted: closed, or moving to another window (which sends "start" within the grace).
        bounds = null;
        placeViews();
        armDetach();
        return { ok: true };
      case "downloadLists": {
        const ok = await o.blocker.download();
        if (ok && !order.length) openTab(null);
        changed();
        return state();
      }
      case "bounds": {
        if (win !== host) adopt(win);
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
        if (t?.view) t.view.webContents.navigationHistory.goBack();
        return { ok: true };
      case "forward":
        if (t?.view) t.view.webContents.navigationHistory.goForward();
        return { ok: true };
      case "reload":
        if (t?.view) t.view.webContents.reloadIgnoringCache();
        return { ok: true };
      case "halt":
        if (t?.view) t.view.webContents.stop();
        return { ok: true };
      case "home":
        if (t) {
          t.startPage = true;
          t.title = "";
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
      default:
        return { error: "Unknown call." };
    }
  }

  return {
    handle,
    isBrowserContents,
    /** Something the toolbar shows changed (the blocklists' download, from browserBlocker.cjs). */
    changed,
    /** At quit: what a site stored goes, as at the next start (best effort; the next start clears it anyway). */
    clearOnQuit() {
      if (ses) void clearUnremembered().catch(() => {});
    },
  };
}

module.exports = { createBrowserTabs, resolveTyped, isLocalHost, chromeUserAgent, cosmeticScript, PARTITION };
