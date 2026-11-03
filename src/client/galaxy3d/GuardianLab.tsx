/**
 * The Laboratory's Guardian tab (owner, 2026-11-01: "extend materials to guardian sites as well, so it can be useful,
 * the more the better"; 1.3.7). Crafting: what the Guardian materials aboard unlock at a technology broker, recipe by
 * recipe (shared/guardianTech.ts, EDEngineer's blueprints). Collection: each Guardian material, where it comes from,
 * and the nearest Guardian sites that give it (EDSM's codex, the galaxy map's Guardian layer), drawn on the map while
 * the tab is open.
 */
import { useEffect, useMemo, useState } from "react";
import type { AlienSiteKind } from "@shared/alienSites";
import { GUARDIAN_GROUP_NAME, type GuardianGroup, type GuardianStockDTO } from "@shared/guardianTech";
import type { JumponiumDTO } from "@shared/jumponium";
import { fmtLyAway } from "@shared/format";
import { isBool, isNum, isStrArr, usePersistedState } from "../usePersistedState";
import { CopySystemButton } from "../CopySystemButton";
import { LoadingNote } from "../ui/Loading";
import type { JumpRow } from "./jumpRow";

interface SiteRow {
  system: string;
  x: number;
  y: number;
  z: number;
  kinds: AlienSiteKind[];
  first: string;
  distLy: number;
}
interface NearReply {
  sites: SiteRow[];
  total: number;
  stock: JumponiumDTO | null;
  error?: string;
}

const SITE_KINDS: readonly { key: AlienSiteKind; label: string }[] = [
  { key: "ruins", label: "Ruins" },
  { key: "structure", label: "Structures" },
  { key: "sentinel", label: "Sentinels" },
  { key: "beacon", label: "Beacons" },
];
const KIND_WORD: Partial<Record<AlienSiteKind, string>> = { ruins: "ruins", structure: "structure", sentinel: "sentinels", beacon: "beacon" };
const RANGES = [500, 1000, 2500, 5000, 0];
const GROUPS: readonly GuardianGroup[] = ["module", "weapon", "fighter"];
const isGroup = (v: unknown): v is GuardianGroup => v === "module" || v === "weapon" || v === "fighter";
/** "Power Cell" for "Guardian Power Cell": the stock chips are short. */
const short = (label: string) => label.replace(/^Guardian /, "").replace(/ Obelisk Data$/, "").replace(/ Blueprint Fragment$/, " blueprint");

const siteLine = (s: Pick<SiteRow, "kinds" | "first">) =>
  `Guardian ${s.kinds.map((k) => KIND_WORD[k] ?? k).join(", ")} · first reported ${s.first}`;

export function GuardianLab({
  view,
  onRows,
  onPick,
  shipKey,
}: {
  view: "craft" | "collect";
  onRows: (rows: JumpRow[]) => void;
  onPick: (r: JumpRow) => void;
  shipKey: string;
}) {
  const [kinds, setKinds] = usePersistedState<string[]>("galaxy.lab.guardian.kinds", ["ruins", "structure"], isStrArr);
  const [range, setRange] = usePersistedState("galaxy.lab.guardian.range", 0, isNum);
  const [group, setGroup] = usePersistedState<GuardianGroup>("galaxy.lab.guardian.group", "module", isGroup);
  const [canOnly, setCanOnly] = usePersistedState("galaxy.lab.guardian.can", false, isBool);
  const [reply, setReply] = useState<NearReply | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setBusy(true);
    const p = new URLSearchParams({ kinds: kinds.join("|"), maxLy: String(range || 50_000), limit: "60" });
    void fetch(`/api/guardian/near?${p.toString()}`)
      .then(async (r) => {
        const j = (await r.json()) as Partial<NearReply>;
        return r.ok && Array.isArray(j.sites) ? (j as NearReply) : { sites: [], total: 0, stock: null, error: j.error ?? `Failed (${r.status})` };
      })
      .catch((e: unknown) => ({ sites: [], total: 0, stock: null, error: String(e) }))
      .then((j) => {
        if (alive) setReply(j);
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [kinds, range, shipKey]);

  const rows = useMemo<JumpRow[]>(
    () =>
      (view === "collect" ? (reply?.sites ?? []) : []).map((s) => ({
        id: `guardian:${s.system}`,
        system: s.system,
        body: s.system,
        x: s.x,
        y: s.y,
        z: s.z,
        type: null,
        gravityG: null,
        distLs: null,
        pct: {},
        own: false,
        distLy: s.distLy,
        note: siteLine(s),
        source: "From EDSM's codex",
      })),
    [reply, view],
  );
  useEffect(() => onRows(rows), [rows, onRows]);
  useEffect(() => () => onRows([]), [onRows]);

  const stock = reply?.stock ?? null;
  const g = stock?.guardian ?? null;
  const known = !!stock?.matsKnown;
  const toggleKind = (k: string) => setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  /** A material's sites, picked as the filter. */
  const findFor = (m: GuardianStockDTO) => {
    if (m.sites.length) setKinds([...m.sites]);
  };

  if (!reply && busy) return <LoadingNote className="fdb-empty" label="Reading what you hold…" />;
  if (reply?.error && !g) return <p className="fdb-empty">{reply.error}</p>;

  const notKnown = (
    <p className="fdb-empty">What you hold shows after your next login: the game writes the list then.</p>
  );

  if (view === "craft") {
    const recipes = (g?.recipes ?? []).filter((r) => r.group === group && (!canOnly || r.count > 0));
    return (
      <>
        {known ? null : notKnown}
        <div className="stations-filters">
          <div className="stations-filters__group">
            {GROUPS.map((k) => (
              <button key={k} type="button" className={`fdb-chip${group === k ? " fdb-chip--on" : ""}`} aria-pressed={group === k} onClick={() => setGroup(k)}>
                {GUARDIAN_GROUP_NAME[k]}
              </button>
            ))}
            <button
              type="button"
              className={`fdb-chip${canOnly ? " fdb-chip--on" : ""}`}
              aria-pressed={canOnly}
              title="Only what the materials aboard unlock now (commodities are bought at a market)"
              onClick={() => setCanOnly(!canOnly)}
            >
              I can unlock
            </button>
          </div>
        </div>
        {recipes.length === 0 ? <p className="fdb-empty">Nothing here your materials unlock yet.</p> : null}
        <ul className="guardian-recipes">
          {recipes.map((r) => (
            <li key={r.name} className={r.count ? "is-can" : undefined}>
              <div className="guardian-recipes__head">
                <b>{r.name}</b>
                <span className={r.count ? "jump-tiers__n" : "jump-tiers__n is-zero"} title={`The materials aboard unlock ${r.count}`}>
                  {known ? r.count : "?"}
                </span>
              </div>
              <div className="guardian-recipes__needs">
                {r.needs.map((n) => (
                  <span
                    key={n.key}
                    className={n.held == null ? "is-buy" : known && n.held < n.qty ? "is-short" : undefined}
                    title={n.held == null ? `${n.label}: a commodity, bought at a market` : `${n.label}: ${n.held} aboard`}
                  >
                    {n.held == null ? "buy " : ""}
                    {short(n.label)} {n.qty}
                    {n.held != null && known ? <small> ({n.held})</small> : null}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
        <p className="dim tiny">Unlocked at a Guardian technology broker. Recipes as EDEngineer lists them; aboard in brackets.</p>
      </>
    );
  }

  return (
    <>
      {known ? null : notKnown}
      {g ? (
        <table className="fdb-table guardian-stock">
          <tbody>
            {g.stock.map((m) => (
              <tr key={m.key} className={m.sites.length ? "is-pickable" : undefined} onClick={() => findFor(m)} title={m.sites.length ? "Click to find the sites that give it" : undefined}>
                <td>{short(m.label)}</td>
                <td className="guardian-stock__n">
                  {known ? m.count : "?"}
                  <span className="dim">/{m.cap}</span>
                </td>
                <td className="dim">{m.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      <div className="stations-filters">
        <div className="stations-filters__group">
          <span className="stations-filters__label">Sites with</span>
          {SITE_KINDS.map((k) => (
            <button
              key={k.key}
              type="button"
              className={`fdb-chip${kinds.includes(k.key) ? " fdb-chip--on" : ""}`}
              aria-pressed={kinds.includes(k.key)}
              onClick={() => toggleKind(k.key)}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="stations-filters__group">
          <span className="stations-filters__label">Within</span>
          {RANGES.map((n) => (
            <button key={n} type="button" className={`fdb-chip${range === n ? " fdb-chip--on" : ""}`} onClick={() => setRange(n)}>
              {n ? `${n.toLocaleString("en-US")} ly` : "Any"}
            </button>
          ))}
        </div>
      </div>

      {reply?.error ? <p className="fdb-empty">{reply.error}</p> : null}
      {reply && !reply.error && reply.sites.length === 0 ? (
        <p className="fdb-empty">No Guardian site of that kind {range ? `within ${range.toLocaleString("en-US")} ly` : "known"}.</p>
      ) : null}
      {reply?.sites.length ? (
        <div className="fdb-scroll">
          <table className="fdb-table carriers-table" style={busy ? { opacity: 0.6 } : undefined}>
            <thead>
              <tr>
                <th>System</th>
                <th>Distance</th>
                <th>Sites</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="is-pickable" onClick={() => onPick(r)} title="Click to show it on the map">
                  <td>
                    {r.system} <CopySystemButton system={r.system} />
                  </td>
                  <td>{fmtLyAway(r.distLy)}</td>
                  <td>{reply.sites[i]!.kinds.map((k) => KIND_WORD[k] ?? k).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {reply.total > reply.sites.length ? (
            <p className="dim tiny">
              The nearest {reply.sites.length} of {reply.total.toLocaleString("en-US")}.
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="dim tiny">Guardian sites from EDSM&apos;s codex: the site is on a planet of that system.</p>
    </>
  );
}
