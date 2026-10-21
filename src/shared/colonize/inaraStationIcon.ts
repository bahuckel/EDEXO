/**
 * Inara commodities table uses a 13px-wide sprite strip:
 * https://inara.cz/images/stations/sprites7.png
 * Icon is `.stationicon` with `background-position: -Npx 0px`.
 *
 * Ground (isGround true): 182 Surface Port, 195 Surface Station.
 * Space (isGround false): 13 Coriolis, 26 Outpost, 156 Orbis, 169 Ocellus,
 * 247 Asteroid Base, 507 Carrier, 871 Dodec.
 */

export type InaraStationKind = "space" | "ground" | "carrier" | "unknown";

export type InaraStationIconInfo = {
  /** Sprite label, e.g. "Starport - Dodec". Unknown offsets are "unknown". */
  styleType: string;
  /** Same as styleType — used by the buy index / planner. */
  stationType: string;
  isGround: boolean;
  /** Same as isGround — kept for planner / Spansh merge. */
  isPlanetaryOrGround: boolean;
  kind: InaraStationKind;
  isFleetCarrier: boolean;
  /** Null when the sprite is unknown — use the table's Pad column if present. */
  largePad: boolean | null;
  /** Parsed |background-position| X in px, when found. */
  spriteX: number | null;
};

const UNKNOWN: InaraStationIconInfo = {
  styleType: "unknown",
  stationType: "unknown",
  isGround: false,
  isPlanetaryOrGround: false,
  kind: "unknown",
  isFleetCarrier: false,
  largePad: null,
  spriteX: null,
};

function entry(
  styleType: string,
  kind: InaraStationKind,
  isGround: boolean,
  largePad: boolean | null,
  isFleetCarrier = false,
): Omit<InaraStationIconInfo, "spriteX"> {
  return {
    styleType,
    stationType: styleType,
    isGround,
    isPlanetaryOrGround: isGround,
    kind,
    isFleetCarrier,
    largePad,
  };
}

/** background-position X in px (positive), from Station Types.txt. */
const BY_X: Record<number, Omit<InaraStationIconInfo, "spriteX">> = {
  13: entry("Starport - Coriolis", "space", false, true),
  26: entry("Space Outpost", "space", false, false),
  156: entry("Starport - Orbis", "space", false, true),
  169: entry("Starport - Ocellus", "space", false, true),
  182: entry("Surface Port", "ground", true, true),
  195: entry("Surface Station", "ground", true, false),
  247: entry("Starport - Asteroid Base", "space", false, true),
  507: entry("Carrier", "carrier", false, false, true),
  871: entry("Starport - Dodec", "space", false, true),
};

function parseInaraSpriteX(source: string | null | undefined): number | null {
  const s = String(source || "");
  if (!s) return null;
  const patterns = [
    /background-position-x:\s*(-?\d+(?:\.\d+)?)px/i,
    /background-position:\s*(-?\d+(?:\.\d+)?)px/i,
    /sprites7\.png[^"'<]*?(-?\d+(?:\.\d+)?)px/i,
    /^(-?\d+(?:\.\d+)?)px\b/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (!m) continue;
    const x = Math.abs(Math.round(Number(m[1])));
    if (Number.isFinite(x) && x > 0) return x;
  }
  return null;
}

function inaraStationIconFromSpriteX(x: number | null | undefined): InaraStationIconInfo {
  if (x == null || !Number.isFinite(x)) return { ...UNKNOWN };
  const n = Math.abs(Math.round(x));
  const mapped = BY_X[n];
  if (!mapped) return { ...UNKNOWN, spriteX: n };
  return { ...mapped, spriteX: n };
}

export function inaraStationIconFromStyle(style: string | null | undefined): InaraStationIconInfo {
  return inaraStationIconFromSpriteX(parseInaraSpriteX(style));
}

export function inaraStationIconFromHtml(html: string): InaraStationIconInfo {
  const tag = html.match(/<div[^>]*class="[^"]*stationicon[^"]*"[^>]*>/i)?.[0]
    ?? html.match(/<(?:div|span)[^>]*stationicon[^>]*>/i)?.[0];
  const style = tag?.match(/style="([^"]*)"/i)?.[1]
    ?? html.match(/stationicon[^>]*style="([^"]*)"/i)?.[1]
    ?? html;
  return inaraStationIconFromStyle(style);
}

export function isGroundStyleType(styleType: string | null | undefined): boolean {
  const t = (styleType ?? "").trim().toLowerCase();
  if (!t || t === "unknown") return false;
  return t === "surface port" || t === "surface station";
}
