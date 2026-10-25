"use strict";

/*
  "Remember passwords" in the browser tabs (split out of browserTabs.cjs, discuss item 30, 1.3.1): the capture watcher
  in each https page's own script world, the save prompt, filling a saved login, and the toolbar's password and master
  password requests. The logins themselves are kept encrypted by browserPasswords.cjs.
*/
const { randomBytes } = require("node:crypto");
const { passwordOrigin } = require("./browserPasswords.cjs");
const { passwordCaptureScript, passwordFillScript } = require("./browserPageScripts.cjs");

/**
 * The script world "Remember passwords" works in: its own, apart from the cosmetic one and from the page's, so the
 * page can neither read the nonce its reports carry nor see the password a fill puts in.
 */
const PASSWORD_WORLD = 1078;
/** A captured login waits this long for Save / Never / Not now, then the password is dropped from memory. */
const PASSWORD_PROMPT_MS = 10 * 60 * 1000;

/** The toolbar requests answered here rather than in browserTabs.cjs. */
const OPS = new Set([
  "setRememberPasswords",
  "passwordAnswer",
  "passwordFill",
  "passwordDelete",
  "passwordDeleteAll",
  "masterUnlock",
  "masterLock",
  "masterSet",
  "masterRemove",
  "passwordNeverRemove",
]);

function createTabPasswords({ passwords, prefs, tabs, changed, state }) {
  const passwordsOn = () => !!passwords && prefs.rememberPasswords() && passwords.available().ok;

  /** At each page's dom-ready, with the option on and an https page: a fresh nonce, and the watcher in. */
  function watchPasswords(t, wc, url) {
    t.pw = null;
    t.pwField = false;
    t.pwAutoFilled = false;
    const origin = passwordOrigin(url);
    if (!origin || !passwordsOn()) return;
    const nonce = `${randomBytes(16).toString("hex")}:`;
    t.pw = { nonce, origin };
    void wc
      .executeJavaScriptInIsolatedWorld(PASSWORD_WORLD, [{ code: passwordCaptureScript(nonce) }])
      .catch(() => {});
  }

  /**
   * A console line from a page. Only one that starts with this page's nonce counts (only the password world knows
   * it), from the top frame, for the origin the nonce was made for. Never logged, never written: a password lives in
   * memory until the prompt is answered (or PASSWORD_PROMPT_MS), and on disk only encrypted.
   */
  function onPageConsole(t, wc, message, frame) {
    const pw = t.pw;
    if (!pw || typeof message !== "string" || !message.startsWith(pw.nonce)) return;
    if (frame && frame.parent) return;
    if (!passwordsOn()) return;
    let m;
    try {
      m = JSON.parse(message.slice(pw.nonce.length));
    } catch {
      return;
    }
    if (!m || typeof m !== "object") return;
    if (m.t === "field") {
      const has = m.has === true;
      if (has !== t.pwField) {
        t.pwField = has;
        changed();
      }
      if (has) autoFill(t, wc, pw.origin);
      return;
    }
    if (m.t !== "submit" || m.origin !== pw.origin) return;
    if (prefs.passwordNever().includes(pw.origin)) return;
    const username = typeof m.username === "string" ? m.username : "";
    const password = typeof m.password === "string" ? m.password : "";
    const kind = passwords.check(pw.origin, username, password);
    if (kind !== "new" && kind !== "update") return;
    clearTimeout(t.pwPrompt?.timer);
    t.pwPrompt = {
      origin: pw.origin,
      username,
      password,
      update: kind === "update",
      timer: setTimeout(() => {
        if (tabs.get(t.id) === t) dropPrompt(t);
        changed();
      }, PASSWORD_PROMPT_MS),
    };
    changed();
  }

  /*
    Filled on its own, as other browsers do (owner, 2026-10-16: the login was saved but "not remembered" — it only
    filled on the key button): once per page, when the page shows a password field and exactly one login is saved
    for this exact origin. Only empty fields, and the keyboard focus stays where it is. Several logins: the key
    button chooses.
  */
  function autoFill(t, wc, origin) {
    if (t.pwAutoFilled || !passwordsOn() || wc.isDestroyed()) return;
    const names = passwords.usernames(origin);
    if (names.length !== 1) return;
    const secret = passwords.lookup(origin, names[0]);
    if (secret == null) return;
    t.pwAutoFilled = true;
    void wc
      .executeJavaScriptInIsolatedWorld(PASSWORD_WORLD, [{ code: passwordFillScript(origin, names[0], secret, true) }])
      .catch(() => {});
  }

  function dropPrompt(t) {
    if (!t.pwPrompt) return;
    clearTimeout(t.pwPrompt.timer);
    t.pwPrompt = null;
  }

  /** What the toolbar may know about passwords: origins and usernames, never a password. */
  function passwordsView() {
    const a = passwords ? passwords.available() : { ok: false, reason: "Not available." };
    return {
      available: a.ok,
      reason: a.ok ? null : a.reason,
      saved: passwords ? passwords.list() : [],
      savedCount: passwords ? passwords.count() : 0,
      master: passwords ? passwords.masterState() : { set: false, unlocked: false },
      never: prefs.passwordNever(),
    };
  }

  /** The toolbar's password requests (browserTabs.cjs `handle`). */
  async function handle(op, a, t) {
    switch (op) {
      case "setRememberPasswords":
        // Off stops capture and fill; what is saved stays (the settings say so).
        prefs.setRememberPasswords(a?.on === true);
        if (a?.on !== true) for (const x of tabs.values()) dropPrompt(x);
        changed();
        return { ok: true, state: state() };
      case "passwordAnswer": {
        const p = t?.pwPrompt;
        if (!t || !p) return { error: "Nothing to save." };
        dropPrompt(t);
        let r = { ok: true };
        if (a?.answer === "save")
          r = passwords ? passwords.save(p.origin, p.username, p.password) : { error: "Not available." };
        else if (a?.answer === "never") prefs.addPasswordNever(p.origin);
        changed();
        return { ...r, state: state() };
      }
      case "passwordFill": {
        const wcp = t?.view?.webContents;
        if (!wcp || wcp.isDestroyed() || !passwordsOn()) return { error: "Nothing to fill." };
        const origin = passwordOrigin(wcp.getURL());
        const names = origin ? passwords.usernames(origin) : [];
        const username = typeof a?.username === "string" ? a.username : names.length === 1 ? names[0] : null;
        if (!origin || username == null || !names.includes(username)) return { error: "Nothing to fill." };
        const secret = passwords.lookup(origin, username);
        if (secret == null) return { error: "That password cannot be read on this PC." };
        const filled = await wcp
          .executeJavaScriptInIsolatedWorld(PASSWORD_WORLD, [
            { code: passwordFillScript(origin, username, secret) },
          ])
          .catch(() => false);
        return filled === true ? { ok: true } : { error: "No password field on this page." };
      }
      case "passwordDelete": {
        if (!passwords || typeof a?.origin !== "string" || typeof a?.username !== "string")
          return { error: "No such password." };
        try {
          passwords.remove(a.origin, a.username);
        } catch {
          return { error: "The change could not be written.", state: state() };
        }
        changed();
        return { ok: true, state: state() };
      }
      case "passwordDeleteAll":
        try {
          passwords?.clear();
        } catch {
          return { error: "The change could not be written.", state: state() };
        }
        changed();
        return { ok: true, state: state() };
      // The master password (1.2.19): it reaches the main process only to derive the key, and is never kept.
      case "masterUnlock": {
        const ok = !!passwords && (await passwords.unlock(String(a?.password ?? "")));
        if (ok) {
          changed();
          // A page already showing its login form gets the one saved login now, as on load.
          for (const x of tabs.values())
            if (x.pwField && x.pw && x.view && !x.view.webContents.isDestroyed()) autoFill(x, x.view.webContents, x.pw.origin);
        }
        return ok ? { ok: true, state: state() } : { error: "Wrong master password.", state: state() };
      }
      case "masterLock":
        passwords?.lock();
        changed();
        return { ok: true, state: state() };
      case "masterSet": {
        const r = passwords
          ? await passwords.setMaster(String(a?.password ?? ""), typeof a?.current === "string" ? a.current : undefined)
          : { error: "Not available." };
        changed();
        return { ...r, state: state() };
      }
      case "masterRemove": {
        const r = passwords ? await passwords.removeMaster(String(a?.current ?? "")) : { error: "Not available." };
        changed();
        return { ...r, state: state() };
      }
      case "passwordNeverRemove":
        prefs.removePasswordNever(String(a?.origin ?? ""));
        return { ok: true, state: state() };
    }
    return { error: "Unknown request." };
  }

  return {
    passwordsOn,
    watchPasswords,
    onPageConsole,
    dropPrompt,
    passwordsView,
    owns: (op) => OPS.has(op),
    handle,
  };
}

module.exports = { createTabPasswords };
