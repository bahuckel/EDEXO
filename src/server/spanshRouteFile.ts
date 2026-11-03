/**
 * Spansh routes kept on disk (owner, 2026-11-03: "routes kept after Spansh deletes them"). Spansh keeps a result for a
 * few hours only, then its link answers 404; a route read once is kept here, so it can be opened and flown again after
 * that and after a restart. The newest {@link MAX_SAVED} are kept, a route read again moves to the front.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveCommanderDataDir } from "./paths.js";
import { writeFileAtomic } from "./atomicWrite.js";
import type { SavedSpanshRouteDTO, SpanshRouteDTO } from "../shared/dto/spanshRoute.js";

export const MAX_SAVED = 20;

interface Saved {
  route: SpanshRouteDTO;
  /** ISO time it was read from Spansh. */
  readAt: string;
}

export const resolveSpanshRoutesPath = (): string => path.join(resolveCommanderDataDir(), "edexo-spansh-routes.json");

const isRoute = (r: unknown): r is SpanshRouteDTO => {
  const o = r as Partial<SpanshRouteDTO> | null;
  return !!o && typeof o.job === "string" && typeof o.kind === "string" && Array.isArray(o.stops) && o.stops.length >= 2;
};

export interface SpanshRouteFile {
  get(job: string): SpanshRouteDTO | undefined;
  /** Keeps a route read from Spansh, newest first. */
  put(route: SpanshRouteDTO, now?: Date): void;
  remove(job: string): boolean;
  list(): SavedSpanshRouteDTO[];
}

/** The file at `file` (the commander's data folder by default); a missing or broken file is an empty list. */
export function openSpanshRouteFile(file: string = resolveSpanshRoutesPath()): SpanshRouteFile {
  let saved: Saved[] = [];
  try {
    if (existsSync(file)) {
      const raw = JSON.parse(readFileSync(file, "utf8")) as { routes?: unknown };
      if (Array.isArray(raw.routes))
        saved = (raw.routes as Partial<Saved>[])
          .filter((s) => isRoute(s?.route) && typeof s?.readAt === "string")
          .slice(0, MAX_SAVED) as Saved[];
    }
  } catch {
    saved = [];
  }
  const write = () => {
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileAtomic(file, JSON.stringify({ version: 1, routes: saved }));
    } catch {
      // Not kept on disk this time: the route still works for this session.
    }
  };
  return {
    get: (job) => saved.find((s) => s.route.job === job)?.route,
    put(route, now = new Date()) {
      saved = [{ route, readAt: now.toISOString() }, ...saved.filter((s) => s.route.job !== route.job)].slice(0, MAX_SAVED);
      write();
    },
    remove(job) {
      const before = saved.length;
      saved = saved.filter((s) => s.route.job !== job);
      if (saved.length === before) return false;
      write();
      return true;
    },
    list: () =>
      saved.map(({ route: r, readAt }) => ({
        job: r.job,
        kind: r.kind,
        from: r.from,
        to: r.to,
        stops: r.stops.length - 1,
        totalJumps: r.totalJumps,
        totalValueCr: r.totalValueCr,
        readAt,
      })),
  };
}
