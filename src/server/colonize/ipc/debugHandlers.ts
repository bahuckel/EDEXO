/** The Options panel's Spansh system dump: fetch it, save it whole to a temp file, and hand the window a preview. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SpanshSystemDebugClientResult } from "../../../shared/colonize/spanshSystemDebugTypes";
import { persistSpanshDebugToBuyIndex } from "../persistDebugToBuyIndex";
import { fetchSpanshSystemDebug } from "../spanshSystemDebug";
import { errMessage, type ColonizeHandlers, type IpcContext } from "./handlerTypes";
import { asRecord, parseConstructionDepots } from "./payload";

const SPANSH_DEBUG_JSON = "spansh-debug-last.json";
const DEBUG_PREVIEW_MAX_CHARS = 120_000;

/**
 * Scratch, not state. A full system dump can be tens of megabytes and exists only so the
 * Options debug panel can offer "copy" and "save as"; keeping it in userData meant it sat
 * there for good. Temp is where a file like this belongs.
 */
export function spanshDebugJsonPath(): string {
  return path.join(os.tmpdir(), "edexo-colonize", SPANSH_DEBUG_JSON);
}

function buildDebugPreview(result: unknown, fullJsonBytes: number): string {
  const preview = JSON.stringify(result, null, 2);
  if (preview.length <= DEBUG_PREVIEW_MAX_CHARS) return preview;
  const mb = (fullJsonBytes / (1024 * 1024)).toFixed(1);
  return (
    preview.slice(0, DEBUG_PREVIEW_MAX_CHARS) +
    `\n\n… preview truncated (${mb} MB on disk — use Copy or Save JSON) …`
  );
}

export function debugHandlers({ store, buyIndex }: IpcContext) {
  return {
    debugSpanshSystem: async (payload) => {
      const p = asRecord(payload);
      const systemName = typeof p.systemName === "string" ? p.systemName.trim() : "";
      const includeStationMarkets = p.includeStationMarkets === true;
      const stationNameFilter = typeof p.stationNameFilter === "string" ? p.stationNameFilter.trim() : "";
      try {
        const result = await fetchSpanshSystemDebug({ systemName, includeStationMarkets, stationNameFilter });
        const fullJson = JSON.stringify(result, null, 2);
        const tempPath = spanshDebugJsonPath();
        await fs.mkdir(path.dirname(tempPath), { recursive: true });
        await fs.writeFile(tempPath, fullJson, "utf8");

        const liteCaptures = result.captures.map((c) => {
          if (!c.url.includes("/dump/")) return c;
          const bodyBytes = JSON.stringify(c.body ?? null).length;
          return {
            ...c,
            body: {
              _omittedFromPreview: true,
              _note: "Full dump body is in the saved JSON file (too large for UI).",
              _approxBytes: bodyBytes,
            },
          };
        });

        const lite: SpanshSystemDebugClientResult = {
          ...result,
          captures: liteCaptures,
          previewJson: buildDebugPreview({ ...result, captures: liteCaptures }, fullJson.length),
          fullJsonBytes: fullJson.length,
          tempJsonPath: tempPath,
        };

        if (result.ok && result.commoditySummary.length) {
          const snap = store.getSnapshot();
          const refs = [
            result.resolvedSystem,
            ...snap.activeDepots.map((d) => d.starSystem?.trim() || "").filter(Boolean),
            snap.liveDocked?.starSystem?.trim() || "",
            snap.navContext.starSystem?.trim() || "",
          ];
          const saved = await persistSpanshDebugToBuyIndex({
            index: buyIndex(),
            marketSystem: result.resolvedSystem,
            hits: result.commoditySummary,
            referenceSystems: refs,
            constructionDepots: parseConstructionDepots(snap.activeDepots ?? []),
          });
          return { ...lite, buyIndexRowsSaved: saved };
        }
        return lite;
      } catch (e) {
        return {
          ok: false as const,
          err: errMessage(e),
          requestedSystem: systemName,
          fetchedAtIso: new Date().toISOString(),
          captures: [],
          previewJson: "",
          fullJsonBytes: 0,
          tempJsonPath: null,
        };
      }
    },
  } satisfies Partial<ColonizeHandlers>;
}
