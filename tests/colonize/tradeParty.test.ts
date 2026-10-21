import { describe, expect, it } from "vitest";
import { resourceNeedId } from "../../src/shared/colonize/commodityKey";
import {
  addPartyMember,
  normalizeCallsign,
  ordersForNeeds,
  parseSpanshCarrier,
  removePartyMember,
} from "../../src/shared/colonize/tradeParty";

describe("normalizeCallsign", () => {
  it("accepts the usual spellings and rejects anything else", () => {
    expect(normalizeCallsign(" x9x-01a ")).toBe("X9X-01A");
    expect(normalizeCallsign("x9x01a")).toBe("X9X-01A");
    expect(normalizeCallsign("X9X-01")).toBeNull();
    expect(normalizeCallsign("Example Hauler")).toBeNull();
  });
});

/** Shaped like a Spansh `stations/search` response for a carrier (made-up callsigns). */
const spansh = {
  results: [
    {
      name: "X9X-01A",
      type: "Drake-Class Carrier",
      market_id: 3799000101,
      system_name: "Examplia AB-C d1-2",
      distance: 42.5,
      updated_at: "2026-09-29T05:00:00Z",
      market_updated_at: "2026-09-29T04:00:00Z",
      market: [
        { commodity: "Steel", supply: 18000, buy_price: 3000, demand: 0, sell_price: 0 },
        { commodity: "CMM Composite", supply: 400, buy_price: 6000, demand: 0, sell_price: 0 },
        { commodity: "Aluminium", supply: 0, buy_price: 12715, demand: 0, sell_price: 0 },
        { commodity: "Gold", supply: 0, buy_price: 0, demand: 250, sell_price: 45000 },
      ],
    },
    // A name search also returns near misses.
    { name: "X9X-01B", type: "Drake-Class Carrier", market_id: 3799000102, system_name: "Elsewhere" },
  ],
};

describe("parseSpanshCarrier", () => {
  it("reads the exact callsign's location and orders, skipping listed commodities with no order", () => {
    const c = parseSpanshCarrier(spansh, "X9X-01A");
    expect(c).toMatchObject({
      found: true,
      marketId: "3799000101",
      systemName: "Examplia AB-C d1-2",
      distanceLy: 42.5,
      locationAt: "2026-09-29T05:00:00Z",
    });
    expect(c.selling.map((o) => [o.label, o.tons, o.price])).toEqual([
      ["Steel", 18000, 3000],
      ["CMM Composite", 400, 6000],
    ]);
    expect(c.buying.map((o) => [o.label, o.tons, o.price])).toEqual([["Gold", 250, 45000]]);
  });

  it("does not mistake a near miss for the carrier asked about", () => {
    expect(parseSpanshCarrier(spansh, "X9X-01C").found).toBe(false);
    expect(parseSpanshCarrier(null, "X9X-01A").found).toBe(false);
  });

  it("uses the planner's commodity ids, so orders can be matched to what sites need", () => {
    const c = parseSpanshCarrier(spansh, "X9X-01A");
    const need = new Set([resourceNeedId({ name: "CMMComposite" })]);
    expect(ordersForNeeds(c, need).map((o) => o.label)).toEqual(["CMM Composite"]);
  });
});

describe("the party list", () => {
  const now = new Date("2026-09-29T00:00:00Z");

  it("adds a callsign once, updates its note, and removes it", () => {
    let party = addPartyMember([], "x9x01a", "  Alice  ", now);
    expect(party).toEqual([{ callsign: "X9X-01A", note: "Alice", addedAt: "2026-09-29T00:00:00.000Z" }]);
    party = addPartyMember(party, "X9X-01A", "", now);
    expect(party).toHaveLength(1);
    expect(party[0]!.note).toBe("Alice");
    party = addPartyMember(party, "X9X-01A", "Alice's hauler", now);
    expect(party[0]!.note).toBe("Alice's hauler");
    expect(addPartyMember(party, "not a callsign", "", now)).toBe(party);
    expect(removePartyMember(party, "X9X-01A")).toEqual([]);
  });
});
