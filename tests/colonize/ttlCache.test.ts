import { describe, expect, it } from "vitest";
import { mapPool } from "../../src/shared/colonize/mapPool";
import { TtlCache } from "../../src/shared/colonize/ttlCache";

function clock() {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("TtlCache", () => {
  it("drops the oldest entry past the cap", () => {
    const c = new TtlCache<string, number>({ max: 2 });
    c.set("a", 1);
    c.set("b", 2);
    c.set("c", 3);
    expect([...c.entries()]).toEqual([
      ["b", 2],
      ["c", 3],
    ]);
  });

  it("rewriting a key makes it the newest", () => {
    const c = new TtlCache<string, number>({ max: 2 });
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 10);
    c.set("c", 3);
    expect(c.get("a")).toBe(10);
    expect(c.get("b")).toBeUndefined();
  });

  it("touchOnGet evicts the least recently read instead", () => {
    const c = new TtlCache<string, number>({ max: 2, touchOnGet: true });
    c.set("a", 1);
    c.set("b", 2);
    c.get("a");
    c.set("c", 3);
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(false);
  });

  it("stops serving at ttl, but can still hand over a stale value when asked", () => {
    const t = clock();
    const c = new TtlCache<string, string>({ max: 10, ttlMs: 100, now: t.now });
    c.set("k", "v");
    t.advance(99);
    expect(c.get("k")).toBe("v");
    expect(c.getStale("k")).toBe("v");
    t.advance(1);
    expect(c.getStale("k")).toBe("v");
    expect(c.get("k")).toBeUndefined();
    /** A fresh read drops the expired entry. */
    expect(c.getStale("k")).toBeUndefined();
  });

  it("caches null as an answer, apart from a miss", () => {
    const c = new TtlCache<string, string | null>({ max: 10 });
    c.set("asked", null);
    expect(c.get("asked")).toBeNull();
    expect(c.has("asked")).toBe(true);
    expect(c.get("never")).toBeUndefined();
    expect(c.has("never")).toBe(false);
  });
});

describe("mapPool", () => {
  it("returns results in input order under bounded concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapPool([30, 10, 20, 0, 5], 2, async (ms, i) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, ms));
      inFlight--;
      return `${i}:${ms}`;
    });
    expect(out).toEqual(["0:30", "1:10", "2:20", "3:0", "4:5"]);
    expect(peak).toBe(2);
  });

  it("handles no items and a nonsense concurrency", async () => {
    expect(await mapPool([], 4, async () => 1)).toEqual([]);
    expect(await mapPool([1, 2], 0, async (n) => n * 2)).toEqual([2, 4]);
  });
});
