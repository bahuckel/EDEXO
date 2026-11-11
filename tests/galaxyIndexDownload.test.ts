/**
 * The galaxy index as a separate download (owner, 2026-10-04, plan 4.2): it lands beside the settings,
 * a cut download never looks like an index, and the downloaded copy wins over the project's.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  downloadGalaxyIndex,
  GALAXY_INDEX_RELEASE_API,
  galaxyIndexFilePath,
  galaxyIndexStatus,
  bioIndexSystemCount,
  probeGalaxyIndexSize,
} from "../src/server/galaxyIndexFiles.js";

let dir: string;
let before: string | undefined;
beforeEach(() => {
  before = process.env.EDEXO_USER_DATA_DIR;
  dir = mkdtempSync(path.join(os.tmpdir(), "edexo-gidx-"));
  process.env.EDEXO_USER_DATA_DIR = dir;
});
afterEach(() => {
  if (before === undefined) delete process.env.EDEXO_USER_DATA_DIR;
  else process.env.EDEXO_USER_DATA_DIR = before;
  rmSync(dir, { recursive: true, force: true });
});

const sha = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
/** The release listing for these file bodies, with GitHub's checksums. */
const listing = (bodies: Record<string, string | Uint8Array>) =>
  new Response(JSON.stringify({ assets: Object.entries(bodies).map(([name, b]) => ({ name, digest: `sha256:${sha(b)}` })) }));
/** The release: its listing with GitHub's checksums (`wrongFor` lists a wrong one), and the two files. */
const serve = (failOn?: string, wrongFor?: string, prefix = "index") =>
  (async (url: string) => {
    if (String(url) === GALAXY_INDEX_RELEASE_API) {
      const assets = ["bio-index.bin", "system-traits.bin.gz"].map((name) => ({
        name,
        digest: `sha256:${sha(name === wrongFor ? "something else" : `${prefix}:${name}`)}`,
      }));
      return new Response(JSON.stringify({ assets }), { status: 200 });
    }
    const name = String(url).split("/").pop()!;
    if (name === failOn) return new Response("nope", { status: 404 });
    const body = new TextEncoder().encode(`${prefix}:${name}`);
    return new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
  }) as unknown as typeof fetch;

describe("the galaxy index download", () => {
  it("lands both files beside the settings, and they win over the project's copies", async () => {
    let done = 0;
    await downloadGalaxyIndex(() => (done += 1), serve());
    expect(done).toBe(1);
    const p = galaxyIndexFilePath("bio-index.bin");
    expect(p.startsWith(dir)).toBe(true);
    expect(readFileSync(p, "utf8")).toBe("index:bio-index.bin");
    expect(readFileSync(galaxyIndexFilePath("system-traits.bin.gz"), "utf8")).toBe(
      "index:system-traits.bin.gz",
    );
    const st = galaxyIndexStatus();
    expect(st.present).toBe(true);
    expect(st.downloading).toBeNull();
    expect(st.error).toBeNull();
  });

  it("a failed file leaves no half file and says why", async () => {
    let done = 0;
    await downloadGalaxyIndex(() => (done += 1), serve("system-traits.bin.gz"));
    expect(done).toBe(0);
    expect(galaxyIndexStatus().error).toMatch(/system-traits\.bin\.gz: HTTP 404/);
    expect(galaxyIndexFilePath("system-traits.bin.gz").startsWith(dir)).toBe(false);
  });

  // Review 2026-11-10 (plan 1.6): checked against GitHub's checksum, and the two files go in together or not at all.
  it("replaces nothing when a file does not match GitHub's checksum", async () => {
    await downloadGalaxyIndex(() => {}, serve());
    let done = 0;
    // A newer release whose bio index checks out and whose traits file does not: neither goes in.
    await downloadGalaxyIndex(() => (done += 1), serve(undefined, "system-traits.bin.gz", "newer"));
    expect(done).toBe(0);
    expect(galaxyIndexStatus().error).toMatch(/system-traits\.bin\.gz does not match/);
    expect(readFileSync(galaxyIndexFilePath("bio-index.bin"), "utf8")).toBe("index:bio-index.bin");
    expect(readdirSync(path.dirname(galaxyIndexFilePath("bio-index.bin"))).some((n) => n.endsWith(".part"))).toBe(false);
  });

  // Owner, 2026-10-07: with an index here the map offered no download at all; now it says when the release differs.
  it("says when the release holds other files than the ones here", async () => {
    await downloadGalaxyIndex(() => {}, serve());
    const sized = (n: number) =>
      (async () =>
        new Response(null, {
          status: 200,
          headers: { "content-length": String(n) },
        })) as unknown as typeof fetch;
    await probeGalaxyIndexSize(sized("index:bio-index.bin".length));
    expect(galaxyIndexStatus().updateAvailable).toBe(true); // the traits file differs in size
    const same = (async (url: string) => {
      const n = `index:${String(url).split("/").pop()}`.length;
      return new Response(null, { status: 200, headers: { "content-length": String(n) } });
    }) as unknown as typeof fetch;
    await probeGalaxyIndexSize(same);
    expect(galaxyIndexStatus().updateAvailable).toBe(false);
  });
});

/** A bio index header: magic, version, species, systems, json length (the 20 bytes the probe reads). */
function header(systems: number): Uint8Array<ArrayBuffer> {
  const b = Buffer.alloc(64);
  b.write("EDEXOBIO", 0, "ascii");
  b.writeUInt16LE(3, 8);
  b.writeUInt16LE(120, 10);
  b.writeUInt32LE(systems, 12);
  b.writeUInt32LE(10, 16);
  const out = new Uint8Array(new ArrayBuffer(64));
  out.set(b);
  return out;
}

describe("the galaxy index in systems, not megabytes (owner, 2026-10-12)", () => {
  it("reads the count from a header, and nothing from anything else", () => {
    expect(bioIndexSystemCount(header(5_337_927))).toBe(5_337_927);
    expect(bioIndexSystemCount(new TextEncoder().encode("index:bio-index.bin and more bytes"))).toBeNull();
    expect(bioIndexSystemCount(new Uint8Array(4))).toBeNull();
  });

  it("asks the release for its first bytes only, and counts both sides", async () => {
    const ranges: (string | null)[] = [];
    const release = (async (url: string, init?: RequestInit) => {
      const name = String(url).split("/").pop()!;
      ranges.push(new Headers(init?.headers).get("range"));
      // A server that ignores the range and sends everything: the probe stops reading after 20 bytes.
      const body = name === "bio-index.bin" ? header(5_348_227) : new TextEncoder().encode(`index:${name}`);
      return new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
    }) as unknown as typeof fetch;
    await downloadGalaxyIndex(() => undefined, (async (url: string) => {
      if (String(url) === GALAXY_INDEX_RELEASE_API)
        return listing({ "bio-index.bin": header(5_337_927), "system-traits.bin.gz": "index:system-traits.bin.gz" });
      const name = String(url).split("/").pop()!;
      const body = name === "bio-index.bin" ? header(5_337_927) : new TextEncoder().encode(`index:${name}`);
      return new Response(body, { status: 200, headers: { "content-length": String(body.length) } });
    }) as unknown as typeof fetch);
    await probeGalaxyIndexSize(release);
    const st = galaxyIndexStatus();
    expect(st.systemsHere).toBe(5_337_927);
    expect(st.systemsOnRelease).toBe(5_348_227);
    expect(ranges).toContain("bytes=0-19");
  });
});

// Code review A10 (2026-10-14): a connection that stops sending used to leave "downloading" up for good.
describe("a stalled galaxy index download", () => {
  it("gives up after the idle time, says so, and leaves no half file", async () => {
    const stalled = (async (url: string) => {
      if (String(url) === GALAXY_INDEX_RELEASE_API) return listing({ "bio-index.bin": "x", "system-traits.bin.gz": "y" });
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode("half"));
          // ...and never another byte, never closed.
        },
      });
      return new Response(stream, { status: 200, headers: { "content-length": "1000" } });
    }) as unknown as typeof fetch;
    let done = 0;
    await downloadGalaxyIndex(() => (done += 1), stalled, { connectMs: 200, idleMs: 50 });
    expect(done).toBe(0);
    const st = galaxyIndexStatus();
    expect(st.downloading).toBeNull();
    expect(st.error).toMatch(/no data for/);
    expect(galaxyIndexFilePath("bio-index.bin").startsWith(dir)).toBe(false);
  });
});
