import { isBool, isStr, usePersistedState } from "./usePersistedState";
import { withTransition } from "./motion";
import type { EncyclopediaSpeciesRowDTO, FootScannedEntry, SpeciesEntry } from "@shared/types";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PhotoGallery } from "./PhotoGallery";
import { ModalHead } from "./ui/ModalHead";
import { useModal } from "./ui/useModal";
import { SkeletonRows } from "./ui/Skeleton";
import {
  buildEncyclopediaFacetOptions,
  activeEncyclopediaFilterChips,
  clearEncyclopediaFilter,
  defaultEncyclopediaFilters,
  isEncyclopediaFilters,
  ENC_FILTERS_ALL,
  rankEncyclopediaRows,
  type EncyclopediaFiltersState,
} from "./encyclopediaFilters";
import { EDEXO_ENCY_NOT_FOUND_LS, readLsBool, writeLsBool } from "./lsPrefs";
import type { RegionalRarity } from "@shared/speciesRarity";
import { EncyclopediaFilterBar } from "./EncyclopediaFilterBar";
import { FoundSpeciesPopup } from "./EncyclopediaPanels";
import { GuideGenusIntro, guideBodyFrom } from "./FieldGuide";
import { guideCache, loadGuide, loadRows, rowsCache, type GuideMaps } from "./encyclopedia/data";
import type { EncyclopediaSpawnCompare } from "./encyclopedia/types";
import { useCardVerdicts } from "./encyclopedia/conditions";
import { footHitsForEntry, normFoot } from "./encyclopedia/footHits";
import { useInlineExomastery } from "./encyclopedia/useInlineExomastery";
import { EncyclopediaSpeciesRow, type SpeciesRowContext } from "./encyclopedia/EncyclopediaSpeciesRow";

/*
  The data caches, the condition rows, the catalogue matching, the photograph, the inline exomastery
  drawer and the species card live in encyclopedia/ since the audit of 2026-10-22. The spawn-compare
  type is re-exported for App and HeaderBar, which import it from here.
*/
export type { EncyclopediaSpawnCompare } from "./encyclopedia/types";

export function EncyclopediaModal({
  footScannedEntries,
  spawnCompare,
  currentRegion = null,
  onClose,
}: {
  footScannedEntries: FootScannedEntry[];
  spawnCompare: EncyclopediaSpawnCompare | null;
  /** The commander's region: each card says whether the species grows there, and a toggle keeps those. */
  currentRegion?: string | null;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<EncyclopediaSpeciesRowDTO[] | null>(rowsCache);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  // Remembered between opens, all but the search text (usePersistedState).
  const [filters, setFilters] = usePersistedState<EncyclopediaFiltersState>(
    "encyclopedia.filters",
    () => defaultEncyclopediaFilters(ENC_FILTERS_ALL),
    isEncyclopediaFilters,
    (f) => ({ ...f, search: "" }),
  );
  const [foundFor, setFoundFor] = useState<SpeciesEntry | null>(null);
  const [photoZoom, setPhotoZoom] = useState<{
    urls: string[];
    note: string | null;
    creditByUrl?: EncyclopediaSpeciesRowDTO["photoCreditByUrl"];
  } | null>(null);
  const {
    inlineExo,
    exoClosing,
    exoDrawerReveal,
    scheduleCloseExo,
    toggleInlineExomastery,
    refetchInlineExomastery,
  } = useInlineExomastery(rows, spawnCompare);

  /* The field guide (published conditions + measured charts), by species id and genus folder. */
  const [guide, setGuide] = useState<GuideMaps | null>(guideCache);
  useEffect(() => {
    void loadGuide()
      .then((g) => {
        if (g) setGuide(g);
      })
      .catch(() => {
        /* the cards still show everything else */
      });
  }, []);
  const cardVerdicts = useCardVerdicts(spawnCompare);
  const guideBody = useMemo(
    () =>
      spawnCompare
        ? guideBodyFrom(
            spawnCompare.scan,
            spawnCompare.estimatedSurfaceTempK,
            spawnCompare.speciesMatchContext,
            spawnCompare.bodyTabLabel ?? "this body",
          )
        : null,
    [spawnCompare],
  );

  useEffect(() => {
    void loadRows()
      .then(setRows)
      .catch((e) => {
        // A list already on screen stays; only a first load that fails says so.
        if (!rowsCache) setLoadErr(e instanceof Error ? e.message : String(e));
      });
  }, []);

  /**
   * Escape peels one layer at a time; useModal adds the focus trap, focus restore and scroll lock
   * that the hand-rolled listener never had.
   */
  const closeTopLayer = useCallback(() => {
    if (photoZoom) setPhotoZoom(null);
    else if (inlineExo && !exoClosing) scheduleCloseExo();
    else if (foundFor) setFoundFor(null);
    else onClose();
  }, [onClose, foundFor, photoZoom, inlineExo, exoClosing, scheduleCloseExo]);

  const dialogRef = useModal<HTMLDivElement>(true, closeTopLayer);

  const facets = useMemo(() => (rows?.length ? buildEncyclopediaFacetOptions(rows) : null), [rows]);

  /**
   * Foot-catalog hit count per species, computed once per (rows, catalog) instead of scanning the
   * whole catalog for every row on every render — that was O(rows x catalog) over a 231 KB file.
   */
  const normCatalog = useMemo(() => normFoot(footScannedEntries), [footScannedEntries]);
  const footHitCounts = useMemo(() => {
    const m = new Map<string, number>();
    if (!rows?.length) return m;
    for (const r of rows) m.set(r.entry.id, footHitsForEntry(r.entry, normCatalog).length);
    return m;
  }, [rows, normCatalog]);

  const genusLabels = useMemo(() => {
    if (!rows?.length) return [];
    const set = new Set<string>();
    for (const r of rows) {
      set.add(r.entry.genus?.trim() || r.entry.genusDataDir);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [rows]);

  /*
    "Not found yet": species with no find in your foot catalog (guild tester report, 2026-09-30: "what
    you've found vs what is still out there"). Per colour variant, that list is Achievements' "Still to
    find". Remembered between opens.
  */
  const [notFoundOnly, setNotFoundOnlyState] = useState(() => readLsBool(EDEXO_ENCY_NOT_FOUND_LS, false));
  const setNotFoundOnly = (v: boolean) => {
    setNotFoundOnlyState(v);
    writeLsBool(EDEXO_ENCY_NOT_FOUND_LS, v);
  };
  /*
    The current region (guild tester report, 2026-09-30: "default to or at least highlight the current
    region"): every species' standing there, a mark on each card, and a toggle that keeps the ones
    recorded there. Remembered like the other filters.
  */
  const [regionInfo, setRegionInfo] = useState<{
    region: string;
    species: Record<string, RegionalRarity | null>;
  } | null>(null);
  useEffect(() => {
    if (!currentRegion) {
      setRegionInfo(null);
      return;
    }
    let live = true;
    void fetch(`/api/encyclopedia-region?name=${encodeURIComponent(currentRegion)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { region: string; species: Record<string, RegionalRarity | null> } | null) => {
        if (live && j?.species) setRegionInfo(j);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [currentRegion]);
  const [inRegionOnly, setInRegionOnly] = usePersistedState("encyclopedia.inRegion", false, isBool);
  const inRegion = useCallback((id: string) => regionInfo?.species[id]?.found === true, [regionInfo]);

  /* Colour variants, from the field guide's colour tables (the species' own, else its genus'). */
  const [colour, setColour] = usePersistedState("encyclopedia.colour", "", isStr);
  const coloursOf = useCallback(
    (entry: SpeciesEntry): string[] => {
      const table =
        guide?.species.get(entry.id)?.colours ?? guide?.genera.get(entry.genusDataDir)?.colours ?? null;
      return table ? table.map.map(([, name]) => name.trim()) : [];
    },
    [guide],
  );
  const colourOptions = useMemo(() => {
    const all = new Set<string>();
    for (const r of rows ?? []) for (const c of coloursOf(r.entry)) all.add(c);
    return [...all].sort((a, b) => a.localeCompare(b));
  }, [rows, coloursOf]);

  const { rows: filtered, searching } = useMemo(() => {
    const ranked = rows ? rankEncyclopediaRows(rows, filters) : { rows: [], searching: false };
    const keep = (r: EncyclopediaSpeciesRowDTO) =>
      (!notFoundOnly || (footHitCounts.get(r.entry.id) ?? 0) === 0) &&
      (!inRegionOnly || !regionInfo || inRegion(r.entry.id)) &&
      (!colour || coloursOf(r.entry).includes(colour));
    return notFoundOnly || (inRegionOnly && regionInfo) || colour
      ? { ...ranked, rows: ranked.rows.filter(keep) }
      : ranked;
  }, [rows, filters, notFoundOnly, footHitCounts, inRegionOnly, regionInfo, inRegion, colour, coloursOf]);
  const notFoundCount = useMemo(
    () => (rows ?? []).filter((r) => (footHitCounts.get(r.entry.id) ?? 0) === 0).length,
    [rows, footHitCounts],
  );

  /** Genus is how players think about exobiology, and it makes 108 rows navigable without
   *  virtualisation: ~25 headers instead of one undifferentiated column. */
  const genusSections = useMemo(() => {
    const byGenus = new Map<string, EncyclopediaSpeciesRowDTO[]>();
    const dirOf = new Map<string, string>();
    for (const r of filtered) {
      dirOf.set(r.entry.genus?.trim() || r.entry.genusDataDir, r.entry.genusDataDir);
      const g = r.entry.genus?.trim() || r.entry.genusDataDir;
      const arr = byGenus.get(g);
      if (arr) arr.push(r);
      else byGenus.set(g, [r]);
    }
    return [...byGenus.entries()]
      .map(([genus, rs]) => ({ genus, dir: dirOf.get(genus) ?? genus, rows: rs }))
      .sort((x, y) => x.genus.localeCompare(y.genus, undefined, { sensitivity: "base" }));
  }, [filtered]);

  const chips = useMemo(() => activeEncyclopediaFilterChips(filters), [filters]);

  /*
    Two passes (UI review, 2026-09-30): all 118 field-guide cards are ~22,000 page elements, which
    doubled the Encyclopedia's open time. The first pass draws the first cards only, so the panel
    shows at once; the second draws the rest right after it has painted. (A dozen per frame was
    tried: every step re-rendered the whole list and cost more in total.)
  */
  const displayOrder = useMemo(() => {
    const ids = searching
      ? filtered.map((r) => r.entry.id)
      : genusSections.flatMap((s) => s.rows.map((r) => r.entry.id));
    return new Map(ids.map((id, i) => [id, i]));
  }, [searching, filtered, genusSections]);
  const [allCharts, setAllCharts] = useState(false);
  useEffect(() => {
    if (!rows || allCharts) return;
    let t = 0;
    const id = requestAnimationFrame(() => {
      t = window.setTimeout(() => setAllCharts(true), 0);
    });
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(t);
    };
  }, [rows, allCharts]);

  const [railOpen, setRailOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Opening the encyclopedia is nearly always "find this species", so the caret starts there.
  useEffect(() => {
    if (!rows) return;
    const id = window.setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 40);
    return () => window.clearTimeout(id);
  }, [rows]);

  // Every card reads the same state (see encyclopedia/EncyclopediaSpeciesRow.tsx).
  const rowCtx: SpeciesRowContext = {
    footHitCounts,
    inlineExo,
    exoClosing,
    exoDrawerReveal,
    guide,
    allCharts,
    displayOrder,
    regionInfo,
    spawnCompare,
    cardVerdicts,
    guideBody,
    setPhotoZoom,
    setFoundFor,
    toggleInlineExomastery,
    refetchInlineExomastery,
  };

  return (
    <div className="modal-backdrop encyclopedia-backdrop" role="presentation" onClick={() => withTransition(onClose)}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="modal-panel encyclopedia-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="encyclopedia-title"
        onClick={(ev) => ev.stopPropagation()}
      >
        <ModalHead
          title="Encyclopedia"
          titleId="encyclopedia-title"
          onClose={onClose}
          closeTitle="Close encyclopedia"
          helpTitle="What the Encyclopedia shows"
          help={<EncyclopediaHelp />}
        />
        <div className="modal-body encyclopedia-body">
          <div className="ency-layout">
            <aside
              id="ency-rail"
              className={`ency-rail${railOpen ? " ency-rail--open" : ""}`}
              aria-label="Filters"
            >
              {facets && rows ? (
                <EncyclopediaFilterBar
                  filters={filters}
                  onFiltersChange={setFilters}
                  facets={facets}
                  genusLabels={genusLabels}
                  bodyPlanetClass={spawnCompare?.scan?.PlanetClass?.trim() || null}
                />
              ) : null}
            </aside>
            <div className="ency-main">
              <div className="ency-toolbar">
                <button
                  type="button"
                  className={`ency-rail-toggle${railOpen ? " ency-rail-toggle--on" : ""}`}
                  aria-expanded={railOpen}
                  aria-controls="ency-rail"
                  onClick={() => setRailOpen((v) => !v)}
                >
                  Filters{chips.length ? ` (${chips.length})` : ""}
                </button>
                <input
                  ref={searchRef}
                  type="search"
                  className="ency-search"
                  placeholder="Search species or genus…"
                  aria-label="Search species or genus"
                  autoComplete="off"
                  spellCheck={false}
                  value={filters.search}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                />
                <span className="ency-count">
                  <strong>{filtered.length}</strong>
                  {rows ? <> of {rows.length}</> : null} species
                </span>
                <button
                  type="button"
                  className={`btn-top-toggle ency-notfound-toggle${notFoundOnly ? " btn-top-toggle--on" : ""}`}
                  onClick={() => setNotFoundOnly(!notFoundOnly)}
                  title="Only species you have not found yet (no Log, Sample or Analyse in your journals). Per colour variant: Achievements → Still to find."
                >
                  {notFoundOnly ? `Not found yet ✓ (${notFoundCount})` : "Not found yet ✗"}
                </button>
                {regionInfo ? (
                  <button
                    type="button"
                    className={`btn-top-toggle ency-region-toggle${inRegionOnly ? " btn-top-toggle--on" : ""}`}
                    onClick={() => setInRegionOnly(!inRegionOnly)}
                    title={`Only species recorded in ${regionInfo.region}, where you are now.`}
                  >
                    {inRegionOnly ? `In ${regionInfo.region} ✓` : `In ${regionInfo.region} ✗`}
                  </button>
                ) : null}
                {colourOptions.length ? (
                  <label className="ency-colour-pick" title="Only species that come in this colour">
                    <span className="dim tiny">Colour</span>
                    <select
                      value={colourOptions.includes(colour) ? colour : ""}
                      onChange={(e) => setColour(e.target.value)}
                    >
                      <option value="">any</option>
                      {colourOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {chips.length ? (
                  <>
                    <span className="ency-chips">
                      {chips.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          className="ency-chip"
                          title={`Remove the ${c.label.toLowerCase()} filter`}
                          onClick={() => setFilters((f) => clearEncyclopediaFilter(f, c.key))}
                        >
                          <span className="ency-chip-label">{c.label}:</span>{" "}
                          <span className="ency-chip-value">{c.value}</span>
                          <span className="ency-chip-x" aria-hidden>
                            ×
                          </span>
                        </button>
                      ))}
                    </span>
                    <button
                      type="button"
                      className="ency-clear-all"
                      onClick={() => setFilters(defaultEncyclopediaFilters(ENC_FILTERS_ALL))}
                    >
                      Clear all
                    </button>
                  </>
                ) : null}
              </div>
              {spawnCompare ? (
                <p className="encyclopedia-spawn-compare-line dim tiny">
                  Compared with <strong>{spawnCompare.bodyTabLabel ?? "the selected body"}</strong>
                  {spawnCompare.scan?.PlanetClass ? (
                    <>
                      {" "}
                      (<span className="ency-spawn-scan-class">{spawnCompare.scan.PlanetClass}</span>)
                    </>
                  ) : spawnCompare.scan ? (
                    <> (detailed scan incomplete)</>
                  ) : (
                    <> — no detailed scan of it yet</>
                  )}
                  . Conditions: <span className="fg-key fg-key--ok">blue</span> matches,{" "}
                  <span className="fg-key fg-key--warn">yellow</span> not known yet,{" "}
                  <span className="fg-key fg-key--bad">red</span> does not match. Charts: the bodies each
                  species was confirmed on, the <span className="fg-key fg-key--mode">orange</span> bar and
                  line the most common value, the <span className="fg-key fg-key--ok">blue</span> line this
                  body.
                </p>
              ) : (
                <p className="encyclopedia-spawn-compare-line dim tiny">
                  Charts: the bodies each species was confirmed on; the{" "}
                  <span className="fg-key fg-key--mode">orange</span> bar and line mark the most common value.
                  Open the Encyclopedia with a body selected to see how that body compares.
                </p>
              )}
              {loadErr ? <p className="warn">{loadErr}</p> : null}
              {!rows && !loadErr ? (
                <div className="encyclopedia-scroll">
                  <SkeletonRows rows={6} />
                </div>
              ) : null}
              {rows ? (
                <div className="encyclopedia-scroll">
                  {filtered.length === 0 ? (
                    <p className="encyclopedia-empty-filtered">
                      No species match these filters. Use <strong>Clear all</strong> or relax planet class,
                      atmosphere, or other criteria.
                    </p>
                  ) : searching ? (
                    <div className="fg-grid">
                      {filtered.map((r) => (
                        <EncyclopediaSpeciesRow key={r.entry.id} row={r} ctx={rowCtx} />
                      ))}
                    </div>
                  ) : (
                    genusSections.map((sec) => (
                      <section key={sec.genus} className="ency-genus-section">
                        <h4 className="ency-genus-head">
                          <span className="ency-genus-name">{sec.genus}</span>
                          <span className="ency-genus-count">{sec.rows.length}</span>
                        </h4>
                        <GuideGenusIntro g={guide?.genera.get(sec.dir)} />
                        <div className="fg-grid">
                          {sec.rows.map((r) => (
                            <EncyclopediaSpeciesRow key={r.entry.id} row={r} ctx={rowCtx} />
                          ))}
                        </div>
                      </section>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {photoZoom ? (
        <PhotoGallery
          urls={photoZoom.urls}
          note={photoZoom.note}
          creditByUrl={photoZoom.creditByUrl}
          onClose={() => setPhotoZoom(null)}
        />
      ) : null}
      {foundFor ? (
        <FoundSpeciesPopup
          entry={foundFor}
          hits={footHitsForEntry(foundFor, normCatalog)}
          onClose={() => setFoundFor(null)}
        />
      ) : null}
    </div>
  );
}

/** Behind the "?" beside the × (owner, 2026-10-23). */
function EncyclopediaHelp() {
  return (
    <>
      <p>
        Every species in the app's own species data, grouped by genus: the conditions it grows in, its value
        (and five times that on a first footfall), its colours and, where there are enough, charts of the bodies it has been confirmed on.
      </p>
      <p>
        Opened with a body selected, each species is compared with that body: blue conditions match, yellow ones
        are not known yet, red ones do not match. <strong>Found</strong> lists your own finds of the species from
        your journals; <strong>Exomastery</strong>, where shown, opens the per-body exomastery data held for it.
      </p>
      <p>
        Search by species or genus, narrow the list with <strong>Filters</strong>, or show only species you
        have not found yet, species recorded in your current region, or one colour. Each active filter shows as a
        chip: click it to remove it, or use <strong>Clear all</strong>.
      </p>
    </>
  );
}
