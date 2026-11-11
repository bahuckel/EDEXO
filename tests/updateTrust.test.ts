/**
 * What the updater trusts (review 2026-11-10 C4 / D1 / Electron 1, plan 1.6). None of these start PowerShell.
 *   - `ready.json` names a file in the update folder, never one elsewhere (a restored zip named a share).
 *   - On the way out the staged file is hashed again; a mismatch or a program folder at a drive root installs nothing.
 *   - At start only the `.old` folder an update marked is removed; one the commander made survives, and a swap never
 *     deletes a `.old` / `.new` it did not make (renamed aside).
 *   - Restoring app data never brings back an update, the LAN key or LAN access.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { lastInstallFailure, readStagedUpdate, READY_FILE } from "../src/server/appUpdater.js";
import { applyPendingRestore, restoreExclusion, stageAppDataRestore } from "../src/server/backup.js";
import { ZipWriter } from "../src/server/backupZip.js";

const require = createRequire(import.meta.url);
const updater = require("../electron/updater.cjs") as {
  removeOldCopy: (form: string, env?: Record<string, string>, execPath?: string) => void;
  installOnQuit: (
    staged: { form: string; file: string; version: string; sha256?: string },
    o: { form: string; scriptPath: string; logPath: string; pids: number[]; env?: Record<string, string>; execPath?: string },
  ) => { how: string; refused?: string };
  keepAsideUnlessOurs: (p: string, ours: (p: string) => boolean) => void;
  MOVED_MARK: string;
};

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "edexo-update-trust-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("the staged update", () => {
  it("is the file in the update folder, never one ready.json names elsewhere", () => {
    const upd = path.join(dir, "update");
    mkdirSync(upd);
    const elsewhere = path.join(dir, "planted.exe");
    writeFileSync(elsewhere, "x");
    writeFileSync(path.join(upd, READY_FILE), JSON.stringify({ version: "99.0.0", form: "portable", file: elsewhere, sha256: "0".repeat(64) }));
    expect(readStagedUpdate(upd, "1.3.8")).toBeNull();
    const inside = path.join(upd, "EDExoCompare.exe");
    writeFileSync(inside, "x");
    writeFileSync(path.join(upd, READY_FILE), JSON.stringify({ version: "99.0.0", form: "portable", file: inside, sha256: sha("x") }));
    expect(readStagedUpdate(upd, "1.3.8")?.file).toBe(inside);
  });
});

describe("installing on the way out", () => {
  const opts = (execPath: string) => ({ form: "zip", scriptPath: "unused.ps1", logPath: path.join(dir, "update.log"), pids: [], env: {}, execPath });

  it("installs nothing when the file no longer matches its checksum", () => {
    const zip = path.join(dir, "u.zip");
    writeFileSync(zip, "damaged");
    const program = path.join(dir, "EDEXO");
    mkdirSync(program);
    const r = updater.installOnQuit({ form: "zip", file: zip, version: "9.9.9", sha256: sha("the real one") }, opts(path.join(program, "EDExoCompare.exe")));
    expect(r).toMatchObject({ how: "none", refused: expect.stringMatching(/checksum/) });
    expect(readdirSync(program)).toEqual([]);
    // In the swap's log, so the next start says why nothing went in (lastInstallFailure).
    expect(lastInstallFailure(dir)).toMatch(/checksum/);
  });

  it("installs nothing into a program folder at a drive root", () => {
    const zip = path.join(dir, "u.zip");
    writeFileSync(zip, "z");
    const root = path.parse(dir).root;
    const r = updater.installOnQuit({ form: "zip", file: zip, version: "9.9.9", sha256: sha("z") }, opts(path.join(root, "EDExoCompare.exe")));
    expect(r).toMatchObject({ how: "none", refused: expect.stringMatching(/drive root/) });
  });
});

describe("the copy an update moved aside", () => {
  it("is removed at start only when the update marked it; the commander's own .old stays", () => {
    const program = path.join(dir, "EDEXO");
    mkdirSync(program);
    writeFileSync(path.join(program, "EDExoCompare.exe"), "new");
    const exe = path.join(program, "EDExoCompare.exe");
    // His own copy of the previous version, named as the update would name it.
    mkdirSync(program + ".old");
    writeFileSync(path.join(program + ".old", "EDExoCompare.exe"), "his copy");
    updater.removeOldCopy("zip", {}, exe);
    expect(readFileSync(path.join(program + ".old", "EDExoCompare.exe"), "utf8")).toBe("his copy");
    // The one an update moved aside carries the mark; a mark left in the running folder goes too.
    writeFileSync(path.join(program + ".old", updater.MOVED_MARK), "moved");
    writeFileSync(path.join(program, updater.MOVED_MARK), "left by a failed swap");
    updater.removeOldCopy("zip", {}, exe);
    expect(existsSync(program + ".old")).toBe(false);
    expect(existsSync(path.join(program, updater.MOVED_MARK))).toBe(false);
  });

  it("is never deleted by a swap that did not make it: renamed aside", () => {
    const p = path.join(dir, "EDEXO.old");
    mkdirSync(p);
    writeFileSync(path.join(p, "keep.txt"), "his");
    updater.keepAsideUnlessOurs(p, () => false);
    const kept = readdirSync(dir).find((n) => n.startsWith("EDEXO.old-kept-"))!;
    expect(readFileSync(path.join(dir, kept, "keep.txt"), "utf8")).toBe("his");
    mkdirSync(p);
    updater.keepAsideUnlessOurs(p, () => true);
    expect(existsSync(p)).toBe(true);
  });
});

describe("restoring app data", () => {
  it("never brings back an update, the LAN key or LAN access", async () => {
    expect(restoreExclusion("update/ready.json")).not.toBeNull();
    expect(restoreExclusion("edexo-compare-lan-key.txt")).not.toBeNull();
    expect(restoreExclusion("edexo-foot-scanned.json")).toBeNull();
    const zip = path.join(dir, "b.zip");
    const z = new ZipWriter(zip);
    const when = new Date("2026-11-11T00:00:00Z");
    await z.addBuffer("app-data/update/ready.json", '{"version":"99.0.0"}', when);
    await z.addBuffer("app-data/update/x.exe", "x", when);
    await z.addBuffer("app-data/edexo-compare-lan-key.txt", "known-key-known-key", when);
    await z.addBuffer("app-data/edexo-launcher-prefs.json", '{"lanAccess":true,"openMode":"window"}', when);
    await z.addBuffer("app-data/edexo-foot-scanned.json", '{"scans":[1]}', when);
    await z.finish();
    const app = path.join(dir, "app");
    mkdirSync(app);
    expect(await stageAppDataRestore(zip, app)).toBe(2);
    applyPendingRestore(app);
    expect(existsSync(path.join(app, "update"))).toBe(false);
    expect(existsSync(path.join(app, "edexo-compare-lan-key.txt"))).toBe(false);
    expect(JSON.parse(readFileSync(path.join(app, "edexo-launcher-prefs.json"), "utf8"))).toEqual({ openMode: "window" });
    expect(readFileSync(path.join(app, "edexo-foot-scanned.json"), "utf8")).toBe('{"scans":[1]}');
  });
});
