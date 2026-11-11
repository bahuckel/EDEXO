/**
 * The foreground watcher off the main process (electron/foregroundWatch.cjs, watchForegroundOffMain; 2026-10-19:
 * starting PowerShell held Electron's main process for over a second right after the launcher window appeared).
 */
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
type At = { x: number; y: number } | null;
const fg = require("../electron/foregroundWatch.cjs") as {
  watchForegroundOffMain(
    up: { fork: (p: string, a?: string[], o?: object) => unknown },
    hostPath: string,
    onName: (name: string, at: At) => void,
  ): { stop(): void };
};

class FakeHost extends EventEmitter {
  killed = false;
  kill() {
    this.killed = true;
  }
}

describe.runIf(process.platform === "win32")("watchForegroundOffMain", () => {
  it("forks the host and passes its changes on, checked", () => {
    const host = new FakeHost();
    const forked: string[] = [];
    const seen: [string, At][] = [];
    const w = fg.watchForegroundOffMain(
      {
        fork: (p) => {
          forked.push(p);
          return host;
        },
      },
      "/x/foregroundHost.cjs",
      (name, at) => seen.push([name, at]),
    );
    expect(forked).toEqual(["/x/foregroundHost.cjs"]);
    host.emit("message", { name: "EliteDangerous64", at: { x: 1720, y: 700 } });
    host.emit("message", { name: "explorer", at: { x: "a", y: 1 } });
    host.emit("message", { nope: true });
    expect(seen).toEqual([
      ["EliteDangerous64", { x: 1720, y: 700 }],
      ["explorer", null],
    ]);
    w.stop();
    expect(host.killed).toBe(true);
  });

  // Review 2026-11-10 D7: a host that died after it worked was never replaced.
  it("starts a host that dies after it reported again", () => {
    const hosts: FakeHost[] = [];
    const w = fg.watchForegroundOffMain(
      {
        fork: () => {
          const h = new FakeHost();
          hosts.push(h);
          return h;
        },
      },
      "/x/h.cjs",
      () => {},
    );
    hosts[0]!.emit("message", { name: "EliteDangerous64" });
    hosts[0]!.emit("exit", 1);
    expect(hosts).toHaveLength(2);
    hosts[1]!.emit("exit", 1);
    hosts[2]!.emit("exit", 1);
    // Three restarts within the window (a fourth death hands over to the in-process watcher, not run here: it starts
    // PowerShell).
    expect(hosts).toHaveLength(4);
    w.stop();
    expect(hosts[3]!.killed).toBe(true);
  });

  it("stop ends a running host", () => {
    const host = new FakeHost();
    const w = fg.watchForegroundOffMain({ fork: () => host }, "/x/h.cjs", () => {});
    w.stop();
    expect(host.killed).toBe(true);
  });
});
