"use strict";

/*
  The EDEXO browser's settings (plan 9, owner 2026-10-13), in `edexo-browser.json` beside the app's own: per site
  (registrable domain) whether its cookies and storage are kept ("Remember this site"; incognito otherwise) and
  whether blocking is off for it; the start page's own links; the search engine; "Keep page cache" and "Remember
  passwords" (owner, 2026-10-16, both off by default) with the origins never to offer a save for (no secrets here:
  the passwords themselves are in browserPasswords.cjs). Kept in the app's settings, not in the browser's storage,
  so "Clear everything" cannot lose them and a site cannot read them.
*/

const fs = require("node:fs");
const path = require("node:path");
const { writeFileAtomic } = require("./atomicWrite.cjs");

const SEARCH_ENGINES = {
  duckduckgo: { label: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s" },
  startpage: { label: "Startpage", url: "https://www.startpage.com/do/search?q=%s" },
  brave: { label: "Brave Search", url: "https://search.brave.com/search?q=%s" },
  google: { label: "Google", url: "https://www.google.com/search?q=%s" },
  bing: { label: "Bing", url: "https://www.bing.com/search?q=%s" },
};

/** The start page's cards (owner, 2026-10-13); his own come after them. */
const DEFAULT_LINKS = [
  { name: "ED Exo Compare", url: "https://bahuckel.com/projects/edexo-compare" },
  { name: "EDSM", url: "https://www.edsm.net" },
  { name: "EDAstro", url: "https://edastro.com" },
  { name: "Spansh", url: "https://spansh.co.uk" },
  { name: "ED GGG", url: "https://ed-ggg.github.io/edggg/" },
  { name: "ED-DSN", url: "https://ed-dsn.net" },
  { name: "Inara", url: "https://inara.cz" },
];

const MAX_LINKS = 40;
const MAX_SITES = 2000;
const MAX_NEVER = 2000;

/** An exact https origin ("https://host[:port]"), or null. */
function httpsOrigin(raw) {
  const u = httpUrl(raw);
  return u && u.protocol === "https:" && u.origin === raw ? raw : null;
}

/** An http(s) URL, or null. */
function httpUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ dir: string }} o
 */
function createBrowserPrefs(o) {
  const file = path.join(o.dir, "edexo-browser.json");
  let data = {
    sites: {},
    links: [],
    engine: "duckduckgo",
    customSearch: null,
    keepCache: false,
    rememberPasswords: false,
    passwordNever: [],
  };
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && typeof raw === "object") {
      if (raw.sites && typeof raw.sites === "object") {
        for (const [d, s] of Object.entries(raw.sites).slice(0, MAX_SITES)) {
          if (!/^[a-z0-9.-]{1,253}$/.test(d) || !s || typeof s !== "object") continue;
          data.sites[d] = {
            remember: s.remember === true,
            blocking: s.blocking !== false,
            origins: Array.isArray(s.origins)
              ? s.origins.filter((x) => typeof x === "string" && httpUrl(x)).slice(0, 50)
              : [],
          };
        }
      }
      if (Array.isArray(raw.links))
        data.links = raw.links
          .filter((l) => l && typeof l.name === "string" && httpUrl(l.url))
          .slice(0, MAX_LINKS)
          .map((l) => ({ name: l.name.slice(0, 60), url: httpUrl(l.url).href }));
      if (typeof raw.engine === "string" && (raw.engine in SEARCH_ENGINES || raw.engine === "custom"))
        data.engine = raw.engine;
      if (
        typeof raw.customSearch === "string" &&
        raw.customSearch.includes("%s") &&
        httpUrl(raw.customSearch.replace("%s", "x"))
      )
        data.customSearch = raw.customSearch;
      data.keepCache = raw.keepCache === true;
      data.rememberPasswords = raw.rememberPasswords === true;
      if (Array.isArray(raw.passwordNever))
        data.passwordNever = [...new Set(raw.passwordNever.filter((x) => httpsOrigin(x)))].slice(
          0,
          MAX_NEVER,
        );
    }
  } catch {
    /* first start, or a broken file: the defaults */
  }

  const save = () => {
    try {
      fs.mkdirSync(o.dir, { recursive: true });
      writeFileAtomic(file, `${JSON.stringify({ formatVersion: 1, ...data }, null, 1)}\n`);
    } catch (e) {
      console.warn("[edexo-compare] browser settings not saved:", e);
    }
  };

  const site = (domain) => data.sites[domain] ?? { remember: false, blocking: true, origins: [] };
  const setSite = (domain, patch) => {
    if (!/^[a-z0-9.-]{1,253}$/.test(domain)) return;
    const next = { ...site(domain), ...patch };
    // A site with nothing to remember about it is not kept.
    if (!next.remember && next.blocking) delete data.sites[domain];
    else data.sites[domain] = next;
    save();
  };

  return {
    site,
    /** Remember this site (keep its cookies and storage), or not. */
    setRemember: (domain, on) =>
      setSite(domain, { remember: on === true, origins: on ? site(domain).origins : [] }),
    setBlocking: (domain, on) => setSite(domain, { blocking: on !== false }),
    /** An origin of a remembered site seen in a tab: its storage is kept with the site's. */
    noteOrigin(domain, origin) {
      const s = data.sites[domain];
      if (!s || !s.remember || s.origins.includes(origin) || s.origins.length >= 50) return;
      s.origins.push(origin);
      save();
    },
    forget(domain) {
      delete data.sites[domain];
      save();
    },
    /** Every origin whose storage is kept. */
    keptOrigins() {
      const out = [];
      for (const [d, s] of Object.entries(data.sites)) {
        if (!s.remember) continue;
        // No "www." before an address (192.168.1.20): an origin Chromium rejects fails every clear (review 1.2.16).
        const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(d) || d.includes(":");
        out.push(`https://${d}`, ...(ip ? [] : [`https://www.${d}`]), ...s.origins);
      }
      return [...new Set(out)].filter((o) => httpUrl(o) != null);
    },
    rememberedDomains: () => Object.keys(data.sites).filter((d) => data.sites[d].remember),
    links: () => [
      ...DEFAULT_LINKS.map((l) => ({ ...l, builtIn: true })),
      ...data.links.map((l) => ({ ...l, builtIn: false })),
    ],
    addLink(name, url) {
      const u = httpUrl(url);
      const n = typeof name === "string" ? name.trim().slice(0, 60) : "";
      if (!u || !n || data.links.length >= MAX_LINKS) return false;
      // One link per address (1.2.19 review): links are keyed and removed by address, so a second copy of a link, or
      // of a built-in one, could not be told apart and removing one removed both.
      if (DEFAULT_LINKS.some((l) => l.url === u.href) || data.links.some((l) => l.url === u.href)) return false;
      data.links.push({ name: n, url: u.href });
      save();
      return true;
    },
    removeLink(url) {
      const before = data.links.length;
      data.links = data.links.filter((l) => l.url !== url);
      if (data.links.length !== before) save();
      return data.links.length !== before;
    },
    engines: () => Object.entries(SEARCH_ENGINES).map(([key, e]) => ({ key, label: e.label })),
    engine: () => data.engine,
    customSearch: () => data.customSearch,
    setEngine(key, custom) {
      if (key === "custom") {
        if (typeof custom !== "string" || !custom.includes("%s") || !httpUrl(custom.replace("%s", "x")))
          return false;
        data.customSearch = custom.slice(0, 500);
      } else if (!(key in SEARCH_ENGINES)) return false;
      data.engine = key;
      save();
      return true;
    },
    /** Keep the HTTP cache when the rest of what sites stored is cleared (pages load faster on a revisit). */
    keepCache: () => data.keepCache,
    setKeepCache(on) {
      data.keepCache = on === true;
      save();
    },
    /** Offer to save logins, and fill saved ones from the key button. Off leaves the saved ones in place. */
    rememberPasswords: () => data.rememberPasswords,
    setRememberPasswords(on) {
      data.rememberPasswords = on === true;
      save();
    },
    /** Origins never to offer a password save for ("Never for this site"). */
    passwordNever: () => [...data.passwordNever],
    addPasswordNever(origin) {
      if (
        !httpsOrigin(origin) ||
        data.passwordNever.includes(origin) ||
        data.passwordNever.length >= MAX_NEVER
      )
        return false;
      data.passwordNever.push(origin);
      save();
      return true;
    },
    removePasswordNever(origin) {
      const before = data.passwordNever.length;
      data.passwordNever = data.passwordNever.filter((x) => x !== origin);
      if (data.passwordNever.length !== before) save();
      return data.passwordNever.length !== before;
    },
    /** The search URL for typed text. */
    searchUrl(text) {
      const tpl =
        data.engine === "custom" && data.customSearch
          ? data.customSearch
          : (SEARCH_ENGINES[data.engine] ?? SEARCH_ENGINES.duckduckgo).url;
      return tpl.replace("%s", encodeURIComponent(text));
    },
  };
}

module.exports = { createBrowserPrefs, httpUrl, DEFAULT_LINKS, SEARCH_ENGINES };
