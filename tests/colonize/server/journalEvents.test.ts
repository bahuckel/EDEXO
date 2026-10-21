import { describe, expect, it } from "vitest";
import { applyJournalLine, createJournalState, type JournalState } from "../../../src/server/colonize/journalEvents";

const MARKET_ID = 3_700_000_001;
const SITE = "Orbital Construction Site: Hutton Halt";

/**
 * A short but representative session: arrive, dock at a construction site, watch three depot
 * updates land, deliver something, form a wing, and stow cargo.
 */
const SESSION: Record<string, unknown>[] = [
  { event: "Location", timestamp: "2026-09-01T10:00:00Z", StarSystem: "Examplia AB-C d1-2", SystemAddress: 1234 },
  {
    event: "Docked",
    timestamp: "2026-09-01T10:01:00Z",
    MarketID: MARKET_ID,
    StationName: SITE,
    StarSystem: "Examplia AB-C d1-2",
  },
  {
    event: "ColonisationConstructionDepot",
    timestamp: "2026-09-01T10:02:00Z",
    MarketID: MARKET_ID,
    StationName: SITE,
    ConstructionProgress: 0.1,
    ResourcesRequired: [
      { Name: "Steel", Name_Localised: "Steel", RequiredAmount: 1000, ProvidedAmount: 100, Payment: 5000 },
      { Name: "CMMComposite", Name_Localised: "CMM Composite", RequiredAmount: 500, ProvidedAmount: 0, Payment: 9000 },
    ],
  },
  {
    event: "ColonisationContribution",
    timestamp: "2026-09-01T10:03:00Z",
    MarketID: MARKET_ID,
    StationName: SITE,
    Contributions: [{ Name: "Steel", Name_Localised: "Steel", Amount: 80 }],
  },
  {
    event: "ColonisationConstructionDepot",
    timestamp: "2026-09-01T10:04:00Z",
    MarketID: MARKET_ID,
    StationName: SITE,
    ConstructionProgress: 0.2,
    ResourcesRequired: [
      { Name: "Steel", Name_Localised: "Steel", RequiredAmount: 1000, ProvidedAmount: 180, Payment: 5000 },
      { Name: "CMMComposite", Name_Localised: "CMM Composite", RequiredAmount: 500, ProvidedAmount: 0, Payment: 9000 },
    ],
  },
  {
    event: "ColonisationContribution",
    timestamp: "2026-09-01T10:05:00Z",
    MarketID: MARKET_ID,
    StationName: SITE,
    Contributions: [{ Name: "Steel", Name_Localised: "Steel", Amount: 20 }],
  },
  {
    event: "ColonisationConstructionDepot",
    timestamp: "2026-09-01T10:06:00Z",
    MarketID: MARKET_ID,
    StationName: SITE,
    ConstructionProgress: 0.25,
    ResourcesRequired: [
      { Name: "Steel", Name_Localised: "Steel", RequiredAmount: 1000, ProvidedAmount: 200, Payment: 5000 },
      { Name: "CMMComposite", Name_Localised: "CMM Composite", RequiredAmount: 500, ProvidedAmount: 0, Payment: 9000 },
    ],
  },
  { event: "WingJoin", timestamp: "2026-09-01T10:07:00Z", Others: ["Alpha", "Bravo"] },
  { event: "WingAdd", timestamp: "2026-09-01T10:08:00Z", Name: "Charlie" },
  // The hold's size is in Loadout; the game's Cargo event has no capacity field.
  { event: "Loadout", timestamp: "2026-09-01T10:08:30Z", Ship: "type9", CargoCapacity: 256 },
  {
    event: "Cargo",
    timestamp: "2026-09-01T10:09:00Z",
    Vessel: "Ship",
    Count: 96,
    Inventory: [{ Name: "steel", Name_Localised: "Steel", Count: 96 }],
  },
];

function replay(state: JournalState, lines = SESSION): void {
  for (const line of lines) applyJournalLine(state, JSON.stringify(line));
}

function steelContribution(state: JournalState): number {
  const depot = state.depots[String(MARKET_ID)]!;
  return depot.contributions.reduce((sum, c) => sum + c.totalTons, 0);
}

describe("applyJournalLine", () => {
  it("builds the depot a commander is working on", () => {
    const state = createJournalState();
    replay(state);

    const depot = state.depots[String(MARKET_ID)]!;
    expect(depot).toBeDefined();
    expect(depot.engaged).toBe(true);
    expect(depot.starSystem).toBe("Examplia AB-C d1-2");
    expect(depot.constructionSiteLabel).toBe("Hutton Halt");
    expect(depot.progress).toBeCloseTo(0.25, 5);
    expect(depot.resources).toHaveLength(2);
    expect(depot.resources.find((r) => r.name === "Steel")?.provided).toBe(200);
  });

  it("totals the commander's own deliveries", () => {
    const state = createJournalState();
    replay(state);
    expect(steelContribution(state)).toBe(100);
  });

  it("records a progress sample per distinct reading", () => {
    const state = createJournalState();
    replay(state);
    const depot = state.depots[String(MARKET_ID)]!;
    expect(depot.progressHistory.map((p) => p.progress)).toEqual([0.1, 0.2, 0.25]);
  });

  it("tracks the wing across WingJoin and WingAdd", () => {
    const state = createJournalState();
    replay(state);
    expect(state.wingRoster.map((w) => w.commanderName)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("reads the hold", () => {
    const state = createJournalState();
    replay(state);
    expect(state.shipCargoCapacity).toBe(256);
    expect(state.shipCargoByName.get("steel")?.count).toBe(96);
  });

  it("takes the hold's size from Loadout and keeps it through Cargo events, which carry none", () => {
    const state = createJournalState();
    replay(state);
    applyJournalLine(
      state,
      JSON.stringify({ event: "Cargo", timestamp: "2026-09-01T11:00:00Z", Vessel: "Ship", Count: 0, Inventory: [] }),
    );
    expect(state.shipCargoCapacity).toBe(256);
    // A refit (or a ship swap) writes a new Loadout; a ship with no racks reads as unknown.
    applyJournalLine(state, JSON.stringify({ event: "Loadout", timestamp: "2026-09-01T12:00:00Z", Ship: "mandalay", CargoCapacity: 80 }));
    expect(state.shipCargoCapacity).toBe(80);
    applyJournalLine(state, JSON.stringify({ event: "Loadout", timestamp: "2026-09-01T13:00:00Z", Ship: "mandalay", CargoCapacity: 0 }));
    expect(state.shipCargoCapacity).toBeNull();
  });
});

describe("replaying the same journal is idempotent", () => {
  /**
   * This is the regression guard for the two defects behind it: replays were not serialised,
   * so a "replay rolling week" during startup ran the same lines twice and every contribution
   * was counted twice; and each replay wiped the history first, so anything older than the
   * seven-day window was destroyed on launch. Contributions are a running sum, so re-reading a
   * line must add nothing.
   */
  it("does not double-count contributions", () => {
    const once = createJournalState();
    replay(once);

    const twice = createJournalState();
    replay(twice);
    replay(twice);

    expect(steelContribution(twice)).toBe(steelContribution(once));
    expect(steelContribution(twice)).toBe(100);
  });

  it("does not duplicate progress history", () => {
    const twice = createJournalState();
    replay(twice);
    replay(twice);
    const depot = twice.depots[String(MARKET_ID)]!;
    expect(depot.progressHistory.map((p) => p.progress)).toEqual([0.1, 0.2, 0.25]);
  });

  it("keeps contributions recorded before the replayed window", () => {
    // What survives a launch: totals already on disk, with only newer lines added on top.
    const state = createJournalState();
    replay(state);
    const before = steelContribution(state);

    // A later session replays the same window plus one new delivery.
    replay(state);
    applyJournalLine(
      state,
      JSON.stringify({
        event: "ColonisationContribution",
        timestamp: "2026-09-02T09:00:00Z",
        MarketID: MARKET_ID,
        StationName: SITE,
        Contributions: [{ Name: "Steel", Name_Localised: "Steel", Amount: 40 }],
      }),
    );

    expect(steelContribution(state)).toBe(before + 40);
  });
});

describe("persistGen — what the store has to write to disk (PERF-M3)", () => {
  const line = (j: Record<string, unknown>) => JSON.stringify(j);

  it("moves for depot and journal-shop changes", () => {
    const state = createJournalState();
    replay(state);
    let gen = state.persistGen;
    expect(gen).toBeGreaterThan(0);

    applyJournalLine(
      state,
      line({
        event: "ColonisationContribution",
        timestamp: "2026-09-02T09:00:00Z",
        MarketID: MARKET_ID,
        StationName: SITE,
        Contributions: [{ Name: "Steel", Name_Localised: "Steel", Amount: 10 }],
      }),
    );
    expect(state.persistGen).toBeGreaterThan(gen);

    gen = state.persistGen;
    applyJournalLine(
      state,
      line({
        event: "Market",
        timestamp: "2026-09-02T09:10:00Z",
        MarketID: 128_000_001,
        StationName: "Some Refinery",
        StarSystem: "HIP 87696",
      }),
    );
    expect(state.persistGen).toBeGreaterThan(gen);
  });

  it("ignores a depot update that only moved the clock", () => {
    const state = createJournalState();
    replay(state);
    const last = SESSION.filter((j) => j.event === "ColonisationConstructionDepot").at(-1)!;
    const gen = state.persistGen;
    applyJournalLine(state, line({ ...last, timestamp: "2026-09-01T10:06:15Z" }));
    applyJournalLine(state, line({ ...last, timestamp: "2026-09-01T10:06:30Z" }));
    expect(state.persistGen).toBe(gen);
    expect(state.depots[String(MARKET_ID)]!.lastTimestamp).toBe("2026-09-01T10:06:30Z");

    applyJournalLine(state, line({ ...last, timestamp: "2026-09-01T10:07:00Z", ConstructionProgress: 0.3 }));
    expect(state.persistGen).toBeGreaterThan(gen);
  });

  it("stays put while trading, docking elsewhere and flying in a wing", () => {
    const state = createJournalState();
    replay(state);
    const gen = state.persistGen;
    const mutation = state.mutationGen;

    for (const j of [
      {
        event: "Cargo",
        timestamp: "2026-09-02T10:00:00Z",
        Vessel: "Ship",
        Count: 100,
        Inventory: [{ Name: "steel", Name_Localised: "Steel", Count: 100 }],
      },
      {
        event: "Docked",
        timestamp: "2026-09-02T10:01:00Z",
        MarketID: 128_000_002,
        StationName: "Plain Old Station",
        StarSystem: "HIP 87696",
        StationType: "Coriolis",
      },
      { event: "Undocked", timestamp: "2026-09-02T10:02:00Z" },
      { event: "WingLeave", timestamp: "2026-09-02T10:03:00Z" },
      { event: "FSDJump", timestamp: "2026-09-02T10:04:00Z", StarSystem: "Sol", SystemAddress: 10477373803 },
    ]) {
      applyJournalLine(state, line(j));
    }

    /** The screen still has to change… */
    expect(state.mutationGen).toBeGreaterThan(mutation);
    /** …but the state file does not. */
    expect(state.persistGen).toBe(gen);
  });
});
