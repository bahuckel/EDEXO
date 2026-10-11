/**
 * The expedition planner on the galaxy map (plan 2.5, 2026-10-11): where to go for first footfalls in space
 * nobody has recorded. The drawer asks `/api/expedition/field` for the boxels around the ship (or the
 * selected point), lists the best by credits per jump (or a species' bodies per jump), and builds a plan
 * from `/api/expedition/plan`; the map draws the boxels as a marker layer coloured by rank and the plan as a
 * line. A selected boxel's card lists the system names nobody has recorded (`/api/expedition/boxel`).
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type {
  ExpeditionBoxelDTO,
  ExpeditionCandidatesDTO,
  ExpeditionFieldDTO,
  ExpeditionPlanDTO,
} from "@shared/dto/expedition";
import { fmtLy } from "@shared/format";
import { formatValue } from "./galaxy3d/clusters";
import { G3D_HELP, MenuHead, MenuRow } from "./galaxy3d/G3dMenu";
import { CopySystemButton } from "./CopySystemButton";

type Xyz = { x: number; y: number; z: number };

/**
 * Open the map on a boxel from elsewhere (the header's "Next boxel", plan 2.7): kept until the map takes it,
 * since the map may not be mounted yet, and announced for a map that already is.
 */
export const EXPEDITION_FOCUS_EVENT = "edexo:expedition-focus";
let pendingFocus: { key: string; center: Xyz; cubeLy: number } | null = null;
export function requestExpeditionFocus(b: Pick<ExpeditionBoxelDTO, "key" | "center" | "cubeLy">): void {
  pendingFocus = { key: b.key, center: b.center, cubeLy: b.cubeLy };
  window.dispatchEvent(new CustomEvent(EXPEDITION_FOCUS_EVENT));
}
export function takeExpeditionFocus(): { key: string; center: Xyz; cubeLy: number } | null {
  const f = pendingFocus;
  pendingFocus = null;
  return f;
}

const RADII = [250, 500, 1000, 2000, 3000];
const MIN_PER_JUMP = [0, 1, 3, 5, 10];
const LIST_ROWS = 12;
const CANDIDATES_SHOWN = 12;
/** The server lists at most this many names (expedition.ts `candidateSystems`). */
const CANDIDATE_CAP = 200;

/** Credits, short: 7.9 M, 1.2 B. */
export function crShort(v: number): string {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)} B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)} M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)} k`;
  return String(Math.round(v));
}

/** What a boxel is ranked by: credits per jump, or the species' bodies per jump in target-species mode. */
export function expeditionScore(b: ExpeditionBoxelDTO, species: boolean): number {
  return species ? (b.speciesBodies ?? 0) / Math.max(1, b.jumps) : b.evPerJump;
}

const LOW: [number, number, number] = [0.36, 0.27, 0.62];
const HIGH: [number, number, number] = [1, 0.78, 0.22];

/** Dim violet for the field's worst to amber for its best, by rank (the values span decades). */
export function expeditionColours(field: ExpeditionFieldDTO): Map<string, [number, number, number]> {
  const species = !!field.species;
  const ranked = [...field.boxels].sort((a, b) => expeditionScore(a, species) - expeditionScore(b, species));
  const out = new Map<string, [number, number, number]>();
  ranked.forEach((b, i) => {
    const t = ranked.length > 1 ? i / (ranked.length - 1) : 1;
    out.set(b.key, [LOW[0] + (HIGH[0] - LOW[0]) * t, LOW[1] + (HIGH[1] - LOW[1]) * t, LOW[2] + (HIGH[2] - LOW[2]) * t]);
  });
  return out;
}

/** Marker size by the systems a boxel holds: 5 px for a handful, 13 for thousands. */
export function expeditionSize(b: ExpeditionBoxelDTO): number {
  return Math.round(5 + Math.min(8, Math.log10(Math.max(1, b.systems)) * 2.4));
}

function boxelLine(b: ExpeditionBoxelDTO, species: boolean): string {
  const genera = b.topGenera.map((g) => g.genus).join(", ");
  return species
    ? `${(b.speciesBodies ?? 0).toFixed(2)} bodies expected · ${b.jumps} jumps`
    : `${crShort(b.evPerJump)} CR per jump · ${b.systems} systems${genera ? ` · ${genera}` : ""}`;
}

/** The hover card's lines for one boxel. */
export function expeditionTip(b: ExpeditionBoxelDTO, species: boolean): { title: string; line: string; note: string } {
  return {
    title: b.name ?? `${b.code} boxel (unnamed sector)`,
    line: `${fmtLy(b.distanceLy)} · ${boxelLine(b, species)}`,
    note: `${Math.round(b.pBio * 1000) / 10} % of systems with biology · ${b.recorded} recorded${b.visited ? ` · ${b.visited} yours` : ""} · click for its systems`,
  };
}

export function ExpeditionDrawer({
  ship,
  selected,
  field,
  setField,
  planKeys,
  setPlanKeys,
  plan,
  setPlan,
  onFocus,
}: {
  ship: Xyz | null;
  /** The map's selected point, when "from" is set to it. */
  selected: Xyz | null;
  field: ExpeditionFieldDTO | null;
  setField: (f: ExpeditionFieldDTO | null) => void;
  planKeys: string[];
  setPlanKeys: Dispatch<SetStateAction<string[]>>;
  plan: ExpeditionPlanDTO | null;
  setPlan: (p: ExpeditionPlanDTO | null) => void;
  onFocus: (b: ExpeditionBoxelDTO) => void;
}) {
  // 500 ly, as the header's "Next boxel" scores: c boxels count up to here, so its pick is in this list.
  const [radius, setRadius] = useState(500);
  const [fromSelected, setFromSelected] = useState(false);
  const [species, setSpecies] = useState("");
  const [minM, setMinM] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speciesList, setSpeciesList] = useState<{ id: string; name: string }[]>([]);
  const from = fromSelected && selected ? selected : ship;

  useEffect(() => {
    void fetch("/api/species-encyclopedia")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { species?: { entry: { id: string; displayName: string } }[] } | null) =>
        setSpeciesList(
          (j?.species ?? []).map((s) => ({ id: s.entry.id, name: s.entry.displayName })).sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .catch(() => undefined);
  }, []);

  // Scored again when an input changes; the server caches a field for ten minutes.
  const fromKey = from ? `${Math.round(from.x)},${Math.round(from.y)},${Math.round(from.z)}` : "";
  useEffect(() => {
    if (!from) return;
    const ac = new AbortController();
    setBusy(true);
    setError(null);
    const q = new URLSearchParams({
      x: String(from.x),
      y: String(from.y),
      z: String(from.z),
      radius: String(radius),
      limit: "500",
      ...(species ? { species } : {}),
    });
    void fetch(`/api/expedition/field?${q}`, { signal: ac.signal })
      .then(async (r) => {
        const j = (await r.json()) as ExpeditionFieldDTO & { error?: string };
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setField(j);
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setBusy(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromKey, radius, species]);

  useEffect(() => {
    if (!planKeys.length || !ship) {
      setPlan(null);
      return;
    }
    const ac = new AbortController();
    const q = new URLSearchParams({ stops: planKeys.join(";"), x: String(ship.x), y: String(ship.y), z: String(ship.z) });
    void fetch(`/api/expedition/plan?${q}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ExpeditionPlanDTO | null) => {
        if (!ac.signal.aborted) setPlan(j);
      })
      .catch(() => undefined);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKeys.join(";"), ship ? `${Math.round(ship.x)},${Math.round(ship.y)},${Math.round(ship.z)}` : ""]);

  const isSpecies = !!field?.species;
  const rows = useMemo(
    () => (field?.boxels ?? []).filter((b) => isSpecies || b.evPerJump >= minM * 1e6).slice(0, LIST_ROWS),
    [field, minM, isSpecies],
  );
  const toggle = (key: string) => setPlanKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key].slice(0, 20)));

  return (
    <aside className="g3d-drawer g3d-menu g3d-plan" aria-label="Expedition" data-testid="g3d-expedition">
      <MenuHead title="Expedition" help={G3D_HELP.expedition} />
      <div className="g3d-menu__section g3d-menu__section--first">
        <MenuRow label="From" hint="Score the boxels around your ship, or around the point selected on the map">
          <select
            className="g3d-select g3d-row__val"
            value={fromSelected ? "selected" : "ship"}
            onChange={(e) => setFromSelected(e.target.value === "selected")}
            aria-label="From"
          >
            <option value="ship">Your ship</option>
            <option value="selected" disabled={!selected}>
              Selected point
            </option>
          </select>
        </MenuRow>
        <MenuRow label="Radius" hint="How far out to score boxels (the smallest boxels drop out past their limit)">
          <select className="g3d-select g3d-row__val" value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Radius">
            {RADII.map((r) => (
              <option key={r} value={r}>
                {r.toLocaleString("en-US")} ly
              </option>
            ))}
          </select>
        </MenuRow>
        <MenuRow label="Species" hint="Light only the boxels where this species can grow, ranked by how many of its bodies they should hold">
          <select className="g3d-select g3d-row__val" value={species} onChange={(e) => setSpecies(e.target.value)} aria-label="Species">
            <option value="">Any (credits)</option>
            {speciesList.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </MenuRow>
        {!isSpecies ? (
          <MenuRow label="At least" hint="Hide boxels worth less than this per jump">
            <select className="g3d-select g3d-row__val" value={minM} onChange={(e) => setMinM(Number(e.target.value))} aria-label="At least per jump">
              {MIN_PER_JUMP.map((m) => (
                <option key={m} value={m}>
                  {m ? `${m} M CR / jump` : "Any"}
                </option>
              ))}
            </select>
          </MenuRow>
        ) : null}
      </div>
      <div className="g3d-menu__section">
        {!from ? (
          <p className="dim g3d-panel__note">No position yet: fly a jump, or select a point and score from it.</p>
        ) : busy ? (
          <p className="dim g3d-panel__note">Scoring the boxels…</p>
        ) : error ? (
          <p className="options-error">{error}</p>
        ) : field ? (
          <p className="dim g3d-panel__note" data-testid="g3d-expedition-status">
            {field.scored.toLocaleString("en-US")} boxels scored within {field.radiusLy.toLocaleString("en-US")} ly
            {field.skipped.length ? ` (${field.skipped.join(", ")} boxels left out: too many at this radius)` : ""} · jump range{" "}
            {Math.round(field.jumpRangeLy)} ly
          </p>
        ) : null}
        {field?.species ? (
          <p className="g3d-panel__note" data-testid="g3d-expedition-rule">
            {field.rule ? (
              <>
                Grows {field.rule.text}: {field.rule.boxelsPassing.toLocaleString("en-US")} of{" "}
                {field.rule.boxelsChecked.toLocaleString("en-US")} boxels here can meet it
                {field.rule.points.length ? ` · rings round the ${field.rule.points.length}${field.rule.truncated ? " nearest" : ""} it is measured from` : ""}
              </>
            ) : (
              "No position rule: every boxel can hold it, ranked by how often its genus and it are found there."
            )}
          </p>
        ) : null}
        <ol className="g3d-exp-list" data-testid="g3d-expedition-list">
          {rows.map((b) => (
            <li key={b.key} className="g3d-exp-row">
              <button type="button" className="g3d-exp-row__go" onClick={() => onFocus(b)} title="Show it on the map">
                <strong>{b.name ?? `${b.code} boxel`}</strong>
                <span>
                  {fmtLy(b.distanceLy)} · {boxelLine(b, isSpecies)}
                </span>
              </button>
              <button
                type="button"
                className="btn-top-toggle g3d-exp-row__plan"
                aria-pressed={planKeys.includes(b.key)}
                onClick={() => toggle(b.key)}
                title={planKeys.includes(b.key) ? "Take it out of the plan" : "Add it to the plan"}
              >
                {planKeys.includes(b.key) ? "−" : "+"}
              </button>
            </li>
          ))}
        </ol>
        {field && !rows.length && !busy ? <p className="dim g3d-panel__note">Nothing here meets that.</p> : null}
      </div>
      {plan?.stops.length ? (
        <div className="g3d-menu__section" data-testid="g3d-expedition-plan">
          <span className="g3d-menu__sub">
            Plan · {plan.stops.length} boxel{plan.stops.length === 1 ? "" : "s"} · {fmtLy(plan.totalLy)} · about {plan.totalJumps} jump
            {plan.totalJumps === 1 ? "" : "s"} to reach {plan.stops.length === 1 ? "it" : "them"}
          </span>
          <ol className="g3d-exp-plan">
            {plan.stops.map((s, i) => (
              <li key={s.key}>
                {i + 1}. {s.name ?? s.key}{" "}
                <span className="dim">
                  · {fmtLy(s.legLy)}, {s.legJumps} jump{s.legJumps === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ol>
          <button type="button" className="btn-top-toggle" onClick={() => setPlanKeys([])}>
            Clear plan
          </button>
        </div>
      ) : null}
      <p className="g3d-exp-legend dim" aria-hidden="true">
        <i className="g3d-exp-legend__bar" /> lower → higher {isSpecies ? "bodies" : "credits"} per jump · size = systems
      </p>
      {field ? <p className="dim tiny">Tables {field.builtAt} · averages over boxels like these, not a promise about one.</p> : null}
    </aside>
  );
}

/** The side card for a selected boxel: its score and the system names nobody has recorded. */
export function ExpeditionBoxelCard({
  b,
  species,
  inPlan,
  onTogglePlan,
  ship,
}: {
  b: ExpeditionBoxelDTO;
  species: boolean;
  inPlan: boolean;
  onTogglePlan: () => void;
  ship: Xyz | null;
}) {
  const [c, setC] = useState<ExpeditionCandidatesDTO | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    setC(null);
    const q = new URLSearchParams({ key: b.key, ...(ship ? { x: String(ship.x), y: String(ship.y), z: String(ship.z) } : {}) });
    const ac = new AbortController();
    void fetch(`/api/expedition/boxel?${q}`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: ExpeditionCandidatesDTO | null) => {
        if (!ac.signal.aborted) setC(j);
      })
      .catch(() => undefined);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [b.key]);
  const names = c ? (all ? c.candidates : c.candidates.slice(0, CANDIDATES_SHOWN)) : [];
  return (
    <div data-testid="g3d-expedition-card">
      <h2 className="g3d-panel__name">{b.name ?? `${b.code} boxel`}</h2>
      <p className="g3d-panel__meta">
        Expedition · {b.code} boxel, {b.cubeLy} ly across{b.region ? ` · ${b.region}` : ""}
      </p>
      {b.mixed ? (
        <p className="g3d-panel__note">A hand-named sector shares this sector: near it, the systems may carry that sector&apos;s name instead.</p>
      ) : null}
      <dl className="g3d-exp-facts">
        <dt>Worth</dt>
        <dd>
          {species ? `${(b.speciesBodies ?? 0).toFixed(2)} bodies of the species expected` : `${formatValue(b.ev / 100_000)} in first footfalls expected`}
        </dd>
        <dt>Per jump</dt>
        <dd>
          {crShort(b.evPerJump)} CR · {b.jumps} jumps ({fmtLy(b.distanceLy)} away, then one per system)
        </dd>
        <dt>Systems</dt>
        <dd>
          about {b.systems} · {Math.round(b.pBio * 1000) / 10} % with biology here · {b.recorded} already recorded
          {b.visited ? ` · ${b.visited} visited by you` : ""}
        </dd>
        {b.topGenera.length ? (
          <>
            <dt>Mostly</dt>
            <dd>{b.topGenera.map((g) => `${g.genus} ${Math.round(g.share * 100)} %`).join(" · ")}</dd>
          </>
        ) : null}
      </dl>
      <p>
        <button type="button" className="btn-top-toggle" aria-pressed={inPlan} onClick={onTogglePlan}>
          {inPlan ? "Take out of the plan" : "Add to the plan"}
        </button>
      </p>
      {c ? (
        c.candidates.length ? (
          <>
            <p className="g3d-menu__sub">
              Nobody has recorded{" "}
              {c.candidates.length === 1
                ? "this one"
                : c.candidates.length >= CANDIDATE_CAP
                  ? `the first ${c.candidates.length}`
                  : `these ${c.candidates.length}`}
              {c.knownSystems ? ` (${c.knownSystems} known left out)` : ""}:
            </p>
            <ul className="g3d-exp-names" data-testid="g3d-expedition-names">
              {names.map((n) => (
                <li key={n}>
                  {n} <CopySystemButton system={n} />
                </li>
              ))}
            </ul>
            {c.candidates.length > CANDIDATES_SHOWN ? (
              <button type="button" className="btn-top-toggle" onClick={() => setAll((v) => !v)}>
                {all ? "Fewer" : `All ${c.candidates.length}`}
              </button>
            ) : null}
          </>
        ) : (
          <p className="dim">{b.name ? "Every system number here is already known." : "The sector has no known name, so its systems cannot be named."}</p>
        )
      ) : (
        <p className="dim">Listing its systems…</p>
      )}
    </div>
  );
}
