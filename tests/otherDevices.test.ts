/**
 * Nothing another device is sent carries the home folder (review 2026-11-10 C5): the journal file's and folder's paths,
 * on every channel including `?channel=launcher`, in `/api/status` and `/api/state` (nested error texts:
 * asyncErrors.test.ts). Decided by the peer's address, not by field or channel names; this PC's own windows keep
 * the paths.
 *
 * Another device without a LAN bind (which would raise a firewall prompt): the server-side socket's `remoteAddress` is
 * set to a LAN address as each connection arrives; with no access key set the server lets it in.
 */
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createHttpServer } from "../src/server/httpServer.js";
import { forOtherDevices } from "../src/server/otherDevices.js";
import type { AppSnapshot } from "../src/shared/types.js";

describe("forOtherDevices", () => {
  const home = String.raw`C:\Users\Someone`;
  it("hides a Windows home folder in plain text and in JSON, in either slash and any case", () => {
    const dir = String.raw`C:\Users\Someone\Saved Games\Frontier Developments\Elite Dangerous`;
    expect(forOtherDevices(JSON.stringify({ journalDir: dir }), home)).toBe(
      JSON.stringify({ journalDir: String.raw`~\Saved Games\Frontier Developments\Elite Dangerous` }),
    );
    expect(forOtherDevices(`open 'c:/users/someone/AppData/x.json'`, home)).toBe(`open '~/AppData/x.json'`);
    expect(forOtherDevices(String.raw`D:\Games\EDEXO\x.json`, home)).toBe(String.raw`D:\Games\EDEXO\x.json`);
  });
  it("hides a Linux home folder whole, its leading slash too", () => {
    expect(forOtherDevices(`"/home/someone/.local/share/x"`, "/home/someone")).toBe(`"~/.local/share/x"`);
  });
  it("leaves the text alone when the home folder is too short to be one", () => {
    expect(forOtherDevices(String.raw`C:\x`, "C:\\")).toBe(String.raw`C:\x`);
  });
});

const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

const journalDir = path.join(os.homedir(), "Saved Games", "Frontier Developments", "Elite Dangerous");
const journalPath = path.join(journalDir, "Journal.2026-11-10T101010.01.log");
const account = path.basename(os.homedir()).toLowerCase();

async function start(remote = true) {
  const snap = { journalDir, journalPath, port: 7111 } as unknown as AppSnapshot;
  const { server, listening } = createHttpServer({
    port: 0,
    bindHost: "127.0.0.1",
    getSnapshot: () => snap,
    getStatus: () => ({ journalDir, journalPath }) as never,
    getCommanderPosition: () => null,
    getCommanderSystem: () => null,
  });
  if (remote) server.prependListener("connection", (s) => Object.defineProperty(s, "remoteAddress", { value: "192.168.1.50" }));
  await listening;
  closers.push(() => new Promise((r) => server.close(() => r())));
  return `127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function firstFrame(url: string): Promise<string> {
  const ws = new WebSocket(url);
  closers.unshift(async () => ws.close());
  return new Promise((resolve, reject) => {
    ws.once("message", (d) => resolve(String(d)));
    ws.once("error", reject);
  });
}

describe("answers to another device", () => {
  it("carry no home folder on any route or channel, the launcher's included", async () => {
    const host = await start();
    const texts = [
      await (await fetch(`http://${host}/api/status`)).text(),
      await (await fetch(`http://${host}/api/state?channel=launcher`)).text(),
      await (await fetch(`http://${host}/api/state`)).text(),
      await firstFrame(`ws://${host}/ws?channel=launcher`),
      await firstFrame(`ws://${host}/ws?channel=app`),
    ];
    for (const t of texts) {
      expect(t.toLowerCase()).not.toContain(account);
      expect(t).toContain("Saved Games");
    }
    const status = JSON.parse(texts[0]!) as { journalDir: string };
    expect(status.journalDir).toBe(["~", "Saved Games", "Frontier Developments", "Elite Dangerous"].join(path.sep));
  });

  it("this PC's own windows keep the whole path", async () => {
    const host = await start(false);
    const status = (await (await fetch(`http://${host}/api/status`)).json()) as { journalPath: string };
    expect(status.journalPath).toBe(journalPath);
    const frame = JSON.parse(await firstFrame(`ws://${host}/ws?channel=launcher`)) as { payload: { journalDir: string } };
    expect(frame.payload.journalDir).toBe(journalDir);
  });
});
