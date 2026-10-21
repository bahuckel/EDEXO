/** Phase 9 look-ups: find a construction site on Spansh, then ask Raven Colonial what it needs. */
import {
  CONSTRUCTION_DEPOT_TYPES,
  findRavenBuildId,
  parseConstructionSiteHits,
  parseRavenProject,
  RAVEN_COLONIAL_API,
  type ConstructionSiteHit,
  type SiteNeeds,
} from "../../shared/colonize/siteLookup";
import { normSystemName } from "../../shared/colonize/stationFilter";
import { TtlCache } from "../../shared/colonize/ttlCache";
import { fetchJson, HttpStatusError, ravenGate, spanshGate } from "./httpGate";
import { resolveSpanshReferenceSystem } from "./galaxySystemCoords";

const SPANSH_STATIONS_SEARCH = "https://spansh.co.uk/api/stations/search";
const SEARCH_SIZE = 25;
const TIMEOUT_MS = 20_000;

/** A project's needs change with every delivery; five minutes keeps repeat clicks off the network. */
const NEEDS_TTL_MS = 5 * 60 * 1000;
const needsCache = new TtlCache<string, SiteNeeds>({ max: 200, ttlMs: NEEDS_TTL_MS });

/**
 * Construction sites whose name matches, best match first. Spansh matches whole words and word
 * prefixes ("Titi" finds "Titius Hub"). With a reference system each hit carries its distance.
 */
export async function searchConstructionSites(
  query: string,
  referenceSystem?: string,
): Promise<ConstructionSiteHit[]> {
  const q = query.trim();
  if (!q) return [];
  const body: Record<string, unknown> = {
    filters: { name: { value: q }, type: { value: [...CONSTRUCTION_DEPOT_TYPES] } },
    size: SEARCH_SIZE,
  };
  // Spansh matches reference_system by its own spelling: the journal's casing can differ.
  if (referenceSystem?.trim()) body.reference_system = await resolveSpanshReferenceSystem(referenceSystem.trim());
  return parseConstructionSiteHits(
    await fetchJson(spanshGate, SPANSH_STATIONS_SEARCH, { timeoutMs: TIMEOUT_MS, body }),
  );
}

/** 404 is Raven's answer for "no such project"; anything else is a real failure. */
async function ravenGet(path: string): Promise<unknown | null> {
  try {
    return await fetchJson(ravenGate, `${RAVEN_COLONIAL_API}${path}`, { timeoutMs: TIMEOUT_MS });
  } catch (e) {
    if (e instanceof HttpStatusError && e.status === 404) return null;
    throw e;
  }
}

/**
 * What a site still needs, if anyone registered it on Raven Colonial.
 *
 * Looked up by system *name*, not id64: an id64 can exceed 2^53, and a JSON number above that
 * has already lost its low digits by the time anything reads it.
 */
export async function lookupSiteNeeds(systemName: string, marketId: string): Promise<SiteNeeds> {
  const key = `${normSystemName(systemName)}|${marketId}`;
  const cached = needsCache.get(key);
  if (cached !== undefined) return cached;

  const projects = await ravenGet(`/api/System/${encodeURIComponent(systemName.trim())}`);
  const buildId = findRavenBuildId(projects, marketId);
  const needs: SiteNeeds = buildId
    ? parseRavenProject(await ravenGet(`/api/project/${encodeURIComponent(buildId)}`))
    : { found: false };
  needsCache.set(key, needs);
  return needs;
}
