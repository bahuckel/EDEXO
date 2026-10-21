/**
 * `/api/colonize/*` — the Colonize window's way to the server (1.3.0; was Electron IPC in EDEXO-Colonize).
 *
 * One route per contract method: `POST /api/colonize/rpc/<method>` with `{ args: [...] }` answers
 * `{ ok: true, result }`. The handlers are the contract's (src/shared/colonize/ipc/contract.ts), so a method the
 * contract does not name is a 404, and the window's client is built from the same list. Pushes (the depot snapshot,
 * the scan status, an Inara import) go out on the `colonize` WebSocket channel (RouteContext.pushColonize).
 *
 * The first request starts the service (colonizeService.ts); nothing runs before a window asks. From a paired
 * phone or tablet the read-only methods work; bodies up to 8 MB (httpServer.ts mounts that parser before the
 * global 48 kB one); anything that writes, reaches the network or touches files is for the
 * PC running the app, like the rest of the app's settings (lanAuth.ts `localOnly`).
 */
import express from "express";
import type { HttpServerOptions, RouteContext } from "../httpServer.js";
import { DEFAULT_JOURNAL_DIR } from "../journalDirPreference.js";
import { localOnly } from "../lanAuth.js";
import { COLONIZE_INVOKE, type ColonizeEvents } from "../../shared/colonize/ipc/contract";
import { colonizeService, colonizeServiceRunning } from "../colonize/colonizeService";
import type { ColonizeHandlers } from "../colonize/ipc/handlerTypes";
import { colonizeUiState } from "../colonize/uiState";
import { refreshColonizeHud } from "../colonize/hudSummary";

/** What a paired phone or tablet may call: reads of what the server already holds, nothing else. */
export const COLONIZE_LAN_READ: ReadonlySet<keyof ColonizeHandlers> = new Set<keyof ColonizeHandlers>([
  "getSnapshot",
  "getMaterialBuyScanStatus",
  "readMarketSupplyBrief",
  "searchBuyIndexMaterial",
  "searchBuyIndexSystem",
  "searchBuyIndexMaterialStations",
  "searchBuyIndexStationsForMaterials",
  "getBuyIndexStationCatalog",
  "getInaraImportDir",
]);

export function isColonizeMethod(name: string): name is keyof ColonizeHandlers {
  return Object.prototype.hasOwnProperty.call(COLONIZE_INVOKE, name);
}

/** Who may call a method: nobody (not in the contract), anyone paired (a read), or only the PC running the app. */
export function colonizeMethodAccess(name: string): "unknown" | "lan" | "local" {
  if (!isColonizeMethod(name)) return "unknown";
  return COLONIZE_LAN_READ.has(name) ? "lan" : "local";
}

export function registerColonizeRoutes(app: express.Express, opts: HttpServerOptions, ctx: RouteContext): void {
  const service = () =>
    colonizeService({
      journalDir: () => opts.getJournalDir?.() ?? DEFAULT_JOURNAL_DIR,
      push: <K extends keyof ColonizeEvents>(event: K, payload: ColonizeEvents[K]) => ctx.pushColonize(event, payload),
      ownColonies: () =>
        (opts.getJournalStore?.()?.ownAssets.colonies ?? []).map((c) => ({ name: c.name, systemAddress: c.addr, claimedAt: c.at })),
    });

  app.get("/api/colonize/status", (_req, res) => {
    res.json({ ok: true, running: colonizeServiceRunning() });
  });

  /*
    The window's settings and progress (phase 5, uiState.ts). Not part of the service: reading them starts no journal
    reader. A paired phone may read them; saving is for the PC, like every other write here.
  */
  app.get("/api/colonize/ui-state", (_req, res) => {
    const state = colonizeUiState();
    res.json({ ok: true, values: state.all(), seeded: state.seeded });
  });
  app.put("/api/colonize/ui-state", localOnly, (req, res) => {
    const body = (req.body ?? {}) as { set?: unknown; from?: unknown };
    const set = colonizeUiState().apply(body.set);
    const from = typeof body.from === "string" ? body.from.slice(0, 64) : null;
    if (Object.keys(set).length) {
      ctx.pushColonize("onUiState", { set, from } satisfies ColonizeEvents["onUiState"]);
      refreshColonizeHud(); // the trip ticks and the hold override are in here
    }
    res.json({ ok: true, changed: Object.keys(set).length });
  });

  app.post(
    "/api/colonize/rpc/:method",
    (req, res, next) => {
      const method = String(req.params.method ?? "");
      const access = colonizeMethodAccess(method);
      if (access === "unknown") {
        res.status(404).json({ ok: false, error: `No Colonize method "${method}".` });
        return;
      }
      if (access === "lan") next();
      else localOnly(req, res, next);
    },
    async (req, res) => {
      const method = String(req.params.method) as keyof ColonizeHandlers;
      const body = (req.body ?? {}) as { args?: unknown };
      const args = Array.isArray(body.args) ? body.args : [];
      const handler = service().handlers[method] as (...a: unknown[]) => unknown;
      try {
        res.json({ ok: true, result: (await handler(...args)) ?? null });
      } catch (e) {
        console.error(`[colonize] ${method} failed:`, e);
        res.status(500).json({ ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    },
  );
}
