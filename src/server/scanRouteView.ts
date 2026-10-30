/**
 * The scan view of one system (plan 1.3.3 R-4, owner 2026-10-30: "a 3D variant of the system map, values for all of
 * the planets, and the shortest route between them to scan the high-value ones"). Every star and planet where its
 * orbit puts it now (orbitPositions.ts), valued, and the shortest route from the arrival star through the planets
 * whose mapped value is at least the commander's minimum and the bodies with biology left to sample
 * (scanRoute.ts).
 *
 * The bodies are the system map's (`explorationRecordsForSystem`: own scans, then EDSM) for a system in the
 * journals, valued at the rate this commander would get (first discovered, first mapped, as the scans say); else
 * Spansh's, at the base rate, as the route's other systems are fetched (routeSystemValues.ts).
 */
import type { ExplorationScanRecord, RemoteSystemRecord } from "../shared/types.js";
import type { ScanRouteBodyDTO, ScanRouteDTO } from "../shared/dto/routeSystem.js";
import type { GameStateStore } from "./gameState.js";
import { METRES_PER_LS, parentIds, systemPositions, systemViewPositions } from "../shared/orbitPositions.js";
import { shortestScanRoute } from "../shared/scanRoute.js";
import { bodyScanValueCredits, starScanValueCredits } from "./explorationValue.js";
import { explorationRecordIsStellar } from "./explorationStellar.js";
import { isTerraformableState } from "../shared/terraformState.js";
import { commanderFirstDiscoveredBody } from "./developerPopulatedSystems.js";
import { explorationRecordsForSystem } from "./systemMap.js";
import { notableTagForRecord } from "./snapshotSystemInfo.js";
import { computeBody, computeBodyUncached } from "./bodyCompute.js";
import { getCachedPrices, getCachedSpeciesDatabase } from "./speciesDb.js";
import { bodyExpectedValue } from "../shared/systemTriage.js";
import { routeSystemValues, systemScanValues } from "./routeSystemValues.js";
import type { RouteSystemBodyDTO, RouteSystemValuesDTO } from "../shared/dto/routeSystem.js";
import { bodyKey } from "../shared/bodyKey.js";

const isBelt = (r: ExplorationScanRecord) =>
  /asteroidcluster/i.test((r.bodyType ?? "").replace(/\s+/g, "")) || /belt cluster/i.test(r.bodyName ?? "");

const shortName = (body: string, system: string) =>
  system && body.toLowerCase().startsWith(system.toLowerCase() + " ") ? body.slice(system.length + 1) : body;

/** Bio per body id: signals, expected value, and whether biology is left to sample. */
type Bio = Map<number, { signals: number | null; cr: number | null; left: boolean }>;

/** The journals' bio bodies of a system, with what this commander would get for them. */
function journalBio(store: GameStateStore, addr: number): Bio {
  const out: Bio = new Map();
  const db = getCachedSpeciesDatabase();
  const prices = getCachedPrices();
  // The current system's bodies are the main screen's: its cache. Another system's would flush it (256 bodies).
  const compute = addr === store.currentSystemAddress ? computeBody : computeBodyUncached;
  for (const state of store.bioBodiesInSystem(addr)) {
    const computed = compute(state, db, prices, store);
    const signals = state.biologicalSignals ?? null;
    // Sampled out: every signal has an analysed species.
    const left = signals == null || signals <= 0 || state.confirmedVariants.length < signals;
    out.set(state.bodyId, { signals, cr: bodyExpectedValue(computed)?.expectedCredits ?? null, left });
  }
  return out;
}

/** Spansh's bio bodies of a route system, valued at 1× (routeSystemValues.ts). */
function spanshBio(store: GameStateStore, sys: RemoteSystemRecord): Bio {
  const byName = new Map(routeSystemValues(store, sys).bodies.map((b) => [b.name, b]));
  const out: Bio = new Map();
  for (const r of sys.records) {
    const b = byName.get(r.bodyName);
    if (b?.bioSignals) out.set(r.bodyId, { signals: b.bioSignals, cr: b.bioCr, left: true });
  }
  return out;
}

export interface ScanRouteInput {
  addr: number;
  name: string;
  records: readonly ExplorationScanRecord[];
  source: "journal" | "spansh";
  bio: Bio;
  /** Body keys mapped already (journal), and whether the commander's scans were the first. */
  mapped?: (key: string) => boolean;
  firstDiscovered?: (r: ExplorationScanRecord) => boolean;
  totalBodies: number | null;
  minDssCr: number;
  atMs: number;
}

/** The view from records: positions, values, targets and the route. Pure, for tests. */
export function buildScanRoute(input: ScanRouteInput): ScanRouteDTO {
  const { records, bio, minDssCr, atMs } = input;
  const positions = systemPositions(records, atMs);
  const view = systemViewPositions(records, atMs);
  const name = input.name || records.find((r) => r.starSystem)?.starSystem || `System ${input.addr}`;
  const bodies: ScanRouteBodyDTO[] = [];
  let startId: number | null = null;
  for (const r of records) {
    if (r.isSynthetic || r.isBarycentreJournal || isBelt(r)) continue;
    const star = explorationRecordIsStellar(r) && !!r.starType;
    if (!star && !r.planetClass) continue;
    const pos = positions.get(r.bodyId) ?? { x: 0, y: 0, z: 0 };
    const fd = input.firstDiscovered?.(r) ?? false;
    const key = bodyKey(r.systemAddress, r.bodyId);
    const mapped = input.mapped?.(key) ?? false;
    let fssCr: number;
    let dssCr: number | null = null;
    if (star) fssCr = starScanValueCredits(r.stellarMass ?? 1, r.starType, fd).value;
    else {
      // First mapper while nobody has mapped it (the scan's WasMapped false).
      const v = bodyScanValueCredits(r.planetClass, isTerraformableState(r.terraformState), r.massEM ?? 1, fd, r.wasMapped === false && input.source === "journal");
      fssCr = v.fss;
      dssCr = v.dssMapped;
    }
    const b = bio.get(r.bodyId);
    const dssTarget = !star && !mapped && (dssCr ?? 0) >= minDssCr;
    const bioTarget = !!b && (b.signals ?? 0) > 0 && b.left;
    if (star && (r.distanceFromArrivalLs === 0 || (startId == null && r.bodyId === 0))) startId = r.bodyId;
    bodies.push({
      id: r.bodyId,
      name: r.bodyName,
      short: shortName(r.bodyName, name),
      kind: star ? "star" : "planet",
      cls: star ? (r.starType ?? null) : (r.planetClass ?? null),
      tag: star ? null : notableTagForRecord(r),
      pos,
      viewPos: view.get(r.bodyId) ?? { x: 0, y: 0, z: 0 },
      ringCentre: (() => {
        const pid = parentIds(r.parents)[0];
        return pid != null ? (view.get(pid) ?? null) : null;
      })(),
      parentId: parentIds(r.parents)[0] ?? null,
      moon: Array.isArray(r.parents) && r.parents.some((p) => !!p && typeof p === "object" && "Planet" in (p as object)),
      orbitLs: r.semiMajorAxis ? r.semiMajorAxis / METRES_PER_LS : null,
      radiusKm: r.radius ? r.radius / 1000 : null,
      fssCr,
      dssCr,
      mapped,
      bioSignals: b?.signals ?? null,
      bioCr: b?.cr ?? null,
      target: dssTarget && bioTarget ? "both" : dssTarget ? "dss" : bioTarget ? "bio" : null,
    });
  }
  // No arrival star in the records: the first star, else the root.
  if (startId == null) startId = bodies.find((b) => b.kind === "star")?.id ?? null;
  const start = (startId != null ? bodies.find((b) => b.id === startId)?.pos : null) ?? { x: 0, y: 0, z: 0 };
  const targets = bodies.filter((b) => b.target && b.id !== startId);
  const route = shortestScanRoute(start, targets.map((b) => ({ item: b.id, pos: b.pos })));
  const total = input.totalBodies;
  return {
    addr: String(input.addr),
    name,
    source: input.source,
    state: "ok",
    atMs,
    minDssCr,
    startId,
    bodies,
    route: { order: route.order.map((s) => s.item), totalLs: route.totalLs },
    bodyCount: { known: bodies.length, total, missing: total != null ? Math.max(0, total - bodies.length) : 0 },
    routeDssCr: targets.reduce((a, b) => a + (b.target === "dss" || b.target === "both" ? (b.dssCr ?? 0) : 0), 0),
    routeBioCr: targets.reduce((a, b) => a + (b.target === "bio" || b.target === "both" ? (b.bioCr ?? 0) : 0), 0),
  };
}

/**
 * A route system the journals know (one he has been to, or EDSM filled in): its worth from his own records, as the
 * route lists and the map's panel show a Spansh system's (routeSystemValues.ts), at 1×. Null when the journals have
 * nothing of it.
 */
export function journalSystemValues(store: GameStateStore, addr: number, name: string): RouteSystemValuesDTO | null {
  const records = explorationRecordsForSystem(store, addr);
  if (!records.length || records[0] === store.remoteSystems.get(addr)?.records[0]) return null;
  const scan = systemScanValues(records);
  const db = getCachedSpeciesDatabase();
  const prices = getCachedPrices();
  const names = new Map(records.map((r) => [r.bodyId, r.bodyName]));
  const bio = new Map<number, Pick<RouteSystemBodyDTO, "bioSignals" | "bioCr" | "species">>();
  const compute = addr === store.currentSystemAddress ? computeBody : computeBodyUncached;
  for (const state of store.bioBodiesInSystem(addr)) {
    const computed = compute(state, db, prices, store);
    const row = bodyExpectedValue(computed);
    const species = computed.matches
      .filter((m) => !m.unlikely)
      .map((m) => ({
        name: m.entry.displayName,
        cr: m.priceCredits ?? null,
        chancePct: typeof m.presenceProbabilityPercent === "number" ? Math.round(m.presenceProbabilityPercent) : null,
        logged: m.loggedBy === "you" || m.loggedBy === "others",
      }))
      .sort((a, b) => Number(b.logged) - Number(a.logged) || (b.chancePct ?? -1) - (a.chancePct ?? -1))
      .slice(0, 4);
    bio.set(state.bodyId, { bioSignals: state.biologicalSignals ?? null, bioCr: row?.expectedCredits ?? null, species });
  }
  const bodies: RouteSystemBodyDTO[] = [];
  for (const id of new Set([...scan.bodies.keys(), ...bio.keys()])) {
    const s = scan.bodies.get(id);
    const b = bio.get(id);
    if (!s?.tag && !b) continue;
    bodies.push({
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
  bodies.sort((a, b) => worth(b) - worth(a));
  const total = store.fssDiscoveryScanBySystem.get(addr)?.bodyCount ?? null;
  return {
    addr: String(addr),
    name: name || records.find((r) => r.starSystem)?.starSystem || `System ${addr}`,
    state: "ok",
    source: "journal",
    bodyCount: scan.bodies.size,
    bodyTotal: total,
    missing: total != null ? Math.max(0, total - scan.bodies.size) : 0,
    fssCr: scan.fssCr,
    dssCr: scan.dssCr,
    dssBodies: scan.dssBodies,
    totalCr: scan.totalCr,
    bioCr: bodies.reduce((a, x) => a + (x.bioCr ?? 0), 0),
    bodies,
    fetchedAt: null,
  };
}

/** A system in the journals: its records, the commander's values, its honk's count. Null when there are none. */
export function journalScanRoute(store: GameStateStore, addr: number, name: string, minDssCr: number, atMs: number): ScanRouteDTO | null {
  const records = explorationRecordsForSystem(store, addr);
  // A Spansh lookup's records (the map's last resort) are the other path: here only own scans and EDSM's.
  if (!records.length || records[0] === store.remoteSystems.get(addr)?.records[0]) return null;
  return buildScanRoute({
    addr,
    name,
    records,
    source: "journal",
    bio: journalBio(store, addr),
    mapped: (k) => store.dssMappedBodyKeys.has(k),
    firstDiscovered: (r) => !r.edsmHydrated && commanderFirstDiscoveredBody(addr, r.wasDiscovered),
    totalBodies: store.fssDiscoveryScanBySystem.get(addr)?.bodyCount ?? null,
    minDssCr,
    atMs,
  });
}

/** A route system from Spansh, at the base rate. */
export function spanshScanRoute(store: GameStateStore, sys: RemoteSystemRecord, minDssCr: number, atMs: number): ScanRouteDTO {
  return buildScanRoute({
    addr: sys.systemAddress,
    name: sys.starSystem,
    records: sys.records,
    source: "spansh",
    bio: spanshBio(store, sys),
    totalBodies: sys.bodyCount ?? null,
    minDssCr,
    atMs,
  });
}
