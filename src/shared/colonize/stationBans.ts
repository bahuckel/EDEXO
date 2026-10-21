import { normSystemName, stationNamesMatch } from "./stationFilter";

export type BannedStation = {
  systemName: string;
  stationName: string;
  bannedAt: string;
};

const BANNED_STATIONS_KEY = "edexo-colonize-banned-stations-v1";

function stationBanKey(systemName: string, stationName: string): string {
  return `${normSystemName(systemName)}\0${stationName.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export function loadBannedStations(): BannedStation[] {
  try {
    const raw = localStorage.getItem(BANNED_STATIONS_KEY);
    if (!raw) return [];
    const j = JSON.parse(raw) as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter(
      (e): e is BannedStation =>
        Boolean(e && typeof e === "object") &&
        typeof (e as BannedStation).stationName === "string" &&
        typeof (e as BannedStation).systemName === "string",
    );
  } catch {
    return [];
  }
}

function saveBannedStations(entries: BannedStation[]): void {
  try {
    localStorage.setItem(BANNED_STATIONS_KEY, JSON.stringify(entries));
  } catch {
    /* */
  }
}

export function isStationBanned(
  bans: BannedStation[],
  systemName: string,
  stationName: string,
): boolean {
  const key = stationBanKey(systemName, stationName);
  for (const b of bans) {
    if (stationBanKey(b.systemName, b.stationName) === key) return true;
    if (
      stationNamesMatch(b.stationName, stationName) &&
      normSystemName(b.systemName) === normSystemName(systemName)
    ) {
      return true;
    }
  }
  return false;
}

export function banStation(
  bans: BannedStation[],
  systemName: string,
  stationName: string,
): BannedStation[] {
  if (isStationBanned(bans, systemName, stationName)) return bans;
  const next = [
    { systemName: systemName.trim(), stationName: stationName.trim(), bannedAt: new Date().toISOString() },
    ...bans,
  ];
  saveBannedStations(next);
  return next;
}

export function unbanStation(
  bans: BannedStation[],
  systemName: string,
  stationName: string,
): BannedStation[] {
  const key = stationBanKey(systemName, stationName);
  const next = bans.filter((b) => stationBanKey(b.systemName, b.stationName) !== key);
  saveBannedStations(next);
  return next;
}
