/*
  What the unsold exobiology is worth (split out of snapshot.ts, discuss item 30, 1.3.1): the sale value with the
  first-footfall x5, the Pranav Antal bonus and the fleet carrier factors, the Data value breakdown's lines, and the
  launcher's live strip, which reads the store directly instead of building a snapshot.
*/
import { getCachedPrices } from "./speciesDb.js";
import type { AppStatusDTO } from "../shared/types.js";
import type { OrganicPendingLineItem, SpeciesDatabase, SpeciesEntry } from "../shared/types.js";
import { getProjectRoot } from "./paths.js";
import type { GameStateStore } from "./gameState.js";
import { resolveSpeciesPhoto } from "./speciesPhotos.js";
import { lookupPrice, type PriceIndex } from "./priceList.js";
import { speciesEntryMatchesOrganicLabel } from "./organicTracking.js";
import { bodyIdOfBodyKey } from "../shared/bodyKey.js";

/** Unsold exobiology (3× Analyse in journal): list ×5 on first-footfall bodies (else ×1) — same multiplier as map tier/heuristic when footfall applies. */
/** Pranav Antal's +30 % on exobiology sales (Powerplay 2.0), as the Data value toggle applies it. */
export const PRANAV_ANTAL_BONUS = 1.3;
/**
 * A fleet carrier's Universal Cartographics pays 75 % (the owner's carrier sales, 2026-10-03). Only
 * Cartographics and codex data; Vista Genomics pays in full (owner, 2026-10-04).
 */
export const FLEET_CARRIER_SALE_FACTOR = 0.75;
/** At his own carrier 10 of those 25 % land in its bank, his to take back: 85 % (owner, 2026-10-04). */
export const OWN_FLEET_CARRIER_SALE_FACTOR = 0.85;

export function organicDataValuation(
  store: GameStateStore,
  prices: PriceIndex,
): {
  credits: number;
  pendingSamples: number;
} {
  let credits = 0;
  for (const p of store.pendingOrganicSales) {
    const base = lookupPrice(prices, p.label, p.label);
    if (base == null) continue;
    const mult = store.firstFootfallBodies.has(p.bodyKey) ? 5 : 1;
    credits += base * mult;
  }
  // The Pranav Antal sale bonus on the whole exobiology sale, when the commander says he sells there.
  if (store.pranavAntalBonus) credits = Math.round(credits * PRANAV_ANTAL_BONUS);
  return { credits, pendingSamples: store.pendingOrganicSales.length };
}

/*
  Label → species, per database. The pending list is re-read on every snapshot and each line searched
  all 109 species with the organic-label matcher: 17 % of a live refresh (code review §E, 2026-09-27).
*/
const pendingLabelEntries = new WeakMap<SpeciesDatabase, Map<string, SpeciesEntry | null>>();

function speciesForPendingLabel(db: SpeciesDatabase, label: string): SpeciesEntry | null {
  let byLabel = pendingLabelEntries.get(db);
  if (!byLabel) pendingLabelEntries.set(db, (byLabel = new Map()));
  let hit = byLabel.get(label);
  if (hit === undefined) {
    hit = db.species.find((e) => speciesEntryMatchesOrganicLabel(e, label)) ?? null;
    byLabel.set(label, hit);
  }
  return hit;
}

export function buildOrganicPendingLines(
  store: GameStateStore,
  db: SpeciesDatabase,
  prices: PriceIndex,
): OrganicPendingLineItem[] {
  const root = getProjectRoot();
  const out: OrganicPendingLineItem[] = [];
  for (const p of store.pendingOrganicSales) {
    const body = store.bodies.get(p.bodyKey);
    const bid = bodyIdOfBodyKey(p.bodyKey);
    const bodyName = body?.bodyName ?? (Number.isFinite(bid) ? `Body ${bid}` : p.bodyKey);
    const starSystem = body?.starSystem ?? store.currentSystem ?? "—";
    const base = lookupPrice(prices, p.label, p.label);
    const firstFootfall = store.firstFootfallBodies.has(p.bodyKey);
    const mult: 1 | 5 = firstFootfall ? 5 : 1;
    const valueCredits = base != null ? base * mult : 0;
    const entry = speciesForPendingLabel(db, p.label);
    const photoUrl = entry ? resolveSpeciesPhoto(entry, root).photoUrl : "/photos/__builtin_placeholder.svg";
    out.push({
      bodyKey: p.bodyKey,
      bodyName,
      starSystem,
      speciesLabel: p.label,
      baseCredits: base,
      valueCredits,
      firstFootfall,
      multiplier: mult,
      photoUrl,
    });
  }
  return out;
}

/**
 * The launcher's live strip: cheap store reads, no snapshot build. Where the commander is, what is
 * unsold, and the last jump target — enough to make the launcher a glance-able dashboard while the
 * game runs, without the ~180 ms a full snapshot costs.
 */
export function organicLiveSummary(store: GameStateStore): NonNullable<AppStatusDTO["live"]> {
  const { credits, pendingSamples } = organicDataValuation(store, getCachedPrices());
  const bodyKey =
    store.exoOrganicTracker?.bodyKey ?? store.overlayTouchdownBodyKey ?? store.uiSelectedBodyKey;
  const body = bodyKey ? store.bodies.get(bodyKey) : undefined;
  const jt = store.nextJumpTarget();
  return {
    systemName: store.currentSystem ?? null,
    bodyName: body?.bodyName ?? null,
    bioSignals: body?.biologicalSignals ?? null,
    organicDataValueCredits: credits,
    organicPendingSampleCount: pendingSamples,
    jumpTarget: jt
      ? { starSystem: jt.starSystem, starClass: jt.starClass, arrived: jt.arrived, source: jt.source }
      : null,
  };
}
