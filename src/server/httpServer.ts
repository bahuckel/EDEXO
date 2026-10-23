import { findMatchDetail, parseWsChannel, slimSnapshotForChannel, type WsChannel } from "./wsChannels.js";
import { createHash } from "node:crypto";
import http from "node:http";
import os from "node:os";
import express from "express";
import { WebSocketServer } from "ws";
import type { AppSnapshot, ExoLiveDTO, UiCommand } from "../shared/types.js";
import { getProjectRoot, getWebRoot } from "./paths.js";
import { perfBytes, perfCount, perfTime } from "./perf.js";
import { createLanAuthGuard, createOriginGuard, requestIsAuthorized, requestOriginIsAllowed } from "./lanAuth.js";
import type { HttpServerOptions, RouteContext } from "./httpServerTypes.js";
import { dropDeflateOfferFromThisPc, frameSendOptions } from "./wsCompression.js";

import { GZIP_MIN_BYTES, sendJson } from "./routes/httpHelpers.js";
import { catchAsyncRejections } from "./routes/asyncErrors.js";
import { registerSpeciesFilesRoutes } from "./routes/speciesFilesRoutes.js";
import { registerGalaxyRoutes } from "./routes/galaxyRoutes.js";
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
  /** Every frame goes out through here: small ones raw, big ones deflated where deflate was agreed (wsCompression.ts). */
  const sendFrame = (ws: import("ws").WebSocket, msg: string): void => ws.send(msg, frameSendOptions(msg));
  /*
    Colonize's pushes (1.3.0): the depot snapshot, the buy-index scan status, an Inara import, to the sockets that
    said they are a Colonize window. Declared before the routes so they can hold it; the socket set fills later.
  */
  const pushColonize = (event: string, payload: unknown) => {
    const msg = JSON.stringify({ type: "colonize", event, payload });
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN || channelOf.get(ws) !== "colonize") continue;
      try {
        sendFrame(ws, msg);
      } catch {
        clients.delete(ws);
      }
    }
  };
  const routeCtx: RouteContext = { root, webRoot, pushColonize };

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

  /**
   * The revision of the last push on the app channel — a few bytes the client asks for every 10 s
   * instead of the whole snapshot (UI review P2). A different number than the last push it saw means a
   * push was missed (a half-open socket), and only then does it fetch `/api/state`.
   */
  app.get("/api/state/rev", (_req, res) => {
    res.json({ rev: pushRev });
  });

  /**
   * A candidate's habitat detail, variety hints and other-details cards, which the app channel leaves
   * out of every push (UI review P1b): the species card asks for them when its modal or drawer opens.
   */
  app.get("/api/match-detail", (req, res) => {
    const body = typeof req.query.body === "string" ? req.query.body : "";
    const species = typeof req.query.species === "string" ? req.query.species : "";
    if (!body || !species) {
      res.status(400).json({ error: "body and species are required" });
      return;
    }
    const hit = findMatchDetail(lastAppSnap ?? opts.getSnapshot(), body, species);
    if (!hit) {
      res.status(404).json({ error: "That candidate is no longer on this body." });
      return;
    }
    res.json(hit);
  });

  /** The last full snapshot pushed or served, for `/api/match-detail` (building one is not free). */
  let lastAppSnap: AppSnapshot | null = null;

  app.get("/api/state", (req, res) => {
    perfCount("http.apiState");
    res.setHeader("X-Edexo-Rev", String(pushRev));
    const chq = parseWsChannel(req.query?.channel) ?? "app";
    /*
      The snapshot a push or another request built in the last second, as a new socket gets it (code
      review D7, 2026-10-14): a poller, a phone and the client's HTTP backup each used to cost a full
      rebuild. A push replaces it, so a client fetching after the revision moved still gets the new one.
    */
    const snap = recentSnapshot();
    const body = perfTime("http.apiState.serialize", () => JSON.stringify(slimSnapshotForChannel(snap, chq)));
    sendJson(req, res, body, (raw, sent) => {
      perfBytes("http.apiState.bytes", raw);
      perfBytes("http.apiState.sent", sent);
    });
  });

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
  // Before the WebSocketServer below adds its own upgrade listener: this PC's windows agree no deflate.
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

  /**
   * Compress large frames only, and only for the LAN. A snapshot push is ~630 KB of repetitive JSON
   * (~85% smaller deflated), which matters for LAN clients; small frames go raw (sendFrame: the
   * `threshold` here does nothing without no_context_takeover), and this PC's own windows agree no
   * deflate at all (the upgrade listener above; wsCompression.ts).
   */
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    perMessageDeflate: { threshold: GZIP_MIN_BYTES, zlibDeflateOptions: { level: 4 } },
    // A client only ever sends a hello: the 100 MiB default would let one frame tie up the main thread.
    maxPayload: 64 * 1024,
    // The upgrade bypasses Express, so the same key check runs here. A paired browser sends the
    // cookie on the handshake; a script can pass ?k= or the header.
    verifyClient: ({ req }, done) => {
      // A web page can open a WebSocket to 127.0.0.1 from anywhere: its Origin must be ours (1.4).
      if (!requestOriginIsAllowed(req, isOwnLanHost, { checkOrigin: true }))
        done(false, 403, "Foreign origin");
      else if (requestIsAuthorized(req, lanKey)) done(true);
      else done(false, 401, "Access key required");
    },
  });
  const clients = new Set<import("ws").WebSocket>();
  /** What each socket asked for with its hello; "app" (the full state) until it says otherwise. */
  const channelOf = new WeakMap<import("ws").WebSocket, WsChannel>();
  /*
    Sockets that must get a whole frame on the next push, not a delta (combined plan 1.3). Pushes leave
    out what did not change since the previous *push*, but a socket that just connected (or changed
    channel) holds the snapshot it was sent then, and one that skipped a push for back-pressure holds
    an older one: a field that changed and changed back would stay stale for it.
  */
  const needsFull = new WeakSet<import("ws").WebSocket>();
  /** Answered the last ping; a socket that misses one interval is a dead connection (a sleeping phone). */
  const alive = new WeakSet<import("ws").WebSocket>();
  /** A slow LAN client gets no push while this much is still unsent to it. */
  const WS_BACKLOG_LIMIT = 8 * 1024 * 1024;
  wss.on("error", (e) =>
    console.error("[edexo-compare] WebSocket server:", e instanceof Error ? e.message : e),
  );
  const stateMessage = (snap: AppSnapshot, channel: WsChannel): string =>
    JSON.stringify({ type: "state", channel, rev: pushRev, payload: slimSnapshotForChannel(snap, channel) });

  /*
    Pushes carry only what changed (UI review P1, owner 2026-09-29). A snapshot is ~0.8 MB and, in a
    system full of bio bodies, ~10 MB — and while the commander plays, most pushes change nothing but
    the fuel. So on the app channel every field of at least OMIT_UNCHANGED_MIN_BYTES that is identical
    to the one in the previous push is left out and named in `unchanged`; the client keeps its copy.
    A socket always gets the full snapshot first (on connect, and on a channel change), so it has
    every field before a push can leave one out. The launcher and HUD channels are small and unchanged.
  */
  const OMIT_UNCHANGED_MIN_BYTES = 2048;
  /*
    What the previous push held, to compare the next one with: digests, not the JSON (RAM audit 2026-10-22). Every
    field's JSON was kept, and every body's a second time, ~0.9 MB at rest and ~10 MB in a rich system. A string
    under OMIT_UNCHANGED_MIN_BYTES is kept as it is (cheaper than hashing it); a bigger one as `#length:sha1`, which
    no JSON text starts like. The bodies field's digest is made from its bodies' digests, so no body is hashed twice.
  */
  const digestOf = (j: string): string =>
    j.length < OMIT_UNCHANGED_MIN_BYTES ? j : `#${j.length}:${createHash("sha1").update(j).digest("base64")}`;
  const lastFieldDigest = new Map<WsChannel, Map<string, string>>();
  /** Counts pushes that went out on the app channel; `/api/state/rev` lets a client check it cheaply (P2). */
  let pushRev = 0;
  /*
    `bodies` one level deeper (UI review P1b): a scan or a sample changes one body, but the field went
    out whole — MBs in a rich system. When some bodies are unchanged, the push carries `bodiesDelta`
    instead: every body key in order, and only the bodies that changed; the client takes the rest
    from its copy. Each body is serialized once either way (the field's JSON is built from them).
  */
  let lastBodyDigest = new Map<string, string>();
  const pushMessage = (snap: AppSnapshot, channel: WsChannel): string => {
    if (channel !== "app") return stateMessage(snap, channel);
    const prev = lastFieldDigest.get(channel);
    const next = new Map<string, string>();
    const parts: string[] = [];
    const unchanged: string[] = [];
    let bodiesDelta = "";
    let bodyDigest: Map<string, string> | null = null;
    for (const [k, v] of Object.entries(slimSnapshotForChannel(snap, channel))) {
      let items: { key: string; json: string; digest: string }[] | null = null;
      let j: string | undefined;
      let d: string;
      if (k === "bodies" && Array.isArray(v)) {
        items = (v as AppSnapshot["bodies"]).map((b) => {
          const json = JSON.stringify(b);
          return { key: b.state.key, json, digest: digestOf(json) };
        });
        j = `[${items.map((i) => i.json).join(",")}]`;
        // JSON holds no raw newline, so the joined digests stand for the bodies in their order.
        d = `#bodies${j.length}:${createHash("sha1")
          .update(items.map((i) => i.digest).join("\n"))
          .digest("base64")}`;
      } else {
        j = v === undefined ? undefined : JSON.stringify(v);
        if (j === undefined) continue;
        d = digestOf(j);
      }
      next.set(k, d);
      if (items) bodyDigest = new Map(items.map((i) => [i.key, i.digest]));
      if (j.length >= OMIT_UNCHANGED_MIN_BYTES && prev?.get(k) === d) unchanged.push(k);
      else if (items && prev?.has(k) && new Set(items.map((i) => i.key)).size === items.length) {
        const changed = items.filter((i) => lastBodyDigest.get(i.key) !== i.digest);
        const changedBytes = changed.reduce((n, i) => n + i.json.length, 0);
        if (changed.length < items.length && changedBytes < j.length / 2) {
          bodiesDelta = `,"bodiesDelta":{"keys":${JSON.stringify(items.map((i) => i.key))},"changed":[${changed
            .map((i) => i.json)
            .join(",")}]}`;
        } else parts.push(`${JSON.stringify(k)}:${j}`);
      } else parts.push(`${JSON.stringify(k)}:${j}`);
    }
    // Nothing at all changed since the last push (same fields, same content): no frame.
    if (prev && prev.size === next.size && [...next].every(([k, d]) => prev.get(k) === d)) return "";
    lastFieldDigest.set(channel, next);
    lastBodyDigest = bodyDigest ?? new Map();
    return `{"type":"state","channel":"app","rev":__REV__,"payload":{${parts.join(",")}}${
      unchanged.length ? `,"unchanged":${JSON.stringify(unchanged)}` : ""
    }${bodiesDelta}}`;
  };

  /** Keep connections warm (NAT / middleboxes); helps clients detect half-open TCP. */
  const wsKeepAlive = setInterval(() => {
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) {
        clients.delete(ws);
        continue;
      }
      // No pong since the last ping: half-open TCP. Without this it stayed OPEN and kept buffering.
      if (!alive.has(ws)) {
        clients.delete(ws);
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      try {
        ws.ping();
      } catch {
        clients.delete(ws);
      }
    }
  }, 25_000);
  wsKeepAlive.unref();

  server.once("close", () => clearInterval(wsKeepAlive));

  /** A snapshot this recent is sent to a new socket as it is: a reconnect storm is not N rebuilds. */
  let lastAppSnapAt = 0;
  const recentSnapshot = (): AppSnapshot => {
    if (!lastAppSnap || Date.now() - lastAppSnapAt > 1000) {
      lastAppSnap = opts.getSnapshot();
      lastAppSnapAt = Date.now();
    }
    return lastAppSnap;
  };

  wss.on("connection", (ws, req) => {
    clients.add(ws);
    /*
      A client may name its channel in the address (`/ws?channel=hud`), so its first frame is already
      its own slice (plan O-H, 2026-10-04): until then every HUD, launcher and phone got the whole app
      state first — 923 kB, about 135 kB on the wire — before its hello could narrow it.
    */
    let first: WsChannel = "app";
    try {
      first = parseWsChannel(new URL(req.url ?? "/ws", "http://x").searchParams.get("channel")) ?? "app";
    } catch {
      /* the default */
    }
    channelOf.set(ws, first);
    alive.add(ws);
    perfCount("ws.connect");
    /*
      A malformed frame (bad Wi-Fi, a port scanner on the LAN) makes `ws` emit 'error'; with no
      listener that is an uncaught exception and the whole app exits (combined plan 1.3).
    */
    ws.on("error", () => {
      clients.delete(ws);
    });
    ws.on("pong", () => alive.add(ws));
    try {
      sendFrame(ws, stateMessage(recentSnapshot(), first));
      needsFull.add(ws);
    } catch {
      /* ignore */
    }
    ws.on("message", (raw) => {
      // The only message a client sends: which slice of the state it wants from now on.
      try {
        const msg = JSON.parse(String(raw)) as { type?: unknown; channel?: unknown };
        if (msg && msg.type === "hello") {
          const ch = parseWsChannel(msg.channel);
          if (ch && ch !== channelOf.get(ws)) {
            channelOf.set(ws, ch);
            sendFrame(ws, stateMessage(recentSnapshot(), ch));
            needsFull.add(ws);
          }
        }
      } catch {
        /* not ours */
      }
    });
    ws.on("close", () => clients.delete(ws));
  });

  /**
   * Last frame sent per channel, so an identical rebuild is not pushed to those clients again. Not the app
   * channel's (RAM audit 2026-10-22): a full-size push kept a whole snapshot here, and pushMessage already
   * answers "" when nothing changed — any change makes the next frame differ from the last.
   */
  const lastBroadcastMsg = new Map<WsChannel, string>();

  const broadcast = (snap: AppSnapshot) => {
    lastAppSnap = snap;
    lastAppSnapAt = Date.now();
    // One serialization per channel per push; null marks "identical to the last frame, skip".
    const built = new Map<WsChannel, string | null>();
    const fullFrames = new Map<WsChannel, string>();
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      const ch = channelOf.get(ws) ?? "app";
      // Built for every channel with a client, even one getting a whole frame: the delta's baseline is
      // the previous push, and it must move on with every push.
      if (!built.has(ch)) {
        // The revision is filled in after the identical-frame check, so it cannot make every frame differ.
        const draft = perfTime("ws.serialize", () => pushMessage(snap, ch));
        if (draft === "" || (ch !== "app" && draft === lastBroadcastMsg.get(ch))) {
          perfCount("ws.push.skippedIdentical");
          built.set(ch, null);
        } else {
          if (ch !== "app") lastBroadcastMsg.set(ch, draft);
          if (ch === "app") pushRev++;
          const msg = draft.replace("__REV__", String(pushRev));
          perfCount("ws.push");
          perfBytes("ws.push.bytes", Buffer.byteLength(msg));
          built.set(ch, msg);
        }
      }
      if (ws.bufferedAmount > WS_BACKLOG_LIMIT) {
        // Still sending earlier frames: skip this one, and send it whole once it has caught up.
        perfCount("ws.push.skippedBacklog");
        needsFull.add(ws);
        continue;
      }
      let msg = built.get(ch) ?? null;
      if (needsFull.has(ws)) {
        msg = fullFrames.get(ch) ?? null;
        if (msg === null) {
          msg = stateMessage(snap, ch);
          fullFrames.set(ch, msg);
        }
        needsFull.delete(ws);
      }
      if (!msg) continue;
      try {
        sendFrame(ws, msg);
      } catch {
        clients.delete(ws);
      }
    }
  };

  /**
   * Push the radar's two fields to the HUD sockets, and to nothing else.
   *
   * Separate from {@link broadcast} on purpose: this frame is a few hundred bytes built straight
   * from the store, so it is sent on every `Status.json` poll rather than through the 250 ms
   * coalescing window that exists to stop full snapshot rebuilds piling up. The app and launcher
   * channels do not get it — neither draws a radar, and the app keeps receiving the same data in
   * the snapshot it already reads.
   *
   * Identical frames are dropped. A commander standing still produces the same numbers every tick,
   * and at a 100 ms poll that would be ten redundant sends a second into a window redrawing an SVG.
   */
  let lastExoLiveMsg: string | null = null;
  const broadcastExoLive = (live: ExoLiveDTO) => {
    let msg: string | null = null;
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if ((channelOf.get(ws) ?? "app") !== "hud") continue;
      if (ws.bufferedAmount > WS_BACKLOG_LIMIT) continue;
      if (msg === null) {
        msg = JSON.stringify({ type: "exoLive", channel: "hud", payload: live });
        if (msg === lastExoLiveMsg) {
          perfCount("ws.exoLive.skippedIdentical");
          return;
        }
        lastExoLiveMsg = msg;
        perfCount("ws.exoLive");
        perfBytes("ws.exoLive.bytes", Buffer.byteLength(msg));
      }
      try {
        sendFrame(ws, msg);
      } catch {
        clients.delete(ws);
      }
    }
  };

  /*
    Key binds (owner, 2026-10-02: "the user won't have to alt tab to the browser window in order to
    switch bodies"). Electron catches the global key and the server tells every app page — the app
    window and any browser tab — so whichever one he is looking at moves.
  */
  const broadcastUiCommand = (cmd: UiCommand) => {
    const msg = JSON.stringify({ type: "uiCommand", payload: cmd });
    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      if ((channelOf.get(ws) ?? "app") !== "app") continue;
      try {
        sendFrame(ws, msg);
      } catch {
        clients.delete(ws);
      }
    }
  };

  const closeConnections = () => {
    for (const ws of wss.clients) {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
    }
    wss.close();
    server.closeAllConnections?.();
  };

  server.listen(opts.port, opts.bindHost);
  return { server, broadcast, broadcastExoLive, broadcastUiCommand, listening, closeConnections };
}
