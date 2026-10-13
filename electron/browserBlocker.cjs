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
*/

const fs = require("node:fs");
const path = require("node:path");
const { Worker } = require("node:worker_threads");
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
];
/** What the lists weighed when measured (2026-10-13), for the "needs N MB" line before the first download. */
const ESTIMATE_BYTES = 5_500_000;
const REFRESH_MS = 7 * 24 * 3600 * 1000;
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

  function readMeta() {
    try {
      const m = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      return { fetchedAt: typeof m.fetchedAt === "string" ? m.fetchedAt : null, bytes: Number(m.bytes) || 0 };
    } catch {
      return { fetchedAt: null, bytes: 0 };
    }
  }
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
      lists: LISTS.map((l) => ({ name: l.name, url: l.url })),
    };
  }

  /** Parses the lists in a worker; resolves with the serialized engine. */
  function parseInWorker(text) {
    return new Promise((resolve, reject) => {
      const w = new Worker(o.bundlePath, { workerData: { lists: text } });
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
    const bytes = await parseInWorker(parts.join("\n"));
    writeFileAtomic(enginePath, Buffer.from(bytes), null);
    engine = loadLib().FiltersEngine.deserialize(bytes);
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

  async function download() {
    fs.mkdirSync(listDir, { recursive: true });
    let total = 0;
    progress = { done: 0, total: LISTS.length };
    o.onChange();
    for (const l of LISTS) {
      const r = await o.fetch(l.url);
      if (!r.ok) throw new Error(`${l.name}: ${r.status} ${r.statusText}`);
      const text = await r.text();
      if (text.length > MAX_LIST_BYTES || !/^\s*[![]/.test(text))
        throw new Error(`${l.name} is not a filter list.`);
      writeFileAtomic(path.join(listDir, `${l.key}.txt`), text);
      total += Buffer.byteLength(text);
      progress = { done: progress.done + 1, total: LISTS.length };
      o.onChange();
    }
    meta = { fetchedAt: new Date().toISOString(), bytes: total };
    writeFileAtomic(metaPath, `${JSON.stringify(meta)}\n`);
    engine = null;
    try {
      fs.rmSync(enginePath, { force: true });
    } catch {
      /* rebuilt below either way */
    }
    await buildFromLists();
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
    /** At the browser's first open in a session: the engine, then the weekly refresh in the background. */
    async ensure() {
      const ok = await run("load", load);
      const stale = meta.fetchedAt && Date.now() - Date.parse(meta.fetchedAt) > REFRESH_MS;
      if (ok && stale) void run("refresh", download);
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
    /** The last tab closed: the engine (tens of MB) goes; the file stays for the next open. */
    release() {
      engine = null;
      lib = null;
    },
  };
}

module.exports = { createBrowserBlocker, LISTS };
