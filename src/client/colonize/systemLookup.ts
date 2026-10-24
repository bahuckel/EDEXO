/**
 * Where systems are, asked for once (R2, owner 2026-10-24: "include those two R2 items in 1.3.0").
 *
 * The planner wants coordinates for its sellers (usePlannerSystemCoords) and the sites want distances to them
 * (useGalaxyDistances). Each used to send its own request, so every Plan open was two round trips over the same
 * systems. Both now ask here: asks that arrive within {@link SYSTEM_LOOKUP_WINDOW_MS} of the first go out as one
 * `resolveSystems` request, and each caller gets the whole answer back and reads its own part.
 */
import type { colonizeApi } from "./api";
import type { SystemCoordsByNorm } from "../../shared/colonize/galaxyDistanceCompute";

type Api = Pick<typeof colonizeApi, "resolveSystems">;
export type SystemLookupAsk = { systems?: string[]; fromSystems?: string[]; toSystems?: string[] };
export type SystemLookupAnswer =
  | { ok: true; coords: SystemCoordsByNorm; distances: Record<string, number> }
  | { ok: false; err: string };

/** Long enough for the distances hook's 500 ms settle: one Plan open, one request. */
export const SYSTEM_LOOKUP_WINDOW_MS = 600;

/** What the server places per request (checkoutHandlers.ts COORDS_REQUEST_CAP): a bigger batch goes in two. */
const SYSTEMS_CAP = 400;

type Batch = {
  systems: Set<string>;
  from: Set<string>;
  to: Set<string>;
  waiters: ((a: SystemLookupAnswer) => void)[];
  timer: ReturnType<typeof setTimeout>;
};
const open = new WeakMap<Api, Batch>();

function flush(api: Api, b: Batch): void {
  clearTimeout(b.timer);
  if (open.get(api) === b) open.delete(api);
  const ask = { systems: [...b.systems], fromSystems: [...b.from], toSystems: [...b.to] };
  void api
    .resolveSystems(ask)
    .catch((e: unknown): SystemLookupAnswer => ({ ok: false, err: e instanceof Error ? e.message : String(e) }))
    .then((answer) => {
      for (const w of b.waiters) w(answer);
    });
}

export function lookUpSystems(api: Api, ask: SystemLookupAsk): Promise<SystemLookupAnswer> {
  const systems = ask.systems ?? [];
  let b = open.get(api);
  if (b && b.systems.size + systems.length > SYSTEMS_CAP) {
    flush(api, b);
    b = undefined;
  }
  if (!b) {
    const fresh: Batch = {
      systems: new Set(),
      from: new Set(),
      to: new Set(),
      waiters: [],
      timer: setTimeout(() => flush(api, fresh), SYSTEM_LOOKUP_WINDOW_MS),
    };
    open.set(api, fresh);
    b = fresh;
  }
  for (const s of systems) b.systems.add(s);
  for (const s of ask.fromSystems ?? []) b.from.add(s);
  for (const s of ask.toSystems ?? []) b.to.add(s);
  const batch = b;
  return new Promise((resolve) => batch.waiters.push(resolve));
}
