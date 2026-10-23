import { parseMarketId } from "../../shared/colonize/marketId";
import { TtlCache } from "../../shared/colonize/ttlCache";
import type { MaterialBuyStationHit } from "../../shared/colonize/materialBuyIndexTypes";
import { fetchSpanshStationsByMarketIds } from "./spanshStationMarket";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 2500;

/** `null` = Spansh had no body name for this station. */
const cache = new TtlCache<string, string | null>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });

function normMarketId(marketId: string): string {
  return parseMarketId(marketId) ?? "";
}

export async function enrichHitsWithBodyNames(
  hits: MaterialBuyStationHit[],
  maxFetches = 32,
): Promise<MaterialBuyStationHit[]> {
  const pending: Array<{ index: number; marketId: string }> = [];
  const out = hits.map((h) => ({ ...h }));
  for (let i = 0; i < out.length && pending.length < maxFetches; i++) {
    const h = out[i]!;
    if (h.bodyName?.trim()) continue;
    const mid = h.marketId?.trim();
    if (!mid) continue;
    pending.push({ index: i, marketId: mid });
  }
  if (!pending.length) return out;

  const names = await bodyNamesFor(pending.map((p) => p.marketId));
  for (const row of pending) {
    const bodyName = names.get(normMarketId(row.marketId));
    if (bodyName) out[row.index] = { ...out[row.index]!, bodyName };
  }
  return out;
}

type BodyCarrier = { marketId: string; bodyName?: string | null };

/** Mutates records missing `bodyName` when Spansh has one. */
export async function enrichRecordsWithBodyNames<T extends BodyCarrier>(
  records: Iterable<T>,
  maxFetches = 48,
): Promise<void> {
  const pending: T[] = [];
  for (const rec of records) {
    if (rec.bodyName?.trim()) continue;
    if (!rec.marketId?.trim()) continue;
    pending.push(rec);
    if (pending.length >= maxFetches) break;
  }
  if (!pending.length) return;

  const names = await bodyNamesFor(pending.map((r) => r.marketId.trim()));
  for (const rec of pending) {
    const bodyName = names.get(normMarketId(rec.marketId));
    if (bodyName) rec.bodyName = bodyName;
  }
}

/**
 * Body names for many stations: cached ones at once, the rest in one Spansh search by market id (was one request per
 * station, three at a time; R2, 2026-10-23). A failed search leaves them uncached, to be asked again.
 */
async function bodyNamesFor(marketIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ask: string[] = [];
  for (const raw of marketIds) {
    const id = normMarketId(raw);
    if (!id) continue;
    const hit = cache.get(id);
    if (hit === undefined) ask.push(id);
    else if (hit) out.set(id, hit);
  }
  if (!ask.length) return out;
  let rows: Awaited<ReturnType<typeof fetchSpanshStationsByMarketIds>>;
  try {
    rows = await fetchSpanshStationsByMarketIds(ask);
  } catch {
    return out;
  }
  for (const id of ask) {
    const name = typeof rows.get(id)?.body_name === "string" ? rows.get(id)!.body_name!.trim() : "";
    cache.set(id, name || null);
    if (name) out.set(id, name);
  }
  return out;
}
