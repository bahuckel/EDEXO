import { resourceNeedId } from "./commodityKey";
import type { DepotSnapshot, ResourceRow } from "./types";

/** Sum requirements across depot snapshots (multiple stations may need same commodity). */
export function combineResources(depots: DepotSnapshot[]): ResourceRow[] {
  type Acc = { name: string; nameLocalised: string; required: number; provided: number; payParts: (number | null)[] };
  const map = new Map<string, Acc>();
  for (const d of depots) {
    for (const row of d.resources) {
      const key = resourceNeedId(row);
      if (!key) continue;
      let acc = map.get(key);
      if (!acc) {
        acc = { name: row.name, nameLocalised: row.nameLocalised || row.name, required: 0, provided: 0, payParts: [] };
        map.set(key, acc);
      }
      acc.required += row.required;
      acc.provided += row.provided;
      acc.payParts.push(row.payment);
    }
  }
  return Array.from(map.values()).map((a) => ({
    name: a.name,
    nameLocalised: a.nameLocalised,
    required: a.required,
    provided: a.provided,
    payment: a.payParts.every((p) => p != null) ? a.payParts.reduce((s, p) => s + (p ?? 0), 0) : null,
  }));
}
