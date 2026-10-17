/**
 * How many systems each biological colour variant has been logged in, galaxy-wide and per region (1.2.19, plan F2,
 * owner 2026-10-17): the [RARE] mark and the rare-colour notice.
 *
 * Built from EDAstro's codex list (`docs/perf/calibration/build_variant_region_counts.py`, distinct systems per codex
 * id): 930 colour variants, 128 of them logged in 10 systems or fewer, 55 in exactly one. The colour is the row's own
 * label, turned into a codex id through EDSM's table ({@link codexVariantId}).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { ColourRarity } from "../shared/rareColour.js";
import type { CodexGapsDTO, CodexNearestDTO } from "../shared/types.js";
import { colourLabelOptions } from "../shared/codexLog.js";
import { distanceLy } from "../shared/spatialGates.js";
import { regionJoinKey } from "../shared/regionMap.js";
import { codexVariantId } from "./codexFirst.js";


interface Table {
  ids: string[];
  index: Map<string, number>;
  galaxy: number[];
  /** regionJoinKey → variant index → systems */
  regions: Map<string, Map<number, number>>;
}

let cache: { root: string; table: Table | null } | null = null;

function load(root: string): Table | null {
  if (cache?.root === root) return cache.table;
  let table: Table | null = null;
  try {
    const p = path.join(root, "data", "codex", "variant-region-systems.json");
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, "utf8")) as {
        ids?: string[];
        galaxy?: number[];
        regions?: Record<string, [number, number][]>;
      };
      if (Array.isArray(j.ids) && Array.isArray(j.galaxy)) {
        const regions = new Map<string, Map<number, number>>();
        for (const [name, cells] of Object.entries(j.regions ?? {})) regions.set(regionJoinKey(name), new Map(cells));
        table = { ids: j.ids, index: new Map(j.ids.map((id, i) => [id, i])), galaxy: j.galaxy, regions };
      }
    }
  } catch {
    table = null;
  }
  cache = { root, table };
  return table;
}

/**
 * Each possible colour of this row, with the systems it has been logged in. `colourLabel` is the row's label ("Teal",
 * or "Cyan or Orange"); nothing for an unknown colour ("(…)" or empty) or a colour the tables do not know.
 */
export function colourRarity(
  root: string,
  displayName: string,
  colourLabel: string | null | undefined,
  region: string | null,
): ColourRarity[] {
  const colours = colourLabelOptions(colourLabel);
  if (!colours.length) return [];
  const table = load(root);
  if (!table) return [];
  const regionCells = region ? table.regions.get(regionJoinKey(region)) : undefined;
  const out: ColourRarity[] = [];
  for (const colour of colours) {
    const id = codexVariantId(root, displayName, colour);
    const i = id ? table.index.get(id) : undefined;
    if (i == null) continue;
    out.push({
      colour,
      galaxySystems: table.galaxy[i]!,
      regionSystems: region ? (regionCells?.get(i) ?? 0) : null,
      region,
    });
  }
  return out;
}

type CodexGapEntry = CodexGapsDTO["gaps"][number];

/**
 * The colours logged in this region (by anyone, EDAstro's codex) that are not in the commander's codex here, rarest
 * here first (1.2.19, plan F2: "codex gaps by region"). `logged` holds `regionJoinKey|codex id`, the Codex map's set.
 * Null when the region is unknown to the table.
 */
export function codexRegionGaps(
  root: string,
  logged: ReadonlySet<string>,
  regionName: string,
  names: ReadonlyMap<string, string>,
): CodexGapsDTO | null {
  const table = load(root);
  if (!table) return null;
  const rk = regionJoinKey(regionName);
  const cells = table.regions.get(rk);
  if (!cells) return null;
  const gaps: CodexGapEntry[] = [];
  let have = 0;
  for (const [i, n] of cells) {
    const key = table.ids[i]!;
    if (logged.has(`${rk}|${key}`)) {
      have++;
      continue;
    }
    gaps.push({ key, name: names.get(key) ?? key, regionSystems: n, galaxySystems: table.galaxy[i]! });
  }
  gaps.sort((a, b) => a.regionSystems - b.regionSystems || a.galaxySystems - b.galaxySystems || a.name.localeCompare(b.name));
  return { region: regionName, logged: have, known: cells.size, gaps };
}

/** One region's sites file (`docs/perf/calibration/build_variant_region_sites.py`): data/codex/variant-sites/<key>.json.gz. */
interface RegionSites {
  small: number;
  systems: [string, string, number, number, number][];
  /** codex id → indices into `systems` */
  cells: Record<string, number[]>;
}

/** Read per region on the first click there: a few regions a session, each ~100-180 KB. */
const sitesCache = new Map<string, RegionSites | null>();

function loadSites(root: string, regionName: string): RegionSites | null {
  const region = regionJoinKey(regionName);
  const cacheKey = `${root}|${region}`;
  if (sitesCache.has(cacheKey)) return sitesCache.get(cacheKey)!;
  let file: RegionSites | null = null;
  try {
    const p = path.join(root, "data", "codex", "variant-sites", `${region}.json.gz`);
    if (existsSync(p)) {
      const j = JSON.parse(gunzipSync(readFileSync(p)).toString("utf8")) as Partial<RegionSites>;
      if (Array.isArray(j.systems) && j.cells) file = { small: j.small ?? 25, systems: j.systems, cells: j.cells };
    }
  } catch {
    file = null;
  }
  sitesCache.set(cacheKey, file);
  return file;
}

/**
 * The nearest system IN THIS REGION known to have this codex entry (owner, 2026-10-17: codex entries are per region,
 * so a system in another region is no use). Null when none is known there.
 */
export function nearestInRegion(
  root: string,
  regionName: string,
  key: string,
  from: { x: number; y: number; z: number },
): CodexNearestDTO | null {
  const f = loadSites(root, regionName);
  const list = f?.cells[key];
  if (!f || !list?.length) return null;
  let best: CodexNearestDTO | null = null;
  for (const i of list) {
    const [systemAddress, name, x, y, z] = f.systems[i]!;
    const d = distanceLy({ x, y, z }, from);
    if (!best || d < best.distanceLy) best = { systemAddress, name, x, y, z, distanceLy: d, known: list.length, complete: false };
  }
  // Every system it is logged in there when the region holds no more than the file keeps in full.
  const table = load(root);
  const idx = table?.index.get(key);
  const total = idx == null ? undefined : table!.regions.get(regionJoinKey(regionName))?.get(idx);
  if (best) best.complete = total != null && total <= f.small;
  return best;
}
