/**
 * Per-commander profiles (1.3.1, owner 2026-10-25; plan docs/plan-25102026-commander-profiles.md): whose journal each
 * file is, the journal lists of one commander, the start's choice, and the move of the files from before 1.3.1.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chooseCommander, setActiveCommander } from "../src/server/activeCommander.js";
import { appDataExclusion } from "../src/server/backup.js";
import { migrateIntoCommanderFolder, pickCommanderForRun } from "../src/server/commanderMigration.js";
import {
  clearJournalHeads,
  filesOfCommander,
  gameCommander,
  isOtherCommandersJournal,
  journalOwners,
  listJournalCommanders,
} from "../src/server/journalCommanders.js";
import { listJournalFilesChronological } from "../src/server/journalWatcher.js";
import { commanderFolderName, resolveCommanderDataDir, resolveFootScannedPath } from "../src/server/paths.js";

const dirs: string[] = [];
const tmp = (p: string) => {
  const d = mkdtempSync(path.join(tmpdir(), p));
  dirs.push(d);
  return d;
};
const line = (o: object) => JSON.stringify(o) + "\r\n";
const header = (part = 1) => line({ timestamp: "2026-10-01T00:00:00Z", event: "Fileheader", part, gameversion: "4.4" });
const cmdr = (fid: string, name: string) =>
  line({ timestamp: "2026-10-01T00:00:01Z", event: "Commander", FID: fid, Name: name }) +
  line({ timestamp: "2026-10-01T00:00:02Z", event: "LoadGame", FID: fid, Commander: name });
const shutdown = line({ timestamp: "2026-10-01T01:00:00Z", event: "Shutdown" });

/** A journal folder: A, an empty main-menu session, B, B's part 2, A again (still running). */
function journals(): { dir: string; files: string[] } {
  const dir = tmp("edexo-cmdrs-j-");
  const write = (stamp: string, text: string) => {
    const f = path.join(dir, `Journal.2026-10-0${stamp}.01.log`);
    writeFileSync(f, text);
    return f;
  };
  const files = [
    write("1T100000", header() + cmdr("F111", "Alpha") + shutdown),
    write("2T100000", header() + shutdown),
    write("3T100000", header() + cmdr("F222", "Bravo") + line({ timestamp: "x", event: "Continued", Part: 2 })),
    write("3T120000", header(2) + line({ timestamp: "x", event: "FSDJump", StarSystem: "Sol" })),
    write("4T100000", header() + cmdr("F111", "Alpha") + line({ timestamp: "x", event: "Music" })),
  ];
  return { dir, files };
}

beforeEach(() => clearJournalHeads());
afterEach(() => {
  setActiveCommander(null);
  delete process.env.EDEXO_COMMANDER;
  delete process.env.EDEXO_USER_DATA_DIR;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("whose journal a file is", () => {
  it("its own commander; a later part the file before it's; an empty session nobody's", () => {
    const { files } = journals();
    expect(journalOwners(files).map((o) => o?.fid ?? null)).toEqual(["F111", null, "F222", "F222", "F111"]);
  });

  it("lists every commander, the one who played last first", () => {
    const { files } = journals();
    expect(listJournalCommanders(files)).toEqual([
      { fid: "F111", name: "Alpha", files: 2, lastFile: files[4] },
      { fid: "F222", name: "Bravo", files: 2, lastFile: files[3] },
    ]);
  });

  it("knows who the game is playing until the session shuts down", () => {
    const { files } = journals();
    expect(gameCommander(files)).toEqual({ fid: "F111", name: "Alpha" });
    writeFileSync(files[4]!, readFileSync(files[4]!, "utf8") + shutdown);
    expect(gameCommander(files)).toBeNull();
  });

  it("one commander's files keep the sessions that name nobody", () => {
    const { files } = journals();
    expect(filesOfCommander(files, "F222")).toEqual([files[1], files[2], files[3]]);
  });

  it("reads a journal another tool rewrote with spaces round the colons", () => {
    const dir = tmp("edexo-cmdrs-spaced-");
    const f = path.join(dir, "Journal.2026-10-06T100000.01.log");
    writeFileSync(f, '{ "event": "Fileheader", "part": 1 }\r\n{ "event": "Commander", "FID": "F333", "Name": "Charlie" }\r\n');
    expect(journalOwners([f])).toEqual([{ fid: "F333", name: "Charlie" }]);
    writeFileSync(f, readFileSync(f, "utf8") + '{ "event": "Shutdown" }\r\n');
    expect(gameCommander([f])).toBeNull();
  });

  it("spots another commander's session the live tail is following", () => {
    const dir = tmp("edexo-cmdrs-live-");
    const f = path.join(dir, "Journal.2026-10-05T100000.01.log");
    writeFileSync(f, header());
    expect(isOtherCommandersJournal(f, "F111")).toBe(false);
    writeFileSync(f, header() + cmdr("F222", "Bravo"));
    expect(isOtherCommandersJournal(f, "F111")).toBe(true);
    expect(isOtherCommandersJournal(f, "F222")).toBe(false);
  });
});

describe("one commander's journal list", () => {
  it("lists only the active commander's logs (and the empty sessions), in order", async () => {
    const { dir, files } = journals();
    setActiveCommander({ fid: "F111", name: "Alpha" });
    expect(await listJournalFilesChronological(dir)).toEqual([files[0], files[1], files[4]].map((f) => path.resolve(f!)));
    expect(await listJournalFilesChronological(dir, { minFileStartUtcMs: null, allCommanders: true })).toHaveLength(5);
    setActiveCommander(null);
    expect(await listJournalFilesChronological(dir)).toHaveLength(5);
  });
});

describe("the commander a start picks", () => {
  it("EDEXO_COMMANDER by FID or name, else the newest journal's", () => {
    const { files } = journals();
    expect(chooseCommander(files, undefined)?.fid).toBe("F111");
    expect(chooseCommander(files, "F222")?.fid).toBe("F222");
    expect(chooseCommander(files, "bravo")?.fid).toBe("F222");
    expect(chooseCommander(files, "nobody")?.fid).toBe("F111");
    expect(chooseCommander([], undefined)).toBeNull();
  });

  it("makes it active, and its files go into its own folder", async () => {
    const { dir } = journals();
    const appData = tmp("edexo-cmdrs-ud-");
    process.env.EDEXO_USER_DATA_DIR = appData;
    process.env.EDEXO_COMMANDER = "F222";
    writeFileSync(path.join(appData, "edexo-foot-scanned.json"), "{}");
    const c = await pickCommanderForRun(dir);
    expect(c?.name).toBe("Bravo");
    expect(resolveCommanderDataDir()).toBe(path.join(appData, "commanders", "F222"));
    expect(resolveFootScannedPath()).toBe(path.join(appData, "commanders", "F222", "edexo-foot-scanned.json"));
    expect(existsSync(resolveFootScannedPath())).toBe(true);
    expect(existsSync(path.join(appData, "edexo-foot-scanned.json"))).toBe(false);
  });
});

describe("moving the files from before 1.3.1", () => {
  it("moves the per-commander files and folders, and leaves the shared ones", () => {
    const appData = tmp("edexo-cmdrs-mig-");
    writeFileSync(path.join(appData, "edexo-notices.json"), "n");
    writeFileSync(path.join(appData, "edexo-compare-user-settings.json"), "s");
    mkdirSync(path.join(appData, "colonize"));
    writeFileSync(path.join(appData, "colonize", "edexo-colonize-state.json"), "c");
    expect(migrateIntoCommanderFolder(appData, "F111").sort()).toEqual(["colonize", "edexo-notices.json"]);
    const into = path.join(appData, "commanders", "F111");
    expect(readFileSync(path.join(into, "colonize", "edexo-colonize-state.json"), "utf8")).toBe("c");
    expect(existsSync(path.join(appData, "edexo-compare-user-settings.json"))).toBe(true);
    expect(migrateIntoCommanderFolder(appData, "F111")).toEqual([]);
  });

  it("a restored old backup's file wins; the commander's own copy stays beside it as .bak-", () => {
    const appData = tmp("edexo-cmdrs-restore-");
    const into = path.join(appData, "commanders", "F111");
    mkdirSync(into, { recursive: true });
    writeFileSync(path.join(into, "edexo-bookmarks.json"), "mine");
    writeFileSync(path.join(appData, "edexo-bookmarks.json"), "restored");
    migrateIntoCommanderFolder(appData, "F111", new Date("2026-10-25T12:00:00Z"));
    expect(readFileSync(path.join(into, "edexo-bookmarks.json"), "utf8")).toBe("restored");
    expect(readdirSync(into).filter((n) => n.includes(".bak-"))).toEqual(["edexo-bookmarks.json.bak-2026-10-25T12-00-00-000Z"]);
  });

  it("an FID never reaches outside the commanders folder", () => {
    expect(commanderFolderName("../../x")).toBe("______x");
    expect(commanderFolderName("F4783286")).toBe("F4783286");
  });
});

describe("backups of a commander's folder", () => {
  it("judge its files by the same names as the app data folder's", () => {
    const s = { includeKeys: false, includeBioBodies: false };
    expect(appDataExclusion("commanders/F111/.edexo-cache/journal-merge.meta.json", s)).toMatch(/cache/);
    expect(appDataExclusion("commanders/F111/edexo-compare-edsm-key.json", s)).toMatch(/key/);
    expect(appDataExclusion("commanders/F111/colonize/spansh-debug-last.json", s)).toMatch(/cache/);
    expect(appDataExclusion("commanders/F111/edexo-foot-scanned.json", s)).toBeNull();
  });
});
