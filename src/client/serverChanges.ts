/**
 * Told when something changed, instead of asking on a timer (R2, owner 2026-10-24: "include those two R2 items in
 * 1.3.0"; server: src/server/changeTopics.ts).
 *
 * One small socket per page (`/ws?channel=events`), opened while anything on the page listens and closed when nothing
 * does. The page says which topics it shows; the server says when one of them changed, and the listener reads its
 * endpoint then. Any page can use it: the galaxy map in a window of its own has no state socket, which is why its
 * route and ship used to be polled.
 *
 * Topics: "galaxy-route", "galaxy-own", "neutron-live", "neutron-status", "commander-position", "ui-mirror".
 *
 * After a dropped connection every listener is called once, since a change may have gone by while it was down.
 */
type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
let socket: WebSocket | null = null;
let opened = false;
let retryMs = 1000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;

const topicsWanted = () => [...listeners.keys()];

function sendWatch(): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "watch", topics: topicsWanted() }));
}

function callAll(topics: Iterable<string>): void {
  for (const t of topics) for (const fn of [...(listeners.get(t) ?? [])]) fn();
}

function connect(): void {
  if (socket || typeof WebSocket === "undefined" || typeof window === "undefined") return;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${window.location.host}/ws?channel=events`);
  socket = ws;
  ws.onopen = () => {
    retryMs = 1000;
    sendWatch();
    // A reconnect: whatever changed while the socket was down was not announced.
    if (opened) callAll(topicsWanted());
    opened = true;
  };
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(String(e.data)) as { type?: string; topics?: unknown };
      if (msg.type === "changed" && Array.isArray(msg.topics)) callAll(msg.topics.filter((t) => typeof t === "string"));
    } catch {
      /* not ours */
    }
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    if (!listeners.size) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, retryMs);
    retryMs = Math.min(retryMs * 2, 10_000);
  };
}

function release(): void {
  if (listeners.size || closeTimer) return;
  // A drawer closing and another opening in the same moment keeps the socket.
  closeTimer = setTimeout(() => {
    closeTimer = null;
    if (listeners.size) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    const ws = socket;
    socket = null;
    opened = false;
    ws?.close();
  }, 2000);
}

/** Call `fn` when the server says `topic` changed; returns the unsubscribe (an effect's cleanup). */
export function onServerChange(topic: string, fn: Listener): () => void {
  let set = listeners.get(topic);
  const isNew = !set;
  if (!set) listeners.set(topic, (set = new Set()));
  set.add(fn);
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  if (socket) {
    if (isNew) sendWatch();
  } else connect();
  return () => {
    const s = listeners.get(topic);
    if (!s?.delete(fn)) return;
    if (!s.size) {
      listeners.delete(topic);
      sendWatch();
    }
    release();
  };
}
