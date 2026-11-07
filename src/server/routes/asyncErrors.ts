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
/**
 * The last middleware: an error any route passed on (a rejected handler above, a body too big or not JSON) answers
 * JSON with its status and no detail. Without it Express's own page answered, with the stack and the install's
 * absolute paths (the Windows user name) to any LAN client (review 2026-11-07). The error is logged here instead.
 */
export function answerErrorsAsJson(app: express.Express): void {
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    const e = err as { status?: unknown; statusCode?: unknown } | null;
    const status = e?.status ?? e?.statusCode;
    const code = typeof status === "number" && status >= 400 && status < 600 ? status : 500;
    if (code >= 500) console.error("EDEXO route error:", err);
    res.status(code).json({ error: code >= 500 ? "internal" : "bad request" });
  });
}

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
