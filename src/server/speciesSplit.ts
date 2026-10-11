/**
 * Which species of a genus, from fitted tables, for the genera where they order better than the
 * ranking model (owner, 2026-10-10: "build point 2"; Fable's per-species formula, docs/species-formula-10102026.md).
 *
 * The formula's "which of the genus" level: for each species an additive log-odds table, one entry per
 * band of each fact of the body (planet class, atmosphere and every gas's share, temperature, gravity,
 * pressure, orbit, materials, host and main star, region, distance to the core, the nearest nebula and
 * Guardian site, signal count), softmaxed within the genus. Fitted on the EDDN year's complete-list
 * bodies before September 2026 (docs/perf/formula/fit_eval.py v5, exported by export_split.py).
 *
 * Used only for the seven genera where it put the true species first more often than the app on both
 * September hold-outs, the one the formula was chosen on and a fresh one (first-in-genus rows, app →
 * formula): Stratum 1,567 → 1,591, Clypeus 184 → 200, Concha 635 → 644, Electricae 88 → 94, Recepta
 * 39 → 44, Cactoida 431 → 434, Fungoida 1,103 → 1,106. Elsewhere (Tussock, Aleoida, Osseus, Tubus) the
 * codex windows order better and the app's split stays.
 *
 * Only the order inside a genus changes: the genus keeps its chance, the rows shown stay the ones shown,
 * and each shown row of the genus gets its share of the genus from the table.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ExplorationScanRecord, PlanetScan, SpeciesMatch } from "../shared/types.js";
import type { SpatialCatalogue } from "../shared/spatialGates.js";
import { regionForSystem } from "./regionMapData.js";

interface SpeciesTable {
  b?: number;
  w?: Record<string, number>;
  /** The fit's fallback for a species with fewer than 10 training bodies: its log share of the genus. */
  prior?: number;
  /** "class|atmosphere" pairs it was logged on in training; elsewhere it is ruled out (as in the fit). */
  support: string[];
}
interface SplitFile {
  formatVersion: number;
  log10: string[];
  categories: Record<string, string[]>;
  edges: Record<string, number[]>;
  genera: Record<string, Record<string, SpeciesTable>>;
}

let cache: { root: string; file: (SplitFile & { supportSets: Map<string, Set<string>> }) | null } | null = null;
function load(root: string) {
  if (cache?.root === root) return cache.file;
  let file: (SplitFile & { supportSets: Map<string, Set<string>> }) | null = null;
  try {
    const p = path.join(root, "data", "exomastery", "species-split.json");
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8")) as SplitFile;
      if (j?.formatVersion === 1 && j.genera) {
        const supportSets = new Map<string, Set<string>>();
        for (const g of Object.values(j.genera)) for (const [id, t] of Object.entries(g)) supportSets.set(id, new Set(t.support));
        file = { ...j, supportSets };
      }
    }
  } catch {
    file = null;
  }
  cache = { root, file };
  return file;
}

/** For tests: forget the loaded table. */
export function clearSpeciesSplitCache(): void {
  cache = null;
}

/** The genera the tables cover, by the codex genus name (`SpeciesEntry.genus`). */
export function speciesSplitGenera(root: string): string[] {
  return Object.keys(load(root)?.genera ?? {});
}

// ---- the facts, exactly as docs/perf/formula/features.py derives them ----

const STAR_FOLD: Record<string, string> = {
  TTS: "TTS", AeBe: "AeBe", DA: "D", DAB: "D", DAO: "D", DAZ: "D", DAV: "D", DB: "D", DBZ: "D", DBV: "D", DO: "D", DOV: "D",
  DQ: "D", DC: "D", DCV: "D", DX: "D", D: "D", WC: "W", WN: "W", WNC: "W", WO: "W", W: "W", CS: "C", CN: "C", CJ: "C",
  CH: "C", CHd: "C", C: "C", MS: "MS", S: "S", N: "N", H: "H", SupermassiveBlackHole: "H", X: "X", RoguePlanet: "X",
  Nebula: "X", StellarRemnantNebula: "X",
};
const MAIN_SEQUENCE = new Set(["O", "B", "A", "F", "G", "K", "M", "L", "T", "Y"]);
function starClass(t: string | undefined): string {
  if (!t) return "?";
  return STAR_FOLD[t] ?? (MAIN_SEQUENCE.has(t) ? t : "other");
}
function lumClass(l: string | undefined): string {
  if (!l) return "?";
  // The same alternation as the fit's Python, first match wins ("III" reads as "I"): the tables were
  // fitted on these values, so they are kept rather than corrected.
  const m = /^(I[ab]{0,2}|II|III|IV|V[ab]{0,2}|VI|VII)/.exec(l);
  return m ? m[1]!.replace(/[ab]+$/, "") : "other";
}
function atmoKey(t: string | undefined): string {
  const s = (t ?? "").trim();
  if (!s || s.toLowerCase() === "none" || s.toLowerCase() === "no atmosphere") return "none";
  return s.replace(/^(hot|thin|thick)\s+/i, "").trim().toLowerCase().replace(/ /g, "");
}
function atmoDensity(scan: PlanetScan): string {
  const a = String(scan.Atmosphere ?? "").toLowerCase();
  const t = String(scan.AtmosphereType ?? "");
  if (!t || t.toLowerCase() === "none") return "none";
  if (a.includes("thick")) return "thick";
  if (a.includes("thin")) return "thin";
  return "other";
}
function volcKind(v: string | undefined): string {
  const s = (v ?? "").toLowerCase();
  if (!s.trim() || s.includes("no volcanism")) return "none";
  for (const k of ["water", "nitrogen", "ammonia", "methane", "carbon dioxide", "silicate", "metallic", "rocky"]) if (s.includes(k)) return k;
  return "other";
}
function volcLevel(v: string | undefined): string {
  const s = (v ?? "").toLowerCase();
  if (!s.trim() || s.includes("no volcanism")) return "none";
  return s.includes("major") ? "major" : s.includes("minor") ? "minor" : "mid";
}
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
/** Python's `float(x or nan)`: zero and missing are both "not known". */
const orNaN = (v: unknown): number => {
  const n = num(v);
  return n ? n : NaN;
};
const GASES = ["carbondioxide", "sulphurdioxide", "oxygen", "nitrogen", "argon", "neon", "methane", "ammonia", "water", "helium", "hydrogen"];
const MATERIALS = ["iron", "sulphur", "carbon", "nickel", "phosphorus", "chromium", "germanium", "vanadium", "manganese", "zinc"];

export interface SplitStar {
  bodyId: number;
  starType?: string;
  luminosity?: string;
  subclass?: number;
  distanceFromArrivalLs?: number;
}

export interface SplitInputs {
  scan: PlanetScan;
  /**
   * The body's exploration record: the body state's scan keeps the matcher's fields only, and the
   * parents chain, the distance from arrival and the radius are on the record (2026-10-10: without
   * them every body read as host unknown, arrival unknown, and Clypeus lost 16 first picks).
   */
  rec?: ExplorationScanRecord | null;
  /** Every star of the system the app has a scan of. */
  stars: SplitStar[];
  coords: { x: number; y: number; z: number } | null;
  signals: number | null;
  catalogue: SpatialCatalogue | null;
  root: string;
}

/** The body's facts as the fit saw them: category values and raw numbers (before log and bands). */
export function splitFacts(i: SplitInputs): { cat: Record<string, string>; num: Record<string, number> } {
  const sc = i.scan as PlanetScan & Record<string, unknown>;
  const rec = i.rec ?? null;
  const stars = new Map(i.stars.map((s) => [s.bodyId, s]));
  const cat: Record<string, string> = {};
  const n: Record<string, number> = {};
  cat.cls = String(sc.PlanetClass ?? "?").toLowerCase() || "?";
  cat.atmo = atmoKey(sc.AtmosphereType);
  cat.dens = atmoDensity(sc);
  const comp = (sc.AtmosphereComposition ?? sc.atmosphereComposition) as { Name?: string; Percent?: number }[] | undefined;
  const gases = new Map((Array.isArray(comp) ? comp : []).map((c) => [String(c.Name ?? "").toLowerCase(), num(c.Percent) || 0]));
  for (const g of GASES) n[`gas_${g}`] = gases.get(g) ?? 0;
  cat.volc = volcKind(sc.Volcanism);
  cat.volclvl = volcLevel(sc.Volcanism);
  n.temp = orNaN(sc.SurfaceTemperature);
  const g = num(sc.SurfaceGravity);
  n.grav_g = g ? g / 9.80665 : NaN;
  const p = num(sc.SurfacePressure);
  n.press_atm = Number.isFinite(p) ? p / 101325 : NaN;
  n.mass = orNaN(sc.MassEM ?? rec?.massEM);
  n.radius_km = orNaN(num(sc.Radius ?? sc.radius ?? rec?.radius) / 1000);
  n.sma_ls = orNaN(num(sc.SemiMajorAxis ?? rec?.semiMajorAxis) / 299792458);
  n.dist_ls = orNaN(sc.DistanceFromArrivalLS ?? rec?.distanceFromArrivalLs);
  n.ecc = num(sc.Eccentricity) || 0;
  n.orb_d = orNaN(Math.abs(num(sc.OrbitalPeriod)) / 86400);
  n.rot_d = orNaN(Math.abs(num(sc.RotationPeriod)) / 86400);
  cat.tidal = sc.TidalLock ? "1" : "0";
  const composition = (sc.Composition ?? sc.composition) as Record<string, number> | undefined;
  n.c_ice = num(composition?.Ice) || 0;
  n.c_metal = num(composition?.Metal) || 0;
  n.c_rock = num(composition?.Rock) || 0;
  const matsRaw = (sc.Materials ?? sc.materials) as { Name?: string; Percent?: number }[] | undefined;
  const mats = new Map((Array.isArray(matsRaw) ? matsRaw : []).map((m) => [String(m.Name ?? "").toLowerCase(), num(m.Percent) || 0]));
  for (const m of MATERIALS) n[`mat_${m}`] = mats.get(m) ?? 0;
  const rawParents = Array.isArray(sc.Parents) ? sc.Parents : Array.isArray(rec?.parents) ? rec.parents : [];
  const parents = rawParents as Record<string, number>[];
  cat.parent = parents.length ? (Object.keys(parents[0]!)[0] ?? "none") : "none";
  let host: SplitStar | undefined;
  for (const pp of parents) {
    if ("Star" in pp) {
      host = stars.get(pp.Star!);
      break;
    }
  }
  cat.host = host ? starClass(host.starType) : "?";
  cat.hostlum = host ? lumClass(host.luminosity) : "?";
  cat.hostsub_c = String(host && host.subclass != null && Number.isFinite(host.subclass) ? Math.trunc(host.subclass) : -1);
  const main = i.stars.length
    ? [...i.stars].sort((a, b) => (a.distanceFromArrivalLs || 0) - (b.distanceFromArrivalLs || 0) || a.bodyId - b.bodyId)[0]
    : undefined;
  cat.main = main ? starClass(main.starType) : "?";
  cat.nstars_c = String(Math.min(i.stars.length, 4));
  const c = i.coords;
  if (c && Number.isFinite(c.x)) {
    const core = i.catalogue?.core ?? { x: 25.21875, y: -20.90625, z: 25899.96875 };
    n.core_ly = Math.hypot(c.x - core.x, c.y - core.y, c.z - core.z);
    n.y_abs = Math.abs(c.y);
    cat.region = regionForSystem(i.root, c.x, c.y, c.z) ?? "?";
    const nearest = (pts: { x: number; y: number; z: number }[] | undefined) =>
      pts?.length ? Math.min(...pts.map((q) => Math.hypot(q.x - c.x, q.y - c.y, q.z - c.z))) : NaN;
    n.neb_ly = nearest(i.catalogue?.nebulae);
    n.gua_ly = nearest(i.catalogue?.guardian);
  } else {
    n.core_ly = n.y_abs = n.neb_ly = n.gua_ly = NaN;
    cat.region = "?";
  }
  const bio = i.signals != null && Number.isFinite(i.signals) ? Math.trunc(i.signals) : 0;
  cat.bioc = String(Math.max(0, Math.min(bio, 5)));
  return { cat, num: n };
}

/** The table columns this body switches on: one per fact, as the fit's design matrix. */
export function splitColumns(root: string, facts: ReturnType<typeof splitFacts>): string[] | null {
  const f = load(root);
  if (!f) return null;
  const log = new Set(f.log10);
  const out: string[] = [];
  for (const [c, levels] of Object.entries(f.categories)) {
    const v = facts.cat[c] ?? "?";
    out.push(levels.includes(v) ? `${c}=${v}` : `${c}=other`);
  }
  for (const [c, edges] of Object.entries(f.edges)) {
    let v = facts.num[c];
    if (v === undefined) v = NaN;
    if (log.has(c) && Number.isFinite(v)) v = Math.log10(Math.max(v, 1e-9));
    if (!Number.isFinite(v)) {
      out.push(`${c}=nan`);
      continue;
    }
    // numpy searchsorted(side="right"): how many edges are <= v.
    let k = 0;
    while (k < edges.length && edges[k]! <= v) k++;
    out.push(`${c}[${k}]`);
  }
  return out;
}

/** The genus's species shares (0-1) for this body, every species of the genus in the table. */
export function genusSplit(root: string, genus: string, facts: ReturnType<typeof splitFacts>): Map<string, number> | null {
  const f = load(root);
  const g = f?.genera[genus];
  if (!f || !g) return null;
  const cols = splitColumns(root, facts)!;
  const pair = `${facts.cat.cls}|${facts.cat.atmo}`;
  const z = new Map<string, number>();
  for (const [id, t] of Object.entries(g)) {
    if (t.prior !== undefined) {
      z.set(id, t.prior);
      continue;
    }
    let s = t.b ?? 0;
    for (const c of cols) s += t.w?.[c] ?? 0;
    z.set(id, f.supportSets.get(id)?.has(pair) ? s : -50);
  }
  const top = Math.max(...z.values());
  let sum = 0;
  for (const [id, v] of z) {
    const e = Math.exp(v - top);
    z.set(id, e);
    sum += e;
  }
  for (const [id, v] of z) z.set(id, v / sum);
  return z;
}

/**
 * Re-split each covered genus's shown rows by the table, keeping the genus's total chance. A genus is
 * left alone when one of its shown rows is not in the table (a species the fit never saw).
 * Returns the genera it re-split.
 */
export function applySpeciesSplit(matches: SpeciesMatch[], inputs: SplitInputs): Set<string> {
  const done = new Set<string>();
  const f = load(inputs.root);
  if (!f) return done;
  let facts: ReturnType<typeof splitFacts> | null = null;
  const round = (x: number) => Math.round(x * 10) / 10;
  for (const genus of Object.keys(f.genera)) {
    const rows = matches.filter((m) => !m.unlikely && m.entry.genus.trim().toLowerCase() === genus.toLowerCase());
    if (rows.length < 2) continue;
    if (!rows.every((m) => f.genera[genus]![m.entry.id])) continue;
    facts ??= splitFacts(inputs);
    const shares = genusSplit(inputs.root, genus, facts)!;
    const sum = rows.reduce((a, m) => a + (shares.get(m.entry.id) ?? 0), 0);
    if (!(sum > 0)) continue;
    const total = rows.reduce((a, m) => a + (m.presenceProbabilityPercent ?? 0), 0);
    for (const m of rows) {
      const s = (shares.get(m.entry.id) ?? 0) / sum;
      m.genusSharePercent = round(s * 100);
      if (total > 0) m.presenceProbabilityPercent = round(total * s);
    }
    done.add(genus);
  }
  return done;
}

/** The stars of a system as the split reads them, from the app's exploration records. */
export function splitStarsFrom(byId: ReadonlyMap<number, ExplorationScanRecord>): SplitStar[] {
  const out: SplitStar[] = [];
  for (const r of byId.values()) {
    if (!r.starType?.trim()) continue;
    out.push({
      bodyId: r.bodyId,
      starType: r.starType,
      luminosity: r.luminosity,
      subclass: r.subclass,
      distanceFromArrivalLs: r.distanceFromArrivalLs,
    });
  }
  return out;
}

/**
 * For the candidate row's "why this chance" (plan 1.7): each species' table entries that this body
 * switches on, as column → weight. A species on its fallback share (too few bodies to fit) has none.
 */
export function splitContributions(
  root: string,
  genus: string,
  facts: ReturnType<typeof splitFacts>,
): Map<string, Map<string, number>> | null {
  const f = load(root);
  const g = f?.genera[genus];
  if (!f || !g) return null;
  const cols = splitColumns(root, facts)!;
  const out = new Map<string, Map<string, number>>();
  for (const [id, t] of Object.entries(g)) {
    const m = new Map<string, number>();
    if (t.w) for (const c of cols) if (t.w[c] !== undefined) m.set(c, t.w[c]!);
    out.set(id, m);
  }
  return out;
}

const NUM_LABELS: Record<string, [string, string, number]> = {
  // fact: [words, unit, digits]
  temp: ["temperature", "K", 0],
  grav_g: ["gravity", "g", 2],
  press_atm: ["pressure", "atm", 3],
  mass: ["mass", "EM", 3],
  radius_km: ["radius", "km", 0],
  sma_ls: ["orbit", "Ls", 1],
  dist_ls: ["distance from arrival", "Ls", 0],
  ecc: ["eccentricity", "", 2],
  orb_d: ["orbital period", "d", 1],
  rot_d: ["rotation", "d", 1],
  c_ice: ["ice", "", 2],
  c_metal: ["metal", "", 2],
  c_rock: ["rock", "", 2],
  core_ly: ["distance from the core", "ly", 0],
  y_abs: ["height off the galactic plane", "ly", 0],
  neb_ly: ["nearest nebula", "ly", 0],
  gua_ly: ["nearest Guardian site", "ly", 0],
};
const CAT_LABELS: Record<string, string> = {
  cls: "planet class",
  atmo: "atmosphere",
  dens: "atmosphere density",
  volc: "volcanism",
  volclvl: "volcanism strength",
  host: "host star",
  hostlum: "host star luminosity",
  hostsub_c: "host star subclass",
  main: "main star",
  parent: "orbits a",
  region: "region",
  tidal: "tidally locked",
  bioc: "biological signals",
  nstars_c: "stars in the system",
};

const GAS_WORDS: Record<string, string> = {
  carbondioxide: "carbon dioxide",
  sulphurdioxide: "sulphur dioxide",
  silicatevapour: "silicate vapour",
};
/** "carbondioxide" → "carbon dioxide", "neonrich" → "neon-rich". */
function gasWords(key: string): string {
  const rich = key.endsWith("rich");
  const base = rich ? key.slice(0, -4) : key;
  return (GAS_WORDS[base] ?? base) + (rich ? "-rich" : "");
}

/** A table column in words: "temperature 169–177 K", "atmosphere: neon", "iron 18–19 %". */
export function splitColumnLabel(root: string, col: string): string {
  const f = load(root);
  const cat = /^([a-z_]+)=(.*)$/.exec(col);
  if (cat) {
    const [, fact, value] = cat as unknown as [string, string, string];
    const name = CAT_LABELS[fact] ?? NUM_LABELS[fact]?.[0] ?? fact;
    if (value === "nan") return `${name}: not known`;
    if (value === "other") return `${name}: other`;
    if (fact === "tidal") return value === "1" ? "tidally locked" : "not tidally locked";
    if (fact === "atmo") return `${name}: ${gasWords(value)}`;
    if (fact === "bioc") return `${value} biological signal${value === "1" ? "" : "s"}`;
    return `${name}: ${value}`;
  }
  const num = /^([a-z_]+)\[(\d+)\]$/.exec(col);
  if (!num || !f) return col;
  const [, fact, k] = num as unknown as [string, string, string];
  const edges = f.edges[fact] ?? [];
  const log = f.log10.includes(fact);
  const i = Number(k);
  const show = (v: number) => (log ? 10 ** v : v);
  const gas = /^gas_(.+)$/.exec(fact);
  const mat = /^mat_(.+)$/.exec(fact);
  const [words, unit, digits] = gas ? [`${gas[1]} share`, "%", 1] : mat ? [mat[1]!, "%", 1] : (NUM_LABELS[fact] ?? [fact, "", 2]);
  const fmt = (v: number) => show(v).toFixed(digits as number);
  const u = unit ? ` ${unit}` : "";
  if (edges.length === 0) return words as string;
  if (i === 0) return `${words} under ${fmt(edges[0]!)}${u}`;
  if (i >= edges.length) return `${words} over ${fmt(edges[edges.length - 1]!)}${u}`;
  return `${words} ${fmt(edges[i - 1]!)}–${fmt(edges[i]!)}${u}`;
}
