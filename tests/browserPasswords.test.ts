/**
 * The EDEXO browser's saved passwords (electron/browserPasswords.cjs; owner, 2026-10-16): encrypted with the
 * operating system's protection (Electron safeStorage, faked here), never plain text, HTTPS only, exact origins.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type Store = {
  available(): { ok: boolean; reason: string | null };
  list(): { origin: string; username: string }[];
  usernames(origin: string): string[];
  check(origin: string, username: string, password: string): "same" | "update" | "new" | null;
  save(origin: string, username: string, password: string): { ok?: boolean; error?: string };
  lookup(origin: string, username: string): string | null;
  remove(origin: string, username: string): boolean;
  clear(): void;
  count(): number;
  lockedCount(origin: string): number;
  masterState(): { set: boolean; unlocked: boolean };
  unlock(password: string): Promise<boolean>;
  lock(): void;
  setMaster(password: string, current?: string): Promise<{ ok?: boolean; error?: string }>;
  removeMaster(current: string): Promise<{ ok?: boolean; error?: string }>;
};
const { createBrowserPasswords, passwordOrigin } = require("../electron/browserPasswords.cjs") as {
  createBrowserPasswords: (o: { dir: string; safeStorage: unknown; platform?: string }) => Store;
  passwordOrigin: (raw: string) => string | null;
};

/** A stand-in for safeStorage: a reversible scramble, so a test can tell what was encrypted. */
function fakeSafeStorage(o: { available?: boolean; backend?: string } = {}) {
  const calls = { encrypt: 0, decrypt: 0 };
  return {
    calls,
    available: o.available ?? true,
    isEncryptionAvailable() {
      return this.available;
    },
    getSelectedStorageBackend: () => o.backend ?? "gnome_libsecret",
    encryptString(s: string) {
      calls.encrypt++;
      return Buffer.from(`ENC1${[...s].reverse().join("")}`, "utf8");
    },
    decryptString(b: Buffer) {
      calls.decrypt++;
      const s = b.toString("utf8");
      if (!s.startsWith("ENC1")) throw new Error("not ours");
      return [...s.slice(4)].reverse().join("");
    },
  };
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-browser-pw-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});
const file = () => path.join(dir, "browser", "passwords.json");

describe("saved passwords", () => {
  it("round-trip encrypted: nothing in the file reads as the username or password", () => {
    const ss = fakeSafeStorage();
    const p = createBrowserPasswords({ dir, safeStorage: ss, platform: "win32" });
    expect(p.check("https://inara.cz", "cmdr", "hunter2-secret")).toBe("new");
    expect(p.save("https://inara.cz", "cmdr", "hunter2-secret")).toEqual({ ok: true });
    const raw = readFileSync(file(), "utf8");
    expect(raw).not.toContain("hunter2-secret");
    expect(raw).not.toContain("terces-2retnuh");
    expect(raw).not.toContain("cmdr");
    expect(raw).toContain("https://inara.cz");
    // Read back by a new store, as at the next start.
    const again = createBrowserPasswords({ dir, safeStorage: ss, platform: "win32" });
    expect(again.list()).toEqual([{ origin: "https://inara.cz", username: "cmdr" }]);
    expect(again.lookup("https://inara.cz", "cmdr")).toBe("hunter2-secret");
    expect(again.check("https://inara.cz", "cmdr", "hunter2-secret")).toBe("same");
    expect(again.check("https://inara.cz", "cmdr", "other")).toBe("update");
    expect(again.save("https://inara.cz", "cmdr", "other")).toEqual({ ok: true });
    expect(again.list()).toHaveLength(1);
    expect(again.lookup("https://inara.cz", "cmdr")).toBe("other");
  });

  it("refuses to save when the operating system offers no protection, never writing plain text", () => {
    const off = createBrowserPasswords({ dir, safeStorage: fakeSafeStorage({ available: false }) });
    expect(off.available().ok).toBe(false);
    expect(off.available().reason).toBeTruthy();
    expect(off.check("https://inara.cz", "cmdr", "pw")).toBeNull();
    expect(off.save("https://inara.cz", "cmdr", "pw").error).toBeTruthy();
    // Linux without a keyring: Chromium's "basic_text" store is a fixed key, so it counts as none.
    const basic = createBrowserPasswords({
      dir,
      safeStorage: fakeSafeStorage({ backend: "basic_text" }),
      platform: "linux",
    });
    expect(basic.available().ok).toBe(false);
    expect(basic.save("https://inara.cz", "cmdr", "pw").error).toMatch(/keyring/i);
    expect(() => readFileSync(file(), "utf8")).toThrow();
    // The same backend name means nothing on Windows.
    const win = createBrowserPasswords({
      dir,
      safeStorage: fakeSafeStorage({ backend: "basic_text" }),
      platform: "win32",
    });
    expect(win.available().ok).toBe(true);
  });

  it("saves for HTTPS pages only, and matches the exact origin (scheme, host and port)", () => {
    expect(passwordOrigin("http://inara.cz/login")).toBeNull();
    expect(passwordOrigin("file:///C:/x")).toBeNull();
    expect(passwordOrigin("https://inara.cz/login?x=1")).toBe("https://inara.cz");
    expect(passwordOrigin("https://inara.cz:8443/")).toBe("https://inara.cz:8443");
    const p = createBrowserPasswords({ dir, safeStorage: fakeSafeStorage() });
    expect(p.save("http://inara.cz", "cmdr", "pw").error).toMatch(/HTTPS/);
    expect(p.save("https://inara.cz/login", "cmdr", "pw").error).toBeTruthy();
    expect(p.save("https://inara.cz", "cmdr", "pw")).toEqual({ ok: true });
    expect(p.usernames("https://inara.cz")).toEqual(["cmdr"]);
    for (const other of ["https://www.inara.cz", "https://inara.cz:8443", "http://inara.cz", "https://cz"])
      expect(p.usernames(other)).toEqual([]);
    expect(p.lookup("https://www.inara.cz", "cmdr")).toBeNull();
    expect(p.lookup("http://inara.cz", "cmdr")).toBeNull();
  });

  it("deletes one, or all", () => {
    const p = createBrowserPasswords({ dir, safeStorage: fakeSafeStorage() });
    p.save("https://inara.cz", "a", "1");
    p.save("https://inara.cz", "b", "2");
    p.save("https://www.edsm.net", "a", "3");
    expect(p.usernames("https://inara.cz")).toEqual(["a", "b"]);
    expect(p.remove("https://inara.cz", "a")).toBe(true);
    expect(p.remove("https://inara.cz", "a")).toBe(false);
    expect(p.list()).toEqual([
      { origin: "https://inara.cz", username: "b" },
      { origin: "https://www.edsm.net", username: "a" },
    ]);
    p.clear();
    expect(createBrowserPasswords({ dir, safeStorage: fakeSafeStorage() }).list()).toEqual([]);
  });

  it("skips entries it cannot decrypt, and a broken file, without failing", () => {
    mkdirSync(path.dirname(file()), { recursive: true });
    writeFileSync(
      file(),
      JSON.stringify({
        entries: [
          { origin: "https://a.example", u: Buffer.from("foreign").toString("base64"), p: "x" },
          { origin: "http://b.example", u: "x", p: "x" },
          "junk",
        ],
      }),
    );
    const p = createBrowserPasswords({ dir, safeStorage: fakeSafeStorage() });
    expect(p.list()).toEqual([]);
    writeFileSync(file(), "{not json");
    expect(createBrowserPasswords({ dir, safeStorage: fakeSafeStorage() }).list()).toEqual([]);
  });
});

describe("master password (1.2.19)", async () => {
  const O = "https://forums.example.com";
  const make = () => createBrowserPasswords({ dir, safeStorage: fakeSafeStorage() });

  it("seals the saved logins under the master key: a new start is locked until the right password", async () => {
    const a = make();
    a.save(O, "cmdr", "hunter2");
    expect(await a.setMaster("short")).toMatchObject({ error: expect.stringMatching(/6 characters/) });
    expect(await a.setMaster("correct horse")).toEqual({ ok: true });
    expect(a.masterState()).toEqual({ set: true, unlocked: true });
    expect(a.lookup(O, "cmdr")).toBe("hunter2");
    // The operating system's layer alone no longer opens the entries.
    const raw = JSON.parse(readFileSync(file(), "utf8"));
    expect(raw.formatVersion).toBe(2);
    const outer = fakeSafeStorage().decryptString(Buffer.from(raw.entries[0].p, "base64"));
    expect(outer).not.toContain("hunter2");

    const b = make();
    expect(b.masterState()).toEqual({ set: true, unlocked: false });
    expect(b.count()).toBe(1);
    expect(b.list()).toEqual([]);
    expect(b.usernames(O)).toEqual([]);
    expect(b.lockedCount(O)).toBe(1);
    expect(b.lookup(O, "cmdr")).toBeNull();
    expect(b.check(O, "new", "pw")).toBeNull();
    expect(b.save(O, "new", "pw")).toMatchObject({ error: expect.stringMatching(/Unlock/) });
    expect(await b.unlock("wrong one")).toBe(false);
    expect(await b.unlock("correct horse")).toBe(true);
    expect(b.lockedCount(O)).toBe(0);
    expect(b.usernames(O)).toEqual(["cmdr"]);
    expect(b.lookup(O, "cmdr")).toBe("hunter2");
    b.lock();
    expect(b.lookup(O, "cmdr")).toBeNull();
  });

  it("changes and removes only with the current password; every login survives both", async () => {
    const a = make();
    a.save(O, "cmdr", "hunter2");
    await a.setMaster("first pass");
    expect(await a.setMaster("second pass", "nope")).toMatchObject({ error: expect.stringMatching(/wrong/) });
    expect(await a.setMaster("second pass", "first pass")).toEqual({ ok: true });
    const b = make();
    expect(await b.unlock("first pass")).toBe(false);
    expect(await b.unlock("second pass")).toBe(true);
    expect(await b.removeMaster("first pass")).toMatchObject({ error: expect.stringMatching(/wrong/) });
    expect(await b.removeMaster("second pass")).toEqual({ ok: true });
    const c = make();
    expect(c.masterState()).toEqual({ set: false, unlocked: false });
    expect(c.lookup(O, "cmdr")).toBe("hunter2");
    expect(JSON.parse(readFileSync(file(), "utf8")).formatVersion).toBe(1);
  });

  it("delete all is the way back from a forgotten master password", async () => {
    const a = make();
    a.save(O, "cmdr", "hunter2");
    await a.setMaster("forgotten soon");
    const b = make();
    b.clear();
    expect(b.masterState()).toEqual({ set: false, unlocked: false });
    expect(b.count()).toBe(0);
    expect(make().masterState().set).toBe(false);
  });
});
