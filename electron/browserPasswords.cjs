"use strict";

/*
  The EDEXO browser's saved passwords (owner, 2026-10-16: "Remember passwords", off by default, stored encrypted
  like other browsers). Kept in `browser/passwords.json` in the app's data folder: per entry the exact origin
  (scheme, host and port) in plain text, the username and the password each encrypted with Electron's safeStorage
  (DPAPI on Windows, the keychain on macOS, libsecret or KWallet on Linux) and written as base64. Where the
  operating system offers no protection (safeStorage unavailable, or Linux's "basic_text" store) nothing is saved:
  never plain text. HTTPS pages only, and a login is offered back only on the very origin it was saved on.

  Nothing here logs: no origin, no username, no password goes to the console or huds.log.
*/

const fs = require("node:fs");
const path = require("node:path");
const { writeFileAtomic } = require("./atomicWrite.cjs");

const MAX_ENTRIES = 2000;
const MAX_USERNAME = 512;
const MAX_PASSWORD = 1024;

/** The exact origin of an https URL ("https://host[:port]"), or null (http, other schemes, junk). */
function passwordOrigin(raw) {
  if (typeof raw !== "string" || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname ? u.origin : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} o
 * @param {string} o.dir  the app's data folder
 * @param {import("electron").SafeStorage} o.safeStorage
 * @param {NodeJS.Platform} [o.platform]
 */
function createBrowserPasswords(o) {
  const file = path.join(o.dir, "browser", "passwords.json");
  const platform = o.platform ?? process.platform;
  /** @type {{ origin: string, u: string, p: string }[]} */
  let entries = [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && Array.isArray(raw.entries))
      entries = raw.entries
        .filter(
          (e) =>
            e && typeof e.u === "string" && typeof e.p === "string" && passwordOrigin(e.origin) === e.origin,
        )
        .slice(0, MAX_ENTRIES)
        .map((e) => ({ origin: e.origin, u: e.u, p: e.p }));
  } catch {
    /* none saved yet, or a broken file: nothing saved */
  }
  /** Origins and usernames, decrypted once (the toolbar's state is pushed often); never the passwords. */
  let listCache = null;

  /** Whether the operating system protects what is saved; if not, why (the settings say it). */
  function available() {
    try {
      if (!o.safeStorage || !o.safeStorage.isEncryptionAvailable())
        return { ok: false, reason: "The operating system's password protection is not available." };
      if (platform === "linux") {
        const backend = o.safeStorage.getSelectedStorageBackend();
        if (backend === "basic_text" || backend === "unknown")
          return {
            ok: false,
            reason: "No keyring found (GNOME Keyring or KWallet): passwords would be kept unprotected.",
          };
      }
      return { ok: true, reason: null };
    } catch {
      return { ok: false, reason: "The operating system's password protection is not available." };
    }
  }

  const enc = (s) => o.safeStorage.encryptString(s).toString("base64");
  const dec = (b64) => {
    try {
      return o.safeStorage.decryptString(Buffer.from(b64, "base64"));
    } catch {
      // Another user's or another machine's key (a copied profile): that entry cannot be read here.
      return null;
    }
  };

  function save() {
    listCache = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, `${JSON.stringify({ formatVersion: 1, entries }, null, 1)}\n`);
  }

  function list() {
    if (listCache) return listCache;
    if (!entries.length) return (listCache = []);
    if (!available().ok) return [];
    const out = [];
    for (const e of entries) {
      const username = dec(e.u);
      if (username != null) out.push({ origin: e.origin, username });
    }
    out.sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username));
    return (listCache = out);
  }

  /** The entry for origin + username, by index (decrypting the usernames of that origin only). */
  function indexOf(origin, username) {
    for (let i = 0; i < entries.length; i++)
      if (entries[i].origin === origin && dec(entries[i].u) === username) return i;
    return -1;
  }

  const validLogin = (username, password) =>
    typeof username === "string" &&
    username.length <= MAX_USERNAME &&
    typeof password === "string" &&
    password.length > 0 &&
    password.length <= MAX_PASSWORD;

  return {
    available,
    /** Every saved login, origin and username only. */
    list: () => list().map((x) => ({ ...x })),
    /** The usernames saved for exactly this origin. */
    usernames: (origin) =>
      list()
        .filter((x) => x.origin === origin)
        .map((x) => x.username),
    /**
     * What a captured login means: "same" (saved already), "update" (that username, another password),
     * "new", or null (not something that could be saved: http, no protection, bad values).
     */
    check(origin, username, password) {
      if (passwordOrigin(origin) !== origin || !validLogin(username, password) || !available().ok)
        return null;
      const i = indexOf(origin, username);
      if (i < 0) return entries.length >= MAX_ENTRIES ? null : "new";
      return dec(entries[i].p) === password ? "same" : "update";
    },
    /** Saved, or why not. */
    save(origin, username, password) {
      if (passwordOrigin(origin) !== origin) return { error: "Passwords are saved for HTTPS pages only." };
      if (!validLogin(username, password)) return { error: "Nothing to save." };
      const a = available();
      if (!a.ok) return { error: a.reason };
      const i = indexOf(origin, username);
      const entry = { origin, u: enc(username), p: enc(password) };
      if (i >= 0) entries[i] = entry;
      else if (entries.length >= MAX_ENTRIES) return { error: "Too many saved passwords." };
      else entries.push(entry);
      try {
        save();
      } catch {
        return { error: "The password could not be written." };
      }
      return { ok: true };
    },
    /** The password for exactly this origin and username (for a fill), or null. */
    lookup(origin, username) {
      if (passwordOrigin(origin) !== origin || typeof username !== "string" || !available().ok) return null;
      const i = indexOf(origin, username);
      return i < 0 ? null : dec(entries[i].p);
    },
    remove(origin, username) {
      const i = indexOf(origin, username);
      if (i < 0) return false;
      entries.splice(i, 1);
      save();
      return true;
    },
    clear() {
      entries = [];
      save();
    },
  };
}

module.exports = { createBrowserPasswords, passwordOrigin };
