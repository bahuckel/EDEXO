/**
 * @vitest-environment jsdom
 *
 * The window's half of phase 5 (uiStateSync.ts + shared/colonize/storage.ts): the first window seeds the server from
 * its browser, later ones take the server's copy (clearing what it cleared), listed keys save through batched, caches
 * stay local, and another window's saves land in storage while this window's own echo is ignored.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const TRIPS = "edexo-colonize-trip-plan-snapshot-v3";
const BANS = "edexo-colonize-banned-stations-v1";
const PARTY = "edexo-colonize-trade-party-v1";
const CACHE = "edexo-colonize-galaxy-dist-v2";

let pushed: ((p: { set: Record<string, string | null>; from: string | null }) => void) | null = null;
vi.mock("../../src/client/colonize/api", () => ({
  colonizeApi: {
    onUiState: (fn: typeof pushed) => {
      pushed = fn;
      return () => {};
    },
  },
}));

type Call = { method: string; body: unknown };
let calls: Call[] = [];
function serve(get: { values: Record<string, string>; seeded: boolean }) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(method === "GET" ? { ok: true, ...get } : { ok: true, changed: 1 }), { status: 200 });
    }),
  );
}

async function fresh() {
  vi.resetModules();
  pushed = null;
  const sync = await import("../../src/client/colonize/uiStateSync");
  const storage = await import("../../src/shared/colonize/storage");
  return { sync, storage };
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

describe("loading the server's copy", () => {
  it("first window ever: uploads what this browser has, listed keys only", async () => {
    localStorage.setItem(TRIPS, "old ticks");
    localStorage.setItem(CACHE, "{}");
    serve({ values: {}, seeded: false });
    const { sync } = await fresh();
    expect(await sync.loadColonizeUiState()).toBe("server");
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect((puts[0]!.body as { set: object }).set).toEqual({ [TRIPS]: "old ticks" });
  });

  it("later windows: the server wins, and a key it lacks was cleared", async () => {
    localStorage.setItem(TRIPS, "stale");
    localStorage.setItem(BANS, "stale bans");
    localStorage.setItem(CACHE, "{}");
    serve({ values: { [TRIPS]: "server ticks" }, seeded: true });
    const { sync } = await fresh();
    await sync.loadColonizeUiState();
    expect(localStorage.getItem(TRIPS)).toBe("server ticks");
    expect(localStorage.getItem(BANS)).toBeNull();
    expect(localStorage.getItem(CACHE)).toBe("{}");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("runs on this browser alone when the server cannot be asked", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    localStorage.setItem(TRIPS, "local");
    const { sync, storage } = await fresh();
    expect(await sync.loadColonizeUiState()).toBe("local");
    storage.storageSet(TRIPS, "changed");
    expect(localStorage.getItem(TRIPS)).toBe("changed");
  });
});

describe("read-only (a paired phone)", () => {
  it("takes the server's copy even before any window saved, uploads nothing and saves nothing", async () => {
    localStorage.setItem(TRIPS, "phone's own");
    localStorage.setItem(BANS, "phone's bans");
    serve({ values: { [TRIPS]: "pc ticks" }, seeded: false });
    const { sync, storage } = await fresh();
    expect(await sync.loadColonizeUiState({ readOnly: true })).toBe("server");
    expect(localStorage.getItem(TRIPS)).toBe("pc ticks");
    expect(localStorage.getItem(BANS)).toBeNull();
    storage.storageSet(TRIPS, "changed here");
    await new Promise((r) => setTimeout(r, 400));
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });
});

describe("saving", () => {
  it("sends listed keys batched, never caches, and skips unchanged values", async () => {
    serve({ values: { [PARTY]: "p" }, seeded: true });
    const { sync, storage } = await fresh();
    await sync.loadColonizeUiState();
    calls = [];
    storage.storageSet(TRIPS, "1");
    storage.storageSet(TRIPS, "2");
    storage.storageRemove(PARTY);
    storage.storageSet(CACHE, "{}");
    storage.storageRemove("edexo-colonize-banned-stations-v1"); // not there: nothing to say
    await new Promise((r) => setTimeout(r, 400));
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(puts[0]!.body).toEqual({ set: { [TRIPS]: "2", [PARTY]: null }, from: sync.COLONIZE_WINDOW_ID });
    calls = [];
    storage.storageSet(TRIPS, "2");
    await new Promise((r) => setTimeout(r, 400));
    expect(calls).toHaveLength(0);
  });
});

describe("another window's saves", () => {
  it("land in storage and are announced; this window's own echo is ignored", async () => {
    serve({ values: {}, seeded: true });
    const { sync } = await fresh();
    await sync.loadColonizeUiState();
    const heard: string[][] = [];
    sync.onRemoteUiState((keys) => heard.push(keys));
    pushed!({ set: { [TRIPS]: "mine" }, from: sync.COLONIZE_WINDOW_ID });
    expect(localStorage.getItem(TRIPS)).toBeNull();
    pushed!({ set: { [TRIPS]: "theirs", [BANS]: null }, from: "other" });
    expect(localStorage.getItem(TRIPS)).toBe("theirs");
    expect(heard).toEqual([[TRIPS, BANS]]);
    // Applying their change does not send it back.
    await new Promise((r) => setTimeout(r, 400));
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });
});
