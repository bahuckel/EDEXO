/**
 * The Encyclopedia's species list and field guide, fetched and kept for the app's life (moved out of
 * EncyclopediaModal.tsx, audit 2026-10-22). Only the modal imports this module, so it still loads, and
 * makes its two requests, with the modal's chunk.
 */
import type { EncyclopediaSpeciesRowDTO } from "@shared/types";
import type { FieldGuideDTO, GuideGenus, GuideSpecies } from "@shared/fieldGuide";

export type GuideMaps = { species: Map<string, GuideSpecies>; genera: Map<string, GuideGenus> };

/*
  The Encyclopedia's two requests, made when this chunk loads — which is the idle prefetch a moment
  after start (SharedModals `prefetchMenuModals`) — so the first open draws at once instead of
  waiting ~100 ms for its data. Every open asks again and updates the list if anything changed.
*/
export let rowsCache: EncyclopediaSpeciesRowDTO[] | null = null;
export let guideCache: GuideMaps | null = null;

export async function loadRows(): Promise<EncyclopediaSpeciesRowDTO[]> {
  const r = await fetch("/api/species-encyclopedia");
  const j = (await r.json().catch(() => null)) as {
    species?: EncyclopediaSpeciesRowDTO[];
    error?: string;
  } | null;
  if (!r.ok) throw new Error(j?.error || r.statusText);
  if (!j?.species) throw new Error("Invalid response");
  rowsCache = j.species;
  return j.species;
}

export async function loadGuide(): Promise<GuideMaps | null> {
  const r = await fetch("/api/field-guide");
  if (!r.ok) return null;
  const j = (await r.json()) as FieldGuideDTO;
  if (!j?.genera) return null;
  guideCache = {
    species: new Map(j.genera.flatMap((g) => g.species.map((s) => [s.id, s] as const))),
    genera: new Map(j.genera.map((g) => [g.id, g] as const)),
  };
  return guideCache;
}

if (typeof window !== "undefined") {
  void loadRows().catch(() => {});
  void loadGuide().catch(() => {});
}
