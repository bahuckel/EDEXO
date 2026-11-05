/**
 * The overlay radar's memory, on disk.
 *
 * ## Why this cannot live in the journal merge cache
 *
 * That cache is a *replay's result*: delete it and the logs rebuild it. This cannot be rebuilt from
 * anything. `ScanOrganic` carries no coordinates — 0 of 38 in the owner's recent journals — so a
 * plant's position exists only because this app happened to be running and read `Status.json` as
 * the scan landed. Lose this file and those positions are gone for good, which is a different
 * category of loss and deserves a different file.
 *
 * The ship is the exception and is kept here anyway: `Touchdown` does carry latitude and longitude,
 * so it survives on its own, but keeping the two together means the radar has one place to load
 * from rather than two.
 *
 * ## Kept per body, not per session
 *
 * The owner's rule: *"if I enter supercruise they get dropped until I go down on that planet
 * again"*. So nothing is deleted on leaving — the marks are filed under the body they belong to and
 * simply stop matching while he is somewhere else. Walk back onto the same rock and they are there.
 *
 * The cap is a guard against a file that grows for four years, not a policy about how many plants a
 * commander may record. Oldest goes first, which is the right end: the body you are standing on is
 * the one you visited most recently.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveSurfaceMarksPath } from "./paths.js";
import { writeFileAtomic } from "./atomicWrite.js";
import { clusterScans, locatePlant, type CompScan, type PlantLocated } from "../shared/scanLocate.js";

/** One recorded position on a surface. */
export interface SurfaceMark {
  /** `systemAddress:bodyId`. */
  bodyKey: string;
  /**
   * The body's name as `Status.json` writes it, normalised.
   *
   * Carried beside the key because `Status.json` names the body but never gives its id, so this is
   * the only field that can answer "am I standing on the rock these marks belong to" from a live
   * fix alone.
   */
  bodyNameNorm: string;
  latDeg: number;
  lonDeg: number;
  label: string;
  /** When it was recorded, so the cap evicts the oldest rather than an arbitrary one. */
  atIso: string;
  /**
   * Conditions at the plant, from `Status.json` at the moment of the scan.
   *
   * Optional because every mark written before this existed has neither, and because the game does
   * not always report them. They are stored here rather than derived later for the same reason the
   * position is: `Status.json` keeps no history, so a value not captured at the scan is gone.
   */
  temperatureK?: number | null;
  /** Earth g at the plant, not the body's average. */
  gravityG?: number | null;
  /**
   * Metres above the body's reference radius, derived from {@link gravityG} at the moment of the
   * scan. Stored rather than derived on read so the file stands on its own as a record.
   */
  elevationM?: number | null;
  /** A composition-scan mark's codex entry (`CodexEntry.Name`, the variant), so a sample of it can retire it. */
  codexName?: string;
  /**
   * A composition-scan mark's scans (owner, 2026-11-04): where the scanner was and how it was pointed, each one. The
   * mark's own latitude / longitude is where they put the plant (shared/scanLocate.ts): two crossing heading lines,
   * straight ahead of one, or where it was scanned from. Marks written before this have none (scanned from there).
   */
  scans?: CompScan[];
  /** How the mark's position was found, from {@link scans}. */
  located?: PlantLocated;
  /** "scanned-from": the scan's heading, for the radar's tick. */
  headingDeg?: number;
  /** The body's radius, metres, kept so the scans can be grouped into plants again when the file is read. */
  radiusM?: number;
  /** When the commander cleared it off the radar (the {@link SurfaceMarksFile.cleared} list only). */
  clearedAtIso?: string;
}

export interface SurfaceMarksFile {
  formatVersion: 1;
  samples: SurfaceMark[];
  ship: SurfaceMark | null;
  /**
   * Where the ship's composition scanner named a plant (`CodexEntry` carries Latitude / Longitude and BodyID;
   * survey 2026-11-02 after EDMC-BioScan / ExplorerLite / SrvSurvey): a waypoint until that species is logged there.
   * Optional: files written before it have none.
   */
  codex?: SurfaceMark[];
  /**
   * Where the commander stepped out of the SRV (plan 1.3.6 S-2, owner 2026-11-02: "SRV mark - yes"): `Disembark` with
   * `SRV: true` has no position, so it is `Status.json`'s at that moment. Optional: older files have none.
   */
  srv?: SurfaceMark | null;
  /**
   * Marks the commander cleared off a planet with the key bind (owner, 2026-11-04: "keep in memory file but just remove
   * them from the screen and the calculations"): kept here, read by nothing. Optional: older files have none.
   */
  cleared?: SurfaceMark[];
}

/** Bodies' worth of plants before the oldest are dropped. Generous; this file is tiny. */
export const MAX_SURFACE_MARKS = 400;

/** Scans kept per composition-scan mark (the newest). */
const MAX_SCANS = 6;

/** A mark's scans; a mark from before the scans were kept has its position as one scan, no heading. */
const scansOf = (m: SurfaceMark): CompScan[] =>
  m.scans ?? [{ latDeg: m.latDeg, lonDeg: m.lonDeg, headingDeg: null, altitudeM: null, pitchDeg: null, atIso: m.atIso }];

/** One mark per plant for one species on one body, from all its scans (shared/scanLocate.ts clusterScans). */
function plantMarks(template: Omit<SurfaceMark, "latDeg" | "lonDeg">, scans: CompScan[], radiusM: number): SurfaceMark[] {
  return clusterScans(scans, radiusM).map((group) => {
    const kept = group.slice(-MAX_SCANS);
    const at = locatePlant(kept, radiusM)!;
    const m: SurfaceMark = {
      ...template,
      latDeg: at.latDeg,
      lonDeg: at.lonDeg,
      atIso: kept[0]!.atIso,
      scans: kept,
      located: at.how,
      ...(radiusM > 0 ? { radiusM } : {}),
    };
    if (at.headingDeg != null) m.headingDeg = at.headingDeg;
    else delete m.headingDeg;
    return m;
  });
}

/**
 * The composition-scan waypoints with one more scan: the scans of that species on that body are grouped into plants
 * again (owner, 2026-11-04: two plants scanned twice each must be two dots, not one between them), one mark each,
 * placed by its own scans (two heading lines cross where it stands). `radiusM` is the body's.
 */
export function withCodexScan(
  list: SurfaceMark[],
  mark: Omit<SurfaceMark, "latDeg" | "lonDeg"> & { codexName: string },
  scan: CompScan,
  radiusM: number,
): SurfaceMark[] {
  if (!Number.isFinite(scan.latDeg) || !Number.isFinite(scan.lonDeg)) return list;
  const same = (m: SurfaceMark) => m.bodyKey === mark.bodyKey && m.codexName === mark.codexName;
  const group = list.filter(same);
  // A first scan stored without the body's name takes it from a later one (review 2026-11-05: in flight the radar
  // matches marks by name, so the plant never showed until he landed).
  const template = group[0] ? { ...group[0], bodyNameNorm: group[0].bodyNameNorm || mark.bodyNameNorm } : mark;
  const next = plantMarks(template, [...group.flatMap(scansOf), scan], radiusM);
  const at = list.findIndex(same);
  const rest = list.filter((m) => !same(m));
  const out = at < 0 ? [...rest, ...next] : [...rest.slice(0, at), ...next, ...rest.slice(at)];
  return out.slice(-MAX_SURFACE_MARKS);
}

/** The waypoints with each species' scans on each body grouped into plants again (the file read; radius kept). */
export function regroupCodexMarks(list: SurfaceMark[]): SurfaceMark[] {
  const out: SurfaceMark[] = [];
  const done = new Set<string>();
  for (const m of list) {
    const key = `${m.bodyKey}\u0000${m.codexName ?? ""}`;
    if (done.has(key)) continue;
    done.add(key);
    const group = list.filter((x) => x.bodyKey === m.bodyKey && x.codexName === m.codexName);
    const r = group.find((x) => x.radiusM && x.radiusM > 0)?.radiusM;
    out.push(...(r && m.codexName ? plantMarks(m, group.flatMap(scansOf), r) : group));
  }
  return out;
}

/** Without the waypoints of these codex entries on this body; the same list when none goes. */
export function withoutCodexMarks(
  list: SurfaceMark[],
  bodyKey: string,
  codexNames: readonly string[],
  /** Only the ones within `withinM` of this spot (the plant just sampled), not every one of that species on the body. */
  near?: { latDeg: number; lonDeg: number; radiusM: number; withinM: number },
): SurfaceMark[] {
  const names = new Set(codexNames.map((n) => n.toLowerCase()));
  const close = (m: SurfaceMark) =>
    !near || greatCircleM(near.latDeg, near.lonDeg, m.latDeg, m.lonDeg, near.radiusM) <= near.withinM;
  const keep = list.filter((m) => !(m.bodyKey === bodyKey && names.has((m.codexName ?? "").toLowerCase()) && close(m)));
  return keep.length === list.length ? list : keep;
}

export function emptySurfaceMarks(): SurfaceMarksFile {
  return { formatVersion: 1, samples: [], ship: null, codex: [], srv: null };
}

function isMark(v: unknown): v is SurfaceMark {
  const m = v as SurfaceMark | null;
  return (
    !!m &&
    typeof m.bodyKey === "string" &&
    typeof m.bodyNameNorm === "string" && // may be "" once repaired — see repairName
    typeof m.latDeg === "number" &&
    Number.isFinite(m.latDeg) &&
    typeof m.lonDeg === "number" &&
    Number.isFinite(m.lonDeg)
  );
}

/**
 * A name that is not a name.
 *
 * Marks written before the body name came from `Status.json` were filed under `"body 22"` — the
 * placeholder produced by a `ScanOrganic` line, which carries no `BodyName`. Nothing else in the
 * app calls a body that, so such a mark could never match the surface it was taken on and was
 * silently invisible on its own map.
 *
 * Clearing the field rather than dropping the mark is the repair: the radar already falls back to
 * the body *key* when a mark has no name, and the key was always right. The position survives,
 * which matters because nothing can recreate it.
 */
const PLACEHOLDER_BODY_NAME = /^body\s*\d+$/i;

function repairName<T extends { bodyNameNorm?: string }>(m: T): T {
  if (m && typeof m.bodyNameNorm === "string" && PLACEHOLDER_BODY_NAME.test(m.bodyNameNorm.trim())) {
    return { ...m, bodyNameNorm: "" };
  }
  return m;
}

/** Surface distance, metres (haversine; footTravelStatus has the same, this file stays free of it). */
function greatCircleM(lat1: number, lon1: number, lat2: number, lon2: number, r: number): number {
  const rad = Math.PI / 180;
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A mark's scans as the file has them, the malformed ones left out. */
function cleanScans(m: SurfaceMark): SurfaceMark {
  if (!Array.isArray(m.scans)) return m;
  const scans = (m.scans as unknown[]).flatMap((v): CompScan[] => {
    const s = v as Partial<CompScan> | null;
    if (!s || numOrNull(s.latDeg) == null || numOrNull(s.lonDeg) == null) return [];
    return [
      {
        latDeg: s.latDeg!,
        lonDeg: s.lonDeg!,
        headingDeg: numOrNull(s.headingDeg),
        altitudeM: numOrNull(s.altitudeM),
        pitchDeg: numOrNull(s.pitchDeg),
        atIso: typeof s.atIso === "string" ? s.atIso : m.atIso,
        ...(s.pitchFromHud === true ? { pitchFromHud: true } : {}),
        ...(numOrNull(s.eyeAboveM) != null ? { eyeAboveM: s.eyeAboveM! } : {}),
      },
    ];
  });
  return { ...m, scans };
}

/**
 * Read the file, or an empty set.
 *
 * A damaged file is treated as an empty one rather than as an error: the radar is an aid, and the
 * app refusing to start over a corrupt list of dots would be a far worse outcome than a commander
 * seeing an empty map and re-walking a plant.
 */
export function loadSurfaceMarks(): SurfaceMarksFile {
  const file = resolveSurfaceMarksPath();
  if (!existsSync(file)) return emptySurfaceMarks();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SurfaceMarksFile>;
    const samples = Array.isArray(parsed.samples) ? parsed.samples.map(repairName).filter(isMark) : [];
    const ship = isMark(parsed.ship) ? repairName(parsed.ship) : null;
    const codex = Array.isArray(parsed.codex) ? regroupCodexMarks(parsed.codex.filter(isMark).map(cleanScans)) : [];
    const srv = isMark(parsed.srv) ? parsed.srv : null;
    return { formatVersion: 1, samples, ship, codex, srv };
  } catch {
    return emptySurfaceMarks();
  }
}

/**
 * Write, but not on every call.
 *
 * A full journal rebuild applies every `Touchdown` in the commander's history — hundreds of them —
 * and a naive save wrote the file once per landing, each one immediately obsoleted by the next. The
 * only state worth writing is the one left standing when the replay stops, so the write is deferred
 * and coalesced.
 *
 * `unref` so a pending write can never hold the process open at shutdown; the app exiting a second
 * before a debounce fires costs a file that is rewritten on the next mark anyway.
 */
let pending: NodeJS.Timeout | null = null;
let pendingData: SurfaceMarksFile | null = null;
const SAVE_DEBOUNCE_MS = 400;

export function scheduleSaveSurfaceMarks(data: SurfaceMarksFile): void {
  pendingData = data;
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    const d = pendingData;
    pendingData = null;
    if (d) saveSurfaceMarks(d);
  }, SAVE_DEBOUNCE_MS);
  pending.unref?.();
}

/** Write a pending save now, at shutdown (code review 2026-10-10, A4). */
export function flushSurfaceMarks(): void {
  if (!pending) return;
  clearTimeout(pending);
  pending = null;
  const d = pendingData;
  pendingData = null;
  if (d) saveSurfaceMarks(d);
}

/**
 * The cleared marks, per file: read from it the first time, written back with every save. Nothing else reads them, so
 * they live here rather than in the store (the radar, the screen marker and every calculation never see them).
 */
const clearedByFile = new Map<string, SurfaceMark[]>();

function clearedIn(file: string): SurfaceMark[] {
  let list = clearedByFile.get(file);
  if (!list) {
    list = [];
    try {
      const parsed = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Partial<SurfaceMarksFile>) : null;
      if (Array.isArray(parsed?.cleared)) list = parsed.cleared.filter(isMark).map(cleanScans);
    } catch {
      /* a damaged file has none */
    }
    clearedByFile.set(file, list);
  }
  return list;
}

/** Keep marks the clear key took off a planet (exoOrganicTracker.ts pressClearMarksHere); written with the next save. */
export function keepClearedMarks(marks: readonly SurfaceMark[], atIso: string): void {
  const file = resolveSurfaceMarksPath();
  const next = [...clearedIn(file), ...marks.map((m) => ({ ...m, clearedAtIso: atIso }))];
  clearedByFile.set(file, next.slice(-2 * MAX_SURFACE_MARKS));
}

/** The cleared marks of the commander's file (tests, and anyone checking what the key took). */
export function clearedSurfaceMarks(): SurfaceMark[] {
  return clearedIn(resolveSurfaceMarksPath());
}

export function saveSurfaceMarks(data: SurfaceMarksFile): void {
  const file = resolveSurfaceMarksPath();
  try {
    const cleared = clearedIn(file);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, `${JSON.stringify(cleared.length ? { ...data, cleared } : data, null, 1)}\n`, "utf8");
  } catch {
    /* A radar that cannot remember is still a radar; never fail a journal tick over it. */
  }
}
