/**
 * The commander dropdown's routes (per-commander profiles, 1.3.1): who is shown and who plays, and the switch — handed
 * to the desktop app (hudBridge `switchCommander`), refused with how-to where nothing can restart the server.
 */
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHttpServer } from "../src/server/httpServer.js";
import { setHudBridge, type HudBridge } from "../src/server/hudBridge.js";
import type { AppSnapshot, CommandersDTO } from "../src/shared/types.js";

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  setHudBridge(null);
  for (const c of closers.splice(0)) await c();
});

const COMMANDERS: CommandersDTO = {
  active: { fid: "F111", name: "Alpha" },
  game: { fid: "F222", name: "Bravo" },
  list: [
    { fid: "F222", name: "Bravo", files: 3 },
    { fid: "F111", name: "Alpha", files: 9 },
  ],
  canSwitch: false,
};

async function start() {
  const { server, listening } = createHttpServer({
    port: 0,
    bindHost: "127.0.0.1",
    getSnapshot: () => ({ n: 1 }) as unknown as AppSnapshot,
    getStatus: () => ({ ok: true }) as never,
    getCommanderPosition: () => null,
    getCommanderSystem: () => null,
    getCommanders: () => COMMANDERS,
  });
  await listening;
  closers.push(() => new Promise((r) => server.close(() => r())));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (base: string, fid: unknown) =>
  fetch(`${base}/api/commanders/switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fid }),
  });

describe("/api/commanders", () => {
  it("says who is shown, who plays, and every commander", async () => {
    const base = await start();
    const j = (await (await fetch(`${base}/api/commanders`)).json()) as CommandersDTO & { ok: boolean };
    expect(j.ok).toBe(true);
    expect(j.active?.name).toBe("Alpha");
    expect(j.game?.name).toBe("Bravo");
    expect(j.list.map((c) => c.fid)).toEqual(["F222", "F111"]);
  });
});

describe("/api/commanders/switch", () => {
  it("refuses a commander the journals do not name", async () => {
    const base = await start();
    const r = await post(base, "F999");
    expect(r.status).toBe(400);
  });

  it("says how where nothing can start the server again (console builds, dev)", async () => {
    const base = await start();
    const r = await post(base, "F222");
    expect(r.status).toBe(501);
    expect(((await r.json()) as { error: string }).error).toContain("EDEXO_COMMANDER=F222");
  });

  it("hands the switch to the desktop app", async () => {
    const switchCommander = vi.fn(() => ({ ok: true }));
    setHudBridge({ switchCommander } as unknown as HudBridge);
    const base = await start();
    const r = await post(base, "F222");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, commander: { fid: "F222", name: "Bravo" } });
    expect(switchCommander).toHaveBeenCalledWith({ fid: "F222" });
  });
});
