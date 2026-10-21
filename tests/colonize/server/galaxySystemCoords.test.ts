import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The module keeps its cache at module scope, as the app needs; each test gets a fresh copy.
 * `fetch` is stubbed: no test here touches EDSM or Spansh.
 */
type Mod = typeof import("../../../src/server/colonize/galaxySystemCoords");

const coordsOf = (name: string): [number, number, number] => [name.length, 1, -2];

type Call = { url: string; host: "edsm" | "spansh" };

function stubNetwork(opts: { edsmKnows: (name: string) => boolean; spanshKnows?: (name: string) => boolean }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const url = String(input);
    const u = new URL(url);
    if (u.hostname.endsWith("edsm.net")) {
      calls.push({ url, host: "edsm" });
      const names = u.searchParams.getAll("systemName[]");
      const rows = names
        .filter(opts.edsmKnows)
        /** EDSM answers with its own casing, whatever was asked. */
        .map((n) => ({ name: n.toUpperCase(), coords: { x: coordsOf(n)[0], y: 1, z: -2 } }));
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    calls.push({ url, host: "spansh" });
    const q = u.searchParams.get("q") ?? "";
    const known = opts.spanshKnows?.(q) ?? false;
    const results = known
      ? [{ type: "system", record: { name: q, x: coordsOf(q)[0], y: 1, z: -2 } }]
      : [];
    return new Response(JSON.stringify({ results }), { status: 200 });
  });
  return calls;
}

let dir: string;

beforeEach(async () => {
  vi.resetModules();
  dir = await mkdtemp(path.join(tmpdir(), "coords-"));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

const load = async (): Promise<Mod> => import("../../../src/server/colonize/galaxySystemCoords");

describe("edsmCoordsByNorm", () => {
  it("keys by normalised name and skips rows without coordinates", async () => {
    const { edsmCoordsByNorm } = await load();
    const m = edsmCoordsByNorm([
      { name: "Sol", coords: { x: 0, y: 0, z: 0 } },
      { name: "Nowhere" },
      null,
    ]);
    expect([...m.entries()]).toEqual([["sol", [0, 0, 0]]]);
    expect(edsmCoordsByNorm({ error: "x" }).size).toBe(0);
  });
});

describe("resolveCoordMapForSystems", () => {
  it("asks EDSM for fifty names per request, not one", async () => {
    const calls = stubNetwork({ edsmKnows: () => true });
    const { resolveCoordMapForSystems } = await load();
    const names = Array.from({ length: 120 }, (_, i) => `Sys ${i}`);
    const out = await resolveCoordMapForSystems(names);
    expect(out.size).toBe(120);
    expect(calls.filter((c) => c.host === "edsm")).toHaveLength(3);
    expect(calls.some((c) => c.host === "spansh")).toBe(false);
    expect(out.get("sys 7")).toEqual(coordsOf("Sys 7"));
  });

  it("falls back to Spansh only for what EDSM did not know", async () => {
    const calls = stubNetwork({
      edsmKnows: (n) => n !== "New Colony",
      spanshKnows: (n) => n === "New Colony",
    });
    const { resolveCoordMapForSystems } = await load();
    const out = await resolveCoordMapForSystems(["Alpha", "New Colony", "Beta"]);
    expect(out.size).toBe(3);
    const spansh = calls.filter((c) => c.host === "spansh");
    expect(spansh).toHaveLength(1);
    expect(spansh[0]!.url).toContain("New%20Colony");
  });

  it("remembers a miss for a while instead of asking again", async () => {
    const calls = stubNetwork({ edsmKnows: () => false });
    const { resolveCoordMapForSystems } = await load();
    expect((await resolveCoordMapForSystems(["Ghost"])).size).toBe(0);
    const before = calls.length;
    expect((await resolveCoordMapForSystems(["ghost"])).size).toBe(0);
    expect(calls.length).toBe(before);
  });

  it("concurrent callers share one look-up", async () => {
    const calls = stubNetwork({ edsmKnows: () => true });
    const { resolveCoordMapForSystems } = await load();
    const [a, b] = await Promise.all([
      resolveCoordMapForSystems(["Alpha", "Beta"]),
      resolveCoordMapForSystems(["beta", "Alpha"]),
    ]);
    expect(a.size).toBe(2);
    expect(b.size).toBe(2);
    expect(calls).toHaveLength(1);
  });

  it("a second launch reads what the first found and fetches nothing", async () => {
    let calls = stubNetwork({ edsmKnows: () => true });
    let mod = await load();
    void mod.loadSystemCoordsCache(dir);
    await mod.resolveCoordMapForSystems(["Alpha", "Beta"]);
    await mod.flushSystemCoordsCache();
    expect(calls).toHaveLength(1);
    const saved = JSON.parse(await readFile(path.join(dir, "system-coords.json"), "utf8"));
    expect(saved).toEqual({ v: 1, systems: { alpha: coordsOf("Alpha"), beta: coordsOf("Beta") } });

    vi.resetModules();
    calls = stubNetwork({ edsmKnows: () => true });
    mod = await load();
    /** Not awaited, as in the app: the look-up must wait for the read by itself. */
    void mod.loadSystemCoordsCache(dir);
    const out = await mod.resolveCoordMapForSystems(["alpha", "BETA"]);
    expect(out.size).toBe(2);
    expect(calls).toHaveLength(0);
  });

  it("ignores a cache file it cannot read and entries that are not coordinates", async () => {
    await writeFile(
      path.join(dir, "system-coords.json"),
      JSON.stringify({ v: 1, systems: { good: [1, 2, 3], bad: [1, "x", 3], short: [1, 2] } }),
    );
    const calls = stubNetwork({ edsmKnows: () => true });
    const mod = await load();
    await mod.loadSystemCoordsCache(dir);
    const out = await mod.resolveCoordMapForSystems(["Good", "Bad", "Short"]);
    expect(out.get("good")).toEqual([1, 2, 3]);
    /** One EDSM batch for the two that were rejected from the file. */
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).searchParams.getAll("systemName[]")).toEqual(["Bad", "Short"]);
  });
});
