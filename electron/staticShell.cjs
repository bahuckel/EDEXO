"use strict";

/**
 * The pages' own files straight from disk while the server boots (owner, 2026-10-19: "launcher panel appears
 * immediately — not working", and the app window stayed blank for a second and a half when opened early).
 *
 * The server answers its first request within milliseconds of listening, then reads the journal cache and builds
 * the first snapshot on its one thread: measured on the owner's profile, 654 + 392 + 236 ms blocked in the first
 * two seconds. launcher.html, launcher.js, the stylesheets and the app's bundle all landed inside those stretches,
 * so a window that the main process had already drawn sat empty until the server came up for air.
 *
 * Here the main process answers a GET for a file the server would serve from its web root itself, with the
 * headers the server sends (exomasteryRoutes.ts: the CSP and no-store on HTML, a year's immutable cache on
 * /assets/). Everything else — the API, a missing file, another site — goes on to the network unchanged. The page
 * then draws at once and waits for its data the way it waits for a slow server, which it already handles.
 *
 * Only for the boot: the handler comes off a while after the server reports its journal boot done, so the
 * app's API traffic (the galaxy map's binary layers among it) does not pass through this process for the
 * whole run.
 */

const fs = require("fs");
const path = require("path");

/** The types express.static would send for what the web root holds. Anything else goes to the server. */
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * The file under `webRoot` that `pathname` names, or null when the server should answer instead: a path that
 * leaves the root, a dot-segment (express.static ignores dotfiles), a folder, an unknown type. "/" is the app.
 *
 * @param {string} webRoot
 * @param {string} pathname  URL pathname, still percent-encoded
 * @returns {string | null}
 */
function shellFileFor(webRoot, pathname) {
  let rel;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel === "/") rel = "/index.html";
  if (rel.includes("\0")) return null;
  const parts = rel.split("/").filter(Boolean);
  if (!parts.length || parts.some((p) => p.startsWith("."))) return null;
  if (!TYPES[path.extname(rel).toLowerCase()]) return null;
  const root = path.resolve(webRoot);
  const abs = path.resolve(root, ...parts);
  if (!abs.startsWith(root + path.sep)) return null;
  return abs;
}

/** @param {string} abs */
function headersFor(abs, csp) {
  const h = { "Content-Type": TYPES[path.extname(abs).toLowerCase()] };
  const norm = abs.replace(/\\/g, "/").toLowerCase();
  if (norm.endsWith(".html")) {
    h["Cache-Control"] = "no-store, max-age=0, must-revalidate";
    h["Content-Security-Policy"] = csp;
  } else if (norm.includes("/assets/")) {
    h["Cache-Control"] = "public, max-age=31536000, immutable";
  }
  return h;
}

/**
 * @param {object} o
 * @param {import("electron").Session[]} o.sessions  the sessions the app's windows load in
 * @param {string} o.baseUrl  the server's address, e.g. http://127.0.0.1:7111
 * @param {string} o.webRoot  the folder the server serves its pages from
 * @param {string} o.csp  the server's Content-Security-Policy, sent on HTML as it would be
 * @param {(msg: string) => void} [o.log]
 * @returns {{ remove: () => void, served: () => number }}
 */
function installStaticShell(o) {
  const origin = new URL(o.baseUrl).origin;
  let served = 0;
  const installed = [];
  for (const ses of o.sessions) {
    try {
      ses.protocol.handle("http", async (req) => {
        const pass = () => ses.fetch(req, { bypassCustomProtocolHandlers: true });
        if (req.method !== "GET" && req.method !== "HEAD") return pass();
        let url;
        try {
          url = new URL(req.url);
        } catch {
          return pass();
        }
        if (url.origin !== origin) return pass();
        const abs = shellFileFor(o.webRoot, url.pathname);
        if (!abs) return pass();
        let body;
        try {
          body = await fs.promises.readFile(abs);
        } catch {
          return pass();
        }
        served++;
        return new Response(req.method === "HEAD" ? null : body, { status: 200, headers: headersFor(abs, o.csp) });
      });
      installed.push(ses);
    } catch (e) {
      o.log?.(`static shell: not installed on a session (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return {
    remove: () => {
      for (const ses of installed.splice(0)) {
        try {
          ses.protocol.unhandle("http");
        } catch {
          /* already gone */
        }
      }
    },
    served: () => served,
  };
}

module.exports = { installStaticShell, shellFileFor };
