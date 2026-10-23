/**
 * The galaxy map's Laboratory tab (1.2.16, owner: "material gathering for an FSD booster … trackable on galmap with
 * filters"; 2026-10-13: "rename it to Laboratory and place both in different tabs in it"): two inner tabs, Jumponium
 * (the FSD injections) and AFM Refill. Each shows what is aboard of its elements and what each tier makes, then the
 * nearest bodies rich in the elements picked — the commander's own scans first-hand, the rest from the galaxy file
 * (the top 1 % of landable bodies for an element, from Spansh's dump) — drawn on the map while the tab is open.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  LAB_KIND_NAME,
  elementsOf,
  jumpElement,
  type JumpElement,
  type JumponiumDTO,
  type LabKind,
} from "@shared/jumponium";
import { fmtLyAway } from "@shared/format";
import { isBool, isNum, isStrArr, usePersistedState } from "../usePersistedState";
import { CopySystemButton } from "../CopySystemButton";
import { LoadingNote } from "../ui/Loading";
import { pctLabel, type JumpRow } from "./jumpRow";
import { tabListKeyDown } from "../ui/Tabs";
import { G3D_HELP, MenuHead } from "./G3dMenu";
import { LabCrafting } from "./LabCrafting";


interface NearReply {
  bodies: JumpRow[];
  galaxyFile: boolean;
  ownScanned: number;
  stock: JumponiumDTO | null;
  error?: string;
}

/** What can be picked: the kind's elements that are not everywhere (carbon, nickel, chromium, manganese are). */
const pickable = (kind: LabKind) =>
  elementsOf(kind)
    .filter((k) => !jumpElement(k).common)
    .map(jumpElement);
const isKind = (v: unknown): v is LabKind => v === "fsd" || v === "afm";
const isView = (v: unknown): v is "craft" | "collect" => v === "craft" || v === "collect";
const LEVELS = [
  { key: "any", label: "Any amount" },
  { key: "rich", label: "Rich" },
  { key: "top", label: "Top 1 %" },
] as const;
const MAX_G = [0, 0.3, 0.5, 1, 2];
const MAX_LS = [0, 1000, 5000, 20000];
const RANGES = [100, 250, 500, 1000, 2500];
const isLevel = (v: unknown): v is "any" | "rich" | "top" => v === "any" || v === "rich" || v === "top";


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
  const [kind, setKind] = usePersistedState<LabKind>("galaxy.lab.kind", "fsd", isKind);
  // Crafting (owner, 2026-10-15: "a 'Crafting screen' ... Collection screen, similar to what it is now") or Collection.
  const [view, setView] = usePersistedState<"craft" | "collect">("galaxy.lab.view", "craft", isView);
  // The elements picked, kept per inner tab.
  const [fsdEls, setFsdEls] = usePersistedState<string[]>("galaxy.jump.els", [], isStrArr);
  const [afmEls, setAfmEls] = usePersistedState<string[]>("galaxy.lab.afm.els", [], isStrArr);
  const els = kind === "fsd" ? fsdEls : afmEls;
  const setEls = kind === "fsd" ? setFsdEls : setAfmEls;
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
    const p = new URLSearchParams({ kind, level, maxLy: String(range), limit: "150" });
    if (els.length) p.set("els", els.join("|"));
    if (all) p.set("all", "1");
    if (maxG > 0) p.set("maxG", String(maxG));
    if (maxLs > 0) p.set("maxLs", String(maxLs));
    // Own scans only on the server: filtered here, 150 nearer galaxy bodies could crowd them out (review 1.2.16).
    if (ownOnly) p.set("own", "1");
    return p.toString();
  }, [kind, els, all, level, maxG, maxLs, range, ownOnly]);

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
  const kindEls = useMemo(() => new Set(elementsOf(kind)), [kind]);
  const tiers = stock ? (kind === "fsd" ? stock.tiers : (stock.afmTiers ?? [])) : [];
  const short = new Set(stock?.known ? tiers.flatMap((t) => t.short.map((s) => s.key)) : []);

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
          throw new Error("The download stopped before the Laboratory file came.");
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
      aria-label="Laboratory"
      data-testid="g3d-jumponium"
    >
      <MenuHead title="Laboratory" help={G3D_HELP.jumponium} />
      {/* The app's keyboard for an option strip (ui/Tabs.tsx, audit 2026-10-22): one Tab stop, arrows choose. */}
      <div className="lab-tabs" role="tablist" aria-label="What to make" onKeyDown={(ev) => tabListKeyDown(ev, { follow: true })}>
        {(["fsd", "afm"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            tabIndex={kind === k ? 0 : -1}
            className={`lab-tab${kind === k ? " lab-tab--on" : ""}`}
            onClick={() => setKind(k)}
          >
            {k === "fsd" ? "Jumponium" : LAB_KIND_NAME.afm}
          </button>
        ))}
      </div>
      <div className="lab-views" role="group" aria-label="View">
        {(
          [
            ["craft", "Crafting", "What your materials make, and what each recipe takes"],
            ["collect", "Collection", "Where to find the materials: the nearest bodies rich in them"],
          ] as const
        ).map(([v, label, hint]) => (
          <button
            key={v}
            type="button"
            className={`fdb-chip${view === v ? " fdb-chip--on" : ""}`}
            aria-pressed={view === v}
            title={hint}
            onClick={() => setView(v)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="g3d-menu__section g3d-menu__section--first">
        {view === "craft" ? (
          stock?.known ? (
            <>
              <LabCrafting stock={stock} kind={kind} />
              {kind === "afm" && stock.afmu != null ? (
                <p className="dim tiny">
                  {stock.afmu.length
                    ? `AFMU fitted: ${stock.afmu.map((a) => (a.size != null && a.cls != null ? `${a.size}${"EDCBA"[a.cls - 1] ?? ""}` : "?")).join(", ")}.`
                    : "No AFMU fitted on this ship."}
                </p>
              ) : null}
            </>
          ) : reply == null && busy ? (
            <LoadingNote className="fdb-empty" label="Reading what you hold…" />
          ) : (
            <p className="fdb-empty">What you hold shows after your next login: the game writes the list then.</p>
          )
        ) : (
          <>
          {stock?.known ? (
            <>
              <div className="jump-stock">
                {stock.stock
                  .filter((s) => kindEls.has(s.key))
                  .map((s) => (
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
                {tiers.map((t) => (
                  <li key={t.tier}>
                    <span className="jump-tiers__name">
                      {t.name} {t.bonus ? <span className="dim">{t.bonus}</span> : null}
                    </span>
                    <span className={t.count ? "jump-tiers__n" : "jump-tiers__n is-zero"}>{t.count}</span>
                    <span className="dim">
                      {t.short.length ? `next: ${t.short.map((x) => `${x.symbol} ${x.need}`).join(", ")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {kind === "afm" ? (
                <p className="dim tiny">
                  {stock.afmu == null
                    ? "Fitted AFMUs show after your next loadout."
                    : stock.afmu.length
                      ? `AFMU fitted: ${stock.afmu.map((a) => (a.size != null && a.cls != null ? `${a.size}${"EDCBA"[a.cls - 1] ?? ""}` : "?")).join(", ")}. Its ammunition is not in the journals: the game shows it in the module panel.`
                      : "No AFMU fitted on this ship."}
                </p>
              ) : null}
            </>
          ) : (
            <p className="fdb-empty">
              What you hold shows after your next login: the game writes the list then.
            </p>
          )}

          <div className="stations-filters">
            <div className="stations-filters__group">
              <span className="stations-filters__label">Elements</span>
              {pickable(kind).map((e) => (
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
                title="Every picked element on one body, or any one of them (none picked: any of them)"
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
                {downloading ? "Downloading…" : "Download the galaxy's Laboratory bodies"}
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
                          .filter(([k]) => kindEls.has(k) && !jumpElement(k).common)
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
          </>
        )}
      </div>
    </aside>
  );
}

export { jumpLine, type JumpRow } from "./jumpRow";
