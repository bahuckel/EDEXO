import { resourceNeedId } from "./commodityKey";
import type { DepotSnapshot, ResourceRow, ShipCargoLine } from "./types";

/** Copy cargo for allocation — each ton on the ship can only satisfy one depot gap. */
export function makeCargoPool(cargoByKey: Map<string, number>): Map<string, number> {
  return new Map(cargoByKey);
}

/**
 * Depot gap minus cargo, consuming from a shared pool (call in stable depot order).
 */
export function tonsStillNeededWithPool(row: ResourceRow, cargoPool: Map<string, number>): number {
  const gap = Math.max(0, row.required - row.provided);
  if (gap <= 0) return 0;
  const bucket = resourceNeedId(row);
  if (!bucket) return gap;
  const onHand = cargoPool.get(bucket) ?? 0;
  const use = Math.min(gap, onHand);
  if (use > 0) cargoPool.set(bucket, Math.max(0, onHand - use));
  return Math.max(0, gap - use);
}

/** Tons still to deliver for one resource row (depot gap minus applicable cargo on hand). */
export function tonsStillNeeded(row: ResourceRow, cargoByKey: Map<string, number>): number {
  return tonsStillNeededWithPool(row, makeCargoPool(cargoByKey));
}

export function buildCargoMap(lines: ShipCargoLine[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of lines) {
    const b = resourceNeedId(c);
    if (!b) continue;
    m.set(b, (m.get(b) ?? 0) + c.count);
  }
  return m;
}

/** Combined missing lines across depots with total tons still needed. */
export function combinedMissingWithQty(
  depots: DepotSnapshot[],
  cargoByKey: Map<string, number>,
): { id: string; name: string; nameLocalised: string; quantityTons: number }[] {
  const acc = new Map<string, { name: string; nameLocalised: string; quantityTons: number }>();
  const cargoPool = makeCargoPool(cargoByKey);
  for (const d of depots) {
    for (const r of d.resources) {
      const need = tonsStillNeededWithPool(r, cargoPool);
      if (need <= 0) continue;
      const id = resourceNeedId(r);
      if (!id) continue;
      const cur = acc.get(id);
      if (!cur) {
        acc.set(id, { name: r.name, nameLocalised: r.nameLocalised || r.name, quantityTons: need });
      } else {
        cur.quantityTons += need;
      }
    }
  }
  return [...acc.entries()].map(([id, v]) => ({ id, ...v }));
}

/** Per-depot missing basket lines. */
export function depotMissingWithQty(
  d: DepotSnapshot,
  cargoByKey: Map<string, number>,
): { id: string; name: string; nameLocalised: string; quantityTons: number }[] {
  const out: { id: string; name: string; nameLocalised: string; quantityTons: number }[] = [];
  const cargoPool = makeCargoPool(cargoByKey);
  for (const r of d.resources) {
    const need = tonsStillNeededWithPool(r, cargoPool);
    if (need <= 0) continue;
    const id = resourceNeedId(r);
    if (!id) continue;
    out.push({ id, name: r.name, nameLocalised: r.nameLocalised || r.name, quantityTons: need });
  }
  return out;
}
