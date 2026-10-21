import { commodityMergeBucket } from "./commodityKey";

export type MaterialSearchNeed = {
  needId: string;
  needLabel: string;
};

/** Split a material search box on commas — `"Steel, Fish"` → `["Steel", "Fish"]`. */
function parseMaterialSearchQuery(query: string): string[] {
  const parts: string[] = [];
  for (const raw of query.split(",")) {
    const t = raw.trim();
    if (t) parts.push(t);
  }
  return parts;
}

export function isMultiMaterialSearch(query: string): boolean {
  return parseMaterialSearchQuery(query).length > 1;
}

export function materialNeedsFromQuery(query: string): MaterialSearchNeed[] {
  return parseMaterialSearchQuery(query).map((part) => ({
    needId: commodityMergeBucket(part),
    needLabel: part,
  }));
}

export function formatMaterialSearchLabel(query: string): string {
  const parts = parseMaterialSearchQuery(query);
  return parts.length ? parts.join(", ") : query.trim();
}

/** Align depot SKU ids with Search lookups (label-first merge bucket). */
export function resolveMaterialLookupNeed(needId: string, needLabel: string): MaterialSearchNeed {
  const label = needLabel.trim() || needId.trim();
  const fromLabel = materialNeedsFromQuery(label)[0];
  if (fromLabel?.needId) return fromLabel;
  const fromId = needId.trim() ? materialNeedsFromQuery(needId)[0] : null;
  if (fromId?.needId) return fromId;
  return { needId: needId.trim(), needLabel: label };
}

/** Prefer the same readable query string the Search tab uses (not journal `$Symbol_name`). */
export function planMaterialSearchQuery(needId: string, needLabel: string): string {
  const candidates: string[] = [];
  for (const raw of [needLabel, needId]) {
    const t = raw.trim();
    if (!t) continue;
    candidates.push(t);
    const fromQ = materialNeedsFromQuery(t)[0];
    if (fromQ?.needLabel?.trim()) candidates.push(fromQ.needLabel.trim());
  }
  const readable = candidates.find((c) => !c.startsWith("$") && /\s/.test(c));
  if (readable) return readable;
  const plain = candidates.find((c) => !c.startsWith("$") && !c.includes("_name"));
  if (plain) return plain;
  return resolveMaterialLookupNeed(needId, needLabel).needLabel || needLabel.trim() || needId.trim();
}
