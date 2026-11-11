import type { BodyExoState, GenusEvidence, GenusHint } from "./types.js";

/**
 * The genera a body's own DSS named, as evidence: `own-dss`, or `spansh` for a body built from a Spansh lookup (its DSS
 * as someone else uploaded it). Null before a DSS. A twin moon's list (`siblingGenusHints`) never comes through here.
 */
export function ownGenusEvidence(b: Pick<BodyExoState, "genusHints" | "remote">): GenusEvidence | null {
  if (!b.genusHints) return null;
  return { source: b.remote ? "spansh" : "own-dss", genera: b.genusHints };
}

/** One genus a sample or codex entry named on this body. */
export function sampleGenusEvidence(hint: GenusHint): GenusEvidence {
  return { source: "sample", genera: [hint] };
}

/**
 * The genera the candidates are filtered to, or null for no filter. Exhaustive on `source`: a new kind of evidence
 * has to say here whether it filters, and a twin moon's never does.
 */
export function filteringGenera(e: GenusEvidence | null | undefined): GenusHint[] | null {
  if (!e) return null;
  switch (e.source) {
    case "own-dss":
    case "spansh":
    case "sample":
      return e.genera;
    case "sibling-dss":
      return null;
    default: {
      const never: never = e.source;
      throw new Error(`genus evidence of an unknown source: ${String(never)}`);
    }
  }
}

/** A DSS list as this body's own (a probe or a test that holds the list itself); null stays null. */
export function ownDssEvidence(genera: GenusHint[] | null | undefined): GenusEvidence | null {
  return genera ? { source: "own-dss", genera } : null;
}
