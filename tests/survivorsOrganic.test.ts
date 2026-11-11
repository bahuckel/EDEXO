/**
 * The ScanOrganic counter and the first-footfall payout (review 2026-11-10 §4.4-4.5, plan 2.1): the unsold figure
 * could be five times wrong, or a fifth, and a replayed Analyse book the "sampled" achievement twice, with the suite
 * green. Each case here fails when the named comparison changes.
 */
import { describe, expect, it, vi } from "vitest";
import { GameStateStore } from "../src/server/gameState.js";
import { nextOrganicProgressCount } from "../src/server/organicTracking.js";
import { organicDataValuation } from "../src/server/organicValue.js";
import { loadPriceList, lookupPrice } from "../src/server/priceList.js";
import { getProjectRoot } from "../src/server/paths.js";
import type { JournalLine } from "../src/shared/types.js";

const SYS = 6914570015099;
const BODY = 3;
const TS = "2026-05-05T05:09:05Z";
const j = (o: Record<string, unknown>) => ({ timestamp: TS, ...o }) as unknown as JournalLine;
const prices = loadPriceList(getProjectRoot());

const scan = (wasFootfalled: boolean | undefined) =>
  j({
    event: "Scan",
    ScanType: "Detailed",
    BodyName: "Eorgh Prou KN-A d14-201 B 3",
    BodyID: BODY,
    StarSystem: "Eorgh Prou KN-A d14-201",
    SystemAddress: SYS,
    PlanetClass: "High metal content body",
    AtmosphereType: "CarbonDioxide",
    SurfaceGravity: 5.6,
    SurfaceTemperature: 251.6,
    Landable: true,
    WasDiscovered: true,
    WasMapped: false,
    ...(wasFootfalled === undefined ? {} : { WasFootfalled: wasFootfalled }),
  });
const organic = (scanType: string) =>
  j({
    event: "ScanOrganic",
    ScanType: scanType,
    Genus: "$Codex_Ent_Stratum_Genus_Name;",
    Genus_Localised: "Stratum",
    Species: "$Codex_Ent_Stratum_04_Name;",
    Species_Localised: "Stratum Tectonicas",
    Variant: "$Codex_Ent_Stratum_04_F_Name;",
    Variant_Localised: "Stratum Tectonicas - Green",
    SystemAddress: SYS,
    Body: BODY,
  });
const disembark = (onStation = false) =>
  j({ event: "Disembark", OnPlanet: true, OnStation: onStation, SystemAddress: SYS, BodyID: BODY, Body: "B 3" });

function store(wasFootfalled: boolean | undefined, onStation = false) {
  const st = new GameStateStore();
  st.apply(j({ event: "FSDJump", StarSystem: "Eorgh Prou KN-A d14-201", SystemAddress: SYS }));
  st.apply(scan(wasFootfalled));
  st.apply(disembark(onStation));
  return st;
}
const sample = (st: GameStateStore) => {
  for (const t of ["Log", "Sample", "Sample", "Analyse"]) st.apply(organic(t));
};

describe("the ScanOrganic counter (organicTracking.ts)", () => {
  it("never reaches 3 on Samples alone, and a Log does not count", () => {
    expect(nextOrganicProgressCount(2, organic("Sample"))).toBe(2);
    expect(nextOrganicProgressCount(0, organic("Log"))).toBeNull();
    expect(nextOrganicProgressCount(1, organic("Analyse"))).toBe(3);
  });

  it("books one sale and one achievement however often the Analyse is replayed, and a late Sample keeps 3", () => {
    const st = store(true);
    const noted = vi.spyOn(st, "noteSampledAchievement");
    sample(st);
    st.apply(organic("Analyse"));
    st.apply(organic("Sample"));
    expect(st.pendingOrganicSales).toHaveLength(1);
    expect(noted).toHaveBeenCalledTimes(1);
    expect([...st.organicAnalyseByKey.values()][0]!.count).toBe(3);
  });
});

describe("the first-footfall payout (organicValue.ts, gameStateEvents.ts)", () => {
  const base = lookupPrice(prices, "Stratum Tectonicas - Green", "Stratum Tectonicas - Green")!;

  it("pays five times on a body the detailed scan said nobody had walked on", () => {
    expect(base).toBeGreaterThan(1_000_000);
    const st = store(false);
    sample(st);
    expect(organicDataValuation(st, prices).credits).toBe(base * 5);
  });

  it("pays once on a footfalled body, on one the scan said nothing about, and after landing on a station", () => {
    for (const st of [store(true), store(undefined), store(false, true)]) {
      sample(st);
      expect(organicDataValuation(st, prices).credits).toBe(base);
    }
  });
});
