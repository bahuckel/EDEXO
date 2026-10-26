/**
 * Copy diagnostics (combined plan, Phase 5): one block of text for a support message, with nothing
 * private in it — the home folder as ~, the commander as CMDR, no access key.
 */
import { describe, expect, it } from "vitest";
import { buildDiagnosticsText, redact, serverMemory, type DiagnosticsInput } from "../src/server/diagnostics.js";

const HOME = "C:\\Users\\Jane Doe";

const base: DiagnosticsInput = {
  now: new Date("2026-10-02T18:10:00Z"),
  version: "1.2.11",
  form: "zip",
  electron: "38.1.0",
  node: "22.19.0",
  platform: "win32",
  osRelease: "10.0.19045",
  arch: "x64",
  memGb: 32,
  journalDir: `${HOME}\\Saved Games\\Frontier Developments\\Elite Dangerous`,
  journalDirOk: true,
  journalDirChosen: false,
  journalFiles: 295,
  currentJournal: "Journal.2026-10-02T180000.01.log",
  historyPreset: "all",
  lastEventIso: "2026-10-02T18:09:00Z",
  boot: {
    path: "cache",
    summary: "list 295 files 12 ms · cache read 300 ms · total 1.4 s",
    at: "2026-10-02T18:00:05Z",
  },
  booting: null,
  mode: "server",
  port: 7111,
  bindHost: "0.0.0.0",
  lanAccess: { saved: true, active: false },
  gameRunning: true,
  uploads: { edsmFetch: true, edsmUpload: false, canonn: false, eddn: true },
  update: { latest: "1.2.11", checkedAt: "2026-10-02T18:00:00Z", error: null, download: "idle" },
  speciesCount: 118,
  speciesDataWarnings: 0,
  commander: "Jane Explorer",
  log: [
    {
      at: "2026-10-02T18:01:00Z",
      level: "warn",
      text: "Journal cache could not be read from C:/Users/Jane Doe/AppData",
    },
    {
      at: "2026-10-02T18:02:00Z",
      level: "error",
      text: "CMDR Jane Explorer: http://192.168.0.3:7111/?k=abcdef123 refused",
    },
  ],
};

describe("redact", () => {
  it("writes the home folder as ~ with either slash, any case", () => {
    expect(redact(`${HOME}\\x and c:/users/jane doe/y`, { home: HOME })).toBe("~\\x and ~/y");
  });

  it("replaces the commander and masks access keys", () => {
    expect(redact("Jane Explorer at /?k=secret&x=1", { home: HOME, commander: "Jane Explorer" })).toBe(
      "CMDR at /?k=…&x=1",
    );
  });
});

describe("buildDiagnosticsText", () => {
  const t = buildDiagnosticsText(base, HOME);

  it("says what support needs", () => {
    expect(t).toContain("EDEXO 1.2.11 — diagnostics, 2026-10-02 18:10 UTC");
    expect(t).toContain("Build: zip, Electron 38.1.0");
    expect(t).toContain("Journal folder: found (default) ~\\Saved Games");
    expect(t).toContain("Journals: 295 merged, history all");
    expect(t).toContain("Journal start (cache, 18:00:05 UTC): list 295 files");
    expect(t).toContain("Server: on the network, 0.0.0.0:7111, LAN access off (on after a restart)");
    expect(t).toContain("Uploads: EDSM fetch on, EDSM upload off, Canonn off, EDDN on");
    expect(t).toContain("Last 2 warning(s) / error(s):");
  });

  it("carries nothing private", () => {
    expect(t).not.toMatch(/Jane/i);
    expect(t).not.toContain("abcdef123");
    expect(t).toContain("CMDR CMDR");
  });

  it("is one fenced block", () => {
    expect(t.startsWith("```\n")).toBe(true);
    expect(t.trimEnd().endsWith("```")).toBe(true);
  });
});

describe("the server's memory line (2026-10-26)", () => {
  const mb = 1048576;
  const usage = { rss: 614 * mb, heapUsed: 98 * mb, arrayBuffers: 410 * mb, heapTotal: 0, external: 0 };
  const now = 2_000_000_000_000;

  it("says how much and whether the galaxy data is held, and since when", () => {
    const m = serverMemory({ held: true, lastTouch: now - 120_000, idleMs: 300_000, releasedCount: 2 }, usage, now);
    const t = buildDiagnosticsText({ ...base, memory: m });
    expect(t).toContain("Server memory: working set 614 MB, heap 98 MB, buffers 410 MB; galaxy data held, last used 2 min ago (let go 5 min after the last use)");
  });

  it("says when the galaxy data was let go, or never loaded", () => {
    const gone = serverMemory({ held: false, lastTouch: now - 45_000, idleMs: 300_000, releasedCount: 1 }, usage, now);
    expect(buildDiagnosticsText({ ...base, memory: gone })).toContain("galaxy data let go (last used 45 s ago)");
    const never = serverMemory({ held: false, lastTouch: 0, idleMs: 300_000, releasedCount: 0 }, usage, now);
    expect(buildDiagnosticsText({ ...base, memory: never })).toContain("galaxy data not loaded since start");
  });

  it("is left out when not given", () => {
    expect(buildDiagnosticsText(base)).not.toContain("Server memory");
  });
});
