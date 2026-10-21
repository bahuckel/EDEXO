import { storageGet, storageSet } from "./storage";
const PLANNER_SETTINGS_KEY = "edexo-colonize-planner-settings-v1";

export type PlannerSettings = {
  /** Distinct seller star systems to keep per material before background Spansh scans stop. Empty = unlimited. */
  maxSystemsPerMaterial: string;
  /**
   * Background Spansh scans. On by default now that Spansh actually answers.
   *
   * It was off because most materials came back with no seller — which turned out to be a
   * `symbol` filter returning HTTP 500 much of the time, cached as "no sellers" for ten
   * minutes. With the filter order and that cache fixed, all 55 materials across the test
   * corpus resolve with no server errors, so there is no reason to make the commander scan
   * by hand.
   */
  liveSpanshScans: boolean;
};

const DEFAULT_MAX_SYSTEMS = "15";

function defaultPlannerSettings(): PlannerSettings {
  return { maxSystemsPerMaterial: DEFAULT_MAX_SYSTEMS, liveSpanshScans: true };
}

export function loadPlannerSettings(): PlannerSettings {
  try {
    const raw = storageGet(PLANNER_SETTINGS_KEY);
    if (!raw) return defaultPlannerSettings();
    const j = JSON.parse(raw) as Partial<PlannerSettings>;
    return {
      maxSystemsPerMaterial:
        typeof j.maxSystemsPerMaterial === "string" ? j.maxSystemsPerMaterial : DEFAULT_MAX_SYSTEMS,
      liveSpanshScans: typeof j.liveSpanshScans === "boolean" ? j.liveSpanshScans : true,
    };
  } catch {
    return defaultPlannerSettings();
  }
}

export function savePlannerSettings(settings: PlannerSettings): void {
  try {
    storageSet(PLANNER_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* */
  }
}

/** Positive integer cap, or null when blank/0 (unlimited legacy scans). */
export function parseMaxSystemsPerMaterial(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Math.floor(Number(t));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}
