/**
 * A Spansh route from a file (owner, 2026-11-04: "I dont see a way to import a json for the spansh route and have it
 * shown in the edexo galmap"). The drawer's link reads a result while Spansh still has it; a file saved from Spansh
 * works after it has been deleted, and for a route planned on another PC.
 *
 * Two kinds of file:
 * - JSON: Spansh's result as its results page gets it (`/api/results/<job>`: `{ status, job, parameters, result }`),
 *   or the `result` alone (an array of systems, or `{ system_jumps }` / `{ jumps }`). Read by parseSpanshResult as a
 *   link's answer is, so every planner's shape that works from a link works from a file.
 * - CSV: Spansh's "Download as CSV". One row per system (plotters) or per body (exobiology, road to riches), headers
 *   as Spansh writes them; the columns are found by name, so their order does not matter. The CSV has no coordinates:
 *   each system is placed from EDEXO's own data first, then EDSM and Spansh (colonize/galaxySystemCoords.ts, the
 *   look-up the depot planner uses, cached on disk). A system nobody can place is left out and the answer says so.
 *
 * The route gets a job id made from the file's content (the same file twice is one kept route), shaped as Spansh's so
 * "Kept routes", forget and fly treat it as any other; its `url` is empty (there is no Spansh page to open).
 */
import { createHash } from "node:crypto";
import type { SpanshRouteAnswer } from "../shared/dto/spanshRoute.js";
import { parseSpanshResult, spanshJobFromText } from "./spanshRoute.js";

type Coords = [number, number, number];
/** Coordinates by system name, as `resolveCoordMapForSystems` keyed by normalised name; injected for the tests. */
export type CoordsLookup = (names: string[]) => Promise<Map<string, Coords>>;

/** A UUID-shaped id from the file's bytes, so the routes' job handling takes it unchanged. */
export function importJobId(text: string): string {
  const h = createHash("sha1").update(text).digest("hex").toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** One CSV line into fields (Spansh quotes every field; doubled quotes inside). */
function csvFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

const yes = (v: string | undefined): boolean => /^(yes|true|1)$/i.test(v ?? "");
const numOr = (v: string | undefined): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
};

/**
 * Spansh's CSV as the JSON result its page would have had, with coordinates from `place` (normalised name → x/y/z);
 * null when the headers are no Spansh route's. `missing` collects the systems that could not be placed.
 */
export function spanshCsvAsResult(
  text: string,
  place: (name: string) => Coords | undefined,
  missing: string[],
): { result: unknown; parameters: Record<string, unknown> } | null {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const head = csvFields(lines[0]!).map((h) => h.toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const iSys = col("system name", "system");
  if (iSys < 0) return null;
  const iBody = col("body name");
  const iSub = col("body subtype", "subtype");
  const iDist = col("distance to arrival");
  const iLandmark = col("landmark subtype", "landmark");
  const iValue = col("landmark value", "value");
  const iScan = col("estimated scan value");
  const iMap = col("estimated mapping value");
  const iJumps = col("jumps");
  const iNeutron = col("neutron star", "neutron");
  const iRefuel = col("refuel", "restock tritium", "must refuel");
  const iInject = col("must inject", "inject");
  const iTritium = head.findIndex((h) => h.includes("tritium"));
  const ix = col("x");
  const iy = col("y");
  const iz = col("z");
  const rows = lines.slice(1, 50_001).map(csvFields);
  const at = (r: string[], i: number) => (i >= 0 ? r[i] : undefined);

  const coordsOf = (r: string[]): Coords | undefined => {
    const x = numOr(at(r, ix));
    const y = numOr(at(r, iy));
    const z = numOr(at(r, iz));
    return x != null && y != null && z != null ? [x, y, z] : place(r[iSys]!);
  };
  const placed = (r: string[]) => {
    const c = coordsOf(r);
    if (!c) {
      if (!missing.includes(r[iSys]!)) missing.push(r[iSys]!);
      return null;
    }
    return { x: c[0], y: c[1], z: c[2] };
  };

  // Body rows: exobiology (species per body) or road to riches (scan and mapping values), grouped by system in order.
  if (iBody >= 0) {
    const bio = iLandmark >= 0;
    const systems: Record<string, unknown>[] = [];
    let lastName = "";
    let cur: { name: string; sys: Record<string, unknown>; bodies: Map<string, Record<string, unknown>> } | null = null;
    for (const r of rows) {
      // A body row may leave the system blank under the first one of it.
      const name = r[iSys] || lastName;
      if (!name) continue;
      r[iSys] = lastName = name;
      if (!cur || cur.name !== name) {
        const p = placed(r);
        cur = { name, sys: { name, ...(p ?? {}), jumps: numOr(at(r, iJumps)) ?? 0, bodies: [] }, bodies: new Map() };
        if (p) systems.push(cur.sys);
      }
      const bodyName = at(r, iBody);
      if (!bodyName) continue;
      let body = cur.bodies.get(bodyName);
      if (!body) {
        body = {
          name: bodyName,
          subtype: at(r, iSub) ?? null,
          distance_to_arrival: numOr(at(r, iDist)),
          ...(bio
            ? { landmarks: [] as unknown[] }
            : { estimated_scan_value: numOr(at(r, iScan)) ?? 0, estimated_mapping_value: numOr(at(r, iMap)) ?? 0 }),
        };
        cur.bodies.set(bodyName, body);
        (cur.sys.bodies as unknown[]).push(body);
      }
      const species = at(r, iLandmark);
      if (bio && species) (body.landmarks as unknown[]).push({ subtype: species, value: numOr(at(r, iValue)) ?? 0 });
    }
    return { result: systems, parameters: {} };
  }

  // System rows: the neutron plotter (jumps per stop), the fleet carrier (tritium) or the galaxy plotter.
  const stops = rows.filter((r) => r[iSys]).map((r) => ({ r, p: placed(r) }));
  const kept = stops.filter((s) => s.p);
  if (iJumps >= 0 && iTritium < 0) {
    return {
      result: { system_jumps: kept.map(({ r, p }) => ({ system: r[iSys], ...p, jumps: numOr(at(r, iJumps)) ?? 0, neutron_star: yes(at(r, iNeutron)) })) },
      parameters: {},
    };
  }
  const jumps = kept.map(({ r, p }) => ({
    name: r[iSys],
    ...p,
    has_neutron: yes(at(r, iNeutron)),
    must_refuel: yes(at(r, iRefuel)),
    must_inject: yes(at(r, iInject)),
  }));
  return { result: iTritium >= 0 ? { jumps, tritium_stored: 0 } : { jumps }, parameters: {} };
}

/** A file's route, or why not. `lookup` places a CSV's systems (normalised name → x/y/z). */
export async function importSpanshRouteFile(fileName: string, text: string, lookup: CoordsLookup, norm: (s: string) => string): Promise<SpanshRouteAnswer> {
  const body = String(text ?? "");
  if (!body.trim()) return { state: "error", error: "That file is empty." };
  const trimmed = body.replace(/^\uFEFF/, "").trimStart();
  let data: unknown;
  let note: string | undefined;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      data = JSON.parse(trimmed);
    } catch {
      return { state: "error", error: "That file is not valid JSON." };
    }
    // The result alone (no `status` / `result` wrapper): wrap it as the results page has it.
    if (Array.isArray(data)) data = { result: data };
    else if (data && typeof data === "object" && !("result" in data)) data = { result: data };
  } else {
    // A CSV: every system name first, placed in one look-up.
    const names = new Set<string>();
    const lines = trimmed.split(/\r?\n/);
    const head = csvFields(lines[0] ?? "").map((h) => h.toLowerCase());
    const iSys = head.findIndex((h) => h === "system name" || h === "system");
    if (iSys < 0) return { state: "error", error: "Not a Spansh route: a Spansh CSV starts with a \"System Name\" column." };
    for (const l of lines.slice(1, 50_001)) {
      const n = csvFields(l)[iSys];
      if (n) names.add(n);
    }
    const coords = await lookup([...names]);
    const missing: string[] = [];
    const asResult = spanshCsvAsResult(trimmed, (n) => coords.get(norm(n)), missing);
    if (!asResult) return { state: "error", error: "Not a Spansh route EDEXO can read." };
    data = asResult;
    if (missing.length)
      note = `${missing.length} system${missing.length === 1 ? "" : "s"} could not be placed on the map and ${missing.length === 1 ? "is" : "are"} left out: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""}.`;
  }
  const d = data as { job?: unknown };
  const job = (typeof d.job === "string" ? spanshJobFromText(d.job) : null) ?? importJobId(body);
  const route = parseSpanshResult(job, data);
  if (!route) return { state: "error", error: `${fileName || "That file"} is not a Spansh route EDEXO can read.` };
  // A file has no Spansh page to open unless it carried Spansh's own job id.
  if (typeof d.job !== "string") route.url = "";
  // A CSV or a bare result has no parameters: a plotter's end is its last stop (an exobiology or riches route may loop).
  if (!route.to && route.stops.length > 1 && route.kind !== "exobiology" && route.kind !== "riches")
    route.to = route.stops[route.stops.length - 1]!.name;
  return { state: "ok", route, ...(note ? { note } : {}) };
}
