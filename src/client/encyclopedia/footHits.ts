/**
 * Which of the commander's foot-catalogue finds belong to a species (moved out of EncyclopediaModal.tsx,
 * audit 2026-10-22).
 */
import type { FootScannedEntry, SpeciesEntry } from "@shared/types";

function normLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]*\)\s*/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

/** A catalogue row with its labels normalised once (they were normalised again for every species). */
interface NormFoot {
  f: FootScannedEntry;
  variant: string;
  genus: string;
  label: string;
}

export function normFoot(catalog: FootScannedEntry[]): NormFoot[] {
  return catalog.map((f) => ({
    f,
    variant: normLabel(f.variantLocalised || ""),
    genus: (f.genusLocalised ?? "").trim().toLowerCase(),
    label: normLabel(f.variantLocalised || f.speciesLocalised || ""),
  }));
}

export function footHitsForEntry(entry: SpeciesEntry, catalog: NormFoot[]): FootScannedEntry[] {
  const nid = entry.id;
  const ns = normLabel(entry.displayName);
  const genus = entry.genus?.trim().toLowerCase() ?? "";
  const out: FootScannedEntry[] = [];
  for (const n of catalog) {
    const f = n.f;
    if (
      f.speciesEntryId === nid ||
      f.dbProbableSpeciesId === nid ||
      (n.variant === ns && ns.length > 2) ||
      (genus && n.genus === genus && n.label && (ns.includes(n.label) || n.label.includes(ns)))
    ) {
      out.push(f);
    }
  }
  return out;
}
