/** The Inara scrape folder: where it is, watching it, and importing a file by hand. */
import {
  defaultInaraImportDir,
  ensureInaraImportDir,
  importInaraJsonText,
  loadInaraImportDir,
  saveInaraImportDir,
  startInaraImportWatch,
  type InaraImportError,
  type InaraImportResult,
  type InaraImportWatch,
} from "../inaraImport";
import { openLocalFile } from "../../openUrl.js";
import type { ColonizeHandlers, IpcContext } from "./handlerTypes";
import { asRecord, trimmedString } from "./payload";

export type InaraWatchControl = {
  restart: () => Promise<void>;
  stop: () => void;
  notify: (r: InaraImportResult | InaraImportError) => void;
};

export function createInaraWatchControl({ push, buyIndex, userDataDir }: IpcContext): InaraWatchControl {
  let watch: InaraImportWatch | null = null;
  const notify = (r: InaraImportResult | InaraImportError) => push("onInaraImport", r);

  /**
   * Serialised, and the watcher in place is stopped only after the new one exists: reading
   * the current watcher before the await let two folder changes in quick succession each start a
   * watcher, leaking the first `fs.watch` and importing every scrape twice.
   */
  let chain: Promise<void> = Promise.resolve();
  const restart = (): Promise<void> => {
    const run = chain.then(async () => {
      const next = await startInaraImportWatch({ userDataDir, index: buyIndex(), onResult: notify });
      watch?.stop();
      watch = next;
    });
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const stop = () => {
    watch?.stop();
    watch = null;
  };

  return { restart, stop, notify };
}

export function inaraHandlers({ buyIndex, userDataDir }: IpcContext, inara: InaraWatchControl) {
  const dirResponse = (dir: string) => ({ ok: true as const, dir, defaultDir: defaultInaraImportDir() });

  return {
    getInaraImportDir: async () => {
      const dir = await loadInaraImportDir(userDataDir);
      await ensureInaraImportDir(dir);
      return dirResponse(dir);
    },

    /** A folder picked in the window (desktop: the folder dialog; browser: typed); null or "" = the default. */
    setInaraImportDir: async (dirArg) => {
      const picked = typeof dirArg === "string" ? dirArg.trim() : "";
      try {
        const dir = await saveInaraImportDir(userDataDir, picked || defaultInaraImportDir());
        await ensureInaraImportDir(dir);
        await inara.restart();
        return dirResponse(dir);
      } catch (e) {
        return { ok: false as const, err: e instanceof Error ? e.message : String(e) };
      }
    },

    openInaraImportDir: async () => {
      const dir = await loadInaraImportDir(userDataDir);
      await ensureInaraImportDir(dir);
      openLocalFile(dir);
      return { ok: true as const };
    },

    /** A scrape picked in the window, as its name and text (a file dialog cannot run in the server). */
    importInaraFile: async (payload) => {
      const p = asRecord(payload);
      const fileName = trimmedString(p.fileName) || "inara-scrape.json";
      const text = typeof p.text === "string" ? p.text : "";
      if (!text.trim()) return { ok: false as const, err: "The file is empty." };
      const result = await importInaraJsonText(buyIndex(), fileName, text);
      inara.notify(result);
      return result;
    },
  } satisfies Partial<ColonizeHandlers>;
}
