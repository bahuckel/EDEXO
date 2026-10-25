/**
 * App-bar and button glyphs.
 *
 * Drawn rather than typed: the header actions used to be three full-width text buttons, and the
 * obvious replacement — Unicode symbols like ✿ ▤ ⚙ — renders as tofu wherever the chosen font
 * lacks the codepoint. These inherit `currentColor`, stay sharp at 16 px, and cost no font load.
 *
 * Since 1.2.17 they are lucide's (plan 3.6; owner, 2026-10-15: "uses for lucide approved"), at the 16 px and
 * 1.4 px stroke the hand-drawn set had (`absoluteStrokeWidth`), under the same names so no caller changed. Only the
 * icons imported here reach the bundle.
 */
import type { SVGProps } from "react";
import {
  BookOpen,
  Bookmark,
  Boxes,
  Camera,
  ChartColumn,
  Check,
  ChevronDown,
  Copy,
  Database,
  Flag,
  History,
  KeyRound,
  MapPin,
  Orbit,
  Save,
  Settings,
  Sprout,
  Telescope,
  Trophy,
  type LucideIcon,
} from "lucide-react";

type IconProps = { className?: string };

function glyph(L: LucideIcon) {
  return function Glyph({ className }: IconProps) {
    return (
      <L
        className={className}
        size={16}
        strokeWidth={1.4}
        absoluteStrokeWidth
        aria-hidden="true"
        focusable="false"
      />
    );
  };
}

/** A key — fill a login the browser saved (Remember passwords). */
export const IconKey = glyph(KeyRound);
/** A sprout — completed on-foot samples. */
export const IconExobiology = glyph(Sprout);
/** A flag — the first-discovery backlog: bodies where the flag is still there to be planted. */
export const IconBacklog = glyph(Flag);
/** A telescope — searching the galaxy, not the system. */
export const IconGalaxySearch = glyph(Telescope);
/** An orbit — the galaxy map. */
export const IconGalaxy = glyph(Orbit);
/** A database — the exomastery data (feeder). */
export const IconFeeder = glyph(Database);
/** An open book — the Encyclopedia. */
export const IconEncyclopedia = glyph(BookOpen);
/** A cog — Options. */
export const IconOptions = glyph(Settings);
/** The menu's open arrow. */
export const IconChevronDown = glyph(ChevronDown);
/**
 * A Coriolis starport face on (owner, 2026-10-13), in a 24 × 24 box: a cuboctahedron — six squares meeting at their
 * corners, a triangle in each gap. From the front its outline is a square; the front square stands on a corner inside
 * it, touching each side in the middle, the four corner gaps are triangles, and the docking slot lies level across the
 * middle, from the left corner towards the right. The galaxy map's Carriers & Stations tab (G3dMenu.tsx) and the app
 * menu's both draw it.
 */
export function CoriolisPaths({ p, slotWidth }: { p: SVGProps<SVGPathElement>; slotWidth: number }) {
  return (
    <>
      <path {...p} d="M3.5 3.5h17v17h-17z" />
      <path {...p} d="M12 3.5 20.5 12 12 20.5 3.5 12z" />
      <path {...p} d="M8.6 11.3h6.8v1.4H8.6z" strokeWidth={slotWidth} />
    </>
  );
}

/** A Coriolis starport — carriers and stations (owner, 2026-10-25: the galaxy map's own, not lucide's ship). */
export function IconCarrier({ className }: IconProps) {
  // The lucide glyphs' 1.4 px stroke at 16 px, whatever the box is scaled to (their `absoluteStrokeWidth`).
  const p = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    vectorEffect: "non-scaling-stroke",
  } as const;
  return (
    <svg className={className} width={16} height={16} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <CoriolisPaths p={p} slotWidth={1.1} />
    </svg>
  );
}
/** Columns — statistics. */
export const IconStats = glyph(ChartColumn);
/** A pin — points of interest. */
export const IconPoi = glyph(MapPin);
/** Boxes — boxels. */
export const IconBoxel = glyph(Boxes);
/** A bookmark — bookmarks. */
export const IconBookmark = glyph(Bookmark);
/** A trophy — achievements. */
export const IconAchievements = glyph(Trophy);
/** A clock turned back — this session. */
export const IconSession = glyph(History);
/** Two sheets — copy. */
export const IconCopy = glyph(Copy);
/** A disk — save. */
export const IconSave = glyph(Save);
/** A camera — snapshot. */
export const IconCamera = glyph(Camera);
/** A tick — done. */
export const IconCheck = glyph(Check);
