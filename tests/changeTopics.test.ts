/**
 * R2 (owner 2026-10-24): pages are told when what they show changed, instead of asking on a timer
 * (src/server/changeTopics.ts, the `events` sockets in httpServer.ts, client/serverChanges.ts).
 */
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ChangeTopics } from "../src/server/changeTopics.js";
import { createHttpServer } from "../src/server/httpServer.js";
import type { AppSnapshot } from "../src/shared/types.js";

describe("ChangeTopics", () => {
  it("reports a topic once its answer differs from the last check, not on the first look", () => {
    const t = new ChangeTopics();
    let pos = { x: 1 };
    t.watch("commander-position", () => pos);
    expect(t.changed(["commander-position"])).toEqual([]);
    expect(t.changed(["commander-position"])).toEqual([]);
    pos = { x: 2 };
    expect(t.changed(["commander-position"])).toEqual(["commander-position"]);
    expect(t.changed(["commander-position"])).toEqual([]);
  });

  it("skips unknown topics and a reader that throws, and starts over after forget", () => {
    const t = new ChangeTopics();
    let n = 0;
    t.watch("a", () => n);
    t.watch("bad", () => {
      throw new Error("no store yet");
    });
    expect(t.changed(["a", "bad", "nope"])).toEqual([]);
    n = 1;
    t.forget("a");
    expect(t.changed(["a"])).toEqual([]);
    n = 2;
    expect(t.changed(["a", "bad"])).toEqual(["a"]);
  });
});

describe("the events socket", () => {
  it("gets no state, and hears of a change only to the topics it watches", async () => {
    let pos: { x: number; y: number; z: number } | null = { x: 0, y: 0, z: 0 };
    const { server, listening, broadcast, closeConnections } = createHttpServer({
      port: 0,
      bindHost: "127.0.0.1",
      getSnapshot: () => ({ port: 1, bodies: [] }) as unknown as AppSnapshot,
      getStatus: () => ({}) as never,
      getCommanderPosition: () => pos,
      getCommanderSystem: () => "Sol",
    });
    await listening;
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const open = async (watch: string[]) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?channel=events`);
      const msgs: { type: string; topics?: string[] }[] = [];
      ws.on("message", (d) => msgs.push(JSON.parse(String(d))));
      await new Promise((r) => ws.once("open", r));
      ws.send(JSON.stringify({ type: "watch", topics: watch }));
      return { ws, msgs };
    };
    const until = async (ok: () => boolean) => {
      for (let i = 0; i < 60 && !ok(); i++) await new Promise((r) => setTimeout(r, 50));
    };
    try {
      const ship = await open(["commander-position"]);
      const mirror = await open(["ui-mirror"]);
      await new Promise((r) => setTimeout(r, 1200)); // the first check sets the baselines

      // A jump: the next state push looks at the topics.
      pos = { x: 10, y: 0, z: 0 };
      broadcast({ port: 1, bodies: [] } as unknown as AppSnapshot);
      await until(() => ship.msgs.length > 0);
      expect(ship.msgs).toEqual([{ type: "changed", topics: ["commander-position"] }]);

      // A setting saved by the streamer's app: no state push behind it, the POST asks for a check.
      const r = await fetch(`${base}/api/ui/mirror`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { "edexo.units": "ly" } }),
      });
      expect(r.ok).toBe(true);
      await until(() => mirror.msgs.length > 0);
      expect(mirror.msgs).toEqual([{ type: "changed", topics: ["ui-mirror"] }]);
      // Neither socket was sent a snapshot, nor the other's topic.
      expect(ship.msgs.every((m) => m.type === "changed" && m.topics?.join() === "commander-position")).toBe(true);
      ship.ws.close();
      mirror.ws.close();
    } finally {
      closeConnections();
      await new Promise((r) => server.close(r));
    }
  });
});

describe("the on-foot scans on their own (item 22)", () => {
  it("answers /api/foot-scanned with the snapshot's list, for the Colonize window's Encyclopedia and My exobiology", async () => {
    const entries = [{ speciesName: "Stratum Tectonicas", systemName: "Sol" }];
    const { server, listening, closeConnections } = createHttpServer({
      port: 0,
      bindHost: "127.0.0.1",
      getSnapshot: () => ({ port: 1, bodies: [], footScannedEntries: entries }) as unknown as AppSnapshot,
      getStatus: () => ({}) as never,
      getCommanderPosition: () => null,
      getCommanderSystem: () => null,
    });
    await listening;
    try {
      const port = (server.address() as AddressInfo).port;
      const j = (await (await fetch(`http://127.0.0.1:${port}/api/foot-scanned`)).json()) as { entries: unknown[] };
      expect(j.entries).toEqual(entries);
      const shell = (await (await fetch(`http://127.0.0.1:${port}/api/state?channel=shell`)).json()) as Record<string, unknown>;
      expect(shell.footScannedEntries).toBeUndefined();
      expect(shell.port).toBe(1);
    } finally {
      closeConnections();
      await new Promise((r) => server.close(r));
    }
  });
});
