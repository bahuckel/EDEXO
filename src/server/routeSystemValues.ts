/**
 * What a discovered system on the route is worth (plan 1.3.3 R-1 / R-3, owner 2026-10-30: "NavRoute and neutron
 * route, discovered systems along the way show high value bodies on the right panel"; "values for FSS and DSS of
 * entire systems"). The bodies come from Spansh as a looked-up system's do (remoteSystems.ts); the values are the
 * app's own: the FSS / DSS formulas of the data value (explorationDataEstimate.ts) and the species prediction of the
 * system the ship is in (bodyCompute.ts), at 1× — other commanders reported the system.
 *
 * Fetched one system at a time (a 150-hop route asks for 150 systems), answered from the 30-day lookup cache when
 * it has the system, and kept for the session. Never written into the store: the route's systems are not the ones
 * the commander looks at, and the main screen must not switch to one of them.
 */
import type { ExplorationScanRecord, RemoteSystemRecord } from "../shared/types.js";
import type { RouteSystemBodyDTO, RouteSystemValuesDTO } from "../shared/dto/routeSystem.js";
import type { GameStateStore } from "./gameState.js";
import { bodyScanValueCredits, starScanValueCredits, systemHonkCredits, type HonkBody } from "./explorationValue.js";
import { explorationRecordIsStellar } from "./explorationStellar.js";
import { isTerraformableState } from "../shared/terraformState.js";
import { fetchRemoteSystem, readRemoteSystemsCache, remoteBodyStates } from "./remoteSystems.js";
import { notableTagForRecord } from "./snapshotSystemInfo.js";
import { computeBodyUncached } from "./bodyCompute.js";
import { statSync } from "node:fs";
import { remoteSystemsCachePath } from "./remoteSystems.js";
import { getCachedPrices, getCachedSpeciesDatabase } from "./speciesDb.js";
import { triageInputsFromBodies, triageRow } from "../shared/systemTriage.js";

/** Species listed per body. */
const SPECIES_SHOWN = 4;
/** Systems kept for the session (whole records, every body: a few hundred kB at most). */
const KEPT = 300;

/** The 30-day lookup cache, read again only when the file changes (it was read on every system asked for). */
let lookupMemo: { mtimeMs: number; byAddr: Map<number, RemoteSystemRecord> } | null = null;
function cachedLookup(addr: number): RemoteSystemRecord | undefined {
  let mtimeMs = -1;
  try {
    mtimeMs = statSync(remoteSystemsCachePath()).mtimeMs;
  } catch {
    return undefined;
  }
  if (lookupMemo?.mtimeMs !== mtimeMs) {
    lookupMemo = { mtimeMs, byAddr: new Map(readRemoteSystemsCache().map((r) => [r.systemAddress, r])) };
  }
  return lookupMemo.byAddr.get(addr);
}

const isBelt = (r: ExplorationScanRecord) =>
  /asteroidcluster/i.test((r.bodyType ?? "").replace(/\s+/g, "")) || /belt cluster/i.test(r.bodyName ?? "");

/** FSS and DSS of the whole system from its records: every body scanned, the notable planets mapped. */
export function systemScanValues(records: readonly ExplorationScanRecord[]): {
  fssCr: number;
  dssCr: number;
  dssBodies: number;
  totalCr: number;
  bodies: Map<number, { tag: string | null; fss: number; dss: number | null }>;
} {
  let fss = 0;
  let dss = 0;
  let mappedFss = 0;
  let dssBodies = 0;
  let arrival = false;
  const honk: HonkBody[] = [];
  const bodies = new Map<number, { tag: string | null; fss: number; dss: number | null }>();
  for (const r of records) {
    if (r.isSynthetic || isBelt(r)) continue;
    if (explorationRecordIsStellar(r)) {
      if (!r.starType) continue;
      const v = starScanValueCredits(r.stellarMass ?? 1, r.starType, false).value;
      fss += v;
      if (!((r.distanceFromArrivalLs ?? 0) > 0)) arrival = true;
      else honk.push({ kind: "star", stellarMass: r.stellarMass ?? 1, starType: r.starType });
      bodies.set(r.bodyId, { tag: null, fss: v, dss: null });
      continue;
    }
    if (!r.planetClass) continue;
    const tf = isTerraformableState(r.terraformState);
    const mass = r.massEM ?? 1;
    honk.push({ kind: "planet", planetClass: r.planetClass, terraformable: tf, massEM: mass });
    const v = bodyScanValueCredits(r.planetClass, tf, mass, false, false);
    fss += v.fss;
    const tag = notableTagForRecord(r);
    if (tag) {
      dss += v.dssMapped;
      mappedFss += v.fss;
      dssBodies++;
    }
    bodies.set(r.bodyId, { tag, fss: v.fss, dss: v.dssMapped });
  }
  // The honk pays with the arrival star, a third of every other body (systemHonkCredits).
  if (arrival) fss += systemHonkCredits(honk, false);
  fss = Math.round(fss);
  dss = Math.round(dss);
  return { fssCr: fss, dssCr: dss, dssBodies, totalCr: fss - Math.round(mappedFss) + dss, bodies };
}

/**
 * The system valued: notable planets and bodies with biology, most valuable first. The species prediction runs on
 * the store as for a looked-up system, the record put in for the call and taken out after (it is synchronous).
 */
export function routeSystemValues(store: GameStateStore, sys: RemoteSystemRecord): RouteSystemValuesDTO {
  const scan = systemScanValues(sys.records);
  const had = store.remoteSystems.get(sys.systemAddress);
  store.remoteSystems.set(sys.systemAddress, sys);
  const bio = new Map<number, Pick<RouteSystemBodyDTO, "bioSignals" | "bioCr" | "species">>();
  try {
    const db = getCachedSpeciesDatabase();
    const prices = getCachedPrices();
    for (const state of remoteBodyStates(sys)) {
      // Not through computeBody's cache: 256 bodies, cleared whole when full, and the main screen's are in it.
      const computed = computeBodyUncached(state, db, prices, store);
      const input = triageInputsFromBodies([computed])[0];
      const row = input?.candidates.length ? triageRow({ ...input, multiplier: 1 }) : null;
      const species = computed.matches
        .filter((m) => !m.unlikely)
        .map((m) => ({
          name: m.entry.displayName,
          cr: m.priceCredits ?? null,
          chancePct: typeof m.presenceProbabilityPercent === "number" ? Math.round(m.presenceProbabilityPercent) : null,
          logged: m.loggedBy === "others" || m.loggedBy === "you",
        }))
        .sort((a, b) => Number(b.logged) - Number(a.logged) || (b.chancePct ?? -1) - (a.chancePct ?? -1) || (b.cr ?? 0) - (a.cr ?? 0))
        .slice(0, SPECIES_SHOWN);
      bio.set(state.bodyId, { bioSignals: state.biologicalSignals ?? null, bioCr: row ? row.expectedCredits : null, species });
    }
  } finally {
    if (had) store.remoteSystems.set(sys.systemAddress, had);
    else store.remoteSystems.delete(sys.systemAddress);
  }
  const names = new Map(sys.records.map((r) => [r.bodyId, r.bodyName]));
  const out: RouteSystemBodyDTO[] = [];
  for (const id of new Set([...scan.bodies.keys(), ...bio.keys()])) {
    const s = scan.bodies.get(id);
    const b = bio.get(id);
    if (!s?.tag && !b) continue;
    out.push({
      name: names.get(id) ?? `Body ${id}`,
      tag: s?.tag ?? null,
      fssCr: s?.fss ?? 0,
      dssCr: s?.dss ?? null,
      bioSignals: b?.bioSignals ?? null,
      bioCr: b?.bioCr ?? null,
      species: b?.species ?? [],
    });
  }
  const worth = (x: RouteSystemBodyDTO) => (x.tag ? (x.dssCr ?? 0) : 0) + (x.bioCr ?? 0);
  out.sort((a, b) => worth(b) - worth(a));
  return {
    addr: String(sys.systemAddress),
    name: sys.starSystem,
    state: "ok",
    bodyCount: scan.bodies.size,
    bodyTotal: sys.bodyCount ?? null,
    missing: sys.bodyCount != null ? Math.max(0, sys.bodyCount - scan.bodies.size) : 0,
    fssCr: scan.fssCr,
    dssCr: scan.dssCr,
    dssBodies: scan.dssBodies,
    totalCr: scan.totalCr,
    bioCr: out.reduce((a, x) => a + (x.bioCr ?? 0), 0),
    bodies: out,
    fetchedAt: sys.fetchedAt,
  };
}

type FetchSystem = typeof fetchRemoteSystem;

/** The session's route systems, one Spansh fetch at a time. */
export function createRouteSystemValues(store: () => GameStateStore | null, fetchSystem: FetchSystem = fetchRemoteSystem) {
  const kept = new Map<number, RemoteSystemRecord | { none: string } | { error: string }>();
  let queue: Promise<unknown> = Promise.resolve();

  const keep = (addr: number, v: RemoteSystemRecord | { none: string } | { error: string }) => {
    kept.delete(addr);
    kept.set(addr, v);
    if (kept.size > KEPT) kept.delete(kept.keys().next().value!);
  };

  async function system(addr: number, name: string): Promise<RemoteSystemRecord | { none: string } | { error: string }> {
    const hit = kept.get(addr) ?? cachedLookup(addr);
    if (hit && !("error" in hit)) return hit;
    const run = queue.then(async () => {
      const again = kept.get(addr);
      if (again && !("error" in again)) return again;
      const r = await fetchSystem(addr, name);
      const v = r.ok ? r.system : /no record|no bodies/i.test(r.error) ? { none: r.error } : { error: r.error };
      keep(addr, v);
      return v;
    });
    queue = run.catch(() => undefined);
    return run;
  }

  /** One system valued, or why not. */
  async function values(addr: number, name: string): Promise<RouteSystemValuesDTO> {
    const empty = { addr: String(addr), name, bodyCount: 0, bodyTotal: null, missing: 0, fssCr: 0, dssCr: 0, dssBodies: 0, totalCr: 0, bioCr: 0, bodies: [], fetchedAt: null };
    const s = store();
    if (!s) return { ...empty, state: "error", error: "The journals are not loaded yet." };
    const sys = await system(addr, name);
    if ("none" in sys) return { ...empty, state: "none", error: sys.none };
    if ("error" in sys) return { ...empty, state: "error", error: sys.error };
    return routeSystemValues(s, sys);
  }

  return { values, system };
}
