/*
  The launcher's "Import Spansh export" job (split out of edexoBootstrap.ts, discuss item 30, 1.3.1).
*/
import { existsSync, readFileSync, statSync } from "node:fs";
import type { ImportDumpStatusDTO } from "../shared/types.js";
import { openFeeder } from "../feeder/pipeline.js";
import { formatImportReport, importSpanshExport } from "../feeder/spanshImport.js";
import { feederDataDirExists } from "../feeder/paths.js";
import { resolveImportDumpLedgerPath } from "./paths.js";
import { writeFileAtomic } from "./atomicWrite.js";

/*
  "Import Spansh export" from the launcher. Same importer and gates as `feeder -- import-dump`;
  runs in the background because the file is gigabytes, and one at a time because the feeder
  store is a single in-memory database written back on persist.
*/
export function createImportDumpJob(): {
  start: (file: string, apply: boolean) => { ok: boolean; error?: string };
  statusFor: (file?: string | null) => ImportDumpStatusDTO;
} {
  let importDump: ImportDumpStatusDTO = {
    running: false,
    file: null,
    apply: false,
    startedAt: null,
    finishedAt: null,
    report: null,
    error: null,
    lastImport: readImportDumpLedger(),
  };
  function readImportDumpLedger(): ImportDumpStatusDTO["lastImport"] {
    try {
      const j = JSON.parse(readFileSync(resolveImportDumpLedgerPath(), "utf8")) as Record<string, unknown>;
      if (j && typeof j.file === "string" && typeof j.finishedAt === "string") {
        return {
          file: j.file,
          finishedAt: j.finishedAt,
          fileMtimeIso: typeof j.fileMtimeIso === "string" ? j.fileMtimeIso : null,
          apply: j.apply === true,
        };
      }
    } catch {
      /* no import yet */
    }
    return null;
  }
  function fileMtimeIso(file: string | null | undefined): string | null {
    if (!file) return null;
    try {
      return statSync(file).mtime.toISOString();
    } catch {
      return null;
    }
  }
  function statusFor(file?: string | null): ImportDumpStatusDTO {
    const last = importDump.lastImport ?? null;
    const asked = file && file.trim() ? file.trim() : (last?.file ?? null);
    const mtime = fileMtimeIso(asked);
    const newerOnDisk =
      !!last && !!asked && !!mtime && !!last.fileMtimeIso && asked === last.file && mtime > last.fileMtimeIso;
    return { ...importDump, fileMtimeIso: mtime, newerOnDisk };
  }
  function start(file: string, apply: boolean): { ok: boolean; error?: string } {
    if (importDump.running) return { ok: false, error: "An import is already running." };
    if (!feederDataDirExists())
      return { ok: false, error: "No feeder corpus on this machine — this is a build-side tool." };
    if (!existsSync(file)) return { ok: false, error: `File not found: ${file}` };
    importDump = {
      running: true,
      file,
      apply,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      report: null,
      error: null,
    };
    void (async () => {
      try {
        const ctx = await openFeeder();
        const report = await importSpanshExport(ctx.store, file, { apply });
        const finishedAt = new Date().toISOString();
        const lastImport = { file, finishedAt, fileMtimeIso: fileMtimeIso(file), apply };
        try {
          writeFileAtomic(resolveImportDumpLedgerPath(), JSON.stringify(lastImport), "utf8");
        } catch {
          /* the status still says it; only the memory across runs is lost */
        }
        importDump = {
          ...importDump,
          running: false,
          finishedAt,
          report: formatImportReport(report, apply),
          failures: report.failures.length,
          matched: report.matched,
          changed: report.changed,
          lastImport,
        };
      } catch (e) {
        importDump = {
          ...importDump,
          running: false,
          finishedAt: new Date().toISOString(),
          error: e instanceof Error ? e.message : String(e),
        };
      }
    })();
    return { ok: true };
  }

  return { start, statusFor };
}
