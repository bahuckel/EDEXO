/**
 * Updater integrity (review 2026-11-10 §4.11, plan 2.1): a checksum compared on its first digits only, a loose digest
 * pattern and a pre-release asset all passed the suite. Each case here fails when that comparison loosens.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAppUpdater } from "../src/server/appUpdater.js";
import { createUpdateChecker, pickLatestRelease } from "../src/server/updateCheck.js";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const EXE = Buffer.from("the new exe");
const rel = (tag: string, assets: unknown[], extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  published_at: "2026-10-10T00:00:00Z",
  assets,
  ...extra,
});

describe("which release file is offered", () => {
  it("only a SHA-256 digest of exactly 64 hex digits counts", () => {
    for (const digest of ["sha256:abcd1234", `sha256:${sha(EXE)}x`, `x-sha256:${sha(EXE)}`])
      expect([digest, pickLatestRelease([rel("v1.3.0", [{ name: "EDExoCompare.exe", digest }])], "portable")?.asset]).toEqual([digest, null]);
    expect(pickLatestRelease([rel("v1.3.0", [{ name: "EDExoCompare.exe", digest: `sha256:${sha(EXE)}` }])], "portable")?.asset?.sha256).toBe(sha(EXE));
  });

  it("never a pre-release's, even when the version's other tag is a release", () => {
    const zipName = "EDExoCompare-1.3.0-win-x64.zip";
    const releases = [
      rel("v1.3.0", [{ name: "EDExoCompare.exe", digest: `sha256:${sha(EXE)}` }]),
      rel("v1.3.0-zip", [{ name: zipName, digest: `sha256:${sha(EXE)}` }], { prerelease: true }),
    ];
    expect(pickLatestRelease(releases, "zip")?.asset).toBeNull();
  });
});

describe("a download", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "edexo-update-int-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is thrown away when its hash differs from GitHub's in the last digit only", async () => {
    const good = sha(EXE);
    const offByOne = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0");
    const releases = [rel("v1.3.0", [{ name: "EDExoCompare.exe", size: EXE.length, digest: `sha256:${offByOne}` }])];
    const f = (async (url: string) =>
      String(url).startsWith("https://api.github.com/")
        ? new Response(JSON.stringify(releases), { status: 200 })
        : new Response(new Uint8Array(EXE), { status: 200 })) as unknown as typeof fetch;
    const checker = createUpdateChecker({ fetchImpl: f, current: "1.2.9", form: "portable" });
    await checker.check(true);
    const u = createAppUpdater({ newerAsset: () => checker.newerAsset(), form: "portable", dir, fetchImpl: f, current: "1.2.9", supported: true });
    const st = await u.start();
    expect(st.state).toBe("error");
    expect(u.staged()).toBeNull();
    expect(existsSync(path.join(dir, "EDExoCompare.exe"))).toBe(false);
  });
});
