/**
 * The app bar and its tray, split out of App.tsx (WEBUI-REDESIGN 7.3). No logic changed.
 *
 * The menu's entries, Compare's tray and the screens it opens live in header/ since the audit of
 * 2026-10-22; the state they read (which screen is open, the tray switch, the menu) stays here.
 */
import { HeaderArt } from "./HeaderArt";
import { useConfirm, useToast } from "./ui/feedback";
import { Tooltip } from "./ui/Tooltip";
import { IconChevronDown } from "./ui/icons";
import { useValueFlash } from "./ui/useValueFlash";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, ReactNode } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useFdevServerStatus } from "./useFdevServerStatus";
import type { EncyclopediaSpawnCompare } from "./EncyclopediaModal";
import type { AppSnapshot, FootScannedEntry, NotableBodyInfo } from "@shared/types";
import { useFeederStatus } from "./FeederStatusPanel";
import { ExoDataAlertsHeaderHub } from "./ExoDataAlertsHub";
import { NoticesBell } from "./NoticesBell";
import { measurePopoverSide, type PopoverSide } from "./ui/popoverSide";
import { useMediaQuery, useMenuButton } from "./ui/Menu";
import { prefetchMenuModals } from "./SharedModals";
import { EDEXO_HEADER_TRAY_LS, readLsBool, writeLsBool } from "./lsPrefs";
import { CopySystemButton } from "./CopySystemButton";
import { SystemCardRow } from "./SystemCard";
import { JournalSystemSearch } from "./JournalSystemSearch";
import { useScreenOpen } from "./tabs/TabHost";
import { useTabSelector } from "./tabs/tabStore";
import { LiveSnapshotFreshness } from "./header/LiveSnapshotFreshness";
import { AppMenuEntries, type MenuOpeners } from "./header/AppMenuEntries";
import { CompareTray } from "./header/CompareTray";
import { HeaderScreens } from "./header/HeaderScreens";
import { CommanderSwitch } from "./header/CommanderSwitch";

/** A notable body's quick facts, asked for from outside the header (the body strip's notable tabs). */
export const NOTABLE_QUICK_EVENT = "edexo-notable-quick";

/**
 * The app bar, its tray and every screen tab — shared by the two apps on this shell (1.3.0, owner 2026-10-22):
 * Compare (`app` "compare", the default: unchanged) and Colonize, which brings its own tray (`trayContent`) and has
 * no system search, system cards or route/fuel/data tray of Compare's.
 */
export const HeaderBar = memo(function HeaderBar({
  snap,
  connected,
  onFootCatalogNavigate,
  onDiscoveriesNavigate,
  onGoToBioBody,
  encyclopediaSpawnCompare,
  onOpenSystemMap,
  app = "compare",
  trayContent,
  trayLabel,
}: {
  snap: AppSnapshot;
  connected: boolean;
  onFootCatalogNavigate?: (e: FootScannedEntry) => void;
  onDiscoveriesNavigate?: (systemAddress: number, bodyKey?: string) => void;
  onGoToBioBody?: (bodyKey: string) => void;
  encyclopediaSpawnCompare: EncyclopediaSpawnCompare | null;
  onOpenSystemMap: () => void;
  app?: "compare" | "colonize";
  /** Colonize: what its tray shows (the hold, the next stop, sites building) instead of Compare's. */
  trayContent?: ReactNode;
  /** The tray toggle's words, e.g. "the hold, next stop and sites". */
  trayLabel?: string;
}) {
  const compare = app === "compare";
  const confirm = useConfirm();
  const toast = useToast();
  const scanDataOn = snap.includeExplorationScanDataInDataValue === true;
  const explorationCr = snap.explorationScanDataValueCredits ?? 0;
  const totalDataCr = snap.organicDataValueCredits + (scanDataOn ? explorationCr : 0);
  /** A journal event that moves these numbers should be visible where the user is looking. */
  const dataValueFlash = useValueFlash(totalDataCr);
  const pendingSamplesFlash = useValueFlash(snap.organicPendingSampleCount);
  const [dataBreakdownOpen, setDataBreakdownOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [sessionOpen, setSessionOpen] = useScreenOpen("session");
  const [scanRouteOpen, setScanRouteOpen] = useScreenOpen("scanRoute");
  const [feederOpen, setFeederOpen] = useState(false);
  /**
   * §11.3. The button appears only when this machine actually has a corpus — otherwise it would
   * open an empty modal for every normal install. One fetch, shared with the panel.
   */
  const feeder = useFeederStatus(snap.feederEnabled === true);
  // Tab view (tabs/tabStore.ts): these screens open as tabs when it is on, as pop-ups when it is off.
  const [myExoOpen, setMyExoOpen] = useScreenOpen("myExo");
  const [encyclopediaOpen, setEncyclopediaOpen] = useScreenOpen("encyclopedia");
  const [achievementsOpen, setAchievementsOpen] = useScreenOpen("achievements");
  const [backlogOpen, setBacklogOpen] = useScreenOpen("backlog");
  const [carriersOpen, setCarriersOpen] = useScreenOpen("carriers");
  const [poiOpen, setPoiOpen] = useScreenOpen("poi");
  const [bookmarksOpen, setBookmarksOpen] = useScreenOpen("bookmarks");
  const [boxelOpen, setBoxelOpen] = useScreenOpen("boxels");
  const [statsOpen, setStatsOpen] = useScreenOpen("stats");
  const [browserOpen] = useScreenOpen("browser");
  const galaxyTab = useTabSelector((s) => s.on && s.tabs.includes("galaxy"));
  // The menu's panel openers, one object for the header's life (useState setters never change).
  const menuOpeners: MenuOpeners = useMemo(
    () => ({
      setMyExoOpen,
      setBacklogOpen,
      setCarriersOpen,
      setPoiOpen,
      setBoxelOpen,
      setBookmarksOpen,
      setStatsOpen,
      setFeederOpen,
      setEncyclopediaOpen,
      setAchievementsOpen,
      setSessionOpen,
      setScanRouteOpen,
      setOptionsOpen,
    }),
    [
      setMyExoOpen,
      setBacklogOpen,
      setCarriersOpen,
      setPoiOpen,
      setBoxelOpen,
      setBookmarksOpen,
      setStatsOpen,
      setEncyclopediaOpen,
      setAchievementsOpen,
      setSessionOpen,
      setScanRouteOpen,
    ],
  );
  const [notableQuick, setNotableQuick] = useState<{
    notable: NotableBodyInfo;
    x: number;
    y: number;
  } | null>(null);
  // My discoveries re-sorted its whole table on every push while open: a new onClose rebuilt its columns.
  const closeMyExo = useCallback(() => setMyExoOpen(false), [setMyExoOpen]);
  // The same for every screen (D11): the screens are memo'd, and a fresh closer per push undid it.
  const closeStats = useCallback(() => setStatsOpen(false), [setStatsOpen]);
  const closeBoxels = useCallback(() => setBoxelOpen(false), [setBoxelOpen]);
  const closeBookmarks = useCallback(() => setBookmarksOpen(false), [setBookmarksOpen]);
  const closePoi = useCallback(() => setPoiOpen(false), [setPoiOpen]);
  const closeCarriers = useCallback(() => setCarriersOpen(false), [setCarriersOpen]);
  const closeBacklog = useCallback(() => setBacklogOpen(false), [setBacklogOpen]);
  const closeAchievements = useCallback(() => setAchievementsOpen(false), [setAchievementsOpen]);
  const closeEncyclopedia = useCallback(() => setEncyclopediaOpen(false), [setEncyclopediaOpen]);
  const closeSession = useCallback(() => setSessionOpen(false), [setSessionOpen]);
  const closeScanRoute = useCallback(() => setScanRouteOpen(false), [setScanRouteOpen]);
  // One function for the header's life, so the system card's memo holds (snapSlice.ts).
  const openNotableQuick = useCallback((n: NotableBodyInfo, ev: ReactMouseEvent) => {
    ev.stopPropagation();
    setNotableQuick({ notable: n, x: ev.clientX, y: ev.clientY });
  }, []);
  // Notable tabs in the body strip open the same quick facts (App.tsx, BodyTabStrip.tsx).
  useEffect(() => {
    const on = (ev: Event) => {
      const d = (ev as CustomEvent<{ notable: NotableBodyInfo; x: number; y: number }>).detail;
      if (d?.notable) setNotableQuick(d);
    };
    window.addEventListener(NOTABLE_QUICK_EVENT, on);
    return () => window.removeEventListener(NOTABLE_QUICK_EVENT, on);
  }, []);
  const [trayOpen, setTrayOpen] = useState(() => readLsBool(EDEXO_HEADER_TRAY_LS, true));
  /*
    The cockpit menu (WEBUI-REDESIGN 2.3): the six secondary destinations behind one button, so the
    app bar is search, status, alerts, menu, tray. Closes on outside click and Escape.
  */
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // From 1,700 px the entries sit in the bar (cockpit.css); below, they are the dropdown.
  const menuInBar = useMediaQuery("(min-width: 1700px)");
  const menu = useMenuButton<HTMLButtonElement, HTMLDivElement>(menuOpen, setMenuOpen);
  useEffect(() => prefetchMenuModals(), []);
  /** Which way the menu opens; the rule is shared with the alerts popover. */
  const [menuSide, setMenuSide] = useState<PopoverSide>("left");
  // Before paint: measured after it, the first frame drew the menu on the old side and it jumped (1.2.20).
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const wrap = menuRef.current;
    setMenuSide(measurePopoverSide(wrap, wrap?.querySelector<HTMLElement>(".appbar-menu"), 240));
    const onDoc = (ev: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) setMenuOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    writeLsBool(EDEXO_HEADER_TRAY_LS, trayOpen);
  }, [trayOpen]);

  const toggleExplorationScanData = () => {
    void (async () => {
      try {
        const r = await fetch("/api/settings/include-exploration-scan-data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: !scanDataOn }),
        });
        const j = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not update setting.");
      }
    })();
  };

  /* The Data value window's "+30% Pranav Antal bonus" (owner, 2026-10-03): a saved setting. */
  const togglePranavAntal = (on: boolean) => {
    void (async () => {
      try {
        const r = await fetch("/api/settings/pranav-antal-bonus", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: on }),
        });
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not update setting.");
      }
    })();
  };
  /*
    The Data value window's "Selling at a fleet carrier (−25 %)" (owner, 2026-10-03) and "My own
    carrier (−15 %)" under it (2026-10-04): saved settings.
  */
  const postCarrierSetting = (route: string, on: boolean) => {
    void (async () => {
      try {
        const r = await fetch(route, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ value: on }),
        });
        const j = (await r.json().catch(() => null)) as { error?: string } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not update setting.");
      }
    })();
  };

  const resetExobiology = () => {
    void (async () => {
      const ok = await confirm({
        title: "Reset exobiology tracking?",
        message:
          "This clears scan progress toward completed samples, the pending “Data value” total, and " +
          "first-footfall / WasFootfalled flags held in memory.\n\n" +
          "Your Elite journal files on disk are not modified — restarting the app and re-merging " +
          "journals rebuilds this state from the logs.",
        confirmLabel: "Reset tracking",
        tone: "danger",
      });
      if (!ok) return;
      try {
        const r = await fetch("/api/exobiology/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: true }),
        });
        const j = (await r.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (!r.ok) throw new Error(j?.error || r.statusText);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not reset.");
      }
    })();
  };

  const cmdr = snap.commanderName?.trim();
  const fdev = useFdevServerStatus();
  const fdevDotClass =
    fdev.statusText === "Checking…"
      ? "appbar-dot--pending"
      : fdev.healthy
        ? "appbar-dot--ok"
        : "appbar-dot--err";

  return (
    <header className="top">
      <HeaderArt />
      {/*
        Three zones, not one wrapping row.

        The bar was `display: flex; flex-wrap: wrap`, so at any width where the contents did not quite
        fit, items wrapped in whatever order they happened to fall — the commander name, the two status
        dots and the menu each landing somewhere different depending on how long the system name was.
        The owner's complaint was that they are "all around the screen when the width changes".

        A grid gives each of them a home that width cannot take away: identity on the left, the system
        and its search in the middle, status and actions on the right. Only the middle is elastic, and
        it truncates rather than pushing anything out of place.
      */}
      <div className="appbar">
        <div className="appbar-left">
          <img src="/edexo-icon-124.webp" alt="" className="appbar-mark" width={24} height={24} />
          <span className="appbar-wordmark logo">
            EDEXO <span className="appbar-wordmark__app">{compare ? "Compare" : "Colonize"}</span>
          </span>
        </div>

        <div className="appbar-centre">
          {compare ? (
            <div className="appbar-search">
              <JournalSystemSearch snap={snap} onGoToBioBody={onGoToBioBody} />
            </div>
          ) : null}
        </div>

        <div className="appbar-right">
          <Tooltip
            className="appbar-status"
            text={
              connected
                ? "Connected to the journal service — live snapshots are arriving."
                : "No live connection to the journal service. Check that it is still running."
            }
          >
            <span className={`appbar-dot${connected ? " appbar-dot--ok" : " appbar-dot--err"}`}>
              <span className="top-live-dot" aria-hidden />
              <span className="appbar-dot-text">
                {connected ? "Live" : "Error"}
                <LiveSnapshotFreshness connected={connected} />
              </span>
            </span>
          </Tooltip>

          <Tooltip
            className="appbar-status"
            text={`Frontier server status: ${fdev.statusText}${fdev.fromEdsm ? " (via EDSM)" : ""}`}
          >
            <span className={`appbar-dot ${fdevDotClass}`}>
              <span className="top-live-dot" aria-hidden />
              <span className="appbar-dot-text appbar-dot-text--compact">FDev</span>
            </span>
          </Tooltip>

          {/* Pinned to the right, on the same row as the wordmark and the system — the owner's ask. */}
          {cmdr ? (
            <span className="appbar-cmdr">
              <span className="top-playing-as-muted">CMDR </span>
              <span className="top-playing-as-cmdr">{cmdr}</span>
            </span>
          ) : null}
          {/* The game playing another commander than this window shows (1.3.1): a line, Switch, and a pop-up once. */}
          <CommanderSwitch snap={snap} />

          <div className="appbar-actions">
            <NoticesBell snap={snap} />
            {/* An exobiology alert: Compare's, as the rest of its exobiology (Colonize's feed has no bodies, item 22). */}
            {compare ? <ExoDataAlertsHeaderHub snap={snap} /> : null}
            <div className="appbar-menu-wrap" ref={menuRef}>
              <button
                type="button"
                className={`appbar-icon-btn appbar-menu-btn${menuOpen ? " appbar-menu-btn--open" : ""}`}
                {...menu.buttonProps}
                onClick={menu.toggle}
                aria-label="Menu"
                // Same names and order as the entries (UI review F2).
                title="Menu: My discoveries, Unfinished business, Carriers, Points of interest, Statistics, Data feeder, Galaxy map, Encyclopedia, Achievements, Session log, Options"
              >
                <span className="appbar-menu-glyph" aria-hidden="true" />
              </button>
              <div
                className={`appbar-menu appbar-menu--${menuSide}${menuOpen ? " appbar-menu--open" : ""}`}
                {...(menuInBar ? { role: "group", "aria-label": "Screens" } : menu.menuProps)}
                onClick={() => setMenuOpen(false)}
              >
                <AppMenuEntries feederAvailable={feeder.available} open={menuOpeners} asMenu={!menuInBar} />
              </div>
            </div>
            <Tooltip
              text={`${trayOpen ? "Hide" : "Show"} ${compare ? "the route, fuel and data value tray" : `the tray: ${trayLabel ?? "this app's facts"}`}`}
            >
              <button
                type="button"
                className={`appbar-icon-btn appbar-tray-toggle${trayOpen ? " appbar-tray-toggle--open" : ""}`}
                onClick={() => setTrayOpen((v) => !v)}
                aria-expanded={trayOpen}
                aria-controls="header-tray"
                aria-label={compare ? "Route, fuel and data value" : (trayLabel ?? "Tray")}
              >
                <IconChevronDown />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>

      {!compare ? (trayOpen ? <div className="header-tray header-tray--app" id="header-tray">{trayContent}</div> : null) : null}

      {compare && snap.edsmMapSupplementForViewingSystem ? (
        <p className="header-edsm-map-note dim">
          System map uses public galaxy data, EDSM or Spansh (no journal <code>Scan</code> for this system
          yet).
        </p>
      ) : null}

      {/* The System card, star cards and notable bodies — SystemCard.tsx (Discord batch O-E2). */}
      {compare ? (
        <SystemCardRow
          snap={snap}
          onOpenSystemMap={onOpenSystemMap}
          onNotableClick={openNotableQuick}
        />
      ) : null}

      {compare && trayOpen ? (
        <CompareTray
          snap={snap}
          scanDataOn={scanDataOn}
          totalDataCr={totalDataCr}
          dataValueFlash={dataValueFlash}
          pendingSamplesFlash={pendingSamplesFlash}
          onToggleScanData={toggleExplorationScanData}
          onOpenBreakdown={() => setDataBreakdownOpen(true)}
        />
      ) : null}

      {compare &&
      snap.viewingSystemAddress != null &&
      snap.currentSystemAddress != null &&
      snap.viewingSystemAddress !== snap.currentSystemAddress ? (
        <p className="sub-live dim header-commander-away">
          Commander: {snap.currentSystem ?? "—"}
          <CopySystemButton system={snap.currentSystem} />
        </p>
      ) : null}

      <HeaderScreens
        snap={snap}
        app={app}
        encyclopediaSpawnCompare={encyclopediaSpawnCompare}
        onFootCatalogNavigate={onFootCatalogNavigate}
        onDiscoveriesNavigate={onDiscoveriesNavigate}
        onGoToBioBody={onGoToBioBody}
        galaxyTab={galaxyTab}
        browserOpen={browserOpen}
        statsOpen={statsOpen}
        closeStats={closeStats}
        boxelOpen={boxelOpen}
        closeBoxels={closeBoxels}
        bookmarksOpen={bookmarksOpen}
        closeBookmarks={closeBookmarks}
        poiOpen={poiOpen}
        closePoi={closePoi}
        carriersOpen={carriersOpen}
        closeCarriers={closeCarriers}
        backlogOpen={backlogOpen}
        closeBacklog={closeBacklog}
        achievementsOpen={achievementsOpen}
        closeAchievements={closeAchievements}
        encyclopediaOpen={encyclopediaOpen}
        closeEncyclopedia={closeEncyclopedia}
        myExoOpen={myExoOpen}
        closeMyExo={closeMyExo}
        sessionOpen={sessionOpen}
        closeSession={closeSession}
        scanRouteOpen={scanRouteOpen}
        closeScanRoute={closeScanRoute}
        dataBreakdownOpen={dataBreakdownOpen}
        setDataBreakdownOpen={setDataBreakdownOpen}
        scanDataOn={scanDataOn}
        togglePranavAntal={togglePranavAntal}
        postCarrierSetting={postCarrierSetting}
        optionsOpen={optionsOpen}
        setOptionsOpen={setOptionsOpen}
        resetExobiology={resetExobiology}
        feederOpen={feederOpen}
        setFeederOpen={setFeederOpen}
        feeder={feeder}
        notableQuick={notableQuick}
        setNotableQuick={setNotableQuick}
      />
    </header>
  );
});
