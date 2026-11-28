/**
 * The Boxels screen's labels, page sizes and small helpers (moved out of Boxel.tsx, audit 2026-10-22).
 */
import type { BoxelTableRowDTO, PredictedStarDTO } from "@shared/boxel";
import { NOTABLE_KINDS, type NotableKind } from "@shared/notices";
import { STAR_CLASSES } from "@shared/galaxyTraits";
import { isStrArr } from "../usePersistedState";

export const NOTABLE_LABEL = Object.fromEntries(NOTABLE_KINDS.map((k) => [k.key, k.label])) as Record<
  NotableKind,
  string
>;

export const FROM_TITLE = {
  index: "From the galaxy index (EDSM / Spansh records)",
  lookup: "From Spansh (Look up)",
  route: "From a route you plotted or a system you targeted in the galaxy map: the main star's class only",
} as const;

/** A fact from the galaxy index or a Spansh look-up (not your own scan) reads dimmer, and says so on hover. */
export function fromIndex(r: BoxelTableRowDTO, text: string) {
  return r.from === "index" || r.from === "lookup" || r.from === "route" ? (
    <span className="boxel-from-index" title={FROM_TITLE[r.from]}>
      {text}
    </span>
  ) : (
    <span>{text}</span>
  );
}

const STAGE_TEXT = {
  small: ["small star", "small", "a small star in the place of the one the system was born with (a K, M or L dwarf, most often)"],
  giant: ["giant", "giant", "a giant: the star has left the main sequence"],
  whiteDwarf: ["white dwarf", "WD", "a white dwarf"],
  neutron: ["neutron star", "N", "a neutron star"],
  collapsed: ["neutron star or black hole", "N / BH", "a neutron star, or a black hole (about one in nine)"],
} as const;

/**
 * A star nobody has recorded, as its system's address predicts it (shared/stellarClass.ts; owner, 2026-11-24: "show
 * threshold and mark predicted"): the class, or what the system's age has made of the star, with a "?" while it is
 * only likely; a short form for the order line; and what the prediction stands on.
 */
export function predictedStarLabel(p: PredictedStarDTO): { text: string; short: string; title: string } {
  const pct = (share: number) => Math.round(share * 100);
  const mark = p.likely ? "?" : "";
  const how = p.likely ? "Likely" : "Predicted";
  const age =
    p.aged === "dice"
      ? "its age is on the system's own dice"
      : "its age follows from the ages of the systems you scanned in this boxel";
  if (p.stage) {
    const [text, short, what] = STAGE_TEXT[p.stage];
    const why =
      p.aged === "kind"
        ? "In this boxel stars this heavy are replaced by small ones, as your scans here show"
        : p.aged === "place"
          ? "This close to Sol or to the galaxy's centre stars this heavy are replaced by small ones"
          : `The system is old enough for it: ${age}`;
    return {
      text: `${text}${mark}`,
      short: `${short}${mark}`,
      title: `${how} from the system's address, not seen by anyone: ${what}. ${why}. Right for about ${pct(p.right)} % of such answers.`,
    };
  }
  const alive = p.alive ?? 1;
  return {
    text: `${p.cls}${mark}`,
    short: `${p.cls}${mark}`,
    title: [
      `${how} from the system's address, not seen by anyone: class ${p.cls}${p.aged ? "" : " if the star is still on the main sequence"}.`,
      `Right for about ${pct(p.right)} % of such stars${p.sharpened ? ", sharpened by an arrival star you scanned in this boxel" : ""}.`,
      p.likely ? "Scan one arrival star of this boxel and the rest of it gets sharper." : "",
      p.aged
        ? `The star should still be itself: ${age} (right for about ${pct(alive)} %).`
        : `About ${Math.max(1, pct(1 - alive))} % of this mass code's arrival stars are something else by now (a dead star, a giant, a T Tauri star, a small star in its place).`,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * The Star type filter's keys (STAR_CLASSES) a predicted star answers to: its class while it is itself, or what its
 * age has made of it. A small star in another's place names no class (a K, M or L dwarf, which one is not told): it
 * answers to "small" only.
 */
export function predictedStarKeys(p: PredictedStarDTO): string[] {
  switch (p.stage) {
    case "giant":
      return ["SG"];
    case "whiteDwarf":
      return ["D"];
    case "neutron":
      return ["N"];
    case "collapsed":
      return ["N", "H"];
    case "small":
      return [];
    default:
      return [p.cls];
  }
}

const STAR_RANK = new Map(STAR_CLASSES.map((c, i) => [c.key, i]));

/**
 * The Main star column's sort: classes in spectral order (O, B, A … Y, then T Tauri, Herbig, Wolf-Rayet, carbon,
 * white dwarfs, neutron stars, black holes, giants), a recorded star by its subclass, a predicted one ("≈") after the
 * recorded ones of its class, likely ones last. A small star in another's place sorts with the M dwarfs. Null: nothing
 * recorded or predicted.
 */
export function mainStarSortKey(r: BoxelTableRowDTO): number | null {
  if (r.mainStar) {
    const i = STAR_RANK.get(r.starClasses[0] ?? "");
    if (i == null) return STAR_CLASSES.length * 100;
    const sub = /^[A-Za-z]+(\d)/.exec(r.mainStar)?.[1];
    return i * 100 + (sub ? Number(sub) : 0);
  }
  const p = r.predictedStar;
  if (!p) return null;
  const i = STAR_RANK.get(p.stage === "small" ? "M" : (predictedStarKeys(p)[0] ?? "")) ?? STAR_CLASSES.length;
  return i * 100 + 50 + (p.likely ? 10 : 0);
}

/** A scanned star in the words of the check (shared/boxel.ts `BoxelStarCheckDTO.real`). */
export const scannedStarText = (real: string): string =>
  (
    ({
      small: "a small star in its place",
      giant: "a giant",
      whiteDwarf: "a white dwarf",
      neutron: "a neutron star",
      blackHole: "a black hole",
      tTauri: "a T Tauri star",
      herbig: "a Herbig star",
      other: "another kind of star",
    }) as Record<string, string>
  )[real] ?? `class ${real}`;

/** Previous boxels drawn at once: a long log holds thousands. */
export const PREV_PAGE = 60;
export const PREV_RANGES: { days: number; label: string }[] = [
  { days: 1, label: "24h" },
  { days: 7, label: "7d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
  { days: 365, label: "365d" },
  { days: 0, label: "All" },
];
export const STAR_LABEL = Object.fromEntries(STAR_CLASSES.map((c) => [c.key, c.label])) as Record<string, string>;

export type SideTab = "saved" | "explored" | "history";

/** Other stars listed in a row before "+N more". */
export const OTHER_STARS_SHOWN = 2;

export const isIncluded = (v: unknown): v is string[] | null => v === null || isStrArr(v);
export const json = { "Content-Type": "application/json" };
