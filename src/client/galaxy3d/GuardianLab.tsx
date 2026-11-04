/**
 * The Laboratory's Guardian tab (owner, 2026-11-01: "extend materials to guardian sites as well, so it can be useful,
 * the more the better"; 1.3.7), laid out as the Jumponium and AFM tabs are (owner, 2026-11-04). Crafting: the crafting
 * screen (LabCrafting.tsx CraftGraph), the materials of one group's unlocks joined to their cards, recipes from
 * shared/guardianTech.ts (EDEngineer's blueprints). Collection: what is aboard as chips, each unlock's count and what
 * one more lacks, and the nearest Guardian sites (EDSM's codex, the galaxy map's Guardian layer), drawn on the map
 * while the tab is open; a material's chip picks the sites that give it.
 */
import { useEffect, useMemo, useState } from "react";
import type { AlienSiteKind } from "@shared/alienSites";
import {
  GUARDIAN_GROUP_NAME,
  GUARDIAN_ITEMS,
  guardianItem,
  MAT_CAP,
  type GuardianGroup,
  type GuardianRecipeDTO,
  type GuardianStockDTO,
} from "@shared/guardianTech";
import type { JumponiumDTO } from "@shared/jumponium";
import { fmtLyAway } from "@shared/format";
import { isBool, isNum, isStrArr, usePersistedState } from "../usePersistedState";
import { CopySystemButton } from "../CopySystemButton";
import { LoadingNote } from "../ui/Loading";
import type { JumpRow } from "./jumpRow";
import { CraftGraph, type CraftCard, type CraftMat } from "./LabCrafting";

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

/** "FSD Booster" for "Guardian FSD Booster": the tab already says Guardian ("Modified …" keeps its word). */
const cardName = (name: string) => name.replace(/^Guardian /, "");
const nextLine = (r: GuardianRecipeDTO) => (r.short.length ? r.short.map((x) => `${short(x.label)} ${x.need}`).join(", ") : undefined);
const ORDER = new Map(GUARDIAN_ITEMS.map((i, n) => [i.key, n]));

/** The crafting screen's nodes for some unlocks: every ingredient they take, in the item table's order. */
function graphOf(recipes: readonly GuardianRecipeDTO[], known: boolean): { mats: CraftMat[]; cards: CraftCard[] } {
  const byKey = new Map<string, CraftMat>();
  for (const r of recipes)
    for (const n of r.needs)
      if (!byKey.has(n.key))
        byKey.set(n.key, {
          key: n.key,
          sym: short(n.label),
          label: n.label,
          held: n.held == null ? null : known ? n.held : 0,
          cap: MAT_CAP[guardianItem(n.key)?.grade ?? 5],
        });
  const mats = [...byKey.values()].sort((a, b) => (ORDER.get(a.key) ?? 0) - (ORDER.get(b.key) ?? 0));
  const cards = recipes.map((r) => ({
    id: r.name,
    name: cardName(r.name),
    count: r.count,
    next: known ? nextLine(r) : undefined,
    recipe: r.needs.map((n) => ({ key: n.key, qty: n.qty })),
  }));
  return { mats, cards };
}

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
  /** A material's chip: its sites picked as the filter, and its source said under the chips. */
  const [picked, setPicked] = useState<string | null>(null);
  const findFor = (m: GuardianStockDTO) => {
    setPicked(m.key);
    if (m.sites.length) setKinds([...m.sites]);
  };

  if (!reply && busy) return <LoadingNote className="fdb-empty" label="Reading what you hold…" />;
  if (reply?.error && !g) return <p className="fdb-empty">{reply.error}</p>;

  const notKnown = (
    <p className="fdb-empty">What you hold shows after your next login: the game writes the list then.</p>
  );
  const shown = (g?.recipes ?? []).filter((r) => r.group === group && (!canOnly || r.count > 0));
  const groupChips = (
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
  );

  if (view === "craft") {
    const { mats, cards } = graphOf(shown, known);
    return (
      <>
        {known ? null : notKnown}
        {groupChips}
        {shown.length === 0 ? <p className="fdb-empty">Nothing here your materials unlock yet.</p> : <CraftGraph mats={mats} cards={cards} named />}
        <p className="dim tiny">Unlocked at a Guardian technology broker, recipes as EDEngineer lists them. Commodities are bought at a market.</p>
      </>
    );
  }

  // What one more of a shown unlock lacks, as the Jumponium tab marks its short elements.
  const shortKeys = new Set(known ? shown.flatMap((r) => r.short.map((x) => x.key)) : []);
  const pickedItem = picked ? g?.stock.find((m) => m.key === picked) : undefined;
  return (
    <>
      {known ? null : notKnown}
      {g ? (
        <div className="jump-stock">
          {g.stock.map((m) => (
            <button
              key={m.key}
              type="button"
              className={`jump-stock__el guardian-chip${shortKeys.has(m.key) ? " is-short" : ""}${picked === m.key ? " is-picked" : ""}`}
              title={`${m.label}: ${known ? m.count : "?"} of ${m.cap}. ${m.source}.${m.sites.length ? " Click to find the sites that give it." : ""}`}
              onClick={() => findFor(m)}
            >
              <b>{short(m.label)}</b> {known ? m.count : "?"}
            </button>
          ))}
        </div>
      ) : null}
      {pickedItem ? (
        <p className="dim tiny">
          {pickedItem.label}: {pickedItem.source}.
        </p>
      ) : null}
      {groupChips}
      <ul className="jump-tiers">
        {shown.map((r) => (
          <li key={r.name}>
            <span className="jump-tiers__name">{cardName(r.name)}</span>
            <span className={r.count ? "jump-tiers__n" : "jump-tiers__n is-zero"}>{known ? r.count : "?"}</span>
            <span className="dim">{known && r.short.length ? `next: ${nextLine(r)}` : ""}</span>
          </li>
        ))}
      </ul>

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
