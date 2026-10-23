import { loadSharedExomastery, sharedExomasteryDir } from "../sharedExomastery.js";
import { sharedExomasterySummary } from "../snapshot.js";
import { openLocalFile } from "../openUrl.js";
import path from "node:path";
import express from "express";
import { getProjectRoot, getSpeciesDataDir } from "../paths.js";
import { isLoopbackAddress } from "../lanAuth.js";

import type { HttpServerOptions, RouteContext } from "../httpServerTypes.js";
import { CONTENT_SECURITY_POLICY } from "../csp.js";
import {
  eliteAccountsRoot,
  findVisitedCacheFiles,
  importVisitedCache,
  loadVisitedImport,
  removeVisitedImport,
} from "../visitedCache.js";

export function registerExomasteryRoutes(
  app: express.Express,
  opts: HttpServerOptions,
  ctx: RouteContext,
): void {
  const { webRoot } = ctx;

  /*
    The game's own visited list (plan 6.1, owner 2026-10-13: under the Spansh import in the launcher's Exomastery
    menu). Status from anywhere; import and remove only on the PC running the app, and the import names an account
    folder the server found itself, never a path.
  */
  const knownSystems = (): Set<number> => {
    const store = opts.getJournalStore?.() ?? null;
    return new Set(store ? [...store.visitedSystems.keys(), ...store.systemPositions.keys()] : []);
  };
  // The folder alone (review 1.2.16: this built the whole snapshot, every body and match, to read it).
  const accountsRoot = () => eliteAccountsRoot(opts.getJournalDir?.() ?? opts.getSnapshot().journalDir);
  app.get("/api/visited-cache", (_req, res) => {
    const imp = loadVisitedImport();
    res.json({
      imported: imp
        ? {
            account: imp.account,
            importedAt: imp.importedAt,
            fileModifiedAt: imp.fileModifiedAt,
            systems: imp.ids.length,
          }
        : null,
      files: findVisitedCacheFiles(accountsRoot(), knownSystems()).map(({ path: _p, ...f }) => f),
    });
  });
  app.post("/api/visited-cache/import", (req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({ ok: false, error: "Only on the PC running the app." });
      return;
    }
    const account = String((req.body as { account?: unknown } | undefined)?.account ?? "");
    try {
      const imp = importVisitedCache(accountsRoot(), account);
      const known = knownSystems();
      res.json({
        ok: true,
        systems: imp.ids.length,
        notInJournals: imp.ids.filter((s) => !known.has(Number(s))).length,
      });
      opts.scheduleBroadcast?.();
    } catch (e) {
      res.status(400).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
  app.post("/api/visited-cache/remove", (req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res.status(403).json({ ok: false, error: "Only on the PC running the app." });
      return;
    }
    res.json({ ok: true, removed: removeVisitedImport() });
    opts.scheduleBroadcast?.();
  });
  /** Download your exomastery or your codex as a file (§S). */
  app.get("/api/exomastery/export", (req, res) => {
    const kind = req.query.kind === "codex" ? "codex" : req.query.kind === "exomastery" ? "exomastery" : null;
    if (!kind) {
      res.status(400).json({ ok: false, error: "kind must be exomastery or codex." });
      return;
    }
    if (typeof opts.exportExomastery !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    const { fileName, body } = opts.exportExomastery(kind);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(JSON.stringify(body, null, 2));
  });

  /** What the shared-exomastery folder holds, for the launcher (§S). */
  app.get("/api/exomastery/shared", (_req, res) => {
    const s = sharedExomasterySummary();
    res.json({
      ok: true,
      folder: s.folder,
      files: s.files,
      finds: s.finds,
      ownBackupFinds: s.ownBackupFinds,
      commanders: s.commanders,
      alerts: s.alerts.length,
    });
  });

  /** Open the shared-exomastery folder in Explorer — on the PC running the app only. */
  app.post("/api/exomastery/open-shared-folder", (req, res) => {
    if (!isLoopbackAddress(req.socket.remoteAddress)) {
      res
        .status(403)
        .json({ ok: false, error: "The folder opens on the PC running the app, so only from there." });
      return;
    }
    loadSharedExomastery(); // creates the folder, so there is something to open
    const dir = sharedExomasteryDir();
    openLocalFile(dir);
    res.json({ ok: true, folder: dir });
  });

  app.post("/api/exomastery/reload", (_req, res) => {
    if (typeof opts.reloadExomastery !== "function") {
      res.status(501).json({ ok: false, error: "Not available" });
      return;
    }
    try {
      opts.reloadExomastery();
      const root = getProjectRoot();
      res.json({
        ok: true,
        speciesDataDir: getSpeciesDataDir(root),
        projectRoot: root,
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });

  app.use(
    express.static(webRoot, {
      index: false,
      setHeaders(res, absPath) {
        const norm = absPath.replace(/\\/g, "/").toLowerCase();
        if (norm.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
          res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
        } else if (/\/assets\//.test(norm)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/photos")) {
      res.status(404).end();
      return;
    }
    if (req.path.startsWith("/species-photos")) {
      res.status(404).end();
      return;
    }
    if (req.path.startsWith("/api")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.setHeader("Cache-Control", "no-store, max-age=0, must-revalidate");
    res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    res.sendFile(path.join(webRoot, "index.html"), {
      etag: false,
      lastModified: false,
      cacheControl: false,
    });
  });
}
