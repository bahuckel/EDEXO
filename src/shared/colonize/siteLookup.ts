/**
 * Phase 9: look up a construction site you have not docked at.
 *
 * Spansh finds the site by name — names are not unique, so every hit carries its system — but
 * holds nothing about what a site needs: construction depots' market rows all read `demand: 0`,
 * and EDDN has no colonisation schema at all. The remaining requirement exists only in the
 * journal of someone who docked there, and on Raven Colonial if they registered the project.
 *
 * Raven Colonial publishes no terms of use; its clients are GPL-3.0 and its server is closed.
 * This app only calls the public HTTP API with its own client and copies nothing from those
 * repositories. Look-ups happen when the commander asks, are cached, and are attributed on screen.
 */
import { commodityNormKey, resourceNeedId } from "./commodityKey";
import { COMMODITY_SPANSH_SLUGS_BY_NORM_KEY } from "./commoditySpanshSlugs.gen";
import { parseMarketId } from "./marketId";
import { toLy, type Ly } from "./systemDistanceLy";

/** Spansh's station `type` for a construction site, before it is finished and renamed. */
export const CONSTRUCTION_DEPOT_TYPES = ["Space Construction Depot", "Planetary Construction Depot"] as const;

export const RAVEN_COLONIAL_API =
  "https://ravencolonial100-awcbdvabgze4c5cq.canadacentral-01.azurewebsites.net";
export const RAVEN_COLONIAL_SITE = "https://ravencolonial.com";

export type ConstructionSiteHit = {
  name: string;
  systemName: string;
  marketId: string;
  kind: "space" | "planetary";
  /** From the search's reference system, when one was given. */
  distanceLy: Ly;
  updatedAt: string | null;
};

export type SiteNeedRow = {
  /** The planner's commodity id (`resourceNeedId`), so a row can later join a plan. */
  commodityId: string;
  label: string;
  tons: number;
};

export type SiteNeeds =
  | { found: false }
  | {
      found: true;
      buildName: string;
      buildType: string;
      /** Tons still to deliver, largest first. */
      remaining: SiteNeedRow[];
      remainingTons: number;
      totalTons: number | null;
      complete: boolean;
      /** When Raven Colonial last heard about the project. */
      updatedAt: string | null;
      linkedCarriers: number;
    };

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Hits from a Spansh `stations/search` response; anything that is not a construction depot is dropped. */
export function parseConstructionSiteHits(payload: unknown): ConstructionSiteHit[] {
  const results = asObj(payload)?.results;
  if (!Array.isArray(results)) return [];
  const out: ConstructionSiteHit[] = [];
  for (const raw of results) {
    const r = asObj(raw);
    if (!r) continue;
    const type = str(r.type);
    if (!(CONSTRUCTION_DEPOT_TYPES as readonly string[]).includes(type)) continue;
    const name = str(r.name);
    const systemName = str(r.system_name);
    const marketId = parseMarketId(r.market_id);
    if (!name || !systemName || !marketId) continue;
    out.push({
      name,
      systemName,
      marketId,
      kind: type.startsWith("Planetary") ? "planetary" : "space",
      distanceLy: toLy(num(r.distance)),
      updatedAt: str(r.updated_at) || null,
    });
  }
  return out;
}

/** Display name for a commodity key such as `cmmcomposite` — "CMM Composite". */
export function commodityDisplayLabel(key: string): string {
  const norm = commodityNormKey(key);
  const id = resourceNeedId({ name: key });
  return COMMODITY_SPANSH_SLUGS_BY_NORM_KEY[norm]?.[0] ?? COMMODITY_SPANSH_SLUGS_BY_NORM_KEY[id]?.[0] ?? key;
}

/** Raven's `commodities` map (key → tons still needed) as rows, largest first, finished ones left out. */
export function siteNeedRows(commodities: unknown): SiteNeedRow[] {
  const map = asObj(commodities);
  if (!map) return [];
  const rows: SiteNeedRow[] = [];
  for (const [key, raw] of Object.entries(map)) {
    const tons = num(raw);
    if (tons == null || tons <= 0) continue;
    const commodityId = resourceNeedId({ name: key });
    if (!commodityId) continue;
    rows.push({ commodityId, label: commodityDisplayLabel(key), tons });
  }
  return rows.sort((a, b) => b.tons - a.tons || a.label.localeCompare(b.label));
}

/** The project in Raven's per-system list that is this market, if any. */
export function findRavenBuildId(projects: unknown, marketId: string): string | null {
  if (!Array.isArray(projects)) return null;
  for (const raw of projects) {
    const p = asObj(raw);
    if (!p || parseMarketId(p.marketId) !== marketId) continue;
    const id = str(p.buildId);
    if (id) return id;
  }
  return null;
}

/** A Raven `ProjectView` as what the app shows. */
export function parseRavenProject(project: unknown): SiteNeeds {
  const p = asObj(project);
  if (!p || !str(p.buildId)) return { found: false };
  const remaining = siteNeedRows(p.commodities);
  return {
    found: true,
    buildName: str(p.buildName),
    buildType: str(p.buildType),
    remaining,
    remainingTons: remaining.reduce((t, r) => t + r.tons, 0),
    totalTons: num(p.maxNeed),
    complete: p.complete === true,
    updatedAt: str(p.timestamp) || null,
    linkedCarriers: Array.isArray(p.linkedFC) ? p.linkedFC.length : 0,
  };
}
