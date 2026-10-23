"use strict";

/*
  The EDEXO browser's address helpers (browserTabs.cjs, which re-exports them): what the address bar's text opens,
  the hosts HTTPS-first leaves alone, Inara's commodity search, and the plain Chrome user agent. No Electron, no
  state (audit 2026-10-22).
*/

const { httpUrl } = require("./browserPrefs.cjs");

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

/**
 * Inara's commodity search (owner, 2026-10-22: "Inara inside the EDEXO Browser"): the only pages the EDEXO pop-up
 * reads. https only, inara.cz or www.inara.cz, the /elite/commodities/ path.
 */
function isInaraCommodityPage(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && /^(www\.)?inara\.cz$/i.test(u.hostname) && /^\/elite\/commodities\/?$/i.test(u.pathname);
  } catch {
    return false;
  }
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

module.exports = { isLocalHost, resolveTyped, isInaraCommodityPage, chromeUserAgent };
