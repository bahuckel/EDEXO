import { existsSync, watch, type FSWatcher } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { commodityMergeBucket, commodityNormKey } from "../../shared/colonize/commodityKey";
import { parseInaraImportFile, INARA_INDEX_REF, type InaraImportFile } from "../../shared/colonize/inaraImportTypes";
import type { MaterialBuyStationHit } from "../../shared/colonize/materialBuyIndexTypes";
import { isCommanderBuyOffer } from "../../shared/colonize/stationSellOffer";
import { isGroundStyleType } from "../../shared/colonize/inaraStationIcon";
import { marketTimeIso } from "../../shared/colonize/marketAge";
import type { MaterialBuyIndex } from "./materialBuyIndex";
import { writeJsonAtomic } from "./jsonFs";

const SETTINGS_FILE = "inara-import-settings.json";

type InaraImportSettingsFile = {
  folder?: string;
};

export type InaraImportResult = {
  ok: true;
  fileName: string;
  commodityLabel: string;
  nearSystem: string;
  merged: number;
  skipped: number;
};

export type InaraImportError = { ok: false; fileName: string; err: string };

/**
 * The commander's Documents and Downloads folders. The desktop app's main process passes Windows' own (they can be
 * moved) at the server's fork (electron/main.cjs); a server started on its own falls back to the home folder's.
 */
function userFolder(kind: "documents" | "downloads"): string {
  const fromApp = kind === "documents" ? process.env.EDEXO_DOCUMENTS_DIR : process.env.EDEXO_DOWNLOADS_DIR;
  if (fromApp?.trim()) return fromApp.trim();
  return path.join(os.homedir(), kind === "documents" ? "Documents" : "Downloads");
}

export function defaultInaraImportDir(): string {
  return path.join(userFolder("documents"), "EdexoColonize", "inara");
}

/**
 * Where the Chrome helper drops its scrapes.
 *
 * The helper used to write wherever the commander pointed it, through a directory handle it
 * kept in inara.cz's own IndexedDB — which meant any script on inara.cz could write there too.
 * It now saves through `chrome.downloads`, which cannot leave the browser download directory,
 * so this path is fixed. Watching it alongside the configured folder keeps the helper working
 * without asking the commander to move anything.
 */
function extensionDropInaraDir(): string {
  return path.join(userFolder("downloads"), "EdexoColonize", "inara");
}

/** The configured folder, plus the fixed one the browser helper can reach. */
export async function watchedInaraImportDirs(userDataDir: string): Promise<string[]> {
  const configured = await loadInaraImportDir(userDataDir);
  const drop = extensionDropInaraDir();
  const seen = new Set<string>();
  return [configured, drop].filter((d) => {
    const key = path.resolve(d).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function settingsPath(userDataDir: string): string {
  return path.join(userDataDir, SETTINGS_FILE);
}

async function loadInaraImportSettings(userDataDir: string): Promise<InaraImportSettingsFile> {
  try {
    const raw = await fs.readFile(settingsPath(userDataDir), "utf8");
    const j = JSON.parse(raw) as InaraImportSettingsFile;
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

async function saveInaraImportSettings(userDataDir: string, patch: InaraImportSettingsFile): Promise<InaraImportSettingsFile> {
  const prev = await loadInaraImportSettings(userDataDir);
  const next: InaraImportSettingsFile = { ...prev, ...patch };
  await writeJsonAtomic(settingsPath(userDataDir), next, true);
  return next;
}

export async function loadInaraImportDir(userDataDir: string): Promise<string> {
  const j = await loadInaraImportSettings(userDataDir);
  if (typeof j.folder === "string" && j.folder.trim()) return j.folder.trim();
  return defaultInaraImportDir();
}

export async function saveInaraImportDir(userDataDir: string, folder: string): Promise<string> {
  const dir = folder.trim() || defaultInaraImportDir();
  await saveInaraImportSettings(userDataDir, { folder: dir });
  return dir;
}

async function unlinkJsonInDir(dir: string): Promise<number> {
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return 0;
  }
  let n = 0;
  for (const name of names) {
    if (!name.toLowerCase().endsWith(".json")) continue;
    try {
      await fs.unlink(path.join(dir, name));
      n += 1;
    } catch {
      /* */
    }
  }
  return n;
}

/** Remove pending + archived scrape JSON so a wipe is not undone on next launch. */
export async function deleteInaraImportJsonFiles(dir: string): Promise<number> {
  const pending = await unlinkJsonInDir(dir);
  const archived = await unlinkJsonInDir(path.join(dir, "imported"));
  return pending + archived;
}

export async function ensureInaraImportDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, "imported"), { recursive: true });
}

function applyInaraImportDoc(
  index: MaterialBuyIndex,
  doc: InaraImportFile,
): { id: string; merged: number; skipped: number } | { err: string } {
  const id =
    commodityMergeBucket(doc.commodityLabel) || commodityNormKey(doc.commodityLabel);
  if (!id) return { err: `Unknown commodity: ${doc.commodityLabel}` };
  const hits = hitsFromImport(doc);
  const skipped = doc.stations.length - hits.length;
  if (hits.length) {
    index.mergeStations(doc.nearSystem, id, doc.commodityLabel, hits);
    if (doc.nearSystem.trim().toLowerCase() !== INARA_INDEX_REF) {
      index.mergeStations(INARA_INDEX_REF, id, doc.commodityLabel, hits);
    }
  }
  return { id, merged: hits.length, skipped };
}

function hitsFromImport(doc: InaraImportFile): MaterialBuyStationHit[] {
  const out: MaterialBuyStationHit[] = [];
  for (const s of doc.stations) {
    const supply = s.supply != null && s.supply > 0 ? s.supply : null;
    let buyPrice = s.buyPrice != null && s.buyPrice > 0 ? s.buyPrice : null;
    if (supply && supply > 0 && buyPrice == null) buyPrice = 1;
    if (!isCommanderBuyOffer(supply, buyPrice)) continue;
    const stationType =
      s.styleType?.trim() ||
      s.stationType?.trim() ||
      (s.isFleetCarrier ? "Carrier" : "unknown");
    const isGround =
      s.isGround === true ||
      s.isPlanetaryOrGround === true ||
      isGroundStyleType(stationType);
    out.push({
      systemName: s.systemName,
      stationName: s.stationName,
      marketId: "",
      distanceLy: s.distanceLy,
      buyPrice,
      supply,
      spanshCommodity: doc.commodityLabel,
      dataSource: "inara",
      stationType,
      isPlanetaryOrGround: isGround,
      pad: s.pad?.trim() ? s.pad.trim().charAt(0).toUpperCase() : null,
      foundAtIso: doc.scrapedAt,
      // Inara's "Updated" cell is relative ("12 days ago"): saved as the time it means, counted from the scrape.
      marketUpdatedAt: marketTimeIso(s.marketUpdatedAt, doc.scrapedAt),
    });
  }
  return out;
}

export async function importInaraJsonFile(
  index: MaterialBuyIndex,
  filePath: string,
): Promise<InaraImportResult | InaraImportError> {
  const fileName = path.basename(filePath);
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (e) {
    return { ok: false, fileName, err: e instanceof Error ? e.message : String(e) };
  }
  return importInaraJsonText(index, fileName, text);
}

/** A scrape file's text, as picked in the Colonize window (or read from the watched folder above). */
export async function importInaraJsonText(
  index: MaterialBuyIndex,
  fileName: string,
  text: string,
): Promise<InaraImportResult | InaraImportError> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, fileName, err: e instanceof Error ? e.message : String(e) };
  }
  const doc = parseInaraImportFile(raw);
  if (!doc) return { ok: false, fileName, err: "Not a valid Edexo Inara scrape file." };
  await index.load();
  const applied = applyInaraImportDoc(index, doc);
  if ("err" in applied) return { ok: false, fileName, err: applied.err };
  if (applied.merged) await index.flush();
  return {
    ok: true,
    fileName,
    commodityLabel: doc.commodityLabel,
    nearSystem: doc.nearSystem,
    merged: applied.merged,
    skipped: applied.skipped,
  };
}

/** Merge JSON already sitting in the scrape folder (watch only sees new writes). */
async function importPendingInaraDirectory(
  index: MaterialBuyIndex,
  dir: string,
): Promise<InaraImportResult | InaraImportError | null> {
  await ensureInaraImportDir(dir);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    return {
      ok: false,
      fileName: dir,
      err: e instanceof Error ? e.message : String(e),
    };
  }
  const files = names.filter((n) => n.toLowerCase().endsWith(".json")).sort();
  if (!files.length) return null;

  await index.load();
  let merged = 0;
  let skipped = 0;
  let filesOk = 0;
  let lastLabel = "Inara scrapes";
  let lastNear = "local index";
  const errors: string[] = [];

  for (const name of files) {
    const full = path.join(dir, name);
    if (path.basename(path.dirname(full)).toLowerCase() === "imported") continue;
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(full, "utf8"));
    } catch (e) {
      errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const doc = parseInaraImportFile(raw);
    if (!doc) {
      errors.push(`${name}: Not a valid Edexo Inara scrape file.`);
      continue;
    }
    const applied = applyInaraImportDoc(index, doc);
    if ("err" in applied) {
      errors.push(`${name}: ${applied.err}`);
      continue;
    }
    merged += applied.merged;
    skipped += applied.skipped;
    filesOk += 1;
    lastLabel = doc.commodityLabel;
    lastNear = doc.nearSystem;
    try {
      await archiveImportedFile(full);
    } catch {
      /* keep the file if archive fails — next launch will retry */
    }
  }

  if (filesOk) await index.flush();
  if (!filesOk && errors.length) {
    return { ok: false, fileName: files[0]!, err: errors[0]! };
  }
  if (!filesOk) return null;
  return {
    ok: true,
    fileName: filesOk === 1 ? files[0]! : `${filesOk} files`,
    commodityLabel: filesOk === 1 ? lastLabel : `${filesOk} Inara scrapes`,
    nearSystem: lastNear,
    merged,
    skipped,
  };
}

export async function archiveImportedFile(filePath: string): Promise<void> {
  const dir = path.dirname(filePath);
  const destDir = path.join(dir, "imported");
  await fs.mkdir(destDir, { recursive: true });
  const dest = path.join(destDir, path.basename(filePath));
  try {
    await fs.rename(filePath, dest);
  } catch {
    await fs.copyFile(filePath, dest);
    await fs.unlink(filePath);
  }
}

export type InaraImportWatch = {
  stop: () => void;
};

const STABLE_POLL_MS = 250;
const STABLE_MAX_POLLS = 20;
const PARSE_ATTEMPTS = 3;
const PARSE_RETRY_BASE_MS = 400;

/** Wait until the file has stopped growing, so a scrape still being written is not parsed half-done. */
async function waitForStableFile(filePath: string): Promise<void> {
  let lastSize = -1;
  for (let i = 0; i < STABLE_MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, STABLE_POLL_MS));
    let size: number;
    try {
      size = (await fs.stat(filePath)).size;
    } catch {
      return;
    }
    if (size > 0 && size === lastSize) return;
    lastSize = size;
  }
}

export async function startInaraImportWatch(args: {
  userDataDir: string;
  index: MaterialBuyIndex;
  onResult: (r: InaraImportResult | InaraImportError) => void;
}): Promise<InaraImportWatch> {
  const dirs = await watchedInaraImportDirs(args.userDataDir);
  for (const dir of dirs) await ensureInaraImportDir(dir);
  const pending = new Set<string>();
  const watchers: FSWatcher[] = [];

  for (const dir of dirs) {
    try {
      const startup = await importPendingInaraDirectory(args.index, dir);
      if (startup) args.onResult(startup);
    } catch (e) {
      args.onResult({
        ok: false,
        fileName: dir,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const processFile = async (full: string) => {
    if (!full.toLowerCase().endsWith(".json")) return;
    if (path.basename(path.dirname(full)).toLowerCase() === "imported") return;
    if (pending.has(full)) return;
    pending.add(full);
    try {
      await waitForStableFile(full);
      if (!existsSync(full)) return;
      let result = await importInaraJsonFile(args.index, full);
      /**
       * A large scrape can still be growing when the watcher fires, and half a file parses as
       * invalid. Retrying with a widening pause turns that into an import instead of an error
       * the user only sees resolved on the next launch.
       */
      for (let attempt = 1; attempt < PARSE_ATTEMPTS && !result.ok; attempt++) {
        await new Promise((r) => setTimeout(r, PARSE_RETRY_BASE_MS * attempt));
        if (!existsSync(full)) return;
        result = await importInaraJsonFile(args.index, full);
      }
      if (result.ok) await archiveImportedFile(full);
      args.onResult(result);
    } catch (e) {
      args.onResult({
        ok: false,
        fileName: path.basename(full),
        err: e instanceof Error ? e.message : String(e),
      });
    } finally {
      pending.delete(full);
    }
  };

  for (const dir of dirs) {
    try {
      watchers.push(
        watch(dir, { persistent: true }, (_event, filename) => {
          if (!filename) return;
          const name = filename.toString();
          if (!name.toLowerCase().endsWith(".json")) return;
          void processFile(path.join(dir, name));
        }),
      );
    } catch (e) {
      args.onResult({
        ok: false,
        fileName: dir,
        err: `Could not watch Inara import folder: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return {
    stop: () => {
      for (const w of watchers) w.close();
      watchers.length = 0;
    },
  };
}
