/**
 * Which Colonize pushes the window applies, and what it keeps by reference (audit 2026-10-22).
 *
 * The window had its own, narrower "did anything change" signature than the server's, so pushes the server sent on
 * purpose (a carrier, the wing, the end of a replay, an error, a colony) were thrown away until a jump or a dock.
 * And carriers, the dock and the colonies came new with every push, so the haul plan was rebuilt on every jump.
 */
import { describe, expect, it } from "vitest";
import { emptyCarrierStock } from "../../src/shared/colonize/carrierStock";
import { colonizeSnapshotNotifySig } from "../../src/shared/colonize/snapshotNotifySig";
import type { ColonizeSnapshot, DepotSnapshot } from "../../src/shared/colonize/types";
import { colonizeWindowSnapSig, stabilizeSnapshot } from "../../src/client/colonize/hooks/snapshotStability";
import { colonizeSnapshotNotifySig as serverSig } from "../../src/server/colonize/ipc/snapshotNotify";

const depot = (marketId: string): DepotSnapshot => ({
  marketId,
  starSystem: "Sol",
  systemAddress: 1,
  stationName: "Site",
  constructionSiteLabel: "Site",
  progress: 1,
  complete: true,
  failed: false,
  lastTimestamp: "2026-10-20T10:00:00Z",
  resources: [],
  contributions: [],
});

function snap(over: Partial<ColonizeSnapshot> = {}): ColonizeSnapshot {
  return {
    ownColonies: [],
    journalDir: "J",
    journalDirConfigured: true,
    edsmApiKeyPresent: false,
    wingRoster: [],
    carriers: [{ ...emptyCarrierStock("3700000001"), reportedTons: 500, lastEventIso: "2026-10-20T09:00:00Z" }],
    liveJournalPath: null,
    activeDepots: [],
    completedDepots: [],
    archivedDepots: [],
    liveDocked: { marketId: "9", stationName: "Port", starSystem: "Sol", timestamp: "2026-10-20T10:00:00Z" },
    navContext: { starSystem: "Sol", systemAddress: 1 },
    lastDockedEconomy: null,
    shipCargo: [],
    shipCargoTimestamp: null,
    shipCargoCapacity: 80,
    dockMarket: { marketId: "9", stationName: "Port", starSystem: "Sol", timestamp: "2026-10-20T10:00:00Z", rowCount: 3 },
    journalShopHistory: [],
    replayBusy: false,
    lastError: null,
    ...over,
  };
}

describe("the window's push signature", () => {
  const base = snap();
  const changed: [string, ColonizeSnapshot][] = [
    ["a carrier's tonnage alone", snap({ carriers: [{ ...base.carriers[0]!, reportedTons: 547 }] })],
    ["the wing, at the same size", snap({ wingRoster: [{ commanderName: "Other", lastSeenIso: "x" }] })],
    ["the end of a replay", snap({ replayBusy: true })],
    ["an error", snap({ lastError: "The journal folder is gone." })],
    ["a new colony", snap({ ownColonies: [{ name: "Sol", systemAddress: 1, claimedAt: "2026-10-20T10:00:00Z" }] })],
    ["a finished site put away", snap({ archivedDepots: [depot("1")] })],
    ["the station docked at, by name", snap({ liveDocked: { ...base.liveDocked!, stationName: "Other Port" } })],
  ];

  it("is the same for the same snapshot", () => {
    expect(colonizeWindowSnapSig(snap())).toBe(colonizeWindowSnapSig(structuredClone(base)));
  });

  it.each(changed)("changes for %s", (_what, next) => {
    expect(colonizeWindowSnapSig(next)).not.toBe(colonizeWindowSnapSig(base));
  });

  it("covers everything the server pushes for: one rule, re-exported for the server", () => {
    expect(serverSig).toBe(colonizeSnapshotNotifySig);
    const wing = (names: string[]) => snap({ wingRoster: names.map((commanderName) => ({ commanderName, lastSeenIso: "x" })) });
    // One mate leaving as another joins keeps the count; the server used to send only the count.
    expect(serverSig(wing(["A"]))).not.toBe(serverSig(wing(["B"])));
  });
});

describe("stabilizeSnapshot", () => {
  it("keeps carriers, the dock, its market, the colonies and the position when they did not change", () => {
    const prev = snap({ ownColonies: [{ name: "Sol", systemAddress: 1, claimedAt: "2026-10-20T10:00:00Z" }] });
    const next = stabilizeSnapshot(prev, structuredClone(prev));
    expect(next.carriers).toBe(prev.carriers);
    expect(next.liveDocked).toBe(prev.liveDocked);
    expect(next.dockMarket).toBe(prev.dockMarket);
    expect(next.ownColonies).toBe(prev.ownColonies);
    expect(next.navContext).toBe(prev.navContext);
  });

  it("keeps an empty carrier list too (the server sends a new [] every time)", () => {
    const prev = snap({ carriers: [] });
    expect(stabilizeSnapshot(prev, snap({ carriers: [] })).carriers).toBe(prev.carriers);
  });

  it("takes the new value when it changed", () => {
    const prev = snap();
    const moved = snap({ carriers: [{ ...prev.carriers[0]!, reportedTons: 600 }], liveDocked: null });
    const next = stabilizeSnapshot(prev, moved);
    expect(next.carriers).not.toBe(prev.carriers);
    expect(next.carriers[0]!.reportedTons).toBe(600);
    expect(next.liveDocked).toBeNull();
  });
});
