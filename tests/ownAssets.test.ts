/**
 * The commander's own carrier and colonies from the journal (shared/ownAssets.ts; owner, 2026-10-13): the galaxy
 * map's badges.
 */
import { describe, expect, it } from "vitest";
import { hydrateOwnAssets, newOwnAssets, ownAssetsLine, ownCarrierNow } from "../src/shared/ownAssets.js";

const ev = (event: string, o: Record<string, unknown> = {}) => ({
  event,
  timestamp: "2026-10-13T00:00:00Z",
  ...o,
});

describe("own carrier and colonies", () => {
  it("places the carrier from CarrierLocation, and at a requested system once its jump has had time", () => {
    const st = newOwnAssets();
    ownAssetsLine(
      st,
      ev("CarrierLocation", {
        CarrierType: "FleetCarrier",
        StarSystem: "Col 285 Sector DR-C c13-20",
        SystemAddress: 1,
      }),
    );
    expect(ownCarrierNow(st)?.name).toBe("Col 285 Sector DR-C c13-20");
    // A squadron's carrier is not his.
    ownAssetsLine(
      st,
      ev("CarrierLocation", { CarrierType: "SquadronCarrier", StarSystem: "Elsewhere", SystemAddress: 9 }),
    );
    expect(ownCarrierNow(st)?.name).toBe("Col 285 Sector DR-C c13-20");
    ownAssetsLine(
      st,
      ev("CarrierJumpRequest", {
        SystemName: "Swoilz KI-E b4-9",
        SystemAddress: 2,
        DepartureTime: "2026-10-13T01:00:00Z",
      }),
    );
    expect(ownCarrierNow(st, Date.parse("2026-10-13T01:05:00Z"))?.name).toBe("Col 285 Sector DR-C c13-20");
    expect(ownCarrierNow(st, Date.parse("2026-10-13T01:30:00Z"))?.name).toBe("Swoilz KI-E b4-9");
    ownAssetsLine(st, ev("CarrierJumpCancelled"));
    expect(ownCarrierNow(st, Date.parse("2026-10-13T02:00:00Z"))?.name).toBe("Col 285 Sector DR-C c13-20");
  });

  it("keeps a jump that landed when the next is scheduled or cancelled, and a relog before departure (review 1.2.16)", () => {
    const st = newOwnAssets();
    const at = (t: string, o: Record<string, unknown>) => ({ ...o, timestamp: t });
    ownAssetsLine(
      st,
      at("2026-10-13T00:00:00Z", {
        event: "CarrierLocation",
        CarrierType: "FleetCarrier",
        StarSystem: "A",
        SystemAddress: 1,
      }),
    );
    ownAssetsLine(
      st,
      at("2026-10-13T00:10:00Z", {
        event: "CarrierJumpRequest",
        SystemName: "B",
        SystemAddress: 2,
        DepartureTime: "2026-10-13T00:30:00Z",
      }),
    );
    // B landed (00:30 + 20 min); now C is scheduled, then cancelled: the carrier is at B.
    ownAssetsLine(
      st,
      at("2026-10-13T02:00:00Z", {
        event: "CarrierJumpRequest",
        SystemName: "C",
        SystemAddress: 3,
        DepartureTime: "2026-10-13T02:20:00Z",
      }),
    );
    expect(ownCarrierNow(st, Date.parse("2026-10-13T02:05:00Z"))?.name).toBe("B");
    ownAssetsLine(st, at("2026-10-13T02:06:00Z", { event: "CarrierJumpCancelled" }));
    expect(ownCarrierNow(st, Date.parse("2026-10-13T03:00:00Z"))?.name).toBe("B");
    // A relog during a countdown: the jump stays scheduled and happens.
    ownAssetsLine(
      st,
      at("2026-10-13T04:00:00Z", {
        event: "CarrierJumpRequest",
        SystemName: "D",
        SystemAddress: 4,
        DepartureTime: "2026-10-13T04:20:00Z",
      }),
    );
    ownAssetsLine(
      st,
      at("2026-10-13T04:05:00Z", {
        event: "CarrierLocation",
        CarrierType: "FleetCarrier",
        StarSystem: "B",
        SystemAddress: 2,
      }),
    );
    expect(ownCarrierNow(st, Date.parse("2026-10-13T05:00:00Z"))?.name).toBe("D");
  });

  it("keeps the systems he claimed, once each, until he releases one", () => {
    const st = newOwnAssets();
    ownAssetsLine(st, ev("ColonisationSystemClaim", { StarSystem: "Swoilz KI-E b4-9", SystemAddress: 2 }));
    ownAssetsLine(st, ev("ColonisationSystemClaim", { StarSystem: "Swoilz KI-E b4-9", SystemAddress: 2 }));
    ownAssetsLine(st, ev("ColonisationBeaconDeployed"));
    ownAssetsLine(
      st,
      ev("ColonisationSystemClaim", { StarSystem: "Col 285 Sector DR-C c13-20", SystemAddress: 1 }),
    );
    expect(st.colonies.map((c) => c.name)).toEqual(["Swoilz KI-E b4-9", "Col 285 Sector DR-C c13-20"]);
    ownAssetsLine(
      st,
      ev("ColonisationSystemClaimRelease", { StarSystem: "Swoilz KI-E b4-9", SystemAddress: 2 }),
    );
    expect(st.colonies.map((c) => c.name)).toEqual(["Col 285 Sector DR-C c13-20"]);
  });

  it("reads back what it wrote, and nothing from anything else", () => {
    const st = newOwnAssets();
    ownAssetsLine(
      st,
      ev("CarrierLocation", { CarrierType: "FleetCarrier", StarSystem: "A", SystemAddress: 1 }),
    );
    ownAssetsLine(st, ev("ColonisationSystemClaim", { StarSystem: "B", SystemAddress: 2 }));
    expect(hydrateOwnAssets(structuredClone(st))).toEqual(st);
    expect(hydrateOwnAssets(null)).toEqual(newOwnAssets());
    expect(hydrateOwnAssets({ carrier: { name: 3 } })).toEqual(newOwnAssets());
  });
});
