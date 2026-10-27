/**
 * `?screen=galaxy` — the 3D galaxy map (G1–G4, docs/galaxy-plan-28092026.md). Its own window, loaded
 * fresh every time it opens and freed when it closes (owner, 2026-09-28). Since G4 it is what the
 * top bar opens; the Classic sector map (`?screen=map`) stays as the fallback where WebGL cannot run.
 *
 * The heavy lifting is in galaxy3d/GalaxyEngine.ts; this is the shell: the toolbar and Find box, the
 * names over the canvas, the hover card, the panels, the commander's own layer and route, the Search
 * and Codex drawers, and what to say when the machine cannot draw it.
 */
import { useInTab, useTabInFront } from "./tabs/TabHost";
import { GALAXY_DRAWER_EVENT, peekGalaxyDrawer, takeGalaxyDrawer } from "./galaxyDrawerRequest";
import { withTransition } from "./motion";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GalaxyEngine,
  type EngineStats,
  type HoverInfo,
  type MarkerItem,
  type Selection,
} from "./galaxy3d/GalaxyEngine";
import { detectGraphics, type Graphics } from "./galaxy3d/capabilities";
import { SYSTEM_CHANGED_EVENT } from "./useLiveSnapshot";
import { placeLabels } from "./galaxy3d/labelPlacement";
import { formatCount } from "./galaxy3d/clusters";
import type { GalaxySearchApplied } from "./GalaxySearchPanel";
import { GalaxyIndexDownload } from "./GalaxyIndexDownload";
import type { NavRouteSystemDTO } from "./GalaxyNavRoutePanel";
import {
  EMPTY_GALAXY_FILTER,
  GalaxyFilterPanel,
  galaxyFilterQuery,
  galaxyFilterTicks,
  isGalaxyFilterState,
} from "./GalaxyFilterPanel";
import {
  EXPEDITION_FOCUS_EVENT,
  ExpeditionDrawer,
  expeditionColours,
  expeditionSize,
  takeExpeditionFocus,
} from "./ExpeditionDrawer";
import type { JumpRow } from "./galaxy3d/jumpRow";
import type { FinderHit, FinderResult } from "@shared/finder";
import { StationsList } from "./galaxy3d/StationsAt";
import { STATIONS_CHANGED_EVENT } from "./StationsPanel";
import { CARRIERS_STATIONS_TITLE, useCarriersStationsTab, type CarriersStationsPick } from "./carriersStationsTab";
import {
  CarriersStationsBody,
  CarriersStationsTabs,
  CodexMenu,
  DrawerLoading,
  FinderDrawer,
  GalaxyNavRoutePanel,
  GalaxySearchPanel,
  JumponiumDrawer,
  NeutronDrawer,
  preloadGalaxyDrawers,
} from "./galaxy3d/lazyDrawers";
import { clearStationsAtCache } from "./galaxy3d/StationsAt";
import type { ExpeditionFieldDTO, ExpeditionPlanDTO } from "@shared/dto/expedition";
import {
  drawnGalaxyFrame,
  drawnGalaxySprites,
  galaxyImageRect,
  REGION_MAP_SIZE,
  xForRegionPx,
  zForRegionPz,
} from "./regionBackdrop";
import { CLOUD_SPRITE_STRIDE } from "@shared/galaxyClouds";
import { regionOutlines, type RegionOutlines } from "@shared/regionBorders.js";
import { regionIndexForCoords, regionJoinKey, type RegionMapData } from "@shared/regionMap.js";
import type { GalaxyFindDTO, GalaxyMineDTO, GalaxyNextDTO, GalaxyRouteDTO } from "@shared/types";
import type {
  CodexMapKind,
  CodexMapRegionDTO,
  CodexMapRegionsDTO,
  CodexMapSystemDTO,
} from "@shared/dto/codexMap.js";
import {
  GALAXY_LAYERS,
  layerPointText,
  UNCONFIRMED_COLOUR,
  type GalaxyLayerDTO,
  type GalaxyLayerKind,
} from "@shared/galaxyLayers.js";
import { isBool, usePersistedState } from "./usePersistedState";
import { Tooltip } from "./ui/Tooltip";
import { G3D_HELP, G3D_TABS, G3dIcon, MenuHead } from "./galaxy3d/G3dMenu";
import {
  codexColour,
  dist,
  drawerFromUrl,
  LABEL_H,
  LABEL_POOL_MAX,
  labelWidth,
  MINE_UNFINISHED,
  mineColour,
  NAV_UNVISITED_COLOUR,
  NAVROUTE_COLOUR,
  PLAN_COLOUR,
  PLAN_MARGIN,
  SEARCH_COLOUR,
  WORTH_STEPS_M,
  type Colour,
  type Drawer,
  type MineRow,
  type SpanshFindHit,
} from "./galaxy3d/mapConstants";
import type { MapLookups } from "./galaxy3d/pointLookup";
import { hoverTip } from "./galaxy3d/hoverTip";
import { selectionPanel } from "./galaxy3d/selectionPanel";
import { ViewMenu } from "./galaxy3d/ViewMenu";
import { TargetsMenu } from "./galaxy3d/TargetsMenu";
import { LayersMenu } from "./galaxy3d/LayersMenu";
import { StatusBar } from "./galaxy3d/StatusBar";
import { onServerChange } from "./serverChanges";

/** The base layers (View menu); a stored copy missing a key, or with a non-boolean, is not used. */
const BASE_LAYERS = { photo: true, borders: true, labels: true, groups: true, you: true };
const isBaseLayers = (v: unknown): v is typeof BASE_LAYERS =>
  !!v && typeof v === "object" && Object.keys(BASE_LAYERS).every((k) => typeof (v as Record<string, unknown>)[k] === "boolean");
const isColour = (v: unknown): v is Colour => v === 0 || v === 1 || v === 2;
/** The Brightness slider's range. */
const isExposure = (v: unknown): v is number => typeof v === "number" && v >= 0.2 && v <= 4;
const isWaitMinM = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/*
  The constants, the hover card, the side panel's records, why a dot is lit, and the View, Layers and
  Codex drawers and the status bar live in galaxy3d/ since the audit of 2026-10-22 (phase 1: no hook
  moved; every hook is still here, above the early return).
*/

export function GalaxyMap3D() {
  // Its polls run only while it is in front (a tab behind others stays mounted).
  const inFront = useTabInFront();
  const host = useRef<HTMLDivElement | null>(null);
  const labelLayer = useRef<HTMLDivElement | null>(null);
  const engine = useRef<GalaxyEngine | null>(null);
  /** Names never go under the side panel: while it is open the labels' viewport stops short of it. */
  const panelOpen = useRef(false);
  const regionData = useRef<RegionMapData | null>(null);
  const outlines = useRef<RegionOutlines | null>(null);
  const [graphics] = useState<Graphics>(() => detectGraphics());
  const [stats, setStats] = useState<EngineStats | null>(null);
  // The View menu and the base layers, remembered between opens like the extra layers below (owner, 2026-10-23:
  // "activated or deactivated layers and other options in the galaxy map should be remembered on close"). Drawers and
  // the plan list still start closed.
  const [colour, setColour] = usePersistedState<Colour>("galaxy.view.colour", 0, isColour);
  const [exposure, setExposure] = usePersistedState("galaxy.view.exposure", 1.2, isExposure);
  const [layers, setLayers] = usePersistedState("galaxy.layer.base", BASE_LAYERS, isBaseLayers);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  /*
    Carriers & Stations measures from the picked system, else the ship (R4, owner 2026-10-23). A row picked in the
    drawer selects its own system, and that pick must not re-sort the list under the cursor: the drawer's own picks
    are remembered and leave the point where it was. A group ring is not a system: it leaves the point too.
  */
  const [csTab, setCsTab] = useCarriersStationsTab();
  const [csFrom, setCsFrom] = useState<{ x: number; y: number; z: number } | null>(null);
  const csOwnPick = useRef("");
  useEffect(() => {
    if (!selection) return setCsFrom(null);
    if (selection.kind === "sector") return;
    const key = `${selection.x.toFixed(1)},${selection.y.toFixed(1)},${selection.z.toFixed(1)}`;
    if (key === csOwnPick.current) return;
    setCsFrom({ x: selection.x, y: selection.y, z: selection.z });
  }, [selection]);
  // The expedition planner (plan 2.5): its scored boxels, the plan's stops and the ordered plan.
  const [expField, setExpField] = useState<ExpeditionFieldDTO | null>(null);
  const [expPlanKeys, setExpPlanKeys] = useState<string[]>([]);
  const [expPlan, setExpPlan] = useState<ExpeditionPlanDTO | null>(null);
  // The neutron route's line (plan 8), drawn while the drawer has one.
  const [neutronLine, setNeutronLine] = useState<{ x: number; y: number; z: number }[]>([]);
  // The Jumponium tab's results (1.2.16), drawn while it is open.
  const [jumpRows, setJumpRows] = useState<JumpRow[]>([]);
  // The picked one is kept apart, so its card stays when the list changes or the tab closes (review 1.2.16).
  const [jumpPicked, setJumpPicked] = useState<JumpRow | null>(null);
  const jumpById = useMemo(() => new Map(jumpRows.map((r) => [r.id, r])), [jumpRows]);
  // The colonisation candidate search's hits (renamed from Find systems, owner 2026-10-19) and the references they
  // were measured from (plan-finder-1.2.20), drawn while open;
  // the picked hit kept apart like the Laboratory's, so its card outlives the list.
  const [finderHits, setFinderHits] = useState<FinderHit[]>([]);
  const [finderRefs, setFinderRefs] = useState<FinderResult["references"]>([]);
  const [finderPicked, setFinderPicked] = useState<FinderHit | null>(null);
  const finderById = useMemo(() => new Map(finderHits.map((h) => [h.id64, h])), [finderHits]);
  /** A finder marker's hit: from the list, else the picked one when it is that marker. */
  const finderHitFor = useCallback(
    (id: string) => finderById.get(id) ?? (finderPicked?.id64 === id ? finderPicked : null),
    [finderById, finderPicked],
  );
  const onFinderHits = useCallback((hits: FinderHit[], refs: FinderResult["references"]) => {
    setFinderHits(hits);
    setFinderRefs(refs);
  }, []);
  // "A system" in the finder: the one selected on the map, named when the map can name it.
  const [finderAround, setFinderAround] = useState<{ name: string; x: number; y: number; z: number } | null>(null);
  const expByKey = useMemo(() => new Map((expField?.boxels ?? []).map((b) => [b.key, b])), [expField]);
  const [mine, setMine] = useState<Map<string, MineRow>>(new Map());
  const [route, setRoute] = useState<GalaxyRouteDTO | null>(null);
  // Peeked, not taken: this render may be thrown away (galaxyDrawerRequest.ts); taken below once the map is on screen.
  const [drawer, setDrawer] = useState<Drawer>(() => peekGalaxyDrawer() ?? drawerFromUrl());
  // A drawer asked for from another screen while the map is open (Colonize's "Find colony sites", in the Galaxy tab).
  useEffect(() => {
    takeGalaxyDrawer();
    const take = () => {
      const d = takeGalaxyDrawer();
      if (d) setDrawer(d);
    };
    window.addEventListener(GALAXY_DRAWER_EVENT, take);
    return () => window.removeEventListener(GALAXY_DRAWER_EVENT, take);
  }, []);
  const codexOn = drawer === "codex";
  const [codexKind, setCodexKind] = useState<CodexMapKind>("bio");
  const [codexRegions, setCodexRegions] = useState<CodexMapRegionsDTO | null>(null);
  const [codexAsk, setCodexAsk] = useState(0);
  /** The region names Find offers, once the outlines have arrived. */
  const [regionAnchors, setRegionAnchors] = useState<RegionOutlines["anchors"]>([]);
  const [codexRegion, setCodexRegion] = useState<string | null>(null);
  const [codexSystems, setCodexSystems] = useState<Map<string, CodexMapSystemDTO>>(new Map());
  const [search, setSearch] = useState<GalaxySearchApplied | null>(null);
  const [waitMinM, setWaitMinM] = usePersistedState("galaxy.layer.waitMinM", 0, isWaitMinM);
  const [findText, setFindText] = useState("");
  const [find, setFind] = useState<GalaxyFindDTO | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  // Follow the ship as it jumps (owner, 2026-10-04): the camera keeps its distance and moves with you.
  const [follow, setFollow] = usePersistedState("galaxy.follow", true, isBool);
  // Elite-style controls (owner, 2026-10-06): W/A/S/D, Q/E, R/F, a cross-hair over the plane. Remembered.
  const [elite, setElite] = usePersistedState("galaxy.eliteControls", false, isBool);
  // The plan list inside the Targets menu (it was a drawer of its own).
  const [planOn, setPlanOn] = useState(false);
  /*
    The extra layers (D10): points of interest, phenomena, carriers and bookmarks, each from a list
    already on this PC, fetched when switched on. Remembered between opens of the map.
  */
  const [poiOn, setPoiOn] = usePersistedState("galaxy.layer.poi", false, isBool);
  const [nspOn, setNspOn] = usePersistedState("galaxy.layer.nsp", false, isBool);
  const [carriersOn, setCarriersOn] = usePersistedState("galaxy.layer.carriers", false, isBool);
  const [bookmarksOn, setBookmarksOn] = usePersistedState("galaxy.layer.bookmarks", false, isBool);
  const [gggOn, setGggOn] = usePersistedState("galaxy.layer.ggg", false, isBool);
  const [heliumOn, setHeliumOn] = usePersistedState("galaxy.layer.helium", false, isBool);
  const [stationsOn, setStationsOn] = usePersistedState("galaxy.layer.stations", false, isBool);
  // The plotted route's systems you have not been to (owner, 2026-10-04): placed from NavRoute.json.
  const [navUnvisitedOn, setNavUnvisitedOn] = usePersistedState("galaxy.layer.navUnvisited", true, isBool);
  /* The status bar's legend folds away (owner, 2026-10-04, plan 3.7), remembered. */
  const [legendOn, setLegendOn] = usePersistedState("galaxy.legendOpen", true, isBool);
  /* The Filter drawer (owner, 2026-10-04): remembered between opens, so the button says when one is on. */
  const [filter, setFilter] = usePersistedState("galaxy.filter", EMPTY_GALAXY_FILTER, isGalaxyFilterState);
  const [filterMatched, setFilterMatched] = useState<number | null>(null);
  const [filterBusy, setFilterBusy] = useState(false);
  const filterAnswer = useRef<{ query: string; bits: Uint8Array; matched: number } | null>(null);
  const filterTicks = galaxyFilterTicks(filter);
  /*
    What is on its way besides the systems (owner, 2026-10-09: a visual indicator for everything that
    loads): the region outlines, your systems, a layer just switched on, a codex region's markers. Named
    in the turning-circle pill at the top; a layer's own row says "Loading…".
  */
  const [pending, setPending] = useState<string[]>([]);
  const track = useCallback(<T,>(label: string, p: Promise<T>): Promise<T> => {
    setPending((x) => [...x, label]);
    return p.finally(() =>
      setPending((x) => {
        const i = x.indexOf(label);
        return i < 0 ? x : [...x.slice(0, i), ...x.slice(i + 1)];
      }),
    );
  }, []);
  // Layers asked for and not answered yet: one request each, however often the effect below runs.
  const layerAsked = useRef(new Set<GalaxyLayerKind>());
  const extraOn: Record<GalaxyLayerKind, boolean> = {
    poi: poiOn,
    nsp: nspOn,
    carriers: carriersOn,
    bookmarks: bookmarksOn,
    ggg: gggOn,
    helium: heliumOn,
    stations: stationsOn,
  };
  const extraSet: Record<GalaxyLayerKind, (v: boolean) => void> = {
    poi: setPoiOn,
    nsp: setNspOn,
    carriers: setCarriersOn,
    bookmarks: setBookmarksOn,
    ggg: setGggOn,
    helium: setHeliumOn,
    stations: setStationsOn,
  };
  const [extraData, setExtraData] = useState<Partial<Record<GalaxyLayerKind, GalaxyLayerDTO>>>({});
  const [worthStep, setWorthStep] = useState(0);
  const [worthCount, setWorthCount] = useState<number | null>(null);
  const [target, setTarget] = useState<GalaxyNextDTO | null>(null);
  const [targetBusy, setTargetBusy] = useState(false);
  const [skipped, setSkipped] = useState<number[]>([]);
  const [skipVisited, setSkipVisited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [planSize, setPlanSize] = useState(5);
  // Back to where the ship is (plan 5.8): a carrier, a station to sell at. Remembered.
  const [planLoop, setPlanLoop] = usePersistedState("galaxy.planLoop", false, isBool);
  const [planCopied, setPlanCopied] = useState(false);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const lastShip = useRef<{ x: number; y: number; z: number } | null>(null);
  // The route poll's read, for NavRoute → Next to ask for the plotted route at once (stable for the panel's effect).
  const readRouteNow = useRef<(() => void) | null>(null);
  const readRoute = useCallback(() => readRouteNow.current?.(), []);
  const loadMine = useRef<(() => Promise<void>) | null>(null);
  const mineRev = useRef<string | null>(null);
  const followRef = useRef(follow);
  followRef.current = follow;
  const barRef = useRef<HTMLElement | null>(null);

  // Drawers, the panel and the banner sit under the toolbar whatever its height (it wraps when narrow).
  useEffect(() => {
    const bar = barRef.current;
    const root = screenRef.current;
    if (!bar || !root) return;
    const set = () => root.style.setProperty("--g3d-top", `${bar.offsetTop + bar.offsetHeight + 8}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(bar);
    return () => ro.disconnect();
  }, [graphics.tier]);

  // Its own window names itself; as a tab (Tab view) the app window keeps its title.
  const inTab = useInTab() != null;
  useEffect(() => {
    if (!inTab) document.title = "Galaxy map — EDEXO";
  }, [inTab]);

  useEffect(() => {
    const el = host.current;
    if (!el || graphics.tier === "none") return;
    const pool = new Map<string, HTMLDivElement>();
    const e = new GalaxyEngine(el, {
      tier: graphics.tier,
      onStats: setStats,
      onHover: setHover,
      onSelect: setSelection,
      onPlaneClick: (g) => {
        // The Codex mode: a click on the map picks the region under it.
        const data = regionData.current;
        if (!data) return;
        const name = data.regions[regionIndexForCoords(data, g.x, g.z)];
        // Same region, other spelling ("The Formidine Rift" from the list, "Formidine Rift" from the
        // map): keep the current one, or a missed marker refetched and re-framed the region (tester
        // report, 2026-09-30: "if you miss a dot everything resets").
        if (name) setCodexRegion((cur) => (cur && regionJoinKey(cur) === regionJoinKey(name) ? cur : name));
      },
      // Names: placed without overlaps, written straight into the DOM (every rendered frame).
      onLabels: (labels) => {
        const layer = labelLayer.current;
        if (!layer) return;
        const placed = placeLabels(
          labels.map((l) => ({ ...l, w: labelWidth(l), h: LABEL_H })),
          { width: el.clientWidth - (panelOpen.current ? 380 : 0), height: el.clientHeight },
        );
        const byId = new Map(labels.map((l) => [l.id, l]));
        const seen = new Set<string>();
        for (const p of placed) {
          seen.add(p.id);
          const l = byId.get(p.id)!;
          let div = pool.get(p.id);
          if (!div) {
            div = document.createElement("div");
            layer.appendChild(div);
            pool.set(p.id, div);
          }
          if (div.textContent !== l.text) div.textContent = l.text;
          const cls = `g3d-label g3d-label--${l.kind}`;
          if (div.className !== cls) div.className = cls;
          // A badge is centred on its anchor by its own width (CSS), so its tail points at the dot below it.
          const left = l.kind === "badge" ? l.x : p.left;
          const top = l.kind === "badge" ? l.y : p.top;
          div.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
          div.style.display = "";
        }
        // Hidden, kept for the next frame — but a system's label is one div per system ever named, so
        // past a screenful the hidden ones go rather than pile up for the session (plan 2.5, Opus 23).
        for (const [id, div] of pool) {
          if (seen.has(id)) continue;
          if (pool.size > LABEL_POOL_MAX) {
            div.remove();
            pool.delete(id);
          } else div.style.display = "none";
        }
      },
    });
    engine.current = e;
    const debugHandle = {
      stats: () => e.getStats(),
      bench: (n?: number) => e.bench(n),
      camera: () => ({
        target: e.controls.target.toArray().map(Math.round),
        distance: Math.round(e.controls.getDistance()),
        tiltDeg: Math.round((e.controls.getPolarAngle() * 180) / Math.PI),
      }),
      view: (k: "top" | "tilted" | "core" | "sol") => e.view(k),
      targets: () => e.debugTargets(),
      marker: (layer: string) => e.debugMarker(layer),
      filter: () => e.debugFilter(),
      /** For tests: move the camera to a target (game coordinates) at a distance, top-down. */
      lookAt: (x: number, y: number, z: number, distance: number) => {
        e.cancelFlight();
        e.controls.target.set(x, y, -z);
        e.camera.position.set(x, y + distance, -z + 1);
        e.controls.update();
        e.invalidate();
      },
      /** For tests: the camera at one point looking at another (game coordinates). */
      pose: (cam: [number, number, number], target: [number, number, number]) => {
        e.cancelFlight();
        e.controls.target.set(target[0], target[1], -target[2]);
        e.camera.position.set(cam[0], cam[1], -cam[2]);
        e.controls.update();
        e.invalidate();
      },
      /** For tests: whether the EDAstro easter egg is showing, and how strongly. */
      egg: () => e.debugEgg(),
    };
    const win = window as unknown as { __galaxy?: unknown };
    win.__galaxy = debugHandle;

    void e.load();
    // Backdrop: the region outlines, and the drawn Milky Way (placed by the same pin as the 2D map).
    // Each as soon as it is ready: Find's region names must not wait for the drawing.
    void track(
      "regions",
      fetch("/api/region-map")
        .then((r) => (r.ok ? (r.json() as Promise<RegionMapData>) : null))
        .catch(() => null),
    ).then((regions) => {
      if (engine.current !== e) return;
      regionData.current = regions;
      outlines.current = regions ? regionOutlines(regions) : null;
      e.setBackdrop(null, outlines.current);
      setRegionAnchors(outlines.current?.anchors ?? []);
    });
    // The Milky Way as clouds in 3D (owner, 2026-10-04), fewer on the light tier.
    const light = graphics.tier === "light";
    void drawnGalaxySprites(light ? { emission: 40_000, dust: 12_000 } : { emission: 140_000, dust: 40_000 })
      .catch(() => null)
      .then((got) => {
        if (engine.current !== e || !got) return;
        const f = drawnGalaxyFrame();
        const r = galaxyImageRect(f.width, f.height);
        const rect = {
          x0: xForRegionPx(r.x),
          x1: xForRegionPx(r.x + r.width),
          zTop: zForRegionPz(REGION_MAP_SIZE - 1 - r.y),
          zBottom: zForRegionPz(REGION_MAP_SIZE - 1 - (r.y + r.height)),
        };
        // The drawing, faint on the plane, fills the gaps between the clouds seen from above; edge-on
        // the plane is a line and the clouds carry it (owner, 2026-10-04: "less patchiness").
        if (got.image) e.setBackdrop({ url: got.image.url, ...rect }, null);
        e.setClouds(got.sprites, { ...rect, width: f.width, height: f.height }, CLOUD_SPRITE_STRIDE);
      });

    // The commander's own systems (again whenever the route poll says they changed).
    loadMine.current = () =>
      fetch("/api/galaxy/mine")
        .then((r) => (r.ok ? (r.json() as Promise<GalaxyMineDTO>) : null))
        .then((d) => {
          if (d && engine.current === e) setMine(new Map(d.systems.map((s) => [String(s.addr), s])));
        })
        .catch(() => {});
    // The first read only: later ones (after a jump) refresh markers already there.
    void track("your systems", loadMine.current());

    const onResize = () => e.resize();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") e.select(null);
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      ro.disconnect();
      engine.current = null;
      // The handle closes over the engine: left on window it kept the whole galaxy alive after the tab closed.
      if (win.__galaxy === debugHandle) delete win.__galaxy;
      e.dispose();
      pool.forEach((d) => d.remove());
    };
  }, [graphics.tier, track]);

  /*
    Where the ship is and this session's jumps, while the map is in front: behind another tab it stays
    mounted with `document.hidden` false, and its polls kept the server's map memory from ever being let
    go (code review, 2026-10-14). Coming back to the front runs the effect again, which reads at once.
  */
  useEffect(() => {
    if (graphics.tier === "none" || !inFront) return;
    let live = true;
    const tick = () => {
      if (document.hidden) return;
      fetch("/api/galaxy/route")
        .then((r) => (r.ok ? (r.json() as Promise<GalaxyRouteDTO>) : null))
        .then((d) => {
          if (!live || !d) return;
          setRoute(d);
          engine.current?.setRoute(d.route, d.position);
          // A jump, a scan or a map changed your systems: draw them again without a reload.
          if (mineRev.current !== null && d.mineRev !== mineRev.current) void loadMine.current?.();
          mineRev.current = d.mineRev;
          // A jump moved the ship: the camera goes with it, at the distance it was viewing from.
          const p = d.position;
          const prev = lastShip.current;
          lastShip.current = p ?? null;
          if (p && prev && followRef.current && (p.x !== prev.x || p.y !== prev.y || p.z !== prev.z)) {
            const e = engine.current;
            if (e) e.flyTo(p, Math.max(200, e.getStats().distanceLy));
          }
        })
        .catch(() => {});
    };
    tick();
    readRouteNow.current = tick;
    /*
      A jump, read from the journal by the app on this page, moves the map at once (owner, 2026-10-07:
      "use the hyperspace jump ... I don't see a reason the galmap should poll"). What the jump does not carry - a
      scan or a mapping changing your systems, a plotted route - and the map in a window of its own (Tab view off),
      which has no live game data, follow the server's "galaxy-route" change (R2, 2026-10-24: was a check every
      15-30 s). Hidden, the tick skips; coming back reads once.
    */
    const onJump = () => tick();
    window.addEventListener(SYSTEM_CHANGED_EVENT, onJump);
    const stop = onServerChange("galaxy-route", tick);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      live = false;
      stop();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(SYSTEM_CHANGED_EVENT, onJump);
      if (readRouteNow.current === tick) readRouteNow.current = null;
    };
  }, [graphics.tier, inFront]);

  // Elite controls on the engine (it starts without them).
  useEffect(() => {
    engine.current?.setEliteControls(elite);
  }, [elite, stats?.phase]);

  // New station data (downloaded in the Stations drawer): the layer and the station lists are read again.
  useEffect(() => {
    const onChanged = () => {
      clearStationsAtCache();
      engine.current?.setMarkers("x-stations", []);
      setExtraData((prev) => {
        const next = { ...prev };
        delete next.stations;
        return next;
      });
    };
    window.addEventListener(STATIONS_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(STATIONS_CHANGED_EVENT, onChanged);
  }, []);

  // The extra layers: fetched the first time each is switched on, then only shown or hidden.
  useEffect(() => {
    for (const l of GALAXY_LAYERS) {
      if (!extraOn[l.kind] || extraData[l.kind] || layerAsked.current.has(l.kind)) continue;
      layerAsked.current.add(l.kind);
      void track(
        l.label,
        fetch(`/api/galaxy/layers?kind=${l.kind}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d: GalaxyLayerDTO | null) => {
            if (d) setExtraData((prev) => ({ ...prev, [l.kind]: d }));
          })
          .catch(() => {}),
      ).finally(() => layerAsked.current.delete(l.kind));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poiOn, nspOn, carriersOn, bookmarksOn, gggOn, heliumOn, stationsOn, extraData]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    for (const l of GALAXY_LAYERS) {
      const d = extraData[l.kind];
      if (!d) continue;
      const name = `x-${l.kind}`;
      if (!e.hasMarkerLayer(name)) {
        const guess = new Set(d.unconfirmed ?? []);
        e.setMarkers(
          name,
          d.points.map((p, i) =>
            guess.has(i)
              ? { id: String(i), x: p[0], y: p[1], z: p[2], color: UNCONFIRMED_COLOUR, size: l.size - 2 }
              : { id: String(i), x: p[0], y: p[1], z: p[2], color: l.colour, size: l.size },
          ),
          l.kind === "bookmarks" ? 3 : 1,
        );
      }
      e.setMarkerLayerVisible(name, extraOn[l.kind]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraData, poiOn, nspOn, carriersOn, bookmarksOn, gggOn, heliumOn, stationsOn, stats?.phase]);

  /*
    His own carrier's system and his colonies (owner, 2026-10-13: "a little icon"; server/routes/galaxyRoutes.ts
    /api/galaxy/own): an anchor and a house beside them, both on one label when they share a system. Read again
    when they change, so a carrier jump shows without reopening the map.
  */
  useEffect(() => {
    const e = engine.current;
    if (!e || stats?.phase !== "ready" || !inFront) return;
    type Own = { name: string; x: number; y: number; z: number };
    const read = () =>
      void fetch("/api/galaxy/own")
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { carrier: Own | null; colonies: Own[] } | null) => {
          if (!j || engine.current !== e) return;
          const by = new Map<string, Own & { carrier: boolean; colony: boolean }>();
          for (const c of j.colonies) by.set(c.name.toLowerCase(), { ...c, carrier: false, colony: true });
          if (j.carrier) {
            const k = j.carrier.name.toLowerCase();
            by.set(k, { ...(by.get(k) ?? { ...j.carrier, colony: false }), carrier: true });
          }
          e.setBadges(
            [...by.values()].map((b) => ({
              x: b.x,
              y: b.y,
              z: b.z,
              text: `${b.carrier ? "⚓" : ""}${b.colony ? "⌂" : ""} ${b.carrier && b.colony ? "Your carrier · colony" : b.carrier ? "Your carrier" : "Your colony"}`,
            })),
          );
        })
        .catch(() => undefined);
    read();
    // A carrier jump or a new colony (R2, 2026-10-24: was asked every minute).
    return onServerChange("galaxy-own", read);
  }, [stats?.phase, inFront]);

  // The expedition field and plan: drawn while the Expedition drawer has scored something.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (!expField) {
      e.setMarkers("expedition", []);
      return;
    }
    const colour = expeditionColours(expField);
    e.setMarkers(
      "expedition",
      expField.boxels.map((b) => ({
        id: b.key,
        x: b.center.x,
        y: b.center.y,
        z: b.center.z,
        color: colour.get(b.key)!,
        size: expeditionSize(b),
      })),
      2,
    );
    e.setMarkerLayerVisible("expedition", drawer === "expedition");
  }, [expField, drawer, stats?.phase]);
  // Opened from the header's "Next boxel" (plan 2.7): the Expedition drawer, the camera on it, selected once scored.
  const [expFocus, setExpFocus] = useState<{
    key: string;
    center: { x: number; y: number; z: number };
    cubeLy: number;
  } | null>(null);
  useEffect(() => {
    const take = () => {
      const f = takeExpeditionFocus();
      if (f) setExpFocus(f);
    };
    take();
    window.addEventListener(EXPEDITION_FOCUS_EVENT, take);
    return () => window.removeEventListener(EXPEDITION_FOCUS_EVENT, take);
  }, []);
  const expFlown = useRef<string | null>(null);
  useEffect(() => {
    const phase = stats?.phase;
    if (!expFocus || !engine.current || !phase || phase === "loading") return;
    if (expFlown.current !== expFocus.key) {
      expFlown.current = expFocus.key;
      setDrawer("expedition");
      engine.current.flyTo(expFocus.center, Math.max(300, expFocus.cubeLy * 6));
    }
    if (expByKey.has(expFocus.key)) {
      engine.current.select({ kind: "marker", layer: "expedition", id: expFocus.key, ...expFocus.center });
      expFlown.current = null;
      setExpFocus(null);
    }
  }, [expFocus, expByKey, stats?.phase]);

  // A picked species' position rule: a ring round every point it is measured from, while the drawer is open.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const rule = drawer === "expedition" ? expField?.rule : null;
    e.setCircles(
      "expedition-rule",
      rule ? rule.points.map((p) => ({ x: p.x, y: p.y, z: p.z, r: p.radiusLy })) : [],
      0x5fd8ff,
    );
  }, [expField, drawer, stats?.phase]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const ship = route?.position ?? null;
    e.setPathLine(
      "expedition-plan",
      expPlan && ship ? [ship, ...expPlan.stops.map((s) => s.center)] : [],
      0xffc23a,
    );
  }, [expPlan, route?.position, stats?.phase]);
  // An expedition route (plan 5.2): the line from where it was scored to its end, blue beside the amber plan.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const to = drawer === "expedition" ? expField?.to : null;
    e.setPathLine("expedition-route", to && expField ? [expField.from, to] : [], 0x4fd0ff);
    e.setPathLine("neutron-route", drawer === "neutron" ? neutronLine : [], 0x9a7bff);
  }, [expField, drawer, neutronLine, stats?.phase]);

  // Jumponium bodies (1.2.16): violet-pink, the commander's own scans brighter, while the tab is open.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setMarkers(
      "jumponium",
      drawer === "jumponium"
        ? jumpRows.map((r) => ({
            id: r.id,
            x: r.x,
            y: r.y,
            z: r.z,
            color: r.own ? [1, 0.55, 0.95] : [0.85, 0.4, 0.8],
            size: r.own ? 8 : 6,
          }))
        : [],
      2,
    );
    e.setMarkerLayerVisible("jumponium", drawer === "jumponium");
  }, [jumpRows, drawer, stats?.phase]);

  // The colonisation candidate search: hits in teal (fully scanned brighter), the references they are measured from in gold.
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const on = drawer === "finder";
    e.setMarkers(
      "finder",
      on
        ? finderHits.map((h) => ({
            id: h.id64,
            x: h.x,
            y: h.y,
            z: h.z,
            color: h.fullyScanned ? [0.35, 1, 0.85] : [0.25, 0.8, 0.7],
            size: 7,
          }))
        : [],
      2,
    );
    e.setMarkers(
      "finder-ref",
      on ? finderRefs.slice(0, 2000).map((r, i) => ({ id: `ref${i}`, x: r.x, y: r.y, z: r.z, color: [1, 0.78, 0.3], size: 5 })) : [],
      1,
    );
    e.setMarkerLayerVisible("finder", on);
    e.setMarkerLayerVisible("finder-ref", on);
  }, [finderHits, finderRefs, drawer, stats?.phase]);

  // What "A system" in the finder searches round: the selection, named by the map when it can.
  useEffect(() => {
    if (drawer !== "finder" || !selection || selection.kind === "sector") return;
    const at = { x: selection.x, y: selection.y, z: selection.z };
    if (selection.kind === "marker" && selection.layer === "finder") {
      const h = finderHitFor(selection.id);
      if (h) setFinderAround({ name: h.name, ...at });
      return;
    }
    if (selection.kind !== "index") {
      setFinderAround({ name: "Selected point", ...at });
      return;
    }
    let alive = true;
    void fetch(`/api/galaxy/system?i=${selection.ordinal}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ name?: string }>) : null))
      .then((d) => {
        if (alive) setFinderAround({ name: d?.name || "Selected system", ...at });
      })
      .catch(() => {
        if (alive) setFinderAround({ name: "Selected system", ...at });
      });
    return () => {
      alive = false;
    };
  }, [selection, drawer, finderHitFor]);

  // The commander's layer, with the "waiting at least" threshold: below it a waiting system is grey.
  const waitMinCr = waitMinM * 1_000_000;
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setMarkers(
      "you",
      [...mine.values()].map((s) => ({
        id: String(s.addr),
        x: s.x,
        y: s.y,
        z: s.z,
        color: mineColour(s.flags, (s.unfinishedFloorCr ?? 0) >= waitMinCr),
        size: s.flags & 32 ? 8 : 6,
      })),
      2,
    );
    e.setMarkerLayerVisible("you", layers.you);
  }, [mine, waitMinCr, layers.you]);

  /** The nearest waiting system at or above the threshold (the Classic map's "nearest that qualifies"). */
  const nearest = useMemo(() => {
    const ship = route?.position;
    if (!ship) return null;
    let best: { row: MineRow; ly: number } | null = null;
    for (const r of mine.values()) {
      if (!(r.flags & MINE_UNFINISHED) || (r.unfinishedFloorCr ?? 0) < waitMinCr) continue;
      const ly = dist(ship, r);
      if (!best || ly < best.ly) best = { row: r, ly };
    }
    return best;
  }, [mine, route, waitMinCr]);

  /*
    The filter's answer: bits over the map's ordinals, asked again only when the ticks change (hide
    on or off is the engine's alone). A quarter second of quiet first, for quick ticking.
  */
  const filterQuery = galaxyFilterQuery(filter);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    if (!filterQuery) {
      filterAnswer.current = null;
      e.setFilter(null, false, 0);
      setFilterMatched(null);
      setFilterBusy(false);
      return;
    }
    const have = filterAnswer.current;
    if (have && have.query === filterQuery) {
      e.setFilter(have.bits, filter.hide, have.matched);
      return;
    }
    let live = true;
    setFilterBusy(true);
    const t = window.setTimeout(() => {
      void fetch(`/api/galaxy/filter?${filterQuery}`)
        .then(async (r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const buf = await r.arrayBuffer();
          const head = new TextDecoder().decode(new Uint8Array(buf, 0, 8));
          if (head !== "EDXFLT01") throw new Error("not a filter answer");
          const dv = new DataView(buf);
          const matched = dv.getUint32(12, true);
          return { bits: new Uint8Array(buf, 16), matched };
        })
        .then(({ bits, matched }) => {
          if (!live) return;
          filterAnswer.current = { query: filterQuery, bits, matched };
          engine.current?.setFilter(bits, filter.hide, matched);
          setFilterMatched(matched);
        })
        .catch(() => {
          if (live) setFilterMatched(null);
        })
        .finally(() => {
          if (live) setFilterBusy(false);
        });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [filterQuery, filter.hide]);

  useEffect(() => engine.current?.setColourMode(colour), [colour]);
  useEffect(() => engine.current?.setExposure(exposure), [exposure]);
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.setLayer("photo", layers.photo);
    e.setLayer("borders", layers.borders);
    e.setLayer("labels", layers.labels);
    // The Codex mode has dots of its own; rings over them were clutter (G3).
    e.setLayer("groups", layers.groups && !codexOn);
    if (labelLayer.current) labelLayer.current.style.display = layers.labels ? "" : "none";
  }, [layers, codexOn]);

  useEffect(() => {
    panelOpen.current = !!selection;
    engine.current?.invalidate();
  }, [selection]);

  // ------------------------------------------------------------- the plotted route, unvisited
  useEffect(() => {
    const items: MarkerItem[] = navUnvisitedOn
      ? (route?.navRoute ?? [])
          .filter((s) => !s.visited)
          .map((s) => ({
            id: String(s.address),
            x: s.x,
            y: s.y,
            z: s.z,
            color: NAV_UNVISITED_COLOUR,
            size: 6,
          }))
      : [];
    engine.current?.setMarkers("navUnvisited", items, 2);
  }, [route?.navRoute, navUnvisitedOn]);

  // -------------------------------------------------------------------------- the NavRoute finder
  /* The systems its filters leave, marked on the map (owner, 2026-10-04); none while it is closed. */
  const [navShown, setNavShown] = useState<NavRouteSystemDTO[]>([]);
  useEffect(() => {
    const items: MarkerItem[] =
      drawer === "navroute"
        ? navShown.slice(0, 5000).map((s) => ({
            id: String(s.address),
            x: s.pos[0],
            y: s.pos[1],
            z: s.pos[2],
            color: s.edsm === false ? [0.36, 0.9, 0.46] : s.visited ? [0.62, 0.66, 0.74] : NAVROUTE_COLOUR,
            size: 7,
          }))
        : [];
    engine.current?.setMarkers("navroute", items, 3);
  }, [navShown, drawer]);

  // ------------------------------------------------------------------------------ the Search drawer
  const onApply = useCallback((applied: GalaxySearchApplied | null) => setSearch(applied), []);
  useEffect(() => {
    const items: MarkerItem[] = (search?.hits ?? []).map((h) => ({
      id: String(h.systemAddress),
      x: h.x,
      y: h.y,
      z: h.z,
      color: SEARCH_COLOUR,
      size: 8,
    }));
    engine.current?.setMarkers("search", items, 4);
  }, [search]);
  const searchHits = useMemo(
    () => new Map((search?.hits ?? []).map((h) => [String(h.systemAddress), h])),
    [search],
  );
  const commanderRegionId = useMemo(() => {
    const p = route?.position;
    const data = regionData.current;
    return p && data ? regionIndexForCoords(data, p.x, p.z) || null : null;
  }, [route]);

  // ------------------------------------------------------------------------------ the Codex mode
  useEffect(() => {
    engine.current?.setPlaneClickMode(codexOn);
    if (!codexOn) {
      engine.current?.setMarkers("codex", []);
      setCodexSystems(new Map());
      return;
    }
    if (!codexRegions) {
      // Not ready while the journals replay: ask again in a moment rather than leave the list empty.
      let live = true;
      let retry: ReturnType<typeof setTimeout> | undefined;
      const later = () => {
        if (live) retry = setTimeout(() => setCodexAsk((n) => n + 1), 2000);
      };
      fetch("/api/codex/regions")
        .then((r) => (r.ok ? (r.json() as Promise<CodexMapRegionsDTO>) : null))
        .then((d) => (d ? live && setCodexRegions(d) : later()))
        .catch(later);
      return () => {
        live = false;
        clearTimeout(retry);
      };
    }
  }, [codexOn, codexRegions, codexAsk]);

  useEffect(() => {
    if (!codexOn || !codexRegion) return;
    let live = true;
    // The previous region's dots go at once, not when (or if) the new region's answer arrives (1.2.19 review).
    engine.current?.setMarkers("codex", [], 3);
    setCodexSystems(new Map());
    // The region map and EDSM spell a few regions differently; the join key settles it.
    const summary = codexRegions?.regions.find((r) => r.joinKey === regionJoinKey(codexRegion));
    const name = summary?.name ?? codexRegion;
    track(
      "codex",
      fetch(`/api/codex/region?name=${encodeURIComponent(name)}&kind=${codexKind}`).then((r) =>
        r.ok ? (r.json() as Promise<CodexMapRegionDTO>) : null,
      ),
    )
      .then((d) => {
        if (!live || !d) return;
        setCodexSystems(new Map(d.systems.map((s) => [s.systemAddress, s])));
        const items: MarkerItem[] = d.systems.map((s) => ({
          id: s.systemAddress,
          x: s.x,
          y: 0,
          z: s.z,
          color: codexColour[s.status],
          size: 6,
        }));
        engine.current?.setMarkers("codex", items, 3);
        engine.current?.fitTo(d.systems);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [codexOn, codexRegion, codexKind, codexRegions, track]);

  const codexSummary = useMemo(
    () =>
      codexRegion ? codexRegions?.regions.find((r) => r.joinKey === regionJoinKey(codexRegion)) : undefined,
    [codexRegion, codexRegions],
  );

  // ------------------------------------------------------------------ G5: worth at least, Next target
  const worthM = WORTH_STEPS_M[worthStep] ?? 0;
  useEffect(() => {
    const e = engine.current;
    if (!e || stats?.phase !== "ready") return;
    setWorthCount(e.setMinValue(worthM * 10)); // million CR → the map's 100 k CR units
  }, [worthM, stats?.phase]);

  /**
   * Ask for the nearest system worth at least the floor that is not done, fly there, copy its name.
   * With the Plan drawer open, the chain of `plan` stops comes along and the camera frames all of it.
   */
  const nextTarget = async (skip: number[], o: { plan?: number; fly?: boolean; loop?: boolean } = {}) => {
    const plan = o.plan ?? (planOn ? planSize : 0);
    const loop = o.loop ?? planLoop;
    setTargetBusy(true);
    try {
      const q = new URLSearchParams({ min: String(worthM * 10), skipVisited: skipVisited ? "1" : "0" });
      if (skip.length) q.set("exclude", skip.join(","));
      if (plan) q.set("plan", String(plan));
      if (plan && loop) q.set("loop", "1");
      const r = await fetch(`/api/galaxy/next?${q}`);
      const d = r.ok ? ((await r.json()) as GalaxyNextDTO) : null;
      setTarget(d);
      setPlanCopied(false);
      const t = d?.target;
      if (t && o.fly !== false) {
        const stops = d?.plan?.stops ?? [];
        if (stops.length > 1) {
          engine.current?.fitTo([...(d?.from ? [d.from] : []), ...stops], PLAN_MARGIN);
          engine.current?.select({ kind: "index", ordinal: t.ordinal, x: t.x, y: t.y, z: t.z });
        } else {
          go(t, 400, { kind: "index", ordinal: t.ordinal, x: t.x, y: t.y, z: t.z });
        }
      }
      if (t) {
        try {
          await navigator.clipboard.writeText(t.name);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      }
    } finally {
      setTargetBusy(false);
    }
  };
  const skipTarget = () => {
    const t = target?.target;
    if (!t) return;
    const next = [...skipped, t.ordinal];
    setSkipped(next);
    void nextTarget(next);
  };

  // G5.3: the plan — the target and the nearest qualifying system after each stop.
  const plan = planOn ? (target?.plan ?? null) : null;
  const openPlan = () => {
    setPlanOn(true);
    void nextTarget(skipped, { plan: planSize });
  };
  /** Skip one stop of the plan: the chain is asked again from the ship, the camera stays. */
  const skipStop = (ordinal: number) => {
    const next = [...skipped, ordinal];
    setSkipped(next);
    void nextTarget(next, { fly: false });
  };
  const planStops = useMemo(
    () => new Map((plan?.stops ?? []).map((s, i) => [String(s.ordinal), { ...s, n: i + 1 }])),
    [plan],
  );
  useEffect(() => {
    const e = engine.current;
    if (!e) return;
    const stops = plan?.stops ?? [];
    e.setPlan(
      stops.map((s, i) => ({ x: s.x, y: s.y, z: s.z, label: String(i + 1) })),
      target?.from ?? null,
      !!plan?.loop,
    );
    e.setMarkers(
      "plan",
      stops.map((s) => ({ id: String(s.ordinal), x: s.x, y: s.y, z: s.z, color: PLAN_COLOUR, size: 9 })),
      5,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- target.from travels with the plan
  }, [plan]);

  // ------------------------------------------------------------------------------ the Find box
  useEffect(() => {
    const q = findText.trim();
    if (q.length < 2) {
      setFind(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      fetch(`/api/galaxy/find?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? (r.json() as Promise<GalaxyFindDTO>) : null))
        .then((d) => live && setFind(d))
        .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [findText]);
  const findRegions = useMemo(() => {
    const q = findText.trim().toLowerCase();
    if (q.length < 2) return [];
    return regionAnchors.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 5);
  }, [findText, regionAnchors]);
  /*
    The layers' own points (owner, 2026-10-05: "Blaa Eork EH-S d5-4" was on the map but Find did not know
    it): the galaxy index holds biology systems only, so a green gas giant, a POI or an NSP elsewhere is
    found here, by its label or its system. The small lists are fetched for the search even while their
    layer is off; the big ones are searched once they have been switched on.
  */
  useEffect(() => {
    if (findText.trim().length < 2) return;
    for (const kind of ["ggg", "helium", "bookmarks"] as const) {
      if (extraData[kind]) continue;
      void fetch(`/api/galaxy/layers?kind=${kind}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: GalaxyLayerDTO | null) => {
          if (d) setExtraData((prev) => (prev[kind] ? prev : { ...prev, [kind]: d }));
        })
        .catch(() => {});
    }
  }, [findText, extraData]);
  /*
    Spansh (owner, 2026-10-06: "add a spansh or EDSM API query to the search there similar to the main
    UI, the user searches for a system, it gets fetched and placed where it should be"): a system the map
    has no point for is asked of Spansh by name; picking it puts a marker at its coordinates.
  */
  const [spanshFind, setSpanshFind] = useState<{ q: string; hits: SpanshFindHit[]; busy: boolean }>({
    q: "",
    hits: [],
    busy: false,
  });
  const [spanshPicked, setSpanshPicked] = useState<Map<string, SpanshFindHit>>(new Map());
  useEffect(() => {
    const q = findText.trim();
    if (q.length < 3) {
      setSpanshFind((f) => (f.q === "" ? f : { q: "", hits: [], busy: false }));
      return;
    }
    let live = true;
    setSpanshFind({ q, hits: [], busy: true });
    const t = setTimeout(() => {
      fetch(`/api/system/spansh-search?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? (r.json() as Promise<{ systems?: SpanshFindHit[] }>) : null))
        .then((d) => {
          if (live) setSpanshFind({ q, hits: (d?.systems ?? []).filter((h) => h.x != null), busy: false });
        })
        .catch(() => live && setSpanshFind({ q, hits: [], busy: false }));
    }, 600);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [findText]);
  useEffect(() => {
    engine.current?.setMarkers(
      "spansh",
      [...spanshPicked.values()].map((h) => ({
        id: String(h.systemAddress),
        x: h.x!,
        y: h.y!,
        z: h.z!,
        color: SEARCH_COLOUR,
        size: 10,
      })),
      4,
    );
  }, [spanshPicked]);
  const findLayerHits = useMemo(() => {
    const q = findText.trim().toLowerCase();
    if (q.length < 2) return [];
    const hits: {
      kind: GalaxyLayerKind;
      id: string;
      label: string;
      system: string;
      what: string;
      x: number;
      y: number;
      z: number;
    }[] = [];
    for (const l of GALAXY_LAYERS) {
      const d = extraData[l.kind];
      if (!d) continue;
      d.points.forEach((p, i) => {
        if (hits.length >= 8) return;
        const system = layerPointText(d, p).system;
        if (!p[3].toLowerCase().includes(q) && !system.toLowerCase().includes(q)) return;
        const where = { x: p[0], y: p[1], z: p[2] };
        hits.push({
          kind: l.kind,
          id: String(i),
          label: p[3],
          system: system || p[3],
          what: l.label,
          ...where,
        });
      });
    }
    return hits;
  }, [findText, extraData]);

  // The drawers load in the background once the map has drawn (lazyDrawers.tsx), so opening one is instant.
  useEffect(() => {
    if (stats?.phase === "ready") preloadGalaxyDrawers();
  }, [stats?.phase]);

  const go = (g: { x: number; y: number; z: number }, distance: number, sel?: Selection) => {
    setFindOpen(false);
    engine.current?.flyTo(g, distance);
    if (sel) engine.current?.select(sel);
  };

  if (graphics.tier === "none") {
    return (
      <div className="g3d-screen g3d-screen--fallback">
        <div className="g3d-fallback">
          <h1>The 3D galaxy map needs WebGL 2</h1>
          <p>
            This window cannot draw it ({graphics.renderer}). The Classic map works everywhere and has the
            same search.
          </p>
          {/* Safe graphics mode (electron/gpuSafeMode.cjs, L1) is the usual cause in the desktop app. */}
          <p className="dim">
            In the desktop app: if <strong>Hardware acceleration</strong> is off in the launcher (it turns itself off
            when the graphics card crashes at start), ticking it again may bring the 3D map back.
          </p>
          {/* In a tab, a window of its own: in place it replaced the whole app window, tabs and all (2026-10-26). */}
          <a className="g3d-btn g3d-btn--primary" href="?screen=map" {...(inTab ? { target: "_blank", rel: "noreferrer" } : {})}>
            Open the Classic map
          </a>
        </div>
      </div>
    );
  }

  const toggle = (k: keyof typeof layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const view = (k: "top" | "tilted" | "core" | "sol") => engine.current?.view(k);
  const toShip = () => {
    const ship = engine.current?.getShip();
    if (ship) engine.current?.flyTo(ship, 2_500);
  };
  // A drawer closing or giving way to another fades out (motion.ts); opening slides in (layout.css).
  const openDrawer = (d: Drawer) => {
    withTransition(() => setDrawer((cur) => (cur === d ? "none" : d)));
    engine.current?.select(null);
  };

  const lookups: MapLookups = {
    extraData,
    route,
    navShown,
    mine,
    planStops,
    jumpById,
    expByKey,
    expField,
    spanshPicked,
    searchHits,
    codexSystems,
  };
  const tip = hoverTip(hover, lookups);

  const panel = selectionPanel(selection, {
    ...lookups,
    filter,
    filterAnswer,
    extraOn,
    go,
    jumpPicked,
    finderHitFor,
    expPlanKeys,
    setExpPlanKeys,
    codexSummary,
    codexRegion,
  });

  const ship = route?.position;
  // Spansh hits the map already shows (as a system or a layer point) are not offered twice.
  const shownNames = new Set([
    ...(find?.systems ?? []).map((s) => s.name.toLowerCase()),
    ...findLayerHits.map((h) => h.system.toLowerCase()),
  ]);
  const spanshShown = spanshFind.hits.filter((h) => !shownNames.has(h.starSystem.toLowerCase())).slice(0, 6);
  const hasFind =
    findOpen &&
    (findRegions.length > 0 ||
      findLayerHits.length > 0 ||
      spanshShown.length > 0 ||
      spanshFind.busy ||
      (find && (find.sectors.length || find.systems.length || (find.stations?.length ?? 0) > 0)));

  return (
    <div className="g3d-screen" ref={screenRef}>
      {/* Systems on their way (owner, 2026-10-06): a small turning circle at the top. */}
      {(stats && (stats.phase === "loading" || stats.tilesLoaded < stats.tilesWanted)) || pending.length ? (
        <div className="g3d-loading" role="status">
          <span className="g3d-loading__spin" aria-hidden="true" /> Loading
          {pending.length ? ` ${[...new Set(pending)].join(", ").toLowerCase()}` : null}
        </div>
      ) : null}
      <div ref={host} className="g3d-canvas" />
      <div ref={labelLayer} className="g3d-labels" aria-hidden="true" />

      {hover && tip ? (
        <div
          className="g3d-tip"
          style={{ transform: `translate(${Math.round(hover.x + 16)}px, ${Math.round(hover.y - 10)}px)` }}
        >
          {tip}
        </div>
      ) : null}

      {selection ? (
        <aside className="g3d-panel" aria-label="Selected" data-testid="g3d-panel">
          <button
            type="button"
            className="g3d-panel__close"
            aria-label="Close"
            onClick={() => engine.current?.select(null)}
          >
            ✕
          </button>
          {panel}
          {/*
            The stations of any system picked (owner, 2026-10-13: his own colonies showed none — their own dot lies
            over the Stations dot, so its card was never asked). Nothing when the system has none or the stations
            are not downloaded.
          */}
          {selection.kind !== "sector" ? (
            <StationsList x={selection.x} y={selection.y} z={selection.z} />
          ) : null}
          <div className="g3d-panel__actions">
            <button
              type="button"
              className="g3d-btn"
              onClick={() => engine.current?.flyTo(selection, selection.kind === "sector" ? 9_000 : 250)}
            >
              Centre here
            </button>
          </div>
        </aside>
      ) : null}

      {drawer === "view" ? (
        <ViewMenu
          view={view}
          route={route}
          toShip={toShip}
          ship={ship}
          follow={follow}
          setFollow={setFollow}
          elite={elite}
          setElite={setElite}
          colour={colour}
          setColour={setColour}
          exposure={exposure}
          setExposure={setExposure}
        />
      ) : null}

      {drawer === "layers" ? (
        <LayersMenu
          layers={layers}
          toggle={toggle}
          extraData={extraData}
          extraOn={extraOn}
          extraSet={extraSet}
          navUnvisitedOn={navUnvisitedOn}
          setNavUnvisitedOn={setNavUnvisitedOn}
          waitMinM={waitMinM}
          setWaitMinM={setWaitMinM}
        />
      ) : null}

      {drawer === "targets" ? (
        <TargetsMenu
          waitMinM={waitMinM}
          nearest={nearest}
          go={go}
          worthStep={worthStep}
          setWorthStep={setWorthStep}
          worthM={worthM}
          worthCount={worthCount}
          skipVisited={skipVisited}
          setSkipVisited={setSkipVisited}
          nextTarget={nextTarget}
          skipped={skipped}
          targetBusy={targetBusy}
          target={target}
          copied={copied}
          skipTarget={skipTarget}
          planOn={planOn}
          setPlanOn={setPlanOn}
          openPlan={openPlan}
          planSize={planSize}
          setPlanSize={setPlanSize}
          planLoop={planLoop}
          setPlanLoop={setPlanLoop}
          plan={plan}
          skipStop={skipStop}
          planCopied={planCopied}
          setPlanCopied={setPlanCopied}
          fitTo={(points) => engine.current?.fitTo(points, PLAN_MARGIN)}
        />
      ) : null}

      {/* Drawers load when first opened (galaxy3d/lazyDrawers.tsx); one at a time is open. */}
      <Suspense fallback={<DrawerLoading />}>
      {drawer === "expedition" ? (
        <ExpeditionDrawer
          ship={route?.position ?? null}
          selected={selection ? { x: selection.x, y: selection.y, z: selection.z } : null}
          field={expField}
          setField={setExpField}
          planKeys={expPlanKeys}
          setPlanKeys={setExpPlanKeys}
          plan={expPlan}
          setPlan={setExpPlan}
          onFocus={(b) =>
            go(b.center, Math.max(300, b.cubeLy * 6), {
              kind: "marker",
              layer: "expedition",
              id: b.key,
              ...b.center,
            })
          }
        />
      ) : null}

      {drawer === "stations" ? (
        <aside
          className="g3d-drawer g3d-menu g3d-plan g3d-stations-drawer"
          aria-label={CARRIERS_STATIONS_TITLE}
          data-testid="g3d-stations"
        >
          <MenuHead title={CARRIERS_STATIONS_TITLE} help={G3D_HELP.stations} />
          <div className="g3d-menu__section g3d-menu__section--first">
            <CarriersStationsTabs tab={csTab} setTab={setCsTab} />
            <CarriersStationsBody
              tab={csTab}
              compact
              from={csFrom}
              onPick={(p: CarriersStationsPick) => {
                const at = p.at;
                csOwnPick.current = `${at.x.toFixed(1)},${at.y.toFixed(1)},${at.z.toFixed(1)}`;
                if (p.kind === "carrier") extraSet.carriers(true);
                if (p.kind === "station") extraSet.stations(true);
                engine.current?.flyTo(at, 400);
                if (p.kind === "station" && p.stationSys != null)
                  engine.current?.select({ kind: "marker", layer: "x-stations", id: String(p.stationSys), ...at });
              }}
            />
          </div>
        </aside>
      ) : null}

      {drawer === "jumponium" ? (
        <JumponiumDrawer
          onRows={setJumpRows}
          shipKey={
            route?.position
              ? `${Math.round(route.position.x)},${Math.round(route.position.y)},${Math.round(route.position.z)}`
              : ""
          }
          onPick={(r) => {
            setJumpPicked(r);
            const at = { x: r.x, y: r.y, z: r.z };
            engine.current?.flyTo(at, 300);
            engine.current?.select({ kind: "marker", layer: "jumponium", id: r.id, ...at });
          }}
        />
      ) : null}

      {drawer === "finder" ? (
        <FinderDrawer
          picked={finderAround}
          onHits={onFinderHits}
          onPick={(h) => {
            setFinderPicked(h);
            const at = { x: h.x, y: h.y, z: h.z };
            engine.current?.flyTo(at, 250);
            engine.current?.select({ kind: "marker", layer: "finder", id: h.id64, ...at });
          }}
        />
      ) : null}

      {drawer === "neutron" ? (
        <NeutronDrawer
          onRoute={setNeutronLine}
          onFocus={(p) => engine.current?.flyTo({ x: p.x, y: p.y, z: p.z }, 400)}
        />
      ) : null}

      {drawer === "navroute" ? (
        <aside className="g3d-drawer g3d-drawer--filter" aria-label="NavRoute" data-testid="g3d-navroute">
          <MenuHead title="NavRoute" help={G3D_HELP.navroute} />
          <GalaxyNavRoutePanel
            next={route?.navRoute ?? []}
            readRoute={readRoute}
            onShown={setNavShown}
            onFly={(s) => engine.current?.flyTo({ x: s.pos[0], y: s.pos[1], z: s.pos[2] }, 250)}
          />
        </aside>
      ) : null}

      {drawer === "filter" ? (
        <aside className="g3d-drawer g3d-drawer--filter" aria-label="Filter" data-testid="g3d-filter">
          <MenuHead title="Filter" help={G3D_HELP.filter} />
          <GalaxyFilterPanel value={filter} onChange={setFilter} matched={filterMatched} busy={filterBusy} />
        </aside>
      ) : null}

      {drawer === "search" ? (
        <aside className="g3d-drawer g3d-drawer--search" aria-label="Search" data-testid="g3d-search">
          <MenuHead title="Species search" help={G3D_HELP.search} />
          <GalaxySearchPanel variant="menu" onApply={onApply} commanderRegionId={commanderRegionId} />
          {search ? (
            <p className="g3d-panel__note">
              {search.label}: {search.matchedSystems.toLocaleString()} systems in{" "}
              {search.spreadCells.toLocaleString()} sectors; the map shows one per sector (
              {search.hits.length.toLocaleString()}).
            </p>
          ) : null}
        </aside>
      ) : null}

      {codexOn ? (
        <CodexMenu
          engine={engine}
          route={route}
          codexKind={codexKind}
          setCodexKind={setCodexKind}
          codexRegion={codexRegion}
          setCodexRegion={setCodexRegion}
          codexRegions={codexRegions}
          codexSummary={codexSummary}
          codexSystems={codexSystems}
        />
      ) : null}
      </Suspense>

      <header className="g3d-bar" ref={barRef}>
        <nav className="g3d-tabs" aria-label="Galaxy map menus">
          {G3D_TABS.map((t) => {
            const on = drawer === t.key;
            const label = t.key === "filter" && filterTicks ? `Filter (${filterTicks})` : t.label;
            return (
              <Tooltip key={t.key} text={t.hint}>
                <button
                  type="button"
                  className={on ? "g3d-tab g3d-tab--on" : "g3d-tab"}
                  aria-pressed={on}
                  aria-label={label}
                  onClick={() => openDrawer(t.key)}
                >
                  <G3dIcon name={t.key} />
                  {t.key === "filter" && filterTicks ? (
                    <span className="g3d-tab__badge">{filterTicks}</span>
                  ) : null}
                </button>
              </Tooltip>
            );
          })}
        </nav>
        <div className="g3d-find g3d-find--centre">
          <input
            type="search"
            className="g3d-find__input"
            placeholder="Find a system, sector or region"
            aria-label="Find"
            value={findText}
            onChange={(ev) => {
              setFindText(ev.target.value);
              setFindOpen(true);
            }}
            onFocus={() => setFindOpen(true)}
            onKeyDown={(ev) => ev.key === "Escape" && setFindOpen(false)}
          />
          {hasFind ? (
            <ul className="g3d-find__list" role="listbox" data-testid="g3d-find">
              {findRegions.map((a) => (
                <li key={`r${a.index}`}>
                  <button type="button" onClick={() => go({ x: a.x, y: 0, z: a.z }, 40_000)}>
                    <span>{a.name}</span>
                    <em>region</em>
                  </button>
                </li>
              ))}
              {find?.sectors.map((s) => (
                <li key={`s${s.name}`}>
                  <button type="button" onClick={() => go(s, 12_000)}>
                    <span>{s.name}</span>
                    <em>sector · {formatCount(s.systems)}</em>
                  </button>
                </li>
              ))}
              {find?.systems.map((s) => (
                <li key={`y${s.addr ?? s.ordinal}`}>
                  <button
                    type="button"
                    onClick={() =>
                      go(
                        s,
                        400,
                        s.mine
                          ? { kind: "marker", layer: "you", id: s.addr!, x: s.x, y: s.y, z: s.z }
                          : { kind: "index", ordinal: s.ordinal!, x: s.x, y: s.y, z: s.z },
                      )
                    }
                  >
                    <span>{s.name}</span>
                    <em>{s.mine ? "yours" : "system"}</em>
                  </button>
                </li>
              ))}
              {find?.stations?.map((h) => (
                <li key={`st${h.layerId}-${h.label}`}>
                  <button
                    type="button"
                    onClick={() => {
                      extraSet.stations(true);
                      go(h, 400, {
                        kind: "marker",
                        layer: "x-stations",
                        id: String(h.layerId),
                        x: h.x,
                        y: h.y,
                        z: h.z,
                      });
                    }}
                  >
                    <span className={h.own ? "stations-own" : undefined}>{h.label}</span>
                    <em>
                      {h.own ? "your station" : "station"}
                      {h.pad ? ` · ${h.pad} pad` : ""}
                      {h.label === h.name ? ` · ${h.system}` : ""}
                    </em>
                  </button>
                </li>
              ))}
              {findLayerHits.map((h) => (
                <li key={`l${h.kind}${h.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      extraSet[h.kind](true);
                      go(h, 400, { kind: "marker", layer: `x-${h.kind}`, id: h.id, x: h.x, y: h.y, z: h.z });
                    }}
                  >
                    <span>{h.label}</span>
                    <em>{h.what}</em>
                  </button>
                </li>
              ))}
              {spanshShown.map((h) => (
                <li key={`s${h.systemAddress}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setSpanshPicked((m) => new Map(m).set(String(h.systemAddress), h));
                      go({ x: h.x!, y: h.y!, z: h.z! }, 400, {
                        kind: "marker",
                        layer: "spansh",
                        id: String(h.systemAddress),
                        x: h.x!,
                        y: h.y!,
                        z: h.z!,
                      });
                    }}
                  >
                    <span>{h.starSystem}</span>
                    <em>Spansh</em>
                  </button>
                </li>
              ))}
              {spanshFind.busy ? <li className="g3d-find__more">Asking Spansh…</li> : null}
              {find?.partial ? <li className="g3d-find__more">Type more of the name for the rest</li> : null}
            </ul>
          ) : null}
        </div>
        <span className="g3d-title">Galaxy map</span>
      </header>

      {/* Builds leave the index out: the map offers it (plan 4.2, 2026-10-04). */}
      {stats?.phase === "failed" ? <GalaxyIndexDownload /> : null}

      <StatusBar
        graphics={graphics}
        stats={stats}
        legendOn={legendOn}
        setLegendOn={setLegendOn}
        codexOn={codexOn}
        colour={colour}
        layers={layers}
        mine={mine}
        gggOn={gggOn}
        heliumOn={heliumOn}
        search={search}
        elite={elite}
      />
    </div>
  );
}
