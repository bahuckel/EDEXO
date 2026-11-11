import type express from "express";
import { localOnly } from "./lanAuth.js";
import { ROUTE_REACH, type RouteReach } from "./routeReach.js";

/*
  Who may call each route, decided once per route (review 2026-11-10 C3, plan 1.1). The phone rule (owner 2026-11-07)
  was a deny-list: fifteen named paths plus "no DELETE without localOnly", so a new state-changing route was open to a
  paired phone by default, and three slipped (the game's netlog file, a boxel's cut, routes the test's regex could not
  see). Now every route is in ROUTE_REACH (routeReach.ts): `pc` routes get `localOnly` here, `lan` routes answer any
  paired device. A route missing from the table is treated as `pc` (closed) and listed by `unclassifiedRoutes()`, which
  tests/routeReach.test.ts requires to be empty, so a new route fails the suite until someone decides.

  Applied in createHttpServer before any route is registered. A route that is `lan` here may still refuse part of its
  work to another device inside its handler (Colonize's RPC methods, a boxel's cut).
*/

const METHODS = ["get", "post", "put", "delete", "patch"] as const;

export interface RouteRegistration {
  key: string;
  reach: RouteReach | null;
}

export function enforceRouteReach(app: express.Express, table: Readonly<Record<string, RouteReach>> = ROUTE_REACH): {
  registered: () => RouteRegistration[];
  unclassified: () => string[];
} {
  const seen: RouteRegistration[] = [];
  for (const method of METHODS) {
    const register = app[method].bind(app) as (...args: unknown[]) => unknown;
    (app as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      // `app.get(name)` with one argument is the settings getter.
      if (args.length < 2) return register(...args);
      const key = `${method.toUpperCase()} ${String(args[0])}`;
      const reach = table[key] ?? null;
      seen.push({ key, reach });
      if (reach === "lan") return register(...args);
      return register(args[0], localOnly, ...args.slice(1));
    };
  }
  return {
    registered: () => seen.slice(),
    unclassified: () => seen.filter((r) => r.reach === null).map((r) => r.key),
  };
}
