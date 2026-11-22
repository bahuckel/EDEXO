"use strict";
/**
 * The windows' saved settings, carried to the server's new address after a port move (src/server/listenPort.ts).
 *
 * The browser keeps localStorage per address, port included: once Windows had reserved 7111 and the server moved to
 * 17111, the app window opened with none of the commander's choices (interface style, colour scheme, open tabs,
 * filters), the HUDs and the launcher likewise. So, once, at the start that moved: for each session the windows use,
 * a hidden window reads the old address's localStorage and writes what the new one does not have yet. Both addresses
 * are answered with an empty page from here while it runs — the old one has no server any more, and the new one's
 * pages would start the app — and the handler comes off before anything else loads.
 *
 * Runs before the static shell (staticShell.cjs) puts its own handler on the same sessions: a session takes one.
 */

const BLANK = "<!doctype html><meta charset=utf-8><title>EDEXO</title>";
const PATH = "/__edexo-carry";

/**
 * @param {object} o
 * @param {typeof import("electron")} o.electron
 * @param {import("electron").Session[]} o.sessions
 * @param {string} o.fromOrigin  e.g. http://127.0.0.1:7111
 * @param {string} o.toOrigin    e.g. http://127.0.0.1:17111
 * @param {(msg: string) => void} [o.log]
 * @returns {Promise<number>} the keys written, over every session
 */
async function carryOriginStorage(o) {
  const { BrowserWindow } = o.electron;
  const from = new URL(o.fromOrigin).origin;
  const to = new URL(o.toOrigin).origin;
  let written = 0;
  for (const ses of o.sessions) {
    let handled = false;
    let win = null;
    try {
      ses.protocol.handle("http", (req) => {
        const origin = new URL(req.url).origin;
        if (origin === from || origin === to) return new Response(BLANK, { headers: { "Content-Type": "text/html" } });
        return ses.fetch(req, { bypassCustomProtocolHandlers: true });
      });
      handled = true;
      win = new BrowserWindow({
        show: false,
        webPreferences: { session: ses, contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      await win.loadURL(from + PATH);
      const dump = await win.webContents.executeJavaScript("JSON.stringify(Object.assign({}, window.localStorage))");
      if (dump === "{}") continue;
      await win.loadURL(to + PATH);
      written += await win.webContents.executeJavaScript(
        `(() => { const o = JSON.parse(${JSON.stringify(dump)}); let n = 0;` +
          ` for (const k of Object.keys(o)) { if (localStorage.getItem(k) === null) { localStorage.setItem(k, o[k]); n++; } }` +
          ` return n; })()`,
      );
    } catch (e) {
      o.log?.(`settings not carried to ${to} for a session: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (win && !win.isDestroyed()) win.destroy();
      if (handled) {
        try {
          ses.protocol.unhandle("http");
        } catch {
          /* already gone */
        }
      }
    }
  }
  return written;
}

module.exports = { carryOriginStorage };
