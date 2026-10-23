/**
 * The feeder corpus: its status and the Spansh export import (moved out of httpServer.ts,
 * audit 2026-10-22).
 */
import type express from "express";
import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";
import { localOnly } from "../lanAuth.js";

export function registerFeederRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  _ctx: RouteContext,
): void {
  /**
   * Whether the data the app ranks with is the data the corpus holds. Before the feeder merge the
   * answer was no on 72 of 79 profiles and nothing in the app said so.
   */
  app.get("/api/feeder/status", async (_req, res) => {
    if (typeof opts.getFeederStatus !== "function") {
      res.status(501).json({ error: "Not available" });
      return;
    }
    try {
      res.json(await opts.getFeederStatus());
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  /*
    The launcher's "Import Spansh export" button. The import streams a multi-gigabyte file through
    the same four gates the CLI uses, so it runs as a background job and the launcher polls the
    status route; only one at a time.
  */
  app.post("/api/feeder/import-dump", localOnly, (req, res) => {
    if (typeof opts.startImportDump !== "function") {
      res.status(501).json({ ok: false, error: "Not available on this build" });
      return;
    }
    const body = (req.body ?? {}) as { file?: unknown; apply?: unknown };
    const file = typeof body.file === "string" ? body.file.trim() : "";
    if (!file) {
      res.status(400).json({ ok: false, error: "Send JSON { file, apply }" });
      return;
    }
    const r = opts.startImportDump(file, body.apply === true);
    res.status(r.ok ? 200 : 409).json(r);
  });
  app.get("/api/feeder/import-dump/status", localOnly, (req, res) => {
    if (typeof opts.getImportDumpStatus !== "function") {
      res.status(501).json({ error: "Not available on this build" });
      return;
    }
    const f = typeof req.query.file === "string" ? req.query.file : null;
    res.json(opts.getImportDumpStatus(f));
  });
}
