"use strict";

/*
  The EDEXO browser's saved passwords (owner, 2026-10-16: "Remember passwords", off by default, stored encrypted
  like other browsers). Kept in `browser/passwords.json` in the app's data folder: per entry the exact origin
  (scheme, host and port) in plain text, the username and the password each encrypted with Electron's safeStorage
  (DPAPI on Windows, the keychain on macOS, libsecret or KWallet on Linux) and written as base64. Where the
  operating system offers no protection (safeStorage unavailable, or Linux's "basic_text" store) nothing is saved:
  never plain text. HTTPS pages only, and a login is offered back only on the very origin it was saved on.

  Optional master password (owner, 2026-10-17, 1.2.19): with one set, each username and password is first sealed with
  AES-256-GCM under a key derived from the master password (scrypt, salt in the file), then with safeStorage as
  before. The key lives in memory only, from the unlock until the app closes or Lock: without it nothing can be read,
  not even by a program running as the same Windows user. Forgotten: "Delete all" starts over (and drops the master).

  Nothing here logs: no origin, no username, no password goes to the console or huds.log.
*/

const nodeCrypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { writeFileAtomic } = require("./atomicWrite.cjs");

const MAX_ENTRIES = 2000;
const MAX_USERNAME = 512;
const MAX_PASSWORD = 1024;
const MASTER_MIN = 6;
const MASTER_CHECK = "edexo-master-check-v1";
// ~100 ms on a desktop CPU: cheap once per session, slow for guessing.
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** The key for a master password: scrypt on libuv's thread pool, so the ~100 ms never stalls the app's windows. */
function deriveKey(password, saltB64) {
  return new Promise((resolve, reject) =>
    nodeCrypto.scrypt(password, Buffer.from(saltB64, "base64"), 32, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** AES-256-GCM: iv (12) + tag (16) + ciphertext, base64. */
function seal(key, text) {
  const iv = nodeCrypto.randomBytes(12);
  const c = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

/** The text, or a throw when the key is wrong or the data was changed. */
function open(key, b64) {
  const buf = Buffer.from(b64, "base64");
  const d = nodeCrypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString("utf8");
}

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
  /** The master password's salt and check value, when one is set. @type {{ salt: string, check: string } | null} */
  let master = null;
  /** The key derived from it, from the unlock until Lock or the app closes. @type {Buffer | null} */
  let key = null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw?.master && typeof raw.master.salt === "string" && typeof raw.master.check === "string")
      master = { salt: raw.master.salt, check: raw.master.check };
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

  const locked = () => master != null && key == null;
  /** Sealed for the file: under the master key first when there is one (call only while unlocked). */
  const enc = (s, k = key) => o.safeStorage.encryptString(k ? seal(k, s) : s).toString("base64");
  const dec = (b64) => {
    try {
      const inner = o.safeStorage.decryptString(Buffer.from(b64, "base64"));
      if (!master) return inner;
      return key ? open(key, inner) : null;
    } catch {
      // Another user's or another machine's key (a copied profile): that entry cannot be read here.
      return null;
    }
  };

  function save() {
    listCache = null;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const doc = master ? { formatVersion: 2, master, entries } : { formatVersion: 1, entries };
    writeFileAtomic(file, `${JSON.stringify(doc, null, 1)}\n`);
  }

  /** The key for this master password, or null when it is wrong. */
  async function tryKey(password) {
    if (!master || typeof password !== "string" || !password) return null;
    try {
      const k = await deriveKey(password, master.salt);
      return open(k, master.check) === MASTER_CHECK ? k : null;
    } catch {
      return null;
    }
  }

  /**
   * Seal every login again under `nextKey` (null: the operating system's lock only) and write the file; the old state
   * comes back when the write fails. `plain` is every entry, read before.
   */
  function reseal(nextMaster, nextKey, plain) {
    const before = { master, key, entries };
    master = nextMaster;
    key = nextKey;
    entries = plain.map((e) => ({ origin: e.origin, u: enc(e.u, nextKey), p: enc(e.p, nextKey) }));
    try {
      save();
      return { ok: true };
    } catch {
      ({ master, key, entries } = before);
      listCache = null;
      return { error: "The change could not be written." };
    }
  }

  /** Every entry readable now, as plain text; null when one cannot be read (locked, or another PC's). */
  function plainEntries() {
    const out = [];
    for (const e of entries) {
      const u = dec(e.u);
      const p = dec(e.p);
      if (u == null || p == null) return null;
      out.push({ origin: e.origin, u, p });
    }
    return out;
  }

  function list() {
    if (listCache) return listCache;
    if (!entries.length || locked()) return (listCache = []);
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
      if (passwordOrigin(origin) !== origin || !validLogin(username, password) || !available().ok || locked())
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
      if (locked()) return { error: "Unlock the saved passwords first." };
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
    /** Everything goes, the master password too: the way back when it is forgotten. */
    clear() {
      entries = [];
      master = null;
      key = null;
      save();
    },
    /** How many logins are saved (readable or not). */
    count: () => entries.length,
    /** Saved logins for this origin that the lock hides (0 when unlocked or no master). */
    lockedCount: (origin) => (locked() ? entries.filter((e) => e.origin === origin).length : 0),
    /** Whether a master password is set, and whether it is unlocked now. */
    masterState: () => ({ set: master != null, unlocked: master != null && key != null }),
    /** Unlock with the master password; true when it was right. */
    async unlock(password) {
      const k = await tryKey(password);
      if (!k) return false;
      key = k;
      listCache = null;
      return true;
    },
    lock() {
      if (master) key = null;
      listCache = null;
    },
    /**
     * Set or change the master password (`current` when one is set). Every saved login is sealed again under the new
     * key; nothing changes when one cannot be read.
     */
    async setMaster(password, current) {
      if (typeof password !== "string" || password.length < MASTER_MIN || password.length > MAX_PASSWORD)
        return { error: `The master password needs at least ${MASTER_MIN} characters.` };
      const a = available();
      if (!a.ok) return { error: a.reason };
      if (master) {
        const k = await tryKey(current);
        if (!k) return { error: "The current master password is wrong." };
        key = k;
      }
      const salt = nodeCrypto.randomBytes(16).toString("base64");
      const k = await deriveKey(password, salt);
      // Read after the ~100 ms derive, with no await before the write: a login saved meanwhile is kept, not lost.
      const plain = plainEntries();
      if (!plain) return { error: "A saved login cannot be read on this PC: delete it first." };
      return reseal({ salt, check: seal(k, MASTER_CHECK) }, k, plain);
    },
    /** Drop the master password (the current one is asked): the logins go back to the operating system's lock only. */
    async removeMaster(current) {
      if (!master) return { ok: true };
      const k = await tryKey(current);
      if (!k) return { error: "The master password is wrong." };
      key = k;
      const plain = plainEntries();
      if (!plain) return { error: "A saved login cannot be read on this PC: delete it first." };
      return reseal(null, null, plain);
    },
  };
}

module.exports = { createBrowserPasswords, passwordOrigin };
