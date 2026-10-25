/*
  The live sockets (split out of httpServer.ts, discuss item 30, 1.3.1): the state pushes per channel with their
  "only what changed" frames, the HUD radar's own frames, key commands to the app pages, Colonize's events, and the
  `events` sockets told when a topic changed (changeTopics.ts). The routes are registered before the HTTP server
  exists and some of them need this (Colonize's pushes, the topics, the state and its revision), so the hub is made
  first and attached to the server once it is (`attach`).
*/
import { createHash } from "node:crypto";
import type http from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { ChangeTopics } from "./changeTopics.js";
import type { AppSnapshot, ExoLiveDTO, UiCommand } from "../shared/types.js";
import { perfBytes, perfCount, perfTime } from "./perf.js";
import { requestIsAuthorized, requestOriginIsAllowed } from "./lanAuth.js";
import { frameSendOptions } from "./wsCompression.js";
import { GZIP_MIN_BYTES } from "./routes/httpHelpers.js";
import { parseWsChannel, slimSnapshotForChannel, type WsChannel } from "./wsChannels.js";

export interface WsHub {
  /** An event to every Colonize window (`colonize` sockets), as `{ type: "colonize", event, payload }`. */
  pushColonize: (event: string, payload: unknown) => void;
  /** A topic for the `events` sockets: `read` builds what its endpoint answers (changeTopics.ts). */
  watchTopic: (topic: string, read: () => unknown) => void;
  /** Something a topic reads changed outside a state push (a POST): check the watched topics soon. */
  topicsMayHaveChanged: () => void;
  /** The revision of the last app-channel push; `/api/state/rev` lets a client check it cheaply (P2). */
  rev: () => number;
  /** The last full snapshot pushed or served, for `/api/match-detail` (building one is not free). */
  lastSnapshot: () => AppSnapshot | null;
  /** A snapshot at most a second old: a reconnect storm or a poller is not N rebuilds. */
  recentSnapshot: () => AppSnapshot;
  /** Starts the WebSocket server on the HTTP server (once, after the routes). */
  attach: (server: http.Server) => void;
  broadcast: (s: AppSnapshot) => void;
  /** The radar's own frame, straight to the HUD sockets. See {@link ExoLiveDTO}. */
  broadcastExoLive: (live: ExoLiveDTO) => void;
  /** A command for the app pages (key binds: previous / next body tab), to every app-channel socket. */
  broadcastUiCommand: (cmd: UiCommand) => void;
  /** Drops every socket (the quit; httpServer.ts closes the keep-alive HTTP connections). */
  closeConnections: () => void;
}

export function createWsHub(deps: {
  getSnapshot: () => AppSnapshot;
  lanKey: string | null;
  isOwnLanHost: (name: string) => boolean;
}): WsHub {
  const { lanKey, isOwnLanHost } = deps;
  /** Every frame goes out through here: small ones raw, big ones deflated where deflate was agreed (wsCompression.ts). */
  const sendFrame = (ws: WebSocket, msg: string): void => ws.send(msg, frameSendOptions(msg));
  const clients = new Set<WebSocket>();
  /** What each socket asked for with its hello; "app" (the full state) until it says otherwise. */
  const channelOf = new WeakMap<WebSocket, WsChannel>();
  /*
    Sockets that must get a whole frame on the next push, not a delta (combined plan 1.3). Pushes leave
    out what did not change since the previous *push*, but a socket that just connected (or changed
    channel) holds the snapshot it was sent then, and one that skipped a push for back-pressure holds
    an older one: a field that changed and changed back would stay stale for it.
  */
  const needsFull = new WeakSet<WebSocket>();
  /** Answered the last ping; a socket that misses one interval is a dead connection (a sleeping phone). */
  const alive = new WeakSet<WebSocket>();
  /** A slow LAN client gets no push while this much is still unsent to it. */
  const WS_BACKLOG_LIMIT = 8 * 1024 * 1024;
  let wss: WebSocketServer | null = null;

  /*
    Colonize's pushes (1.3.0): the depot snapshot, the buy-index scan status, an Inara import, to the sockets that
    said they are a Colonize window.
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

  /*
    The `events` sockets (R2, changeTopics.ts): pages told "this changed" for the topics they show, instead of asking
    on a timer. Kept apart from `clients`, which get the state pushes; these never get a snapshot.
  */
  const topics = new ChangeTopics();
  const eventSockets = new Map<WebSocket, Set<string>>();
  let topicsCheckedAt = 0;
  let topicsTimer: ReturnType<typeof setTimeout> | null = null;
  const checkTopics = () => {
    topicsTimer = null;
    topicsCheckedAt = Date.now();
    const wanted = new Set<string>();
    for (const t of eventSockets.values()) for (const k of t) wanted.add(k);
    if (!wanted.size) return;
    const changed = topics.changed(wanted);
    if (!changed.length) return;
    perfCount("ws.events.changed");
    for (const [ws, mine] of eventSockets) {
      const theirs = changed.filter((k) => mine.has(k));
      if (!theirs.length || ws.readyState !== ws.OPEN) continue;
      try {
        sendFrame(ws, JSON.stringify({ type: "changed", topics: theirs }));
      } catch {
        eventSockets.delete(ws);
      }
    }
  };
  /** At most one check a second: a state push can come four times a second while the game is busy. */
  const TOPICS_MIN_GAP_MS = 1000;
  const scheduleTopicsCheck = () => {
    if (topicsTimer || !eventSockets.size) return;
    topicsTimer = setTimeout(checkTopics, Math.max(0, topicsCheckedAt + TOPICS_MIN_GAP_MS - Date.now()));
    topicsTimer.unref?.();
  };

  /** An events socket: it says which topics it shows (`{ type: "watch", topics }`) and is told when one changes. */
  const acceptEventSocket = (ws: WebSocket) => {
    eventSockets.set(ws, new Set());
    perfCount("ws.events.connect");
    ws.on("error", () => eventSockets.delete(ws));
    ws.on("close", () => {
      eventSockets.delete(ws);
    });
    let answered = true;
    ws.on("pong", () => (answered = true));
    const ping = setInterval(() => {
      if (!answered) return void ws.terminate();
      answered = false;
      try {
        ws.ping();
      } catch {
        /* closing */
      }
    }, 25_000);
    ping.unref();
    ws.on("close", () => clearInterval(ping));
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: unknown; topics?: unknown };
        if (msg?.type !== "watch" || !Array.isArray(msg.topics)) return;
        const mine = new Set(msg.topics.filter((t): t is string => typeof t === "string" && topics.has(t)).slice(0, 32));
        const before = eventSockets.get(ws);
        eventSockets.set(ws, mine);
        // A topic nobody else shows starts a fresh baseline: the page has just read it.
        for (const t of mine) {
          if (before?.has(t)) continue;
          let elsewhere = false;
          for (const [other, theirs] of eventSockets) if (other !== ws && theirs.has(t)) elsewhere = true;
          if (!elsewhere) topics.forget(t);
        }
        scheduleTopicsCheck();
      } catch {
        /* not ours */
      }
    });
  };

  /** Counts pushes that went out on the app channel. */
  let pushRev = 0;
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

  /** The last full snapshot pushed or served, and when. */
  let lastAppSnap: AppSnapshot | null = null;
  let lastAppSnapAt = 0;
  const recentSnapshot = (): AppSnapshot => {
    if (!lastAppSnap || Date.now() - lastAppSnapAt > 1000) {
      lastAppSnap = deps.getSnapshot();
      lastAppSnapAt = Date.now();
    }
    return lastAppSnap;
  };

  const attach = (server: http.Server) => {
    if (wss) return;
    /**
     * Compress large frames only, and only for the LAN. A snapshot push is ~630 KB of repetitive JSON
     * (~85% smaller deflated), which matters for LAN clients; small frames go raw (sendFrame: the
     * `threshold` here does nothing without no_context_takeover), and this PC's own windows agree no
     * deflate at all (httpServer.ts's upgrade listener; wsCompression.ts).
     */
    wss = new WebSocketServer({
      server,
      path: "/ws",
      perMessageDeflate: { threshold: GZIP_MIN_BYTES, zlibDeflateOptions: { level: 4 } },
      // A client only ever sends a hello: the 100 MiB default would let one frame tie up the main thread.
      maxPayload: 64 * 1024,
      // The upgrade bypasses Express, so the same key check runs here. A paired browser sends the
      // cookie on the handshake; a script can pass ?k= or the header.
      verifyClient: ({ req }, done) => {
        // A web page can open a WebSocket to 127.0.0.1 from anywhere: its Origin must be ours (1.4).
        if (!requestOriginIsAllowed(req, isOwnLanHost, { checkOrigin: true })) done(false, 403, "Foreign origin");
        else if (requestIsAuthorized(req, lanKey)) done(true);
        else done(false, 401, "Access key required");
      },
    });
    wss.on("error", (e) => console.error("[edexo-compare] WebSocket server:", e instanceof Error ? e.message : e));

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
    /*
      What changes with no state push behind it (a file the game rewrote, a download's progress): looked at every few
      seconds while an events socket is open. Server-side only; nothing goes out unless a topic changed.
    */
    const topicsSweep = setInterval(scheduleTopicsCheck, 4000);
    topicsSweep.unref();
    server.once("close", () => {
      clearInterval(wsKeepAlive);
      clearInterval(topicsSweep);
      if (topicsTimer) clearTimeout(topicsTimer);
    });

    wss.on("connection", (ws, req) => {
      let wantsEvents = false;
      try {
        wantsEvents = new URL(req.url ?? "/ws", "http://x").searchParams.get("channel") === "events";
      } catch {
        /* a state socket */
      }
      if (wantsEvents) return acceptEventSocket(ws);
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
  };

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
    // A state push follows a change in the game or the app: the topics the open pages show may have moved too.
    scheduleTopicsCheck();
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
    for (const ws of wss?.clients ?? []) {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
    }
    wss?.close();
  };

  return {
    pushColonize,
    watchTopic: (topic, read) => topics.watch(topic, read),
    topicsMayHaveChanged: scheduleTopicsCheck,
    rev: () => pushRev,
    lastSnapshot: () => lastAppSnap,
    recentSnapshot,
    attach,
    broadcast,
    broadcastExoLive,
    broadcastUiCommand,
    closeConnections,
  };
}
