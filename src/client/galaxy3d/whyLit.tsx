/**
 * Why a system dot is lit, for the side panel (moved out of GalaxyMap3D.tsx, audit 2026-10-22).
 */
import { GALAXY_LAYERS, layerPointText, type GalaxyLayerDTO, type GalaxyLayerKind } from "@shared/galaxyLayers.js";
import { BODY_TRAITS, STAR_CLASSES } from "@shared/galaxyTraits.js";
import type { GalaxyFilterState } from "../GalaxyFilterPanel";

export interface WhyLitContext {
  filter: GalaxyFilterState;
  /** Read when the panel draws, as before: the Filter drawer's last answer. */
  filterAnswer: { current: { query: string; bits: Uint8Array; matched: number } | null };
  extraData: Partial<Record<GalaxyLayerKind, GalaxyLayerDTO>>;
  extraOn: Record<GalaxyLayerKind, boolean>;
}

/*
  Why a system dot is lit (owner, 2026-10-06: "if I choose to see O-type stars, I click on a dot …
  someone running multiple layers, it might be useful if the side card tells him why"): the Filter it
  matches, and every switched-on layer with a point on it.
*/
export function filterTerms(filter: GalaxyFilterState): string {
  const star = (k: string) => STAR_CLASSES.find((t) => t.key === k)?.label ?? k;
  const body = (k: string) => BODY_TRAITS.find((t) => t.key === k)?.label ?? k;
  const terms = [
    ...filter.genera,
    ...filter.species,
    ...filter.mainStars.map((k) => `main star ${star(k)}`),
    ...filter.stars.map((k) => `a ${star(k)} star`),
    ...filter.planets.map(body),
    ...filter.features.map(body),
  ];
  return terms.length > 4 ? `${terms.slice(0, 4).join(", ")} +${terms.length - 4}` : terms.join(", ");
}

export function whyLit(
  s: { ordinal: number; x: number; y: number; z: number },
  { filter, filterAnswer, extraData, extraOn }: WhyLitContext,
) {
  const lines: { text: string; unconfirmed?: boolean }[] = [];
  const fa = filterAnswer.current;
  if (fa && ((fa.bits[s.ordinal >> 3] ?? 0) >> (s.ordinal & 7)) & 1)
    lines.push({ text: `Matches your filter: ${filterTerms(filter)}` });
  for (const l of GALAXY_LAYERS) {
    const d = extraData[l.kind];
    if (!extraOn[l.kind] || !d) continue;
    const guess = new Set(d.unconfirmed ?? []);
    d.points.forEach((p, i) => {
      if (Math.abs(p[0] - s.x) > 0.6 || Math.abs(p[1] - s.y) > 0.6 || Math.abs(p[2] - s.z) > 0.6) return;
      const { detail } = layerPointText(d, p);
      lines.push({
        text: `${l.label}: ${p[3]}${detail ? ` — ${detail}` : ""}`,
        unconfirmed: guess.has(i),
      });
    });
  }
  return lines.length ? (
    <ul className="g3d-why" aria-label="Why it is lit">
      {lines.map((x, i) => (
        <li key={i}>
          {x.unconfirmed ? <span className="g3d-unconfirmed">unconfirmed</span> : null} {x.text}
        </li>
      ))}
    </ul>
  ) : null;
}
