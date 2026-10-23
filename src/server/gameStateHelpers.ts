/**
 * The free helpers of gameState.ts: journal-line readers, signal and genus parsing, the shared-exobiology
 * likeness of two scans, signs of life, the foot-scan locks and the barycentre twins. None holds state; the
 * sibling helpers read only the store's public members. Moved out of gameState.ts (audit 2026-10-22).
 */
import { reportsVolcanism } from "../shared/volcanismText.js";
import type {
  BodyExoState,
  ExplorationScanRecord,
  GenusHint,
  JournalLine,
  OrganicGenusLock,
  PlanetScan,
  SystemLife,
} from "../shared/types.js";
import { bodyKey } from "../shared/bodyKey.js";
import type { GameStateStore } from "./gameState.js";
import { moonPairBarycentreId } from "./orbitUtils.js";

function journalLineNumericBodyId(line: JournalLine): number | undefined {
  if (typeof line.BodyID === "number" && Number.isFinite(line.BodyID)) return line.BodyID;
  if (typeof line.Body === "number" && Number.isFinite(line.Body)) return line.Body;
  return undefined;
}

export function journalLineMatchesBodyIds(line: JournalLine, systemAddress: number, bodyId: number): boolean {
  if (typeof line.SystemAddress !== "number" || line.SystemAddress !== systemAddress) return false;
  return journalLineNumericBodyId(line) === bodyId;
}

export function journalLineBodyDisplayName(line: JournalLine): string | null {
  const b = line.Body;
  if (typeof b === "string" && b.trim()) return b.trim();
  const bn = line.BodyName;
  if (typeof bn === "string" && bn.trim()) return bn.trim();
  return null;
}

/** `Body 7` — what a line that carries only a `BodyID` (ScanOrganic, CodexEntry) is named until something better is known. */
const PLACEHOLDER_BODY_NAME = /^Body \d+$/;

export function ensureBody(
  map: Map<string, BodyExoState>,
  systemAddress: number,
  bodyId: number,
  bodyName: string,
  starSystem: string,
  ts: string,
): BodyExoState {
  const key = bodyKey(systemAddress, bodyId);
  let b = map.get(key);
  if (!b) {
    b = {
      key,
      bodyName,
      bodyId,
      systemAddress,
      starSystem,
      biologicalSignals: null,
      genusHints: null,
      dssComplete: false,
      scan: null,
      signalHints: null,
      organicGenusLocks: [],
      confirmedVariants: [],
      updatedAt: ts,
    };
    map.set(key, b);
  } else {
    /*
      A placeholder never replaces a real name. ScanOrganic and CodexEntry carry no body name, and
      they come after the Scan that named the body — landing follows scanning — so "Body 2" used to
      win on 282 of his bio bodies (Tegnae HT-Z d13-1 1 a among them).
    */
    if (bodyName && !(PLACEHOLDER_BODY_NAME.test(bodyName) && !PLACEHOLDER_BODY_NAME.test(b.bodyName))) {
      b.bodyName = bodyName;
    }
    b.starSystem = starSystem;
    b.updatedAt = ts;
  }
  return b;
}

export function asSignals(raw: unknown): { Type?: string; Type_Localised?: string; Count?: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw as { Type?: string; Type_Localised?: string; Count?: number }[];
}

/** The `Geological` signal's count, or null when the line has none. */
export function geologicalCount(signals: ReturnType<typeof asSignals>): number | null {
  for (const s of signals) {
    const lo = `${s.Type ?? ""} ${s.Type_Localised ?? ""}`.toLowerCase();
    if (lo.includes("geological")) return typeof s.Count === "number" ? s.Count : null;
  }
  return null;
}

export function biologicalCount(signals: ReturnType<typeof asSignals>): number | null {
  for (const s of signals) {
    const loc = (s.Type_Localised ?? "").trim();
    const ty = (s.Type ?? "").trim();
    const locLo = loc.toLowerCase();
    const tyLo = ty.toLowerCase();
    if (locLo === "biological" || tyLo.includes("biological") || tyLo.includes("signaltype_biological")) {
      return typeof s.Count === "number" ? s.Count : null;
    }
  }
  return null;
}

export function mergeScannerSignalHints(
  existing: string[] | null | undefined,
  lineSignals: unknown,
): string[] | null {
  const raw = asSignals(lineSignals);
  const set = new Set<string>();
  for (const x of existing ?? []) {
    const t = x.trim();
    if (t) set.add(t);
  }
  for (const s of raw) {
    const ty = (s.Type ?? "").trim();
    const loc = (s.Type_Localised ?? "").trim();
    if (ty) set.add(ty);
    if (loc) set.add(loc);
  }
  return set.size ? [...set] : (existing ?? null);
}

export function asGenuses(raw: unknown): GenusHint[] | null {
  if (!Array.isArray(raw)) return null;
  const out: GenusHint[] = [];
  for (const g of raw) {
    const o = g as Record<string, unknown>;
    const glRaw = firstString(o, ["Genus_Localised", "genus_localised", "GenusLocalised"]);
    const giRaw = firstString(o, ["Genus", "genus"]);
    if (!glRaw && !giRaw) continue;
    out.push({ Genus_Localised: glRaw || giRaw, Genus: giRaw || glRaw });
  }
  return out.length ? out : null;
}

function firstString(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function mergeGenusHints(existing: GenusHint[] | null, incoming: GenusHint[] | null): GenusHint[] | null {
  if (!incoming?.length) return existing?.length ? existing : null;
  if (!existing?.length) return incoming;
  const seen = new Set<string>();
  const out: GenusHint[] = [];
  for (const h of [...existing, ...incoming]) {
    const k = `${h.Genus}\0${h.Genus_Localised}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out.length ? out : null;
}

function strEqLoose(a: string | undefined, b: string | undefined): boolean {
  return (a ?? "").trim() === (b ?? "").trim();
}

function normVolc(s: string | undefined): string {
  return reportsVolcanism(s) ? (s ?? "").trim().toLowerCase() : "";
}

/**
 * Moons of the same planet often share exobiology; used to mirror FSS / DSS / scans / on-foot data to siblings.
 * Terraform, atmosphere type, and journal temp/pressure are allowed to differ moderately or be one-sided missing.
 */
export function explorationRecordsSimilarForSharedExo(a: ExplorationScanRecord, b: ExplorationScanRecord): boolean {
  if (!strEqLoose(a.planetClass, b.planetClass)) return false;

  const tA = (a.terraformState ?? "").trim();
  const tB = (b.terraformState ?? "").trim();
  if (tA && tB && tA !== tB) return false;

  const atA = (a.atmosphereType ?? "").trim();
  const atB = (b.atmosphereType ?? "").trim();
  if (atA && atB && atA !== atB) return false;

  const atmA = (a.atmosphere ?? "").trim();
  const atmB = (b.atmosphere ?? "").trim();
  if (atmA && atmB && atmA !== atmB) return false;

  if (a.landable !== undefined && b.landable !== undefined && a.landable !== b.landable) return false;

  if (normVolc(a.volcanism) !== normVolc(b.volcanism)) return false;

  if (a.surfaceGravity != null && b.surfaceGravity != null) {
    const d = Math.abs(a.surfaceGravity - b.surfaceGravity);
    if (d > Math.max(0.35, Math.abs(a.surfaceGravity) * 0.06)) return false;
  }
  if (a.surfaceTemperature != null && b.surfaceTemperature != null) {
    const d = Math.abs(a.surfaceTemperature - b.surfaceTemperature);
    if (d > 120) return false;
  }
  if (a.surfacePressure != null && b.surfacePressure != null) {
    const ma = Math.max(Math.abs(a.surfacePressure), Math.abs(b.surfacePressure), 0.01);
    const d = Math.abs(a.surfacePressure - b.surfacePressure);
    if (d > Math.max(0.35, ma * 0.25)) return false;
  }

  return true;
}

/** Arrival lines' "nobody here" values for security and government (the game spells anarchy two ways). */
const NO_SECURITY = new Set(["", "$GAlAXY_MAP_INFO_state_anarchy;", "$GALAXY_MAP_INFO_state_anarchy;"]);
const NO_GOVERNMENT = new Set(["", "$government_None;", "$government_Anarchy;"]);

/**
 * The owner's signs of life on an arrival line (FSDJump / Location / CarrierJump), in his order:
 * population, then security and government, then a controlling faction. `null` when the line shows
 * none; `undefined` when it does not carry `Population` at all and so says nothing either way.
 */
export function signsOfLife(e: Record<string, unknown>): SystemLife | null | undefined {
  const pop = e.Population;
  if (typeof pop !== "number" || !Number.isFinite(pop)) return undefined;
  if (pop > 0) return "populated";
  const security = typeof e.SystemSecurity === "string" ? e.SystemSecurity : "";
  const government = typeof e.SystemGovernment === "string" ? e.SystemGovernment : "";
  const controller = e.SystemFaction != null && typeof e.SystemFaction === "object";
  const factions = Array.isArray(e.Factions) ? e.Factions.length : 0;
  if (!NO_SECURITY.has(security) || !NO_GOVERNMENT.has(government)) return "facility";
  if (controller) return factions === 0 ? "claimed" : "facility";
  return null;
}

/**
 * Record one `ScanOrganic` on a body's locks: one lock per species, carrying how far it got.
 *
 * Every `ScanOrganic` used to push its own lock, so a sampled species sat on the body four times
 * (Log, Sample, Sample, Analyse), and a comp-scanned one that was then walked up to showed twice —
 * once from the codex line, with no symbols, and once from the foot scan. The guild's report:
 * "Stratum Limaxus - Green, Bacterium Aurasus - Teal, Stratum Limaxus - Green". A foot scan now
 * updates its species' lock, and replaces a comp-scan or sibling-moon lock for the same species.
 *
 * `Log` opens a run at 1 (re-logging an abandoned plant starts it again); each `Sample` adds one, up
 * to 3; `Analyse` completes it. Exported for its test.
 */
export function upsertFootOrganicLock(
  locks: OrganicGenusLock[],
  lock: OrganicGenusLock,
  scanType: string,
  at?: string,
): void {
  const sp = lock.speciesLocalised.trim().toLowerCase();
  const gk = organicLockGenusKey(lock);
  const idx = locks.findIndex((l) =>
    sp ? l.speciesLocalised.trim().toLowerCase() === sp : organicLockGenusKey(l) === gk,
  );
  const prev = idx >= 0 ? locks[idx]! : null;
  const prevFoot = prev && prev.source !== "codex" && !prev.fromSibling ? prev : null;
  const analysed = prevFoot?.analysed === true || scanType === "Analyse";
  const prevSamples = prevFoot?.samples ?? 0;
  const samples = analysed
    ? 3
    : scanType === "Log"
      ? 1
      : scanType === "Sample"
        ? Math.min(3, prevSamples + 1)
        : Math.max(1, prevSamples);
  const next: OrganicGenusLock = {
    ...lock,
    variantLocalised: lock.variantLocalised || prevFoot?.variantLocalised || "",
    samples,
    ...(analysed ? { analysed: true } : {}),
    ...(at ? { at } : prevFoot?.at ? { at: prevFoot.at } : {}),
  };
  if (idx >= 0) locks[idx] = next;
  else locks.push(next);
}

export function organicLockGenusKey(lock: OrganicGenusLock): string {
  const s = (lock.genusSymbol ?? "").trim().toLowerCase();
  const l = (lock.genusLocalised ?? "").trim().toLowerCase();
  return `${s}\0${l}`;
}

/**
 * The moon that shares a barycentre with `sourceBodyId` (excludes self), using merged `Scan` parents
 * and/or the orbit map. Until 2026-10-04 every moon of the same planet counted; the owner (overnight
 * Q13): only twins on a barycentre share their biology. Spansh, DSS'd pairs: moons of one planet
 * name the same genera on 39 % of 534,018 pairs (83 % at the same signal count); twins on one
 * barycentre on 95 % at the same count, and at different counts one list holds the other.
 */
export function siblingMoonBodyIdsUnified(
  store: GameStateStore,
  systemAddress: number,
  sourceBodyId: number,
): number[] {
  const sk = bodyKey(systemAddress, sourceBodyId);
  const sourceRec = store.explorationScans.get(sk);
  const parentFromRec = sourceRec ? moonPairBarycentreId(sourceRec.parents) : null;
  const parentFromOrbit = store.orbitParentPlanetByBody.get(sk);
  const parent = parentFromRec ?? parentFromOrbit ?? null;
  if (parent == null) return [];

  const out = new Set<number>();
  for (const rec of store.liveScansInSystem(systemAddress)) {
    if (moonPairBarycentreId(rec.parents) === parent) out.add(rec.bodyId);
  }
  for (const [bid, p] of store.orbitParentsInSystem(systemAddress)) {
    if (p === parent) out.add(bid);
  }
  out.delete(sourceBodyId);
  return [...out];
}

export function buildSiblingPlanetScan(
  store: GameStateStore,
  source: PlanetScan,
  systemAddress: number,
  siblingBodyId: number,
  siblingRec: ExplorationScanRecord | null,
): PlanetScan {
  const bk = bodyKey(systemAddress, siblingBodyId);
  const wfKnown = store.bodyDetailedFootfallState.has(bk);
  const wf = wfKnown ? store.bodyDetailedFootfallState.get(bk) : undefined;
  const name =
    siblingRec?.bodyName?.trim() || store.bodies.get(bk)?.bodyName?.trim() || `Body ${siblingBodyId}`;
  const star = siblingRec?.starSystem?.trim() || source.StarSystem;
  return {
    BodyName: name,
    BodyID: siblingBodyId,
    StarSystem: star,
    SystemAddress: systemAddress,
    PlanetClass: siblingRec?.planetClass ?? source.PlanetClass,
    Atmosphere: siblingRec?.atmosphere ?? source.Atmosphere,
    AtmosphereType: siblingRec?.atmosphereType ?? source.AtmosphereType,
    SurfaceGravity: siblingRec?.surfaceGravity ?? source.SurfaceGravity,
    SurfaceTemperature: siblingRec?.surfaceTemperature ?? source.SurfaceTemperature,
    SurfacePressure: siblingRec?.surfacePressure ?? source.SurfacePressure,
    SemiMajorAxis: siblingRec?.semiMajorAxis ?? source.SemiMajorAxis,
    TidalLock: siblingRec?.tidalLock ?? source.TidalLock,
    Volcanism: siblingRec?.volcanism ?? source.Volcanism,
    Landable: siblingRec?.landable ?? source.Landable,
    TerraformState: siblingRec?.terraformState ?? source.TerraformState,
    WasFootfalled: wf !== undefined ? wf : undefined,
    materials: Array.isArray(siblingRec?.materials)
      ? (siblingRec!.materials as PlanetScan["materials"])
      : source.materials,
    atmosphereComposition: Array.isArray(siblingRec?.atmosphereComposition)
      ? (siblingRec!.atmosphereComposition as PlanetScan["atmosphereComposition"])
      : source.atmosphereComposition,
    composition: (siblingRec?.composition as PlanetScan["composition"]) ?? source.composition,
    radius: siblingRec?.radius ?? source.radius,
  };
}
