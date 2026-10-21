/**
 * The one-time journal history pass (owner, 2026-10-21): on the first start for a journal folder, construction
 * sites from journals older than the 7-day window are read too, with the system they are in; old docking, cargo and
 * wings are not carried into the present; and the pass is not repeated once the folder is remembered.
 */
import { appendFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ColonizeStore } from "../../../src/server/colonize/colonizeStore";
import { readJournalEvents } from "../../../src/server/colonize/journalFs";

let journalDir: string;
let dataDir: string;
let store: ColonizeStore | null = null;
const dirs: string[] = [];

function journalName(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `Journal.${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}.01.log`;
}
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
const lines = (...objs: object[]) => objs.map((o) => JSON.stringify(o)).join("\r\n") + "\r\n";

const site = (marketId: number, name: string, progress: number, daysAgo: number) => [
  { timestamp: iso(daysAgo), event: "Docked", StationName: `Orbital Construction Site: ${name}`, MarketID: marketId, StarSystem: "Old Colony", SystemAddress: 77, StationType: "SpaceConstructionDepot" },
  {
    timestamp: iso(daysAgo),
    event: "ColonisationConstructionDepot",
    MarketID: marketId,
    ConstructionProgress: progress,
    ConstructionComplete: progress >= 1,
    ConstructionFailed: false,
    ResourcesRequired: [{ Name: "$steel_name;", Name_Localised: "Steel", RequiredAmount: 1000, ProvidedAmount: Math.round(progress * 1000), Payment: 5000 }],
  },
];

beforeEach(() => {
  journalDir = mkdtempSync(path.join(tmpdir(), "colonize-history-j-"));
  dataDir = mkdtempSync(path.join(tmpdir(), "colonize-history-d-"));
  dirs.push(journalDir, dataDir);
  writeFileSync(
    path.join(journalDir, journalName(40)),
    lines(
      { timestamp: iso(40), event: "Location", StarSystem: "Old Colony", SystemAddress: 77 },
      ...site(3_900_000_001, "Halfway Port", 0.5, 40),
      ...site(3_900_000_002, "Done Dock", 1, 40),
      { timestamp: iso(40), event: "WingJoin", Others: ["Old Friend"] },
      { timestamp: iso(40), event: "Cargo", Vessel: "Ship", Count: 5, Inventory: [{ Name: "steel", Count: 5 }] },
    ) + '{ "timestamp":"torn", "event":"ColonisationConstr',
  );
  writeFileSync(
    path.join(journalDir, journalName(0)),
    lines({ timestamp: iso(0), event: "FSDJump", StarSystem: "Here Now", SystemAddress: 5 }, { timestamp: iso(0), event: "Music", MusicTrack: "x" }),
  );
});

afterEach(async () => {
  await store?.shutdown();
  store = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

async function start(dir = journalDir): Promise<ColonizeStore> {
  const s = new ColonizeStore(dataDir, { journalDir: () => dir, edsmApiKey: () => null });
  await s.load();
  await s.restartTail();
  return s;
}

describe("the journal history pass", () => {
  it("finds sites older than a week, in their system, without bringing back old docking, cargo or wings", async () => {
    store = await start();
    const snap = store.getSnapshot();
    expect(snap.activeDepots.map((d) => [d.constructionSiteLabel, d.starSystem, d.progress])).toEqual([["Halfway Port", "Old Colony", 0.5]]);
    expect(snap.completedDepots.map((d) => d.constructionSiteLabel)).toEqual(["Done Dock"]);
    expect(snap.liveDocked).toBeNull();
    expect(snap.wingRoster).toEqual([]);
    expect(snap.shipCargo).toEqual([]);
    expect(snap.navContext.starSystem).toBe("Here Now");
  });

  it("runs once per journal folder", async () => {
    store = await start();
    await store.shutdown();
    store = null;
    expect(JSON.parse(readFileSync(path.join(dataDir, "edexo-colonize-state.json"), "utf8")).historyScannedDir).toBe(journalDir);

    // A site added to an old journal now is not read again: the folder is remembered...
    const old = path.join(journalDir, journalName(40));
    appendFileSync(old, "\r\n" + lines(...site(3_900_000_003, "Later Find", 0.2, 40)));
    store = await start();
    expect(store.getSnapshot().activeDepots.map((d) => d.constructionSiteLabel)).toEqual(["Halfway Port"]);
    await store.shutdown();
    store = null;

    // ...but another folder is read in full.
    const other = mkdtempSync(path.join(tmpdir(), "colonize-history-j2-"));
    dirs.push(other);
    cpSync(journalDir, other, { recursive: true });
    store = await start(other);
    expect(store.getSnapshot().activeDepots.map((d) => d.constructionSiteLabel).sort()).toEqual(["Halfway Port", "Later Find"]);
  });
});

describe("old docking", () => {
  it("does not say which carrier the ship is on now", async () => {
    const CARRIER = 3_700_000_099;
    appendFileSync(
      path.join(journalDir, journalName(40)),
      "\r\n" + lines({ timestamp: iso(40), event: "Docked", StationName: "K7Q-1HT", StationType: "FleetCarrier", MarketID: CARRIER, StarSystem: "Old Colony" }),
    );
    // In the window: the carrier is known, and cargo moves while the journal never said where the ship docked.
    appendFileSync(
      path.join(journalDir, journalName(0)),
      lines(
        { timestamp: iso(0), event: "CarrierStats", CarrierID: CARRIER, Callsign: "K7Q-1HT", Name: "OLD HAULER", SpaceUsage: { TotalCapacity: 25000, Cargo: 0 } },
        { timestamp: iso(0), event: "CargoTransfer", Transfers: [{ Type: "steel", Count: 10, Direction: "tocarrier" }] },
      ),
    );
    store = await start();
    const carrier = store.getSnapshot().carriers.find((c) => c.carrierId === String(CARRIER));
    expect(carrier).toBeDefined();
    expect(carrier!.tonsByCommodity.steel ?? 0).toBe(0);
  });
});

describe("reading only some events", () => {
  it("parses only the lines naming one of them, and skips a torn line", async () => {
    const seen: string[] = [];
    await readJournalEvents(path.join(journalDir, journalName(40)), ["Docked", "Colonisation"], (j) => seen.push(String(j.event)));
    expect(seen).toEqual(["Docked", "ColonisationConstructionDepot", "Docked", "ColonisationConstructionDepot"]);
  });
});
