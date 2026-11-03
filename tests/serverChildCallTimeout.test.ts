/**
 * Main's calls into the server process give up after a while (review 2026-10-10 A12): a server that is alive but
 * stuck never replies and never exits, and "Wait, then close" waited on it for the rest of the run.
 */
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { startServerChild } = require("../electron/serverChild.cjs") as {
  startServerChild: (o: Record<string, unknown>) => Promise<Record<string, (...a: unknown[]) => Promise<unknown>>>;
};

/** A utility process that starts, and then answers only what `answer` says. */
function fakeChild(answer: (method: string) => unknown) {
  const child = Object.assign(new EventEmitter(), {
    kill: () => {},
    postMessage(m: { type: string; id?: number; method?: string }) {
      if (m.type === "start") queueMicrotask(() => child.emit("message", { type: "started", baseUrl: "http://x" }));
      if (m.type === "call") {
        const r = answer(m.method!);
        if (r !== undefined) queueMicrotask(() => child.emit("message", { type: "reply", id: m.id, result: r }));
      }
    },
  });
  return { fork: () => child, child };
}

const start = (proc: ReturnType<typeof fakeChild>) =>
  startServerChild({
    utilityProcess: proc,
    bundle: "app.cjs",
    mode: "server",
    argv: [],
    onHud: () => null,
    onDialog: () => {},
    onUnexpectedExit: () => {},
  });

afterEach(() => vi.useRealTimers());

describe("calls into the server process", () => {
  it("answer as before when the server replies", async () => {
    const rt = await start(fakeChild((m) => (m === "stagedUpdate" ? { version: "1.3.7" } : undefined)));
    await expect(rt.stagedUpdate!()).resolves.toEqual({ version: "1.3.7" });
  });

  it("give up when a live server never replies: a minute for a call, ten for the backup", async () => {
    vi.useFakeTimers();
    const rt = await start(fakeChild(() => undefined));
    const call = rt.boxelStep!(1);
    const backup = rt.whenBackupDone!();
    let callDone = false;
    let backupDone = false;
    call.catch(() => (callDone = true));
    backup.catch(() => (backupDone = true));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(callDone).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(callDone).toBe(true);
    await expect(call).rejects.toThrow(/did not answer "boxelStep"/);
    expect(backupDone).toBe(false);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    await expect(backup).rejects.toThrow(/whenBackupDone/);
  });

  it("fail at once when the server process ends", async () => {
    const proc = fakeChild(() => undefined);
    const rt = await start(proc);
    const call = rt.stagedUpdate!();
    proc.child.emit("exit", 1);
    await expect(call).rejects.toThrow("The server stopped.");
  });
});
