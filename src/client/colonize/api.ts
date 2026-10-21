/**
 * The Colonize window's way to the server (1.3.0): the contract's methods over HTTP, its pushes over the app's
 * WebSocket on the `colonize` channel. Replaces EDEXO-Colonize's preload bridge (`window.colonize`), with the same
 * shape (`ColonizeApi`), so the hooks that came with it call it unchanged.
 *
 * Requests: `POST /api/colonize/rpc/<method>` `{ args }` -> `{ ok, result }` (src/server/routes/colonizeRoutes.ts).
 * The socket also carries a small slice of the app's state (where the ship is, the commander, the journal boot),
 * read here with `useColonizeAppState`.
 */
import { useSyncExternalStore } from "react";
import {
  COLONIZE_INVOKE,
  type ColonizeApi,
  type ColonizeEvents,
  type ColonizeInvoke,
  type ColonizeListeners,
} from "../../shared/colonize/ipc/contract";

/**
 * A paired phone or tablet: the page came from an address other than this PC's own, so the server lets it read and
 * not save (lanAuth.ts `localOnly`). `&phone=1` asks for the same view on the PC.
 */
export function colonizeReadOnly(loc: Pick<Location, "hostname" | "search"> = window.location): boolean {
  if (new URLSearchParams(loc.search).get("phone") === "1") return true;
  const h = loc.hostname.toLowerCase();
  return !(h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "[::1]" || h === "::1");
}

/** A request the server answered with a failure (not a method's own `{ ok: false }`, which comes back as a value). */
export class ColonizeRequestError extends Error {}

async function call(method: string, args: unknown[]): Promise<unknown> {
  const r = await fetch(`/api/colonize/rpc/${encodeURIComponent(method)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args }),
  });
  type Reply = { ok?: boolean; result?: unknown; error?: string };
  let j: Reply | null = null;
  try {
    j = (await r.json()) as Reply;
  } catch {
    /* below */
  }
  if (!r.ok || !j?.ok) throw new ColonizeRequestError(j?.error ?? `The server answered ${r.status}.`);
  return j.result;
}

const invoke = Object.fromEntries(
  Object.keys(COLONIZE_INVOKE).map((m) => [m, (...args: unknown[]) => call(m, args)]),
) as unknown as ColonizeInvoke;

/* ---- the socket ---------------------------------------------------------------------------------------------- */

type Listener = (payload: never) => void;
const listeners = new Map<keyof ColonizeEvents, Set<Listener>>();

/** The fields of the app's state the Colonize window shows (wsChannels.ts COLONIZE_KEYS). */
export type ColonizeAppState = {
  port?: number;
  mode?: string;
  journalBoot?: { phase?: string; done?: number; total?: number } | null;
  journalDir?: string;
  commanderName?: string | null;
  currentSystem?: string | null;
  currentSystemAddress?: number | null;
  currentRegion?: string | null;
  lastJournalEventIso?: string | null;
};
let appState: ColonizeAppState = {};
let connected = false;
const stateSubs = new Set<() => void>();
const notifyState = () => {
  for (const fn of stateSubs) fn();
};

let socket: WebSocket | null = null;
let retryMs = 500;
function connect(): void {
  if (socket || typeof window === "undefined") return;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${window.location.host}/ws?channel=colonize`);
  socket = ws;
  ws.onopen = () => {
    retryMs = 500;
    connected = true;
    // Older servers ignore the address; the hello names the channel either way.
    ws.send(JSON.stringify({ type: "hello", channel: "colonize" }));
    notifyState();
  };
  ws.onmessage = (ev) => {
    type Frame = { type?: string; event?: string; payload?: unknown };
    let msg: Frame | null = null;
    try {
      msg = JSON.parse(String(ev.data)) as Frame;
    } catch {
      return;
    }
    if (msg?.type === "colonize" && typeof msg.event === "string") {
      for (const fn of listeners.get(msg.event as keyof ColonizeEvents) ?? []) {
        try {
          fn(msg.payload as never);
        } catch (e) {
          console.error("[colonize] listener failed:", e);
        }
      }
    } else if (msg?.type === "state" && msg.payload && typeof msg.payload === "object") {
      appState = { ...appState, ...(msg.payload as ColonizeAppState) };
      notifyState();
    }
  };
  ws.onclose = () => {
    socket = null;
    connected = false;
    notifyState();
    setTimeout(connect, retryMs);
    retryMs = Math.min(10_000, retryMs * 2);
  };
  ws.onerror = () => ws.close();
}

function on<K extends keyof ColonizeEvents>(event: K, fn: (payload: ColonizeEvents[K]) => void): () => void {
  connect();
  let set = listeners.get(event);
  if (!set) listeners.set(event, (set = new Set()));
  set.add(fn as Listener);
  return () => set.delete(fn as Listener);
}

const listen: ColonizeListeners = {
  onUpdate: (fn) => on("onUpdate", fn),
  onMaterialBuyScanStatus: (fn) => on("onMaterialBuyScanStatus", fn),
  onInaraImport: (fn) => on("onInaraImport", fn),
  onUiState: (fn) => on("onUiState", fn),
};

/** What the Colonize window's components call: every contract method, every push. */
export const colonizeApi: ColonizeApi = { ...invoke, ...listen };

/** The app-state slice and whether the socket is up, for the header. */
export function useColonizeAppState(): { state: ColonizeAppState; connected: boolean } {
  connect();
  const state = useSyncExternalStore(
    (fn) => {
      stateSubs.add(fn);
      return () => stateSubs.delete(fn);
    },
    () => appState,
  );
  const up = useSyncExternalStore(
    (fn) => {
      stateSubs.add(fn);
      return () => stateSubs.delete(fn);
    },
    () => connected,
  );
  return { state, connected: up };
}
