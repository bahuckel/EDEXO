import { describe, expect, it } from "vitest";
import {
  applyCargoTransfer,
  applyCarrierStats,
  carrierAvailability,
  carrierTonsFor,
  derivedTons,
  emptyCarrierStock,
  mergeAvailability,
  parseCarrierKind,
  unattributedTons,
  type CarrierStock,
} from "../../src/shared/colonize/carrierStock";

/** The shape real journals emit, trimmed to what we read (id and name made up). */
const statsEvent = (over: Record<string, unknown> = {}) => ({
  timestamp: "2026-09-21T02:04:21Z",
  event: "CarrierStats",
  CarrierID: 3799000101,
  CarrierType: "FleetCarrier",
  Callsign: "X9X-01A",
  Name: "EXAMPLE HAULER",
  SpaceUsage: { TotalCapacity: 25000, Cargo: 547, FreeSpace: 23703 },
  ...over,
});

function stockWith(tons: Record<string, number>): CarrierStock {
  const c = emptyCarrierStock("1");
  c.tonsByCommodity = { ...tons };
  return c;
}

describe("carrier identity", () => {
  it("reads the type the journal reports", () => {
    expect(parseCarrierKind("FleetCarrier")).toBe("fleet");
    expect(parseCarrierKind("SquadronCarrier")).toBe("squadron");
  });

  it("keeps a carrier it cannot classify rather than dropping it", () => {
    expect(parseCarrierKind("SomethingFrontierShipsLater")).toBe("unknown");
    expect(parseCarrierKind(undefined)).toBe("unknown");
    expect(parseCarrierKind("")).toBe("unknown");
  });

  it("takes name, callsign, capacity and the reported total from CarrierStats", () => {
    const c = emptyCarrierStock("3799000101");
    expect(applyCarrierStats(c, statsEvent())).toBe(true);
    expect(c.kind).toBe("fleet");
    expect(c.name).toBe("EXAMPLE HAULER");
    expect(c.callsign).toBe("X9X-01A");
    expect(c.reportedTons).toBe(547);
    expect(c.capacityTons).toBe(25000);
  });

  it("does not downgrade a known type to unknown", () => {
    const c = emptyCarrierStock("1");
    applyCarrierStats(c, statsEvent());
    applyCarrierStats(c, statsEvent({ CarrierType: undefined }));
    expect(c.kind).toBe("fleet");
  });

  it("reports no change when a repeated event says the same thing", () => {
    const c = emptyCarrierStock("1");
    applyCarrierStats(c, statsEvent());
    expect(applyCarrierStats(c, statsEvent())).toBe(false);
  });
});

describe("accumulating transfers", () => {
  it("adds what goes to the carrier and removes what comes back", () => {
    const c = emptyCarrierStock("1");
    applyCargoTransfer(
      c,
      [
        { Type: "steel", Count: 274, Direction: "tocarrier" },
        { Type: "steel", Count: 37, Direction: "tocarrier" },
      ],
      "2026-09-21T00:00:00Z",
    );
    expect(derivedTons(c)).toBe(311);
    applyCargoTransfer(c, [{ Type: "steel", Count: 11, Direction: "toship" }], null);
    expect(derivedTons(c)).toBe(300);
  });

  it("drops a commodity once it is all gone rather than keeping a zero", () => {
    const c = emptyCarrierStock("1");
    applyCargoTransfer(c, [{ Type: "steel", Count: 20, Direction: "tocarrier" }], null);
    applyCargoTransfer(c, [{ Type: "steel", Count: 20, Direction: "toship" }], null);
    expect(c.tonsByCommodity).toEqual({});
    expect(c.labels).toEqual({});
  });

  it("never goes negative when the window starts after the loading did", () => {
    const c = emptyCarrierStock("1");
    applyCargoTransfer(c, [{ Type: "steel", Count: 90, Direction: "toship" }], null);
    expect(derivedTons(c)).toBe(0);
    expect(c.tonsByCommodity.steel).toBeUndefined();
  });

  it("ignores SRV legs and anything malformed", () => {
    const c = emptyCarrierStock("1");
    const changed = applyCargoTransfer(
      c,
      [
        { Type: "steel", Count: 5, Direction: "tosrv" },
        { Type: "", Count: 5, Direction: "tocarrier" },
        { Type: "steel", Count: 0, Direction: "tocarrier" },
        { Type: "steel", Count: -5, Direction: "tocarrier" },
        "nonsense",
      ],
      null,
    );
    expect(changed).toBe(false);
    expect(c.tonsByCommodity).toEqual({});
  });

  it("keys a transfer the same way a construction need is keyed", () => {
    const c = emptyCarrierStock("1");
    applyCargoTransfer(
      c,
      [{ Type: "cmmcomposite", Type_Localised: "CMM Composite", Count: 100, Direction: "tocarrier" }],
      null,
    );
    const [id] = Object.keys(c.tonsByCommodity);
    expect(id).toBeTruthy();
    expect(carrierTonsFor([c], id!)[0]?.tons).toBe(100);
    expect(c.labels[id!]).toBe("CMM Composite");
  });
});

describe("what we admit we do not know", () => {
  it("reports the gap between the carrier's own total and what transfers explain", () => {
    const c = emptyCarrierStock("1");
    applyCarrierStats(c, statsEvent());
    applyCargoTransfer(c, [{ Type: "steel", Count: 500, Direction: "tocarrier" }], null);
    // 547 reported, 500 accounted for: 47 t was loaded before the replay window.
    expect(unattributedTons(c)).toBe(47);
  });

  it("keeps the sign when we have counted more than the carrier admits holding", () => {
    const c = emptyCarrierStock("1");
    applyCarrierStats(c, statsEvent({ SpaceUsage: { TotalCapacity: 25000, Cargo: 100 } }));
    applyCargoTransfer(c, [{ Type: "steel", Count: 150, Direction: "tocarrier" }], null);
    expect(unattributedTons(c)).toBe(-50);
  });

  it("says nothing at all before any CarrierStats has been seen", () => {
    expect(unattributedTons(emptyCarrierStock("1"))).toBeNull();
  });
});

describe("availability", () => {
  const a = { ...stockWith({ steel: 300, titanium: 40 }), carrierId: "a" };
  const b = { ...stockWith({ steel: 120 }), carrierId: "b" };

  it("counts only the carriers that are switched on", () => {
    expect([...carrierAvailability([a, b], new Set()).entries()]).toEqual([]);
    expect(carrierAvailability([a, b], new Set(["a"])).get("steel")).toBe(300);
    expect(carrierAvailability([a, b], new Set(["a", "b"])).get("steel")).toBe(420);
  });

  it("adds to the ship hold without touching it", () => {
    const ship = new Map([["steel", 256]]);
    const merged = mergeAvailability(ship, carrierAvailability([a], new Set(["a"])));
    expect(merged.get("steel")).toBe(556);
    expect(merged.get("titanium")).toBe(40);
    expect(ship.get("steel")).toBe(256);
    expect(ship.has("titanium")).toBe(false);
  });

  it("returns the ship hold itself when no carrier is hauling", () => {
    const ship = new Map([["steel", 256]]);
    expect(mergeAvailability(ship, new Map())).toBe(ship);
  });

  it("breaks one commodity down per carrier for the hover", () => {
    const rows = carrierTonsFor([a, b], "steel");
    expect(rows.map((r) => [r.carrierId, r.tons])).toEqual([
      ["a", 300],
      ["b", 120],
    ]);
    expect(carrierTonsFor([a, b], "gold")).toEqual([]);
  });
});
