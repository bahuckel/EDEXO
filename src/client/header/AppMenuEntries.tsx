/**
 * The app menu's entries, one per screen (moved out of HeaderBar.tsx, audit 2026-10-22).
 */
import { memo } from "react";
import { Tooltip } from "../ui/Tooltip";
import {
  IconAchievements,
  IconEncyclopedia,
  IconExobiology,
  IconFeeder,
  IconGalaxy,
  IconOptions,
  IconBacklog,
  IconCarrier,
  IconPoi, IconBookmark, IconBoxel,
  IconStats,
  IconSession,
} from "../ui/icons";
import { MENU_ITEM } from "../ui/Menu";
import { tabStore } from "../tabs/tabStore";

/** An entry on the wide app bar, where the menu is the bar itself: an ordinary button. */
const NOT_MENU_ITEM = {} as const;

export type MenuOpeners = Record<
  | "setMyExoOpen"
  | "setBacklogOpen"
  | "setCarriersOpen"
  | "setPoiOpen"
  | "setBoxelOpen"
  | "setBookmarksOpen"
  | "setStatsOpen"
  | "setFeederOpen"
  | "setEncyclopediaOpen"
  | "setAchievementsOpen"
  | "setSessionOpen"
  | "setOptionsOpen",
  (v: boolean) => void
>;

/**
 * The menu's entries, apart from the header (plan 2.2, Fable C5): the header takes the whole
 * snapshot and renders on every push — ten a second in flight — and with it went twelve buttons,
 * thirteen tooltips and twelve icons that never change. Its props are the feeder flag and the
 * panels' setters, which are stable, so it renders when the feeder appears and not otherwise.
 */
export const AppMenuEntries = memo(function AppMenuEntries({
  feederAvailable,
  open,
  asMenu,
}: {
  feederAvailable: boolean;
  open: MenuOpeners;
  /** The dropdown (below 1,700 px): entries are menu items, moved between by the arrows (ui/Menu.tsx). */
  asMenu: boolean;
}) {
  const item = asMenu ? MENU_ITEM : NOT_MENU_ITEM;
  return (
    <>
      {/*
        The panel behind this icon stopped being only exobiology: it now carries every system,
        body and star in the merged journals beside the foot-confirmed species. The menu is
        icons and tooltips, so the tooltip is the only place the name lives — leaving it as "My
        exobiology" made three new tabs unfindable.
      */}
      <Tooltip text="My discoveries — every system, body and star you have scanned, plus the species you confirmed on foot.">
        <button
          type="button"
          {...item}
          className="appbar-icon-btn"
          onClick={() => open.setMyExoOpen(true)}
          aria-label="My discoveries"
        >
          <IconExobiology />
        </button>
      </Tooltip>
      <Tooltip text="Unfinished business — biology you found first and never collected, still worth 5x.">
        <button
          type="button"
          {...item}
          className="appbar-icon-btn"
          onClick={() => open.setBacklogOpen(true)}
          aria-label="Unfinished business"
        >
          <IconBacklog />
        </button>
      </Tooltip>
      <span className="appbar-menu-sep" aria-hidden="true" />
      {/*
        Carriers is in the menu rather than the app bar because it is a thing the commander goes
        looking for — where do I sell a full sample bag — not something they watch. The panel
        holds no data until they press its button.
      */}
      <Tooltip text="Carriers & Stations — fleet carriers near you (EDAstro), the nearest station with a service, and Find Tritium. Downloads on request; then kept current.">
        <button
          type="button"
          {...item}
          className="appbar-icon-btn"
          onClick={() => open.setCarriersOpen(true)}
          aria-label="Carriers & Stations"
        >
          <IconCarrier />
        </button>
      </Tooltip>
      <Tooltip text="Points of interest — the Galactic Exploration Catalog near you, from EDAstro. Downloads on request.">
        <button
          type="button"
          {...item}
          className="appbar-icon-btn"
          onClick={() => open.setPoiOpen(true)}
          aria-label="Points of interest"
        >
          <IconPoi />
        </button>
      </Tooltip>
      <Tooltip text="Boxels — your saved boxels in one table: which systems you have flown, what is recorded there, and the next one to fly.">
        <button
          type="button"
          {...item}
          className="appbar-icon-btn"
          onClick={() => open.setBoxelOpen(true)}
          aria-label="Boxel"
        >
          <IconBoxel />
        </button>
      </Tooltip>
      <Tooltip text="Bookmarks — systems you marked with the ☆ beside a system's name, with tags and notes.">
        <button
          type="button"
          {...item}
          className="appbar-icon-btn"
          onClick={() => open.setBookmarksOpen(true)}
          aria-label="Bookmarks"
        >
          <IconBookmark />
        </button>
      </Tooltip>
      <span className="appbar-menu-sep" aria-hidden="true" />
      <Tooltip text="Statistics — income by source, activity and balances, over 24 h to all time.">
        <button
          type="button"
          {...item}
          className="appbar-icon-btn"
          onClick={() => open.setStatsOpen(true)}
          aria-label="Statistics"
        >
          <IconStats />
        </button>
      </Tooltip>
      {feederAvailable ? (
        <Tooltip text="Data feeder — the corpus behind the rankings, and whether any profile is behind it.">
          <button
            type="button"
            {...item}
            className="appbar-icon-btn"
            onClick={() => open.setFeederOpen(true)}
            aria-label="Data feeder"
          >
            <IconFeeder />
          </button>
        </Tooltip>
      ) : null}
      <span className="appbar-menu-sep" aria-hidden="true" />
      <Tooltip text="Galaxy map — 5.3 million systems with recorded biology, your own travels, search and codex, in 3D. Opens in its own window.">
        <a
          {...item}
          className="appbar-icon-btn"
          href="?screen=galaxy"
          target="_blank"
          rel="noreferrer"
          aria-label="Galaxy map"
          onClick={(ev) => {
            // Tab view: the map opens in a tab of this window instead of a window of its own.
            if (!tabStore.get().on) return;
            ev.preventDefault();
            tabStore.open("galaxy");
          }}
        >
          <IconGalaxy />
        </a>
      </Tooltip>
      <Tooltip text="Encyclopedia — every species, its requirements, and what you have found.">
        <button
          type="button"
          {...item}
          className="appbar-icon-btn"
          onClick={() => open.setEncyclopediaOpen(true)}
          aria-label="Encyclopedia"
        >
          <IconEncyclopedia />
        </button>
      </Tooltip>
      <span className="appbar-menu-sep" aria-hidden="true" />
      <Tooltip text="Achievements — every plant variant by galaxy, genus, rarity and region, Bronze / Silver / Gold; track one to mark its plants.">
        <button
          type="button"
          {...item}
          className="appbar-icon-btn"
          onClick={() => open.setAchievementsOpen(true)}
          aria-label="Achievements"
        >
          <IconAchievements />
        </button>
      </Tooltip>
      <Tooltip text="Session log — tonight's systems, landings, species analysed and sales; copy as Markdown.">
        <button
          type="button"
          {...item}
          className="appbar-icon-btn"
          onClick={() => open.setSessionOpen(true)}
          aria-label="Session log"
        >
          <IconSession />
        </button>
      </Tooltip>
      <span className="appbar-menu-sep" aria-hidden="true" />
      <Tooltip text="Options — journal service info, map tier thresholds, reset.">
        <button
          type="button"
          {...item}
          className="appbar-icon-btn"
          onClick={() => open.setOptionsOpen(true)}
          aria-label="Options"
        >
          <IconOptions />
        </button>
      </Tooltip>
    </>
  );
});
