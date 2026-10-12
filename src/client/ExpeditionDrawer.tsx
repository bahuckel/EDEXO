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
import type { GalaxyFindDTO } from "@shared/dto/galaxy";
import { formatValue } from "./galaxy3d/clusters";
import { G3D_HELP, MenuHead, MenuRow } from "./galaxy3d/G3dMenu";
import { PickList, type PickOption } from "./galaxy3d/PickList";
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
// Owner, 2026-10-12: "10 M a jump is nothing"; commanders look from 50 M and 100 M.
const MIN_PER_JUMP = [0, 5, 10, 25, 50, 100];
const LIST_ROWS = 12;
const ROUTE_WIDTHS = [100, 250, 500, 1000];

type LookFor = "exobio" | "bodies" | "stars" | "systems";
interface EndPoint {
  name: string;
  x: number;
  y: number;
  z: number;
  note?: string;
}
interface TargetsDTO {
  bodies: { key: string; label: string; unit: string }[];
  stars: { name: string; systems: number }[];
}
const fmtCount = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
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
  if (b.matchesPerJump != null) return b.matchesPerJump;
  return species ? (b.speciesBodies ?? 0) / Math.max(1, b.jumps) : b.evPerJump;
}

/** Worth thresholds for "Systems" (millions): what a system pays a first discoverer, exobiology included. */
export const WORTH_M = [5, 10, 20, 50];

const BODY_WORDS: Record<string, string> = {
  elw: "systems with an Earth-like world",
  ww: "systems with a water world",
  aw: "systems with an ammonia world",
  hrgg: "systems with a helium-rich gas giant",
  gg: "gas giants",
};

/**
 * What a field looked for, in words, for its rows and the map's hover card (plan 5.2): "systems with an
 * Earth-like world", "systems with a Neutron Star", "systems worth 10 M or more"; null for exobiology.
 */
export function targetLabelOf(target: string | undefined): string | null {
  if (!target || target === "exobio") return null;
  const at = target.indexOf(":");
  const kind = target.slice(0, at);
  const rest = target.slice(at + 1);
  if (kind === "body") return BODY_WORDS[rest] ?? rest;
  if (kind === "star") return `systems with a ${rest}`;
  if (kind === "value") return `systems worth ${rest} M or more`;
  return null;
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

function boxelLine(b: ExpeditionBoxelDTO, species: boolean, targetLabel: string | null = null): string {
  const genera = b.topGenera.map((g) => g.genus).join(", ");
  if (b.matches != null)
    return `≈${b.matches < 10 ? b.matches.toFixed(2) : Math.round(b.matches)} ${targetLabel ?? "matches"} · ${b.jumps} jumps`;
  return species
    ? `${(b.speciesBodies ?? 0).toFixed(2)} bodies expected · ${b.jumps} jumps`
    : `${crShort(b.evPerJump)} CR per jump · ${b.systems} systems${genera ? ` · ${genera}` : ""}`;
}

/** Where a boxel is: its distance from the ship, or on a route the detour of going by it. */
function whereOf(b: ExpeditionBoxelDTO): string {
  return b.detourLy != null ? `${fmtLy(b.detourLy)} off the route` : fmtLy(b.distanceLy);
}

/** The hover card's lines for one boxel. */
export function expeditionTip(
  b: ExpeditionBoxelDTO,
  species: boolean,
  targetLabel: string | null = null,
): { title: string; line: string; note: string } {
  return {
    title: b.name ?? `${b.code} boxel (unnamed sector)`,
    line: `${whereOf(b)} · ${boxelLine(b, species, targetLabel)}`,
    note: `${Math.round(b.pBio * 1000) / 10} % of systems with biology · ${b.recorded} recorded${b.barren ? ` · ${b.barren} flown without biology` : ""}${b.visited ? ` · ${b.visited} yours` : ""} · click for its systems`,
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
  const [speciesList, setSpeciesList] = useState<{ id: string; name: string; genus: string }[]>([]);
  // Plan 5.2 (owner, 2026-10-12): a sphere or a route to a system, and what to look for.
  const [mode, setMode] = useState<"sphere" | "route">("sphere");
  const [end, setEnd] = useState<EndPoint | null>(null);
  const [widthLy, setWidthLy] = useState(250);
  const [lookFor, setLookFor] = useState<LookFor>("exobio");
  const [bodyKind, setBodyKind] = useState("elw");
  const [starType, setStarType] = useState("Neutron Star");
  const [worthM, setWorthM] = useState(10);
  const [targets, setTargets] = useState<TargetsDTO | null>(null);
  const [suggested, setSuggested] = useState<EndPoint[]>([]);
  const [found, setFound] = useState<EndPoint[]>([]);
  const [endQuery, setEndQuery] = useState("");
  const from = fromSelected && selected ? selected : ship;
  const speciesOptions = useMemo<PickOption[]>(
    () => [{ value: "", label: "Any (credits)" }, ...speciesList.map((s) => ({ value: s.id, label: s.name, note: s.genus }))],
    [speciesList],
  );

  useEffect(() => {
    void fetch("/api/species-encyclopedia")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { species?: { entry: { id: string; displayName: string; genus?: string } }[] } | null) =>
        setSpeciesList(
          (j?.species ?? [])
            .map((s) => ({ id: s.entry.id, name: s.entry.displayName, genus: s.entry.genus ?? "" }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        ),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    void fetch("/api/expedition/targets")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: TargetsDTO | null) => j && setTargets(j))
      .catch(() => undefined);
  }, []);
  // End systems to offer: eight directions round the ship, 2,000 and 5,000 ly out (real systems).
  const shipKey = ship ? `${Math.round(ship.x / 50)},${Math.round(ship.y / 50)},${Math.round(ship.z / 50)}` : "";
  useEffect(() => {
    if (mode !== "route" || !ship) return;
    const ac = new AbortController();
    const at = (d: number) =>
      fetch(`/api/expedition/ends?distance=${d}&x=${ship.x}&y=${ship.y}&z=${ship.z}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { ends?: (EndPoint & { direction: string; distanceLy: number })[] } | null) =>
          (j?.ends ?? []).map((e) => ({ name: e.name, x: e.x, y: e.y, z: e.z, note: `${e.direction} · ${fmtLy(e.distanceLy)}` })),
        );
    void Promise.all([at(2000), at(5000)])
      .then(([a, b]) => {
        if (!ac.signal.aborted) setSuggested([...a, ...b]);
      })
      .catch(() => undefined);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, shipKey]);
  // A typed end system: the galaxy map's own search.
  useEffect(() => {
    const q = endQuery.trim();
    if (q.length < 2) {
      setFound([]);
      return;
    }
    const ac = new AbortController();
    const t = window.setTimeout(() => {
      void fetch(`/api/galaxy/find?q=${encodeURIComponent(q)}`, { signal: ac.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((j: GalaxyFindDTO | null) => {
          if (ac.signal.aborted) return;
          setFound(
            (j?.systems ?? []).slice(0, 30).map((x) => ({
              name: x.name,
              x: x.x,
              y: x.y,
              z: x.z,
              note: ship ? fmtLy(Math.hypot(x.x - ship.x, x.y - ship.y, x.z - ship.z)) : undefined,
            })),
          );
        })
        .catch(() => undefined);
    }, 250);
    return () => {
      ac.abort();
      window.clearTimeout(t);
    };
  }, [endQuery, ship]);
  const endOptions = useMemo<PickOption[]>(() => {
    const list = endQuery.trim().length >= 2 ? found : suggested;
    return list.map((e) => ({ value: e.name, label: e.name, note: e.note }));
  }, [endQuery, found, suggested]);
  const target =
    lookFor === "bodies" ? `body:${bodyKind}` : lookFor === "stars" ? `star:${starType}` : lookFor === "systems" ? `value:${worthM}` : "";
  const route = mode === "route" && end ? end : null;

  // Scored again when an input changes; the server caches a field for ten minutes.
  const fromKey = from ? `${Math.round(from.x)},${Math.round(from.y)},${Math.round(from.z)}` : "";
  useEffect(() => {
    if (!from) return;
    // A route waits for its end.
    if (mode === "route" && !end) {
      setField(null);
      return;
    }
    const ac = new AbortController();
    setBusy(true);
    setError(null);
    const q = new URLSearchParams({
      x: String(from.x),
      y: String(from.y),
      z: String(from.z),
      radius: String(radius),
      limit: "500",
      ...(lookFor === "exobio" && species ? { species } : {}),
      ...(target ? { target } : {}),
      ...(route ? { toX: String(route.x), toY: String(route.y), toZ: String(route.z), width: String(widthLy) } : {}),
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
  }, [fromKey, radius, species, lookFor, target, route?.name, widthLy, mode]);

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
  const isTarget = !!field?.target && field.target !== "exobio";
  const label = targetLabelOf(field?.target);
  const rows = useMemo(
    () => (field?.boxels ?? []).filter((b) => isSpecies || isTarget || b.evPerJump >= minM * 1e6).slice(0, LIST_ROWS),
    [field, minM, isSpecies, isTarget],
  );
  const toggle = (key: string) => setPlanKeys((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key].slice(0, 20)));

  return (
    <aside className="g3d-drawer g3d-menu g3d-plan" aria-label="Expedition" data-testid="g3d-expedition">
      <MenuHead title="Expedition" help={G3D_HELP.expedition} />
      <div className="g3d-menu__section g3d-menu__section--first">
        <MenuRow label="Type" hint="A sphere round your ship (or the selected point), or a route to a system: the boxels along the way">
          <select className="g3d-select g3d-row__val" value={mode} onChange={(e) => setMode(e.target.value as "sphere" | "route")} aria-label="Type">
            <option value="sphere">Sphere</option>
            <option value="route">To a system</option>
          </select>
        </MenuRow>
        {mode === "sphere" ? (
          <>
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
          </>
        ) : (
          <>
            <PickList
              label="To"
              hint="The end of the route: a system from the galaxy map's search, or one of the suggestions in eight directions round you"
              value={end?.name ?? ""}
              valueLabel={end?.name ?? "Choose a system"}
              options={endOptions}
              onQuery={setEndQuery}
              onChange={(name) => {
                const e = [...found, ...suggested].find((x) => x.name === name);
                if (e) setEnd(e);
              }}
              placeholder="Search a system, or pick a suggestion"
            />
            <MenuRow label="Corridor" hint="How far either side of the line from you to the end a boxel may lie">
              <select className="g3d-select g3d-row__val" value={widthLy} onChange={(e) => setWidthLy(Number(e.target.value))} aria-label="Corridor">
                {ROUTE_WIDTHS.map((w) => (
                  <option key={w} value={w}>
                    {w.toLocaleString("en-US")} ly
                  </option>
                ))}
              </select>
            </MenuRow>
          </>
        )}
        <MenuRow label="Looking for" hint="Exobiology (first footfalls), bodies, stars, or systems worth a sum">
          <select className="g3d-select g3d-row__val" value={lookFor} onChange={(e) => setLookFor(e.target.value as LookFor)} aria-label="Looking for">
            <option value="exobio">Exobio</option>
            <option value="bodies">Bodies</option>
            <option value="stars">Stars</option>
            <option value="systems">Systems</option>
          </select>
        </MenuRow>
        {lookFor === "exobio" ? (
          <>
            <PickList
              label="Species"
              hint="Light only the boxels where this species can grow, ranked by how many of its bodies they should hold"
              value={species}
              options={speciesOptions}
              onChange={setSpecies}
              placeholder="Search, e.g. stratum or tussock"
            />
            {!species ? (
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
          </>
        ) : lookFor === "bodies" ? (
          <PickList
            label="Bodies"
            hint="Boxels whose unflown systems should hold this, by the systems Spansh holds whole in the same region and mass code"
            value={bodyKind}
            options={(targets?.bodies ?? []).map((b) => ({ value: b.key, label: b.label }))}
            onChange={setBodyKind}
            placeholder="Search, e.g. earth or water"
          />
        ) : lookFor === "stars" ? (
          <PickList
            label="Stars"
            hint="Boxels whose unflown systems should have this main star, by the systems Spansh holds whole in the same region and mass code"
            value={starType}
            options={(targets?.stars ?? []).map((t) => ({ value: t.name, label: t.name, note: `${fmtCount(t.systems)} known` }))}
            onChange={setStarType}
            placeholder="Search, e.g. neutron or wolf"
          />
        ) : (
          <PickList
            label="Worth"
            hint="Systems that should pay at least this to a first discoverer who scans and maps every body and samples its biology"
            value={String(worthM)}
            options={WORTH_M.map((m) => ({ value: String(m), label: `${m} M CR or more` }))}
            onChange={(v) => setWorthM(Number(v))}
          />
        )}
      </div>
      <div className="g3d-menu__section">
        {!from ? (
          <p className="dim g3d-panel__note">No position yet: fly a jump, or select a point and score from it.</p>
        ) : mode === "route" && !end ? (
          <p className="dim g3d-panel__note">Choose where the route goes: search a system, or pick one of the suggestions.</p>
        ) : busy ? (
          <p className="dim g3d-panel__note">Scoring the boxels…</p>
        ) : error ? (
          <p className="options-error">{error}</p>
        ) : field ? (
          <p className="dim g3d-panel__note" data-testid="g3d-expedition-status">
            {field.scored.toLocaleString("en-US")} boxels scored{" "}
            {field.to
              ? `along ${fmtLy(Math.hypot(field.to.x - field.from.x, field.to.y - field.from.y, field.to.z - field.from.z))} to ${end?.name ?? "the end"}, ${(field.widthLy ?? 0).toLocaleString("en-US")} ly either side`
              : `within ${field.radiusLy.toLocaleString("en-US")} ly`}
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
                  {whereOf(b)} · {boxelLine(b, isSpecies, label)}
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
        <i className="g3d-exp-legend__bar" /> lower → higher {isTarget ? (label ?? "matches") : isSpecies ? "bodies" : "credits"} per jump · size = systems
      </p>
      {field ? <p className="dim tiny">Tables {field.builtAt} · averages over boxels like these, not a promise about one.</p> : null}
    </aside>
  );
}

/** The side card for a selected boxel: its score and the system names nobody has recorded. */
export function ExpeditionBoxelCard({
  b,
  species,
  targetLabel = null,
  inPlan,
  onTogglePlan,
  ship,
}: {
  b: ExpeditionBoxelDTO;
  species: boolean;
  /** Looking for bodies, stars or worth (plan 5.2): what the matches are, in words. */
  targetLabel?: string | null;
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
        {b.matches != null ? (
          <>
            <dt>Expected</dt>
            <dd>
              ≈{b.matches < 10 ? b.matches.toFixed(2) : Math.round(b.matches)} {targetLabel ?? "matches"} in its unflown systems (from the
              systems Spansh holds whole like it)
            </dd>
          </>
        ) : null}
        {b.detourLy != null ? (
          <>
            <dt>Route</dt>
            <dd>
              {fmtLy(b.detourLy)} detour · {fmtLy(b.offLy ?? 0)} off the line · {Math.round((b.along ?? 0) * 100)} % of the way
            </dd>
          </>
        ) : null}
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
          {b.barren ? ` · ${b.barren} flown since 2025 without biology` : ""}
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
