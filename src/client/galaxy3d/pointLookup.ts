/**
 * What the hover card and the side panel look a marker up in, and the two lookups they share: a point of
 * an extra layer, and a NavRoute marker. Moved out of GalaxyMap3D.tsx (audit 2026-10-22).
 */
import type { CodexMapSystemDTO } from "@shared/dto/codexMap.js";
import type { ExpeditionFieldDTO } from "@shared/dto/expedition";
import { GALAXY_LAYERS, layerPointText, type GalaxyLayerDTO, type GalaxyLayerKind } from "@shared/galaxyLayers.js";
import type { GalaxyNextDTO, GalaxyRouteDTO } from "@shared/types";
import type { GalaxySearchApplied } from "../GalaxySearchPanel";
import type { NavRouteSystemDTO } from "../GalaxyNavRoutePanel";
import type { JumpRow } from "./jumpRow";
import type { MineRow, SpanshFindHit } from "./mapConstants";
import type { NeutronMark } from "./neutronMarks";

/** A stop of the Targets plan, numbered from 1. */
export type PlanStop = NonNullable<GalaxyNextDTO["plan"]>["stops"][number] & { n: number };

/** The map's state the hover card and the side panel read, all of it kept by GalaxyMap3D. */
export interface MapLookups {
  extraData: Partial<Record<GalaxyLayerKind, GalaxyLayerDTO>>;
  route: GalaxyRouteDTO | null;
  navShown: NavRouteSystemDTO[];
  mine: Map<string, MineRow>;
  planStops: Map<string, PlanStop>;
  jumpById: Map<string, JumpRow>;
  expByKey: Map<string, ExpeditionFieldDTO["boxels"][number]>;
  expField: ExpeditionFieldDTO | null;
  spanshPicked: Map<string, SpanshFindHit>;
  searchHits: Map<string, GalaxySearchApplied["hits"][number]>;
  codexSystems: Map<string, CodexMapSystemDTO>;
  /** The neutron route's stops; a marker's id is its index. */
  neutronHops: NeutronMark[];
}

/** A point of one of the extra layers (`x-poi`, `x-ggg` …) by its index. */
export function extraPoint(
  extraData: Partial<Record<GalaxyLayerKind, GalaxyLayerDTO>>,
  layer: string,
  id: string,
) {
  if (!layer.startsWith("x-")) return null;
  const kind = layer.slice(2) as GalaxyLayerKind;
  const d = extraData[kind];
  const p = d?.points[Number(id)];
  const meta = GALAXY_LAYERS.find((l) => l.kind === kind);
  const unconfirmed = !!d?.unconfirmed?.includes(Number(id));
  return d && p && meta ? { p, meta, unconfirmed, ...layerPointText(d, p) } : null;
}

/** A NavRoute marker (the finder's, or the plotted route's unvisited ones) by its address. */
export function navPoint(route: GalaxyRouteDTO | null, navShown: NavRouteSystemDTO[], layer: string, id: string) {
  if (layer === "navUnvisited") return route?.navRoute.find((s) => String(s.address) === id) ?? null;
  if (layer === "navroute") {
    const s = navShown.find((x) => String(x.address) === id);
    return s
      ? {
          address: s.address,
          name: s.name,
          starClass: s.starClass,
          x: s.pos[0],
          y: s.pos[1],
          z: s.pos[2],
          visited: !!s.visited,
        }
      : null;
  }
  return null;
}
