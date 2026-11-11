"use strict";

/*
  Ad and tracker blocking for the EDEXO browser (plan 9.1, owner 2026-10-13: "all of the adblocking functions
  (with option to stop for a specific page), all tracker blockers").

  The filter lists come from their publishers (EasyList, EasyPrivacy, uBlock Origin's lists), downloaded the first
  time the browser opens — it does not open before they are there, so it never runs unblocked — and refreshed
  weekly. They are parsed in a worker thread (browserAdblockEntry.cjs) into one engine, kept serialized in
  `browser/engine.bin`, read back in milliseconds at the next start.

  Network blocking runs on the browser's session only (webRequest), per page: a site with blocking switched off
  gets nothing blocked, ads or trackers. Cosmetic rules (hiding the empty ad boxes) go in as a user stylesheet
  from here, so browsed pages get no preload script at all (plan 9.2).

  Scriptlets (owner, 2026-10-13: "a youtube adblocker", the way uBlock Origin Lite does it): for the sites the
  lists name, small scripts that run in the page before its own code and take the ads out of what the player is
  sent. YouTube serves its ads from the same servers as its videos, so blocking requests cannot stop them. The
  scripts come from uBlock Origin's scriptlet library as Ghostery packages it for this engine (resources.json),
  downloaded like the lists, never shipped in the app; uBlock's "quick fixes" list carries the YouTube rules and is
  refreshed daily (YouTube changes its player often), the rest weekly.

  The scriptlets are code run inside browsed pages, the pages passwords fill in on, so they are pinned (review
  2026-11-10 D3, plan 1.7): one commit of Ghostery's repository and the file's SHA-256, checked on every download.
  A file that does not match is refused. A new pin comes with an EDEXO release; the file on disk is fetched again
  only when it no longer matches the pin.
*/

const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { createHash } = require("node:crypto");
const { writeFileAtomic } = require("./atomicWrite.cjs");

const LISTS = [
  { key: "easylist", name: "EasyList", url: "https://easylist.to/easylist/easylist.txt" },
  { key: "easyprivacy", name: "EasyPrivacy", url: "https://easylist.to/easylist/easyprivacy.txt" },
  {
    key: "ubo-filters",
    name: "uBlock filters",
    url: "https://ublockorigin.github.io/uAssets/filters/filters.txt",
  },
  {
    key: "ubo-privacy",
    name: "uBlock privacy",
    url: "https://ublockorigin.github.io/uAssets/filters/privacy.txt",
  },
  {
    key: "ubo-unbreak",
    name: "uBlock unbreak",
    url: "https://ublockorigin.github.io/uAssets/filters/unbreak.txt",
  },
  {
    key: "ubo-cookies",
    name: "uBlock cookie notices",
    url: "https://ublockorigin.github.io/uAssets/filters/annoyances-cookies.txt",
  },
  {
    key: "ubo-quick-fixes",
    name: "uBlock quick fixes (YouTube)",
    url: "https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt",
    daily: true,
  },
];
/**
 * The scriptlets the lists' `##+js(...)` rules run (uBlock Origin's library, packaged by Ghostery for its engine),
 * pinned: commit 7f5784d (2026-08-14, the newest change to the file on 2026-11-11, the same bytes as `master`).
 */
const RESOURCES = {
  key: "resources",
  name: "uBlock scriptlets (packaged by Ghostery)",
  url: "https://raw.githubusercontent.com/ghostery/adblocker/7f5784d0a1dc177171ee3d6d39a7e4ac7a7eecec/packages/adblocker/assets/ublock-origin/resources.json",
  sha256: "5ce0ce483f0e5514308ccb0240960a9dd7bfeab417debeef96960dce2c95f690",
};
const sha256Of = (text) => createHash("sha256").update(text).digest("hex");
const DOWNLOADS = [...LISTS, RESOURCES];
/** What the lists weighed when measured (2026-10-13), for the "needs N MB" line before the first download. */
const ESTIMATE_BYTES = 5_800_000;
const WEEK_MS = 7 * 24 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;
const MAX_LIST_BYTES = 20_000_000;

/** Electron's resource types, as the engine names them. */
const TYPE = {
  mainFrame: "main_frame",
  subFrame: "sub_frame",
  stylesheet: "stylesheet",
  script: "script",
  image: "image",
  font: "font",
  object: "object",
  xhr: "xmlhttprequest",
  ping: "ping",
  cspReport: "csp_report",
  media: "media",
  webSocket: "websocket",
  other: "other",
};

/**
 * @param {{ dir: string, bundlePath: string, fetch: (url: string) => Promise<Response>, onChange: () => void }} o
 */
function createBrowserBlocker(o) {
  const dir = path.join(o.dir, "browser");
  const listDir = path.join(dir, "lists");
  const enginePath = path.join(dir, "engine.bin");
  const metaPath = path.join(dir, "lists.json");
  /** @type {any} */
  let lib = null;
  /** @type {any} */
  let engine = null;
  let busy = null;
  let error = null;
  let progress = null;
  let meta = readMeta();
  /** The Browser tab closed (release): a refresh still running does not bring the engine back. */
  let released = false;

  /** When each download was fetched (`fetched[key]`), and the first time any was (consent: they are wanted). */
  function readMeta() {
    try {
      const m = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      const fetchedAt = typeof m.fetchedAt === "string" ? m.fetchedAt : null;
      const fetched = {};
      if (m.fetched && typeof m.fetched === "object")
        for (const [k, v] of Object.entries(m.fetched)) if (typeof v === "string") fetched[k] = v;
      // Written before the per-list dates: every list then on disk came with that first download.
      if (fetchedAt && !m.fetched) for (const l of LISTS.slice(0, 6)) fetched[l.key] = fetchedAt;
      return { fetchedAt, fetched, bytes: Number(m.bytes) || 0 };
    } catch {
      return { fetchedAt: null, fetched: {}, bytes: 0 };
    }
  }
  const fileOf = (d) =>
    d === RESOURCES ? path.join(dir, "resources.json") : path.join(listDir, `${d.key}.txt`);
  /** The pinned scriptlets on disk, unless missing or not the pin's bytes (an older pin, a damaged file). */
  const resourcesPinned = () => {
    try {
      return sha256Of(fs.readFileSync(fileOf(RESOURCES))) === RESOURCES.sha256;
    } catch {
      return false;
    }
  };
  /**
   * The downloads due again (daily or weekly), or never fetched (a list added in a newer version); the scriptlets
   * only when the file is not the pinned one.
   */
  const stale = () =>
    DOWNLOADS.filter((d) => {
      if (d === RESOURCES) return !resourcesPinned();
      const at = Date.parse(meta.fetched[d.key] ?? "");
      return !Number.isFinite(at) || Date.now() - at > (d.daily ? DAY_MS : WEEK_MS);
    });
  const loadLib = () => (lib ??= require(o.bundlePath));

  function status() {
    return {
      ready: engine != null,
      haveLists: meta.fetchedAt != null,
      busy,
      progress,
      error,
      fetchedAt: meta.fetchedAt,
      bytes: meta.bytes || ESTIMATE_BYTES,
      lists: DOWNLOADS.map((l) => ({ name: l.name, url: l.url })),
    };
  }

  /** Parses the lists (and the scriptlets) in a worker; resolves with the serialized engine. */
  function parseInWorker(text, resources) {
    return new Promise((resolve, reject) => {
      const w = new Worker(o.bundlePath, { workerData: { lists: text, resources } });
      w.once("message", (m) => {
        void w.terminate();
        if (m && m.ok) resolve(new Uint8Array(m.bytes));
        else reject(new Error(m && m.error ? m.error : "The filter lists could not be read."));
      });
      w.once("error", reject);
    });
  }

  async function buildFromLists() {
    const parts = [];
    for (const l of LISTS) {
      try {
        parts.push(fs.readFileSync(path.join(listDir, `${l.key}.txt`), "utf8"));
      } catch {
        /* a list missing: the others still block */
      }
    }
    if (!parts.length) throw new Error("No filter lists downloaded yet.");
    let resources = null;
    try {
      const text = fs.readFileSync(fileOf(RESOURCES), "utf8");
      // Only the pinned bytes run in pages (a file from before the pin, or damaged, waits for its download).
      if (sha256Of(text) === RESOURCES.sha256) resources = text;
    } catch {
      /* no scriptlets yet: everything else still blocks */
    }
    const bytes = await parseInWorker(parts.join("\n"), resources);
    const next = loadLib().FiltersEngine.deserialize(bytes);
    writeFileAtomic(enginePath, Buffer.from(bytes), null);
    // The Browser tab closed meanwhile: the file is new, the engine is not kept (its RAM goes).
    engine = released ? null : next;
  }

  /** The engine from disk, else from the lists on disk; false when neither is there. */
  async function load() {
    if (engine) return true;
    try {
      engine = loadLib().FiltersEngine.deserialize(new Uint8Array(fs.readFileSync(enginePath)));
      return true;
    } catch {
      /* none yet, or written by another version of the engine: build it again */
    }
    if (!meta.fetchedAt) return false;
    await buildFromLists();
    return true;
  }

  /** A download checked: a filter list starts with its header or a comment, the scriptlets are the pinned bytes. */
  function check(d, text) {
    if (text.length > MAX_LIST_BYTES) return false;
    if (d !== RESOURCES) return /^\s*[![]/.test(text);
    if (sha256Of(text) !== RESOURCES.sha256) return false;
    try {
      const j = JSON.parse(text);
      return Array.isArray(j.scriptlets) && j.scriptlets.length > 0;
    } catch {
      return false;
    }
  }

  async function download(which = DOWNLOADS) {
    fs.mkdirSync(listDir, { recursive: true });
    progress = { done: 0, total: which.length };
    o.onChange();
    const now = new Date().toISOString();
    /** The scriptlets refused: the lists still go in, then the refusal is the job's error. */
    let refused = null;
    for (const d of which) {
      const r = await o.fetch(d.url);
      if (!r.ok) throw new Error(`${d.name}: ${r.status} ${r.statusText}`);
      const text = await r.text();
      if (!check(d, text)) {
        if (d !== RESOURCES) throw new Error(`${d.name} is not what it should be.`);
        refused = new Error(`${d.name} did not match the pinned copy; not used.`);
        progress = { done: progress.done + 1, total: which.length };
        continue;
      }
      writeFileAtomic(fileOf(d), text);
      meta.fetched[d.key] = now;
      progress = { done: progress.done + 1, total: which.length };
      o.onChange();
    }
    let total = 0;
    for (const d of DOWNLOADS) {
      try {
        total += fs.statSync(fileOf(d)).size;
      } catch {
        /* not there */
      }
    }
    meta = { fetchedAt: meta.fetchedAt ?? now, fetched: meta.fetched, bytes: total };
    writeFileAtomic(metaPath, `${JSON.stringify(meta)}\n`);
    /*
      The engine in use stays until the new one is built, then is swapped (review 1.2.16: the daily refresh set it
      aside first, and for the seconds of the parse nothing was blocked and the browser showed its gate). A failed
      build keeps the old engine and its file.
    */
    try {
      await buildFromLists();
    } catch (e) {
      if (!refused) throw e;
    }
    if (refused) throw refused;
  }

  /** One job at a time: "download" (asked for by the commander), "load", or the weekly "refresh". */
  function run(kind, job) {
    if (busy) return Promise.resolve(false);
    busy = kind;
    error = null;
    o.onChange();
    return job()
      .then(() => true)
      .catch((e) => {
        error = e instanceof Error ? e.message : String(e);
        return false;
      })
      .finally(() => {
        busy = null;
        progress = null;
        o.onChange();
      });
  }

  return {
    status,
    /** The first download, or "Update now". */
    download: () => run("download", download),
    /**
     * At the browser's first open in a session: the engine, then in the background what is due again — the
     * quick fixes daily, the rest weekly, any list a newer version added, and the scriptlets when the pin changed.
     */
    async ensure() {
      released = false;
      const ok = await run("load", load);
      const due = meta.fetchedAt ? stale() : [];
      if (ok && due.length) void run("refresh", () => download(due));
      return engine != null;
    },
    hostOf: (url) => {
      try {
        return loadLib().hostOf(url);
      } catch {
        return { hostname: null, domain: null };
      }
    },
    /**
     * A request decided: `{ cancel }`, `{ redirectURL }` (a harmless stand-in the lists name), or `{}`.
     * `page` is the page's URL; null blocks nothing.
     */
    decide(details, page) {
      if (!engine || !page || details.resourceType === "mainFrame") return null;
      const { Request } = loadLib();
      const req = Request.fromRawDetails({
        url: details.url,
        type: TYPE[details.resourceType] ?? "other",
        sourceUrl: page,
      });
      const r = engine.match(req);
      if (r.redirect) return { redirectURL: r.redirect.dataUrl };
      if (r.match) return { cancel: true };
      return null;
    },
    /** The user stylesheet that hides what the lists hide on this page, or "". */
    cosmetics(url) {
      if (!engine) return "";
      const h = this.hostOf(url);
      if (!h.hostname) return "";
      try {
        const r = engine.getCosmeticsFilters({
          url,
          hostname: h.hostname,
          domain: h.domain,
          getBaseRules: true,
          getInjectionRules: false,
          getExtendedRules: false,
          getRulesFromDOM: false,
          getRulesFromHostname: true,
        });
        return r && r.active && typeof r.styles === "string" ? r.styles : "";
      } catch {
        return "";
      }
    },
    /** The scriptlets the lists run on this page (its own hostname's rules), ready to inject; [] for most sites. */
    scripts(url) {
      if (!engine) return [];
      const h = this.hostOf(url);
      if (!h.hostname) return [];
      try {
        const r = engine.getCosmeticsFilters({
          url,
          hostname: h.hostname,
          domain: h.domain,
          getBaseRules: false,
          getInjectionRules: true,
          getExtendedRules: false,
          getRulesFromDOM: false,
          getRulesFromHostname: true,
        });
        return r && r.active && Array.isArray(r.scripts)
          ? r.scripts.filter((x) => typeof x === "string")
          : [];
      } catch {
        return [];
      }
    },
    /** The general hiding rules that match these class names, ids and links of the page, as a stylesheet. */
    domCosmetics(url, dom) {
      if (!engine) return "";
      const h = this.hostOf(url);
      if (!h.hostname) return "";
      try {
        const r = engine.getCosmeticsFilters({
          url,
          hostname: h.hostname,
          domain: h.domain,
          classes: dom.classes,
          ids: dom.ids,
          hrefs: dom.hrefs,
          getBaseRules: false,
          getInjectionRules: false,
          getExtendedRules: false,
          getRulesFromDOM: true,
          getRulesFromHostname: false,
        });
        return r && r.active && typeof r.styles === "string" ? r.styles : "";
      } catch {
        return "";
      }
    },
    /** The last tab closed: the engine (tens of MB) goes; the file stays for the next open. */
    release() {
      released = true;
      engine = null;
      lib = null;
    },
  };
}

module.exports = { createBrowserBlocker, LISTS, RESOURCES };
