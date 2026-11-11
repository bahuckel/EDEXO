/**
 * The browser's scriptlets are pinned (review 2026-11-10 D3, plan 1.7): code that runs inside browsed pages comes
 * from one commit and must match its SHA-256; a file that does not is refused and never written, and the filter
 * lists still go in.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { createBrowserBlocker, LISTS, RESOURCES } = require("../electron/browserBlocker.cjs");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function blocker(scriptlets: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "edexo-pin-"));
  dirs.push(dir);
  const fetch = async (url: string) => {
    const body = url === RESOURCES.url ? scriptlets : "! Title: a list\n||ads.example^\n";
    return new Response(body, { status: 200 });
  };
  // No engine bundle here: the build fails after the downloads, which is all these cases look at.
  const b = createBrowserBlocker({ dir, bundlePath: path.join(dir, "no-bundle.cjs"), fetch, onChange: () => {} });
  return { b, dir, file: path.join(dir, "browser", "resources.json") };
}

describe("the pinned scriptlets", () => {
  it("name one commit and a SHA-256, never a branch", () => {
    expect(RESOURCES.url).toMatch(/\/ghostery\/adblocker\/[0-9a-f]{40}\//);
    expect(RESOURCES.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(RESOURCES.daily).toBeUndefined();
  });

  it("refuse bytes that are not the pinned ones, and write the lists anyway", async () => {
    const { b, dir, file } = blocker(JSON.stringify({ scriptlets: [{ name: "x.js", body: "evil()" }] }));
    expect(await b.download()).toBe(false);
    expect(b.status().error).toMatch(/did not match the pinned copy/);
    expect(existsSync(file)).toBe(false);
    for (const l of LISTS) expect(existsSync(path.join(dir, "browser", "lists", `${l.key}.txt`))).toBe(true);
  });
});
