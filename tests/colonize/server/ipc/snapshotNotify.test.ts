import { describe, expect, it } from "vitest";
import { emptyCarrierStock } from "../../../../src/shared/colonize/carrierStock";
import type { ColonizeSnapshot } from "../../../../src/shared/colonize/types";
import { colonizeSnapshotNotifySig } from "../../../../src/server/colonize/ipc/snapshotNotify";

/** Only the fields the signature reads; the rest of a snapshot does not matter here. */
function snap(over: Partial<ColonizeSnapshot> = {}): ColonizeSnapshot {
  return {
    journalDir: "J",
    navContext: { starSystem: "Sol", systemAddress: 1 },
    activeDepots: [],
    liveDocked: null,
    shipCargoTimestamp: null,
    shipCargo: [],
    shipCargoCapacity: null,
    dockMarket: null,
    journalShopHistory: [],
    replayBusy: false,
    wingRoster: [],
    carriers: [],
    lastError: null,
    ...over,
  } as ColonizeSnapshot;
}

describe("colonizeSnapshotNotifySig", () => {
  it("is stable for an unchanged snapshot", () => {
    expect(colonizeSnapshotNotifySig(snap())).toBe(colonizeSnapshotNotifySig(snap()));
  });

  it("changes when only a carrier changes", () => {
    const carrier = { ...emptyCarrierStock("3799000101"), reportedTons: 500, lastEventIso: "2026-09-21T02:00:00Z" };
    const before = colonizeSnapshotNotifySig(snap({ carriers: [carrier] }));
    const after = colonizeSnapshotNotifySig(
      snap({ carriers: [{ ...carrier, reportedTons: 547, lastEventIso: "2026-09-21T02:04:21Z" }] }),
    );
    expect(after).not.toBe(before);
    expect(colonizeSnapshotNotifySig(snap({ carriers: [carrier] }))).not.toBe(colonizeSnapshotNotifySig(snap()));
  });

  it("changes when the replay finishes", () => {
    expect(colonizeSnapshotNotifySig(snap({ replayBusy: true }))).not.toBe(colonizeSnapshotNotifySig(snap()));
  });
});
