/**
 * One species card in the Encyclopedia (moved out of EncyclopediaModal.tsx, audit 2026-10-22).
 */
import type { EncyclopediaSpeciesRowDTO, SpeciesEntry } from "@shared/types";
import type { RegionalRarity } from "@shared/speciesRarity";
import { fmtCrExact, fmtCrTick } from "@shared/format";
import { LazyMount } from "../ui/LazyMount";
import { Tooltip } from "../ui/Tooltip";
import { photoCreditTitle } from "../photoCredit";
import { RarityGem } from "../RarityGem";
import { ExomasteryPlanetsBody } from "../EncyclopediaPanels";
import {
  GuideBandsBlock,
  GuideColoursBlock,
  GuideMeasuredBlock,
  GuideWithinBlock,
  type GuideBody,
} from "../FieldGuide";
import { EncyclopediaSpeciesConditions, type CardVerdicts } from "./conditions";
import type { GuideMaps } from "./data";
import { EncyclopediaThumb, RegionMark } from "./EncyclopediaThumb";
import type { EncyclopediaSpawnCompare } from "./types";
import type { useInlineExomastery } from "./useInlineExomastery";

/** Field-guide cards drawn on the first render; the rest follow right after paint. */
const FIRST_CHARTS = 12;

/** What a card reads from the modal, all of it state the modal keeps across cards. */
export interface SpeciesRowContext {
  footHitCounts: Map<string, number>;
  inlineExo: ReturnType<typeof useInlineExomastery>["inlineExo"];
  exoClosing: boolean;
  exoDrawerReveal: boolean;
  guide: GuideMaps | null;
  allCharts: boolean;
  displayOrder: Map<string, number>;
  regionInfo: { region: string; species: Record<string, RegionalRarity | null> } | null;
  spawnCompare: EncyclopediaSpawnCompare | null;
  cardVerdicts: CardVerdicts | null;
  guideBody: GuideBody | null;
  setPhotoZoom: (zoom: {
    urls: string[];
    note: string | null;
    creditByUrl?: EncyclopediaSpeciesRowDTO["photoCreditByUrl"];
  }) => void;
  setFoundFor: (entry: SpeciesEntry) => void;
  toggleInlineExomastery: (entry: SpeciesEntry) => void;
  refetchInlineExomastery: () => void;
}

/**
 * One species row. Extracted so the browse list (grouped by genus) and the search list (ranked,
 * flat) render exactly the same card instead of two copies drifting apart.
 */
export function EncyclopediaSpeciesRow({
  row,
  ctx,
}: {
  row: EncyclopediaSpeciesRowDTO;
  ctx: SpeciesRowContext;
}) {
  const {
    entry,
    priceCredits,
    photoUrl,
    photoUrls,
    photoNote,
    photoCreditByUrl,
    exomasteryFeederBodyCount = 0,
    exomasteryProfileFilePresent = false,
    exomasteryEncyclopediaAvailable = false,
    exomasteryDataInsufficient = false,
  } = row;
  const {
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
  } = ctx;
  const exoEnabled = exomasteryEncyclopediaAvailable;
  const foundN = footHitCounts.get(entry.id) ?? 0;
  const exoExpanded = inlineExo?.speciesEntryId === entry.id && !exoClosing;
  const hasExoDrawer = inlineExo?.speciesEntryId === entry.id;
  const g = guide?.species.get(entry.id);
  // Before the second pass only the first cards exist (see allCharts).
  if (!allCharts && (displayOrder.get(entry.id) ?? 0) >= FIRST_CHARTS) return null;
  // Built when it comes near the screen (plan 3.4, 2026-10-04); a placeholder of a card's height until then.
  return (
    <LazyMount
      key={entry.id}
      minHeight={560}
      rootSelector=".encyclopedia-scroll"
      className="encyclopedia-species-card encyclopedia-species-card--waiting fg-card"
    >
      <article className="encyclopedia-species-card fg-card">
        {exoEnabled && exomasteryDataInsufficient ? (
          <Tooltip
            className="ency-low-sample-anchor"
            text="Low sample — exomastery has only one recorded body for this species, so its habitat figures are indicative, not typical."
          >
            <span className="encyclopedia-exomastery-insufficient">
              <svg
                width="11"
                height="11"
                viewBox="0 0 16 16"
                aria-hidden
                focusable="false"
                className="ency-low-sample-icon"
              >
                <path
                  d="M8 1.8 15 14.2H1Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <path d="M8 6v3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="8" cy="11.7" r="0.85" fill="currentColor" />
              </svg>
              Low sample
            </span>
          </Tooltip>
        ) : null}
        {/*
        The field-guide card (owner, 2026-09-29, after the website's species page): the photo on
        top, then the description, the conditions checked against the body, where the species was
        actually found, and mode charts with the body marked on each.
      */}
        <button
          type="button"
          className="fg-photo"
          onClick={() =>
            setPhotoZoom({
              urls: photoUrls?.length ? photoUrls : [photoUrl],
              note: photoNote,
              creditByUrl: photoCreditByUrl,
            })
          }
          aria-label={`Enlarge photo for ${entry.displayName}`}
          // Credit on the hover here and in full once opened: the photographs are not this
          // project's to show unmarked.
          title={[
            photoCreditTitle(photoUrl, photoCreditByUrl?.[photoUrl]),
            "Click for the full-size photos",
          ]
            .filter(Boolean)
            .join(" — ")}
        >
          <EncyclopediaThumb
            photoUrl={photoUrl}
            displayName={entry.displayName}
            className="fg-photo-img"
            size="card"
          />
          {(photoUrls?.length ?? 0) > 1 ? (
            <span className="fg-photo-count">{photoUrls!.length} photos</span>
          ) : null}
        </button>
        <div className="encyclopedia-species-col">
          <header className="fg-head">
            <div className="fg-head-name">
              <h4 className="encyclopedia-species-title">
                <RarityGem rarity={entry.rarity} className="rarity-gem--ency" />
                {entry.displayName}
              </h4>
              <span className="encyclopedia-species-genus dim tiny">
                {entry.genus || entry.genusDataDir}
              </span>
              {regionInfo ? (
                <RegionMark region={regionInfo.region} r={regionInfo.species[entry.id] ?? null} />
              ) : null}
            </div>
            {priceCredits ? (
              <div className="fg-value">
                {/* CR in capitals, as everywhere else in the app (review V8). */}
                <strong title={`${fmtCrExact(priceCredits)}`}>{fmtCrTick(priceCredits)} CR</strong>
                <span title={`${fmtCrExact(priceCredits * 5)}`}>
                  {fmtCrTick(priceCredits * 5)} CR first footfall
                </span>
              </div>
            ) : null}
          </header>
          {photoNote ? <p className="encyclopedia-photo-note dim tiny">{photoNote}</p> : null}
          {entry.description ? <p className="encyclopedia-desc">{entry.description}</p> : null}
          {g?.sampleDistanceM ? (
            <span className="fg-chip">Clonal range {g.sampleDistanceM.toLocaleString("en-US")} m</span>
          ) : null}
          <div className="encyclopedia-criteria">
            <span className="fg-h">
              Conditions{spawnCompare ? ` · vs ${spawnCompare.bodyTabLabel ?? "this body"}` : ""}
            </span>
            <EncyclopediaSpeciesConditions
              entry={entry}
              spawnCompare={spawnCompare}
              verdicts={cardVerdicts?.[entry.id] ?? null}
            />
          </div>
          {g?.bands ? <GuideBandsBlock b={g.bands} body={guideBody} /> : null}
          {g?.bands ? <GuideWithinBlock b={g.bands} name={entry.displayName} body={guideBody} /> : null}
          {g?.measured ? (
            <GuideMeasuredBlock m={g.measured} body={guideBody} bands={g.bands} />
          ) : guide && !g?.bands ? (
            <p className="fg-none">
              Not measured yet: the corpus has not confirmed this species on enough bodies to chart. The
              conditions above are what the app predicts from.
            </p>
          ) : null}
          <GuideColoursBlock c={g?.colours ?? null} />
          <div className="encyclopedia-species-actions">
            <button
              type="button"
              className="btn-ency-found"
              title="Show matching rows from your foot catalog for this species"
              onClick={() => setFoundFor(entry)}
            >
              Found ({foundN})
            </button>
            {exoEnabled ? (
              <button
                type="button"
                className="btn-ency-exomastery"
                title={
                  exoExpanded
                    ? "Hide exomastery data for this species"
                    : exomasteryProfileFilePresent
                      ? "Show Exomastery profile (mode vs mean) from feeder JSON"
                      : "Show EDSM / per-body exomastery rows for this species"
                }
                onClick={() => toggleInlineExomastery(entry)}
              >
                {exoExpanded
                  ? `Hide exomastery (${exomasteryFeederBodyCount})`
                  : `Exomastery (${exomasteryFeederBodyCount})`}
              </button>
            ) : null}
          </div>
        </div>
        {hasExoDrawer ? (
          <div
            data-exo-drawer={entry.id}
            className={`encyclopedia-exomastery-drawer ${exoDrawerReveal && !exoClosing ? "encyclopedia-exomastery-drawer--open" : ""}`}
          >
            <div className="encyclopedia-exomastery-drawer-inner">
              <div className="encyclopedia-exomastery-inline-head">
                <div className="encyclopedia-exomastery-inline-head-text">
                  <strong className="encyclopedia-exomastery-inline-title">
                    {inlineExo?.data?.source === "profile"
                      ? "Exomastery profile"
                      : "Exomastery sample bodies"}
                  </strong>
                  {inlineExo?.data ? (
                    <span className="dim tiny encyclopedia-exomastery-inline-sub">
                      {inlineExo.data.source === "profile"
                        ? inlineExo.data.sampleCount > 0
                          ? `n ≤ ${inlineExo.data.sampleCount} (feeder counts)`
                          : "feeder rollups"
                        : `n = ${inlineExo.data.sampleCount}`}
                    </span>
                  ) : null}
                </div>
                {inlineExo?.speciesEntryId === entry.id && !exoClosing ? (
                  <button
                    type="button"
                    className="encyclopedia-exomastery-refetch"
                    disabled={!!inlineExo.loading}
                    title="Clear cached feeder JSON for this species and reload from disk."
                    onClick={() => refetchInlineExomastery()}
                  >
                    Force re-fetch
                  </button>
                ) : null}
              </div>
              {inlineExo?.loading ? <p className="dim">Loading planetary data…</p> : null}
              {inlineExo?.err ? <p className="warn">{inlineExo.err}</p> : null}
              {inlineExo?.data && !inlineExo.loading ? (
                <ExomasteryPlanetsBody data={inlineExo.data} />
              ) : null}
            </div>
          </div>
        ) : null}
      </article>
    </LazyMount>
  );
}
