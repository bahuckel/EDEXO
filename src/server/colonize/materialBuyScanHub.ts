import { freshMaterialBuyScanStatus, normalizeMaterialBuyScanStatus, type MaterialBuyScanQueueSlice, type MaterialBuyScanStatus } from "../../shared/colonize/materialBuyScanStatus";
import type { ColonizePush } from "./ipc/handlerTypes";

let status: MaterialBuyScanStatus = freshMaterialBuyScanStatus();
let lastBroadcastJson = "";
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
/** Where the status goes: every open Colonize window, through EDEXO's WebSocket (colonizeService.ts). */
let push: ColonizePush | null = null;

export function setMaterialBuyScanPush(fn: ColonizePush | null): void {
  push = fn;
}

export type MaterialBuyScanStatusPatch = Partial<Omit<MaterialBuyScanStatus, "passive" | "active">> & {
  passive?: Partial<MaterialBuyScanQueueSlice>;
  active?: Partial<MaterialBuyScanQueueSlice>;
};

function flushBroadcast(): void {
  broadcastTimer = null;
  const json = JSON.stringify(status);
  if (json === lastBroadcastJson) return;
  lastBroadcastJson = json;
  push?.("onMaterialBuyScanStatus", status);
}

function scheduleBroadcast(): void {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(flushBroadcast, 400);
}

export function getMaterialBuyScanStatus(): MaterialBuyScanStatus {
  return status;
}

export function patchMaterialBuyScanStatus(patch: MaterialBuyScanStatusPatch): MaterialBuyScanStatus {
  status = normalizeMaterialBuyScanStatus({
    ...status,
    ...patch,
    passive: patch.passive ? { ...status.passive, ...patch.passive } : status.passive,
    active: patch.active ? { ...status.active, ...patch.active } : status.active,
  });
  scheduleBroadcast();
  return status;
}
