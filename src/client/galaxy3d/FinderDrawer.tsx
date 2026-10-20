/**
 * The galaxy map's Colonisation candidate search (plan docs/plan-finder-1.2.20.md; owner, 2026-10-19): systems within a radius of
 * your colonies, a system picked on the map, or every colonised system, filtered by what their bodies are — counts
 * per body type, rings, landable, terraformable, star types, biology and geology — without the systems someone
 * already colonised or claimed. Hard filters, sorted by distance or by bodies; hits drawn on the map while open.
 *
 * The data is a download of its own (about 130 MB, the systems within 150 ly of inhabited space, from Spansh's dump):
 * counts are what Spansh lists, so each is a floor.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FINDER_FILTERS,
  FINDER_GAS_GIANTS,
  FINDER_RADIUS_MAX,
  FINDER_RADIUS_MIN,
  FINDER_RADIUS_STEP,
  type FinderHit,
  type FinderMinKey,
  type FinderQuery,
  type FinderReferenceKind,
  type FinderResult,
} from "@shared/finder";
import { STAR_CLASSES } from "@shared/galaxyTraits";
import { fmtLyAway } from "@shared/format";
import { isBool, isNum, isStrArr, oneOf, usePersistedState } from "../usePersistedState";
import { CopySystemButton } from "../CopySystemButton";
import { LoadingNote } from "../ui/Loading";
import { G3D_HELP, MenuHead } from "./G3dMenu";

interface FinderStatusDTO {
  present: boolean;
  systems: number | null;
  dump: string | null;
  bytes: number | null;
  downloading: { done: number; total: number | null } | null;
  error: string | null;
  release: { systems: number; dump: string | null; bytes: number } | null;
}

const isMin = (v: unknown): v is Partial<Record<FinderMinKey, number>> =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((n) => isNum(n) && n >= 0 && n <= 255);
const isRef = oneOf<FinderReferenceKind>("mine", "picked", "colonised");
const isSort = oneOf<"distance" | "bodies">("distance", "bodies");
const GROUPS = ["Bodies", "Gas giants", "Features", "Signals"] as const;
/** The rare star types worth a chip of their own under "has a…". */
const PRESENT_KEYS = ["H", "N", "D", "W", "SG"];
const MB = (b: number | null | undefined) => (b ? `${Math.round(b / 1e6).toLocaleString("en-US")} MB` : "");

/** A hit's line of counts, only the non-zero ones that tell systems apart. */
function countsLine(h: FinderHit): string {
  const c = h.counts;
  const gg = FINDER_GAS_GIANTS.reduce((s, k) => s + c[k], 0);
  const parts: [string, number][] = [
    ["ELW", c.elw],
    ["WW", c.ww],
    ["AW", c.aw],
    ["GG", gg],
    ["Ringed", c.ringed],
    ["Land", c.landable],
    ["Atmo", c.landable_atmo],
    ["Terra", c.terraformable],
    ["Bio", c.bio],
    ["Geo", c.geo],
  ];
  return parts
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k} ${n}`)
    .join(" · ");
}

/** "Download …" / "Update …", with the download's percentage while it runs. */
function DataButton({
  verb,
  label,
  busy,
  progress,
  onClick,
  title,
}: {
  verb: "Downloading" | "Updating";
  label: string;
  busy: boolean;
  progress: FinderStatusDTO["downloading"] | undefined;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button type="button" className="fdb-chip fdb-chip--on" onClick={onClick} disabled={busy} title={title}>
      {busy
        ? progress?.total
          ? `${verb}… ${Math.round((100 * progress.done) / progress.total)} %`
          : `${verb}…`
        : label}
    </button>
  );
}

/** A filter group's fold-out header: its name, how many of its filters are on, the chevron. */
function GroupHead({ name, on, isOpen, onToggle }: { name: string; on: number; isOpen: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="finder-group__head" aria-expanded={isOpen} onClick={onToggle}>
      <span>{name}</span>
      {on ? <span className="finder-group__count">{on}</span> : null}
      <span className="finder-group__chev" aria-hidden="true">
        {isOpen ? "▾" : "▸"}
      </span>
    </button>
  );
}

export function FinderDrawer({
  onHits,
  onPick,
  picked,
}: {
  onHits: (hits: FinderHit[], refs: FinderResult["references"]) => void;
  onPick: (h: FinderHit) => void;
  /** The system selected on the map, for "Picked system". */
  picked: { name: string; x: number; y: number; z: number } | null;
}) {
  const [reference, setReference] = usePersistedState<FinderReferenceKind>("galaxy.finder.ref", "mine", isRef);
  const [radius, setRadius] = usePersistedState("galaxy.finder.radius", 15, isNum);
  const [min, setMin] = usePersistedState<Partial<Record<FinderMinKey, number>>>("galaxy.finder.min", {}, isMin);
  const [mainStar, setMainStar] = usePersistedState<string[]>("galaxy.finder.main", [], isStrArr);
  const [present, setPresent] = usePersistedState<string[]>("galaxy.finder.present", [], isStrArr);
  const [hideClaimed, setHideClaimed] = usePersistedState("galaxy.finder.hide", true, isBool);
  const [fully, setFully] = usePersistedState("galaxy.finder.fully", false, isBool);
  const [sort, setSort] = usePersistedState<"distance" | "bodies">("galaxy.finder.sort", "distance", isSort);
  const [open, setOpen] = usePersistedState<string[]>("galaxy.finder.open", [], isStrArr);
  const [typed, setTyped] = useState("");
  const [status, setStatus] = useState<FinderStatusDTO | null>(null);
  const [result, setResult] = useState<FinderResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const refreshStatus = () =>
    fetch("/api/galaxy/finder/status")
      .then((r) => r.json() as Promise<FinderStatusDTO>)
      .then((s) => {
        if (mounted.current) setStatus(s);
        return s;
      })
      .catch(() => null);
  useEffect(() => {
    void refreshStatus();
  }, []);

  const query = useMemo((): FinderQuery => {
    const base: FinderQuery = {
      reference,
      radiusLy: radius,
      min,
      mainStar,
      starsPresent: present,
      hideClaimed,
      fullyScanned: fully,
      sort,
      limit: 200,
    };
    if (reference === "picked") {
      if (typed.trim()) base.picked = typed.trim();
      else if (picked) {
        base.picked = picked.name;
        base.pickedAt = { x: picked.x, y: picked.y, z: picked.z };
      }
    }
    return base;
  }, [reference, radius, min, mainStar, present, hideClaimed, fully, sort, typed, picked]);
  const key = JSON.stringify(query);

  useEffect(() => {
    if (!status?.present) return;
    const ctl = new AbortController();
    setBusy(true);
    setError(null);
    const t = window.setTimeout(() => {
      void fetch("/api/galaxy/finder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: key,
        signal: ctl.signal,
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(`Search failed (${r.status})`);
          return (await r.json()) as FinderResult;
        })
        .then((j) => {
          if (mounted.current) setResult(j);
        })
        .catch((e: unknown) => {
          if (mounted.current && !(e instanceof DOMException && e.name === "AbortError"))
            setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          // An aborted search was replaced by a newer one, which owns `busy` now.
          if (mounted.current && !ctl.signal.aborted) setBusy(false);
        });
    }, 350);
    return () => {
      ctl.abort();
      window.clearTimeout(t);
    };
  }, [key, status?.present, status?.bytes]);

  const hits = useMemo(() => result?.hits ?? [], [result]);
  useEffect(() => onHits(hits, result?.references ?? []), [hits, result, onHits]);
  useEffect(() => () => onHits([], []), [onHits]);

  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    setDownloading(true);
    setError(null);
    try {
      const r = await fetch("/api/galaxy/finder/download", { method: "POST" });
      if (!r.ok) throw new Error(`Download failed (${r.status})`);
      for (;;) {
        await new Promise((res) => setTimeout(res, 1500));
        if (!mounted.current) return;
        const s = await refreshStatus();
        if (!s) continue;
        if (s.error) throw new Error(s.error);
        if (s.present && !s.downloading) break;
        if (!s.downloading) throw new Error("The download stopped before the search data came.");
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setDownloading(false);
    }
  };

  const setFloor = (k: FinderMinKey, v: number) =>
    setMin((prev) => {
      const next = { ...prev };
      if (v > 0) next[k] = Math.min(255, v);
      else delete next[k];
      return next;
    });
  const toggleIn = (list: string[], set: (v: string[]) => void, k: string) =>
    set(list.includes(k) ? list.filter((x) => x !== k) : [...list, k]);
  const activeFilters = Object.keys(min).length + mainStar.length + present.length + (fully ? 1 : 0);

  const dl = status?.downloading;
  return (
    <aside className="g3d-drawer g3d-menu g3d-plan g3d-finder-drawer" aria-label="Colonisation candidate search" data-testid="g3d-finder">
      <MenuHead title="Colonisation candidate search" help={G3D_HELP.finder} />
      {status && !status.present ? (
        <div className="g3d-menu__section g3d-menu__section--first">
          <p className="fdb-empty">
            This search needs its own data: the systems within 150 ly of inhabited space, with what their bodies are
            and whether someone colonised them, from Spansh&apos;s dump.
          </p>
          <div className="carriers-fetch">
            <DataButton
              verb="Downloading"
              label={`Download the search data${status.release ? ` (${MB(status.release.bytes)})` : ""}`}
              busy={downloading}
              progress={dl}
              onClick={() => void download()}
            />
          </div>
          {error ? <p className="fdb-empty">{error}</p> : null}
        </div>
      ) : null}

      {status?.present ? (
        <div className="g3d-menu__section g3d-menu__section--first">
          {status.release && status.bytes != null && status.release.bytes !== status.bytes ? (
            <div className="carriers-fetch finder-update">
              <DataButton
                verb="Updating"
                label={`Update the search data (${MB(status.release.bytes)}${status.release.dump ? `, ${status.release.dump.slice(0, 10)}` : ""})`}
                busy={downloading}
                progress={dl}
                onClick={() => void download()}
                title="A newer build of the search data is on the release"
              />
              {error ? <span className="dim">{error}</span> : null}
            </div>
          ) : null}
          <div className="stations-filters">
            <div className="stations-filters__group">
              <span className="stations-filters__label">Around</span>
              {(
                [
                  ["mine", "My colonies", "Your colonised systems, from your journals"],
                  ["picked", "A system", "The system selected on the map, or one you type"],
                  ["colonised", "All colonised", "Every colonised system in the galaxy (as of the data's date)"],
                ] as const
              ).map(([k, label, hint]) => (
                <button
                  key={k}
                  type="button"
                  className={`fdb-chip${reference === k ? " fdb-chip--on" : ""}`}
                  aria-pressed={reference === k}
                  title={hint}
                  onClick={() => setReference(k)}
                >
                  {label}
                </button>
              ))}
            </div>
            {reference === "picked" ? (
              <div className="stations-filters__group finder-picked">
                <input
                  type="search"
                  className="g3d-find__input finder-picked__input"
                  placeholder={picked ? `${picked.name} (selected on the map)` : "System name, or select one on the map"}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  aria-label="System to search around"
                />
              </div>
            ) : null}
            <div className="stations-filters__group finder-radius">
              <span className="stations-filters__label">Within</span>
              <input
                type="range"
                className="g3d-row__range finder-radius__range"
                min={FINDER_RADIUS_MIN}
                max={FINDER_RADIUS_MAX}
                step={FINDER_RADIUS_STEP}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                aria-label="Radius in light years"
              />
              <span className="finder-radius__value">{radius} ly</span>
            </div>
          </div>

          {GROUPS.map((g) => {
            const defs = FINDER_FILTERS.filter((f) => f.group === g);
            const on = defs.filter((f) => (min[f.key] ?? 0) > 0).length;
            const isOpen = open.includes(g);
            return (
              <div key={g} className="finder-group">
                <GroupHead name={g} on={on} isOpen={isOpen} onToggle={() => toggleIn(open, setOpen, g)} />
                {isOpen ? (
                  <div className="finder-steppers">
                    {defs.map((f) => {
                      const v = min[f.key] ?? 0;
                      return (
                        <div key={f.key} className={`finder-stepper${v ? " is-on" : ""}`}>
                          <span className="finder-stepper__label">{f.label}</span>
                          <button
                            type="button"
                            aria-label={`Fewer ${f.label}`}
                            onClick={() => setFloor(f.key, v - 1)}
                            disabled={v === 0}
                          >
                            −
                          </button>
                          <span className="finder-stepper__value" title={v ? `At least ${v}` : "Any"}>
                            {v ? `≥ ${v}` : "any"}
                          </span>
                          <button type="button" aria-label={`More ${f.label}`} onClick={() => setFloor(f.key, v + 1)}>
                            +
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}

          <div className="finder-group">
            <GroupHead
              name="Stars"
              on={mainStar.length + present.length}
              isOpen={open.includes("Stars")}
              onToggle={() => toggleIn(open, setOpen, "Stars")}
            />
            {open.includes("Stars") ? (
              <div className="stations-filters">
                <div className="stations-filters__group">
                  <span className="stations-filters__label">Main star</span>
                  {STAR_CLASSES.filter((s) => s.key !== "SG").map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className={`fdb-chip${mainStar.includes(s.key) ? " fdb-chip--on" : ""}`}
                      aria-pressed={mainStar.includes(s.key)}
                      title={s.label}
                      onClick={() => toggleIn(mainStar, setMainStar, s.key)}
                    >
                      {s.key}
                    </button>
                  ))}
                </div>
                <div className="stations-filters__group">
                  <span className="stations-filters__label">Has a</span>
                  {STAR_CLASSES.filter((s) => PRESENT_KEYS.includes(s.key)).map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className={`fdb-chip${present.includes(s.key) ? " fdb-chip--on" : ""}`}
                      aria-pressed={present.includes(s.key)}
                      onClick={() => toggleIn(present, setPresent, s.key)}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="stations-filters">
            <div className="stations-filters__group">
              <button
                type="button"
                className={`fdb-chip${hideClaimed ? " fdb-chip--on" : ""}`}
                aria-pressed={hideClaimed}
                title="Leave out systems already colonised or claimed (and Frontier's own inhabited systems)"
                onClick={() => setHideClaimed(!hideClaimed)}
              >
                Hide colonised
              </button>
              <button
                type="button"
                className={`fdb-chip${fully ? " fdb-chip--on" : ""}`}
                aria-pressed={fully}
                title="Only systems whose every body is listed (their body count is known and reached)"
                onClick={() => setFully(!fully)}
              >
                Fully scanned only
              </button>
              <span className="stations-filters__label">Sort</span>
              {(
                [
                  ["distance", "Nearest"],
                  ["bodies", "Most bodies"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={`fdb-chip${sort === k ? " fdb-chip--on" : ""}`}
                  aria-pressed={sort === k}
                  onClick={() => setSort(k)}
                >
                  {label}
                </button>
              ))}
              {activeFilters ? (
                <button
                  type="button"
                  className="fdb-chip"
                  onClick={() => {
                    setMin({});
                    setMainStar([]);
                    setPresent([]);
                    setFully(false);
                  }}
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>

          {error ? <p className="fdb-empty">{error}</p> : null}
          {result?.problem ? <p className="fdb-empty">{result.problem}</p> : null}
          {/* Every search shows it is running, not only the first: a new search over an old list only dimmed the
              list, and "All colonised" reads the whole file (owner, 2026-10-19: "it needs some loading indicator"). */}
          {busy ? (
            <LoadingNote
              className="fdb-empty"
              label={reference === "colonised" ? "Searching round every colonised system…" : "Searching…"}
              detail={reference === "colonised" ? " The whole search data is read; a few seconds." : undefined}
            />
          ) : null}
          {result && !result.problem && !busy ? (
            <p className="dim tiny finder-summary">
              {result.matched.toLocaleString("en-US")} system{result.matched === 1 ? "" : "s"} match
              {result.matched > hits.length ? ` (showing ${hits.length})` : ""}
              {result.partial ? " — stopped early, narrow the search for the rest" : ""}.
              {result.dump ? ` Data as of ${result.dump.slice(0, 10)}; counts are the bodies Spansh lists.` : ""}
            </p>
          ) : null}
          {hits.length ? (
            <div className="fdb-scroll">
              <table className="fdb-table carriers-table finder-table" style={busy ? { opacity: 0.6 } : undefined}>
                <thead>
                  <tr>
                    <th>System</th>
                    <th>Distance</th>
                    <th title="Bodies Spansh lists / the system's own count">Bodies</th>
                    <th>What is there</th>
                  </tr>
                </thead>
                <tbody>
                  {hits.map((h) => (
                    <tr key={h.id64} className="is-pickable" onClick={() => onPick(h)} title="Click to show it on the map">
                      <td>
                        {h.name} <CopySystemButton system={h.name} />
                        {h.mainStar ? <span className="dim tiny"> {h.mainStar}</span> : null}
                      </td>
                      <td title={`From ${h.reference}`}>{fmtLyAway(h.distLy)}</td>
                      <td>
                        {h.listed}
                        {h.bodyCount != null && h.bodyCount !== h.listed ? (
                          <span className="dim">/{h.bodyCount}</span>
                        ) : null}
                        {h.fullyScanned ? <span className="dim tiny" title="Every body listed"> ✓</span> : null}
                      </td>
                      <td className="finder-counts">{countsLine(h)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : status == null ? (
        <LoadingNote className="fdb-empty" label="Reading the search data…" />
      ) : null}
    </aside>
  );
}

/** The card's count labels. Out of the drawer's groups, a gas giant's label needs saying it is one ("Water-based life" alone reads oddly). */
const CARD_LABEL = new Map(
  FINDER_FILTERS.map((f) => [f.key as string, f.group === "Gas giants" && f.key !== "water_giant" ? `Gas giant, ${f.label}` : f.label]),
);
const starLabel = (k: string) => STAR_CLASSES.find((s) => s.key === k)?.label ?? k;

/** The map's card for a finder hit: every non-zero count, its stars and how complete the listing is. */
export function FinderHitCard({ h, ship }: { h: FinderHit; ship: { x: number; y: number; z: number } | null }) {
  const counts = Object.entries(h.counts).filter(([k, n]) => n > 0 && k !== "stars" && k !== "planets");
  const otherStars = h.starsPresent.filter((k) => k !== h.mainStar);
  const fromShip = ship ? Math.hypot(ship.x - h.x, ship.y - h.y, ship.z - h.z) : null;
  return (
    <div className="finder-card">
      <h2 className="g3d-panel__name">
        {h.name} <CopySystemButton system={h.name} />
      </h2>
      <p className="g3d-panel__meta">
        {fmtLyAway(h.distLy)} from {h.reference}
        {fromShip != null ? ` · ${fmtLyAway(fromShip)} from your ship` : ""}
      </p>
      <p>
        {h.counts.stars} star{h.counts.stars === 1 ? "" : "s"}, {h.counts.planets} planet{h.counts.planets === 1 ? "" : "s"}
        {h.bodyCount != null ? ` · ${h.listed} of ${h.bodyCount} bodies listed` : ` · ${h.listed} bodies listed`}
        {h.fullyScanned ? " (all of them)" : ""}
      </p>
      {h.mainStar || h.starsPresent.length ? (
        <p className="dim">
          {h.mainStar ? `Main star ${starLabel(h.mainStar)}` : ""}
          {otherStars.length ? `${h.mainStar ? "; also " : ""}${otherStars.map(starLabel).join(", ")}` : ""}
        </p>
      ) : null}
      {counts.length ? (
        <ul className="finder-card__counts">
          {counts.map(([k, n]) => (
            <li key={k}>
              <span>{CARD_LABEL.get(k) ?? k}</span> <b>{n}</b>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="dim tiny">
        {h.colonised ? "Colonised. " : h.claimed ? "Claimed. " : ""}From Spansh&apos;s dump: the bodies it lists, so there may be more.
      </p>
    </div>
  );
}
