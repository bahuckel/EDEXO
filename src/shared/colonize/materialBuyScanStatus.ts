export type MaterialBuyScanPhase = "idle" | "queued" | "scanning" | "saving" | "error";

export type MaterialBuyScanQueueSlice = {
  phase: MaterialBuyScanPhase;
  /** Construction / reference system this queue is scanning near. */
  referenceSystem: string | null;
  commodityLabel: string | null;
  done: number;
  total: number;
  /** Jobs waiting in this queue (not including the one running). */
  queuedJobs: number;
};

export type MaterialBuyScanStatus = {
  passive: MaterialBuyScanQueueSlice;
  active: MaterialBuyScanQueueSlice;
  /** Passive scans wait while an active scan is queued or any scan runs. */
  passivePaused: boolean;
  lastError: string | null;
  /** Stations saved for the commodity just scanned (Spansh page size up to 120). */
  lastStationsFound: number | null;
  updatedAtIso: string;
};

const IDLE_QUEUE_SLICE: MaterialBuyScanQueueSlice = {
  phase: "idle",
  referenceSystem: null,
  commodityLabel: null,
  done: 0,
  total: 0,
  queuedJobs: 0,
};

export const IDLE_MATERIAL_BUY_SCAN_STATUS: MaterialBuyScanStatus = {
  passive: { ...IDLE_QUEUE_SLICE },
  active: { ...IDLE_QUEUE_SLICE },
  passivePaused: false,
  lastError: null,
  lastStationsFound: null,
  updatedAtIso: new Date(0).toISOString(),
};

const VALID_PHASES = new Set<MaterialBuyScanPhase>(["idle", "queued", "scanning", "saving", "error"]);

function coercePhase(v: unknown): MaterialBuyScanPhase {
  return typeof v === "string" && VALID_PHASES.has(v as MaterialBuyScanPhase) ? (v as MaterialBuyScanPhase) : "idle";
}

function coerceSlice(raw: unknown): MaterialBuyScanQueueSlice {
  if (!raw || typeof raw !== "object") return { ...IDLE_QUEUE_SLICE };
  const s = raw as Record<string, unknown>;
  const done = typeof s.done === "number" && Number.isFinite(s.done) ? Math.max(0, s.done) : 0;
  const total = typeof s.total === "number" && Number.isFinite(s.total) ? Math.max(0, s.total) : 0;
  const queuedJobs = typeof s.queuedJobs === "number" && Number.isFinite(s.queuedJobs) ? Math.max(0, s.queuedJobs) : 0;
  return {
    phase: coercePhase(s.phase),
    referenceSystem: typeof s.referenceSystem === "string" && s.referenceSystem.trim() ? s.referenceSystem.trim() : null,
    commodityLabel: typeof s.commodityLabel === "string" && s.commodityLabel.trim() ? s.commodityLabel.trim() : null,
    done,
    total,
    queuedJobs,
  };
}

export function freshMaterialBuyScanStatus(): MaterialBuyScanStatus {
  return {
    passive: { ...IDLE_QUEUE_SLICE },
    active: { ...IDLE_QUEUE_SLICE },
    passivePaused: false,
    lastError: null,
    lastStationsFound: null,
    updatedAtIso: new Date().toISOString(),
  };
}

/** Coerce a pushed or fetched status so the UI never reads undefined queue slices. */
export function normalizeMaterialBuyScanStatus(raw: unknown): MaterialBuyScanStatus {
  if (!raw || typeof raw !== "object") return freshMaterialBuyScanStatus();
  const r = raw as Record<string, unknown>;
  return {
    passive: coerceSlice(r.passive),
    active: coerceSlice(r.active),
    passivePaused: r.passivePaused === true,
    lastError: typeof r.lastError === "string" ? r.lastError : null,
    lastStationsFound:
      typeof r.lastStationsFound === "number" && Number.isFinite(r.lastStationsFound) ? r.lastStationsFound : null,
    updatedAtIso: typeof r.updatedAtIso === "string" ? r.updatedAtIso : new Date().toISOString(),
  };
}
