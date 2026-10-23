/**
 * A species' spawn conditions checked against the compared body, as the card's coloured rows (moved
 * out of EncyclopediaModal.tsx, audit 2026-10-22).
 */
import type { SpeciesEntry } from "@shared/types";
import { useEffect, useMemo, useState } from "react";
import {
  applyCardVerdicts,
  buildEncyclopediaSpawnConditionCards,
  type EncyclopediaCardVerdict,
  type EncyclopediaSpawnTier,
} from "@shared/speciesSpawnConditionCards";
import type { EncyclopediaSpawnCompare } from "./types";

function spawnTierCssSuffix(tier: EncyclopediaSpawnTier): string {
  switch (tier) {
    case "blue":
      return "blue";
    case "red":
      return "red";
    case "yellow":
      return "yellow";
    default:
      return "neutral";
  }
}

export type CardVerdicts = Record<string, Record<string, EncyclopediaCardVerdict>>;

/**
 * The matcher's grade of every species' cards on the compared body (plan 1.10): one request per body,
 * null until it answers (the cards show their own tiers meanwhile) or when there is no body.
 */
export function useCardVerdicts(spawnCompare: EncyclopediaSpawnCompare | null): CardVerdicts | null {
  const [v, setV] = useState<CardVerdicts | null>(null);
  // Each snapshot brings new objects for the same body: keyed on the content, not the identity.
  const body = spawnCompare?.scan
    ? JSON.stringify({ scan: spawnCompare.scan, est: spawnCompare.estimatedSurfaceTempK, ctx: spawnCompare.speciesMatchContext })
    : null;
  useEffect(() => {
    setV(null);
    if (!body) return;
    const ac = new AbortController();
    void fetch("/api/encyclopedia/card-verdicts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: ac.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { verdicts?: CardVerdicts } | null) => {
        if (!ac.signal.aborted) setV(j?.verdicts ?? null);
      })
      .catch(() => {
        /* the cards keep their own tiers */
      });
    return () => ac.abort();
  }, [body]);
  return v;
}

export function EncyclopediaSpeciesConditions({
  entry,
  spawnCompare,
  verdicts,
}: {
  entry: SpeciesEntry;
  spawnCompare: EncyclopediaSpawnCompare | null;
  verdicts: Record<string, EncyclopediaCardVerdict> | null;
}) {
  const cards = useMemo(
    () =>
      applyCardVerdicts(
        buildEncyclopediaSpawnConditionCards({
          entry,
          scan: spawnCompare?.scan ?? null,
          estimatedSurfaceTempK: spawnCompare?.estimatedSurfaceTempK ?? null,
          speciesMatchContext: spawnCompare?.speciesMatchContext ?? null,
        }),
        verdicts,
      ),
    [entry, spawnCompare?.scan, spawnCompare?.estimatedSurfaceTempK, spawnCompare?.speciesMatchContext, verdicts],
  );

  // The field-guide layout (owner, 2026-09-29): one row per condition — what the species needs, and
  // how the body being compared fares, coloured blue (matches) / yellow (unsure) / red (fails).
  return (
    <dl className="fg-req fg-req--conditions">
      {cards.map((card) => (
        <div
          key={card.id}
          className={`fg-req-row fg-req-row--${spawnTierCssSuffix(card.tier)}`}
          title={card.lines.join("\n")}
        >
          <dt>{card.label}</dt>
          <dd>{card.lines.filter(Boolean).join(" · ") || "—"}</dd>
          {spawnCompare ? <dd className="fg-req-body">{card.caption}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
