/**
 * The Windows helpers written in Rust for 1.3.1 (native/, owner 2026-10-25: "use Rust"): the HUD's foreground watcher
 * and the console client launcher. Run where they are built (`node scripts/build-native.mjs` or `cargo build --release`
 * in native/); skipped elsewhere.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { nativeWatcherPath, parseForegroundLine } = require("../electron/foregroundWatch.cjs") as {
  nativeWatcherPath: (resourcesPath?: string) => string | null;
  parseForegroundLine: (line: string) => { name: string; at: { x: number; y: number } | null };
};

const built = path.resolve("native", "target", "release");
const watcher = path.join(built, "edexo-fgwatch.exe");
const client = path.join(built, "EDExoCompare-Client-CLI.exe");
const onWindows = process.platform === "win32";
const tmp = mkdtempSync(path.join(tmpdir(), "edexo-native-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("nativeWatcherPath", () => {
  it("takes the installed build's resources/edexo copy first", () => {
    const res = path.join(tmp, "resources");
    mkdirSync(path.join(res, "edexo"), { recursive: true });
    writeFileSync(path.join(res, "edexo", "edexo-fgwatch.exe"), "");
    expect(nativeWatcherPath(res)).toBe(path.join(res, "edexo", "edexo-fgwatch.exe"));
  });
});

describe.skipIf(!onWindows || !existsSync(watcher))("the foreground watcher", () => {
  it("prints the foreground program and its window's centre, in the line the app reads", async () => {
    const child = spawn(watcher, [String(process.pid)], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const line = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no line within 3 s")), 3000);
      child.stdout.once("data", (d: Buffer) => {
        clearTimeout(t);
        resolve(String(d).split("\n")[0]!);
      });
    });
    child.kill();
    expect(line).toMatch(/^[^\t]*\t(-?\d+,-?\d+)?$/);
    const parsed = parseForegroundLine(line);
    expect(typeof parsed.name).toBe("string");
  });

  it("ends when the process it watches for is gone", async () => {
    const parent = spawn(process.execPath, ["-e", "setTimeout(() => {}, 600)"]);
    const child = spawn(watcher, [String(parent.pid)], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const code = await new Promise<number | null>((resolve) => child.once("exit", resolve));
    expect(code).toBe(0);
  });
});

describe.skipIf(!onWindows || !existsSync(client))("the console client launcher", () => {
  it("starts the Server-CLI beside it on this PC only, opening the browser, and ends with its exit code", () => {
    const dir = path.join(tmp, "cli");
    mkdirSync(dir, { recursive: true });
    copyFileSync(client, path.join(dir, "EDExoCompare-Client-CLI.exe"));
    // A stand-in server: Node, which runs the script it is given and echoes the rest of its arguments.
    const fake = path.join(dir, "EDExoCompare-Server-CLI.exe");
    try {
      linkSync(process.execPath, fake);
    } catch {
      copyFileSync(process.execPath, fake);
    }
    const script = path.join(dir, "echo.cjs");
    writeFileSync(script, "console.log(JSON.stringify(process.argv.slice(2))); process.exit(7);");
    const r = spawnSync(path.join(dir, "EDExoCompare-Client-CLI.exe"), [script, "--port", "7200"], { encoding: "utf8" });
    expect(r.status).toBe(7);
    expect(JSON.parse(r.stdout.trim())).toEqual(["--port", "7200", "--host", "127.0.0.1", "--open"]);
    // A host of his own choosing is kept.
    const lan = spawnSync(path.join(dir, "EDExoCompare-Client-CLI.exe"), [script, "--lan"], { encoding: "utf8" });
    expect(JSON.parse(lan.stdout.trim())).toEqual(["--lan", "--open"]);
  });

  it("says what is missing when the Server-CLI is not beside it", () => {
    const dir = path.join(tmp, "alone");
    mkdirSync(dir, { recursive: true });
    copyFileSync(client, path.join(dir, "EDExoCompare-Client-CLI.exe"));
    const r = spawnSync(path.join(dir, "EDExoCompare-Client-CLI.exe"), [], { encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("EDExoCompare-Server-CLI.exe is not in this folder");
  });
});
