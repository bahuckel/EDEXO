import { toLy, type Ly } from "./systemDistanceLy";
import { isGroundStyleType } from "./inaraStationIcon";

const INARA_IMPORT_SCHEMA_VERSION = 1 as const;

/** Index key for scrapes so Plan/Search find them regardless of the Inara "near" star. */
export const INARA_INDEX_REF = "inara";

export type InaraImportStation = {
  systemName: string;
  stationName: string;
  distanceLy: Ly;
  supply: number | null;
  buyPrice: number | null;
  /** Sprite label from sprites7.png, e.g. "Starport - Dodec". */
  styleType?: string | null;
  stationType?: string | null;
  pad?: string | null;
  isGround?: boolean;
  isPlanetaryOrGround?: boolean;
  isFleetCarrier?: boolean;
  spriteX?: number | null;
  marketUpdatedAt?: string | null;
};

export type InaraImportFile = {
  version: typeof INARA_IMPORT_SCHEMA_VERSION;
  source: "inara";
  scrapedAt: string;
  nearSystem: string;
  commodityLabel: string;
  stations: InaraImportStation[];
};

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function parseInaraImportFile(raw: unknown): InaraImportFile | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.source !== "inara") return null;
  if (o.version !== INARA_IMPORT_SCHEMA_VERSION && o.version !== 1) return null;
  const nearSystem = asStr(o.nearSystem);
  const commodityLabel = asStr(o.commodityLabel);
  if (!nearSystem || !commodityLabel) return null;
  if (!Array.isArray(o.stations)) return null;
  const stations: InaraImportStation[] = [];
  for (const row of o.stations) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const systemName = asStr(r.systemName);
    const stationName = asStr(r.stationName);
    if (!systemName || !stationName) continue;
    const distanceLy = asNum(r.distanceLy);
    const styleType =
      asStr(r.styleType) || asStr(r.stationType) || "unknown";
    const isGround =
      typeof r.isGround === "boolean"
        ? r.isGround
        : r.isPlanetaryOrGround === true || isGroundStyleType(styleType);
    stations.push({
      systemName,
      stationName,
      distanceLy: toLy(distanceLy),
      supply: asNum(r.supply),
      buyPrice: asNum(r.buyPrice),
      styleType,
      stationType: styleType,
      pad: asStr(r.pad) || null,
      isGround,
      isPlanetaryOrGround: isGround,
      isFleetCarrier: r.isFleetCarrier === true,
      spriteX: asNum(r.spriteX),
      marketUpdatedAt: asStr(r.marketUpdatedAt) || null,
    });
  }
  return {
    version: INARA_IMPORT_SCHEMA_VERSION,
    source: "inara",
    scrapedAt: asStr(o.scrapedAt) || new Date().toISOString(),
    nearSystem,
    commodityLabel,
    stations,
  };
}
