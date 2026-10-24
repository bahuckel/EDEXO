/**
 * Carriers & Stations keep themselves current (R4, owner 2026-10-23: "auto refresh every X hours"): the carrier list
 * from EDAstro every 12 h, the station index from the galaxy-index release every 24 h, each adjustable or off.
 *
 * Only data the commander already fetched once is refreshed: the first download stays a button press (the screens
 * hold nothing until asked). Carriers count from the last fetch (a conditional GET: an unchanged file costs a few
 * hundred bytes); stations from the last check, or the file's own date before the first, and download only when the
 * release holds another dump. Checked every ten minutes, the first a couple of minutes after start; timers unref'd.
 */
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveUserSettingsJsonPath } from "./paths.js";
import { fetchCarrierData, readCarrierStatus } from "./edastroCarriers.js";
import {
  downloadStations,
  probeStationsRelease,
  stationsFilePath,
  stationsReleaseIsNewer,
  stationsStatus,
} from "./stationsIndex.js";

/** The intervals offered (hours); 0 = off. */
export const AUTO_REFRESH_HOURS = [0, 6, 12, 24, 48] as const;
export type AutoRefreshHours = (typeof AUTO_REFRESH_HOURS)[number];

export interface AutoRefreshSettings {
  carriersHours: AutoRefreshHours;
  stationsHours: AutoRefreshHours;
}

export const AUTO_REFRESH_DEFAULTS: AutoRefreshSettings = { carriersHours: 12, stationsHours: 24 };
const TICK_MS = 10 * 60 * 1000;
const FIRST_DELAY_MS = 2 * 60 * 1000;
const HOUR_MS = 3_600_000;

interface StoredState extends AutoRefreshSettings {
  /** When the station release was last asked (ms), whether or not it brought anything. */
  stationsCheckedAtMs?: number;
}

function statePath(): string {
  return join(dirname(resolveUserSettingsJsonPath()), "edexo-compare-autorefresh.json");
}

const hoursOr = (v: unknown, base: AutoRefreshHours): AutoRefreshHours =>
  (AUTO_REFRESH_HOURS as readonly number[]).includes(Number(v)) ? (Number(v) as AutoRefreshHours) : base;

function readState(): StoredState {
  try {
    const o = JSON.parse(readFileSync(statePath(), "utf8")) as Partial<StoredState>;
    return {
      carriersHours: hoursOr(o.carriersHours, AUTO_REFRESH_DEFAULTS.carriersHours),
      stationsHours: hoursOr(o.stationsHours, AUTO_REFRESH_DEFAULTS.stationsHours),
      stationsCheckedAtMs: typeof o.stationsCheckedAtMs === "number" ? o.stationsCheckedAtMs : undefined,
    };
  } catch {
    return { ...AUTO_REFRESH_DEFAULTS };
  }
}

function writeState(s: StoredState): void {
  try {
    writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
  } catch {
    /* best effort: a lost file means the defaults and one early check */
  }
}

export function readAutoRefreshSettings(): AutoRefreshSettings {
  const { carriersHours, stationsHours } = readState();
  return { carriersHours, stationsHours };
}

/** Takes what it understands of `patch`; the rest stays. Returns what is now in force. */
export function writeAutoRefreshSettings(patch: Partial<Record<keyof AutoRefreshSettings, unknown>>): AutoRefreshSettings {
  const cur = readState();
  const next: StoredState = {
    ...cur,
    carriersHours: patch.carriersHours === undefined ? cur.carriersHours : hoursOr(patch.carriersHours, cur.carriersHours),
    stationsHours: patch.stationsHours === undefined ? cur.stationsHours : hoursOr(patch.stationsHours, cur.stationsHours),
  };
  writeState(next);
  return { carriersHours: next.carriersHours, stationsHours: next.stationsHours };
}

/** Whether each is due now; exported for the tests. */
export function dueNow(
  s: StoredState,
  carriers: { haveData: boolean; fetchedAtMs: number | null },
  stations: { present: boolean; fileMs: number | null },
  nowMs: number,
): { carriers: boolean; stations: boolean } {
  const due = (hours: number, sinceMs: number | null | undefined) =>
    hours > 0 && sinceMs != null && nowMs - sinceMs >= hours * HOUR_MS;
  return {
    carriers: carriers.haveData && due(s.carriersHours, carriers.fetchedAtMs),
    stations: stations.present && due(s.stationsHours, s.stationsCheckedAtMs ?? stations.fileMs),
  };
}

/** One pass: refresh what is due. `onChanged` when new data went in (the screens and map read it again). */
export async function runAutoRefresh(onChanged: () => void, nowMs = Date.now()): Promise<void> {
  const s = readState();
  const carrierStatus = readCarrierStatus(nowMs);
  const stationsFile = stationsFilePath();
  const st = stationsStatus();
  const due = dueNow(
    s,
    { haveData: carrierStatus.haveData, fetchedAtMs: carrierStatus.fetchedAtMs },
    { present: st.present, fileMs: st.present && existsSync(stationsFile) ? statSync(stationsFile).mtimeMs : null },
    nowMs,
  );
  if (due.carriers) {
    const r = await fetchCarrierData({ nowMs }).catch(() => null);
    if (r?.ok && !r.unchanged) onChanged();
  }
  if (due.stations) {
    writeState({ ...readState(), stationsCheckedAtMs: nowMs });
    await probeStationsRelease(fetch, true);
    if (stationsReleaseIsNewer()) await downloadStations(onChanged);
  }
}

export function startDataAutoRefresh(onChanged: () => void): { stop(): void } {
  let busy = false;
  const tick = () => {
    if (busy) return;
    busy = true;
    // Unattended: a failure (a dropped download, a .part file antivirus holds) is logged and tried at the next tick. An
    // unhandled rejection here stopped the server mid-session (review 2026-10-24).
    void runAutoRefresh(onChanged)
      .catch((e) => console.warn("[auto refresh]", e instanceof Error ? e.message : e))
      .finally(() => {
        busy = false;
      });
  };
  const first = setTimeout(tick, FIRST_DELAY_MS);
  const timer = setInterval(tick, TICK_MS);
  first.unref?.();
  timer.unref?.();
  return {
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
