import { describe, expect, it } from "vitest";
import { derivedTons, unattributedTons } from "../../../src/shared/colonize/carrierStock";
import {
  applyJournalLine,
  createJournalState,
  ownedCarrierStocks,
  type JournalState,
} from "../../../src/server/colonize/journalEvents";

/** The commander's own carrier (made-up id and name; the event shapes are real). */
const MINE = 3_799_000_101;
/** A carrier belonging to someone else, docked at in passing. */
const THEIRS = 3_799_000_202;

const line = (o: Record<string, unknown>) => JSON.stringify(o);

const stats = (over: Record<string, unknown> = {}) => ({
  event: "CarrierStats",
  timestamp: "2026-09-21T02:04:21Z",
  CarrierID: MINE,
  CarrierType: "FleetCarrier",
  Callsign: "X9X-01A",
  Name: "EXAMPLE HAULER",
  SpaceUsage: { TotalCapacity: 25000, Cargo: 547, FreeSpace: 23703 },
  ...over,
});

const dock = (marketId: number, stationName: string, stationType: string) => ({
  event: "Docked",
  timestamp: "2026-09-21T02:00:00Z",
  MarketID: marketId,
  StationName: stationName,
  StationType: stationType,
  StarSystem: "Mizar",
});

const SESSION: Record<string, unknown>[] = [
  { event: "Location", timestamp: "2026-09-21T01:00:00Z", StarSystem: "Mizar", SystemAddress: 259008758964 },
  stats(),
  dock(MINE, "X9X-01A", "FleetCarrier"),
  {
    event: "CargoTransfer",
    timestamp: "2026-09-21T02:05:00Z",
    Transfers: [
      { Type: "steel", Count: 274, Direction: "tocarrier" },
      { Type: "steel", Count: 37, Direction: "tocarrier" },
    ],
  },
  {
    event: "CargoTransfer",
    timestamp: "2026-09-21T02:06:00Z",
    Transfers: [{ Type: "cmmcomposite", Type_Localised: "CMM Composite", Count: 60, Direction: "tocarrier" }],
  },
  { event: "Undocked", timestamp: "2026-09-21T02:10:00Z", MarketID: MINE },
];

function replay(events: Record<string, unknown>[]): JournalState {
  const state = createJournalState();
  for (const e of events) applyJournalLine(state, line(e));
  return state;
}

describe("carrier stock from the journal", () => {
  it("attributes transfers to the carrier you are docked at", () => {
    const [carrier, ...rest] = ownedCarrierStocks(replay(SESSION));
    expect(rest).toHaveLength(0);
    expect(carrier?.callsign).toBe("X9X-01A");
    expect(carrier?.name).toBe("EXAMPLE HAULER");
    expect(carrier?.kind).toBe("fleet");
    expect(derivedTons(carrier!)).toBe(371);
  });

  it("says how much of the carrier's own total it cannot explain", () => {
    const [carrier] = ownedCarrierStocks(replay(SESSION));
    // 547 t reported by CarrierStats, 371 t of transfers in the window.
    expect(carrier?.reportedTons).toBe(547);
    expect(unattributedTons(carrier!)).toBe(176);
  });

  it("is idempotent: replaying the same journal twice gives the same tonnage", () => {
    const once = ownedCarrierStocks(replay(SESSION));
    const twice = ownedCarrierStocks(replay([...SESSION]));
    expect(derivedTons(twice[0]!)).toBe(derivedTons(once[0]!));
    expect(derivedTons(once[0]!)).toBe(371);
  });

  it("never surfaces a carrier that is not yours", () => {
    const state = replay([
      { event: "Location", timestamp: "2026-09-21T01:00:00Z", StarSystem: "Mizar", SystemAddress: 1 },
      dock(THEIRS, "VHN-7QB", "FleetCarrier"),
      {
        event: "CargoTransfer",
        timestamp: "2026-09-21T02:05:00Z",
        Transfers: [{ Type: "steel", Count: 500, Direction: "tocarrier" }],
      },
    ]);
    // The tonnage is recorded — we cannot know yet whose carrier it is — but it is never reported.
    expect(ownedCarrierStocks(state)).toEqual([]);
    expect(state.carriers[String(THEIRS)]).toBeDefined();
  });

  it("stops attributing transfers once you undock", () => {
    const state = replay([
      ...SESSION,
      {
        event: "CargoTransfer",
        timestamp: "2026-09-21T02:11:00Z",
        Transfers: [{ Type: "steel", Count: 999, Direction: "tocarrier" }],
      },
    ]);
    expect(derivedTons(ownedCarrierStocks(state)[0]!)).toBe(371);
  });

  it("does not credit a station that is not a carrier", () => {
    const state = replay([
      stats(),
      dock(3_230_679_808, "Metz Enterprise", "Coriolis"),
      {
        event: "CargoTransfer",
        timestamp: "2026-09-21T02:05:00Z",
        Transfers: [{ Type: "steel", Count: 42, Direction: "tocarrier" }],
      },
    ]);
    expect(derivedTons(ownedCarrierStocks(state)[0]!)).toBe(0);
  });

  it("takes cargo back off the carrier when it is transferred to the ship", () => {
    const state = replay([
      ...SESSION.slice(0, 5),
      {
        event: "CargoTransfer",
        timestamp: "2026-09-21T02:07:00Z",
        Transfers: [{ Type: "steel", Count: 111, Direction: "toship" }],
      },
    ]);
    expect(derivedTons(ownedCarrierStocks(state)[0]!)).toBe(260);
  });
});
