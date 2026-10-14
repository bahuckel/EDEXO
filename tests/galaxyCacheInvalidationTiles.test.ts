/**
 * The tile index and the overview points, cleared while their build waits on the bio index (code review,
 * 2026-10-14): callers after the clear joined the old build, and the overview put the old result back.
 * The bio index is a stand-in here whose reads the test finishes by hand.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const reads: { resolve: (v: null) => void }[] = [];
vi.mock("../src/server/bioIndex.js", async (orig) => ({
  ...(await orig<typeof import("../src/server/bioIndex.js")>()),
  loadBioIndexAsync: vi.fn(
    () =>
      new Promise<null>((resolve) => {
        reads.push({ resolve });
      }),
  ),
}));

const { clearTileIndex, tileIndexAsync } = await import("../src/server/galaxyTiles.js");
const { clearGalaxyPoints, galaxyPointsAsync } = await import("../src/server/galaxyPoints.js");

beforeEach(() => {
  reads.length = 0;
  clearTileIndex();
  clearGalaxyPoints();
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the tile index, cleared while it is being built", () => {
  it("starts a new build for callers after the clear, and the old one is not kept", async () => {
    const old = tileIndexAsync();
    expect(tileIndexAsync()).toBe(old); // joined before the clear, as always
    clearTileIndex();
    const fresh = tileIndexAsync();
    expect(fresh).not.toBe(old);
    expect(reads).toHaveLength(2);
    reads[0]!.resolve(null);
    await old;
    await settle();
    // The old build ended without filling the cache or freeing the new one's slot.
    expect(tileIndexAsync()).toBe(fresh);
    reads[1]!.resolve(null);
    expect(await fresh).toBeNull();
  });
});

describe("the overview points, cleared while they are being built", () => {
  it("start a new build for callers after the clear, and the old one is not kept", async () => {
    const old = galaxyPointsAsync(4);
    clearGalaxyPoints();
    const fresh = galaxyPointsAsync(4);
    expect(fresh).not.toBe(old);
    reads[0]!.resolve(null);
    await old;
    await settle();
    expect(galaxyPointsAsync(4)).toBe(fresh);
    reads[1]!.resolve(null);
    expect(await fresh).toBeNull();
  });
});
