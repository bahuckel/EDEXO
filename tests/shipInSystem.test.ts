/**
 * The ship in the current system for the Scan route (plan 1.3.5 R-1): the flight state from the journal, the netlog's
 * position lines, and the switch that sets the game's verbose netlog and puts the file back.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, appendFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GameStateStore } from "../src/server/gameState.js";
import { scanRouteShip } from "../src/server/shipInSystem.js";
import { createNetlogPosition, parseNetlogFix, withVerboseLogging } from "../src/server/netlogPosition.js";

const T = "2026-11-01T17:05:00Z";
const LINE =
  '{17:05:46GMT 39130.337s} System:"Lyaisa FA-Q d5-664" StarPos:(6119.406,271.563,31441.656)ly Body:1 RelPos:(-2.95826e+06,-959778,914984)km Supercruise';

describe("the ship's flight from the journal", () => {
  it("follows supercruise, drops, landings and docking, and the body targeted", () => {
    const s = new GameStateStore();
    s.apply({ timestamp: T, event: "FSDJump", StarSystem: "Here", SystemAddress: 77, StarPos: [0, 0, 0], BodyID: 0, Body: "Here A" } as never);
    expect(scanRouteShip(s, null)).toMatchObject({ addr: "77", atId: 0, flight: "supercruise", targetId: null, fix: null });
    s.statusDestination = { systemAddress: 77, bodyId: 3, name: "Here 3" };
    expect(scanRouteShip(s, null).targetId).toBe(3);
    s.apply({ timestamp: T, event: "SupercruiseExit", StarSystem: "Here", SystemAddress: 77, Body: "Here 3", BodyID: 3, BodyType: "Planet" } as never);
    expect(scanRouteShip(s, null)).toMatchObject({ atId: 3, flight: "normal" });
    s.apply({ timestamp: T, event: "Touchdown", StarSystem: "Here", SystemAddress: 77, Body: "Here 3", BodyID: 3, Latitude: 1, Longitude: 2 } as never);
    expect(scanRouteShip(s, null).flight).toBe("landed");
    s.apply({ timestamp: T, event: "Liftoff", StarSystem: "Here", SystemAddress: 77, Body: "Here 3", BodyID: 3 } as never);
    s.apply({ timestamp: T, event: "SupercruiseEntry", StarSystem: "Here", SystemAddress: 77 } as never);
    expect(scanRouteShip(s, null).flight).toBe("supercruise");
    // A target in another system is not this one's.
    s.statusDestination = { systemAddress: 78, bodyId: 3, name: "There 3" };
    expect(scanRouteShip(s, null).targetId).toBeNull();
  });
});

describe("the netlog's position lines", () => {
  it("reads the body and the distance, dated on the reading day", () => {
    const now = Date.parse("2026-11-01T17:06:00Z");
    const f = parseNetlogFix(LINE, now)!;
    expect(f).toMatchObject({ system: "Lyaisa FA-Q d5-664", bodyId: 1, mode: "supercruise", atMs: Date.parse("2026-11-01T17:05:46Z") });
    expect(f.distLs).toBeCloseTo(Math.hypot(2.95826e6, 959778, 914984) / 299_792.458, 6);
    // Read just after midnight: yesterday's line.
    expect(parseNetlogFix(LINE.replace("17:05:46", "23:59:58"), Date.parse("2026-11-02T00:00:03Z"))!.atMs).toBe(Date.parse("2026-11-01T23:59:58Z"));
    expect(parseNetlogFix("{17:05:46GMT 1.0s} joining island with 3 other members", now)).toBeNull();
  });

  it("turns the setting on in the game's settings file, whatever shape it has", () => {
    expect(withVerboseLogging(null)).toContain('<Network VerboseLogging="1" />');
    const has = '<AppConfig>\n\t<Network Port="0" VerboseLogging="0" />\n\t<Journal Address="0.0.0.0" Port="0" />\n</AppConfig>\n';
    expect(withVerboseLogging(has)).toBe(has.replace('VerboseLogging="0"', 'VerboseLogging="1"'));
    expect(withVerboseLogging(has.replace('VerboseLogging="0"', 'VerboseLogging="1"'))).toBeNull();
    const bare = '<AppConfig>\n\t<Network Port="0" />\n</AppConfig>\n';
    expect(withVerboseLogging(bare)).toContain('<Network VerboseLogging="1" Port="0" />');
    expect(withVerboseLogging("<AppConfig>\n</AppConfig>\n")).toContain('\t<Network VerboseLogging="1" />\n</AppConfig>');
    expect(withVerboseLogging("not xml")).toBeNull();
  });

  it("switches on, reads the newest log's position, and switching off puts the file back", () => {
    const game = mkdtempSync(join(tmpdir(), "edexo-netlog-"));
    const logs = join(game, "Logs");
    mkdirSync(logs);
    const cfg = join(game, "AppConfigLocal.xml");
    const before = '<AppConfig>\n\t<Network Port="0" />\n</AppConfig>\n';
    writeFileSync(cfg, before);
    const log = join(logs, "netLog.2026-11-01T080000.01.log");
    writeFileSync(log, "{17:00:00GMT 1.0s} some other line\n");
    const n = createNetlogPosition({ pollMs: 60_000, findDirs: () => [game] });
    expect(n.status().state).toBe("off");
    expect(n.setOn(true)).toMatchObject({ on: true, state: "waiting", folder: game });
    expect(readFileSync(cfg, "utf8")).toContain('VerboseLogging="1"');
    appendFileSync(log, `${LINE}\n`);
    // The next tick reads it: turn it off and on again to tick at once.
    n.dispose();
    n.setOn(true);
    expect(n.fix()).toMatchObject({ bodyId: 1, system: "Lyaisa FA-Q d5-664" });
    expect(n.status().state).toBe("reading");
    expect(n.setOn(false).state).toBe("off");
    expect(readFileSync(cfg, "utf8")).toBe(before);
    n.dispose();
  });

  it("starts as failed, not waiting, when the setting it saved as on is not in the game's file (code review 2026-11-02)", () => {
    const game = mkdtempSync(join(tmpdir(), "edexo-netlog-"));
    mkdirSync(join(game, "Logs"));
    const cfg = join(game, "AppConfigLocal.xml");
    const plain = '<AppConfig>\n\t<Network Port="0" />\n</AppConfig>\n';
    writeFileSync(cfg, plain);
    const first = createNetlogPosition({ pollMs: 60_000, findDirs: () => [game] });
    first.setOn(true);
    first.dispose();
    // The write did not hold (a read-only folder, or put back since): the next run must say so.
    writeFileSync(cfg, plain);
    const next = createNetlogPosition({ pollMs: 60_000, findDirs: () => [game] });
    expect(next.status().state).toBe("failed");
    next.setOn(false);
    next.dispose();
  });

  it("dates an old session's lines on the day its log was written, not today (code review 2026-11-02)", () => {
    const game = mkdtempSync(join(tmpdir(), "edexo-netlog-"));
    const logs = join(game, "Logs");
    mkdirSync(logs);
    writeFileSync(join(game, "AppConfigLocal.xml"), '<AppConfig>\n\t<Network Port="0" />\n</AppConfig>\n');
    const log = join(logs, "netLog.2026-10-29T080000.01.log");
    writeFileSync(log, `${LINE}\n`);
    const written = new Date(Date.now() - 3 * 86_400_000);
    utimesSync(log, written, written);
    const n = createNetlogPosition({ pollMs: 60_000, findDirs: () => [game] });
    n.setOn(true);
    // Within the day before the log's last write (its 17:05 clock time, written by then), not today.
    expect(n.fix()!.atMs).toBeLessThanOrEqual(written.getTime() + 60_000);
    expect(n.fix()!.atMs).toBeGreaterThan(written.getTime() - 86_400_000);
    n.setOn(false);
    n.dispose();
  });

  it("leaves a settings file alone that was changed after the switch wrote it, and removes one it created", () => {
    const game = mkdtempSync(join(tmpdir(), "edexo-netlog-"));
    mkdirSync(join(game, "Logs"));
    const cfg = join(game, "AppConfigLocal.xml");
    const n = createNetlogPosition({ pollMs: 60_000, findDirs: () => [game] });
    n.setOn(true);
    expect(existsSync(cfg)).toBe(true);
    n.setOn(false);
    expect(existsSync(cfg)).toBe(false);
    n.setOn(true);
    writeFileSync(cfg, `${readFileSync(cfg, "utf8")}<!-- his own -->\n`);
    n.setOn(false);
    expect(readFileSync(cfg, "utf8")).toContain("his own");
    n.dispose();
  });
});

describe("the body the ship was last near (owner, 2026-11-01: overshooting a planet put the ship at the main star)", () => {
  const fix = (bodyId: number, distLs: number, atMs: number) => ({ system: "Here", bodyId, distLs, mode: "supercruise" as const, atMs });
  const netlog = (last: ReturnType<typeof fix>, near: ReturnType<typeof fix> | null) => ({
    fix: () => last,
    near: () => near,
    status: () => ({ on: true, state: "reading" as const, folder: null }),
    setOn: () => ({ on: true, state: "reading" as const, folder: null }),
    dispose: () => undefined,
  });

  it("stays at the body flown near when the game measures from a far star after it", () => {
    const s = new GameStateStore();
    s.apply({ timestamp: "2026-11-01T15:10:00Z", event: "FSDJump", StarSystem: "Here", SystemAddress: 77, StarPos: [0, 0, 0], BodyID: 0, Body: "Here A" } as never);
    const t = Date.parse("2026-11-01T15:13:31Z");
    // Past B 2 (body 9, 0.9 ls), then the game measures from body 0, 47,000 ls off.
    const v = scanRouteShip(s, netlog(fix(0, 47_000, t + 60_000), fix(9, 0.9, t)));
    expect(v.atId).toBe(9);
    expect(v.fix).toMatchObject({ refId: 0, distLs: 47_000 });
    // Near the main star again: there.
    expect(scanRouteShip(s, netlog(fix(0, 3, t + 120_000), fix(0, 3, t + 120_000))).atId).toBe(0);
  });

  it("never puts the ship at a barycentre the game measures from (owner 2026-11-05: body 8, 8.3 ls off)", () => {
    const s = new GameStateStore();
    s.apply({ timestamp: "2026-11-05T18:49:33Z", event: "FSDJump", StarSystem: "Here", SystemAddress: 77, StarPos: [0, 0, 0], BodyID: 1, Body: "Here A" } as never);
    // The FSS found barycentre 8 (A 5 and A 6 orbit it).
    s.apply({ timestamp: "2026-11-05T18:50:54Z", event: "ScanBaryCentre", StarSystem: "Here", SystemAddress: 77, BodyID: 8, SemiMajorAxis: 279303371906.28 } as never);
    const t = Date.parse("2026-11-05T18:54:17Z");
    const v = scanRouteShip(s, netlog(fix(8, 8.29, t), fix(8, 8.29, t)));
    expect(v.atId).not.toBe(8);
    expect(v.atFrom).toBe("journal");
    // The planet itself, within 10 ls: there, by the netlog.
    expect(scanRouteShip(s, netlog(fix(9, 1.16, t + 22_000), fix(9, 1.16, t + 22_000)))).toMatchObject({ atId: 9, atFrom: "netlog" });
  });

  it("takes the journal's body when it is newer than the near fix", () => {
    const s = new GameStateStore();
    s.apply({ timestamp: "2026-11-01T15:10:00Z", event: "FSDJump", StarSystem: "Here", SystemAddress: 77, StarPos: [0, 0, 0], BodyID: 0, Body: "Here A" } as never);
    const t = Date.parse("2026-11-01T15:11:00Z");
    s.apply({ timestamp: "2026-11-01T15:14:38Z", event: "ApproachBody", StarSystem: "Here", SystemAddress: 77, Body: "Here 4", BodyID: 4 } as never);
    expect(scanRouteShip(s, netlog(fix(9, 0.9, t), fix(9, 0.9, t))).atId).toBe(4);
  });
});
