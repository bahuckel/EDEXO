import type express from "express";

/**
 * Express 4 does not catch a rejected async handler: the rejection goes unhandled and the dev entry
 * exits the process on it (combined plan 1.4). Every route handler that returns a promise has its
 * rejection passed to `next`, which answers 500. `app.get(name)` with one argument is the settings
 * getter and is left alone.
 *
 * Called first in createHttpServer, before any route is registered (moved out of httpServer.ts,
 * audit 2026-10-22).
 */
export function catchAsyncRejections(app: express.Express): void {
  for (const method of ["get", "post", "put", "delete", "patch"] as const) {
    const register = app[method].bind(app) as (...args: unknown[]) => unknown;
    (app as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
      if (args.length < 2) return register(...args);
      return register(
        ...args.map((h) =>
          typeof h === "function" && h.length <= 3
            ? (req: express.Request, res: express.Response, next: express.NextFunction) => {
                try {
                  const r = (h as (a: unknown, b: unknown, c: unknown) => unknown)(req, res, next);
                  if (r && typeof (r as Promise<unknown>).catch === "function")
                    (r as Promise<unknown>).catch(next);
                } catch (e) {
                  next(e);
                }
              }
            : h,
        ),
      );
    };
  }
}
