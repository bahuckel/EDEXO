import http from "node:http";
import os from "node:os";
import express from "express";
import type { AppSnapshot, ExoLiveDTO, UiCommand } from "../shared/types.js";
import { getProjectRoot, getWebRoot } from "./paths.js";
import { createLanAuthGuard, createOriginGuard } from "./lanAuth.js";
import type { HttpServerOptions, RouteContext } from "./httpServerTypes.js";
import { dropDeflateOfferFromThisPc } from "./wsCompression.js";
import { createWsHub } from "./wsHub.js";

import { catchAsyncRejections } from "./routes/asyncErrors.js";
import { registerSpeciesFilesRoutes } from "./routes/speciesFilesRoutes.js";
import { registerGalaxyRoutes } from "./routes/galaxyRoutes.js";
import { registerBoxelRoutes } from "./routes/boxelRoutes.js";
import { registerDiscoveriesRoutes } from "./routes/discoveriesRoutes.js";
import { registerExpeditionRoutes } from "./routes/expeditionRoutes.js";
import { registerNeutronRoutes } from "./routes/neutronRoutes.js";
import { registerFinderRoutes } from "./routes/finderRoutes.js";
import { registerColonizeRoutes } from "./routes/colonizeRoutes.js";
import { registerSystemInfoRoutes } from "./routes/systemInfoRoutes.js";
import { registerCarriersPoiRoutes } from "./routes/carriersPoiRoutes.js";
import { registerJumponiumRoutes } from "./routes/jumponiumRoutes.js";
import { registerServerStatusRoutes } from "./routes/serverStatusRoutes.js";
import { registerEncyclopediaRoutes } from "./routes/encyclopediaRoutes.js";
import { registerLauncherRoutes } from "./routes/launcherRoutes.js";
import { registerAppInfoRoutes } from "./routes/appInfoRoutes.js";
import { registerFeederRoutes } from "./routes/feederRoutes.js";
import { registerSettingsRoutes } from "./routes/settingsRoutes.js";
import { registerExoDataRoutes } from "./routes/exoDataRoutes.js";
import { registerHudRoutes } from "./routes/hudRoutes.js";
import { registerExomasteryRoutes } from "./routes/exomasteryRoutes.js";
import { registerBackupRoutes } from "./routes/backupRoutes.js";
import { registerBookmarksRoutes } from "./routes/bookmarksRoutes.js";
import { registerGreenGiantRoutes } from "./routes/greenGiantRoutes.js";
import { registerRecordsRoutes } from "./routes/recordsRoutes.js";
import { registerStateRoutes } from "./routes/stateRoutes.js";

// The options and route types live in httpServerTypes.ts (audit 2026-10-22); kept importable from here.
export type { HttpServerOptions, RouteContext } from "./httpServerTypes.js";

export function getLanIPv4s(port: number): string[] {
  const nets = os.networkInterfaces();
  const out: string[] = [];
  for (const infos of Object.values(nets)) {
    if (!infos) continue;
    for (const info of infos) {
      const family = info.family as string | number;
      const v4 = family === "IPv4" || family === 4;
      if (v4 && !info.internal) {
        out.push(`http://${info.address}:${port}`);
      }
    }
  }
  return [...new Set(out)].sort();
}

export function createHttpServer(opts: HttpServerOptions): {
  server: http.Server;
  broadcast: (s: AppSnapshot) => void;
  /** The radar's own frame, straight to the HUD sockets. See {@link ExoLiveDTO}. */
  broadcastExoLive: (live: ExoLiveDTO) => void;
  /** A command for the app pages (key binds: previous / next body tab), to every app-channel socket. */
  broadcastUiCommand: (cmd: UiCommand) => void;
  listening: Promise<void>;
  /**
   * Drop every open socket and keep-alive connection, so `server.close` returns at once (code review
   * 2026-10-10, A2): a phone or a forgotten browser tab kept its WebSocket and the quit waited the eight
   * seconds the desktop app gives the server before ending it.
   */
  closeConnections: () => void;
} {
  const app = express();
  catchAsyncRejections(app);
  const root = getProjectRoot();
  const webRoot = getWebRoot(root);
  /**
   * First middleware on purpose: an unpaired LAN client must not reach a route handler, and must
   * not get its request body parsed either.
   */
  const lanKey = opts.lanKey ?? null;
  /*
    This PC's LAN addresses, for the Host/Origin check: read every 30 s, not per request
    (`os.networkInterfaces()` is slow on Windows with VPN or Hyper-V adapters).
  */
  let lanHostsAt = 0;
  let lanHosts = new Set<string>();
  const isOwnLanHost = (name: string): boolean => {
    if (Date.now() - lanHostsAt > 30_000) {
      lanHosts = new Set(getLanIPv4s(opts.port).map((u) => new URL(u).hostname));
      if (opts.bindHost && opts.bindHost !== "0.0.0.0") lanHosts.add(opts.bindHost.toLowerCase());
      lanHostsAt = Date.now();
    }
    return lanHosts.has(name);
  };
  app.use(createOriginGuard(isOwnLanHost));
  app.use(createLanAuthGuard(lanKey));

  /*
    The live sockets (wsHub.ts, split out in 1.3.1): made before the routes, which hold Colonize's pushes, the change
    topics and the state; attached to the HTTP server once it exists, below.
  */
  const hub = createWsHub({ getSnapshot: opts.getSnapshot, lanKey, isOwnLanHost });
  const routeCtx: RouteContext = {
    root,
    webRoot,
    pushColonize: hub.pushColonize,
    watchTopic: hub.watchTopic,
    topicsMayHaveChanged: hub.topicsMayHaveChanged,
  };

  /**
   * A route export needs more room than everything else combined.
   *
   * The global limit below is 48 kB, which is right for every other endpoint and far too small for a
   * Spansh export: the owner's two are 136 kB and 145 kB, and a longer route is bigger again. This
   * must be mounted *before* the global parser, because express.json rejects an oversized body where
   * it is mounted and a later, larger parser never sees the request. Bounded at 8 MB, and scoped to
   * the one path: the galaxy dump is read from disk by the CLI and never travels through here.
   */
  app.use("/api/feeder/import", express.json({ limit: "8mb" }));
  // The streamer view's settings mirror (uiMirror.ts): every edexo.* setting of the app at once.
  app.use("/api/ui/mirror", express.json({ limit: "512kb" }));
  // Colonize's checkout plans carry market snapshots (colonizeRoutes.ts).
  app.use("/api/colonize", express.json({ limit: "8mb" }));
  app.use(express.json({ limit: "48kb" }));

  registerSpeciesFilesRoutes(app, opts, routeCtx);

  registerGalaxyRoutes(app, opts, routeCtx);
  registerBoxelRoutes(app, opts, routeCtx);
  registerDiscoveriesRoutes(app, opts, routeCtx);
  registerExpeditionRoutes(app, opts, routeCtx);
  registerNeutronRoutes(app, opts, routeCtx);
  registerFinderRoutes(app, opts, routeCtx);
  registerColonizeRoutes(app, opts, routeCtx);

  /*
    The routes that were inline between the modules sit in modules of their own now (audit 2026-10-22). Each group
    is registered where its first route was; none of their paths is matched by a route registered in between.
  */
  registerSystemInfoRoutes(app, opts, routeCtx);

  /*
    Fleet carriers, from EDAstro. Three routes, and none of them runs by itself.

    The commander presses a button, `fetch` downloads a 21 MB CSV to their own machine, and `query`
    answers from that file forever after. There is no background poll and no per-jump call: the
    source rebuilds about daily. See `docs/archive/edastro-integration.md` for the licence position
    — the short version is that we ship the endpoint and never the data, so the fetch must stay on
    the commander's machine and must never be proxied through here.
  */
  registerCarriersPoiRoutes(app, opts, routeCtx);
  registerJumponiumRoutes(app, opts);

  // The live state over HTTP: /api/state, its revision, a candidate's detail, the on-foot scans (stateRoutes.ts).
  registerStateRoutes(app, opts, hub);

  registerServerStatusRoutes(app, opts, routeCtx);

  registerEncyclopediaRoutes(app, opts, routeCtx);
  registerLauncherRoutes(app, opts, routeCtx);
  registerAppInfoRoutes(app, opts, routeCtx);
  registerFeederRoutes(app, opts, routeCtx);

  registerSettingsRoutes(app, opts, routeCtx);

  registerExoDataRoutes(app, opts, routeCtx);

  /*
    The HUD overlay windows, for anything that is not the app's own UI.

    Overlays are Electron windows and every control for them is an `ipcMain` channel, which a console
    build has no way to reach. `hudBridge.ts` is the seam; these routes are the only door through it.
    A build with no windows answers 501 rather than pretending — the CLI prints that reason as-is.
  */
  registerHudRoutes(app, opts, routeCtx);

  registerBackupRoutes(app, opts, routeCtx);
  registerBookmarksRoutes(app, opts, routeCtx);
  registerGreenGiantRoutes(app, opts, routeCtx);
  registerRecordsRoutes(app, opts, routeCtx);

  registerExomasteryRoutes(app, opts, routeCtx);

  const server = http.createServer(app);
  // Before the hub's WebSocketServer adds its own upgrade listener: this PC's windows agree no deflate.
  server.on("upgrade", dropDeflateOfferFromThisPc);

  const listening = new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", (err: NodeJS.ErrnoException) => {
      console.error("HTTP server error:", err.message);
      if (err.code === "EADDRINUSE") {
        console.error(
          `Port ${opts.port} is already in use. Close the other app (e.g. EDExoCompare-*-CLI.exe) or set PORT in the environment.`,
        );
      }
      reject(err);
    });
  });

  hub.attach(server);

  const closeConnections = () => {
    hub.closeConnections();
    server.closeAllConnections?.();
  };

  server.listen(opts.port, opts.bindHost);
  return {
    server,
    broadcast: hub.broadcast,
    broadcastExoLive: hub.broadcastExoLive,
    broadcastUiCommand: hub.broadcastUiCommand,
    listening,
    closeConnections,
  };
}
