/**
 * The 'other match' detail cards: how far this body sits from each species' profile, axis by axis, ranked into the deck the species card shows. Split out of exomasteryProfile.ts (code review D, 2026-09-27).
 */
import {
  harvardSpectralStepDistance,
  isFeederHostStarSpectralPath,
  parseLooseSpectralMk,
  stellarSubclassStepDistance,
  yerkesLuminosityStepDistance,
} from "../shared/stellarProximity.js";
import type {
  EncyclopediaExomasteryFieldTier,
  ExplorationScanRecord,
  JournalHostStarObservation,
  OtherMatchDetailCardDTO,
  PlanetScan,
} from "../shared/types.js";
import { atmoGasValue, crustMaterialValue, solidValue, valueForNumericPath } from "./exomasteryBodyValues.js";
import {
  exomasteryPathTailLower,
  formatExomasteryNum,
  formatExomasteryValueForPath,
  formatPathLabel,
  modeCategoricalLabel,
} from "./exomasteryFormat.js";
import { shouldOmitExomasterySciencePath } from "./exomasteryPathHygiene.js";
import type { ExomasteryNumericRollup, ExomasteryProfileV1 } from "./exomasteryProfile.js";

export function inferHostSpectralCohortMode(profile: ExomasteryProfileV1): string | null {
  for (const [p, c] of Object.entries(profile.categorical ?? {})) {
    if (!isFeederHostStarSpectralPath(p)) continue;
    const m = modeCategoricalLabel(c);
    if (m) return m;
  }
  return null;
}

function rollupRelativeBandPercent(r: ExomasteryNumericRollup): number {
  const mode = r.mode ?? r.mean;
  const den = Math.max(Math.abs(mode), 1e-12);
  return ((r.max - r.min) / den) * 100;
}

function rollupBodyVsModePercent(v: number, r: ExomasteryNumericRollup): number {
  const mode = r.mode ?? r.mean;
  const den = Math.max(Math.abs(mode), 1e-12);
  return (Math.abs(v - mode) / den) * 100;
}

/** Same basis as encyclopedia `diffRelativePercent` for numerics (|v−mode|/|mode|×100). */
function deviationPercentVsRollupMode(v: number, r: ExomasteryNumericRollup): number {
  return rollupBodyVsModePercent(v, r);
}

function bodyInsideTrainingRange(v: number, r: ExomasteryNumericRollup): boolean {
  if (!Number.isFinite(r.min) || !Number.isFinite(r.max)) return true;
  const lo = Math.min(r.min, r.max);
  const hi = Math.max(r.min, r.max);
  return v >= lo && v <= hi;
}

/**
 * Same breakpoints as client `deviationToTier` in exomasteryHabitatDetailInner (habitat / encyclopedia).
 * Lower deviation from mode → blue/green; larger → orange/red.
 */
function otherMatchHighlightFromDeviation(
  devPct: number,
  v: number | null,
  r: ExomasteryNumericRollup,
): EncyclopediaExomasteryFieldTier | "neutral" {
  if (v == null || !Number.isFinite(v)) return "neutral";
  let driver = devPct;
  if (!bodyInsideTrainingRange(v, r)) {
    driver = Math.max(driver, 11);
  }
  if (driver < 1) return "blue";
  if (driver <= 5) return "green";
  if (driver <= 7.5) return "yellow";
  if (driver <= 10) return "orange";
  return "red";
}

function otherMatchPriorityFromHighlight(
  h: EncyclopediaExomasteryFieldTier | "neutral",
  tightBand: boolean,
): number {
  const bandBoost = tightBand ? -3 : 0;
  switch (h) {
    case "blue":
      return 3 + bandBoost;
    case "green":
      return 14 + bandBoost;
    case "yellow":
      return 48 + bandBoost;
    case "orange":
      return 125 + bandBoost;
    case "red":
      return 230 + bandBoost;
    default:
      return 305 + bandBoost;
  }
}

function hostMkStepsToHighlight(steps: number | null): EncyclopediaExomasteryFieldTier | "neutral" {
  if (steps == null) return "neutral";
  if (steps <= 0) return "blue";
  if (steps === 1) return "green";
  if (steps === 2) return "yellow";
  if (steps === 3) return "orange";
  return "red";
}

function pushHostStarOtherMatchDeckCards(
  out: OtherMatchDetailCardDTO[],
  profile: ExomasteryProfileV1,
  journalHost: JournalHostStarObservation | null | undefined,
): void {
  if (!journalHost) return;
  const cohort = inferHostSpectralCohortMode(profile);
  if (!cohort) return;
  const parsed = parseLooseSpectralMk(cohort);
  let id = 0;
  const add = (
    shortTitle: string,
    top: string,
    bottom: string,
    steps: number | null,
    tooltip: string,
  ): void => {
    const highlight = hostMkStepsToHighlight(steps);
    const priority = otherMatchPriorityFromHighlight(highlight, false);
    out.push({
      id: `exo-host-deck-${id++}`,
      priority,
      shortTitle,
      topLegend: "Feeder cohort",
      topValue: top,
      bottomLegend: "Journal host",
      bottomValue: bottom,
      tooltip,
      highlight,
    });
  };
  if (journalHost.spectralLetter && parsed.spectralSlot) {
    const st = harvardSpectralStepDistance(parsed.spectralSlot, journalHost.spectralLetter);
    if (st != null) {
      add(
        "Host · spectral class",
        String(parsed.spectralSlot),
        journalHost.spectralLetter,
        st,
        "Harvard coarse class steps vs exomastery feeder mode (same-genus similarity).",
      );
    }
  }
  if (parsed.subclass != null && journalHost.subclass != null) {
    const st = stellarSubclassStepDistance(parsed.subclass, journalHost.subclass);
    if (st != null) {
      add(
        "Host · subclass",
        String(parsed.subclass),
        String(journalHost.subclass),
        st,
        "Subclass digit (0–9) distance — same-genus similarity.",
      );
    }
  }
  if (parsed.luminosity && journalHost.luminosity) {
    const st = yerkesLuminosityStepDistance(parsed.luminosity, journalHost.luminosity);
    if (st != null) {
      add(
        "Host · luminosity (Yerkes)",
        parsed.luminosity,
        journalHost.luminosity,
        st,
        "Yerkes luminosity class distance — weighted strongly in the similarity index.",
      );
    }
  }
}

/** Per-chip colour weight for similarity “deck” score (blue strongest; red none). */
const OTHER_MATCH_HIGHLIGHT_UNIT: Record<EncyclopediaExomasteryFieldTier | "neutral", number> = {
  blue: 1,
  green: 0.28,
  yellow: 0.06,
  orange: 0.012,
  red: 0,
  neutral: 0.08,
};

/** Tier multiplier: 1 = genus-_new style primary body fields; 2 = solid fractions; 3 = crust; 4 = other numerics / misc. */
const OTHER_MATCH_TIER_UNIT: Record<1 | 2 | 3 | 4, number> = {
  1: 1,
  2: 0.5,
  3: 0.35,
  4: 0.18,
};

/**
 * Orbital geometry, recognised by chip title rather than by feeder path. Same demotion the habitat
 * scorer applies through its `background` tier; checked before anything else so a loose keyword
 * cannot promote an orbital chip back into tier 1.
 */
const ORBITAL_GEOMETRY_CHIP =
  /(semi[- ]?major|orbital period|rotation(al)? period|tidal|eccentric|inclination|periapsis|ascending node|mean anomaly)/i;

function otherMatchCardTierFromTitle(shortTitle: string): 1 | 2 | 3 | 4 {
  const t = shortTitle.trim();
  if (ORBITAL_GEOMETRY_CHIP.test(t)) return 4;
  if (t.startsWith("Host ·")) return 1;
  if (t.startsWith("Solid ·")) return 2;
  if (t.startsWith("Crust ·")) return 3;
  if (t.startsWith("Atmosphere ·")) return 1;
  const low = t.toLowerCase();
  if (
    /\bplanet\b/.test(low) ||
    low.includes("atmosphere") ||
    low.includes("gravity") ||
    low.includes("temperature") ||
    low.includes("pressure") ||
    low.includes("terraform") ||
    low.includes("landable") ||
    low.includes("volcan") ||
    (low.includes("mass") && (low.includes("earth") || low.includes("em"))) ||
    low.includes("radius")
  ) {
    return 1;
  }
  return 4;
}

/** A title's tier, read once: the titles are the profiles' few hundred facts, scored for every candidate. */
const tierByTitle = new Map<string, 1 | 2 | 3 | 4>();

/**
 * Single scalar “deck strength” from other-match chips: tier (primary vs solid vs crust vs other) × highlight colour.
 * Used for same-genus deck share (sum-normalized vs siblings in {@link applyExomasteryGenusCompetitivePercent}), not habitat quality.
 */
export function exomasteryOtherMatchCardDeckScore(cards: OtherMatchDetailCardDTO[]): number {
  let sum = 0;
  for (const c of cards) {
    let tier = tierByTitle.get(c.shortTitle);
    if (tier === undefined) tierByTitle.set(c.shortTitle, (tier = otherMatchCardTierFromTitle(c.shortTitle)));
    const hi = (c.highlight ?? "neutral") as keyof typeof OTHER_MATCH_HIGHLIGHT_UNIT;
    const hw = OTHER_MATCH_HIGHLIGHT_UNIT[hi] ?? OTHER_MATCH_HIGHLIGHT_UNIT.neutral;
    let hostBoost = 1;
    if (c.shortTitle.startsWith("Host · luminosity")) hostBoost = 1.58;
    else if (c.shortTitle.startsWith("Host ·")) hostBoost = 1.14;
    sum += OTHER_MATCH_TIER_UNIT[tier] * hw * hostBoost;
  }
  return Math.round(sum * 1000) / 1000;
}

/**
 * Candidate species — “Other match details”: compact feeder vs body chips (priority + colors align with encyclopedia deviation tiers).
 */
/** Whether a candidate's similarity was measured, which narrows its deck (see {@link buildOtherMatchDetailDecks}). */
export function otherMatchHasSimilarity(similarityPercent: number | null | undefined): boolean {
  return similarityPercent != null && Number.isFinite(similarityPercent) && similarityPercent >= 0;
}

export function buildOtherMatchDetailCards(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  similarityPercent: number | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): OtherMatchDetailCardDTO[] {
  const raw = buildOtherMatchRawCards(profile, scan, rec, journalHost);
  return finishOtherMatchDeck(raw, otherMatchHasSimilarity(similarityPercent));
}

/**
 * Both decks a candidate can get from one build: without its similarity (the snapshot scores the candidate on
 * that one) and with it (the one the drawer shows once the similarity is known). They differ only in a numeric
 * fact whose value is present but not finite on a loose band, which the similarity deck leaves out; building
 * them separately formatted every card twice per candidate per body (code review, 2026-10-14).
 */
export function buildOtherMatchDetailDecks(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): { withoutSimilarity: OtherMatchDetailCardDTO[]; readonly withSimilarity: OtherMatchDetailCardDTO[] } {
  const raw = buildOtherMatchRawCards(profile, scan, rec, journalHost);
  // The similarity deck only when asked for: a candidate without a measured similarity never shows it.
  let withSimilarity: OtherMatchDetailCardDTO[] | null = null;
  return {
    withoutSimilarity: finishOtherMatchDeck(raw, false),
    get withSimilarity() {
      return (withSimilarity ??= finishOtherMatchDeck(raw, true));
    },
  };
}

/*
  What a profile's facts need for their cards and do not take from the body — which facts get one, their titles, the
  typical value, the range, the start of the tooltip — worked out once per profile instead of once per body and
  candidate (2026-11-03: the cards were 42 % of the time spent building bodies, ~19 of 46 s over 1,035 EDDN bodies).
  Profiles are loaded once and never changed, so the profile object is the key.
*/
interface NumericFact {
  path: string;
  r: ExomasteryNumericRollup;
  tightBand: boolean;
  id: string;
  label: string;
  dispMode: string;
  /** The tooltip up to the body's own deviation. */
  tooltipHead: string;
}
interface ShareFact {
  el: string;
  r: ExomasteryNumericRollup;
  mode: number;
  tightBand: boolean;
  id: string;
  shortTitle: string;
  topValue: string;
  tooltipHead: string;
}
interface ProfileFacts {
  numerics: NumericFact[];
  materials: ShareFact[];
  atmosphere: ShareFact[];
  solids: ShareFact[];
}
const profileFacts = new WeakMap<ExomasteryProfileV1, ProfileFacts>();

function shareFacts(
  entries: [string, ExomasteryNumericRollup][],
  idPrefix: string,
  title: string,
  what: string,
): ShareFact[] {
  return entries.map(([el, r]) => {
    const mode = r.mode ?? r.mean;
    return {
      el,
      r,
      mode,
      tightBand: rollupRelativeBandPercent(r) < 0.1,
      id: `${idPrefix}${el.replace(/[^a-z0-9]+/gi, "-")}`,
      shortTitle: `${title} · ${el}`,
      topValue: `${formatExomasteryNum(mode)}%`,
      tooltipHead: `${what} ${el}: feeder ${formatExomasteryNum(r.min)}–${formatExomasteryNum(r.max)}% · n=${r.count ?? "?"}. Δ vs mode: `,
    };
  });
}

function factsOf(profile: ExomasteryProfileV1): ProfileFacts {
  const hit = profileFacts.get(profile);
  if (hit) return hit;
  const materialKeysLower = new Set(Object.keys(profile.materials).map((k) => k.toLowerCase()));
  const atmoKeysLower = new Set(Object.keys(profile.atmosphereComposition).map((k) => k.toLowerCase()));
  const solidKeysLower = new Set(Object.keys(profile.solidComposition ?? {}).map((k) => k.toLowerCase()));
  const numerics: NumericFact[] = [];
  for (const [path, r] of Object.entries(profile.numerics)) {
    if (shouldOmitExomasterySciencePath(path)) continue;
    if (/solidcomposition/i.test(path)) continue;
    const tail = exomasteryPathTailLower(path);
    if (materialKeysLower.has(tail) || atmoKeysLower.has(tail) || solidKeysLower.has(tail)) continue;
    const band = rollupRelativeBandPercent(r);
    const spanNote = `${formatExomasteryValueForPath(path, r.min)} … ${formatExomasteryValueForPath(path, r.max)}`;
    numerics.push({
      path,
      r,
      tightBand: band < 0.1,
      id: `exo-${tail}-${Math.abs(hashStringSimple(path))}`.replace(/[^a-z0-9_-]/gi, "-"),
      label: formatPathLabel(path),
      dispMode: formatExomasteryValueForPath(path, r.mode ?? r.mean),
      tooltipHead: `Exomastery sample (${r.count ?? "?"} bodies): min–max ${spanNote}. Band vs mode: ${band.toFixed(4)}%. Δ vs mode: `,
    });
  }
  // A solid key listed twice in other cases is one card, the first.
  const seenSolid = new Set<string>();
  const solids = Object.entries(profile.solidComposition ?? {}).filter(([el]) => {
    const k = el.toLowerCase();
    if (seenSolid.has(k)) return false;
    seenSolid.add(k);
    return true;
  });
  const facts: ProfileFacts = {
    numerics,
    materials: shareFacts(Object.entries(profile.materials), "exo-mat-", "Crust", "Crust element"),
    atmosphere: shareFacts(Object.entries(profile.atmosphereComposition), "exo-atmo-", "Atmosphere", "Atmosphere gas"),
    solids: shareFacts(solids, "exo-solid-", "Solid", "Solid fraction"),
  };
  profileFacts.set(profile, facts);
  return facts;
}

/** One card of a share (crust element, atmosphere gas, solid fraction) for the body's own value. */
function shareCard(f: ShareFact, curN: number): OtherMatchDetailCardDTO {
  const devPct = deviationPercentVsRollupMode(curN, f.r);
  const highlight = otherMatchHighlightFromDeviation(devPct, curN, f.r);
  const dpp = Number.isFinite(f.mode) ? Math.round(Math.abs(curN - f.mode) * 10) / 10 : null;
  return {
    id: f.id,
    priority: otherMatchPriorityFromHighlight(highlight, f.tightBand),
    shortTitle: f.shortTitle,
    topLegend: "Typical (mode %)",
    topValue: f.topValue,
    bottomLegend: "This body",
    bottomValue: `${formatExomasteryNum(curN)}%`,
    tooltip: `${f.tooltipHead}${dpp ?? "—"} pp · ${devPct.toFixed(2)}% rel.`,
    highlight,
  };
}

interface RawCards {
  cards: OtherMatchDetailCardDTO[];
  /** Cards only the deck without a similarity keeps. */
  withoutSimilarityOnly: Set<OtherMatchDetailCardDTO>;
}

function buildOtherMatchRawCards(
  profile: ExomasteryProfileV1,
  scan: PlanetScan,
  rec: ExplorationScanRecord | null | undefined,
  journalHost?: JournalHostStarObservation | null,
): RawCards {
  const out: OtherMatchDetailCardDTO[] = [];
  const withoutSimilarityOnly = new Set<OtherMatchDetailCardDTO>();
  pushHostStarOtherMatchDeckCards(out, profile, journalHost ?? null);
  const facts = factsOf(profile);

  for (const f of facts.numerics) {
    const v = valueForNumericPath(f.path, scan, rec);
    const hasValue = v != null && Number.isFinite(v);
    // With a similarity: a fact with a value or a tight band. Without: anything but a missing value on a loose band.
    const inWith = f.tightBand || hasValue;
    const inWithout = !(v == null && !f.tightBand);
    if (!inWith && !inWithout) continue;

    const devPct = hasValue ? deviationPercentVsRollupMode(v!, f.r) : 100;
    const highlight = hasValue ? otherMatchHighlightFromDeviation(devPct, v!, f.r) : "neutral";
    out.push({
      id: f.id,
      priority: otherMatchPriorityFromHighlight(highlight, f.tightBand),
      shortTitle: f.label,
      topLegend: "Typical (mode)",
      topValue: f.dispMode,
      bottomLegend: "This body",
      bottomValue: hasValue ? formatExomasteryValueForPath(f.path, v!) : "—",
      tooltip: `${f.tooltipHead}${hasValue ? `${devPct.toFixed(2)}%` : "—"}.`,
      highlight,
    });
    if (!inWith) withoutSimilarityOnly.add(out[out.length - 1]!);
  }

  for (const f of facts.materials) {
    const cur = crustMaterialValue(scan, rec, f.el);
    if (cur.known) out.push(shareCard(f, cur.v ?? 0));
  }
  for (const f of facts.atmosphere) {
    const cur = atmoGasValue(scan, rec, f.el);
    if (cur.known) out.push(shareCard(f, cur.v ?? 0));
  }
  for (const f of facts.solids) {
    const cur = solidValue(scan, rec, f.el);
    if (cur.known) out.push(shareCard(f, cur.v ?? 0));
  }

  return { cards: out, withoutSimilarityOnly };
}

/** The order `localeCompare` gives, made once (a new comparison per call was ~4 s of the 19 above). */
const CARD_ORDER = new Intl.Collator();

function finishOtherMatchDeck(raw: RawCards, hasSimilarity: boolean): OtherMatchDetailCardDTO[] {
  const dedup = new Map<string, OtherMatchDetailCardDTO>();
  for (const c of raw.cards) {
    if (hasSimilarity && raw.withoutSimilarityOnly.has(c)) continue;
    const k = `${c.shortTitle.toLowerCase()}|${c.topValue}|${c.bottomValue}`;
    if (!dedup.has(k)) dedup.set(k, c);
  }
  const merged = [...dedup.values()];
  merged.sort((a, b) => a.priority - b.priority || CARD_ORDER.compare(a.shortTitle, b.shortTitle));
  return merged.slice(0, 120);
}

function hashStringSimple(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
