/**
 * Routes planned on Spansh, brought into EDEXO (plan 1.3.6 S-1, owner 2026-11-02). The commander pastes a Spansh
 * results link or job id; this asks Spansh for that one result (`/api/results/<job>`, the same JSON its own pages
 * read) and turns its five shapes into one {@link SpanshRouteDTO}:
 *
 * - exobiology: `result[]` systems with bodies and their `landmarks` (species, value)
 * - riches (road to riches and its ammonia / earth-like / rocky and metal-rich variants): the same, bodies valued by
 *   `estimated_mapping_value` + `estimated_scan_value`
 * - neutron: `result.system_jumps[]`, `neutron_star` per stop
 * - galaxy plotter: `result.jumps[]`, one per jump, `has_neutron` / `must_refuel` / `must_inject`
 * - fleet carrier: `result.jumps[]` with `tritium_stored` on the result
 *
 * Flying it reuses the neutron route's live follow (neutronLive.ts): the next stop on the clipboard after each jump
 * onto one, the HUD's next-jump line, the galaxy map's line. A carrier route follows the commander's carrier instead of
 * the ship (owner, 2026-11-02): the next stop is copied when the carrier arrives at one, for its own galaxy map.
 * Nothing is fetched until a link is pasted.
 */
import type { LiveHop } from "./neutronLive.js";
import type { SpanshRouteAnswer, SpanshRouteBodyDTO, SpanshRouteDTO, SpanshRouteKind, SpanshRouteStopDTO } from "../shared/dto/spanshRoute.js";
import { APP_USER_AGENT } from "./appVersion.js";

export type { SpanshRouteAnswer, SpanshRouteDTO };

const RESULTS_URL = "https://spansh.co.uk/api/results/";
const JOB_RE = /[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}/i;
/** A route this long is not a Spansh route (its plotters stop far below). */
const MAX_STOPS = 5000;

/** The job id in a pasted link or the id itself; null when there is none. */
export function spanshJobFromText(text: string): string | null {
  const m = JOB_RE.exec(String(text ?? ""));
  return m ? m[0].toUpperCase() : null;
}

const SITE_PATH: Record<SpanshRouteKind, string> = {
  exobiology: "exobiology",
  riches: "riches",
  neutron: "plotter",
  plotter: "exact-plotter",
  carrier: "fleet-carrier",
};

/**
 * The riches planner's page on Spansh: its ammonia, earth-like and rocky / metal-rich variants have their own
 * (`/ammonia`, `/earth`, `/rocky-metal`), told apart only by the body types they ask for (seen 2026-11-02).
 */
function richesPath(bodyTypes: unknown): string {
  const t = Array.isArray(bodyTypes) ? bodyTypes.map(String).sort().join("|") : "";
  if (t === "Ammonia world") return "ammonia";
  if (t === "Earth-like world") return "earth";
  if (t === "High metal content world|Rocky body") return "rocky-metal";
  return "riches";
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
const id64 = (v: unknown): string | null =>
  typeof v === "string" && /^\d{1,20}$/.test(v) ? v : typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? String(v) : null;
const truthy = (v: unknown): boolean => v === true || v === 1 || v === "1";

function bodiesOf(raw: unknown, kind: SpanshRouteKind): SpanshRouteBodyDTO[] {
  if (!Array.isArray(raw)) return [];
  const out: SpanshRouteBodyDTO[] = [];
  for (const b of raw.slice(0, 200) as Record<string, unknown>[]) {
    if (!b || typeof b !== "object") continue;
    const species = Array.isArray(b.landmarks)
      ? (b.landmarks as Record<string, unknown>[])
          .map((l) => ({ name: str(l?.subtype) ?? str(l?.type) ?? "", valueCr: Math.max(0, num(l?.value) ?? 0) }))
          .filter((l) => l.name)
          .sort((a, c) => c.valueCr - a.valueCr)
      : [];
    const valueCr =
      kind === "exobiology"
        ? (num(b.landmark_value) ?? species.reduce((s, l) => s + l.valueCr, 0))
        : (num(b.estimated_mapping_value) ?? 0) + (num(b.estimated_scan_value) ?? 0);
    out.push({
      name: str(b.name) ?? "",
      subtype: str(b.subtype),
      distanceLs: num(b.distance_to_arrival),
      valueCr: Math.max(0, Math.round(valueCr)),
      species,
    });
  }
  return out;
}

function stop(r: Record<string, unknown>, name: unknown, extra: Partial<SpanshRouteStopDTO>): SpanshRouteStopDTO | null {
  const x = num(r.x);
  const y = num(r.y);
  const z = num(r.z);
  const n = str(name);
  if (x == null || y == null || z == null || !n) return null;
  return { name: n, id64: id64(r.id64), x, y, z, jumps: 0, neutron: false, refuel: false, inject: false, valueCr: 0, bodies: [], ...extra };
}

/** Spansh's result JSON as one route; null when it is none of the shapes above. */
export function parseSpanshResult(job: string, data: unknown): SpanshRouteDTO | null {
  const d = data as { result?: unknown; parameters?: Record<string, unknown> } | null;
  if (!d || typeof d !== "object") return null;
  const p = (d.parameters ?? {}) as Record<string, unknown>;
  const res = d.result;
  let kind: SpanshRouteKind;
  const stops: SpanshRouteStopDTO[] = [];
  if (Array.isArray(res)) {
    const rows = res as Record<string, unknown>[];
    // Exobiology bodies carry their species (`landmarks`); the riches planners' carry mapping values instead.
    const bio = rows.some(
      (r) => Array.isArray(r?.bodies) && (r.bodies as Record<string, unknown>[]).some((b) => Array.isArray(b?.landmarks) || b?.landmark_value != null),
    );
    kind = bio ? "exobiology" : "riches";
    for (const r of rows.slice(0, MAX_STOPS)) {
      if (!r || typeof r !== "object") continue;
      const bodies = bodiesOf(r.bodies, kind);
      const s = stop(r, r.name, { jumps: Math.max(0, Math.round(num(r.jumps) ?? 0)), bodies, valueCr: bodies.reduce((a, b) => a + b.valueCr, 0) });
      if (s) stops.push(s);
    }
  } else if (res && typeof res === "object") {
    const o = res as Record<string, unknown>;
    if (Array.isArray(o.system_jumps)) {
      kind = "neutron";
      for (const r of (o.system_jumps as Record<string, unknown>[]).slice(0, MAX_STOPS)) {
        const s = r && stop(r, r.system, { jumps: Math.max(0, Math.round(num(r.jumps) ?? 0)), neutron: truthy(r.neutron_star) });
        if (s) stops.push(s);
      }
    } else if (Array.isArray(o.jumps)) {
      kind = "tritium_stored" in o || "capacity_used" in o ? "carrier" : "plotter";
      for (const r of (o.jumps as Record<string, unknown>[]).slice(0, MAX_STOPS)) {
        const s =
          r &&
          stop(r, r.name, {
            jumps: stops.length ? 1 : 0,
            neutron: truthy(r.has_neutron),
            refuel: truthy(r.must_refuel) || truthy(r.must_restock),
            inject: truthy(r.must_inject),
          });
        if (s) stops.push(s);
      }
    } else return null;
  } else return null;
  if (!stops.length) return null;
  // The first stop is where the route starts: no jumps to it.
  stops[0]!.jumps = 0;
  // The exact plotter names its ends by system address ("10477373803"): the stop with that address gives the name
  // (owner's Sol > Colonia file, 2026-11-05: the drawer showed the numbers).
  const named = (v: string | null): string | null => {
    if (v == null || !/^\d+$/.test(v)) return v;
    return stops.find((s) => s.id64 === v)?.name ?? v;
  };
  const from = named(str(p.from) ?? str(p.source) ?? str(p.source_system)) ?? stops[0]!.name;
  const last = (v: unknown) => (Array.isArray(v) ? v[v.length - 1] : v);
  const toRaw = p.to ?? p.destination ?? p.destination_system ?? last(p.destinations) ?? last(p.destination_systems);
  return {
    job,
    kind,
    from,
    to: named(str(toRaw)),
    rangeLy: num(p.range),
    stops,
    totalJumps: stops.reduce((a, s) => a + s.jumps, 0),
    totalValueCr: stops.reduce((a, s) => a + s.valueCr, 0),
    url: `https://spansh.co.uk/${kind === "riches" ? richesPath(p.body_types) : SITE_PATH[kind]}/results/${job}`,
  };
}

/**
 * The stops to fly, as the live route's hops: a stop after a neutron star starts with a supercharge, a plotter's
 * refuel stop says "scoop here" (a carrier's tritium restock does not: the drawer lists those). `keep` drops stops the
 * commander unticked (never the first).
 */
export function spanshRouteHops(route: SpanshRouteDTO, keep?: ReadonlySet<number> | null): LiveHop[] | null {
  const carrier = route.kind === "carrier";
  const hops: LiveHop[] = [];
  let jumps = 0;
  route.stops.forEach((s, i) => {
    jumps += s.jumps;
    if (i > 0 && keep && !keep.has(i)) return;
    const prev = hops[hops.length - 1];
    const prevStop = i > 0 ? route.stops[i - 1]! : null;
    hops.push({
      name: s.name,
      x: s.x,
      y: s.y,
      z: s.z,
      kind: i === 0 ? "start" : s.neutron ? "neutron" : "waypoint",
      jumps: i === 0 ? 0 : Math.max(1, jumps),
      // The jump out of a neutron star is supercharged: only when that star is the stop just before.
      boosted: prev && prevStop?.neutron && prev.name === prevStop.name ? 1 : 0,
      refuel: !carrier && s.refuel,
      scoopLs: null,
      scoopOnWay: false,
      inject: null,
    });
    jumps = 0;
  });
  return hops.length >= 2 ? hops : null;
}

/** One result from Spansh, asked once per paste; `fetchImpl` for the tests. */
export async function fetchSpanshRoute(text: string, fetchImpl: typeof fetch = fetch): Promise<SpanshRouteAnswer> {
  const job = spanshJobFromText(text);
  if (!job) return { state: "error", error: "No Spansh route in that: paste the link of a Spansh results page, or its job id." };
  let res: Response;
  try {
    res = await fetchImpl(`${RESULTS_URL}${job}`, { headers: { "User-Agent": APP_USER_AGENT, Accept: "application/json" } });
  } catch (e) {
    return { state: "error", error: `Spansh did not answer (${e instanceof Error ? e.message : String(e)}).` };
  }
  if (res.status === 404) return { state: "error", error: "Spansh does not have that route any more (it keeps results for a few hours only). Routes read before are under Kept routes." };
  if (!res.ok) return { state: "error", error: `Spansh answered ${res.status}.` };
  let data: { status?: unknown; error?: unknown };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    return { state: "error", error: "Spansh's answer was not a route." };
  }
  if (data.status === "queued" || data.status === "running") return { state: "pending", job };
  if (data.status !== "ok") return { state: "error", error: str(data.error) ?? `Spansh: ${String(data.status ?? "no route")}.` };
  const route = parseSpanshResult(job, data);
  return route ? { state: "ok", route } : { state: "error", error: "A Spansh result EDEXO cannot read (not a route)." };
}
