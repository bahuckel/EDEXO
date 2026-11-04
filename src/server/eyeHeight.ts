/**
 * How far above Status.json's altitude the commander's eye sits, per ship (owner, 2026-11-04: the on-screen marker
 * stayed "very inaccurate" with the pitch read off the HUD). The plants' places were right (three pairs of heading
 * lines met within 3 m), the drawing was not: angles were taken from the reported altitude, and the cockpit eye of his
 * Mandalay sat 12-15 m above it, about 10 deg at 70 m.
 *
 * Learned, not guessed: every plant two scans placed is a known point, and each of its scans made with the HUD's pitch
 * says how high the eye must have been to look down at it at that angle (eye = distance x tan(pitch down) - altitude).
 * The median of the ship's last samples is used by the screen marker and by a single scan placed straight ahead.
 * Kept per ship type in the commander's folder; 0 until a ship has samples (the old behaviour).
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "./atomicWrite.js";
import { resolveCommanderDataDir } from "./paths.js";
import { toLocal, type CompScan } from "../shared/scanLocate.js";

/** Samples kept per ship (the newest). */
const KEEP = 30;
/**
 * The height is the median of the newest this many: the reader keeps improving, and the first samples (pitches read
 * before the ladder's fraction worked, 4-6 m) held his Mandalay at 13 m while the newer ones say 15 (owner,
 * 2026-11-04: "its still a bit high").
 */
const USE = 12;
/** A sample needs a real look down and a plant at a sensible range. */
const MIN_DOWN_DEG = 3;
const MIN_DIST_M = 15;
const MAX_DIST_M = 600;

interface EyeFile {
  version: 1;
  /** Ship type (the journal's `Ship`, lower case) → samples: scan time and metres above the reported altitude. */
  ships: Record<string, { at: string; m: number }[]>;
  /**
   * The ship last flown: the app started mid-session has seen no Loadout yet (the journal cache restores the rest), and
   * without it the eye stayed 0 m (owner, 2026-11-04: the dot sat 8 deg above the plant).
   */
  lastShip?: string;
}

let ship: string | null = null;
let cache: { file: string; data: EyeFile } | null = null;

const filePath = () => path.join(resolveCommanderDataDir(), "edexo-eye-height.json");

function load(): EyeFile {
  const f = filePath();
  if (cache?.file === f) return cache.data;
  let data: EyeFile = { version: 1, ships: {} };
  try {
    if (existsSync(f)) {
      const j = JSON.parse(readFileSync(f, "utf8")) as Partial<EyeFile>;
      if (j && typeof j.ships === "object" && j.ships)
        data = { version: 1, ships: j.ships, ...(typeof j.lastShip === "string" ? { lastShip: j.lastShip } : {}) };
    }
  } catch {
    /* a damaged file starts again */
  }
  cache = { file: f, data };
  return data;
}

function save(data: EyeFile): void {
  try {
    const f = filePath();
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileAtomic(f, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  } catch {
    /* not kept this time; learned again from the next plant */
  }
}

/** The ship flown, from the lines that name it (Loadout, LoadGame, ShipyardSwap). */
export function noteShipLine(line: { event?: unknown; Ship?: unknown; ShipType?: unknown }): void {
  if (line.event !== "Loadout" && line.event !== "LoadGame" && line.event !== "ShipyardSwap") return;
  const s = typeof line.Ship === "string" ? line.Ship : typeof line.ShipType === "string" ? line.ShipType : null;
  if (!s || !s.trim()) return;
  ship = s.trim().toLowerCase();
  const data = load();
  if (data.lastShip !== ship) {
    data.lastShip = ship;
    save(data);
  }
}

/**
 * The ship flown: the last line naming one, else the one remembered from the last run, else the ship sampled last. A
 * start from the journal cache replays no Loadout, so a file from before lastShip existed stayed at 0 m (owner,
 * 2026-11-04: the hexagon still sat 8 deg above the plant).
 */
function currentShip(): string | null {
  if (ship) return ship;
  const data = load();
  if (data.lastShip) return data.lastShip;
  let best: string | null = null;
  let bestAt = "";
  for (const [name, list] of Object.entries(data.ships)) {
    const at = list.at(-1)?.at ?? "";
    if (at > bestAt) [best, bestAt] = [name, at];
  }
  return best;
}

/** The eye's height above the reported altitude for the ship flown, metres (0 until it has samples). */
export function eyeAboveM(): number {
  const cur = currentShip();
  const s = cur ? load().ships[cur] : undefined;
  if (!s?.length) return 0;
  const sorted = s
    .slice(-USE)
    .map((x) => x.m)
    .sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/** Learn from a plant two scans placed: each of its HUD-pitch scans gives one sample. */
export function learnEyeHeight(plant: { latDeg: number; lonDeg: number }, scans: readonly CompScan[], radiusM: number): void {
  const cur = currentShip();
  if (!cur || !(radiusM > 0)) return;
  const data = load();
  const list = (data.ships[cur] ??= []);
  let added = false;
  for (const s of scans) {
    if (!s.pitchFromHud || s.pitchDeg == null || s.altitudeM == null) continue;
    const down = -s.pitchDeg;
    if (down < MIN_DOWN_DEG || down >= 89) continue;
    const p = toLocal(s, plant, radiusM);
    const dist = Math.hypot(p.e, p.n);
    if (dist < MIN_DIST_M || dist > MAX_DIST_M) continue;
    if (list.some((x) => x.at === s.atIso)) continue;
    const m = dist * Math.tan((down * Math.PI) / 180) - s.altitudeM;
    // A sample past this is a scan whose pitch was stale or a plant misplaced, not a cockpit.
    if (m < -10 || m > 40) continue;
    list.push({ at: s.atIso, m: Math.round(m * 10) / 10 });
    added = true;
  }
  if (!added) return;
  data.ships[cur] = list.slice(-KEEP);
  save(data);
}

/** For the tests: forget the ship and the file read. */
export function resetEyeHeightForTests(): void {
  ship = null;
  cache = null;
}
