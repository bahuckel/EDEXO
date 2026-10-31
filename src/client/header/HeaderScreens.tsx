/**
 * Every screen the header opens: the tabs (or pop-ups with Tab view off), the data value breakdown,
 * Options, the feeder and a notable body's quick facts. Moved out of HeaderBar.tsx (audit 2026-10-22);
 * the open flags and their setters stay in the header (useScreenOpen keeps its own state there with Tab
 * view off), and come in as props.
 */
import { lazy, memo, Suspense } from "react";
import type { EncyclopediaSpawnCompare } from "../EncyclopediaModal";
import type { AppSnapshot, FootScannedEntry, NotableBodyInfo } from "@shared/types";
import type { useFeederStatus } from "../FeederStatusPanel";
import {
  AchievementsModal,
  MapOptionsModal,
  CarriersModal,
  EncyclopediaModal,
  PoiModal,
  BookmarksModal,
  BoxelScreen,
  StatisticsModal,
  FirstDiscoveryBacklogModal,
  ModalLoading,
  MyExobiologyModal,
  DataValueBreakdownModal,
  SessionLogModal,
  FeederModal,
} from "../SharedModals";
import { TabSlot } from "../tabs/TabHost";
import { useFootScanned } from "./useFootScanned";

/** The 3D galaxy map inside a tab (Tab view); without it, it opens in its own window as before. */
// memo: no props, so a snapshot push never reaches it (D11).
const GalaxyMap3D = memo(lazy(() => import("../GalaxyMap3D").then((m) => ({ default: m.GalaxyMap3D }))));
/** A galaxy map left behind other tabs this long gives its memory back (discuss item 23); its tab redraws it. */
const GALAXY_RELEASE_MS = 10 * 60_000;

/** The scan route (plan 1.3.3 R-4): a WebGL view, freed in the background as the galaxy map is. */
const ScanRouteScreen = lazy(() => import("../scanRoute/ScanRouteScreen").then((m) => ({ default: m.ScanRouteScreen })));

/** The EDEXO browser's tab (plan 9): its code loads only when the tab opens. */
const BrowserScreen = lazy(() => import("../BrowserScreen").then((m) => ({ default: m.BrowserScreen })));

const PlanetQuickFactsPopup = lazy(() =>
  import("../PlanetQuickFactsPopup").then((m) => ({ default: m.PlanetQuickFactsPopup })),
);


type NotableQuick = { notable: NotableBodyInfo; x: number; y: number };

const sameNotable = (a: NotableBodyInfo, b: NotableBodyInfo) => a.bodyId === b.bodyId && a.systemAddress === b.systemAddress;

/** What the Notable card's tooltip said beyond the name and tag: now at the top of the quick facts. */
function notableNotes(n: NotableBodyInfo): string[] {
  return [
    ...(n.sold ? ["Data sold"] : []),
    ...(n.green ? [n.green.why] : []),
    ...(n.features ?? []).map((f) => `${f.label}: ${f.why}`),
  ];
}

export interface HeaderScreensProps {
  snap: AppSnapshot;
  app: "compare" | "colonize";
  encyclopediaSpawnCompare: EncyclopediaSpawnCompare | null;
  onFootCatalogNavigate?: (e: FootScannedEntry) => void;
  onDiscoveriesNavigate?: (systemAddress: number, bodyKey?: string) => void;
  onGoToBioBody?: (bodyKey: string) => void;
  galaxyTab: boolean;
  browserOpen: boolean;
  statsOpen: boolean;
  closeStats: () => void;
  boxelOpen: boolean;
  closeBoxels: () => void;
  bookmarksOpen: boolean;
  closeBookmarks: () => void;
  poiOpen: boolean;
  closePoi: () => void;
  carriersOpen: boolean;
  closeCarriers: () => void;
  backlogOpen: boolean;
  closeBacklog: () => void;
  achievementsOpen: boolean;
  closeAchievements: () => void;
  encyclopediaOpen: boolean;
  closeEncyclopedia: () => void;
  myExoOpen: boolean;
  closeMyExo: () => void;
  sessionOpen: boolean;
  closeSession: () => void;
  scanRouteOpen: boolean;
  closeScanRoute: () => void;
  dataBreakdownOpen: boolean;
  setDataBreakdownOpen: (open: boolean) => void;
  scanDataOn: boolean;
  togglePranavAntal: (on: boolean) => void;
  postCarrierSetting: (route: string, on: boolean) => void;
  optionsOpen: boolean;
  setOptionsOpen: (open: boolean) => void;
  resetExobiology: () => void;
  feederOpen: boolean;
  setFeederOpen: (open: boolean) => void;
  feeder: ReturnType<typeof useFeederStatus>;
  /** The notable body clicked (kept until a jump) and the one hovered (plan 1.3.4 S-8, HeaderBar.tsx). */
  notableQuick: NotableQuick | null;
  setNotableQuick: (q: NotableQuick | null) => void;
  notableHover: NotableQuick | null;
}

export function HeaderScreens({
  snap,
  app,
  encyclopediaSpawnCompare,
  onFootCatalogNavigate,
  onDiscoveriesNavigate,
  onGoToBioBody,
  galaxyTab,
  browserOpen,
  statsOpen,
  closeStats,
  boxelOpen,
  closeBoxels,
  bookmarksOpen,
  closeBookmarks,
  poiOpen,
  closePoi,
  carriersOpen,
  closeCarriers,
  backlogOpen,
  closeBacklog,
  achievementsOpen,
  closeAchievements,
  encyclopediaOpen,
  closeEncyclopedia,
  myExoOpen,
  closeMyExo,
  sessionOpen,
  closeSession,
  scanRouteOpen,
  closeScanRoute,
  dataBreakdownOpen,
  setDataBreakdownOpen,
  scanDataOn,
  togglePranavAntal,
  postCarrierSetting,
  optionsOpen,
  setOptionsOpen,
  resetExobiology,
  feederOpen,
  setFeederOpen,
  feeder,
  notableQuick,
  setNotableQuick,
  notableHover,
}: HeaderScreensProps) {
  // The body hovered (unless it is the one kept), else the one kept: one card at a time.
  const shownNotable =
    notableHover && !(notableQuick && sameNotable(notableHover.notable, notableQuick.notable))
      ? { ...notableHover, mode: "preview" as const }
      : notableQuick
        ? { ...notableQuick, mode: "pinned" as const }
        : null;
  // In Colonize the on-foot scans are not in the live feed: asked for when a screen that shows them opens (item 22).
  const footScanned = useFootScanned(snap, encyclopediaOpen || myExoOpen);
  return (
    <>
      {galaxyTab ? (
        <TabSlot kind="galaxy" releaseAfterMs={GALAXY_RELEASE_MS}>
          <Suspense fallback={<ModalLoading />}>
            <GalaxyMap3D />
          </Suspense>
        </TabSlot>
      ) : null}
      {statsOpen ? (
        <TabSlot kind="stats">
          <Suspense fallback={<ModalLoading />}>
            <StatisticsModal onClose={closeStats} />
          </Suspense>
        </TabSlot>
      ) : null}

      {boxelOpen ? (
        <TabSlot kind="boxels">
        <Suspense fallback={<ModalLoading />}>
          <BoxelScreen
            onClose={closeBoxels}
            currentSystem={snap.currentSystem ?? null}
            dScan={snap.dScanBodies ?? null}
            revision={snap.boxelsRevision ?? 0}
            copied={snap.boxelCopied ?? null}
          />
        </Suspense>
        </TabSlot>
      ) : null}
      {bookmarksOpen ? (
        <TabSlot kind="bookmarks">
        <Suspense fallback={<ModalLoading />}>
          <BookmarksModal
            onClose={closeBookmarks}
            currentSystemAddress={snap.currentSystemAddress ?? null}
          />
        </Suspense>
        </TabSlot>
      ) : null}
      {browserOpen ? (
        <TabSlot kind="browser">
          <Suspense fallback={<ModalLoading />}>
            <BrowserScreen />
          </Suspense>
        </TabSlot>
      ) : null}
      {poiOpen ? (
        <TabSlot kind="poi">
        <Suspense fallback={<ModalLoading />}>
          <PoiModal onClose={closePoi} />
        </Suspense>
        </TabSlot>
      ) : null}

      {carriersOpen ? (
        <TabSlot kind="carriers">
        <Suspense fallback={<ModalLoading />}>
          <CarriersModal onClose={closeCarriers} />
        </Suspense>
        </TabSlot>
      ) : null}

      {backlogOpen ? (
        <TabSlot kind="backlog">
        <Suspense fallback={<ModalLoading />}>
          <FirstDiscoveryBacklogModal onClose={closeBacklog} />
        </Suspense>
        </TabSlot>
      ) : null}

      {achievementsOpen ? (
        <TabSlot kind="achievements">
        <Suspense fallback={<ModalLoading />}>
          <AchievementsModal onClose={closeAchievements} />
        </Suspense>
        </TabSlot>
      ) : null}
      {encyclopediaOpen ? (
        <TabSlot kind="encyclopedia">
        <Suspense fallback={<ModalLoading />}>
          <EncyclopediaModal
            footScannedEntries={footScanned}
            spawnCompare={encyclopediaSpawnCompare}
            // "Where you are now": the ship's region, not the viewed system's (2026-10-12).
            currentRegion={(snap.shipRegion !== undefined ? snap.shipRegion : snap.currentRegion)?.name ?? null}
            onClose={closeEncyclopedia}
          />
        </Suspense>
        </TabSlot>
      ) : null}
      {myExoOpen ? (
        <TabSlot kind="myExo">
        <Suspense fallback={<ModalLoading />}>
          <MyExobiologyModal
            entries={footScanned}
            onClose={closeMyExo}
            onNavigateEntry={onFootCatalogNavigate}
            onNavigateSystem={onDiscoveriesNavigate}
          />
        </Suspense>
        </TabSlot>
      ) : null}
      {dataBreakdownOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <DataValueBreakdownModal
            lines={snap.organicPendingLines ?? []}
            includeExplorationScanDataInDataValue={scanDataOn}
            explorationFssScanCount={snap.explorationFssScanCount ?? 0}
            explorationFssValueCredits={snap.explorationFssValueCredits ?? 0}
            explorationHonkValueCredits={snap.explorationHonkValueCredits ?? 0}
            explorationDssScanCount={snap.explorationDssScanCount ?? 0}
            explorationDssValueCredits={snap.explorationDssValueCredits ?? 0}
            exobioScanCount={snap.organicPendingSampleCount}
            exobioValueCredits={snap.organicDataValueCredits}
            pranavAntalBonus={snap.pranavAntalBonus === true}
            onTogglePranavAntal={togglePranavAntal}
            sellAtFleetCarrier={snap.sellAtFleetCarrier === true}
            onToggleFleetCarrier={(on) => postCarrierSetting("/api/settings/fleet-carrier-sale", on)}
            fleetCarrierIsOwn={snap.fleetCarrierIsOwn === true}
            onToggleOwnCarrier={(on) => postCarrierSetting("/api/settings/fleet-carrier-own", on)}
            onClose={() => setDataBreakdownOpen(false)}
          />
        </Suspense>
      ) : null}
      {scanRouteOpen ? (
        <TabSlot kind="scanRoute" releaseAfterMs={GALAXY_RELEASE_MS}>
          <Suspense fallback={<ModalLoading />}>
            <ScanRouteScreen onClose={closeScanRoute} />
          </Suspense>
        </TabSlot>
      ) : null}
      {sessionOpen ? (
        <TabSlot kind="session">
          <Suspense fallback={<ModalLoading />}>
            <SessionLogModal log={snap.sessionLog ?? null} onClose={closeSession} />
          </Suspense>
        </TabSlot>
      ) : null}
      {optionsOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <MapOptionsModal
            snap={snap}
            plusMinCr={snap.exoMapTierPlusMinCr}
            plusPlusMinCr={snap.exoMapTierPlusPlusMinCr}
            onResetExobiology={resetExobiology}
            onClose={() => setOptionsOpen(false)}
            app={app}
          />
        </Suspense>
      ) : null}
      {feederOpen ? (
        <Suspense fallback={<ModalLoading />}>
          <FeederModal status={feeder.status} onRefresh={feeder.refresh} onClose={() => setFeederOpen(false)} />
        </Suspense>
      ) : null}
      {shownNotable ? (
        <Suspense fallback={null}>
          <PlanetQuickFactsPopup
            key={`${shownNotable.mode}:${shownNotable.notable.systemAddress}:${shownNotable.notable.bodyId}`}
            mode={shownNotable.mode}
            notes={notableNotes(shownNotable.notable)}
            detail={snap.systemMap?.detailsByBodyId[String(shownNotable.notable.bodyId)] ?? null}
            fallbackTitle={shownNotable.notable.bodyName}
            fallbackSubtitle={`${shownNotable.notable.tag}${shownNotable.notable.dssMapped ? " · DSS mapped" : " · FSS / scan only"}`}
            bodyId={shownNotable.notable.bodyId}
            records={snap.notices?.recordMarks.filter((m) => m.bodyId === shownNotable.notable.bodyId)}
            onClose={() => setNotableQuick(null)}
            onGoToBioBody={
              onGoToBioBody
                ? (bk) => {
                    setNotableQuick(null);
                    onGoToBioBody(bk);
                  }
                : undefined
            }
            pos={{ left: shownNotable.x, top: shownNotable.y }}
          />
        </Suspense>
      ) : null}
    </>
  );
}
