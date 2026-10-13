/**
 * The galaxy map's Jumponium tab (1.2.16, owner: "material gathering for an FSD booster … trackable on galmap with
 * filters"; "injection/jumponium, all tiers of it"): what is aboard and what each FSD injection makes, then the
 * nearest bodies rich in the elements picked — the commander's own scans first-hand, the rest from the galaxy file
 * (the top 1 % of landable bodies for an element, from Spansh's dump) — drawn on the map while the tab is open.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { JUMP_ELEMENTS, jumpElement, type JumpElement, type JumponiumDTO } from "@shared/jumponium";
import { fmtLyAway } from "@shared/format";
import { isBool, isNum, isStrArr, usePersistedState } from "../usePersistedState";
import { CopySystemButton } from "../CopySystemButton";
import { LoadingNote } from "../ui/Loading";
import { G3D_HELP, MenuHead } from "./G3dMenu";

export interface JumpRow {
  id: string;
  system: string;
  body: string;
  x: number;
  y: number;
  z: number;
  type: string | null;
  gravityG: number | null;
  distLs: number | null;
  pct: Partial<Record<JumpElement, number>>;
  own: boolean;
  distLy: number;
}

interface NearReply {
  bodies: JumpRow[];
  galaxyFile: boolean;
  ownScanned: number;
  stock: JumponiumDTO | null;
  error?: string;
}

const PICKABLE = JUMP_ELEMENTS.filter((e) => e.key !== "carbon");
const LEVELS = [
  { key: "any", label: "Any amount" },
  { key: "rich", label: "Rich" },
  { key: "top", label: "Top 1 %" },
] as const;
const MAX_G = [0, 0.3, 0.5, 1, 2];
const MAX_LS = [0, 1000, 5000, 20000];
const RANGES = [100, 250, 500, 1000, 2500];
const isLevel = (v: unknown): v is "any" | "rich" | "top" => v === "any" || v === "rich" || v === "top";

const pctLabel = (v: number) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));

export function JumponiumDrawer({
  onRows,
  onPick,
  shipKey,
}: {
  onRows: (rows: JumpRow[]) => void;
  onPick: (r: JumpRow) => void;
  /** Changes when the ship jumps, so the list is asked again from where it is (review 1.2.16). */
  shipKey: string;
}) {
  const [els, setEls] = usePersistedState<string[]>("galaxy.jump.els", [], isStrArr);
  const [all, setAll] = usePersistedState("galaxy.jump.all", false, isBool);
  const [level, setLevel] = usePersistedState<"any" | "rich" | "top">("galaxy.jump.level", "rich", isLevel);
  const [maxG, setMaxG] = usePersistedState("galaxy.jump.maxG", 0.5, isNum);
  const [maxLs, setMaxLs] = usePersistedState("galaxy.jump.maxLs", 5000, isNum);
  const [range, setRange] = usePersistedState("galaxy.jump.range", 500, isNum);
  const [ownOnly, setOwnOnly] = usePersistedState("galaxy.jump.own", false, isBool);
  const [reply, setReply] = useState<NearReply | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams({ level, maxLy: String(range), limit: "150" });
    if (els.length) p.set("els", els.join("|"));
    if (all) p.set("all", "1");
    if (maxG > 0) p.set("maxG", String(maxG));
    if (maxLs > 0) p.set("maxLs", String(maxLs));
    // Own scans only on the server: filtered here, 150 nearer galaxy bodies could crowd them out (review 1.2.16).
    if (ownOnly) p.set("own", "1");
    return p.toString();
  }, [els, all, level, maxG, maxLs, range, ownOnly]);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    const t = window.setTimeout(() => {
      void fetch(`/api/jumponium/near?${query}`)
        .then(async (r) => {
          const j = (await r.json()) as Partial<NearReply> & { error?: string };
          // An error answer (no position yet, an unreadable file) is said in the drawer (review 1.2.16: it crashed).
          return r.ok && Array.isArray(j.bodies)
            ? (j as NearReply)
            : {
                bodies: [],
                galaxyFile: true,
                ownScanned: 0,
                stock: null,
                error: j.error ?? `Failed (${r.status})`,
              };
        })
        .then((j) => {
          if (alive) setReply(j);
        })
        .catch((e: unknown) => {
          if (alive)
            setReply({ bodies: [], galaxyFile: false, ownScanned: 0, stock: null, error: String(e) });
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }, 200);
    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [query, downloading, shipKey]);

  const rows = useMemo(() => reply?.bodies ?? [], [reply]);
  useEffect(() => onRows(rows), [rows, onRows]);
  useEffect(() => () => onRows([]), [onRows]);

  const toggle = (k: string) => {
    setEls((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  };
  const stock = reply?.stock ?? null;
  const short = new Set(stock?.known ? stock.tiers.flatMap((t) => t.short.map((s) => s.key)) : []);

  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const download = async () => {
    setDownloading(true);
    setDownloadError(null);
    try {
      const r = await fetch("/api/galaxy/index/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ extrasOnly: true }),
      });
      if (!r.ok) throw new Error(`Download failed (${r.status})`);
      // The combined download runs on the server (stations and neutron stars first when they are due): follow it
      // while it is busy, and stop on its error or when the tab closes (review 1.2.16).
      for (;;) {
        await new Promise((res) => setTimeout(res, 2000));
        if (!mounted.current) return;
        const st = (await (await fetch("/api/galaxy/index")).json()) as {
          busy?: boolean;
          extras?: { jumponium?: { present: boolean; downloading: unknown; error: string | null } };
        };
        const jp = st.extras?.jumponium;
        if (jp?.error) throw new Error(jp.error);
        if (jp?.present && !jp.downloading && !st.busy) break;
        if (!st.busy && !jp?.downloading)
          throw new Error("The download stopped before the jumponium file came.");
      }
    } catch (e) {
      if (mounted.current) setDownloadError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setDownloading(false);
    }
  };

  return (
    <aside
      className="g3d-drawer g3d-menu g3d-plan g3d-stations-drawer g3d-jump-drawer"
      aria-label="Jumponium"
      data-testid="g3d-jumponium"
    >
      <MenuHead title="Jumponium" help={G3D_HELP.jumponium} />
      <div className="g3d-menu__section g3d-menu__section--first">
        {stock?.known ? (
          <>
            <div className="jump-stock">
              {stock.stock.map((s) => (
                <span
                  key={s.key}
                  className={`jump-stock__el${short.has(s.key) ? " is-short" : ""}`}
                  title={`${s.label}: ${s.count} of ${s.cap}`}
                >
                  <b>{s.symbol}</b> {s.count}
                </span>
              ))}
            </div>
            <ul className="jump-tiers">
              {stock.tiers.map((t) => (
                <li key={t.tier}>
                  <span className="jump-tiers__name">
                    {t.name} <span className="dim">+{t.bonusPct} %</span>
                  </span>
                  <span className={t.count ? "jump-tiers__n" : "jump-tiers__n is-zero"}>{t.count}</span>
                  <span className="dim">
                    {t.short.length ? `next: ${t.short.map((x) => `${x.symbol} ${x.need}`).join(", ")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="fdb-empty">
            What you hold shows after your next login: the game writes the list then.
          </p>
        )}

        <div className="stations-filters">
          <div className="stations-filters__group">
            <span className="stations-filters__label">Elements</span>
            {PICKABLE.map((e) => (
              <button
                key={e.key}
                type="button"
                className={`fdb-chip${els.includes(e.key) ? " fdb-chip--on" : ""}${short.has(e.key) ? " jump-chip--short" : ""}`}
                onClick={() => toggle(e.key)}
                aria-pressed={els.includes(e.key)}
                title={`${e.label}${short.has(e.key) ? " — you are short of it" : ""}`}
              >
                {e.symbol}
              </button>
            ))}
            <button
              type="button"
              className="fdb-chip stations-filters__mode"
              onClick={() => setAll(!all)}
              title="Every picked element on one body, or any one of them (none picked: any of the seven)"
            >
              {all ? "All of them" : "Any of them"}
            </button>
          </div>
          <div className="stations-filters__group">
            <span className="stations-filters__label">How much</span>
            {LEVELS.map((l) => (
              <button
                key={l.key}
                type="button"
                className={`fdb-chip${level === l.key ? " fdb-chip--on" : ""}`}
                onClick={() => setLevel(l.key)}
                aria-pressed={level === l.key}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="stations-filters__group">
            <span className="stations-filters__label">Gravity</span>
            {MAX_G.map((g) => (
              <button
                key={g}
                type="button"
                className={`fdb-chip${maxG === g ? " fdb-chip--on" : ""}`}
                onClick={() => setMaxG(g)}
              >
                {g === 0 ? "Any" : `≤ ${g} g`}
              </button>
            ))}
          </div>
          <div className="stations-filters__group">
            <span className="stations-filters__label">From the arrival star</span>
            {MAX_LS.map((n) => (
              <button
                key={n}
                type="button"
                className={`fdb-chip${maxLs === n ? " fdb-chip--on" : ""}`}
                onClick={() => setMaxLs(n)}
              >
                {n === 0 ? "Any" : `≤ ${n.toLocaleString("en-US")} ls`}
              </button>
            ))}
          </div>
          <div className="stations-filters__group">
            <span className="stations-filters__label">Within</span>
            {RANGES.map((n) => (
              <button
                key={n}
                type="button"
                className={`fdb-chip${range === n ? " fdb-chip--on" : ""}`}
                onClick={() => setRange(n)}
              >
                {n.toLocaleString("en-US")} ly
              </button>
            ))}
            <button
              type="button"
              className={`fdb-chip${ownOnly ? " fdb-chip--on" : ""}`}
              onClick={() => setOwnOnly(!ownOnly)}
              title="Only bodies you scanned yourself"
            >
              My scans only
            </button>
          </div>
        </div>

        {downloadError ? <p className="fdb-empty">{downloadError}</p> : null}
        {reply && !reply.galaxyFile && !reply.error ? (
          <div className="carriers-fetch">
            <button
              type="button"
              className="fdb-chip fdb-chip--on"
              onClick={() => void download()}
              disabled={downloading}
            >
              {downloading ? "Downloading…" : "Download the galaxy's jumponium bodies"}
            </button>
            <span className="dim">
              Searching your own {reply.ownScanned.toLocaleString("en-US")} scanned landable bodies only. The
              download adds the top 1 % of the galaxy&apos;s landable bodies for each element, from
              Spansh&apos;s dump.
            </span>
          </div>
        ) : null}
        {reply?.error ? <p className="fdb-empty">{reply.error}</p> : null}
        {reply == null && busy ? <LoadingNote className="fdb-empty" label="Searching…" /> : null}
        {reply && rows.length === 0 ? (
          <p className="fdb-empty">No body within {range.toLocaleString("en-US")} ly has that.</p>
        ) : null}
        {rows.length ? (
          <div className="fdb-scroll">
            <table className="fdb-table carriers-table" style={busy ? { opacity: 0.6 } : undefined}>
              <thead>
                <tr>
                  <th>Body</th>
                  <th>Distance</th>
                  <th>Elements</th>
                  <th>Gravity</th>
                  <th>From arrival</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="is-pickable"
                    onClick={() => onPick(r)}
                    title="Click to show it on the map"
                  >
                    <td
                      className={r.own ? "stations-own" : undefined}
                      title={r.own ? "You scanned it" : undefined}
                    >
                      {r.body} <CopySystemButton system={r.system} />
                    </td>
                    <td>{fmtLyAway(r.distLy)}</td>
                    <td className="jump-els">
                      {(Object.entries(r.pct) as [JumpElement, number][])
                        .filter(([k]) => k !== "carbon")
                        .map(([k, v]) => (
                          <span key={k} className={els.includes(k) ? "is-on" : undefined}>
                            {jumpElement(k).symbol} {pctLabel(v)}
                          </span>
                        ))}
                    </td>
                    <td>{r.gravityG != null ? `${r.gravityG.toFixed(2)} g` : "—"}</td>
                    <td>{r.distLs != null ? `${Math.round(r.distLs).toLocaleString("en-US")} ls` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/** "Po 1.12 % · Y 2.30 %": a body's elements, carbon left out, for the map's hover and card. */
export function jumpLine(r: Pick<JumpRow, "pct">): string {
  return (Object.entries(r.pct) as [JumpElement, number][])
    .filter(([k]) => k !== "carbon")
    .map(([k, v]) => `${jumpElement(k).symbol} ${pctLabel(v)} %`)
    .join(" · ");
}
