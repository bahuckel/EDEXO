/*
  Merging exploration scans into the store (split out of gameState.ts, discuss item 30, 1.3.1): one Scan or
  barycentre line into the body records, and the shared exobiology carried between sibling moons.
*/
import type { ExplorationScanRecord, JournalLine, OrganicGenusLock } from "../shared/types.js";
import { barycentreSyntheticBodyId, moonPairBarycentreId, planetRingCount } from "./orbitUtils.js";
import { scanRings } from "../shared/bodyFeatures.js";
import { bodyKey } from "../shared/bodyKey.js";
import {
  buildSiblingPlanetScan,
  ensureBody,
  explorationRecordsSimilarForSharedExo,
  mergeGenusHints,
  organicLockGenusKey,
  siblingMoonBodyIdsUnified,
} from "./gameStateHelpers.js";
import type { GameStateStore } from "./gameState.js";

/**
 * Journal `ScanBaryCentre`: the orbit of the `{ Null: BodyID }` node in `Scan.Parents`.
 *
 * **These elements describe the barycentre's own orbit around *its* parent — not the mutual orbit
 * of its children**, which is what this comment used to claim. Measured on Swoilz KI-E b4-9:
 * `ScanBaryCentre` for barycentre 7 reports a semi-major axis of 56.6 ls, and its two children,
 * planets 3 and 4, sit at 56.6 ls from the star. Their orbits *around each other* are 0.097 and
 * 0.144 ls. The number is the distance to the star, unambiguously.
 *
 * The distinction is load-bearing: `starDistanceLs` reads this field to answer how far a body is
 * from its host star when a barycentre stands between them. EDSM drops the event; Spansh keeps it
 * as a `Barycentre` body, which `spanshSystemHydration.ts` turns into this same record.
 *
 * Stored at `bodyId = barycentreSyntheticBodyId(journalNullId)` so rows never collide with real
 * body scans.
 */
export function mergeBarycentreJournalLine(store: GameStateStore, line: JournalLine, ts: string): void {
  const systemAddress = line.SystemAddress as number;
  const nullIdRaw = line.BodyID as number;
  if (typeof systemAddress !== "number" || typeof nullIdRaw !== "number" || !Number.isFinite(nullIdRaw))
    return;
  const syntheticId = barycentreSyntheticBodyId(nullIdRaw);
  const k = bodyKey(systemAddress, syntheticId);
  const prev = store.explorationScans.get(k);
  const pickStr = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const pickNum = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;

  const rec: ExplorationScanRecord = {
    ...(prev ?? {
      systemAddress,
      bodyId: syntheticId,
      bodyName: `Bary ⊥${nullIdRaw}`,
      starSystem: "",
      updatedAt: ts,
    }),
    systemAddress,
    bodyId: syntheticId,
    bodyName: prev?.bodyName?.trim() ? prev.bodyName : `Bary ⊥${nullIdRaw}`,
    starSystem: pickStr(line.StarSystem) ?? prev?.starSystem ?? (store.currentSystem ?? "").trim() ?? "",
    updatedAt: ts,
    isBarycentreJournal: true,
    journalBarycentreNullId: nullIdRaw,
  };

  const setNum = (key: keyof ExplorationScanRecord, v: unknown) => {
    const n = pickNum(v);
    if (n !== undefined) (rec as unknown as Record<string, unknown>)[key as string] = n;
  };

  setNum("semiMajorAxis", line.SemiMajorAxis);
  setNum("eccentricity", line.Eccentricity);
  setNum("orbitalInclination", line.OrbitalInclination);
  setNum("periapsis", line.Periapsis);
  setNum("orbitalPeriod", line.OrbitalPeriod);
  setNum("ascendingNode", line.AscendingNode);
  setNum("meanAnomaly", line.MeanAnomaly);

  const fresh = store.scanIndexIsFresh();
  store.explorationScans.set(k, rec);
  store.explorationScansRevision += 1;
  store.patchScanIndex(fresh, [{ kind: "live", rec }]);
  store.edsmExplorationByKey.delete(k);
}

export function mergeExplorationScan(store: GameStateStore, line: JournalLine, ts: string): void {
  const systemAddress = line.SystemAddress as number;
  const bodyId = line.BodyID as number;
  const bodyName = line.BodyName as string;
  if (
    typeof systemAddress !== "number" ||
    typeof bodyId !== "number" ||
    typeof bodyName !== "string" ||
    !bodyName.trim()
  ) {
    return;
  }
  const k = bodyKey(systemAddress, bodyId);
  const prev = store.explorationScans.get(k);
  const pickStr = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const pickNum = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const pickBool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

  const rec: ExplorationScanRecord = {
    ...(prev ?? {
      systemAddress,
      bodyId,
      bodyName: bodyName.trim(),
      starSystem: "",
      updatedAt: ts,
    }),
    systemAddress,
    bodyId,
    bodyName: bodyName.trim(),
    starSystem: pickStr(line.StarSystem) ?? prev?.starSystem ?? (store.currentSystem ?? "").trim() ?? "",
    updatedAt: ts,
  };

  const setStr = (key: keyof ExplorationScanRecord, v: unknown) => {
    const s = pickStr(v);
    if (s) (rec as unknown as Record<string, unknown>)[key as string] = s;
  };
  const setNum = (key: keyof ExplorationScanRecord, v: unknown) => {
    const n = pickNum(v);
    if (n !== undefined) (rec as unknown as Record<string, unknown>)[key as string] = n;
  };
  const setBool = (key: keyof ExplorationScanRecord, v: unknown) => {
    const b = pickBool(v);
    if (b !== undefined) (rec as unknown as Record<string, unknown>)[key as string] = b;
  };

  setStr("scanType", line.ScanType);
  rec.playerScanned = prev?.playerScanned === true || line.ScanType !== "NavBeaconDetail";
  if (prev?.fssResolved === true || line.ScanType === "Detailed") rec.fssResolved = true;
  setStr("bodyType", line.BodyType);
  setStr("planetClass", line.PlanetClass);
  setStr("starType", line.StarType);
  setNum("subclass", line.Subclass);
  setStr("luminosity", (line as Record<string, unknown>).Luminosity);
  setNum("stellarMass", line.StellarMass);
  setNum("absoluteMagnitude", (line as Record<string, unknown>).AbsoluteMagnitude);
  setNum("massEM", line.MassEM);
  setStr("terraformState", line.TerraformState);
  setBool("landable", line.Landable);
  setNum("semiMajorAxis", line.SemiMajorAxis);
  setNum("distanceFromArrivalLs", (line as Record<string, unknown>).DistanceFromArrivalLS);
  setNum("surfaceTemperature", line.SurfaceTemperature);
  setNum("surfaceGravity", line.SurfaceGravity);
  setNum("surfacePressure", line.SurfacePressure);
  setNum("radius", line.Radius);
  setStr("atmosphereType", line.AtmosphereType);
  setStr("atmosphere", line.Atmosphere);
  setStr("volcanism", line.Volcanism);
  setBool("tidalLock", line.TidalLock);
  setBool("wasDiscovered", (line as Record<string, unknown>).WasDiscovered);
  /*
   * The arrival star's flag answers a question about the whole system, so it is lifted out here.
   *
   * Its `WasDiscovered` is what the game uses to decide whether the system counts as this
   * commander's discovery — the name on the system, and the bonus on the cartographic sale. Every
   * other body's flag is about that body alone.
   *
   * **It is not always `BodyID 0`.** That was the original rule here and it is wrong: in
   * `Pru Aihm BL-U b33-2` the lowest body is 2, the star named "A", and the owner reported a
   * system he had plainly discovered — every body in it reads `WasDiscovered: false` — missing
   * from the first-discovery filter because no body zero existed to record. Multi-star systems
   * routinely start numbering above zero.
   *
   * The rule is the **arrival star**, which the journal names exactly: `DistanceFromArrivalLS` is
   * `0` for it and nothing else. In that system it is body 2 at 0.0 LS, while the other stars sit
   * at 2,283 and 350,734 LS. "Lowest-numbered star" was tried and is not the same thing — it would
   * let a secondary speak for the system whenever the primary went unscanned, which is precisely
   * what `firstDiscovery.test.ts` was written to prevent: 672 of 1,159 first-scanned systems have
   * a primary somebody else had found.
   *
   * `BodyID 0` remains a fallback for a scan that carries no distance at all, since that was the
   * old rule and it is right whenever it applies. An arrival-star reading always wins over it.
   *
   * First answer kept, per source: a second visit reports the system as discovered — by him — and
   * overwriting would erase the discovery on the second look at his own find.
   */
  const starTypeOnLine = (line as Record<string, unknown>).StarType;
  if (typeof starTypeOnLine === "string" && starTypeOnLine.trim()) {
    const wd = (line as Record<string, unknown>).WasDiscovered;
    const dist = (line as Record<string, unknown>).DistanceFromArrivalLS;
    const isArrival = typeof dist === "number" && dist === 0;
    const rank = isArrival ? 0 : dist === undefined && bodyId === 0 ? 1 : -1;
    if (typeof wd === "boolean" && rank >= 0) {
      const prior = store.mainStarSourceRankBySystem.get(systemAddress);
      if (prior === undefined || rank < prior) {
        store.mainStarSourceRankBySystem.set(systemAddress, rank);
        store.mainStarWasDiscoveredBySystem.set(systemAddress, wd);
      }
    }
  }
  setBool("wasMapped", (line as Record<string, unknown>).WasMapped);
  setNum("eccentricity", line.Eccentricity);
  setNum("orbitalInclination", line.OrbitalInclination);
  setNum("periapsis", line.Periapsis);
  setNum("orbitalPeriod", line.OrbitalPeriod);
  setNum("ascendingNode", line.AscendingNode);
  setNum("meanAnomaly", line.MeanAnomaly);
  setNum("rotationPeriod", (line as Record<string, unknown>).RotationPeriod);
  setNum("axialTilt", (line as Record<string, unknown>).AxialTilt);

  if (line.Parents !== undefined) rec.parents = line.Parents;
  const ringCount = planetRingCount((line as Record<string, unknown>).Rings);
  if (ringCount !== undefined) rec.ringCount = ringCount;
  const rings = scanRings((line as Record<string, unknown>).Rings);
  if (rings !== undefined) rec.rings = rings;
  setNum("ageMy", (line as Record<string, unknown>).Age_MY);

  if (line.AtmosphereComposition !== undefined) {
    const incoming = line.AtmosphereComposition;
    if (
      Array.isArray(incoming) &&
      incoming.length === 0 &&
      Array.isArray(prev?.atmosphereComposition) &&
      prev.atmosphereComposition.length > 0
    ) {
      /* Keep prev detailed composition — later basic scans sometimes send empty arrays. */
    } else {
      rec.atmosphereComposition = incoming;
    }
  }
  if (line.Materials !== undefined) {
    const incoming = line.Materials;
    if (
      Array.isArray(incoming) &&
      incoming.length === 0 &&
      Array.isArray(prev?.materials) &&
      prev.materials.length > 0
    ) {
      /* Keep prev detailed materials — basic / repeat scans often carry Materials: [] and would wipe Zinc etc. */
    } else {
      rec.materials = incoming;
    }
  }
  if (line.Composition !== undefined) {
    const incoming = line.Composition;
    const ik = incoming && typeof incoming === "object" ? Object.keys(incoming as object).length : 0;
    const pk =
      prev?.composition && typeof prev.composition === "object"
        ? Object.keys(prev.composition as object).length
        : 0;
    if (ik === 0 && pk > 0) {
      /* Same pattern as materials: do not replace rich composition with an empty object. */
    } else {
      rec.composition = line.Composition;
    }
  }

  const fresh = store.scanIndexIsFresh();
  store.explorationScans.set(k, rec);
  store.explorationScansRevision += 1;
  store.edsmExplorationByKey.delete(k);
  // Scanned again after the sale: the live row is the better copy of the same physics.
  const wasSold = store.soldExplorationScans.delete(k);
  store.patchScanIndex(fresh, wasSold ? [{ kind: "live", rec }, { kind: "sold", rec, drop: true }] : [{ kind: "live", rec }]);

  // The barycentre a moon shares with its twin (the map's name is older than the rule).
  const moonOf = moonPairBarycentreId(rec.parents);
  store.setOrbitParent(systemAddress, bodyId, moonOf);

  const inCurrentSystem = store.currentSystemAddress !== null && systemAddress === store.currentSystemAddress;
  if (moonOf != null && inCurrentSystem) {
    ensureBody(
      store.bodies,
      systemAddress,
      bodyId,
      rec.bodyName,
      rec.starSystem?.trim() || store.currentSystem || "",
      ts,
    );
    syncExoStateFromSiblingMoons(store, systemAddress, bodyId, ts);
  }
}

/**
 * When a merged `Scan` row establishes a moon's parent planet, pull FSS/DSS/detailed scan data from a sibling
 * if this body was missing it (journal lines can arrive with FSS/DSS on moon B before B's first `Scan`).
 */
export function syncExoStateFromSiblingMoons(store: GameStateStore, systemAddress: number, bodyId: number, ts: string): void {
  const sk = bodyKey(systemAddress, bodyId);
  const self = store.bodies.get(sk);
  if (!self) return;
  const selfRec = store.explorationScans.get(sk) ?? null;
  let changed = false;

  for (const bid of siblingMoonBodyIdsUnified(store, systemAddress, bodyId)) {
    const sib = store.bodies.get(bodyKey(systemAddress, bid));
    if (!sib) continue;
    const sibRec = store.explorationScans.get(bodyKey(systemAddress, bid)) ?? null;
    if (selfRec && sibRec && !explorationRecordsSimilarForSharedExo(selfRec, sibRec)) continue;

    /*
      Fill a gap, never outbid the game.

      The docstring above says "if this body was missing it", and taking the larger of the two is
      not that: a moon the game said has two signals would be raised to a neighbour's three, and
      the panel would then insist a genus was missing from a body that never had one. Only a body
      the game has not spoken about can inherit a count. See `propagateExoAmongSimilarMoons`.
    */
    const selfOwnCount = store.fssBodySignalsBodyKeys.has(sk);
    if (sib.biologicalSignals != null && !selfOwnCount) {
      const n = self.biologicalSignals ?? 0;
      if (sib.biologicalSignals > n) {
        self.biologicalSignals = sib.biologicalSignals;
        changed = true;
      }
    }
    /*
      A body the commander has DSS'd already knows its own genera, and that list is complete.

      `SAASignalsFound` names every genus on the body — the whole "1 genus missing" alert is built
      on that being true. So a neighbour's genus is a *guess* worth having only while this body has
      no answer of its own; once it does, adding to it invents biology the game has ruled out.

      The report that found it, on `Plio Aip NM-U d3-13 4 c`. A DSS emits three lines at once:

      ```
        02:33:06  SAAScanComplete   4 c
        02:33:06  SAASignalsFound   4 c   Genuses: Bacterium, Tussock      <- replaces, correctly
        02:33:06  Scan              4 c                                    <- lands here
      ```

      That trailing `Scan` ran this sync, which merged sibling 4 b's [Bacterium, Tubus, Tussock]
      back over the answer the game had just given, and Tubus reappeared on a body the commander
      had personally confirmed does not have it.

      `dssMappedBodyKeys` is the right test and not `dssComplete`, which propagates between
      siblings and so cannot say whose DSS it was.
    */
    const selfOwnGenera = store.dssMappedBodyKeys.has(sk);
    if (sib.genusHints?.length && !selfOwnGenera) {
      const merged = mergeGenusHints(self.genusHints, sib.genusHints);
      if (merged && merged.length > (self.genusHints?.length ?? 0)) {
        self.genusHints = merged;
        changed = true;
      }
    }
    if (sib.dssComplete && !self.dssComplete) {
      self.dssComplete = true;
      changed = true;
    }
    if (sib.scan?.PlanetClass && !self.scan?.PlanetClass) {
      self.scan = buildSiblingPlanetScan(store, sib.scan, systemAddress, bodyId, selfRec);
      changed = true;
    }
  }
  if (changed) self.updatedAt = ts;
}

/**
 * Moons of the same planet typically share biological signals, DSS genus lists, mapped state, and surface stats.
 * Mirrors FSS → `fss_signals`, DSS probe → `saas_signals`, DSS complete → `dss_complete`, detailed `Scan` →
 * `detailed_scan`, ScanOrganic → `organic`.
 */
export function propagateExoAmongSimilarMoons(
  store: GameStateStore,
  sourceBodyId: number,
  systemAddress: number,
  ts: string,
  mode: "fss_signals" | "saas_signals" | "dss_complete" | "detailed_scan" | "organic",
): void {
  const sk = bodyKey(systemAddress, sourceBodyId);
  const sourceBody = store.bodies.get(sk);
  if (!sourceBody) return;

  const sourceRec = store.explorationScans.get(sk) ?? null;
  if (!sourceRec && !store.orbitParentPlanetByBody.has(sk)) return;

  for (const bid of siblingMoonBodyIdsUnified(store, systemAddress, sourceBodyId)) {
    const sibRec = store.explorationScans.get(bodyKey(systemAddress, bid)) ?? null;
    if (sourceRec && sibRec && !explorationRecordsSimilarForSharedExo(sourceRec, sibRec)) continue;

    const sibName =
      sibRec?.bodyName?.trim() ||
      store.bodies.get(bodyKey(systemAddress, bid))?.bodyName?.trim() ||
      `Body ${bid}`;
    const sibStar = sibRec?.starSystem?.trim() || sourceRec?.starSystem?.trim() || store.currentSystem || "";
    const b = ensureBody(store.bodies, systemAddress, bid, sibName, sibStar, ts);

    /**
     * The sibling's own count, when the game has given it one, outranks anything inherited.
     *
     * `FSSBodySignals` is per body: the game says how many signals *that* rock has. Copying a
     * neighbour's count over it invents biology. On `Plio Aip NM-U d3-13` the owner's 4 c reported
     * two signals at 02:01:19 and 4 b's DSS reported three at 02:03:50; the propagation overwrote
     * the two with three, and since 4 b's genera came with it — Bacterium, Tubus, Tussock — the
     * panel then raised "1 genus missing from the candidate list" against a body that never had
     * three signals and was never DSS'd. The gate it accused was correct: 4 c is 154 K and every
     * Tubus starts at 160.
     *
     * Hints merge (below) because a genus really seen next door is worth suggesting here. A count
     * cannot merge — it is a fact about one body, and the sibling's own is the only one that is
     * about this one.
     */
    const sibOwnCount = store.fssBodySignalsBodyKeys.has(bodyKey(systemAddress, bid));
    /**
     * And the same for the genus list: a sibling the commander has DSS'd knows its own genera, and
     * `SAASignalsFound` names all of them. Suggesting a neighbour's extra genus there contradicts
     * the game. See the matching note in {@link syncExoStateFromSiblingMoons}.
     */
    const sibOwnGenera = store.dssMappedBodyKeys.has(bodyKey(systemAddress, bid));

    if (mode === "fss_signals") {
      if (sourceBody.biologicalSignals != null && !sibOwnCount)
        b.biologicalSignals = sourceBody.biologicalSignals;
      if (sourceBody.genusHints?.length && !sibOwnGenera) {
        b.genusHints = mergeGenusHints(b.genusHints, sourceBody.genusHints);
      }
      if (sourceBody.signalHints?.length) {
        const set = new Set<string>([...(b.signalHints ?? []), ...sourceBody.signalHints]);
        b.signalHints = set.size ? [...set] : b.signalHints;
      }
    } else if (mode === "saas_signals") {
      if (sourceBody.biologicalSignals != null && !sibOwnCount)
        b.biologicalSignals = sourceBody.biologicalSignals;
      // Merge, never replace: the sibling's own DSS result is at least as authoritative as this
      // one's, and overwriting it deleted genera the commander went on to scan there. See the
      // `fss_signals` branch above, which has always merged.
      if (sourceBody.genusHints?.length && !sibOwnGenera) {
        b.genusHints = mergeGenusHints(b.genusHints, sourceBody.genusHints);
      }
      if (sourceBody.signalHints?.length) {
        const set = new Set<string>([...(b.signalHints ?? []), ...sourceBody.signalHints]);
        b.signalHints = set.size ? [...set] : b.signalHints;
      }
    } else if (mode === "dss_complete") {
      b.dssComplete = true;
      if (sourceBody.genusHints?.length && !sibOwnGenera) {
        b.genusHints = mergeGenusHints(b.genusHints, sourceBody.genusHints);
      }
      if (sourceBody.biologicalSignals != null && !sibOwnCount)
        b.biologicalSignals = sourceBody.biologicalSignals;
    } else if (mode === "detailed_scan") {
      const srcScan = sourceBody.scan;
      if (srcScan?.PlanetClass) {
        b.scan = buildSiblingPlanetScan(store, srcScan, systemAddress, bid, sibRec);
      }
    } else {
      const seen = new Set(b.organicGenusLocks.map(organicLockGenusKey));
      for (const lock of sourceBody.organicGenusLocks) {
        const gk = organicLockGenusKey(lock);
        if (gk && seen.has(gk)) continue;
        if (gk) seen.add(gk);
        // A hint for the match here, not progress: nobody sampled anything on this moon.
        const copy: OrganicGenusLock = { ...lock, fromSibling: true };
        delete copy.samples;
        delete copy.analysed;
        delete copy.at;
        b.organicGenusLocks.push(copy);
      }
      /*
       * Logged variants are NOT copied (owner, 2026-09-26). A variant is what was logged on that
       * moon; copied here it read as this moon's own colour: 76 Leonis 6 a, d, f and g all showed
       * "Osseus Discus - Red" from one scan, overrode their own material prediction, and went in
       * the outliers file as colour misses on moons nobody had set foot on.
       */
    }
  }
}
