import type {
  RemoteSystemRecord,
  BodyExoState,
  ExplorationScanRecord,
  JournalLine,
  SpeciesEntry,
  AppSnapshot,
  HudPrefsDTO,
  SystemKind,
  SystemLife,
  PhotoStampPrefs,
} from "../shared/types.js";
import { commanderFirstDiscoveredBody, isDeveloperPopulatedSystem } from "./developerPopulatedSystems.js";
import type { JournalHistoryPreset } from "../shared/journalHistoryPreset.js";
import {
  JOURNAL_POLL_DEFAULT_MS,
  STATUS_POLL_DEFAULT_MS,
  clampJournalPollMs,
  clampStatusPollMs,
} from "../shared/pollRates.js";
import { RADAR_RADIUS_DEFAULT_M, clampRadarRadiusM } from "../shared/radarRadius.js";
import {
  UNOBSERVED,
  mergeObservation,
  type ObservationSource,
  type ObservedFlag,
} from "../shared/observedFlag.js";
import { speciesKeyFromOrganicJournal, speciesEntryMatchesOrganicLabel, normOrganicToken } from "./organicTracking.js";
import { getProjectRoot } from "./paths.js";
import { sanitizeHudPrefs } from "./hudPrefsSanitize.js";
import { explorationRecordIsBeltClusterLike } from "./explorationStellar.js";
import { greatCircleDistanceMeters, type FootTravelFix, type StatusDestination } from "./footTravelStatus.js";
import type { ExoOrganicTrackerInternal } from "./exoOrganicTracker.js";
import { clearPersistedOrganicSampleSession, normStatusBodyName } from "./organicSampleSessionFile.js";
import {
  loadSurfaceMarks,
  scheduleSaveSurfaceMarks,
  MAX_SURFACE_MARKS,
  type SurfaceMark,
} from "./surfaceMarksFile.js";
import { finalisePredictionsForSystem } from "./predictionAuditLog.js";
import { remoteBodyStates } from "./remoteSystems.js";
import type { NavRouteWaypointDTO } from "./navRouteFuel.js";
import { regionJoinKey } from "../shared/regionMap.js";
import { codexEntryKey } from "../shared/codexLog.js";
import { isLegacyPlantKey } from "../shared/achievements.js";
import { regionForSystem } from "./regionMapData.js";
import { parseBoxel } from "../shared/boxel.js";
import { emptyFsdFuel, fsdFuelCargo, fsdFuelEngineerCraft, fsdFuelJump, type FsdFuelState } from "../shared/fsdFuel.js";
import { fsdWearJump, fsdWearRepair, newFsdWear, type FsdWearState } from "../shared/fsdWear.js";
import { newOwnAssets, ownAssetsLine, type OwnAssetsState } from "../shared/ownAssets.js";
import { JUMPONIUM_EVENTS, jumponiumLine, newJumponium, type JumponiumState } from "../shared/jumponium.js";
import {
  newShipDamage,
  shipDamageAfmu,
  shipDamageForget,
  shipDamageHull,
  shipDamageRepair,
  shipDamageVehicle,
  type ShipDamageState,
} from "../shared/shipDamage.js";
import { emptyJumpRange, jumpRangeJump, type JumpRangeState } from "../shared/jumpRange.js";
import { createGreenCodexMatcher } from "../shared/greenCodexMatch.js";
import { bodyKey, systemAddressOfBodyKey } from "../shared/bodyKey.js";
import type {
  PendingOrganicSample,
  OrganicAnalyseProgress,
  SoldTally,
  JournalMergeCachePayload,
} from "./journalMergePayload.js";
export { JOURNAL_MERGE_CACHE_FORMAT } from "./journalMergePayload.js";
export type {
  PendingOrganicSample,
  OrganicAnalyseProgress,
  SoldTally,
  JournalMergeCachePayload,
} from "./journalMergePayload.js";
import { signsOfLife } from "./gameStateHelpers.js";
// The event handlers, data sales, scan merging (item 30, 1.3.1) and the cache payload (1.3.2) are functions over the
// store in these modules; the members they read are not `private` for that reason.
import * as journalEvents from "./gameStateEvents.js";
import * as explorationSales from "./gameStateSales.js";
import * as explorationMerge from "./gameStateExploration.js";
import * as journalPayload from "./gameStatePayload.js";
// tests/genusProgress.test.ts imports upsertFootOrganicLock from here.
export { signsOfLife, upsertFootOrganicLock } from "./gameStateHelpers.js";

/** Recent journal lines (chronological) for foot-catalog naming: find body label on lines *before* each `ScanOrganic` Analyse. */

/** orbitParentsInSystem's answer for a system with no moons on a barycentre, shared. */
const EMPTY_ORBIT_PARENTS: ReadonlyMap<number, number> = new Map();

export class GameStateStore {
  /** From journal `LoadGame.Commander` (latest session in merged logs). */
  commanderName: string | null = null;
  /** `LoadGame.FID` / `Commander.FID` — whose shared-exomastery files are this commander's own (§S). */
  commanderFid: string | null = null;
  currentSystem: string | null = null;
  currentSystemAddress: number | null = null;
  /**
   * When set, the UI lists bodies for this system instead of `currentSystemAddress`.
   * Cleared on FSD/carrier jump so the app tracks the commander again.
   */
  viewingSystemAddress: number | null = null;
  /** Systems seen in the merged journal (jumps, Location, FSS complete) for picker / search. */
  readonly visitedSystems = new Map<number, string>();
  /**
   * Systems he targeted in the galaxy map (`FSDTarget`, every one in the journals): name and the star
   * class the game gave. They exist, so a saved boxel reaches at least that far (auto-boxel detector,
   * owner 2026-10-06).
   */
  readonly targetedSystems = new Map<number, { name: string; starClass: string }>();
  /**
   * The NavRoute finder's "Previous" list (owner, 2026-10-04): when each system was last arrived in
   * (jump, carrier jump or a load there), and its star class as the jump to it named it (StartJump).
   */
  readonly systemVisitedAt = new Map<number, string>();
  readonly systemStarClass = new Map<number, string>();

  /**
   * Has the commander already been to this system, by name?
   *
   * `visitedSystems` is keyed by address, which the NavRoute does not carry for the hops ahead — it
   * has names and star classes only. The first-footfall lookup needs the name form so it can settle
   * "not first" from the journals rather than asking EDSM about a system he has already flown to.
   */
  hasVisitedSystemNamed(systemName: string): boolean {
    const want = systemName.trim().toLowerCase();
    if (!want) return false;
    if (this.visitedSystemNames === null) {
      this.visitedSystemNames = new Set([...this.visitedSystems.values()].map((n) => n.toLowerCase()));
    }
    return this.visitedSystemNames.has(want);
  }

  /** Lazily built from {@link visitedSystems}; invalidated whenever that map changes. */
  visitedSystemNames: Set<string> | null = null;
  readonly bodies = new Map<string, BodyExoState>();
  /**
   * Merged `Scan` rows for bodies in-system (basic + detailed) for system map / exploration estimates.
   * Key: `${systemAddress}:${bodyId}` (not cleared on jump — keyed by address).
   */
  readonly explorationScans = new Map<string, ExplorationScanRecord>();

  /**
   * Scan rows kept for their physics after the commander sold the system's cartographic data.
   *
   * Selling clears {@link explorationScans} for that system, because everything the app says about
   * payouts, first discovery and first mapping has to go with it. That was right for value and
   * wrong for everything else: the same record carries surface gravity, materials, solid
   * composition and — through the system's star rows — the body's host star. The commander sells
   * almost everything, so 13,713 scanned bodies had shrunk to 676 usable scan rows across 75
   * systems, and the matcher was scoring history with the star and composition terms permanently
   * blank.
   *
   * Nothing that computes credits, eligibility or map state may read this map. It is physics only:
   * what the body is, never what it is worth. {@link physicsExplorationScan} is the one accessor.
   */
  readonly soldExplorationScans = new Map<string, ExplorationScanRecord>();

  /**
   * Every body whose cartographic data has been sold, for good.
   *
   * Scanning a sold body again moves its row back into {@link explorationScans} (the live copy is the
   * better physics), and until now that also put its value back into the unsold total — the arrival
   * star of a home system, every time he came back. Universal Cartographics does not buy the same
   * body twice, so the value estimate skips these keys (owner, 2026-09-25: a re-scan after a sale
   * does not count again). Data lost on death is *not* added here: it can be scanned and sold again.
   */
  readonly soldBodyKeys = new Set<string>();

  /**
   * Bumped on every write to {@link explorationScans}. Consumers cache per-system indexes and
   * per-body computations keyed on this — records are replaced rather than mutated, so map size
   * alone is not a safe signature.
   */
  explorationScansRevision = 0;
  /**
   * What cartographic data has actually paid, per system.
   *
   * The journal reports a sale, not a price list: `MultiSellExplorationData` carries one
   * `TotalEarnings` for a batch of systems and only `NumBodies` to tell them apart. So the batch is
   * **apportioned** by body count — a system with twice the bodies is credited twice the earnings.
   * That is an estimate of a real number rather than a real number, and anything that shows it has
   * to say so; it is still far closer to the truth than the per-body model, which never sees a
   * bonus or a discount and cannot know what the commander chose to sell.
   *
   * Recorded before the sale clears the system's scan rows, or there would be nothing left to
   * attribute it to.
   */
  readonly soldExplorationBySystem = new Map<number, SoldTally>();

  /**
   * What exobiology has actually paid, per system.
   *
   * Exact, unlike the exploration side. `SellOrganicData` names a value and a bonus per species, and
   * the pending-sale queue still knows which body each completed sample came from — so the credits
   * land on the system the commander actually walked on rather than the station he sold at.
   */
  readonly soldOrganicBySystem = new Map<number, SoldTally>();

  /**
   * EDSM fallback rows for system map only (no journal `Scan` in merged logs for that system).
   * Cleared per body when a real journal {@link mergeExplorationScan} arrives.
   */
  readonly edsmExplorationByKey = new Map<string, ExplorationScanRecord>();

  /**
   * Systems looked up from Spansh (see `remoteSystems.ts`). Not journal data: not in the merge cache,
   * not cleared by a re-merge, not counted anywhere the commander's own record is. Read only when the
   * journals have nothing on the system — a system he has flown to always shows his own data.
   */
  readonly remoteSystems = new Map<number, RemoteSystemRecord>();
  /** A lookup in flight or failed, per system — transient, for the screen to say so. */
  readonly remoteLookups = new Map<
    number,
    { starSystem: string; state: "loading" | "error"; error?: string }
  >();
  /** Bodies with at least one journal `FSSBodySignals` line (FSS “scan” of that body); keyed globally, not current system only. */
  readonly fssBodySignalsBodyKeys = new Set<string>();
  /** Bodies that completed DSS probe mapping (`SAAScanComplete` in journal); keyed globally. */
  readonly dssMappedBodyKeys = new Set<string>();
  /**
   * Bodies that were mapped when their data left {@link dssMappedBodyKeys} (sold, or lost on death).
   * The value is gone, the mapping happened: the Notable card and overlay still show a sold body as
   * mapped (2026-09-30). Only read for rows of the sold archive — a live re-scan uses the live set.
   */
  readonly archivedDssMappedBodyKeys = new Set<string>();
  /**
   * First-mapper bonus eligibility frozen at `SAAScanComplete` from merged `Scan.WasMapped` at that time.
   * Later `Scan` lines often set `WasMapped: true` after your map; without this, DSS estimates wrongly drop the bonus.
   */
  readonly dssFirstMapperEligibleByBodyKey = new Map<string, boolean>();
  /** `SAAScanComplete`: `ProbesUsed` <= `EfficiencyTarget` — optional tail multiplier on mapped estimate. */
  readonly dssMappingEfficientByBodyKey = new Map<string, boolean>();
  /**
   * Twin moons: maps `systemAddress:bodyId` → the **barycentre** it shares with its twin, from journal
   * `Parents` (`moonPairBarycentreId`; the parent planet until 2026-10-04, hence the name). Lets FSS/DSS
   * propagate before both moons have a full merged `Scan` row.
   */
  readonly orbitParentPlanetByBody = new Map<string, number>();
  lastEventIso: string | null = null;

  /**
   * Sliding window of merged journal JSON lines in **time order** (oldest → newest).
   * Used only to resolve `Body` / `BodyName` from the nearest prior journal entry for a given
   * `systemAddress` + body id — **not** tied to the commander's “current” system.
   */
  readonly footJournalContextBuffer: JournalLine[] = [];

  /**
   * Exobiology analyse progress per body + codex identity (from ScanOrganic).
   * Key: `${systemAddress}:${bodyId}::${speciesKey}`
   */
  readonly organicAnalyseByKey = new Map<string, OrganicAnalyseProgress>();
  /**
   * Latest `WasFootfalled` from journal detailed scans per body (systemAddress:bodyId).
   * false = no footfall yet at time of that scan; used with Disembark to detect first footfall.
   */
  readonly bodyDetailedFootfallState = new Map<string, boolean>();
  /**
   * Footfall and mapping as tri-states with provenance — INCLUDE-BODY-IDS Phase 3.
   *
   * {@link bodyDetailedFootfallState} above is now a **projection** of `bodyFootfallFlag`, kept
   * because the payout path and the merge cache both speak boolean. Everything writes through
   * {@link observeFootfall} / {@link observeMapped}, so the two cannot drift, and the sticky-`true`
   * rule now applies to the payout path as well rather than only to the new surface.
   *
   * The flags carry what a bare boolean cannot: **when** the claim was made, and by whom. A `false`
   * is only true as of its timestamp, and rung 2 of the target ladder is meaningless without a date
   * (§1.5, §2.7).
   */
  readonly bodyFootfallFlag = new Map<string, ObservedFlag>();
  readonly bodyMappedFlag = new Map<string, ObservedFlag>();

  /**
   * Record a footfall observation. The merge rules live in `observedFlag.ts`, not here — this is
   * the only place the app folds one in, which is what makes a journal re-scan idempotent.
   */
  observeFootfall(bk: string, value: boolean, source: ObservationSource, seenAt: string): void {
    // A populated or colonising system has no unwalked ground: whatever the scan says, no bonus.
    if (value === false && this.noFirstFootfallInSystem(systemAddressOfBodyKey(bk))) {
      value = true;
      source = "populated";
    }
    const merged = mergeObservation(this.bodyFootfallFlag.get(bk) ?? UNOBSERVED, { value, source, seenAt });
    this.bodyFootfallFlag.set(bk, merged);
    if (merged.value !== null) this.bodyDetailedFootfallState.set(bk, merged.value);
  }

  /** Record a mapping observation. Same rules, same reason. */
  observeMapped(bk: string, value: boolean, source: ObservationSource, seenAt: string): void {
    this.bodyMappedFlag.set(
      bk,
      mergeObservation(this.bodyMappedFlag.get(bk) ?? UNOBSERVED, { value, source, seenAt }),
    );
  }
  /** Bodies where this commander gets first-footfall organic payout (1× + 4× bonus = 5× list in valuation). */
  readonly firstFootfallBodies = new Set<string>();

  /**
   * Signs of life per system, read off the arrival line (owner, 2026-09-25).
   *
   * Tewi C 5 — a 95M body in the Bubble — showed ×5 and paid ×1: planets in populated systems never
   * show a first footfall, whatever a scan's `WasFootfalled` says. The owner's sales agree: no sale
   * from a populated system (98) or a colony (10) needs a bonus to explain it.
   *
   * His order of checks, each one a sign that somebody is here:
   *
   *   0. `WasDiscovered: false` on the arrival star — this commander is the first in the system, so
   *      none of the rest can apply and the planet's own scan decides. See
   *      {@link noFirstFootfallInSystem}; the star's scan lands after the jump, so it is read there.
   *   1. `Population` > 0 → `populated`.
   *   2. Security or government other than anarchy / none → `facility` (a detention centre has no
   *      people but a Prison government).
   *   3. A controlling faction → `claimed` when that is all there is (a colonisation claim under
   *      construction: Luyten 143-23 and Col 285 Sector AK-W b16-5 read like this and are colonies
   *      now), `facility` otherwise.
   *   4. Only when the journal shows none of these: the list of systems Frontier populated.
   */
  readonly systemLife = new Map<number, SystemLife>();

  systemKind(systemAddress: number): SystemKind | null {
    const life = this.systemLife.get(systemAddress);
    if (life === "populated") return isDeveloperPopulatedSystem(systemAddress) ? "bubble" : "colony";
    if (life === "claimed") return "colonising";
    if (life === "facility") return "facility";
    // The file is the last resort: nothing in the journal showed life.
    if (isDeveloperPopulatedSystem(systemAddress)) return "bubble";
    return this.visitedSystems.has(systemAddress) ? "empty" : null;
  }

  /**
   * Did this commander discover this system? The arrival star's `WasDiscovered`, except in a system
   * Frontier populated, where it is never true — see {@link commanderFirstDiscoveredBody}.
   * Null when the arrival star has not been scanned.
   */
  commanderDiscoveredSystem(systemAddress: number): boolean | null {
    const wd = this.mainStarWasDiscoveredBySystem.get(systemAddress);
    if (typeof wd !== "boolean") return null;
    return commanderFirstDiscoveredBody(systemAddress, wd);
  }

  /**
   * No first-footfall bonus anywhere in this system — unless this commander discovered it.
   *
   * "Discovered it" goes through {@link commanderDiscoveredSystem}, not the raw star flag: Barnard's
   * Star, Alpha Centauri, Ross 775 and Procyon have arrival stars that say `WasDiscovered: false`, and
   * that alone used to skip every check below and bring the ×5 back in the Bubble.
   */
  noFirstFootfallInSystem(systemAddress: number): boolean {
    if (this.commanderDiscoveredSystem(systemAddress) === true) return false;
    const k = this.systemKind(systemAddress);
    return k !== null && k !== "empty";
  }

  /** Read the signs of life off an arrival line; mark every known body walked if the system has any. */
  notePopulation(line: JournalLine, ts: string): void {
    const e = line as Record<string, unknown>;
    const addr = e.SystemAddress;
    if (typeof addr !== "number") return;
    const life = signsOfLife(e);
    if (life === undefined) return; // the line does not say (an old or partial event)
    const before = this.noFirstFootfallInSystem(addr);
    if (life) this.systemLife.set(addr, life);
    else this.systemLife.delete(addr);
    if (before || !this.noFirstFootfallInSystem(addr)) return;
    const prefix = `${addr}:`;
    for (const bk of [...this.bodyFootfallFlag.keys()]) {
      if (bk.startsWith(prefix)) this.observeFootfall(bk, false, "journal", ts);
    }
    for (const bk of [...this.firstFootfallBodies]) {
      if (bk.startsWith(prefix)) this.firstFootfallBodies.delete(bk);
    }
  }

  /**
   * Species this commander has a codex page for, by `codexSpeciesKey` (B4).
   *
   * Collected from every `CodexEntry` in the merged journals, colour variant stripped: the variant is
   * a fact about the host star, and the same species is amethyst in one system and emerald in the
   * next. What the app does with it is the opposite of a warning — a species *missing* from here is
   * the one a codex hunter wants to fly to.
   */
  readonly codexLoggedSpecies = new Set<string>();
  /** `region|species|colour` (and `region|species|*`) for every organic codex entry — [CODEX], shared/codexLog.ts. */
  readonly codexRegionLogged = new Set<string>();
  /**
   * `regionJoinKey|entryKey` for every `CodexEntry`, any category (stars, planets, geology, plants,
   * space life) — the Codex map colours EDSM's systems by these (owner, 2026-09-27).
   */
  readonly codexMapLogged = new Set<string>();
  /**
   * `speciesKey|regionJoinKey|systemAddress` → earliest timestamp, for every biological `CodexEntry`.
   * The species rarity adds the ones newer than its EDSM dump, so the tiers and region counts move
   * with what the commander logs (owner, 2026-09-27: "make it dynamic").
   */
  readonly codexSightings = new Map<string, string>();
  /**
   * Achievements (owner, 2026-09-27): `regionJoinKey|entryKey` → earliest time the plant counted —
   * the third sample of a sampled genus, the codex line of a legacy one. Journals only.
   */
  readonly achievementDone = new Map<string, string>();
  /** Region of each system from its `CodexEntry` lines (the only journal event naming one). */
  readonly codexRegionBySystem = new Map<number, string>();
  /**
   * Bodies the codex logged as a green gas giant: `bodyKey` → codex id (shared/greenGasGiant.ts). The
   * codex line's own `BodyID` is the body the ship was at, not the one scanned (2026-10-08), so the
   * body is the fitting gas giant scanned with it (shared/greenCodexMatch.ts).
   */
  readonly greenCodexBodies = new Map<string, string>();
  readonly greenCodexMatcher = createGreenCodexMatcher();
  /** Systems where the codex logged a K10-Type Anomaly — an NSP that only spawns around green gas giants. */
  readonly k10Systems = new Set<number>();
  /**
   * Notable stellar phenomena this commander met, per system (owner, 2026-09-30: "check how they are
   * reported"): the FSS says one is there on arrival (`$Fixed_Event_Life_…`, type Codex), and a
   * `CodexEntry` of a phenomenon family names it once he drops in. Names, or "" for a signal not yet named.
   */
  readonly nspSeen = new Map<number, string[]>();
  /** The achievement the commander tracks (a user preference, not journal state). */
  trackedAchievementId: string | null = null;

  /**
   * How long this commander's own trips actually take, in minutes (B5).
   *
   * The triage screen ships with medians measured from one commander's 244 journals — 1.2 minutes to
   * land, 2.5 to sample a genus — and those are *this* commander's habits, not a constant of the
   * game. Somebody who flies an Anaconda and takes their time is not somebody in a Mandalay who does
   * not. B5 asked for knobs; the app can measure instead, from the journals it already reads, and a
   * measured number beats one the user has to guess at.
   *
   * Collected on replay: `SupercruiseExit` to `Touchdown` on the same body, and the first
   * `ScanOrganic` sample of a species to its `Analyse`.
   */
  readonly landingMinutesSamples: number[] = [];
  readonly samplingMinutesSamples: number[] = [];
  /** Open legs, cleared as they complete. Not persisted: a half-finished trip is not a measurement. */
  scExitAt: { at: number; body: string } | null = null;
  organicRunStartedAt = new Map<string, number>();
  /** Completed samples (3× Analyse) not removed by SellOrganicData / Died — FIFO for sales without body on BioData. */
  pendingOrganicSales: PendingOrganicSample[] = [];

  /** SystemAddress values where journal reported `FSSAllBodiesFound` (FSS discovery pass finished). */
  readonly fssAllBodiesCompleteSystems = new Set<number>();
  /**
   * Authoritative body tally from journal `FSSAllBodiesFound.Count` when present (stars/planets/moons count).
   */
  readonly fssAllBodiesFoundCountBySystem = new Map<number, number>();
  /**
   * Latest merged journal `FSSDiscoveryScan` (honk) per system.
   * `bodyCount` is bodies only (stars/planets/moons); `progress` is 0–1 FSS discovery progress.
   */
  readonly fssDiscoveryScanBySystem = new Map<
    number,
    { systemName: string; bodyCount: number; progress: number }
  >();

  /**
   * Whether each system's **main star** had been discovered before this commander scanned it.
   *
   * Populated from `Scan`, which is the only event that carries `WasDiscovered`. It used to be fed
   * from `FSDJump` / `CarrierJump`, which never carry it — measured across this commander's 244
   * journals, the field appears on 0 of 6,549 of those events — so the map was permanently empty and
   * the "FIRST" badge that reads it had never once rendered.
   *
   * Keyed on the main star rather than on any body because that is what the badge claims. A body can
   * be undiscovered inside a system somebody else found: of the 1,159 systems where this commander
   * was first to scan *something*, 672 had a primary that was already known. Counting those as a
   * system discovery would inflate the badge nearly threefold.
   *
   * Absent means "no main-star scan yet", which is not the same as `true` — 1,417 of 2,847 visited
   * systems have no `BodyID 0` scan at all, and the badge must stay silent for those rather than
   * claim the system was already found.
   */
  readonly mainStarWasDiscoveredBySystem = new Map<number, boolean>();
  /**
   * How good the evidence behind each {@link mainStarWasDiscoveredBySystem} entry is: `0` for the
   * arrival star, `1` for a body-zero fallback. A better source replaces a worse one whenever it
   * turns up, and journals do not arrive in body order.
   *
   * Not persisted: it only resolves ties while merging, and a replay rebuilds it.
   */
  readonly mainStarSourceRankBySystem = new Map<number, number>();
  remainingJumpsInRoute: number | null = null;

  /** Journal `Loadout` / `LoadGame` — FSD range with minimal fuel (Ly). */
  loadoutMaxJumpRangeLy: number | null = null;
  /** From journal `Loadout.FuelCapacity` (tonnes). */
  loadoutFuelMainCapacityT: number | null = null;
  loadoutFuelReserveCapacityT: number | null = null;
  /** Latest `FSDJump` sample for fuel-per-ly calibration. */
  lastFsdJumpFuelUsedT: number | null = null;
  lastFsdJumpDistLy: number | null = null;
  /** The FSD is supercharged (`JetConeBoost`'s BoostValue) until the next jump; null when it is not. */
  jetConeBoost: number | null = null;
  /** The full jump range as flown: boosted jumps and economical-route hops left out (shared/jumpRange.ts). */
  jumpRange: JumpRangeState = emptyJumpRange();
  /** The drive's fuel per jump, fitted on the commander's jumps (shared/fsdFuel.ts). */
  fsdFuel: FsdFuelState = emptyFsdFuel();
  /** The FSD's health from Loadout and its wear per neutron supercharge (shared/fsdWear.ts, plan 8.4). */
  fsdWear: FsdWearState = newFsdWear();
  /** The ship's damage part by part, for the HUD's Ship section (shared/shipDamage.ts, discuss item 32). */
  shipDamage: ShipDamageState = newShipDamage();
  /** The commander's own fleet carrier and colonised systems (shared/ownAssets.ts), for the map's badges. */
  ownAssets: OwnAssetsState = newOwnAssets();
  /** Raw materials aboard and the FSD injections made (shared/jumponium.ts). */
  jumponium: JumponiumState = newJumponium();
  /** Live `Status.json` cargo (tonnes): the ship's mass now, for forecasts (the samples use the journal's, fsdFuel.ts). */
  liveStatusCargoT: number | null = null;
  /** When that cargo was read (ms): a jump the journal has no cargo for may take it only if made then. */
  liveStatusCargoAtMs: number | null = null;

  /** From live `Status.json` poll (tonnes); null when file missing or parse failed. */
  liveStatusFuelMainT: number | null = null;
  liveStatusFuelReserveT: number | null = null;
  private lastLiveShipFuelPushKey: string | null = null;

  /** Parsed `NavRoute.json` from the journal folder (live file; not journal-cached). */
  liveNavRoute: NavRouteWaypointDTO[] | null = null;
  private lastLiveNavRoutePushKey: string | null = null;

  /** User pref: show HUD + poll Status.json (launcher / settings). */
  footTravelOdometerEnabled = false;
  /** User pref: extra lines on a branded panel snapshot (Options), all off by default. */
  photoStamp: PhotoStampPrefs = { commander: false, system: false, timestamp: false };
  /** True while odometer accumulates distance for the persisted organic sample session body. */
  footTravelOdometerTracking = false;
  /** Metres accumulated while tracking (great-circle); cleared when a new tracking session starts or pref off. */
  footTravelDistanceMeters = 0;
  footTravelPrevLat: number | null = null;
  footTravelPrevLon: number | null = null;
  footTravelLastPlanetRadiusM: number | null = null;

  /**
   * Foot odometer is only counted when `Status.json` body name matches this normalized name (same session body).
   */
  footSessionBodyKey: string | null = null;
  footSessionBodyNameNorm: string | null = null;

  /** Electron overlay: live organic sample distance (see `exoOrganicTracker.ts`). */
  exoOrganicTracker: ExoOrganicTrackerInternal | null = null;
  /** Latest Status.json fix; updated on poll when overlay may be active. */
  exoOrganicLastFix: FootTravelFix | null = null;
  /** Latest `Status.json` `Destination` (targeted body), for the HUD; null when none is set. */
  statusDestination: StatusDestination | null = null;
  /**
   * The system locked in the nav panel (`FSDTarget`), which fires well before the countdown. Cleared
   * on arriving there. Second rung of the next-jump ladder, see {@link nextJumpTarget}.
   */
  fsdTarget: { starSystem: string; systemAddress: number; starClass: string; at: string } | null = null;
  /**
   * The boxel system last put on the clipboard (server/boxelRun.ts), for the HUD's next-jump card:
   * "Copied … · boxel run". Not journal state; this session only.
   */
  boxelCopied: { name: string; at: string; run: boolean; source?: "boxel" | "neutron" } | null = null;
  /**
   * Bumped whenever something the Boxels screen shows changes without a jump: a route plotted, a
   * system targeted, a run started or finished, a system copied. The screen re-reads on a change.
   */
  boxelsRevision = 0;
  /** Last hyperspace target from `StartJump`, for the HUD's next-jump card. See AppSnapshot.jumpTarget. */
  lastJumpTarget: {
    starSystem: string;
    systemAddress: number;
    starClass: string;
    at: string;
    arrived: boolean;
  } | null = null;

  /** When the sampling run for this species on this body began (ms epoch), or undefined. */
  organicRunStartedAtMs(bodyKey: string, speciesKey: string): number | undefined {
    return this.organicRunStartedAt.get(`${bodyKey}::${speciesKey}`);
  }

  /**
   * An `Analyse` put back on the body its run was taken on (plan 2.4, Fable S4).
   *
   * The game no longer makes the commander wait for the analysis: board and fly off, and `Analyse`
   * fires wherever the ship is by then, naming that body (owner, 2026-09-22). `Log` and `Sample` are
   * always written at the plant. So an `Analyse` for a species with no open run on its own body, while
   * exactly one run of that species elsewhere has both its samples, belongs to that run. Anything else — its own run
   * open, none open, two open — leaves the line as the game wrote it. On the owner's 395 runs (journals,
   * 2026-10-02) every `Analyse` followed `Log, Sample, Sample` on its own body, so this changes nothing
   * there. Call it before `apply()`, which closes the run.
   */
  ownBodyForAnalyse(line: JournalLine): JournalLine {
    if (line.event !== "ScanOrganic" || line.ScanType !== "Analyse") return line;
    const sa = line.SystemAddress;
    const body = line.Body;
    if (typeof sa !== "number" || typeof body !== "number") return line;
    const speciesKey = speciesKeyFromOrganicJournal(line);
    if (this.organicRunStartedAt.has(`${bodyKey(sa, body)}::${speciesKey}`)) return line;
    const suffix = `::${speciesKey}`;
    // A run ready for its analysis: both samples in. A plant logged and left elsewhere is not one.
    const open = [...this.organicRunStartedAt.keys()].filter(
      (k) => k.endsWith(suffix) && this.organicAnalyseByKey.get(k)?.count === 2,
    );
    if (open.length !== 1) return line;
    const [runSa, runBody] = open[0]!.slice(0, -suffix.length).split(":").map(Number);
    if (!Number.isFinite(runSa) || !Number.isFinite(runBody)) return line;
    return { ...line, SystemAddress: runSa, Body: runBody } as JournalLine;
  }

  /**
   * How often the two live files are re-read, in milliseconds. Both were compiled-in constants.
   *
   * Kept on the store rather than in the timer closures so one place answers "what is it now" for
   * `/api/status`, the settings route and the persisted preferences file. Changing either re-arms
   * its timer immediately — see `edexoBootstrap.applyPollRates`.
   */
  statusPollMs = STATUS_POLL_DEFAULT_MS;
  journalPollMs = JOURNAL_POLL_DEFAULT_MS;

  /**
   * How far the sample radar draws, in metres. See `shared/radarRadius.ts` for why it moved off a
   * constant. Server-side rather than a launcher preference because the radar's DTO carries it, and
   * the HUD and the app both read that one field.
   */
  minimapRadiusM = RADAR_RADIUS_DEFAULT_M;

  /** When true, bacterium genus/species rules are included in body search (default off, can leak spoilers). */
  includeBacteriumInSearch = false;
  /** Mirrored launcher HUD settings, see AppSnapshot.hudPrefs. */
  hudPrefs: HudPrefsDTO | null = null;

  /**
   * Look the destination system up on EDSM as soon as the commander jumps into it (§50).
   *
   * **Default off, and it stays off until the commander stores their own EDSM key**, because turning
   * it on sends the name of every system they enter to a third party. That is not a preference like
   * a temperature unit; it is a standing consent to outbound traffic, so it is opt-in twice over.
   */
  edsmAutoFetchEnabled = false;

  /**
   * Send discoveries to Canonn Research (§CAPI).
   *
   * **Default off**, and unlike the EDSM toggle there is no second key to hide behind: Canonn's
   * endpoint is unauthenticated and takes the journal line verbatim with the commander's name on it.
   * So the switch itself is the whole consent, and the option that offers it says so in those words.
   */
  canonnUploadEnabled = false;

  /**
   * Send live exploration and exobiology events to EDDN (owner, 2026-09-24).
   *
   * **Default off**, like Canonn: the switch is the whole consent. EDDN takes the commander name as
   * `uploaderID` and hashes it before relaying; everything else personal is stripped. See
   * `eddnUpload.ts`.
   */
  eddnUploadEnabled = false;

  /**
   * Contributing the journal itself to EDSM, the way EDMC and EDDiscovery do.
   *
   * **Default off, and gated on the API key like auto-fetch** — but this one sends far more than the
   * name of the system you are in. It sends the game's own journal lines, minus the ~250 event types
   * EDSM publishes as unwanted. The Options panel says that in those words before the switch.
   *
   * Separate from {@link edsmAutoFetchEnabled} on purpose: reading somebody's data and handing them
   * yours are different decisions, and a commander who wants the first is not thereby agreeing to
   * the second.
   */
  edsmUploadEnabled = false;

  /**
   * Keep sending while the commander plays.
   *
   * A second switch under {@link edsmUploadEnabled}, because "I will contribute my journal" and "do
   * it without asking me again" are not the same promise. It runs the ordinary catch-up on a timer
   * rather than tailing the journal into a second queue: the catch-up already skips files whose size
   * has not moved, so a tick with nothing new is a few hundred `stat` calls and no network at all,
   * and one code path that is tested beats two that have to agree with each other.
   */
  edsmLiveUploadEnabled = false;

  /** This session's view of the catch-up run, for the panel. Not persisted — it describes a run. */
  edsmUploadProgress: import("./edsmCatchUp.js").EdsmCatchUpProgress | null = null;

  /**
   * This session's tally of what actually went to Canonn.
   *
   * Not persisted: a count that survives a restart says nothing about what the commander is doing
   * now, and the option's job is to show that the switch is doing something rather than to keep
   * a lifetime score.
   */
  canonnUploadSent = 0;
  canonnUploadFailed = 0;

  /** This session's tally of what EDDN accepted and refused. Not persisted, for the same reason. */
  eddnUploadSent = 0;
  eddnUploadFailed = 0;

  /**
   * How much journal history to merge: all logs in the folder, or a rolling window from “now”.
   * Separately persisted in user settings JSON (not part of the journal merge payload).
   */
  journalHistoryPreset: JournalHistoryPreset = "all";

  /**
   * System map `+` / `++` thresholds (CR per species: list × 5 if this commander has first-footfall on the body, else × 1).
   * Clamped to 1M…20M; `++` is always strictly greater than `+`.
   */
  exoMapTierPlusMinCr = 10_000_000;
  exoMapTierPlusPlusMinCr = 17_000_000;

  /** When true, header “Data value” includes estimated FSS/DSS UC value from merged scans (see Options). */
  includeExplorationScanDataInDataValue = false;
  /**
   * Data value counts the +30 % Pranav Antal exobiology sale bonus (owner, 2026-10-03). Off by default:
   * whether a sale gets it depends on where the commander sells, which the app does not follow.
   */
  pranavAntalBonus = false;
  /**
   * Data value counts exploration data sold at a fleet carrier, which keeps 25 % (owner, 2026-10-03:
   * his carrier sales came in 25 % under the system map). Off by default; where he sells is his choice.
   */
  sellAtFleetCarrier = false;
  /**
   * The data feeder's entries (the app menu's Data feeder, the launcher's Spansh dump import): off by default (owner,
   * 2026-10-18: "the feeder is no longer needed… hide it in the options, disabled by default"). A developer tool;
   * the profiles ship built.
   */
  feederEnabled = false;
  /**
   * The carrier is the commander's own: of the 25 % the sale keeps, 10 % goes into the carrier's bank,
   * which he can take back, so his real cost is 15 % (owner, 2026-10-04).
   */
  fleetCarrierIsOwn = false;

  /** Consumed once in `buildSnapshot` so the client can select that bio body tab. */
  private pendingUiAutoSelectBodyKey: string | null = null;

  /** Web client POST — which planetary body tab is active (for Exo-Candidates overlay). */
  uiSelectedBodyKey: string | null = null;

  /** Last journal Touchdown on a planet (commander). */
  overlayTouchdownBodyKey: string | null = null;
  /** The body the ship is at, as `system:body` — arrival body after a jump, then approach / drop / landing. */
  currentBodyKey: string | null = null;

  /**
   * Where the ship is parked, from `Touchdown` (A-list: the overlay minimap).
   *
   * The journal gives this one for free: every `Touchdown` carries `Latitude` and `Longitude` —
   * 32 of 32 in the owner's recent logs — so unlike a plant, the ship's position needs no live
   * `Status.json` capture and survives a restart of the app.
   *
   * Cleared on `Liftoff`, because the owner's rule is that the mark means "your ship is there", and
   * once it leaves, it is not.
   */
  surfaceShipMark: SurfaceMark | null = null;

  /**
   * Where each plant was sampled on the body currently under foot.
   *
   * **This cannot be recovered from history.** `ScanOrganic` does not carry coordinates — 0 of 38
   * in the owner's recent journals — so the only way to know where a plant was is to read
   * `Status.json` at the moment the scan lands, which means only scans taken while this app is
   * running can ever be placed. A replay of four years of logs yields nothing here, by construction.
   *
   * Kept for one body at a time: the map is "where have I walked on this rock", and marks from the
   * last one would be somewhere else entirely.
   */
  surfaceSampleMarks: SurfaceMark[] = [];

  /**
   * Record a sampled plant's position, and remember it across restarts.
   *
   * Marks from other bodies are **kept**, not cleared. The owner's rule: leaving for supercruise
   * drops them from the map "until I go down on that planet again", which is a question of what
   * matches the body underfoot, not of what is worth keeping. Walk back on and they are there.
   *
   * Written to disk on every new mark because the thing being protected is a position that cannot
   * be recovered from anything — no journal line carries it. The file is a few kB.
   */
  addSurfaceSampleMark(
    bodyKeyStr: string,
    bodyNameNorm: string,
    latDeg: number,
    lonDeg: number,
    label: string,
    atIso: string,
    /** `Status.json` conditions at the plant; absent when the game was not reporting them. */
    conditions?: { temperatureK: number | null; gravityG: number | null; elevationM: number | null },
  ): void {
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return;
    const dup = this.surfaceSampleMarks.some(
      (m) =>
        m.bodyKey === bodyKeyStr && Math.abs(m.latDeg - latDeg) < 1e-5 && Math.abs(m.lonDeg - lonDeg) < 1e-5,
    );
    if (dup) return;
    const tK = conditions?.temperatureK;
    const gG = conditions?.gravityG;
    const eM = conditions?.elevationM;
    this.surfaceSampleMarks.push({
      bodyKey: bodyKeyStr,
      bodyNameNorm,
      latDeg,
      lonDeg,
      label,
      atIso,
      ...(typeof tK === "number" && Number.isFinite(tK) ? { temperatureK: tK } : {}),
      ...(typeof gG === "number" && Number.isFinite(gG) ? { gravityG: gG } : {}),
      ...(typeof eM === "number" && Number.isFinite(eM) ? { elevationM: eM } : {}),
    });
    // Oldest first: the rock underfoot is the one visited most recently.
    while (this.surfaceSampleMarks.length > MAX_SURFACE_MARKS) this.surfaceSampleMarks.shift();
    this.persistSurfaceMarks();
  }

  /** Load the radar's memory at boot, so a restart on a planet is not a blank map. */
  loadSurfaceMarksFromDisk(): void {
    const f = loadSurfaceMarks();
    this.surfaceSampleMarks = f.samples;
    // The ship also arrives from the journal replay; whichever is newer wins, and Touchdown always
    // overwrites this afterwards, so a stale file cannot outlive a real landing.
    if (!this.surfaceShipMark) this.surfaceShipMark = f.ship;
  }

  persistSurfaceMarks(): void {
    scheduleSaveSurfaceMarks({
      formatVersion: 1,
      samples: this.surfaceSampleMarks,
      ship: this.surfaceShipMark,
    });
  }

  /**
   * Read the pending one-shot key without consuming it.
   *
   * Consuming belongs to the broadcast path only ({@link clearPendingUiAutoSelectBodyKey}); when
   * the consume lived inside buildSnapshot, any /api/state poll could swallow the key before the
   * WebSocket clients ever saw it.
   */
  peekPendingUiAutoSelectBodyKey(): string | null {
    return this.pendingUiAutoSelectBodyKey;
  }

  clearPendingUiAutoSelectBodyKey(): void {
    this.pendingUiAutoSelectBodyKey = null;
  }

  /**
   * Take a fresh `Status.json` `Destination`, and follow a newly targeted body to its Body tab.
   *
   * Owner, 2026-09-24: when he targets a body the app has a tab for, switch to it — once. The switch
   * rides the existing one-shot (`requestUiAutoSelectBody` → `uiAutoSelectBodyKey`, consumed by the
   * broadcast, applied by the client only when the key changes), so it fires on a change of target
   * and never again for the same one: he can click any other tab without being pulled back. Same
   * system and tabbed bodies only, which that method already enforces. Returns whether the
   * destination changed, for the caller's push.
   */
  applyStatusDestination(dest: StatusDestination | null): boolean {
    const prev = this.statusDestination;
    const changed =
      (dest == null) !== (prev == null) ||
      (dest != null &&
        prev != null &&
        (dest.systemAddress !== prev.systemAddress ||
          dest.bodyId !== prev.bodyId ||
          dest.name !== prev.name));
    if (!changed) return false;
    this.statusDestination = dest;
    // A system picked as destination in the galaxy map names the system itself; it exists.
    if (dest && dest.systemAddress && parseBoxel(dest.name)?.index != null && !this.targetedSystems.has(dest.systemAddress)) {
      this.targetedSystems.set(dest.systemAddress, { name: dest.name, starClass: "" });
      this.boxelsRevision++;
    }
    if (dest) this.requestUiAutoSelectBody(dest.systemAddress, dest.bodyId);
    return true;
  }

  /** Queue a one-shot tab focus when the body is already in the focused system's bio list. */
  requestUiAutoSelectBody(systemAddress: number, bodyId: number): void {
    const focus = this.viewingSystemAddress ?? this.currentSystemAddress;
    if (focus === null || focus !== systemAddress) return;
    const bk = bodyKey(systemAddress, bodyId);
    if (!this.bodies.has(bk)) return;
    this.pendingUiAutoSelectBodyKey = bk;
  }

  /** Returns whether the value changed, so callers can skip a pointless snapshot broadcast. */
  setUiSelectedBodyKeyFromClient(key: string | null): boolean {
    if (key !== null) {
      const focus = this.viewingSystemAddress ?? this.currentSystemAddress;
      if (focus === null || systemAddressOfBodyKey(key) !== focus) return false;
      if (!this.bodies.has(key)) return false;
    }
    if (this.uiSelectedBodyKey === key) return false;
    this.uiSelectedBodyKey = key;
    return true;
  }

  setIncludeExplorationScanDataInDataValue(value: boolean): void {
    this.includeExplorationScanDataInDataValue = value;
  }

  setPranavAntalBonus(value: boolean): void {
    this.pranavAntalBonus = value;
  }

  setSellAtFleetCarrier(value: boolean): void {
    this.sellAtFleetCarrier = value;
  }

  setFeederEnabled(value: boolean): void {
    this.feederEnabled = value;
  }

  setFleetCarrierIsOwn(value: boolean): void {
    this.fleetCarrierIsOwn = value;
  }

  setIncludeBacteriumInSearch(value: boolean): void {
    this.includeBacteriumInSearch = value;
  }

  /** Set the radar radius, clamped. Returns whether it moved, so a no-op writes no file. */
  setMinimapRadiusM(raw: unknown): boolean {
    const next = clampRadarRadiusM(raw);
    const changed = next !== this.minimapRadiusM;
    this.minimapRadiusM = next;
    return changed;
  }

  /**
   * Set both poll intervals, clamped. Returns whether either actually moved, so the caller only
   * re-arms timers and rewrites the preferences file when something changed — the launcher sends
   * this on every keystroke-settled change and a no-op should cost nothing.
   */
  setPollRates(statusRaw: unknown, journalRaw: unknown): boolean {
    const s = clampStatusPollMs(statusRaw);
    const j = clampJournalPollMs(journalRaw);
    const changed = s !== this.statusPollMs || j !== this.journalPollMs;
    this.statusPollMs = s;
    this.journalPollMs = j;
    return changed;
  }

  /** Keep only the known keys, with sane bounds; anything else a client sends is dropped (hudPrefsSanitize.ts). */
  setHudPrefs(raw: unknown): HudPrefsDTO | null {
    this.hudPrefs = sanitizeHudPrefs(raw);
    return this.hudPrefs;
  }

  setEdsmAutoFetchEnabled(value: boolean): void {
    this.edsmAutoFetchEnabled = value;
  }

  setCanonnUploadEnabled(value: boolean): void {
    this.canonnUploadEnabled = value;
  }

  setEddnUploadEnabled(value: boolean): void {
    this.eddnUploadEnabled = value;
  }

  setEdsmUploadEnabled(value: boolean): void {
    this.edsmUploadEnabled = value;
  }

  setEdsmLiveUploadEnabled(value: boolean): void {
    this.edsmLiveUploadEnabled = value;
  }

  setEdsmUploadProgress(p: import("./edsmCatchUp.js").EdsmCatchUpProgress | null): void {
    this.edsmUploadProgress = p;
  }

  recordCanonnUploadResult(ok: boolean): void {
    if (ok) this.canonnUploadSent++;
    else this.canonnUploadFailed++;
  }

  recordEddnUploadResult(ok: boolean): void {
    if (ok) this.eddnUploadSent++;
    else this.eddnUploadFailed++;
  }

  setJournalHistoryPreset(value: JournalHistoryPreset): void {
    this.journalHistoryPreset = value;
  }

  /**
   * Live and sold scan records grouped by system (code review B2, 2026-09-28). Six places walked every
   * record in the store — over 100k after a long history — to find one system's, several of them on
   * every snapshot. Rebuilt only when {@link explorationScansRevision} moves, which every change to
   * either map does.
   */
  private scanIndexMemo: {
    key: string;
    live: Map<number, ExplorationScanRecord[]>;
    sold: Map<number, ExplorationScanRecord[]>;
  } | null = null;

  private scanIndexKey(): string {
    return `${this.explorationScansRevision}:${this.explorationScans.size}:${this.soldExplorationScans.size}`;
  }

  /** Whether the index matches the maps right now. Taken before a write, so the write can patch it. */
  scanIndexIsFresh(): boolean {
    return this.scanIndexMemo !== null && this.scanIndexMemo.key === this.scanIndexKey();
  }

  /**
   * Patch the index after writes that were made while it was fresh, instead of rebuilding it.
   *
   * Start-up hang report (guild tester, 2026-10-01; plan F): every `Scan` moves the revision, and the
   * next moon `Scan` asks for its siblings — so a journal replay rebuilt the index over every record in
   * the store once per moon. Quadratic: 24 s of a frozen app on a cold start with the owner's history,
   * minutes with a longer one. A write touches one body, so it patches one system's list: a new array
   * (callers may hold the old one), the record replaced where it was or appended, which is the order a
   * rebuild over the maps' insertion order gives. A stale index is left for the next read to rebuild.
   */
  patchScanIndex(
    wasFresh: boolean,
    ops: ReadonlyArray<{ kind: "live" | "sold"; rec: ExplorationScanRecord; drop?: boolean }>,
  ): void {
    const memo = this.scanIndexMemo;
    if (!wasFresh || !memo) return;
    for (const { kind, rec, drop } of ops) {
      const lists = kind === "live" ? memo.live : memo.sold;
      const prev = lists.get(rec.systemAddress) ?? [];
      const at = prev.findIndex((r) => r.bodyId === rec.bodyId);
      let next: ExplorationScanRecord[];
      if (drop) {
        if (at < 0) continue;
        next = prev.filter((_, i) => i !== at);
      } else if (at >= 0) {
        next = prev.slice();
        next[at] = rec;
      } else {
        next = [...prev, rec];
      }
      if (next.length) lists.set(rec.systemAddress, next);
      else lists.delete(rec.systemAddress);
    }
    memo.key = this.scanIndexKey();
  }

  private scanIndex() {
    // The sizes too: a write that forgot the revision (a test, a future path) must not read stale.
    const key = this.scanIndexKey();
    if (this.scanIndexMemo?.key === key) return this.scanIndexMemo;
    const group = (m: Map<string, ExplorationScanRecord>) => {
      const out = new Map<number, ExplorationScanRecord[]>();
      for (const r of m.values()) {
        const list = out.get(r.systemAddress);
        if (list) list.push(r);
        else out.set(r.systemAddress, [r]);
      }
      return out;
    };
    this.scanIndexMemo = {
      key,
      live: group(this.explorationScans),
      sold: group(this.soldExplorationScans),
    };
    return this.scanIndexMemo;
  }

  /**
   * `orbitParentPlanetByBody` by system (plan F, 2026-10-01): the sibling-moon lookup walked every
   * body in the store for each moon `Scan`. Same scheme as the scan index: a revision plus the size,
   * patched on the `Scan` path, rebuilt after anything else.
   */
  orbitParentRevision = 0;
  orbitParentMemo: { key: string; bySystem: Map<number, Map<number, number>> } | null = null;

  orbitParentKey(): string {
    return `${this.orbitParentRevision}:${this.orbitParentPlanetByBody.size}`;
  }

  /** Moon body id -> its parent planet's body id, for one system. Read-only. */
  orbitParentsInSystem(systemAddress: number): ReadonlyMap<number, number> {
    const key = this.orbitParentKey();
    if (this.orbitParentMemo?.key !== key) {
      const bySystem = new Map<number, Map<number, number>>();
      for (const [bk, p] of this.orbitParentPlanetByBody) {
        const i = bk.indexOf(":");
        const sys = Number(bk.slice(0, i));
        const bid = Number(bk.slice(i + 1));
        if (!Number.isFinite(sys) || !Number.isFinite(bid)) continue;
        let m = bySystem.get(sys);
        if (!m) bySystem.set(sys, (m = new Map()));
        m.set(bid, p);
      }
      this.orbitParentMemo = { key, bySystem };
    }
    return this.orbitParentMemo.bySystem.get(systemAddress) ?? EMPTY_ORBIT_PARENTS;
  }

  /** Set (or clear, with null) one moon's parent, keeping the per-system index in step. */
  setOrbitParent(systemAddress: number, bodyId: number, parent: number | null): void {
    const k = bodyKey(systemAddress, bodyId);
    const fresh = this.orbitParentMemo !== null && this.orbitParentMemo.key === this.orbitParentKey();
    if (parent != null) this.orbitParentPlanetByBody.set(k, parent);
    else this.orbitParentPlanetByBody.delete(k);
    this.orbitParentRevision += 1;
    if (!fresh || !this.orbitParentMemo) return;
    let m = this.orbitParentMemo.bySystem.get(systemAddress);
    if (parent != null) {
      if (!m) this.orbitParentMemo.bySystem.set(systemAddress, (m = new Map()));
      m.set(bodyId, parent);
    } else if (m) {
      m.delete(bodyId);
      if (!m.size) this.orbitParentMemo.bySystem.delete(systemAddress);
    }
    this.orbitParentMemo.key = this.orbitParentKey();
  }

  /** This system's live (unsold) scan records. Read-only: the store owns them. */
  liveScansInSystem(systemAddress: number): readonly ExplorationScanRecord[] {
    return this.scanIndex().live.get(systemAddress) ?? [];
  }

  /** This system's sold-archive scan records (physics kept after a sale). */
  soldScansInSystem(systemAddress: number): readonly ExplorationScanRecord[] {
    return this.scanIndex().sold.get(systemAddress) ?? [];
  }

  /** True if merged journal has at least one `Scan` row (any body) for this system. */
  hasJournalExplorationScansForSystem(systemAddress: number): boolean {
    return this.liveScansInSystem(systemAddress).length > 0;
  }

  /**
   * True when journal has at least one merged `Scan` that can populate the system map (belt-cluster rows alone do not).
   * Used to decide whether EDSM body hydration is still useful.
   */
  hasMappableJournalExplorationForSystem(systemAddress: number): boolean {
    return this.liveScansInSystem(systemAddress).some((r) => !explorationRecordIsBeltClusterLike(r));
  }

  /**
   * The scan row to read a body's *physics* from — live if we still hold it, else the sold archive.
   *
   * Value, eligibility and map state must keep reading {@link explorationScans} directly: a sold
   * system has no payout left and no first-discovery bonus, and nothing here changes that. This is
   * for the matcher and the habitat scorer, which want to know what the body is.
   */
  physicsExplorationScan(key: string): ExplorationScanRecord | null {
    const own = this.explorationScans.get(key) ?? this.soldExplorationScans.get(key);
    if (own) return own;
    /*
      A looked-up system (Spansh): its record, the one the body's scan was built from. Without it the
      match context had no `Parents` for any looked-up body — no host star, no star classes, no colour
      star, no starlight — and the orbit fell back to the arrival distance: NGC 2546 Sector SU-L c22-9
      BC 3 a read 92,738 ls from its BC pair instead of 439 and lost Clypeus lacrimam (known-spawn
      tests, 2026-09-27). Physics only: nothing here counts as his scan, value or discovery.
    */
    const sep = key.indexOf(":");
    const sys = sep > 0 ? this.remoteSystems.get(Number(key.slice(0, sep))) : undefined;
    const bodyId = Number(key.slice(sep + 1));
    return sys?.records.find((r) => r.bodyId === bodyId) ?? null;
  }

  hasEdsmExplorationForSystem(systemAddress: number): boolean {
    const p = `${systemAddress}:`;
    for (const k of this.edsmExplorationByKey.keys()) {
      if (k.startsWith(p)) return true;
    }
    return false;
  }

  /**
   * Commander has journal memory of this system (visited list, any body, or any exploration scan).
   */
  isKnownJournalSystem(systemAddress: number): boolean {
    if (this.visitedSystems.has(systemAddress)) return true;
    const p = `${systemAddress}:`;
    for (const k of this.bodies.keys()) {
      if (k.startsWith(p)) return true;
    }
    return this.liveScansInSystem(systemAddress).length > 0;
  }

  /** Replace EDSM-only scan rows for one system (used when journal has no `Scan` data to draw the map). */
  replaceEdsmExplorationForSystem(systemAddress: number, records: ExplorationScanRecord[]): void {
    const prefix = `${systemAddress}:`;
    for (const k of [...this.edsmExplorationByKey.keys()]) {
      if (k.startsWith(prefix)) this.edsmExplorationByKey.delete(k);
    }
    for (const r of records) {
      if (r.systemAddress !== systemAddress) continue;
      this.edsmExplorationByKey.set(bodyKey(systemAddress, r.bodyId), r);
    }
  }

  noteAchievementDone(key: string, ts: string): void {
    const prev = this.achievementDone.get(key);
    if (prev === undefined || (ts && ts < prev)) this.achievementDone.set(key, ts);
  }

  /**
   * The third sample of a variant: it counts for the region it was taken in. `ScanOrganic` names no
   * region, so it is the one the system's codex line gave, or else where the commander is standing.
   */
  noteSampledAchievement(line: JournalLine, systemAddress: number, ts: string): void {
    const entry = codexEntryKey(typeof line.Variant === "string" ? line.Variant : "");
    if (!entry || isLegacyPlantKey(entry)) return;
    let rk = this.codexRegionBySystem.get(systemAddress) ?? "";
    if (!rk && this.commanderPos && this.currentSystemAddress === systemAddress) {
      const p = this.commanderPos;
      rk = regionJoinKey(regionForSystem(getProjectRoot(), p.x, p.y, p.z));
    }
    if (rk) this.noteAchievementDone(`${rk}|${entry}`, ts);
  }

  setTrackedAchievement(id: string | null): void {
    this.trackedAchievementId = id && id.trim() ? id.trim().slice(0, 200) : null;
  }

  setPhotoStamp(p: Partial<PhotoStampPrefs>): void {
    const next = { ...this.photoStamp };
    for (const k of ["commander", "system", "timestamp"] as const) {
      if (typeof p[k] === "boolean") next[k] = p[k]!;
    }
    this.photoStamp = next;
  }

  setFootTravelOdometerEnabled(value: boolean): void {
    this.footTravelOdometerEnabled = value;
    /*
      Off resets the odometer and nothing else. It used to reset the foot session and delete the
      saved sample run, and the settings file applies this at every start: with the odometer off
      (his setting) a restart mid-run deleted the plant positions just before they were read back,
      and the HUD lost the first sample's distance (owner, 2026-10-02).
    */
    if (!value) {
      this.footTravelOdometerTracking = false;
      this.footTravelDistanceMeters = 0;
      this.footTravelPrevLat = null;
      this.footTravelPrevLon = null;
      this.footTravelLastPlanetRadiusM = null;
    }
  }

  /**
   * Start or restart foot odometer for `data/organic_sample_session.json` (typically after a new Sample sequence).
   */
  beginFootTravelOdometerSession(bodyKey: string, bodyNameNorm: string | null): void {
    if (!this.footTravelOdometerEnabled) return;
    this.footTravelOdometerTracking = true;
    this.footTravelDistanceMeters = 0;
    this.footTravelPrevLat = null;
    this.footTravelPrevLon = null;
    this.footTravelLastPlanetRadiusM = null;
    this.footSessionBodyKey = bodyKey;
    this.footSessionBodyNameNorm =
      bodyNameNorm && bodyNameNorm.trim() ? normOrganicToken(bodyNameNorm) : null;
  }

  /** Legacy no-op path — session persists across Embark; prefer explicit {@link wipeOrganicSampleSession}. */
  endFootTravelOdometerSession(): void {
    /* intentional: foot + organic HUD session survives boarding ship */
  }

  /**
   * Integrate lat/lon from Status.json while tracking.
   * Skips bogus jumps: >800 m between two fixes is a speed glitch, not a walk. Elite writes a new
   * position about every 3 s (see `edexoBootstrap`'s note), so a real one moves tens of metres.
   */
  applyFootTravelSample(
    latDeg: number,
    lonDeg: number,
    planetRadiusM: number,
    statusBodyName?: string | null,
  ): void {
    if (!this.footTravelOdometerEnabled || !this.footTravelOdometerTracking) return;
    if (!(planetRadiusM > 0 && Number.isFinite(planetRadiusM))) return;
    if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) return;
    if (this.footSessionBodyNameNorm) {
      const st = normStatusBodyName(statusBodyName ?? null);
      if (!st || st !== this.footSessionBodyNameNorm) return;
    }

    const rLast = this.footTravelLastPlanetRadiusM;
    if (
      rLast != null &&
      rLast > 0 &&
      Math.abs(planetRadiusM - rLast) / Math.max(rLast, planetRadiusM) > 0.02
    ) {
      this.footTravelPrevLat = null;
      this.footTravelPrevLon = null;
    }
    this.footTravelLastPlanetRadiusM = planetRadiusM;

    const plat = this.footTravelPrevLat;
    const plon = this.footTravelPrevLon;
    if (plat != null && plon != null) {
      const d = greatCircleDistanceMeters(plat, plon, latDeg, lonDeg, planetRadiusM);
      if (d > 0 && d <= 800) {
        this.footTravelDistanceMeters += d;
      }
    }
    this.footTravelPrevLat = latDeg;
    this.footTravelPrevLon = lonDeg;
  }

  resetFootTravelRuntime(opts?: { clearPersistedFile?: boolean }): void {
    this.footTravelOdometerTracking = false;
    this.footTravelDistanceMeters = 0;
    this.footTravelPrevLat = null;
    this.footTravelPrevLon = null;
    this.footTravelLastPlanetRadiusM = null;
    this.footSessionBodyKey = null;
    this.footSessionBodyNameNorm = null;
    if (opts?.clearPersistedFile) {
      clearPersistedOrganicSampleSession(getProjectRoot());
    }
  }

  setExoMapTierThresholds(plusMinCr: number, plusPlusMinCr: number): void {
    const lo = 1_000_000;
    const hi = 20_000_000;
    let p = Math.round(plusMinCr);
    let pp = Math.round(plusPlusMinCr);
    if (!Number.isFinite(p) || !Number.isFinite(pp)) return;
    p = Math.max(lo, Math.min(hi, p));
    pp = Math.max(lo, Math.min(hi, pp));
    if (pp <= p) {
      pp = p + 1;
      if (pp > hi) {
        p = hi - 1;
        pp = hi;
      }
    }
    this.exoMapTierPlusMinCr = p;
    this.exoMapTierPlusPlusMinCr = pp;
  }

  /** Clear journal-derived exobiology: scan progress, pending sell value, first-footfall flags. Does not re-read the journal. */
  resetExobiologyTracking(): void {
    this.organicAnalyseByKey.clear();
    this.pendingOrganicSales = [];
    this.firstFootfallBodies.clear();
    this.codexLoggedSpecies.clear();
    this.codexRegionLogged.clear();
    this.codexMapLogged.clear();
    this.codexSightings.clear();
    this.achievementDone.clear();
    this.codexRegionBySystem.clear();
    this.greenCodexBodies.clear();
    this.greenCodexMatcher.clear();
    this.k10Systems.clear();
    this.nspSeen.clear();
    this.landingMinutesSamples.length = 0;
    this.samplingMinutesSamples.length = 0;
    this.scExitAt = null;
    this.organicRunStartedAt.clear();
    this.bodyDetailedFootfallState.clear();
    this.bodyFootfallFlag.clear();
    this.bodyMappedFlag.clear();
    this.exoOrganicTracker = null;
    this.exoOrganicLastFix = null;
    clearPersistedOrganicSampleSession(getProjectRoot());
    this.resetFootTravelRuntime();
  }

  /**
   * Journal file rolled or full re-parse — clears commander session context.
   * `includeBacteriumInSearch`, `includeExplorationScanDataInDataValue`, exo map tier thresholds, and
   * DSS physical slack percents are user prefs and are intentionally preserved.
   */
  resetAll(): void {
    this.bodies.clear();
    this.bodyKeysBySystem = null;
    this.confirmedVariantsRevision += 1;
    this.explorationScans.clear();
    this.soldExplorationScans.clear();
    this.soldBodyKeys.clear();
    this.explorationScansRevision += 1;
    this.edsmExplorationByKey.clear();
    this.commanderName = null;
    this.commanderFid = null;
    this.currentSystem = null;
    this.currentSystemAddress = null;
    this.commanderPos = null;
    this.viewingSystemAddress = null;
    this.visitedSystems.clear();
    this.systemVisitedAt.clear();
    this.systemStarClass.clear();
    this.targetedSystems.clear();
    this.visitedSystemNames = null;
    this.lastEventIso = null;
    this.organicAnalyseByKey.clear();
    this.bodyDetailedFootfallState.clear();
    this.bodyFootfallFlag.clear();
    this.bodyMappedFlag.clear();
    this.firstFootfallBodies.clear();
    this.codexLoggedSpecies.clear();
    this.codexRegionLogged.clear();
    this.codexMapLogged.clear();
    this.codexSightings.clear();
    this.achievementDone.clear();
    this.codexRegionBySystem.clear();
    this.greenCodexBodies.clear();
    this.greenCodexMatcher.clear();
    this.k10Systems.clear();
    this.nspSeen.clear();
    this.landingMinutesSamples.length = 0;
    this.samplingMinutesSamples.length = 0;
    this.scExitAt = null;
    this.organicRunStartedAt.clear();
    this.pendingOrganicSales = [];
    this.fssAllBodiesCompleteSystems.clear();
    this.systemLife.clear();
    this.fssAllBodiesFoundCountBySystem.clear();
    this.soldExplorationBySystem.clear();
    this.soldOrganicBySystem.clear();
    this.fssDiscoveryScanBySystem.clear();
    this.orbitParentPlanetByBody.clear();
    this.orbitParentRevision += 1;
    this.dssMappedBodyKeys.clear();
    this.archivedDssMappedBodyKeys.clear();
    this.dssFirstMapperEligibleByBodyKey.clear();
    this.dssMappingEfficientByBodyKey.clear();
    this.fssBodySignalsBodyKeys.clear();
    this.footJournalContextBuffer.length = 0;
    this.pendingUiAutoSelectBodyKey = null;
    this.uiSelectedBodyKey = null;
    this.overlayTouchdownBodyKey = null;
    this.currentBodyKey = null;
    this.mainStarWasDiscoveredBySystem.clear();
    this.mainStarSourceRankBySystem.clear();
    this.systemPositions.clear();
    this.remainingJumpsInRoute = null;
    this.loadoutMaxJumpRangeLy = null;
    this.loadoutFuelMainCapacityT = null;
    this.loadoutFuelReserveCapacityT = null;
    this.lastFsdJumpFuelUsedT = null;
    this.lastFsdJumpDistLy = null;
    this.jetConeBoost = null;
    this.jumpRange = emptyJumpRange();
    this.fsdFuel = emptyFsdFuel();
    this.fsdWear = newFsdWear();
    this.shipDamage = newShipDamage();
    this.ownAssets = newOwnAssets();
    this.jumponium = newJumponium();
    this.liveStatusFuelMainT = null;
    this.liveStatusFuelReserveT = null;
    this.lastLiveShipFuelPushKey = null;
    this.liveNavRoute = null;
    this.lastLiveNavRoutePushKey = null;
    this.fsdTarget = null;
    this.lastJumpTarget = null;
    this.resetFootTravelRuntime();
    this.exoOrganicTracker = null;
    this.exoOrganicLastFix = null;
  }

  /**
   * A live journal line: `apply`, then what only the present may do.
   *
   * Leaving a system closes its prediction records. The conditions at each plant live only in the
   * radar's own marks, and a body is not finished with until the commander has gone: hopping to orbit
   * and back down is one visit. Leaving — a jump, a carrier jump, a `Location` somewhere else — is the
   * moment a record can be given its ground truth and sealed. Live lines only (plan 2.4, O-19): a
   * replay walking years of history used to seal a record the commander was still working on, the
   * first time the history left that system on an older visit.
   */
  applyLive(line: JournalLine): void {
    const leaving = this.currentSystemAddress;
    this.apply(line);
    if (leaving !== null && this.currentSystemAddress !== leaving) {
      finalisePredictionsForSystem(leaving, this.surfaceSampleMarks);
    }
  }

  /** Remember a system name from the journal (for the system browser). */
  rememberVisitedSystem(starSystem: string, systemAddress: number): void {
    const n = starSystem.trim();
    if (!n) return;
    this.visitedSystems.set(systemAddress, n);
    this.visitedSystemNames = null;
  }

  setViewingSystemAddress(systemAddress: number | null): void {
    this.viewingSystemAddress = systemAddress;
  }

  /**
   * The commander's own position in light years, from `FSDJump` / `CarrierJump` / `Location`.
   *
   * The app has always known *which* system the commander is in; it never kept **where that is**,
   * because nothing needed a coordinate until the sector map (§10.3). `StarPos` rides on all three
   * of those events, so this is a capture rather than a lookup — no EDSM call, no join.
   *
   * Null until the first such event. A journal replay fills it from the last one in the logs, which
   * is the right answer for a commander who has just started the app.
   */
  commanderPos: { x: number; y: number; z: number } | null = null;

  /**
   * Where each system the commander has been is, in light years.
   *
   * `commanderPos` above answers "where am I"; this answers "where was that". Nothing needed the
   * second question until the galaxy map had to plot the backlog: a list of systems worth flying to
   * is useless on a map that cannot place them. The coordinate rides on the same events, so this is
   * still a capture rather than a lookup — no EDSM call, no join.
   *
   * Only systems actually visited appear. A system known only from a Spansh export or an EDSM
   * hydration has no `StarPos` in this commander's journals and is simply absent, which the map
   * draws as "not placeable" rather than as the origin.
   */
  readonly systemPositions = new Map<number, { x: number; y: number; z: number }>();

  /** Read `StarPos` off a journal line, when it carries one. */
  setPositionFromLine(line: JournalLine): void {
    const p = (line as Record<string, unknown>).StarPos;
    if (!Array.isArray(p) || p.length < 3) return;
    const [x, y, z] = p as unknown[];
    if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    this.commanderPos = { x, y, z };
    const addr = (line as Record<string, unknown>).SystemAddress;
    if (typeof addr === "number" && Number.isFinite(addr)) {
      this.systemPositions.set(addr, { x, y, z });
    }
  }

  /** Commander location after FSD/carrier jump — does not delete other systems’ bodies. */
  resetSystem(starSystem: string, systemAddress: number): void {
    this.rememberVisitedSystem(starSystem, systemAddress);
    this.currentSystem = starSystem;
    this.currentSystemAddress = systemAddress;
  }

  /** True when journal shows three organic analyses for this database row on this body. */
  isOrganicAnalysisCompleteForEntry(bodyStateKey: string, entry: SpeciesEntry): boolean {
    const prefix = `${bodyStateKey}::`;
    for (const [k, v] of this.organicAnalyseByKey) {
      if (!k.startsWith(prefix)) continue;
      if (v.count < 3) continue;
      if (speciesEntryMatchesOrganicLabel(entry, v.label)) return true;
    }
    return false;
  }

  bodyHasFirstFootfall(bodyStateKey: string): boolean {
    return this.firstFootfallBodies.has(bodyStateKey);
  }

  setLocation(starSystem: string, systemAddress: number): void {
    this.rememberVisitedSystem(starSystem, systemAddress);
    this.currentSystem = starSystem;
    this.currentSystemAddress = systemAddress;
  }

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
  mergeBarycentreJournalLine(line: JournalLine, ts: string): void {
    explorationMerge.mergeBarycentreJournalLine(this, line, ts);
  }

  mergeExplorationScan(line: JournalLine, ts: string): void {
    explorationMerge.mergeExplorationScan(this, line, ts);
  }

  apply(line: JournalLine): void {
    const event = line.event;
    const ts = (line.timestamp as string) ?? new Date().toISOString();
    this.lastEventIso = ts;

    try {
      // The ship's SRVs, fighters and the Nomad (1.3.1): launched, docked, lost, rebuilt, taken over. First, because
      // LoadGame and others return early below.
      shipDamageVehicle(this.shipDamage, line as Record<string, unknown>);
      if (event === "Commander") return journalEvents.onCommander(this, line);

      if (event === "LoadGame") return journalEvents.onLoadGame(this, line);

      if (event === "Loadout") return journalEvents.onLoadout(this, line);
      // The hold, for the fuel model's jump mass (fsdFuel.ts cargoT); another ship's or after a death: unknown.
      if (event === "Cargo") fsdFuelCargo(this.fsdFuel, line as Record<string, unknown>);
      // An engineer's roll changes the drive and the mass at once; the next Loadout comes at the next login (fsdFuel.ts).
      if (event === "EngineerCraft") fsdFuelEngineerCraft(this.fsdFuel, line as Record<string, unknown>);
      if (event === "ShipyardSwap" || event === "ShipyardNew" || event === "Died") this.fsdFuel.cargoT = null;
      if (event === "Repair" || event === "RepairAll") {
        fsdWearRepair(this.fsdWear, line as Record<string, unknown>);
        shipDamageRepair(this.shipDamage, line as Record<string, unknown>);
      }
      // The Ship HUD (shared/shipDamage.ts): the hull live, the AFMU's mends; another ship or a rebuy until its Loadout.
      if (event === "HullDamage") shipDamageHull(this.shipDamage, line as Record<string, unknown>);
      if (event === "AfmuRepairs") shipDamageAfmu(this.shipDamage, line as Record<string, unknown>);
      if (event === "ShipyardSwap" || event === "ShipyardNew" || event === "Died") shipDamageForget(this.shipDamage);
      // Supercharged at a neutron star or white dwarf: the next jump only (the fuel pump costs it as such).
      if (event === "JetConeBoost") {
        const b = (line as Record<string, unknown>).BoostValue;
        this.jetConeBoost = typeof b === "number" && b > 1 ? b : null;
      } else if (event === "FSDJump" || event === "CarrierJump" || event === "LoadGame" || event === "Died")
        this.jetConeBoost = null;
      if (typeof event === "string" && (event.startsWith("Carrier") || event.startsWith("ColonisationSystemClaim")))
        ownAssetsLine(this.ownAssets, line as Record<string, unknown>);
      if (JUMPONIUM_EVENTS.has(event as string)) jumponiumLine(this.jumponium, line as Record<string, unknown>);

      /*
        Which body the ship is at: the arrival body on a jump or a load, then whatever it approaches,
        drops out of supercruise at, or lands on. The System card's "you are here" (Discord batch O-E2)
        and, later, "closest first" in the body sort read it.
      */
      if (
        (event === "FSDJump" ||
          event === "CarrierJump" ||
          event === "Location" ||
          event === "ApproachBody" ||
          event === "SupercruiseExit" ||
          event === "Touchdown") &&
        typeof line.SystemAddress === "number" &&
        typeof (line as Record<string, unknown>).BodyID === "number"
      ) {
        this.currentBodyKey = bodyKey(
          line.SystemAddress as number,
          (line as Record<string, unknown>).BodyID as number,
        );
      }

      if (event === "FSDJump") {
        const fu = (line as Record<string, unknown>).FuelUsed;
        const jd = (line as Record<string, unknown>).JumpDist;
        if (typeof jd === "number") jumpRangeJump(this.jumpRange, jd, (line as Record<string, unknown>).BoostUsed);
        fsdFuelJump(this.fsdFuel, line as Record<string, unknown>, this.fsdFuel.cargoT ?? this.liveCargoAt(ts));
        fsdWearJump(this.fsdWear, line as Record<string, unknown>);
        if (
          typeof fu === "number" &&
          Number.isFinite(fu) &&
          fu > 0 &&
          typeof jd === "number" &&
          Number.isFinite(jd) &&
          jd > 0
        ) {
          this.lastFsdJumpFuelUsedT = fu;
          this.lastFsdJumpDistLy = jd;
        }
      }

      if ((event === "FSDJump" || event === "CarrierJump" || event === "Location") && typeof line.SystemAddress === "number") {
        this.systemVisitedAt.set(line.SystemAddress, ts);
        const jt = this.lastJumpTarget;
        if (event === "FSDJump" && jt?.starClass && jt.systemAddress === line.SystemAddress) {
          this.systemStarClass.set(line.SystemAddress, jt.starClass);
        }
      }

      if (event === "FSDJump" || event === "CarrierJump") return journalEvents.onFSDJumpEtc(this, line, ts, event);

      if (event === "FSDTarget") return journalEvents.onFSDTarget(this, line, ts);

      if (event === "Location") return journalEvents.onLocation(this, line, ts);

      if (event === "SupercruiseExit") return journalEvents.onSupercruiseExit(this, line, ts);

      if (event === "CodexEntry") return journalEvents.onCodexEntry(this, line, ts);

      if (event === "FSSSignalDiscovered") return journalEvents.onFssSignalNsp(this, line);

      if (event === "FSSDiscoveryScan") return journalEvents.onFSSDiscoveryScan(this, line);

      if (event === "FSSAllBodiesFound") return journalEvents.onFSSAllBodiesFound(this, line);

      if (event === "FSSBodySignals") return journalEvents.onFSSBodySignals(this, line, ts);

      if (event === "SAASignalsFound") return journalEvents.onSAASignalsFound(this, line, ts);

      if (event === "SAAScanComplete") return journalEvents.onSAAScanComplete(this, line, ts);

      if (event === "Touchdown") return journalEvents.onTouchdown(this, line, ts);

      if (event === "StartJump" || event === "SupercruiseEntry") {
        journalEvents.leaveBody(this);
        if (event === "StartJump" && line.JumpType === "Hyperspace") {
          const starSystem = typeof line.StarSystem === "string" ? line.StarSystem : "";
          const systemAddress = typeof line.SystemAddress === "number" ? line.SystemAddress : 0;
          const starClass = typeof line.StarClass === "string" ? line.StarClass : "";
          if (starSystem)
            this.lastJumpTarget = { starSystem, systemAddress, starClass, at: ts, arrived: false };
        }
      }

      if (event === "Liftoff") return journalEvents.onLiftoff(this);

      if (event === "ScanBaryCentre") return journalEvents.onScanBaryCentre(this, line, ts);

      if (event === "Scan") return journalEvents.onScan(this, line, ts);

      if (event === "ScanOrganic") return journalEvents.onScanOrganic(this, line, ts);

      if (event === "Embark" || event === "Embarked") return journalEvents.onEmbarkEtc(this);

      if (event === "Disembark" || event === "Disembarked") return journalEvents.onDisembarkEtc(this, line);

      if (event === "Died") return journalEvents.onDied(this);

      if (event === "SellOrganicData") return explorationSales.onSellOrganicData(this, line);

      if (event === "SellExplorationData" || event === "MultiSellExplorationData") return explorationSales.onSellExplorationDataEtc(this, line, event);
    } finally {
      journalEvents.appendFootJournalContext(this, line);
    }
  }


  listBioBodies(): BodyExoState[] {
    const focus = this.viewingSystemAddress ?? this.currentSystemAddress;
    if (focus === null) return [];
    const own = this.journalBioBodies(focus);
    if (own.length > 0) return own;
    return this.remoteBodies(focus);
  }

  private remoteBodyCache = new Map<number, { fetchedAt: string; bodies: BodyExoState[] }>();

  /** The bodies of a Spansh lookup, built once per fetch. */
  private remoteBodies(systemAddress: number): BodyExoState[] {
    const sys = this.remoteSystems.get(systemAddress);
    if (!sys) return [];
    const hit = this.remoteBodyCache.get(systemAddress);
    if (hit && hit.fetchedAt === sys.fetchedAt) return hit.bodies;
    const bodies = remoteBodyStates(sys);
    this.remoteBodyCache.set(systemAddress, { fetchedAt: sys.fetchedAt, bodies });
    return bodies;
  }

  /**
   * A bio body by key: the journal's, or — for a looked-up system the journals know nothing about —
   * the Spansh one. For readers that go by key (the system map), so a remote system reads the same.
   */
  bioBodyState(key: string): BodyExoState | undefined {
    const own = this.bodies.get(key);
    if (own) return own;
    const addr = systemAddressOfBodyKey(key);
    if (!Number.isFinite(addr) || !this.isShowingRemoteSystem(addr)) return undefined;
    return this.remoteBodies(addr).find((b) => b.key === key);
  }

  /** True when the journals hold no bio bodies for this system and a Spansh lookup is showing instead. */
  isShowingRemoteSystem(systemAddress: number): boolean {
    return this.remoteSystems.has(systemAddress) && this.journalBioBodies(systemAddress).length === 0;
  }

  /*
    Body keys per system, so the refresh looks at one system's bodies instead of filtering every bio
    body ever seen (~2 ms a snapshot on his journals, profiled 2026-10-01). Bodies are only ever
    added, or all cleared: the index is rebuilt when the count moves and dropped on clear/load.
    Keys, not objects, so a body replaced in the map is still read fresh.
  */
  bodyKeysBySystem: Map<number, string[]> | null = null;
  /**
   * Bumped whenever a body gains a confirmed colour variant, or the bodies are cleared or loaded:
   * the colour-outlier sweep (snapshot.ts) skips its pass over every body when this has not moved.
   */
  confirmedVariantsRevision = 0;
  private bodyKeysIndexedAt = -1;

  private bodyKeysIn(systemAddress: number): readonly string[] {
    if (!this.bodyKeysBySystem || this.bodyKeysIndexedAt !== this.bodies.size) {
      const idx = new Map<number, string[]>();
      for (const [k, b] of this.bodies) {
        const list = idx.get(b.systemAddress);
        if (list) list.push(k);
        else idx.set(b.systemAddress, [k]);
      }
      this.bodyKeysBySystem = idx;
      this.bodyKeysIndexedAt = this.bodies.size;
    }
    return this.bodyKeysBySystem.get(systemAddress) ?? [];
  }

  /** A system's bio bodies from the journals (the scan route, scanRouteView.ts), whichever system is in view. */
  bioBodiesInSystem(systemAddress: number): BodyExoState[] {
    return this.journalBioBodies(systemAddress);
  }

  private journalBioBodies(focus: number): BodyExoState[] {
    const inSystem: BodyExoState[] = [];
    for (const k of this.bodyKeysIn(focus)) {
      const b = this.bodies.get(k);
      if (b) inSystem.push(b);
    }
    return inSystem.filter((b) => {
      if (b.systemAddress !== focus) return false;
      /** FSS `Biological` count 0: omit from bio body list even when DSS listed genera. */
      if (b.biologicalSignals === 0) return false;
      const hasBioCount = b.biologicalSignals !== null && b.biologicalSignals > 0;
      const hasHints = !!(b.genusHints && b.genusHints.length);
      const confirmed = b.confirmedVariants.length > 0;
      const organicLocks = b.organicGenusLocks.length > 0;
      return hasBioCount || hasHints || confirmed || organicLocks;
    });
  }

  /** Exo-Candidates overlay: prefer touchdown while on foot, else client-selected tab. */
  resolveExoOverlayFocusBodyKey(): string | null {
    const posted = this.uiSelectedBodyKey;
    const td = this.overlayTouchdownBodyKey;
    const pick = this.footTravelOdometerTracking && td ? td : (posted ?? td);
    if (!pick) return null;
    const focus = this.viewingSystemAddress ?? this.currentSystemAddress;
    if (focus === null) return null;
    const raw = this.bodies.get(pick);
    if (!raw || raw.systemAddress !== focus) return null;
    if (systemAddressOfBodyKey(pick) !== focus) return null;
    return pick;
  }

  /**
   * Status.json's cargo for a jump made at `iso`, or null: only when it was read within five minutes of the
   * jump (a live one). The game writes no `Cargo` line after a ship swap (owner's history: 0 of 92), so
   * without this a swapped-in ship learnt nothing until the next login; a replayed old jump never gets
   * today's cargo (code review, 2026-10-14).
   */
  private liveCargoAt(iso: string | null | undefined): number | null {
    const t = iso ? Date.parse(iso) : NaN;
    if (this.liveStatusCargoT == null || this.liveStatusCargoAtMs == null || !Number.isFinite(t)) return null;
    return Math.abs(t - this.liveStatusCargoAtMs) <= 5 * 60_000 ? this.liveStatusCargoT : null;
  }

  /**
   * Live `Status.json` fuel — returns true when main/reserve changed (for snapshot push).
   */
  applyLiveShipFuel(mainT: number | null, reserveT: number | null, cargoT?: number | null): boolean {
    this.liveStatusFuelMainT = mainT;
    this.liveStatusFuelReserveT = reserveT;
    if (cargoT !== undefined) {
      this.liveStatusCargoT = cargoT;
      this.liveStatusCargoAtMs = cargoT != null ? Date.now() : null;
    }
    const key =
      mainT != null && reserveT != null && Number.isFinite(mainT) && Number.isFinite(reserveT)
        ? `${mainT.toFixed(4)}|${reserveT.toFixed(4)}`
        : "x";
    if (key === this.lastLiveShipFuelPushKey) return false;
    this.lastLiveShipFuelPushKey = key;
    return true;
  }

  /**
   * The next-jump card's target, best source first (owner, 2026-09-13):
   * 1. a hyperspace jump in progress (`StartJump`);
   * 2. the system locked in the nav panel (`FSDTarget`), known long before the countdown;
   * 3. the next hop after the current system in the live `NavRoute.json`;
   * 4. the system just arrived in, only when nothing further is plotted.
   * No hold after arriving: the owner wants the next star on screen the moment the jump ends.
   */
  nextJumpTarget(): NonNullable<AppSnapshot["jumpTarget"]> | null {
    const jt = this.lastJumpTarget;
    if (jt && !jt.arrived) return { ...jt, source: "jump", likelyFirstFootfall: null };
    const cur = this.currentSystemAddress;
    const ft = this.fsdTarget;
    if (ft && ft.systemAddress !== cur) {
      return {
        starSystem: ft.starSystem,
        systemAddress: ft.systemAddress,
        starClass: ft.starClass,
        at: ft.at,
        arrived: false,
        source: "target",
        likelyFirstFootfall: null,
      };
    }
    const hop = this.navRouteNextHop();
    if (hop) return hop;
    return jt ? { ...jt, source: "jump", likelyFirstFootfall: null } : null;
  }

  /** The hop after the current system in the live route; the first hop when the route starts elsewhere. */
  private navRouteNextHop(): NonNullable<AppSnapshot["jumpTarget"]> | null {
    const r = this.liveNavRoute;
    if (!r || r.length === 0) return null;
    const cur = this.currentSystemAddress;
    const i = r.findIndex((w) => w.systemAddress === cur);
    const w = i >= 0 ? r[i + 1] : r[0] && r[0].systemAddress !== cur ? r[0] : r[1];
    if (!w) return null;
    return {
      starSystem: w.starSystem,
      systemAddress: w.systemAddress,
      starClass: w.starClass ?? "",
      at: "",
      arrived: false,
      source: "route",
      likelyFirstFootfall: null,
    };
  }

  /**
   * Live `NavRoute.json` — returns true when the plotted route changed (for snapshot push).
   */
  applyLiveNavRoute(waypoints: NavRouteWaypointDTO[] | null): boolean {
    this.liveNavRoute = waypoints;
    const key =
      waypoints && waypoints.length > 0
        ? waypoints.map((w) => `${w.systemAddress}`).join(":")
        : waypoints === null
          ? "null"
          : "empty";
    if (key === this.lastLiveNavRoutePushKey) return false;
    this.lastLiveNavRoutePushKey = key;
    return true;
  }

  /** Journal replay snapshot for the disk cache (gameStatePayload.ts). */
  serializeJournalMergePayload(): JournalMergeCachePayload {
    return journalPayload.serializeJournalMergePayload(this);
  }

  /**
   * Restores journal-derived state after {@link resetAll}; user prefs are unchanged. False = not this cache format or
   * not a payload: treat it as a cache miss and replay the logs (gameStatePayload.ts says why that matters).
   */
  hydrateJournalMergePayload(data: JournalMergeCachePayload): boolean {
    return journalPayload.hydrateJournalMergePayload(this, data);
  }
}
