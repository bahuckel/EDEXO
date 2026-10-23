import { TtlCache } from "../../shared/colonize/ttlCache";
import path from "node:path";
import { galaxyDistanceLy3d } from "../../shared/colonize/galaxyDistanceCompute";
import { galaxyDistancePairKey, isKnownLy } from "../../shared/colonize/systemDistanceLy";
import { normSystemName } from "../../shared/colonize/stationFilter";
import { mapPool } from "../../shared/colonize/mapPool";
import { edsmGate, fetchJson, spanshGate } from "./httpGate";
import { readJson, writeJsonAtomic } from "./jsonFs";

const EDSM_SYSTEMS = "https://www.edsm.net/api-v1/systems";
const SPANSH_SEARCH = "https://www.spansh.co.uk/api/search?q=";
const SPANSH_SYSTEM_TYPEAHEAD = "https://spansh.co.uk/api/systems/field_values/system_names";
const FETCH_TIMEOUT_MS = 22_000;
const SPANSH_NAME_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SPANSH_NAME_CACHE_MAX = 400;

/**
 * PERF-M4. The coordinate cache used to live in memory only, so every launch paid for every
 * seller system again: a Spansh typeahead plus a gated EDSM call, one system at a time — two to
 * three minutes for a 400-system checkout.
 *
 * Now: found coordinates are written to `userData/system-coords.json` and kept for good (a star
 * does not move), misses are retried after ten minutes and never persisted, and whatever is not
 * cached goes to EDSM fifty names per request. Spansh is asked, one name at a time, only for what
 * EDSM does not know. The typeahead is gone from this path: both EDSM and Spansh search match
 * names case-insensitively (checked against the live APIs), and case was all it ever fixed.
 */
const COORDS_FILENAME = "system-coords.json";
const COORDS_FILE_VERSION = 1;
const COORD_CACHE_MAX = 20_000;
const COORD_MISS_TTL_MS = 10 * 60 * 1000;
const COORD_MISS_MAX = 2_000;
const COORDS_SAVE_DEBOUNCE_MS = 2_000;
/** Names per EDSM request; ~2 KB of query string. */
const EDSM_COORDS_BATCH = 50;
const SPANSH_COORDS_CONCURRENCY = 2;

type Coords = [number, number, number];

/**
 * `names`: Spansh's spelling of a system, by normalised name (1.3.0; optional, so an older EDEXO still reads the file).
 * A spelling never changes, so once Spansh or EDSM told it, a restart does not ask again.
 */
type CoordsFile = { v: number; systems: Record<string, unknown>; names?: Record<string, unknown> };

/** Found coordinates never expire; reading one keeps it from being the next evicted. */
const coordCache = new TtlCache<string, Coords>({ max: COORD_CACHE_MAX, touchOnGet: true });
const coordMisses = new TtlCache<string, true>({ max: COORD_MISS_MAX, ttlMs: COORD_MISS_TTL_MS });
/** Look-ups in progress, so concurrent depot plans asking for one system share the request. */
const coordInflight = new Map<string, Promise<Coords | null>>();
const spanshNameCache = new TtlCache<string, string>({
  max: SPANSH_NAME_CACHE_MAX,
  ttlMs: SPANSH_NAME_CACHE_TTL_MS,
});
/** Spellings Spansh or EDSM actually gave (a failed look-up's literal fallback is not one), kept with the coordinates. */
const knownSpelling = new TtlCache<string, string>({ max: COORD_CACHE_MAX, touchOnGet: true });

/**
 * EDEXO's own data, asked before EDSM and Spansh (1.3.0, localGalaxy.ts): the journal's star positions and the
 * stations index. Set by the Colonize service while it runs; null in tests and before it starts.
 */
let localCoords: ((name: string) => Coords | null) | null = null;
export function setLocalSystemCoords(fn: ((name: string) => Coords | null) | null): void {
  localCoords = fn;
}

/** How many systems the last look-ups placed from EDEXO's data and how many needed the network (tests, probes). */
export const coordLookupCounts = { local: 0, network: 0 };

let coordsFilePath: string | null = null;
let coordsLoad: Promise<void> | null = null;
let coordsDirty = false;
let coordsSaveTimer: ReturnType<typeof setTimeout> | null = null;
let coordsSaveQueue: Promise<void> = Promise.resolve();

function isCoords(v: unknown): v is Coords {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}

/**
 * Point the cache at its file and read what an earlier session found. Look-ups wait for the
 * read, so a checkout started during startup does not fetch what is already on disk.
 */
export function loadSystemCoordsCache(userDataDir: string): Promise<void> {
  coordsFilePath = path.join(userDataDir, COORDS_FILENAME);
  const file = coordsFilePath;
  coordsLoad = readJson<CoordsFile | null>(file, null).then((raw) => {
    if (!raw || raw.v !== COORDS_FILE_VERSION || !raw.systems || typeof raw.systems !== "object") return;
    for (const [norm, coords] of Object.entries(raw.systems)) {
      /** Anything found since launch is newer than the file; never overwrite it. */
      if (isCoords(coords) && norm && !coordCache.has(norm)) coordCache.set(norm, coords);
    }
    if (raw.names && typeof raw.names === "object") {
      for (const [norm, name] of Object.entries(raw.names)) {
        if (norm && typeof name === "string" && name.trim() && !knownSpelling.has(norm)) knownSpelling.set(norm, name);
      }
    }
  });
  return coordsLoad;
}

/** Write pending coordinates now; called on quit so the last two seconds are not lost. */
export async function flushSystemCoordsCache(): Promise<void> {
  if (coordsSaveTimer) {
    clearTimeout(coordsSaveTimer);
    coordsSaveTimer = null;
  }
  startCoordsSave();
  await coordsSaveQueue;
}

function startCoordsSave(): void {
  if (!coordsDirty || !coordsFilePath) return;
  coordsDirty = false;
  const file = coordsFilePath;
  const payload: CoordsFile = { v: COORDS_FILE_VERSION, systems: Object.fromEntries(coordCache.entries()) };
  if (knownSpelling.size) payload.names = Object.fromEntries(knownSpelling.entries());
  coordsSaveQueue = coordsSaveQueue
    .then(() => writeJsonAtomic(file, payload, false))
    .catch((e) => console.error("[edexo-colonize] system-coords save failed:", e));
}

function scheduleCoordsSave(): void {
  coordsDirty = true;
  if (coordsSaveTimer || !coordsFilePath) return;
  coordsSaveTimer = setTimeout(() => {
    coordsSaveTimer = null;
    startCoordsSave();
  }, COORDS_SAVE_DEBOUNCE_MS);
}

function rememberCoords(norm: string, coords: Coords): void {
  coordCache.set(norm, coords);
  coordMisses.delete(norm);
  scheduleCoordsSave();
}

/**
 * Coordinates and spelling that came with another answer: a Spansh station-search row carries its system's x/y/z and
 * Spansh's own spelling. Kept like a look-up's, so that system is never asked for again (owner, 2026-10-22: "a system
 * found once should be remembered").
 */
export function rememberSystemFromSpansh(name: string, coords: unknown): void {
  const label = name.trim();
  const norm = normSystemName(label);
  if (!norm) return;
  let changed = false;
  if (knownSpelling.getStale(norm) !== label) {
    knownSpelling.set(norm, label);
    changed = true;
  }
  if (isCoords(coords) && !coordCache.has(norm)) {
    coordCache.set(norm, coords);
    coordMisses.delete(norm);
    changed = true;
  }
  if (changed) scheduleCoordsSave();
}

/** Coordinates already known (this session or saved): never a network call, never the stations index. The HUD's. */
export function peekSystemCoords(name: string): Coords | null {
  return coordCache.get(normSystemName(name.trim())) ?? null;
}

function rememberMiss(norm: string): void {
  coordMisses.set(norm, true);
}

/** Coordinates, `null` for a recent miss, `undefined` when it has to be looked up. */
function cachedCoords(norm: string): Coords | null | undefined {
  const hit = coordCache.get(norm);
  if (hit) return hit;
  return coordMisses.has(norm) ? null : undefined;
}

function parseCoordsFromRecord(rec: Record<string, unknown>): Coords | null {
  const boxed = rec.coords;
  if (boxed && typeof boxed === "object") {
    const c = boxed as Record<string, unknown>;
    const x = typeof c.x === "number" ? c.x : Number.NaN;
    const y = typeof c.y === "number" ? c.y : Number.NaN;
    const z = typeof c.z === "number" ? c.z : Number.NaN;
    if ([x, y, z].every((n) => Number.isFinite(n))) return [x, y, z];
  }
  const x =
    typeof rec.x === "number" ? rec.x : typeof rec.system_x === "number" ? rec.system_x : Number.NaN;
  const y =
    typeof rec.y === "number" ? rec.y : typeof rec.system_y === "number" ? rec.system_y : Number.NaN;
  const z =
    typeof rec.z === "number" ? rec.z : typeof rec.system_z === "number" ? rec.system_z : Number.NaN;
  if (![x, y, z].every((n) => Number.isFinite(n))) return null;
  return [x, y, z];
}

/** Every EDSM request goes through the one gate: serial, spaced, and retried when throttled. */
export function fetchEdsmJson(url: string): Promise<unknown> {
  return fetchJson(edsmGate, url, { timeoutMs: FETCH_TIMEOUT_MS });
}

function fetchSpanshJson(url: string): Promise<unknown> {
  return fetchJson(spanshGate, url, { timeoutMs: FETCH_TIMEOUT_MS });
}

type SpanshTypeaheadRow = { id64?: number | string; name?: string };

function spanshNameFromTypeahead(body: unknown, norm: string): string | null {
  if (!body || typeof body !== "object") return null;
  const rec = body as { min_max?: unknown; values?: unknown };
  const minMax = Array.isArray(rec.min_max) ? rec.min_max : [];
  for (const row of minMax) {
    if (!row || typeof row !== "object") continue;
    const r = row as SpanshTypeaheadRow;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    if (name && normSystemName(name) === norm) return name;
  }
  const values = Array.isArray(rec.values) ? rec.values : [];
  for (const v of values) {
    const name = typeof v === "string" ? v.trim() : "";
    if (!name || normSystemName(name) !== norm) continue;
    const hit = minMax.find(
      (row) =>
        row &&
        typeof row === "object" &&
        normSystemName(String((row as SpanshTypeaheadRow).name ?? "")) === norm,
    ) as SpanshTypeaheadRow | undefined;
    if (hit?.name) return hit.name.trim();
    return name;
  }
  return null;
}

/**
 * Spansh `reference_system` is case-sensitive (`b5-4` ≠ `B5-4`). Journal/EDSM often use wrong casing.
 * Spansh typeahead is authoritative for the spelling their API accepts.
 */
/** Cached / literal ref only — no network (instant checkout from buy index). */
export function resolveSpanshReferenceSystemLocal(systemName: string): string {
  const q = systemName.trim();
  if (!q) return "";
  /** A stale spelling is still the right spelling; this path never goes to the network. */
  const norm = normSystemName(q);
  return knownSpelling.get(norm) ?? spanshNameCache.getStale(norm) ?? q;
}

export async function resolveSpanshReferenceSystem(systemName: string): Promise<string> {
  const q = systemName.trim();
  if (!q) return "";
  if (coordsLoad) await coordsLoad.catch(() => undefined);
  const norm = normSystemName(q);
  const known = knownSpelling.get(norm);
  if (known !== undefined) return known;
  const cached = spanshNameCache.get(norm);
  if (cached !== undefined) return cached;

  let resolved: string | null = null;

  try {
    const payload = await fetchSpanshJson(`${SPANSH_SYSTEM_TYPEAHEAD}?q=${encodeURIComponent(q)}`);
    resolved = spanshNameFromTypeahead(payload, norm);
  } catch {
    /* typeahead optional */
  }

  if (!resolved) {
    try {
      const payload = await fetchEdsmJson(`${EDSM_SYSTEMS}?systemName=${encodeURIComponent(q)}`);
      if (Array.isArray(payload)) {
        for (const row of payload) {
          if (!row || typeof row !== "object") continue;
          const rawName = (row as Record<string, unknown>).name;
          const name = typeof rawName === "string" ? rawName : "";
          if (name && normSystemName(name) === norm) {
            resolved = name.trim();
            break;
          }
        }
      }
    } catch {
      /* EDSM optional */
    }
  }

  const out = resolved || q;
  spanshNameCache.set(norm, out);
  if (resolved) {
    knownSpelling.set(norm, resolved);
    scheduleCoordsSave();
  }
  return out;
}

/** EDSM `/api-v1/systems` rows → coordinates by normalised name. Unknown names are simply absent. */
export function edsmCoordsByNorm(payload: unknown): Map<string, Coords> {
  const out = new Map<string, Coords>();
  if (!Array.isArray(payload)) return out;
  for (const row of payload) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const name = typeof rec.name === "string" ? normSystemName(rec.name) : "";
    const coords = parseCoordsFromRecord(rec);
    if (name && coords) out.set(name, coords);
  }
  return out;
}

/** Up to `EDSM_COORDS_BATCH` systems in one request. */
async function fetchEdsmCoordsBatch(labels: string[]): Promise<Map<string, Coords>> {
  const names = labels.map((l) => `systemName%5B%5D=${encodeURIComponent(l)}`).join("&");
  return edsmCoordsByNorm(await fetchEdsmJson(`${EDSM_SYSTEMS}?${names}&showCoordinates=1`));
}

/** Fallback when EDSM has no row yet. */
async function fetchSpanshSystemCoords(systemName: string): Promise<Coords | null> {
  const q = systemName.trim();
  const norm = normSystemName(q);
  if (!norm) return null;
  let payload: unknown;
  try {
    payload = await fetchSpanshJson(`${SPANSH_SEARCH}${encodeURIComponent(q)}`);
  } catch {
    return null;
  }
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return null;
  for (const row of results) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (r.type !== "system") continue;
    const rec = r.record;
    if (!rec || typeof rec !== "object") continue;
    const record = rec as Record<string, unknown>;
    const coords = parseCoordsFromRecord(record);
    if (!coords) continue;
    const name = typeof record.name === "string" ? record.name : "";
    if (normSystemName(name) === norm) return coords;
  }
  return null;
}

/** EDSM in batches, then Spansh one by one for whatever EDSM did not know. */
async function lookUpCoords(entries: Array<[string, string]>): Promise<Map<string, Coords>> {
  const found = new Map<string, Coords>();
  for (let i = 0; i < entries.length; i += EDSM_COORDS_BATCH) {
    const chunk = entries.slice(i, i + EDSM_COORDS_BATCH);
    try {
      const byNorm = await fetchEdsmCoordsBatch(chunk.map(([, label]) => label));
      for (const [norm] of chunk) {
        const c = byNorm.get(norm);
        if (c) found.set(norm, c);
      }
    } catch {
      /* EDSM unavailable: Spansh below covers the whole chunk */
    }
  }
  const rest = entries.filter(([norm]) => !found.has(norm));
  await mapPool(rest, SPANSH_COORDS_CONCURRENCY, async ([norm, label]) => {
    const c = await fetchSpanshSystemCoords(label);
    if (c) found.set(norm, c);
  });
  return found;
}

/** Fetch x/y/z for every unique system name. Cached names cost nothing; the rest are batched. */
export async function resolveCoordMapForSystems(names: string[]): Promise<Map<string, Coords>> {
  if (coordsLoad) await coordsLoad.catch(() => undefined);

  const labelByNorm = new Map<string, string>();
  for (const raw of names) {
    const label = raw.trim();
    if (!label) continue;
    const norm = normSystemName(label);
    if (!norm || labelByNorm.has(norm)) continue;
    labelByNorm.set(norm, label);
  }

  const out = new Map<string, Coords>();
  const shared: Array<Promise<void>> = [];
  let mine: Array<[string, string]> = [];
  for (const [norm, label] of labelByNorm) {
    const cached = cachedCoords(norm);
    if (cached !== undefined) {
      if (cached) out.set(norm, cached);
      continue;
    }
    const pending = coordInflight.get(norm);
    if (pending) {
      shared.push(
        pending.then((c) => {
          if (c) out.set(norm, c);
        }),
      );
      continue;
    }
    mine.push([norm, label]);
  }

  if (mine.length && localCoords) {
    const ask = localCoords;
    mine = mine.filter(([norm, label]) => {
      let c: Coords | null = null;
      try {
        c = ask(label);
      } catch {
        /* the local data could not be read: the network answers */
      }
      if (!c || !isCoords(c)) return true;
      rememberCoords(norm, c);
      out.set(norm, c);
      coordLookupCounts.local++;
      return false;
    });
  }

  if (mine.length) {
    coordLookupCounts.network += mine.length;
    const settle = new Map<string, (c: Coords | null) => void>();
    for (const [norm] of mine) {
      coordInflight.set(norm, new Promise<Coords | null>((resolve) => settle.set(norm, resolve)));
    }
    let found = new Map<string, Coords>();
    try {
      found = await lookUpCoords(mine);
      for (const [norm] of mine) {
        const c = found.get(norm);
        if (c) {
          rememberCoords(norm, c);
          out.set(norm, c);
        } else {
          rememberMiss(norm);
        }
      }
    } finally {
      for (const [norm] of mine) {
        coordInflight.delete(norm);
        settle.get(norm)!(found.get(norm) ?? null);
      }
    }
  }

  await Promise.all(shared);
  return out;
}

/** Minimum 3D ly from any construction ref to the target system. */
export async function resolveMinDistanceLy(fromSystems: string[], toSystem: string): Promise<number | null> {
  const refs = fromSystems.map((s) => s.trim()).filter(Boolean);
  if (!refs.length) return null;
  const coords = await resolveCoordMapForSystems([...refs, toSystem]);
  let best: number | null = null;
  for (const from of refs) {
    const d = galaxyDistanceLy3d(from, toSystem, coords);
    if (d == null) continue;
    if (best == null || d < best) best = d;
  }
  return best;
}

const DISTANCE_RESOLVE_TARGET_CAP = 400;

/**
 * Map pair keys → 3D straight-line Ly from each construction site to each seller.
 * Coords are fetched once per system, then all hops are pure geometry.
 */
export async function resolveSystemDistanceMap(
  fromSystems: string[],
  toSystems: string[],
): Promise<Record<string, number>> {
  const refs = [...new Set(fromSystems.map((s) => s.trim()).filter(Boolean))];
  const targets = [...new Set(toSystems.map((s) => s.trim()).filter(Boolean))].slice(0, DISTANCE_RESOLVE_TARGET_CAP);
  const out: Record<string, number> = {};
  if (!refs.length || !targets.length) return out;

  const coords = await resolveCoordMapForSystems([...refs, ...targets]);
  for (const from of refs) {
    for (const to of targets) {
      const d = galaxyDistanceLy3d(from, to, coords);
      if (!isKnownLy(d)) continue;
      out[galaxyDistancePairKey(from, to)] = d!;
    }
  }
  return out;
}
