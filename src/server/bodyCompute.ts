/*
  One body's candidates as the app shows them (split out of snapshot.ts, discuss item 30, 1.3.1): the species
  matches with their chances, colours and codex novelty, rarity, the other-match cards, genus certainty and
  likelihoods, achievement progress, the shared exomastery summary, the colour outliers sweep, and the per-body
  cache that keeps a snapshot cheap while nothing about a body changed.
*/
import { getCachedPrices, getCachedSpeciesDatabase, onSpeciesReload, speciesGeneration, tagRarity } from "./speciesDb.js";
import { codexFirstCheck, codexFirstDataDate } from "./codexFirst.js";
import { colourRarity } from "./codexVariantCounts.js";
import { geologyForBody } from "./geology.js";
import { eddnLedgerStatus } from "./eddnLedger.js";
import { unknownPlantSlots } from "../shared/unknownPlants.js";
import { edastroBioRegionIds } from "./edastroNsp.js";
import { speciesProvenance } from "./speciesProvenance.js";
import {
  loadSharedExomastery,
  ownCodexBackupKeys,
  sharedExomasteryDir,
  sharedFindsWithOwnership,
  sharedGateAlerts,
  sharedSignature,
} from "./sharedExomastery.js";
import type { SharedExomasteryDTO } from "../shared/types.js";
import { UNOBSERVED } from "../shared/observedFlag.js";
import type {
  BodyComputed,
  GenusCertaintyDTO,
  BodyExoState,
  ExplorationScanRecord,
  PlanetScan,
  SpeciesDatabase,
  SpeciesEntry,
  SpeciesMatch,
  SpeciesMatchContext,
  TrackedAchievementDTO,
} from "../shared/types.js";
import { getProjectRoot } from "./paths.js";
import type { GameStateStore } from "./gameState.js";
import { shownSpeciesMatches, speciesMatchesCriteria } from "./matchSpecies.js";
import { buildSpeciesMatchContext } from "./speciesMatchContext.js";
import { candidateInputs, matchCandidates, rankCandidates, splitInputsFor } from "./candidatePipeline.js";
import { explainChances } from "./chanceWhy.js";
import { bumpMatchCacheEpoch } from "./matchCacheEpoch.js";
import { achievementAdvanceFor, trackedAchievementSummary, trackedSet } from "./achievements.js";
import { journalHostObservationFromSpeciesContext } from "./journalHostObservation.js";
import { resolveSpeciesPhoto } from "./speciesPhotos.js";
import { lookupPrice, type PriceIndex } from "./priceList.js";
import { bodyHasExoMarkers, exoMarkerBasis } from "./systemMap.js";
import { computeExoPayoutRangeFromMatches, resolveOrganicSlotCount } from "./exoPayoutRange.js";
import {
  augmentMatchesWithFootCatalog,
  footScannedCatalogSignature,
  resolveEntryForCatalogRow,
  mergeScanForExomastery,
  needsFootCatalogAugment,
} from "./footScannedCatalog.js";
import {
  applyExomasteryGenusCompetitivePercent,
  markExomasteryZeroHabitatMatches,
} from "./exomasteryGenusFinalize.js";
import { buildOtherMatchDetailDecks, otherMatchHasSimilarity } from "./exomasteryOtherMatch.js";
import { attachLazyDetail } from "./lazyMatchDetail.js";
import {
  buildBodyScanExomasteryDetail,
  buildExomasteryDetail,
  buildExomasteryVarietyHints,
  buildOtherMatchDetailCards,
  exomasteryDetailAlwaysHasStats,
  type ExomasteryProfileV1,
  exomasteryHabitatQualityPercent,
  exomasteryOtherMatchCardDeckScore,
  feederProfileBodyCount,
  hasExomasteryProfileFile,
  loadExomasteryProfile,
  resolveExomasteryExportBasename,
} from "./exomasteryProfile.js";
import { shortBodyLabel } from "../shared/systemMapLabels.js";
import { collectOwnOrganicLockSpeciesIds, collectResolvedOrganicLockSpeciesIds } from "./organicLocks.js";
import { loadGenusCooccurrenceTable } from "./genusCooccurrenceTable.js";
import {
  codexHasSpecies,
  codexNewColoursInRegion,
  codexSpeciesKey,
  gameOrderSpeciesName,
} from "../shared/codexLog.js";
import { candidateMorphColorLabelByLight } from "../shared/candidateSpawnHints.js";
import { genusLikelihoods, type GenusLikelihood } from "../shared/genusCooccurrence.js";
import { computeExoDataAlertsForBody } from "./exoDataConsistencyAlerts.js";
import { recordColourOutliersForBody, recordExoOutliersForBody } from "./exoOutlierLog.js";
import { recordPredictionForBody } from "./predictionAuditLog.js";
import { collectionFocusCached } from "./collectionFocus.js";
import { regionalRarity, syncRaritySightings } from "./speciesRarityData.js";
import { floorKeptReason } from "./presenceFloors.js";
import { bodyKey } from "../shared/bodyKey.js";

/**
 * Options → Notify me, "[CODEX FIRST] at 1 % or less" (owner, 2026-10-09): on, such a row stays in the
 * list with a red tint and a [?]; off, it goes to the unlikely list. The bootstrap hands in the notices
 * setting; on until it does.
 */
let codexFirstLowChanceKept: () => boolean = () => true;
export function setCodexFirstLowChanceKept(read: () => boolean): void {
  codexFirstLowChanceKept = read;
  computeBodyCache.clear();
}

export function attachOtherMatchCardScores(
  matches: SpeciesMatch[],
  scanForExo: PlanetScan | null,
  explorationRec: ExplorationScanRecord | null | undefined,
  root: string,
  journalHost: ReturnType<typeof journalHostObservationFromSpeciesContext>,
  decks: CandidateDecks,
): void {
  if (!scanForExo) {
    for (const m of matches) {
      m.exomasteryOtherMatchCardScore = null;
    }
    return;
  }
  for (const m of matches) {
    if (!m.exomasteryProfilePresent) {
      m.exomasteryOtherMatchCardScore = null;
      continue;
    }
    const prof = loadExomasteryProfile(root, m.entry);
    if (!prof) {
      m.exomasteryOtherMatchCardScore = null;
      continue;
    }
    const both = buildOtherMatchDetailDecks(prof, scanForExo, explorationRec ?? undefined, journalHost);
    decks.set(m.entry.id, both);
    m.exomasteryOtherMatchCardScore = exomasteryOtherMatchCardDeckScore(both.withoutSimilarity);
  }
}

/** The decks {@link attachOtherMatchCardScores} built, for the cards attached after the similarity is known. */
type CandidateDecks = Map<string, ReturnType<typeof buildOtherMatchDetailDecks>>;

export function attachOtherMatchDetailCardsToMatches(
  matches: SpeciesMatch[],
  scanForExo: PlanetScan | null,
  explorationRec: ExplorationScanRecord | null | undefined,
  root: string,
  journalHost: ReturnType<typeof journalHostObservationFromSpeciesContext>,
  decks: CandidateDecks,
): SpeciesMatch[] {
  if (!scanForExo) {
    return matches.map((m) => ({ ...m, otherMatchDetailCards: null }));
  }
  return matches.map((m) => {
    if (!m.exomasteryProfilePresent) return { ...m, otherMatchDetailCards: null };
    const both = decks.get(m.entry.id);
    if (both) {
      const sim = otherMatchHasSimilarity(m.exomasterySimilarityPercent ?? null);
      return { ...m, otherMatchDetailCards: sim ? both.withSimilarity : both.withoutSimilarity };
    }
    // A row added after the scores were taken (none today): built as it always was.
    const prof = loadExomasteryProfile(root, m.entry);
    if (!prof) return { ...m, otherMatchDetailCards: null };
    return {
      ...m,
      otherMatchDetailCards: buildOtherMatchDetailCards(
        prof,
        scanForExo,
        explorationRec ?? undefined,
        m.exomasterySimilarityPercent ?? null,
        journalHost,
      ),
    };
  });
}

/**
 * Rarity is dynamic (owner, 2026-09-27): the commander's codex entries newer than the EDSM dump add to
 * the counts, so tiers and region verdicts can move. Only when they did are the tags redone and the
 * cached matches dropped.
 */
export function syncRarity(store: GameStateStore, db: SpeciesDatabase): void {
  const root = getProjectRoot();
  if (!syncRaritySightings(root, store.codexSightings, db.species)) return;
  tagRarity(db, root);
  computeBodyCache.clear();
  bumpMatchCacheEpoch();
}

export function resolveStarForBodyTab(b: BodyExoState, store: GameStateStore): string {
  const fromBody = b.starSystem?.trim();
  if (fromBody) return fromBody;
  const fromVisit = store.visitedSystems.get(b.systemAddress)?.trim();
  if (fromVisit) return fromVisit;
  return (store.currentSystem ?? "").trim();
}

export function bodyTabLabel(b: BodyExoState, store: GameStateStore): string {
  const sk = bodyKey(b.systemAddress, b.bodyId);
  const rec = store.explorationScans.get(sk);
  const star = resolveStarForBodyTab(b, store);
  const fromRec = rec?.bodyName?.trim();
  const fromState = b.bodyName?.trim();
  const isGeneric = (s: string) => /^body\s+\d+$/i.test(s);

  let full = "";
  if (fromRec && !isGeneric(fromRec)) full = fromRec;
  else if (fromState && !isGeneric(fromState)) full = fromState;
  else if (fromRec) full = fromRec;
  else if (fromState) full = fromState;

  if (!full) return `Body ${b.bodyId}`;
  if (isGeneric(full)) return full;
  return shortBodyLabel(full, star);
}

/**
 * Compare candidate genera with the biological signal count the game already told us.
 *
 * One genus per signal, no genus twice, so an equal count means every candidate genus is present —
 * a decision the commander can act on without flying there, which is the whole point of the app.
 * Fewer candidates than signals cannot happen in the game and is therefore proof that one of our
 * gates is wrong; measured across the journal cache that fires on 15 of 1,096 bodies.
 *
 * Species marked `predictionUnsupported` are excluded from the count: they were never predicted, so
 * letting them satisfy the signal count would manufacture a certainty nobody earned. Candidates in
 * the unlikely tier are excluded for the same reason — a verdict has to be about the list the
 * commander is actually shown, or "certain" means nothing.
 */
export function genusCertaintyForBodyForTests(
  b: BodyExoState,
  matches: SpeciesMatch[],
): GenusCertaintyDTO | null {
  return genusCertaintyForBody(b, matches);
}

export function genusCertaintyForBody(b: BodyExoState, matches: SpeciesMatch[]): GenusCertaintyDTO | null {
  const signalCount = b.biologicalSignals;
  if (signalCount == null || !Number.isFinite(signalCount) || signalCount <= 0) return null;

  const byDir = new Map<string, string>();
  /** Genera with at least one row that earned its place, rather than being put back to fill the count. */
  const earned = new Set<string>();
  for (const m of matches) {
    if (m.entry.predictionUnsupported || m.unlikely) continue;
    const dir = m.entry.genusDataDir;
    if (!dir) continue;
    if (!m.restoredForSignalCount) earned.add(dir);
    if (byDir.has(dir)) continue;
    byDir.set(dir, m.entry.genus?.trim() || dir);
  }
  const genera = [...byDir.values()].sort((x, y) => x.localeCompare(y));
  const candidateGenera = genera.length;
  if (candidateGenera === 0) return null;

  /*
    A count met only by putting demoted rows back is not a certainty. Tegnae HT-Z d13-1 1 a (owner,
    2026-09-25): one signal, nothing passing the gates, so Anemone — never recorded under an F star —
    was put back and the line read "confirmed from the signal count alone". The plant was Bark Mounds,
    which the data did not have yet.
  */
  const restoredGenera = [...byDir.entries()]
    .filter(([dir]) => !earned.has(dir))
    .map(([, name]) => name)
    .sort((x, y) => x.localeCompare(y));
  const status =
    candidateGenera === signalCount
      ? restoredGenera.length
        ? "bestGuess"
        : "certain"
      : candidateGenera < signalCount
        ? "underCovered"
        : "ambiguous";
  return {
    status,
    signalCount,
    candidateGenera,
    genera,
    ...(status === "bestGuess" ? { restoredGenera } : {}),
  };
}

/**
 * Candidate genera in likelihood order, when there is a signal count to solve against.
 *
 * The list the matcher produces is unordered at genus level — alphabetical, which is to say
 * arbitrary. This orders it by how the corpus says the candidates are distributed, subject to the
 * constraint that exactly `signalCount` of them are present. Ordering only: the probabilities are
 * not calibrated and nothing renders them.
 *
 * Genera already confirmed on foot are passed in as known, so the solver conditions on them instead
 * of ranking them.
 */
export function genusLikelihoodsForBody(
  b: BodyExoState,
  matches: SpeciesMatch[],
  db: SpeciesDatabase,
  root: string,
): GenusLikelihood[] | null {
  const signalCount = b.biologicalSignals;
  if (signalCount == null || !Number.isFinite(signalCount) || signalCount <= 0) return null;
  const table = loadGenusCooccurrenceTable(root);
  if (!table) return null;

  const candidates = [
    ...new Set(
      matches.filter((m) => !m.unlikely && !m.entry.predictionUnsupported).map((m) => m.entry.genusDataDir),
    ),
  ].filter(Boolean);
  if (candidates.length === 0) return null;

  const confirmedIds = new Set(collectOwnOrganicLockSpeciesIds(b.organicGenusLocks, db));
  const known = [
    ...new Set(db.species.filter((e) => confirmedIds.has(e.id)).map((e) => e.genusDataDir)),
  ].filter((g) => candidates.includes(g));

  return genusLikelihoods(table, candidates, signalCount, known)?.likelihoods ?? null;
}

/**
 * Mark the candidates this commander has never logged in the codex (B4).
 *
 * Silent until the journals have been merged by a build that collects `CodexEntry` — with an empty
 * set the honest answer is "we do not know", and badging every candidate as new would be the loudest
 * possible way to be wrong.
 */
export function attachCodexNovelty(matches: SpeciesMatch[], store: GameStateStore): void {
  if (store.codexLoggedSpecies.size === 0) return;
  for (const m of matches) {
    m.notInCodex = !codexHasSpecies(store.codexLoggedSpecies, m.entry.displayName);
  }
}

/**
 * The colour each species was actually logged in on this body ("Stratum Tectonicas - Green" gives
 * "Green"), and the ones that are not what the app predicted: flagged on the row and returned for the
 * outliers file (owner, 2026-09-26).
 */
export function attachConfirmedColours(
  matches: SpeciesMatch[],
  b: BodyExoState,
  ctx: SpeciesMatchContext | null,
  scan: PlanetScan | null,
): { speciesId: string; speciesName: string; predicted: string; logged: string }[] {
  const misses: { speciesId: string; speciesName: string; predicted: string; logged: string }[] = [];
  if (!b.confirmedVariants?.length) return misses;
  const byKey = new Map<string, string>();
  for (const v of b.confirmedVariants) {
    const dash = v.indexOf(" - ");
    if (dash > 0) byKey.set(codexSpeciesKey(v.slice(0, dash)), v.slice(dash + 3).trim());
  }
  for (const m of matches) {
    const c = byKey.get(codexSpeciesKey(gameOrderSpeciesName(m.entry.displayName)));
    if (!c) continue;
    m.confirmedColour = c;
    const predicted = colourPredictionMissed(m.entry, c, ctx, scan);
    if (!predicted) continue;
    m.colourMismatchPredicted = predicted;
    misses.push({ speciesId: m.entry.id, speciesName: m.entry.displayName, predicted, logged: c });
  }
  return misses;
}

/**
 * What the app predicted for this species here, when that was not the colour logged; null when the
 * prediction was right or there was none. "(unknown)" is no prediction; "Cyan or Orange" is right
 * when either is logged.
 */
export function colourPredictionMissed(
  entry: SpeciesEntry,
  logged: string,
  ctx: SpeciesMatchContext | null,
  scan: PlanetScan | null,
): string | null {
  const predicted = predictedColourFor(entry, ctx, scan);
  if (!predicted || predicted.startsWith("(")) return null;
  const options = predicted.split(" or ").map((x) => x.trim().toLowerCase());
  return options.includes(logged.trim().toLowerCase()) ? null : predicted;
}

/**
 * Every logged colour in the journals, checked against the prediction (owner, 2026-09-26: "run
 * through my journals and add colours to outliers … needed for the codex").
 *
 * The snapshot only computes the bodies of the system in view, so a colour logged anywhere else
 * never reached the outliers file. This walks every body with a logged variant, once: a body is
 * checked again only when it gains a variant. Bodies go system by system, because the per-system
 * scan index is rebuilt whenever the system changes. The file's own once-per-(body, species) key
 * keeps a re-run from writing anything twice.
 */
const colourSweepSeen = new Map<string, number>();

/** The store revision each store was last swept at: no new confirmed colour, no pass over every body. */
const colourSweptAt = new WeakMap<GameStateStore, number>();

export function sweepColourOutliers(store: GameStateStore, db: SpeciesDatabase): number {
  // ~2 ms a snapshot on his journals for a pass that almost never finds anything (2026-10-01).
  if (colourSweptAt.get(store) === store.confirmedVariantsRevision) return 0;
  colourSweptAt.set(store, store.confirmedVariantsRevision);
  const pending = [...store.bodies.values()]
    .filter((b) => (b.confirmedVariants?.length ?? 0) > (colourSweepSeen.get(b.key) ?? 0))
    .sort((a, b) => a.systemAddress - b.systemAddress);
  if (!pending.length) return 0;
  const byName = new Map(db.species.map((e) => [codexSpeciesKey(gameOrderSpeciesName(e.displayName)), e]));
  let written = 0;
  for (const b of pending) {
    colourSweepSeen.set(b.key, b.confirmedVariants!.length);
    const scan = mergeScanForExomastery(
      b.scan,
      store.physicsExplorationScan(bodyKey(b.systemAddress, b.bodyId)),
    );
    if (!scan) continue;
    const ctx = buildSpeciesMatchContext(b, store);
    const misses: { speciesId: string; speciesName: string; predicted: string; logged: string }[] = [];
    for (const v of b.confirmedVariants!) {
      const dash = v.indexOf(" - ");
      if (dash <= 0) continue;
      const entry = byName.get(codexSpeciesKey(v.slice(0, dash)));
      const logged = v.slice(dash + 3).trim();
      if (!entry || !logged) continue;
      const predicted = colourPredictionMissed(entry, logged, ctx, scan);
      if (predicted) misses.push({ speciesId: entry.id, speciesName: entry.displayName, predicted, logged });
    }
    if (misses.length) {
      written += recordColourOutliersForBody({
        body: b,
        misses,
        colourStarType: ctx.colourStarType ?? ctx.parentStarType ?? null,
        candidates: misses.map((m) => m.speciesId),
      });
    }
  }
  return written;
}

/** Test seam. */
export function resetColourSweepForTests(store?: GameStateStore): void {
  colourSweepSeen.clear();
  if (store) colourSweptAt.delete(store);
}

/**
 * [CODEX]: the colour this body would grow is not yet in the commander's codex for this region
 * (owner, 2026-09-26 — per colour, as the game's CODEX tab keeps it). The colour is the same label the
 * species row shows, so the mark and the row never disagree. Silent until the journals have been
 * merged by a build that collects the per-region record, and when the region is unknown.
 */
export function attachCodexRegionNovelty(
  matches: SpeciesMatch[],
  store: GameStateStore,
  ctx: SpeciesMatchContext | null,
  scan: PlanetScan | null,
): void {
  const edastroBio = edastroBioRegionIds();
  // Your own codex backup (shared-exomastery, same FID) counts as logged: journals lost, codex not.
  const backup = ownCodexBackupKeys();
  const logged = backup.size ? new Set([...store.codexRegionLogged, ...backup]) : store.codexRegionLogged;
  if (logged.size === 0) return;
  const region = ctx?.regionName?.trim();
  if (!region) return;
  for (const m of matches) {
    const label = m.confirmedColour ?? m.predictedColour ?? predictedColourFor(m.entry, ctx, scan);
    const fresh = codexNewColoursInRegion(logged, region, m.entry.displayName, label);
    if (fresh) {
      m.codexNew = true;
      m.codexNewColours = fresh;
      m.codexRegion = region;
      // Nobody else has it here either (EDSM's dump, and EDAstro's when downloaded): the commander
      // would be the first (owner, 2026-09-30 / 2026-10-01).
      const first = codexFirstCheck(getProjectRoot(), region, m.entry.displayName, label, edastroBio);
      if (first) {
        m.codexFirst = true;
        m.codexFirstColours = first.colours;
        const asOf = codexFirstDataDate(getProjectRoot());
        if (asOf) m.codexFirstAsOf = asOf;
        if (first.edastro && edastroBio) {
          // The local date, like the EDSM dump's (codex_region_extract.py: date.today()).
          const d = new Date(edastroBio.fetchedAtMs);
          m.codexFirstEdastroAsOf = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          if (first.edastroSpeciesOnly) m.codexFirstEdastroSpeciesOnly = true;
        }
        const ledger = eddnLedgerStatus();
        if (ledger.found && ledger.checkedAt) m.codexFirstEddnAsOf = ledger.checkedAt.slice(0, 10);
      }
    }
  }
}

/**
 * How rare the colour each row would grow here is (1.2.19, plan F2): systems it has been logged in, galaxy-wide and in
 * this region, from EDAstro's codex. The colour is the row's own label, as [CODEX] reads it.
 */
export function attachColourRarity(matches: SpeciesMatch[], ctx: SpeciesMatchContext | null): void {
  const root = getProjectRoot();
  const region = ctx?.regionName?.trim() || null;
  for (const m of matches) {
    // predictedColour is set on every row just before (computeBodyUncached).
    const rarity = colourRarity(root, m.entry.displayName, m.confirmedColour ?? m.predictedColour, region);
    if (rarity.length) m.colourRarity = rarity;
  }
}

/**
 * A [CODEX FIRST] row in the list at 1 % or less (owner, 2026-10-09: "has a slightly red background
 * and a [?] explaining why they are seeing this, even with a very low chance"). Nothing keeps a row
 * for being a first: it stands on the same rules as every row, and the [?] says which one. With the
 * Options switch off it goes to the unlikely list instead, unless it was sampled here.
 */
export function explainLowChanceCodexFirst(matches: SpeciesMatch[]): void {
  const keep = codexFirstLowChanceKept();
  for (const m of matches) {
    if (m.unlikely || !m.codexNew || !m.codexFirst) continue;
    const pct = m.presenceProbabilityPercent;
    if (pct == null || !Number.isFinite(pct) || Math.round(pct) > 1) continue;
    const k = floorKeptReason(m);
    if (!keep && k?.why !== "sampled" && m.organicAnalysisComplete !== true) {
      m.unlikely = true;
      m.unlikelyReasons = [
        ...(m.unlikelyReasons ?? []),
        {
          field: "Chance here",
          detail: `${pct.toFixed(1)} % — a first codex entry, but Options → Notify me keeps those at 1 % or less out of the list.`,
        },
      ];
      continue;
    }
    m.lowChanceWhy = lowChanceWhy(m, k, pct);
  }
}

export function lowChanceWhy(m: SpeciesMatch, k: { why: string; pct: number } | null, pct: number): string {
  const genus = m.entry.genus || m.entry.genusDataDir;
  const why =
    k?.why === "sampled"
      ? "You have sampled it on this body."
      : k?.why === "approximate"
        ? "Some of the body's values are missing, so its match is approximate and the 1 % floor does not judge it."
        : k?.why === "best"
          ? "Every candidate on this body is under 1 %; the list keeps the best of them rather than none."
          : k?.why === "passed"
            ? `It cleared the 1 % floor at ${k.pct.toFixed(1)} %; how often its genus grows on bodies like this one then brought it down.`
            : k?.why === "genusShare"
              ? `The DSS found ${genus} here, and this is ${k.pct.toFixed(1)} % of it — over the 1 % the list needs once the genus is known. The chance beside it is for the body as a whole.`
              : k?.why === "genusBest"
                ? `The DSS found ${genus} here, and this is the likeliest ${genus} the list has.`
                : "It can grow on this body; the model has little to go on.";
  return (
    `Shown at ${pct < 0.05 ? "under 0.1" : pct.toFixed(1)} %: ${why} ` +
    `It is a [CODEX FIRST]: nobody has logged it in this region yet, so it is worth a look. ` +
    `Options → Notify me can keep these out of the list.`
  );
}

/**
 * The colour predicted for a species on this body: its own table or materials first, then the stars by
 * their light on the body, brightest first — a star whose class has no colour row hands over to the
 * next, and with none left it is "(unknown)", never a guessed class (owner, 2026-09-28).
 */
export function predictedColourFor(
  entry: SpeciesEntry,
  ctx: SpeciesMatchContext | null,
  scan: PlanetScan | null,
): string {
  const stars = ctx?.colourStarTypes?.length
    ? ctx.colourStarTypes
    : [ctx?.colourStarType ?? ctx?.parentStarType];
  return candidateMorphColorLabelByLight(entry, stars, scan?.materials);
}

/**
 * The tracked achievement (owner, 2026-09-27): mark the rows whose plant, here, would advance it —
 * the colour the row shows, in the body's region, not yet done. Same colour label as [CODEX].
 */
export function attachAchievementAdvance(
  matches: SpeciesMatch[],
  store: GameStateStore,
  ctx: SpeciesMatchContext | null,
  scan: PlanetScan | null,
): void {
  if (!store.trackedAchievementId) return;
  const root = getProjectRoot();
  const tracked = trackedSet(root, store, getCachedSpeciesDatabase().species);
  if (!tracked) return;
  for (const m of matches) {
    if (m.unlikely) continue;
    const label = m.confirmedColour ?? m.predictedColour ?? predictedColourFor(m.entry, ctx, scan);
    const adv = achievementAdvanceFor(
      root,
      store,
      getCachedSpeciesDatabase().species,
      tracked,
      m.entry.id,
      ctx?.regionName,
      label,
    );
    if (adv) m.achievementAdvance = adv;
  }
}

/** The tracked achievement for the app bar and the HUD, with what in the system in view advances it. */
export function trackedAchievementForSnapshot(
  store: GameStateStore,
  bodies: readonly BodyComputed[],
): TrackedAchievementDTO | null {
  const summary = trackedAchievementSummary(getProjectRoot(), store, getCachedSpeciesDatabase().species);
  if (!summary) return null;
  const here: TrackedAchievementDTO["here"] = [];
  for (const b of bodies) {
    for (const m of b.matches) {
      const a = m.achievementAdvance;
      if (!a || m.unlikely) continue;
      here.push({
        bodyKey: b.state.key,
        body: b.tabLabel || b.state.bodyName,
        species: m.entry.displayName,
        colours: a.variants.map((v) => v.split(" - ")[1] ?? v),
      });
    }
  }
  return { ...summary, here };
}

let sharedSummaryMemo: { key: string; value: SharedExomasteryDTO } | null = null;

/** The launcher's line about the shared folder (GET /api/exomastery/shared). */
export function sharedExomasterySummary(): SharedExomasteryDTO {
  return buildSharedExomasterySummary(getCachedSpeciesDatabase());
}

/**
 * What the launcher and the mail icon show about the shared-exomastery folder. The gate check walks
 * every shared find, so it runs once per change of the folder (or of the species data), not per push.
 */
export function buildSharedExomasterySummary(db: SpeciesDatabase): SharedExomasteryDTO {
  const key = `${sharedSignature()}#${speciesGeneration()}`;
  if (sharedSummaryMemo?.key === key) return sharedSummaryMemo.value;
  const s = loadSharedExomastery();
  const withOwner = sharedFindsWithOwnership(s);
  const commanders = new Set<string>();
  for (const { others } of withOwner) for (const c of others) commanders.add(c.fid ?? c.name ?? "?");
  const value: SharedExomasteryDTO = {
    folder: sharedExomasteryDir(),
    files: s.files,
    finds: withOwner.filter((x) => x.others.length > 0).length,
    ownBackupFinds: withOwner.filter((x) => x.own).length,
    commanders: commanders.size,
    alerts: sharedGateAlerts(db, resolveEntryForCatalogRow, (entry, scan, band, range) =>
      speciesMatchesCriteria(entry, scan, band, range, null),
    ),
  };
  sharedSummaryMemo = { key, value };
  return value;
}

export function ambiguityForBody(b: BodyExoState): string | null {
  const sig = b.biologicalSignals;
  const genusN = b.genusHints?.length ?? 0;
  const lines: string[] = [];

  /* Empty DSS genus hint is shown in the planetary DSS Genus pill; keep ambiguity for other cases only. */

  if (b.genusHints && sig !== null && genusN > sig) {
    lines.push(
      `DSS lists ${genusN} distinct genera while only ${sig} biological signal(s) are present — the extra genera may be misleading or share overlapping sites.`,
    );
  }

  if (lines.length === 0) return null;
  return lines.join(" ");
}

/**
 * Per-body results, keyed on everything {@link computeBodyUncached} reads.
 *
 * Matching and the exomastery card work dominate the snapshot build — 81 ms of an 83 ms build for
 * a two-body system — and it was redone from scratch on every push even when the body had not
 * changed. Only the entry for a body whose inputs actually moved is recomputed.
 */
export const computeBodyCache = new Map<string, { signature: string; value: BodyComputed }>();
// A reload of the species database or prices drops it (speciesDb.ts).
onSpeciesReload(() => computeBodyCache.clear());

/** Bounded so bodies from systems left behind cannot accumulate for a whole session. */
const COMPUTE_BODY_CACHE_MAX = 256;

/** Organic sample/analyse progress for this body only — feeds `isOrganicAnalysisCompleteForEntry`. */
export function organicProgressSignature(store: GameStateStore, bodyKey: string): string {
  const prefix = `${bodyKey}::`;
  const parts: string[] = [];
  for (const [k, v] of store.organicAnalyseByKey) {
    if (k.startsWith(prefix)) parts.push(`${k}=${v.count}:${v.label}`);
  }
  return parts.sort().join(",");
}

export function computeBodyCacheSignature(
  b: BodyExoState,
  store: GameStateStore,
  explorationRec: ExplorationScanRecord | null,
  root: string,
  db: SpeciesDatabase,
): string {
  return JSON.stringify({
    body: b,
    rec: explorationRec,
    ctx: buildSpeciesMatchContext(b, store),
    tab: bodyTabLabel(b, store),
    bacterium: store.includeBacteriumInSearch,
    firstFootfall: store.firstFootfallBodies.has(b.key),
    wasFootfalled: store.bodyDetailedFootfallState.get(b.key) ?? null,
    // The age is part of what is drawn, so the signature has to move when the observation does —
    // otherwise a body keeps showing a stale rung from cache.
    footfallSeenAt: store.bodyFootfallFlag.get(b.key)?.seenAt ?? null,
    mappedFlag: (() => {
      const m = store.bodyMappedFlag.get(b.key);
      return m ? `${String(m.value)}:${m.seenAt ?? ""}` : null;
    })(),
    organic: organicProgressSignature(store, b.key),
    species: speciesGeneration(),
    footCatalog: footScannedCatalogSignature(root),
    // A new CodexEntry changes the "new to you" and [CODEX] marks without touching the body.
    codex: `${store.codexLoggedSpecies.size}/${store.codexRegionLogged.size}`,
    codexFirstLow: codexFirstLowChanceKept(),
    // [CODEX FIRST] also reads EDAstro's plants: a download mid-session re-marks the bodies.
    edastroBio: edastroBioRegionIds()?.fetchedAtMs ?? 0,
    // …and the EDDN collector's ledger, when one answers (eddnLedger.ts).
    eddnLedger: (() => {
      const l = eddnLedgerStatus();
      return l.found ? `${l.plantRows}/${l.checkedAt?.slice(0, 10) ?? ""}` : 0;
    })(),
    // The tracked achievement's marks move with what is tracked and with every completion.
    achievement: `${store.trackedAchievementId ?? ""}/${store.achievementDone.size}`,
    shared: sharedSignature(),
    /*
      1.2.19 review: three inputs read from outside the body. The "worth sampling" marks follow every body's samples
      (collectionFocus); the first-footfall answer follows the system (populated, colony); the species split reads the
      system's stars (their classes and distances from arrival) — a new star scan re-ranks a cached body.
    */
    focus: [...collectionFocusCached(store.bodies.values(), db, root).keys()].sort().join(","),
    system: `${store.systemKind(b.systemAddress) ?? ""}/${store.noFirstFootfallInSystem(b.systemAddress)}`,
    stars: store
      .liveScansInSystem(b.systemAddress)
      .filter((r) => !!r.starType)
      .map((r) => `${r.bodyId}:${r.starType}:${Math.round(r.distanceFromArrivalLs ?? -1)}`)
      .sort()
      .join(","),
  });
}

export function computeBody(
  b: BodyExoState,
  db: SpeciesDatabase,
  prices: PriceIndex,
  store: GameStateStore,
): BodyComputed {
  const root = getProjectRoot();
  // Physics, not value: a sold system keeps its gravity, materials, composition and host star.
  const explorationRec = store.physicsExplorationScan(bodyKey(b.systemAddress, b.bodyId));
  const signature = computeBodyCacheSignature(b, store, explorationRec, root, db);
  const cached = computeBodyCache.get(b.key);
  if (cached && cached.signature === signature) return cached.value;

  const value = computeBodyUncached(b, db, prices, store);
  if (computeBodyCache.size >= COMPUTE_BODY_CACHE_MAX) computeBodyCache.clear();
  computeBodyCache.set(b.key, { signature, value });
  return value;
}

/**
 * A body the ship only AutoScanned (autoScanOnly.ts): its stats and nothing else (owner, 2026-10-05,
 * replacing the 2026-10-02 "fake one bio signal" rule — it listed Sinuous Tubers on a body nobody knew
 * had life, and hid A 1 and A 2 of Weqaei PS-T b3-3 beside the A 3 it kept). Every landable one gets
 * its tab; no candidates, no price, no unknown-plant slots until the FSS says how many signals there
 * are. The candidate panel says so instead.
 */
export function computeAutoScanOnlyBody(
  b: BodyExoState,
  store: GameStateStore,
  db: SpeciesDatabase = getCachedSpeciesDatabase(),
  prices: PriceIndex = getCachedPrices(),
): BodyComputed | null {
  const computed = computeBody({ ...b, key: `${b.key}#autoscan` }, db, prices, store);
  return {
    ...computed,
    state: b,
    matches: [],
    genusCertainty: null,
    genusLikelihoods: null,
    ambiguityNote: null,
    exoPayoutRange: null,
    exoDataAlerts: [],
    dssGenusOrphanHints: [],
    unknownPlants: [],
  };
}

export function computeBodyUncached(
  b: BodyExoState,
  db: SpeciesDatabase,
  prices: PriceIndex,
  store: GameStateStore,
): BodyComputed {
  const genusFilterActive = !!(b.genusHints && b.genusHints.length > 0);
  const root = getProjectRoot();
  // The same context, scan and passes as the backlog and the system map (candidatePipeline.ts).
  const inputs = candidateInputs(b, store);
  const { rec: explorationRec, scan: mergedScan, ctx: speciesMatchCtx, journalHost } = inputs;

  if (!mergedScan?.PlanetClass?.trim()) {
    const { alerts: exoDataAlerts, dssGenusOrphanHints } = computeExoDataAlertsForBody({
      body: b,
      mergedScan,
      matches: [],
      speciesMatchCtx,
      db,
      includeBacterium: store.includeBacteriumInSearch,
    });
    return {
      state: b,
      mergedScan,
      bodyScanDetail: null,
      tabLabel: bodyTabLabel(b, store),
      matches: [],
      genusFilterActive,
      genusCertainty: null,
      genusLikelihoods: null,
      ambiguityNote:
        b.biologicalSignals || genusFilterActive
          ? "Awaiting a detailed surface scan in the journal for this body — landable planet stats are required for matching."
          : null,
      estimatedSurfaceTempK: null,
      speciesMatchContext: speciesMatchCtx,
      approximateMatchingUsed: false,
      geology: geologyForBody({
        body: b,
        scan: mergedScan,
        region: speciesMatchCtx?.regionName,
        codexLogged: store.codexMapLogged,
      }),
      exoPayoutRange: null,
      exoDataAlerts,
      dssGenusOrphanHints,
    };
  }

  const {
    matches: raw,
    genusFilterActive: gfa,
    estimatedSurfaceTempK,
    approximateMatchingUsed,
  } = matchCandidates(b, { ...inputs, scan: mergedScan }, db, root, {
    includeBacterium: store.includeBacteriumInSearch,
  });
  const scanForExo = mergedScan;
  const bodyScanDetail = buildBodyScanExomasteryDetail(mergedScan, explorationRec);

  /*
    Which species on this body are known only from a composition scan.
    A foot scan says strictly more — it also proves the commander could reach it — so a species with
    both is simply confirmed, and the badge is for the ones the ship named from orbit.
  */
  const compScanOnly = new Set(
    collectResolvedOrganicLockSpeciesIds(
      (b.organicGenusLocks ?? []).filter((l) => !l.fromSibling && l.source === "codex"),
      db,
    ),
  );
  for (const id of collectResolvedOrganicLockSpeciesIds(
    (b.organicGenusLocks ?? []).filter(
      (l) => !l.fromSibling && l.source !== "codex" && l.source !== "spansh",
    ),
    db,
  )) {
    compScanOnly.delete(id);
  }
  /*
    Who logged each species here (owner, 2026-09-25): this commander's journal — a foot scan or the
    composition scanner — or other commanders, via Spansh, for a system looked up remotely.
  */
  const loggedByYou = new Set(
    collectResolvedOrganicLockSpeciesIds(
      (b.organicGenusLocks ?? []).filter((l) => !l.fromSibling && l.source !== "spansh"),
      db,
    ),
  );
  const loggedByOthers = new Set(
    collectResolvedOrganicLockSpeciesIds(
      (b.organicGenusLocks ?? []).filter((l) => !l.fromSibling && l.source === "spansh"),
      db,
    ),
  );
  /** Candidates whose habitat detail is attached last, built when read: species id → its profile. */
  const lazyDetails = new Map<string, ExomasteryProfileV1>();
  let matches: SpeciesMatch[] = raw.map((m) => {
    const { photoUrl, photoNote, photoUrls, photoVariants, photoCreditByUrl } = resolveSpeciesPhoto(
      m.entry,
      root,
    );
    const priceCredits = lookupPrice(prices, m.entry.displayName, m.entry.id);
    const hasFile = hasExomasteryProfileFile(root, m.entry);
    const profile = loadExomasteryProfile(root, m.entry);
    const hq =
      profile && scanForExo
        ? exomasteryHabitatQualityPercent(profile, scanForExo, explorationRec ?? undefined, journalHost)
        : null;
    return {
      ...m,
      photoUrl,
      photoNote,
      photoUrls,
      ...(photoVariants.length ? { photoVariants } : {}),
      ...(photoCreditByUrl ? { photoCreditByUrl } : {}),
      priceCredits,
      organicAnalysisComplete: store.isOrganicAnalysisCompleteForEntry(b.key, m.entry),
      ...(compScanOnly.has(m.entry.id) ? { confirmedByCompositionScan: true } : {}),
      ...(loggedByYou.has(m.entry.id)
        ? { loggedBy: "you" as const }
        : loggedByOthers.has(m.entry.id)
          ? { loggedBy: "others" as const }
          : {}),
      ...(hasFile
        ? {
            exomasteryProfilePresent: true,
            exomasteryHabitatQuality: hq ?? null,
            exomasteryProfileSampleCount: profile ? feederProfileBodyCount(profile) : null,
            exomasterySimilarityPercent: null,
            exomasteryVarietyHints: profile ? buildExomasteryVarietyHints(profile) : null,
            exomasteryExportBasename: resolveExomasteryExportBasename(root, m.entry),
            // The habitat detail is attached at the end of this function, built when read (lazyMatchDetail.ts).
            ...(profile && scanForExo && exomasteryDetailAlwaysHasStats(profile)
              ? (lazyDetails.set(m.entry.id, profile), {})
              : {
                  exomasteryDetail:
                    profile && scanForExo
                      ? buildExomasteryDetail(profile, scanForExo, explorationRec, journalHost)
                      : null,
                }),
          }
        : {}),
    };
  });
  matches = markExomasteryZeroHabitatMatches(matches);
  if (needsFootCatalogAugment(b, matches)) {
    matches = augmentMatchesWithFootCatalog(
      matches,
      b,
      db,
      prices,
      root,
      (entry) => store.isOrganicAnalysisCompleteForEntry(b.key, entry),
      explorationRec,
      journalHost,
      speciesMatchCtx,
      { includeBacterium: store.includeBacteriumInSearch },
    );
    matches = markExomasteryZeroHabitatMatches(matches);
  }
  // Ranking, genus split, floors, genus prior, veto, measured odds, Concha order (candidatePipeline.ts).
  const splitGenera = rankCandidates(matches, b, inputs, store, db, root);
  // The facts behind each shown row's number, for its [?] (plan 1.7): read only, body tab only.
  explainChances(matches, b, inputs, root, {
    splitGenera,
    splitInputs: splitGenera.size ? splitInputsFor(b, { ...inputs, scan: mergedScan }, store, root) : null,
  });
  /*
    The collection marker: species where both the corpus and this commander are short of bodies.

    **After the demotion, and only on rows the panel still offers.** A demoted candidate is one the
    app has decided will not grow here, so marking it "worth sampling" would send the commander to
    fetch something that is not there — the marker is advice about where to spend a landing, not a
    note about the species in the abstract. Read rather than computed, so a body being scrolled past
    costs one map lookup. See `collectionFocus.ts` for why none of it is ever shipped.
  */
  {
    const focus = collectionFocusCached(store.bodies.values(), db, root);
    if (focus.size > 0) {
      for (const m of matches) {
        if (m.unlikely) continue;
        const r = focus.get(m.entry.id);
        if (!r) continue;
        m.collectionFocus = true;
        m.collectionFocusNote = {
          ownScans: r.ownScans,
          corpusBodies: r.corpusBodies,
          remaining: r.remaining,
        };
      }
    }
  }
  /*
   * Who says this species is here, unioned from the two stores at the moment of rendering.
   *
   * Deliberately after the matcher has finished. Provenance describes the *evidence* for a row, not
   * whether the row belongs — feeding it back into scoring would let the commander's own scan
   * quietly re-weight a prediction, which is the circularity the whole gate ladder avoids.
   */
  for (const m of matches) {
    m.provenance = speciesProvenance(root, b.systemAddress, b.bodyId, m.entry);
    // Another commander's shared file has it on this very body (§S).
    if (m.provenance.sharedBy?.length && !m.loggedBy) m.loggedBy = "others";
  }
  const colourMisses = attachConfirmedColours(matches, b, speciesMatchCtx, scanForExo);
  if (colourMisses.length) {
    recordColourOutliersForBody({
      body: b,
      misses: colourMisses,
      colourStarType: speciesMatchCtx?.colourStarType ?? speciesMatchCtx?.parentStarType ?? null,
      candidates: matches.filter((m) => !m.unlikely).map((m) => m.entry.id),
    });
  }
  for (const m of matches) m.predictedColour = predictedColourFor(m.entry, speciesMatchCtx, scanForExo);
  attachCodexNovelty(matches, store);
  attachCodexRegionNovelty(matches, store, speciesMatchCtx, scanForExo);
  attachColourRarity(matches, speciesMatchCtx);
  explainLowChanceCodexFirst(matches);
  attachAchievementAdvance(matches, store, speciesMatchCtx, scanForExo);
  // Rarity where the body is (owner, 2026-09-27): a species can be common here and rare elsewhere.
  if (speciesMatchCtx?.regionName) {
    for (const m of matches) {
      const r = regionalRarity(getProjectRoot(), speciesMatchCtx.regionName, m.entry.id);
      if (r) m.regionRarity = r;
    }
  }
  const decks: CandidateDecks = new Map();
  attachOtherMatchCardScores(matches, scanForExo, explorationRec, root, journalHost, decks);
  applyExomasteryGenusCompetitivePercent(matches);
  if (matches.length > 0 && scanForExo) {
    matches = attachOtherMatchDetailCardsToMatches(
      matches,
      scanForExo,
      explorationRec,
      root,
      journalHost,
      decks,
    );
  }
  // `approximateMatchingUsed` (an on-foot scan named a species the gates rejected) is no longer
  // appended here: the owner moved that sentence behind the candidate list's [?] (2026-09-25).
  const note = ambiguityForBody(b);

  const { count: slots, source: slotSource } = resolveOrganicSlotCount(b);
  const wf = store.bodyDetailedFootfallState.get(b.key);
  const journalWasFootfalled = wf === undefined ? null : wf === true;
  const mult: 1 | 5 = store.firstFootfallBodies.has(b.key) ? 5 : 1;
  const exoPayoutRange =
    slots > 0 && bodyHasExoMarkers(b) && slotSource !== "none"
      ? computeExoPayoutRangeFromMatches(
          // Payout is about what is likely here, not about everything listed.
          shownSpeciesMatches(matches),
          prices,
          slots,
          slotSource,
          mult,
          journalWasFootfalled,
          mult === 5,
          store.bodyFootfallFlag.get(b.key) ?? UNOBSERVED,
          store.bodyMappedFlag.get(b.key) ?? UNOBSERVED,
        )
      : null;
  if (exoPayoutRange && store.noFirstFootfallInSystem(b.systemAddress)) {
    const kind = store.systemKind(b.systemAddress);
    if (kind && kind !== "empty") exoPayoutRange.noFootfallSystemKind = kind;
  }

  // Evidence for the next gate fix: a species the commander confirmed here that we never offered.
  // Writes once per (body, species) and never throws.
  recordExoOutliersForBody({ body: b, matches, db });

  // And the other half of the same question: what was offered *before* the answer arrived, so a
  // suggestion that turned out wrong can be argued with rather than only counted.
  recordPredictionForBody({ body: b, matches, db });

  const { alerts: exoDataAlerts, dssGenusOrphanHints } = computeExoDataAlertsForBody({
    body: b,
    mergedScan,
    matches,
    speciesMatchCtx,
    db,
    includeBacterium: store.includeBacteriumInSearch,
  });

  // Last, so no later copy of a row builds it (lazyMatchDetail.ts).
  if (scanForExo) {
    for (const m of matches) {
      const profile = lazyDetails.get(m.entry.id);
      if (!profile || Object.prototype.hasOwnProperty.call(m, "exomasteryDetail")) continue;
      attachLazyDetail(
        m,
        () => buildExomasteryDetail(profile, scanForExo, explorationRec, journalHost),
        true,
      );
    }
  }

  return {
    state: b,
    mergedScan,
    bodyScanDetail,
    tabLabel: bodyTabLabel(b, store),
    matches,
    genusFilterActive: gfa,
    ambiguityNote: note,
    genusCertainty: genusCertaintyForBody(b, matches),
    genusLikelihoods: genusLikelihoodsForBody(b, matches, db, root),
    estimatedSurfaceTempK,
    speciesMatchContext: speciesMatchCtx,
    approximateMatchingUsed,
    exoMarkerBasis: exoMarkerBasis(b),
    geology: geologyForBody({
      body: b,
      scan: mergedScan,
      region: speciesMatchCtx?.regionName,
      codexLogged: store.codexMapLogged,
    }),
    exoPayoutRange,
    exoDataAlerts,
    dssGenusOrphanHints,
    unknownPlants: unknownPlantSlots({
      signals: b.biologicalSignals,
      matches,
      genusHints: b.genusHints,
      orphanHints: dssGenusOrphanHints,
      includeBacterium: store.includeBacteriumInSearch,
    }),
  };
}
