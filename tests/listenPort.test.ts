/**
 * The port the server listens on when Windows has reserved 7111 (src/server/listenPort.ts; owner, 2026-11-22:
 * "permission denied" when starting the app, 7098–7197 in WinNAT's excluded ranges that day).
 */
import net from "node:net";
import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PORT,
  FALLBACK_PORTS,
  choosePort,
  portMovedNote,
  probePort,
  reservedPortMessage,
  type PortProbe,
} from "../src/server/listenPort.js";
import { launcherPrefsPath, readListenPort, writeListenPort, writeLauncherOpenMode, readLauncherOpenMode } from "../src/server/launcherPrefs.js";
import { electronRuntimeOptions, parseCli } from "../src/server/edexoBootstrap.js";

/** A probe that answers from a table: a port not listed is free. */
const table = (codes: Record<number, string>): PortProbe & { asked: number[] } => {
  const asked: number[] = [];
  const probe: PortProbe = async (port) => {
    asked.push(port);
    return codes[port] ?? null;
  };
  return Object.assign(probe, { asked });
};

describe("choosePort", () => {
  it("keeps the wanted port when it is free", async () => {
    const probe = table({});
    expect(await choosePort({ wanted: DEFAULT_PORT, explicit: false, host: "127.0.0.1", probe })).toEqual({ port: DEFAULT_PORT, movedFrom: null });
    expect(probe.asked).toEqual([DEFAULT_PORT]);
  });

  it("moves to the first free fallback when Windows has reserved the port", async () => {
    const probe = table({ [DEFAULT_PORT]: "EACCES", [FALLBACK_PORTS[0]!]: "EACCES" });
    expect(await choosePort({ wanted: DEFAULT_PORT, explicit: false, host: "0.0.0.0", probe })).toEqual({
      port: FALLBACK_PORTS[1],
      movedFrom: DEFAULT_PORT,
    });
  });

  it("goes back to 7111 first when a remembered port became reserved", async () => {
    const probe = table({ [FALLBACK_PORTS[0]!]: "EACCES" });
    expect(await choosePort({ wanted: FALLBACK_PORTS[0]!, explicit: false, host: "0.0.0.0", probe })).toEqual({
      port: DEFAULT_PORT,
      movedFrom: FALLBACK_PORTS[0],
    });
  });

  it("never moves off a port in use: that is another copy holding the same profile", async () => {
    const probe = table({ [DEFAULT_PORT]: "EADDRINUSE" });
    expect(await choosePort({ wanted: DEFAULT_PORT, explicit: false, host: "0.0.0.0", probe })).toEqual({ port: DEFAULT_PORT, movedFrom: null });
    expect(probe.asked).toEqual([DEFAULT_PORT]);
  });

  it("never moves off a port given with --port, and says why and how to free it", async () => {
    const probe = table({ 7300: "EACCES" });
    await expect(choosePort({ wanted: 7300, explicit: true, host: "0.0.0.0", probe })).rejects.toThrow(/Windows has reserved port 7300[\s\S]*--port[\s\S]*startport=7300/);
    expect(probe.asked).toEqual([7300]);
  });

  it("names every port tried when all are reserved", async () => {
    const all = Object.fromEntries([DEFAULT_PORT, ...FALLBACK_PORTS].map((p) => [p, "EACCES"]));
    await expect(choosePort({ wanted: DEFAULT_PORT, explicit: false, host: "0.0.0.0", probe: table(all) })).rejects.toThrow(
      new RegExp(FALLBACK_PORTS.join(", ")),
    );
  });
});

describe("messages", () => {
  it("gives the commands to free a reserved port", () => {
    const m = reservedPortMessage(7111, { explicit: false, tried: FALLBACK_PORTS });
    expect(m).toContain("net stop winnat");
    expect(m).toContain("netsh int ipv4 add excludedportrange protocol=tcp startport=7111 numberofports=1");
    expect(m).toContain("net start winnat");
    expect(m).toContain("permission denied");
  });

  it("tells the launcher about a move, and says nothing without one", () => {
    expect(portMovedNote(null, DEFAULT_PORT)).toBeNull();
    expect(portMovedNote(7111, 17111)).toMatch(/7111 is reserved by Windows.*17111.*phone/);
  });
});

describe("probePort", () => {
  it("answers null for a free port and EADDRINUSE for a taken one", async () => {
    const s = net.createServer();
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    const port = (s.address() as net.AddressInfo).port;
    try {
      expect(await probePort(port, "127.0.0.1")).toBe("EADDRINUSE");
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
    expect(await probePort(port, "127.0.0.1")).toBeNull();
  });
});

describe("remembered port", () => {
  it("is null until a move is saved, and keeps the other launcher choices", () => {
    rmSync(launcherPrefsPath(), { force: true });
    expect(readListenPort()).toBeNull();
    writeLauncherOpenMode("window");
    writeListenPort(17111);
    expect(readListenPort()).toBe(17111);
    expect(readLauncherOpenMode()).toBe("window");
    rmSync(launcherPrefsPath(), { force: true });
  });
});

describe("--port is marked explicit", () => {
  it("in the console build and the desktop app", () => {
    expect(parseCli(["--port", "7300"]).portExplicit).toBe(true);
    expect(parseCli([]).portExplicit).toBe(false);
    expect(electronRuntimeOptions("server", ["EDExoCompare.exe", "--port", "7300"], true).portExplicit).toBe(true);
    expect(electronRuntimeOptions("server", ["EDExoCompare.exe"], true).portExplicit).toBe(false);
  });
});
