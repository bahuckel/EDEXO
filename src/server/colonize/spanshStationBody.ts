import { parseMarketId } from "../../shared/colonize/marketId";
import { TtlCache } from "../../shared/colonize/ttlCache";
import { mapPool } from "../../shared/colonize/mapPool";
import type { MaterialBuyStationHit } from "../../shared/colonize/materialBuyIndexTypes";
import { fetchJson, spanshGate } from "./httpGate";

const SPANSH_STATION = "https://spansh.co.uk/api/station/";
const FETCH_TIMEOUT_MS = 12_000;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_MAX = 2500;
const FETCH_CONCURRENCY = 3;

/** `null` = Spansh had no body name for this station. */
const cache = new TtlCache<string, string | null>({ max: CACHE_MAX, ttlMs: CACHE_TTL_MS });

function normMarketId(marketId: string): string {
  return parseMarketId(marketId) ?? "";
}

/** Spansh `/api/station/{marketId}` → `record.body_name`. */
async function lookupSpanshStationBodyName(marketId: string): Promise<string | null> {
  const id = normMarketId(marketId);
  if (!id) return null;
  const hit = cache.get(id);
  if (hit !== undefined) return hit;

  let bodyName: string | null = null;
  try {
    const payload = (await fetchJson(spanshGate, `${SPANSH_STATION}${encodeURIComponent(id)}`, {
      timeoutMs: FETCH_TIMEOUT_MS,
    })) as { record?: { body_name?: string } };
    const raw = typeof payload.record?.body_name === "string" ? payload.record.body_name.trim() : "";
    bodyName = raw || null;
  } catch {
    bodyName = null;
  }

  cache.set(id, bodyName);
  return bodyName;
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

  await mapPool(pending, FETCH_CONCURRENCY, async (row) => {
    const bodyName = await lookupSpanshStationBodyName(row.marketId);
    if (bodyName) out[row.index] = { ...out[row.index]!, bodyName };
  });

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

  await mapPool(pending, FETCH_CONCURRENCY, async (rec) => {
    const bodyName = await lookupSpanshStationBodyName(rec.marketId.trim());
    if (bodyName) rec.bodyName = bodyName;
  });
}
