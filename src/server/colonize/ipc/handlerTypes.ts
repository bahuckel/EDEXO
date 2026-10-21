import type { ColonizeEvents, ColonizeInvoke } from "../../../shared/colonize/ipc/contract";
import type { ColonizeStore } from "../colonizeStore";
import type { MaterialBuyIndex } from "../materialBuyIndex";

/** Push an event to every open Colonize window (EDEXO's WebSocket, colonizeService.ts). */
export type ColonizePush = <K extends keyof ColonizeEvents>(event: K, payload: ColonizeEvents[K]) => void;

/** What every handler group may reach. Built once in `colonizeService.ts`. */
export type IpcContext = {
  store: ColonizeStore;
  push: ColonizePush;
  /** Lazily created; the index file is large and startup loads it last. */
  buyIndex: () => MaterialBuyIndex;
  userDataDir: string;
};

/** Same arity as the window's signature, but nothing the window sends is trusted. */
type Untrusted<T extends readonly unknown[]> = { [I in keyof T]: unknown };

/**
 * The main-process side of `ColonizeInvoke`. Parameters are `unknown` (the renderer is not
 * trusted); the return value must be exactly what the renderer was promised.
 */
export type ColonizeHandlers = {
  [K in keyof ColonizeInvoke]: (
    ...args: Untrusted<Parameters<ColonizeInvoke[K]>>
  ) => ReturnType<ColonizeInvoke[K]> | Awaited<ReturnType<ColonizeInvoke[K]>>;
};

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
