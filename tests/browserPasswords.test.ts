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
