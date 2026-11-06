import type { FootTravelFix } from "./footTravelStatus.js";
import { keepClearedMarks, withCodexScan, withoutCodexMarks, type SurfaceMark } from "./surfaceMarksFile.js";
import { logScanLocate } from "./scanLocateLog.js";
import { eyeAboveM, learnEyeHeight, noteShipLine } from "./eyeHeight.js";
import { elevationFromGravity } from "../shared/journalPhysics.js";
import { RADAR_RADIUS_DEFAULT_M, clampRadarRadiusM } from "../shared/radarRadius.js";
import { greatCircleDistanceMeters, resolveFootFixForOrganicLine } from "./footTravelStatus.js";
import type {
  JournalLine,
  SpeciesDatabase,
  ExoOrganicOverlayDTO,
  ExoMinimapDTO,
  ExoMinimapMarkDTO,
} from "../shared/types.js";
import { lookupPrice, type PriceIndex } from "./priceList.js";
import {
  displayLabelFromOrganicLine,
  speciesKeyFromOrganicJournal,
  normOrganicToken,
} from "./organicTracking.js";
import {
  normStatusBodyName,
  schedulePersistOrganicSampleSession,
  wipeOrganicSampleSession,
  type OrganicSampleSessionHost,
} from "./organicSampleSessionFile.js";
import { getProjectRoot } from "./paths.js";
import { sampleDistanceM, speciesGenusSampleDistanceM } from "./speciesTreeLoader.js";
import { bodyKey } from "../shared/bodyKey.js";

export type ExoOrganicAnchors = { latDeg: number; lonDeg: number; planetRadiusM: number };

export type ExoOrganicTrackerInternal = {
  bundleKey: string;
  bodyKey: string;
  speciesKey: string;
  speciesDisplay: string;
  genusLocalised: string;
  /** Normalized journal body name for `Status.json`/`BodyName` gating. */
  bodyNameNorm: string;
  minSampleDistanceM: number;
  anchors: ExoOrganicAnchors[];
  /**
   * Samples the journal says were taken but whose position was never captured.
   *
   * `ScanOrganic` has no coordinates, so a scan made while this app was closed can be *counted*
   * from the log and never *placed*. Kept separate from `anchors` so the two are never confused:
   * an anchor is somewhere you stood, this is only a number.
   */
  recoveredSamples?: number;
  /**
   * Which scan of the run each anchor is (0 = first, 1 = second, 2 = third), parallel to `anchors`;
   * absent means anchor i is scan i. A scan that could not be placed leaves its number unused, so
   * the next plant's position is not read as the first one's (owner, 2026-10-02: after a restart the
   * HUD showed the second plant's distance in the first row and nothing in the third).
   */
  anchorSlots?: number[];
  phase: "tracking" | "celebrate";
  celebrationUntil: number;
  /** Set when Analyse merges; true = species already in codex (no 5× codex bonus). */
  analyseWasLogged?: boolean;
};

/** Store slice used by overlay tracker (`GameStateStore` implements this). */
export type ExoOrganicOverlayHost = {
  exoOrganicTracker: ExoOrganicTrackerInternal | null;
  exoOrganicLastFix: FootTravelFix | null;
  /** When the run for this species on this body began (ms epoch), for the HUD timer. Optional on test hosts. */
  organicRunStartedAtMs?: (bodyKey: string, speciesKey: string) => number | undefined;
  readonly firstFootfallBodies: Set<string>;
  /** Where each plant was sampled — the radar's dots, kept across bodies and across restarts. */
  surfaceSampleMarks: SurfaceMark[];
  /** Body records, for the reference gravity and radius an elevation is measured against. */
  readonly explorationScans: ReadonlyMap<string, { surfaceGravity?: number; radius?: number; bodyName?: string }>;
  /** Composition-scan waypoints (`CodexEntry` positions). Optional so the test hosts keep working unchanged. */
  surfaceCodexMarks?: SurfaceMark[];
  /** Where the commander left the SRV (live lines only). Optional so the test hosts keep working unchanged. */
  surfaceSrvMark?: SurfaceMark | null;
  /** Writes the marks file (samples, ship, waypoints, SRV). */
  persistSurfaceMarks?(): void;
  addSurfaceSampleMark(
    bodyKey: string,
    bodyNameNorm: string,
    latDeg: number,
    lonDeg: number,
    label: string,
    atIso: string,
    conditions?: { temperatureK: number | null; gravityG: number | null; elevationM: number | null },
  ): void;
  surfaceShipMark: SurfaceMark | null;
  /** How far the radar draws. Optional so the test hosts in this repo keep working unchanged. */
  minimapRadiusM?: number;
};

/**
 * How far the minimap draws, in metres — now a setting, see `shared/radarRadius.ts`.
 *
 * It was 500 m: the owner's number, and the widest genus separation in the game, so a radar of that
 * radius always contained the ring being cleared. It stopped being the only sensible number when he
 * raised Elite's `LODDistanceScale` and plants began rendering out to about a kilometre.
 */
const minimapRadiusFor = (store: ExoOrganicOverlayHost): number =>
  clampRadarRadiusM(store.minimapRadiusM ?? RADAR_RADIUS_DEFAULT_M);

type ExoOrganicJournalStore = ExoOrganicOverlayHost &
  OrganicSampleSessionHost & {
    footTravelOdometerEnabled: boolean;
    beginFootTravelOdometerSession(bodyKey: string, bodyNameNorm: string | null): void;
  };

function expireCelebrationIfNeeded(store: ExoOrganicJournalStore, projectRoot: string): void {
  const t = store.exoOrganicTracker;
  if (!t || t.phase !== "celebrate") return;
  if (Date.now() >= t.celebrationUntil) {
    wipeOrganicSampleSession(store, projectRoot);
    /*
      The live surface fix is **not** cleared with the session.

      It belongs to the `Status.json` read, which is where every position comes from, and it is now what the
      radar draws from — so clearing it here made the radar blank for a frame and then reappear as
      the next poll landed. Against a card whose colour also changed as the session ended, that read
      as flashing. Owning a field means owning when it is emptied.
    */
  }
}

/**
 * How many scans of this plant are done.
 *
 * Two kinds, added: **anchors** are scans this app watched and therefore knows the position of, and
 * **recoveredSamples** are scans the journal reported while the app was closed, which can be counted
 * and never placed. A session restored at boot has only the second kind, so any rule written against
 * `anchors.length` alone reads it as untouched — which is how a second scan came to be ignored.
 *
 * Capped at three, because that is the run.
 */
function effectiveSampleCount(t: ExoOrganicTrackerInternal): number {
  return Math.min(3, (t.recoveredSamples ?? 0) + t.anchors.length);
}

/** The position of scan `scan` (0-based) of this run, when it is known. */
function anchorForScan(t: ExoOrganicTrackerInternal, scan: number): ExoOrganicAnchors | undefined {
  const i = t.anchors.findIndex((_, k) => (t.anchorSlots?.[k] ?? k) === scan);
  return i >= 0 ? t.anchors[i] : undefined;
}

/** Record where scan `scan` was taken. */
function pushAnchor(t: ExoOrganicTrackerInternal, a: ExoOrganicAnchors, scan: number): void {
  if (!t.anchorSlots) t.anchorSlots = t.anchors.map((_, k) => k);
  t.anchors.push(a);
  t.anchorSlots.push(scan);
}

/**
 * Where a scan was taken, from the radar's own marks.
 *
 * Every placed scan also leaves a mark, stamped with the journal line's own timestamp and saved in
 * its own file. So a run rebuilt from the journal (the session file gone, the app restarted) can
 * still place the scans this app watched: the same body and the same second is the same scan.
 */
function anchorFromMarks(
  store: ExoOrganicJournalStore,
  bodyKey: string,
  line: JournalLine,
): ExoOrganicAnchors | null {
  const at = typeof line.timestamp === "string" ? line.timestamp : "";
  if (!at) return null;
  const m = (store.surfaceSampleMarks ?? []).find((x) => x.bodyKey === bodyKey && x.atIso === at);
  if (!m) return null;
  const r = store.explorationScans?.get(bodyKey)?.radius;
  return { latDeg: m.latDeg, lonDeg: m.lonDeg, planetRadiusM: typeof r === "number" && r > 0 ? r : 0 };
}

function persistSoon(store: ExoOrganicJournalStore, projectRoot: string): void {
  schedulePersistOrganicSampleSession(store, projectRoot);
}

/**
 * The sample distance of the species a radar mark is labelled with ("Stratum Tectonicas"), from its
 * genus file; 0 when no species of the database carries that name.
 */
const ringByLabel = new Map<string, number>();
/** Set by snapshot.ts each time the species database loads (an import back would be circular). */
let ringSpeciesDb: SpeciesDatabase | null = null;
export function setExoOrganicSpeciesDb(db: SpeciesDatabase): void {
  ringSpeciesDb = db;
  ringByLabel.clear();
}
export function sampleDistanceForSpeciesLabel(label: string, db: SpeciesDatabase | null = ringSpeciesDb): number {
  const key = label.trim().toLowerCase();
  if (!key) return 0;
  const hit = ringByLabel.get(key);
  if (hit !== undefined) return hit;
  if (!db) return 0;
  const m = speciesGenusSampleDistanceM(db.species, label);
  ringByLabel.set(key, m);
  return m;
}

function speciesDisplayFromLine(line: JournalLine): string {
  const sl = typeof line.Species_Localised === "string" ? line.Species_Localised.trim() : "";
  return sl || displayLabelFromOrganicLine(line);
}

/**
 * Rebuild the sample count for a plant that was scanned while this app was closed.
 *
 * The owner's report: he scanned one and the overlay said zero. `ingestExoOrganicJournalLine` runs
 * on live lines only — deliberately, since replaying four years of scans would fire a celebration
 * for each — so a session in progress when the app starts was invisible.
 *
 * **Count only, never a position.** `ScanOrganic` carries no coordinates, so the one thing that
 * could be invented here is where the plant was, and inventing it would put a false dot on the
 * radar and a false distance in the rows. The count is a fact in the log; the position is not, and
 * the difference is kept in the type.
 *
 * Returns true when a session was restored, so the caller can say so.
 */
export function restoreOrganicSessionFromJournal(
  store: ExoOrganicJournalStore,
  lines: readonly JournalLine[],
  projectRoot: string,
  db: SpeciesDatabase,
): boolean {
  /*
    Walk backwards to the start of the current attempt: back to a landing on another body (or one
    that does not say which), or a scan on another body. A plant is sampled on one surface, so
    anything older belongs to a different one. Landings on the same body do not end it: hopping the
    ship from plant to plant is ordinary play, and stopping at the last Touchdown counted one scan of
    the owner's two (2026-10-02).
  */
  const recent: JournalLine[] = [];
  let surfaceKey: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const e = lines[i]!.event;
    if (e === "Liftoff" || e === "Touchdown") {
      const sa = lines[i]!.SystemAddress;
      const bid = lines[i]!.BodyID;
      if (typeof sa !== "number" || typeof bid !== "number") break;
      const k = bodyKey(sa, bid);
      if (surfaceKey === null) surfaceKey = k;
      else if (k !== surfaceKey) break;
      continue;
    }
    if (e !== "ScanOrganic") continue;
    {
      const sa = lines[i]!.SystemAddress;
      const bid = lines[i]!.Body;
      if (typeof sa === "number" && typeof bid === "number") {
        const k = bodyKey(sa, bid);
        if (surfaceKey === null) surfaceKey = k;
        else if (k !== surfaceKey) break;
      }
    }
    /*
      An Analyse ends the run before it, as surely as a landing does.

      Without this, a completed run was walked straight back into: the log since the last Touchdown
      holds `Log, Sample, Sample, Analyse` for a plant that is finished, and counting from the far
      end restored it as three-of-three in progress. Worse, the Log of whatever the commander
      started *next* was then ignored — the counter below takes the first Log it sees and treats
      later ones as noise. The owner reported exactly this: nothing picked up after the last Analyse.
    */
    if (
      String(lines[i]!.ScanType ?? "")
        .trim()
        .toLowerCase() === "analyse"
    )
      break;
    recent.push(lines[i]!);
  }
  if (recent.length === 0) return false;
  recent.reverse();

  /*
    The same state machine the live path runs, which is not "count the Samples".

    A new species opens with a **Log** — the codex entry — and that is the first anchor; after it,
    only Sample advances. Filtering to Sample alone reported nothing for a plant the commander had
    genuinely started: his one scan since landing was a Log of Bacterium Acies, and the overlay said
    zero. Mirroring the live rule rather than inventing a stricter one is the fix.
  */
  let counted: JournalLine[] = [];
  let runSpeciesKey = "";
  for (const l of recent) {
    const kind = String(l.ScanType ?? "")
      .trim()
      .toLowerCase();
    if (kind !== "sample" && kind !== "log") continue;
    const key = speciesKeyFromOrganicJournal(l);
    /*
      A different species starts the count again.

      Abandoning a half-sampled plant for a better one is ordinary play — walk off, find another
      genus, log that instead. Counting every Log and Sample since the landing as one run reported
      the abandoned species and its stale count, and the plant the commander is actually standing
      over went unmentioned.
    */
    if (counted.length > 0 && key !== runSpeciesKey) {
      counted = [];
      runSpeciesKey = "";
    }
    // A Log only ever opens a run; it never advances one.
    if (counted.length > 0 && kind === "log") continue;
    if (counted.length === 0) runSpeciesKey = key;
    counted.push(l);
  }
  if (counted.length === 0) return false;
  if (counted.length > 3) counted = counted.slice(0, 3);
  const last = counted[counted.length - 1]!;

  const sa = last.SystemAddress;
  const bodyId = last.Body;
  if (typeof sa !== "number" || typeof bodyId !== "number") return false;
  const bk = bodyKey(sa, bodyId);

  const speciesKey = speciesKeyFromOrganicJournal(last);
  const genusLoc = typeof last.Genus_Localised === "string" ? last.Genus_Localised.trim() : "";
  const speciesDisplay = speciesDisplayFromLine(last);
  const bundleKey = `${bk}::${speciesKey}`;

  /*
    A session restored from disk already covers this run, and it knows more than the log does.

    This function used to assign over whatever was there, which threw away every anchor the saved
    session had just brought back — and the anchors are the only record of *where* the plants were,
    since `ScanOrganic` has no coordinates. A commander who restarted the app after two samples came
    back to "2 scans" and no distances to either of them.

    So when the saved run is the same plant on the same body, it is kept and only topped up: any
    scan the log knows about and the file does not becomes a recovered count, which is the honest
    shape — a scan we know happened and cannot place.
  */
  const held = store.exoOrganicTracker;
  if (held && held.bundleKey === bundleKey) {
    // Scans the file does not place, placed from the radar's marks where they can be.
    counted.forEach((l, scan) => {
      if (anchorForScan(held, scan)) return;
      const a = anchorFromMarks(store, bk, l);
      if (a) pushAnchor(held, a, scan);
    });
    const placed = held.anchors.length;
    const missing = Math.max(0, counted.length - placed);
    if (missing > (held.recoveredSamples ?? 0)) held.recoveredSamples = missing;
    return true;
  }

  const anchors: ExoOrganicAnchors[] = [];
  const anchorSlots: number[] = [];
  counted.forEach((l, scan) => {
    const a = anchorFromMarks(store, bk, l);
    if (a) {
      anchors.push(a);
      anchorSlots.push(scan);
    }
  });

  store.exoOrganicTracker = {
    bundleKey,
    bodyKey: bk,
    speciesKey,
    speciesDisplay,
    genusLocalised: genusLoc,
    bodyNameNorm: normOrganicToken(
      typeof last.BodyName === "string" && last.BodyName.trim() ? last.BodyName.trim() : `Body ${bodyId}`,
    ),
    minSampleDistanceM: sampleDistanceM(db.species, genusLoc, speciesDisplay),
    anchors,
    anchorSlots,
    recoveredSamples: counted.length - anchors.length,
    phase: "tracking",
    celebrationUntil: 0,
  };
  return true;
}

/**
 * Live journal tail only (do not call during full journal hydration merge).
 * Tracks `ScanOrganic` Log/Sample/Analyse for live distance + codex-new 5× payout hints.
 * `WasLogged: true` on Sample clears an active session for that species bundle (resample / already logged).
 */
export function ingestExoOrganicJournalLine(
  store: ExoOrganicJournalStore,
  line: JournalLine,
  statusFix: FootTravelFix | null,
  projectRoot: string,
  db: SpeciesDatabase,
): void {
  expireCelebrationIfNeeded(store, projectRoot);
  noteShipLine(line);
  if (line.event === "CodexEntry") {
    addCodexScanMark(store, line, statusFix);
    return;
  }
  if (srvMarkLine(store, line, statusFix)) return;
  if (line.event !== "ScanOrganic") return;

  /** The line's own timestamp, so a mark is dated by when it happened rather than when it was read. */
  const lineIso = typeof line.timestamp === "string" ? line.timestamp : new Date().toISOString();

  const scanTypeRaw = line.ScanType;
  const scanType = typeof scanTypeRaw === "string" ? scanTypeRaw.trim() : "";
  if (!scanType) return;
  const scanKind = scanType.toLowerCase();

  const sa = line.SystemAddress;
  const bodyId = line.Body;
  if (typeof sa !== "number" || typeof bodyId !== "number") return;

  const bk = bodyKey(sa, bodyId);
  /*
    Sampled on foot: the composition-scan mark of the plant underfoot has done its job. The other marks of this species
    on the body stay, as the next plants to sample (owner, 2026-11-04: comp scan from the ship, then go round them),
    until the species is finished (Analyse). Without a position for the sample none can be told apart: they wait.
  */
  const retireHere = resolveFootFixForOrganicLine(statusFix, line);
  if (scanKind === "analyse" || retireHere) {
    const genusForRange = typeof line.Genus_Localised === "string" ? line.Genus_Localised.trim() : "";
    const marksBefore = store.surfaceCodexMarks ?? [];
    const marksAfter = withoutCodexMarks(
        marksBefore,
        bk,
        [line.Variant, line.Species].filter((x): x is string => typeof x === "string" && x.trim() !== ""),
        scanKind === "analyse" || !retireHere
          ? undefined
          : {
              latDeg: retireHere.latDeg,
              lonDeg: retireHere.lonDeg,
              radiusM: retireHere.planetRadiusM,
              withinM: Math.max(50, sampleDistanceM(db.species, genusForRange, speciesDisplayFromLine(line))),
            },
    );
    // The plant's real spot against where its scans put it, to tune the placing (scanLocateLog.ts).
    if (scanKind !== "analyse" && retireHere) logScanLocate(marksBefore.filter((m) => !marksAfter.includes(m)), retireHere, line.timestamp);
    setCodexMarks(store, marksAfter);
  }
  /*
    What to call the body this scan happened on.

    `ScanOrganic` does **not** carry `BodyName` — only `SystemAddress` and a numeric `Body`. Every
    one of the commander's scans confirms it. So the fallback below produces "body 22", which is not
    a name anything else in the app uses, and anything comparing it against `Status.json`'s
    `BodyName` can never match.

    That is what hid the radar dot: the mark was filed under "body 22" while the radar asked for
    "smojai uj-f b13-0 b 4". The ship was unaffected because `Touchdown` does carry a real name.

    `Status.json` is read at the moment the scan lands and names the surface the commander is
    standing on, which is by definition the body being scanned — so it is both the correct name and
    the same vocabulary the radar matches in. The old derivation stays as the fallback for a fix
    with no name.
  */
  /*
    Conditions at the plant, captured here because they cannot be captured anywhere else.

    `Status.json` is a live file, not a log: the temperature and gravity at the commander's feet
    exist only while they are standing there. Elevation is derived from that gravity against the
    body's own figures — `Altitude` is absent on foot, so there is no other source for it.
  */
  const bodyRec = store.explorationScans.get(bodyKey(sa, bodyId));
  const conditionsAtPlant = {
    temperatureK: statusFix?.temperatureK ?? null,
    gravityG: statusFix?.gravityG ?? null,
    elevationM: elevationFromGravity(statusFix?.gravityG, bodyRec?.surfaceGravity, bodyRec?.radius),
  };

  const statusBodyNorm = normStatusBodyName(statusFix?.bodyName ?? null);
  const bodyNameNormEarly =
    statusBodyNorm ??
    normOrganicToken(
      (typeof line.BodyName === "string" && line.BodyName.trim() ? line.BodyName.trim() : `Body ${bodyId}`) ||
        `body ${bodyId}`,
    );

  const tCross = store.exoOrganicTracker;
  if (tCross && tCross.bodyKey !== bk) {
    wipeOrganicSampleSession(store, projectRoot);
  }
  if (!store.exoOrganicTracker && store.footSessionBodyKey && store.footSessionBodyKey !== bk) {
    wipeOrganicSampleSession(store, projectRoot);
  }

  const speciesKey = speciesKeyFromOrganicJournal(line);
  const bundleKey = `${bk}::${speciesKey}`;
  const genusLoc = typeof line.Genus_Localised === "string" ? line.Genus_Localised.trim() : "";

  /** Log (initial codex) + Sample (physical samples) both carry position for distance tracking. */
  if (scanKind === "sample" || scanKind === "log") {
    const wl = line.WasLogged;
    if (wl === true) {
      const t = store.exoOrganicTracker;
      if (t && t.bundleKey === bundleKey) wipeOrganicSampleSession(store, projectRoot);
      return;
    }

    let t = store.exoOrganicTracker;
    if (t && t.phase === "celebrate") {
      if (t.bundleKey === bundleKey) return;
      wipeOrganicSampleSession(store, projectRoot);
      t = store.exoOrganicTracker;
    }

    /*
      Where the scan was taken: Status.json read as the line landed, else the last good read (the poll's own, 10 a second).
      A read caught mid-write gives nothing, and this used to drop the line outright, species switch and all: CMDR
      Nimblor's "sample bacterium then stratum and then bacterium again, it then thinks im still sampling stratum until
      i sample bacterium the third time and then it thinks its the first sample not the second" (2026-11-06). A scan
      with no position at all still switches the species and counts; it only cannot be placed.
    */
    const lastGood = store.exoOrganicLastFix;
    const fix =
      resolveFootFixForOrganicLine(statusFix, line) ??
      (lastGood && lastGood.planetRadiusM > 0 && Number.isFinite(lastGood.latDeg) && Number.isFinite(lastGood.lonDeg) ? lastGood : null);

    // Sampling another species destroys the sample in progress (owner, 2026-11-06): its run ends here.
    if (t && t.bundleKey !== bundleKey) {
      wipeOrganicSampleSession(store, projectRoot);
      t = store.exoOrganicTracker;
    }

    const speciesDisplay = speciesDisplayFromLine(line);
    const minM = sampleDistanceM(db.species, genusLoc, speciesDisplay);

    /** The first plant of a run: a fresh tracker anchored here (counted, unplaced, without a position), the map's mark, the foot session. */
    const startRun = (): void => {
      store.exoOrganicTracker = {
        bundleKey,
        bodyKey: bk,
        speciesKey,
        speciesDisplay,
        genusLocalised: genusLoc,
        bodyNameNorm: bodyNameNormEarly,
        minSampleDistanceM: minM,
        anchors: fix ? [{ latDeg: fix.latDeg, lonDeg: fix.lonDeg, planetRadiusM: fix.planetRadiusM }] : [],
        ...(fix ? {} : { recoveredSamples: 1 }),
        phase: "tracking",
        celebrationUntil: 0,
      };
      // The anchors are this species' own and are wiped when the next one starts; the map wants
      // every plant taken on this body, so it keeps its own list.
      if (fix)
        store.addSurfaceSampleMark(
          bk,
          bodyNameNormEarly,
          fix.latDeg,
          fix.lonDeg,
          speciesDisplay,
          lineIso,
          conditionsAtPlant,
        );
      store.footSessionBodyKey = bk;
      store.footSessionBodyNameNorm = bodyNameNormEarly;
      if (store.footTravelOdometerEnabled) {
        store.beginFootTravelOdometerSession(bk, bodyNameNormEarly);
      }
      persistSoon(store, projectRoot);
    };

    if (!t) {
      startRun();
      return;
    }

    if (t.bundleKey !== bundleKey) return;

    /*
      Three, not two — a run is three plants.

      The journal writes `Log, Sample, Sample, Analyse`: four events for three places, because Log is
      the first plant and Analyse fires a few seconds after the third at the same spot. At `>= 2`
      this branch treated the *third* plant as the start of a fresh run of the same species: it wiped
      the two anchors it had and began again with one. The overlay then had no third distance to
      show, and Analyse arrived at a session holding a single sample and wiped that too, so the run
      ended with no "Complete" at all. Only a fourth Log/Sample is a new run.
    */
    if (effectiveSampleCount(t) >= 3) {
      wipeOrganicSampleSession(store, projectRoot);
      startRun();
      return;
    }

    /*
      `< 2`, not `=== 1`.

      A session restored from the journal at boot knows a scan happened but has no anchor for it —
      `ScanOrganic` carries no position, so there is nothing to anchor. With `=== 1` the next live
      Sample matched neither this branch nor the `>= 2` restart above and was silently dropped: the
      owner's second scan went unrecorded while the first and third worked.
    */
    if (effectiveSampleCount(t) < 3) {
      if (scanKind === "log") return;
      if (!fix) {
        // Known to have happened, not where: counted like a scan the journal reported while the app was closed.
        t.recoveredSamples = (t.recoveredSamples ?? 0) + 1;
        persistSoon(store, projectRoot);
        return;
      }
      pushAnchor(
        t,
        { latDeg: fix.latDeg, lonDeg: fix.lonDeg, planetRadiusM: fix.planetRadiusM },
        effectiveSampleCount(t),
      );
      store.addSurfaceSampleMark(
        bk,
        bodyNameNormEarly,
        fix.latDeg,
        fix.lonDeg,
        speciesDisplay || t.speciesDisplay,
        lineIso,
        conditionsAtPlant,
      );
      t.speciesDisplay = speciesDisplay || t.speciesDisplay;
      t.genusLocalised = genusLoc || t.genusLocalised;
      t.minSampleDistanceM = minM || t.minSampleDistanceM;
      t.bodyNameNorm = bodyNameNormEarly || t.bodyNameNorm;
      persistSoon(store, projectRoot);
    }
    return;
  }

  if (scanKind === "analyse") {
    expireCelebrationIfNeeded(store, projectRoot);
    const t = store.exoOrganicTracker;
    if (!t || t.phase !== "tracking") return;
    if (t.bundleKey !== bundleKey) return;
    if (effectiveSampleCount(t) < 2) {
      wipeOrganicSampleSession(store, projectRoot);
      return;
    }

    /*
      A fallback for a third plant whose own position was missed, not a fourth place.

      Analyse fires seconds after the third Sample and at the same spot, so in an ordinary run the
      three anchors are already here and there is nothing to add — pushing one anyway would leave a
      duplicate of the third plant in the list. It is still worth doing when the third Sample landed
      without a fix (`Status.json` between writes, the app started mid-run), because Analyse is then
      the last chance to learn where the commander was standing. The radar's own marks dedupe by
      position, so the mark alongside is free either way.
    */
    const analyseFix =
      t.anchors.length < 3 && !anchorForScan(t, 2) ? resolveFootFixForOrganicLine(statusFix, line) : null;
    if (analyseFix) {
      pushAnchor(
        t,
        { latDeg: analyseFix.latDeg, lonDeg: analyseFix.lonDeg, planetRadiusM: analyseFix.planetRadiusM },
        2,
      );
      store.addSurfaceSampleMark(
        bk,
        bodyNameNormEarly || t.bodyNameNorm,
        analyseFix.latDeg,
        analyseFix.lonDeg,
        speciesDisplayFromLine(line) || t.speciesDisplay,
        lineIso,
        conditionsAtPlant,
      );
    }

    const wasLogged = line.WasLogged === true;
    t.phase = "celebrate";
    t.celebrationUntil = Date.now() + 60_000;
    t.analyseWasLogged = wasLogged;
    persistSoon(store, projectRoot);
  }
}

/**
 * A biological `CodexEntry` with a position (the ship's composition scanner, or one on foot): a radar waypoint for
 * that plant until the species is logged on the body. `CodexEntry` carries Latitude, Longitude and BodyID (97 of 97
 * biological ones in the owner's October journals), so `Status.json` is needed only for the body's name.
 */
function addCodexScanMark(store: ExoOrganicJournalStore, line: JournalLine, statusFix: FootTravelFix | null): void {
  if (line.Category !== "$Codex_Category_Biology;") return;
  const { SystemAddress: sa, BodyID: bodyId, Latitude: lat, Longitude: lon, Name: name } = line;
  if (typeof sa !== "number" || typeof bodyId !== "number" || typeof lat !== "number" || typeof lon !== "number") return;
  if (typeof name !== "string" || !name.trim()) return;
  const bk = bodyKey(sa, bodyId);
  const label =
    typeof line.Name_Localised === "string" && line.Name_Localised.trim() ? line.Name_Localised.trim() : name;
  const bodyName = store.explorationScans.get(bk)?.bodyName ?? statusFix?.bodyName ?? null;
  const atIso = typeof line.timestamp === "string" ? line.timestamp : new Date().toISOString();
  /*
    How the scanner was pointed, from Status.json at that moment (the line has no heading): only in the ship, where
    Status.json reports an altitude. On foot the line's position is the plant itself, and a heading there would draw a
    line through it that crosses nothing real.
  */
  const inShip = statusFix?.altitudeM != null;
  const radiusM = statusFix?.planetRadiusM ?? store.explorationScans.get(bk)?.radius ?? 0;
  setCodexMarks(
    store,
    withCodexScan(
      store.surfaceCodexMarks ?? [],
      { bodyKey: bk, bodyNameNorm: normStatusBodyName(bodyName) ?? "", label, atIso, codexName: name },
      {
        latDeg: lat,
        lonDeg: lon,
        headingDeg: inShip ? (statusFix?.headingDeg ?? null) : null,
        altitudeM: inShip ? (statusFix?.altitudeM ?? null) : null,
        pitchDeg: inShip ? (statusFix?.pitchDeg ?? null) : null,
        atIso,
        ...(inShip && statusFix?.pitchFromHud ? { pitchFromHud: true } : {}),
        ...(inShip ? { eyeAboveM: eyeAboveM() } : {}),
      },
      radiusM,
    ),
  );
  // A plant two scans placed teaches the ship's eye height (eyeHeight.ts).
  for (const m of store.surfaceCodexMarks ?? [])
    if (m.bodyKey === bk && m.codexName === name && m.located === "crossing" && m.scans) learnEyeHeight(m, m.scans, radiusM);
}

/**
 * The SRV left on the surface (plan 1.3.6 S-2, owner 2026-11-02): stepping out of it (`Disembark`, `SRV: true`) marks
 * where it stands, from `Status.json` at that moment (the line has no position); boarding it again, docking it in the
 * ship, launching another or losing it clears the mark. True when the line was one of these.
 */
function srvMarkLine(store: ExoOrganicJournalStore, line: JournalLine, statusFix: FootTravelFix | null): boolean {
  const e = line.event;
  if (e === "Disembark" && line.SRV === true) {
    const sa = line.SystemAddress;
    const bodyId = line.BodyID;
    if (!statusFix || typeof sa !== "number" || typeof bodyId !== "number") return true;
    const bk = bodyKey(sa, bodyId);
    const bodyName = (typeof line.Body === "string" && line.Body.trim()) || store.explorationScans.get(bk)?.bodyName || statusFix.bodyName;
    store.surfaceSrvMark = {
      bodyKey: bk,
      bodyNameNorm: normStatusBodyName(bodyName ?? null) ?? "",
      latDeg: statusFix.latDeg,
      lonDeg: statusFix.lonDeg,
      label: "Your SRV",
      atIso: typeof line.timestamp === "string" ? line.timestamp : new Date().toISOString(),
    };
    store.persistSurfaceMarks?.();
    return true;
  }
  // Flying the ship off (not a dismissed ship lifting off on its own) leaves no SRV behind: the game recalls it.
  const flownOff = (e === "Liftoff" && line.PlayerControlled === true) || e === "SupercruiseEntry" || e === "FSDJump";
  if ((e === "Embark" && line.SRV === true) || e === "DockSRV" || e === "LaunchSRV" || e === "SRVDestroyed" || flownOff) {
    if (store.surfaceSrvMark) {
      store.surfaceSrvMark = null;
      store.persistSurfaceMarks?.();
    }
    return true;
  }
  return false;
}

/** The waypoints changed (the helpers hand back the same list when nothing did): keep and write them. */
function setCodexMarks(store: ExoOrganicOverlayHost, next: SurfaceMark[]): void {
  if (next === store.surfaceCodexMarks || (!next.length && !store.surfaceCodexMarks?.length)) return;
  store.surfaceCodexMarks = next;
  store.persistSurfaceMarks?.();
}

/**
 * Where things are around you on this body, in metres.
 *
 * **Not tied to a sample session.** It was, and that was wrong: the overlay only built a payload
 * while a species was being tracked, so a commander standing on a planet having just landed saw no
 * map at all — the owner reported exactly that. A radar answers "what is around me here", which is
 * a question about the rock, not about whichever plant is half-sampled. So it is built from the
 * live surface fix alone, and the distance rows above it keep their own gate.
 *
 * Done here rather than in the overlay because the overlay is a transparent HUD ticking every
 * 320 ms and should not be running spherical trigonometry; and because the latitudes are here.
 *
 * The flat-earth approximation is fine and worth saying out loud: over a few hundred metres on a
 * body thousands of kilometres across, treating a degree of latitude as a fixed number of metres is
 * wrong by far less than a marker is wide. The longitude term keeps its cos(lat) factor because
 * that one is not negligible — near a pole it is the difference between a map and a lie.
 */
export function buildExoMinimapDto(
  store: ExoOrganicOverlayHost,
  bodyKeyOnFoot: string | null,
  minSampleDistanceM: number,
): ExoMinimapDTO | null {
  const fix = store.exoOrganicLastFix;
  if (!fix) return null;
  // No body underfoot (no touchdown, no sample run): a radar of the planet flown over (`near`), which the HUD shows with
  // "Radar always on" or when the planet has composition scans. Owner, 2026-11-04: "always on while near a planet, as
  // long as we have the coordinates and heading in the status.json" — so whatever the flight mode, while Status.json
  // gives a position, a heading and the body's name; it closes when they go.
  const near = !bodyKeyOnFoot;
  if (near && (fix.headingDeg == null || !normStatusBodyName(fix.bodyName))) return null;
  // Matches no mark's key: flying over, a mark is placed by the body's name alone.
  const footKey = bodyKeyOnFoot ?? "\u0000near";
  const R = fix.planetRadiusM;
  if (!(R > 0)) return null;

  const torad = Math.PI / 180;
  const mPerDegLat = (Math.PI * R) / 180;
  const mPerDegLon = mPerDegLat * Math.cos(fix.latDeg * torad);
  const marks: ExoMinimapMarkDTO[] = [];

  const push = (
    latDeg: number,
    lonDeg: number,
    kind: "sample" | "ship" | "codex" | "srv",
    markLabel: string,
    active = false,
    ringM = 0,
    extra: Partial<ExoMinimapMarkDTO> = {},
  ) => {
    // Longitude wraps; without this a plant just across the antimeridian reads as half a planet away.
    let dLon = lonDeg - fix.lonDeg;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    marks.push({
      kind,
      northM: (latDeg - fix.latDeg) * mPerDegLat,
      eastM: dLon * mPerDegLon,
      distanceM: greatCircleDistanceMeters(fix.latDeg, fix.lonDeg, latDeg, lonDeg, R),
      label: markLabel,
      active,
      ...(ringM > 0 ? { ringM } : {}),
      ...extra,
    });
  };

  /*
    Which body's marks to show — and it is decided by `Status.json`, not by the journal.

    The owner's rule: "if I enter supercruise they get dropped until I go down on that planet
    again". Nothing is deleted when he leaves; the marks are filed under their body and stop
    matching while he is elsewhere. `Status.json` names the body he is actually on, second by
    second, which is the only source that knows he has left — the journal's last Touchdown still
    says "that planet" long after he has flown away.

    The body key is the fallback for the case where the live fix has no name, which happens on some
    surfaces; a key from the session or the last landing is better than refusing to draw.
  */
  const belongsHere = belongsHereFor(fix, footKey);

  /*
    The species the commander is sampling right now, if the run is on this body.

    `ScanOrganic` tracks one species per planet, so the tracker names the only run that can be in
    progress here. Everything else on this rock is a leftover — worth keeping on the map, worth not
    mistaking for the thing being collected.
  */
  const tracker = store.exoOrganicTracker;
  const { activeSpecies, isRunSample } = runOn(store, belongsHere);
  for (const m of store.surfaceSampleMarks) {
    if (!belongsHere(m)) continue;
    const isActive = isRunSample(m);
    // The run's own distance for its marks; a leftover species' from its genus. An abandoned sample of the species
    // being sampled has none: sampling another genus destroyed it and the game no longer measures from it (owner,
    // 2026-11-06: Stratum, Bacterium, Stratum, Stratum read as Stratum scanned three times).
    const abandoned = !isActive && activeSpecies != null && m.label.trim().toLowerCase() === activeSpecies;
    const ringM = isActive ? minSampleDistanceM : abandoned ? 0 : sampleDistanceForSpeciesLabel(m.label);
    // Which of the run's scans it is (review P15): the slot of the anchor standing where the mark is.
    const k = isActive && tracker ? tracker.anchors.findIndex((a) => samePlace(a, m)) : -1;
    const scanNo = k >= 0 ? (tracker!.anchorSlots?.[k] ?? k) + 1 : undefined;
    push(m.latDeg, m.lonDeg, "sample", m.label, isActive, ringM, { name: m.label, ...(scanNo ? { scanNo } : {}) });
  }
  /*
    The next plant to sample (owner, 2026-11-04: comp scan from the ship, then drive round them): a composition scan of
    the species being sampled whose spot is outside the clonal range of every sample of this run, nearest first.
  */
  const run = tracker && activeSpecies != null && tracker.phase === "tracking" ? tracker : null;
  const outsideRange = (m: { latDeg: number; lonDeg: number }) =>
    !!run && run.anchors.every((a) => greatCircleDistanceMeters(a.latDeg, a.lonDeg, m.latDeg, m.lonDeg, R) >= minSampleDistanceM);
  const isRunPlant = (m: SurfaceMark) => !!run && !!m.codexName && run.speciesKey.toLowerCase().includes(m.codexName.toLowerCase());
  let target: SurfaceMark | null = null;
  let targetM = Infinity;
  for (const m of store.surfaceCodexMarks ?? []) {
    if (!belongsHere(m) || !isRunPlant(m) || !outsideRange(m)) continue;
    const d = greatCircleDistanceMeters(fix.latDeg, fix.lonDeg, m.latDeg, m.lonDeg, R);
    if (d < targetM) {
      target = m;
      targetM = d;
    }
  }
  const NOTE: Record<NonNullable<SurfaceMark["located"]>, string> = {
    crossing: "located from 2 scans",
    ahead: "ahead of where it was scanned",
    "scanned-from": "scanned from here",
  };
  for (const m of store.surfaceCodexMarks ?? []) {
    if (!belongsHere(m)) continue;
    const how = m.located ?? "scanned-from";
    // Active: a plant of the species being sampled (green on the radar); the others are drawn yellow (review P14).
    push(m.latDeg, m.lonDeg, "codex", `${m.label} (${m === target ? "next to sample, " : ""}${NOTE[how]})`, isRunPlant(m), 0, {
      name: m.label,
      located: how,
      ...(how === "scanned-from" && m.headingDeg != null ? { scanHeadingDeg: m.headingDeg } : {}),
      ...(m === target ? { target: true } : {}),
    });
  }
  const ship = store.surfaceShipMark;
  if (ship && belongsHere(ship)) push(ship.latDeg, ship.lonDeg, "ship", "Your ship");
  const srv = store.surfaceSrvMark;
  if (srv && belongsHere(srv)) push(srv.latDeg, srv.lonDeg, "srv", "Your SRV");

  return {
    radiusM: minimapRadiusFor(store),
    headingDeg: fix.headingDeg,
    minSampleDistanceM,
    marks,
    ...(near ? { near: true } : {}),
    altitudeM: fix.altitudeM ?? null,
    pitchDeg: fix.pitchDeg ?? null,
    eyeAboveM: eyeAboveM(),
    ...(fix.pitchFromHud ? { pitchFromHud: true, rollDeg: fix.rollDeg ?? null } : {}),
    ...(clearArm && clearArm.untilMs > Date.now() ? { clearArmed: clearArm.count } : {}),
  };
}

/** Whether a mark is on the body `Status.json` names (see buildExoMinimapDto), else the one with key `footKey`. */
function belongsHereFor(fix: FootTravelFix, footKey: string): (m: { bodyKey: string; bodyNameNorm?: string }) => boolean {
  const onBodyNorm = normStatusBodyName(fix.bodyName);
  // A mark from an older store may have no name; its key is then the only thing to go on, and
  // refusing to draw it would lose a ship that is genuinely parked here.
  return (m) => (onBodyNorm && m.bodyNameNorm ? m.bodyNameNorm === onBodyNorm : m.bodyKey === footKey);
}

/** A mark standing where a scan was taken (sessions keep exact coordinates). */
const samePlace = (a: { latDeg: number; lonDeg: number }, m: { latDeg: number; lonDeg: number }) =>
  Math.abs(a.latDeg - m.latDeg) < 1e-5 && Math.abs(a.lonDeg - m.lonDeg) < 1e-5;

/**
 * The species being sampled on this body (lower case; null: no run here), and whether a sample mark is one of its own:
 * where its own scans stand, so an earlier, abandoned run of the same species here is a leftover (review 2026-11-05:
 * its marks were green and ringed, and the walk-away arc pointed from them).
 */
function runOn(
  store: ExoOrganicOverlayHost,
  belongsHere: (m: { bodyKey: string; bodyNameNorm?: string }) => boolean,
): { activeSpecies: string | null; isRunSample: (m: SurfaceMark) => boolean } {
  const tracker = store.exoOrganicTracker;
  const activeSpecies =
    tracker && belongsHere({ bodyKey: tracker.bodyKey, bodyNameNorm: tracker.bodyNameNorm })
      ? tracker.speciesDisplay.trim().toLowerCase()
      : null;
  const ofThisRun = (m: { latDeg: number; lonDeg: number }) => !tracker?.anchors.length || tracker.anchors.some((a) => samePlace(a, m));
  return {
    activeSpecies,
    isRunSample: (m) => activeSpecies != null && m.label.trim().toLowerCase() === activeSpecies && ofThisRun(m),
  };
}

/** How long the clear key waits for its second press. */
export const CLEAR_ARM_MS = 3000;
/** The clear key's first press: on which body, until when, and how many marks would go. */
let clearArm: { untilMs: number; count: number; body: string } | null = null;

/**
 * The clear key (owner, 2026-11-04: "a key bind to do the delete of current planet scans"): the first press arms it
 * and the radar asks for a second; a second press on the same body within {@link CLEAR_ARM_MS} moves this planet's
 * sample and composition-scan marks to the file's `cleared` list (surfaceMarksFile.ts keepClearedMarks), off the radar, the screen marker and everything that
 * reads the marks ("keep in memory file but just remove them from the screen and the calculations"). The ship and the
 * SRV stay, and so do the samples of the run in progress (owner, 2026-11-05: "do not end the current sample run, just
 * remove the comp scan things from the screen"): the game still measures from them. Null when there is nothing to clear.
 */
export function pressClearMarksHere(
  store: ExoOrganicOverlayHost,
  bodyKeyOnFoot: string | null,
  nowMs: number,
  /** Sends the radar again: now, and when the wait for the second press runs out (its "press again" goes). */
  changed?: () => void,
): { armed: number } | { cleared: number } | null {
  const fix = store.exoOrganicLastFix;
  if (!fix) return null;
  const onBody = belongsHereFor(fix, bodyKeyOnFoot ?? "\u0000near");
  const { isRunSample } = runOn(store, onBody);
  const here = (m: SurfaceMark) => onBody(m) && !isRunSample(m);
  const body = normStatusBodyName(fix.bodyName) ?? bodyKeyOnFoot ?? "";
  const gone = [...store.surfaceSampleMarks.filter(here), ...(store.surfaceCodexMarks ?? []).filter(onBody)];
  if (!clearArm || clearArm.untilMs <= nowMs || clearArm.body !== body) {
    clearArm = gone.length ? { untilMs: nowMs + CLEAR_ARM_MS, count: gone.length, body } : null;
    if (!gone.length) return null;
    if (changed) {
      changed();
      setTimeout(changed, CLEAR_ARM_MS + 50).unref?.();
    }
    return { armed: gone.length };
  }
  clearArm = null;
  if (!gone.length) return null;
  keepClearedMarks(gone, new Date(nowMs).toISOString());
  store.surfaceSampleMarks = store.surfaceSampleMarks.filter((m) => !here(m));
  if (store.surfaceCodexMarks) store.surfaceCodexMarks = store.surfaceCodexMarks.filter((m) => !onBody(m));
  store.persistSurfaceMarks?.();
  changed?.();
  return { cleared: gone.length };
}

export function buildExoOrganicOverlayDto(
  store: ExoOrganicOverlayHost,
  prices: PriceIndex,
): ExoOrganicOverlayDTO | null {
  expireCelebrationIfNeeded(store as ExoOrganicJournalStore, getProjectRoot());
  const t = store.exoOrganicTracker;
  if (!t) return null;

  const fix = store.exoOrganicLastFix;
  const anchors = t.anchors;
  // By scan number, not list position: a scan that could not be placed keeps its row empty.
  const byScan = [anchorForScan(t, 0), anchorForScan(t, 1), anchorForScan(t, 2)];
  const minG = Math.max(0, Math.round(t.minSampleDistanceM));

  const avgR = (a: ExoOrganicAnchors): number =>
    typeof a?.planetRadiusM === "number" && a.planetRadiusM > 0 ? a.planetRadiusM : (fix?.planetRadiusM ?? 0);

  let distFirstM: number | null = null;
  let distSecondM: number | null = null;
  let distThirdM: number | null = null;
  let spacingBetweenSamplesM: number | null = null;

  const distTo = (a: ExoOrganicAnchors | undefined): number | null =>
    fix && a && avgR(a) > 0
      ? greatCircleDistanceMeters(fix.latDeg, fix.lonDeg, a.latDeg, a.lonDeg, avgR(a))
      : null;
  distFirstM = distTo(byScan[0]);
  distSecondM = distTo(byScan[1]);
  distThirdM = distTo(byScan[2]);
  if (byScan[0] && byScan[1]) {
    const ra = avgR(byScan[0]);
    if (ra > 0) {
      spacingBetweenSamplesM = greatCircleDistanceMeters(
        byScan[0].latDeg,
        byScan[0].lonDeg,
        byScan[1].latDeg,
        byScan[1].lonDeg,
        ra,
      );
    }
  }

  const spacingMeetsMin = spacingBetweenSamplesM != null && minG > 0 ? spacingBetweenSamplesM >= minG : null;

  const separationForSecondSampleM = effectiveSampleCount(t) === 1 ? distFirstM : null;
  const separationMeetsMin =
    separationForSecondSampleM != null && minG > 0 ? separationForSecondSampleM >= minG : null;

  let distToNearestSampleM: number | null = null;
  if (fix && anchors.length > 0) {
    let best: number | null = null;
    for (const a of anchors) {
      const R = avgR(a);
      if (R <= 0) continue;
      const d = greatCircleDistanceMeters(fix.latDeg, fix.lonDeg, a.latDeg, a.lonDeg, R);
      if (best === null || d < best) best = d;
    }
    distToNearestSampleM = best != null ? Math.round(best) : null;
  }
  const nearestSampleMeetsMin =
    distToNearestSampleM != null && minG > 0 ? distToNearestSampleM >= minG : null;

  const label = t.speciesDisplay;
  const baseCredits = lookupPrice(prices, label, label);
  const ff: 1 | 5 = store.firstFootfallBodies.has(t.bodyKey) ? 5 : 1;

  /*
    The list price × 5 on a first-footfall body, else × 1: the bonus is the first footfall's, never a new codex entry's
    (owner 2026-11-06: a commander's HUD said "5,000,000 CR (new codex 5×)" where the app, rightly, said 1.00 M with the
    footfall "other CMDR"). The same as the unsold value (organicValue.ts).
  */
  const payEstimate = baseCredits != null ? Math.round(baseCredits * ff) : null;

  let finalCredits: number | null = null;
  let analyseWasLogged: boolean | null = null;
  if (t.phase === "celebrate") {
    analyseWasLogged = t.analyseWasLogged === true;
    finalCredits = payEstimate;
  }

  const celebrationRemainSec =
    t.phase === "celebrate" ? Math.max(0, Math.ceil((t.celebrationUntil - Date.now()) / 1000)) : 0;

  const runStartedMs =
    typeof store.organicRunStartedAtMs === "function"
      ? store.organicRunStartedAtMs(t.bodyKey, t.speciesKey)
      : undefined;

  return {
    visible: true,
    phase: t.phase,
    celebrationRemainSec,
    runStartedIso:
      runStartedMs != null && Number.isFinite(runStartedMs) ? new Date(runStartedMs).toISOString() : null,
    speciesDisplay: label,
    minSampleDistanceM: minG,
    distToFirstM: distFirstM != null ? Math.round(distFirstM) : null,
    distToSecondM: distSecondM != null ? Math.round(distSecondM) : null,
    distToThirdM: distThirdM != null ? Math.round(distThirdM) : null,
    spacingBetweenSamplesM: spacingBetweenSamplesM != null ? Math.round(spacingBetweenSamplesM) : null,
    spacingMeetsMin,
    separationForSecondSampleM:
      separationForSecondSampleM != null ? Math.round(separationForSecondSampleM) : null,
    separationMeetsMin,
    baseCredits,
    payEstimate,
    finalCredits,
    analyseWasLogged,
    footfallMult: ff,
    sampleCount: effectiveSampleCount(t),
    trackingBodyKey: t.bodyKey,
    distToNearestSampleM,
    nearestSampleMeetsMin,
  };
}
