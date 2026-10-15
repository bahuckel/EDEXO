import type { ReactNode } from "react";
import type { HudBody, HudSnapshot } from "../types";
import { HUD_LIST_ROWS, cap, listRowLimit, norm } from "../core";
import { pref } from "../theme";
import { Head, type HudSection } from "../parts";

/* ============================================================== Exo candidates ============== */
type Match = HudBody["matches"][number];
type Entry = Partial<Match["entry"]>;

export function speciesOnly(entry: Entry): string {
  const g = (entry.genus || "").trim();
  const d = (entry.displayName || "").trim();
  if (!g) return d || "—";
  const prefix = g + " ";
  if (d.length >= prefix.length && d.substring(0, prefix.length).toLowerCase() === prefix.toLowerCase()) {
    const rest = d.substring(prefix.length).trim();
    return rest || d;
  }
  return d || "—";
}
export function bodyByKey(d: HudSnapshot, key: string | null): HudBody | null {
  if (!key) return null;
  for (const b of d.bodies || []) if ((b.state?.key || "") === key) return b;
  if (d.exoOverlayFocusBody && (d.exoOverlayFocusBody.state?.key || "") === key) return d.exoOverlayFocusBody;
  return null;
}
/*
  Which body the list is about.

  The targeted body wins when the game reports one (`Status.json` `Destination`): the commander
  finishing a plant on C 2 with C 3 targeted wants C 3's list already. Otherwise the app's focus:
  the body being sampled, else the tab selected in the UI, else the last touchdown.
*/
export function resolveListBody(d: HudSnapshot): { body: HudBody | null; key: string; name: string; target: boolean } | null {
  const dest = d.statusDestination;
  const focusKey = d.exoOverlayFocusBodyKey || null;
  if (dest && dest.bodyId > 0 && dest.name) {
    const key = String(dest.systemAddress) + ":" + String(dest.bodyId);
    if (key !== focusKey) return { body: bodyByKey(d, key), key, name: dest.name, target: true };
  }
  if (!focusKey) return null;
  const fb = bodyByKey(d, focusKey);
  return {
    body: fb,
    key: focusKey,
    name: fb ? fb.tabLabel || fb.state?.bodyName || focusKey : focusKey,
    target: false,
  };
}
type Progress = { text: string; cls: string; confirmed: boolean };
/**
 * Same rule as the app's candidate list: the unlikely tier stays hidden — unless something has
 * actually confirmed the species on this body (a completed analysis, a genus lock from an on-foot
 * scan, or the run in progress), in which case it is shown whatever the matcher thinks.
 */
export function speciesProgress(
  m: Match,
  st: Partial<HudBody["state"]>,
  eo: HudSnapshot["exoOrganicOverlay"] | undefined,
  bodyKey: string,
): Progress | null {
  const name = norm(m.entry?.displayName);
  if (m.organicAnalysisComplete) return { text: "3/3", cls: "done", confirmed: true };
  if (eo && eo.visible === true && eo.trackingBodyKey === bodyKey && norm(eo.speciesDisplay) === name) {
    const n = Math.max(0, Math.min(3, eo.sampleCount || 0));
    return { text: n + "/3", cls: "live", confirmed: true };
  }
  for (const lock of st?.organicGenusLocks || []) {
    // Not a sibling moon's species copied here as a hint (2026-10-03): nobody saw it on this body.
    if (!lock.fromSibling && norm(lock.speciesLocalised) === name) return { text: "seen", cls: "seen", confirmed: true };
  }
  return null;
}
/** Rarity tier → [mark, colour, name]; the colours are the app's (shared/speciesRarity.ts). */
const RARITY: Record<string, [string, string, string]> = {
  legendary: ["L", "#f5b83d", "Legendary"],
  epic: ["E", "#b77cf2", "Epic"],
  rare: ["R", "#4f9cf5", "Rare"],
  uncommon: ["U", "#4cc46a", "Uncommon"],
  common: ["C", "#9aa0a8", "Common"],
};

function Facts({
  body,
  sig,
  dss,
  target,
}: {
  body: string | null;
  sig: string | null;
  dss: boolean | null;
  target: boolean;
}) {
  return (
    <div className="facts">
      <span className="fact fact--body">
        <span className="k" data-f="bodyK">
          {target ? "Target body" : "Body"}
        </span>
        <span className={"v" + (body ? "" : " dim") + (target ? " tgt" : "")} data-f="body" title={body || ""}>
          {body || "—"}
        </span>
      </span>
      <span className="fact">
        <span className="k">Bio signals</span>
        <span className={"v" + (sig ? "" : " dim")} data-f="sig">
          {sig || "—"}
        </span>
      </span>
      <span className="fact">
        <span className="k">DSS</span>
        <span className={"v" + (dss == null ? " dim" : dss ? " yes" : "")} data-f="dss">
          {dss == null ? "—" : dss ? "Yes" : "No"}
        </span>
      </span>
    </div>
  );
}

function Region({ d }: { d: HudSnapshot }) {
  const showRegion = pref("edexoHudRegion", "1") !== "0";
  // Where the ship is (shipRegion), not the system the app is showing; currentRegion for an older server.
  const here = d.shipRegion !== undefined ? d.shipRegion : d.currentRegion;
  const regionName = here && here.name ? here.name : null;
  return (
    <div className="region" data-f="region" style={{ display: showRegion && regionName ? "" : "none" }}>
      <span className="k">Region</span>
      <span className="v" data-f="regionV">
        {regionName || "—"}
      </span>
    </div>
  );
}

function Shell({
  d,
  status,
  facts,
  children,
}: {
  d: HudSnapshot;
  status: string;
  facts: Parameters<typeof Facts>[0];
  children?: ReactNode;
}) {
  return (
    <>
      <Head title="Exo candidates" status={status} />
      <Facts {...facts} />
      <Region d={d} />
      <ul className="hud-list" data-f="list">
        {children}
      </ul>
    </>
  );
}

const plain = (text: string) => <li className="plain">{text}</li>;
const NONE = { body: null, sig: null, dss: null, target: false };

function Candidates({ d }: { d: HudSnapshot }) {
  if (d.journalBoot) return <Shell d={d} status="Journal loading" facts={NONE} />;
  const pick = resolveListBody(d);
  if (!pick)
    return (
      <Shell d={d} status="No focus" facts={NONE}>
        {plain("Select a body in the app, target one, or land to sync focus.")}
      </Shell>
    );
  const bc = pick.body;
  if (!bc)
    return (
      <Shell d={d} status={pick.target ? "Target" : "No data"} facts={{ ...NONE, body: pick.name, target: pick.target }}>
        {plain(pick.target ? "No exobiology data for this body yet — FSS or DSS it." : "No exobiology data for this body.")}
      </Shell>
    );
  const st = bc.state || ({} as HudBody["state"]);
  const label = (bc.tabLabel || st.bodyName || st.key || "").trim() || pick.name || "—";
  const sig = st.biologicalSignals;
  const bioZero = sig === 0;
  const eo = d.exoOrganicOverlay;
  const rows: { m: Match; prog: Progress | null; idx: number; rank: number; cr: number }[] = [];
  for (const m of bc.matches || []) {
    const prog = speciesProgress(m, st, eo, pick.key);
    if (m.unlikely && !(prog && prog.confirmed)) continue;
    rows.push({ m, prog, idx: 0, rank: 0, cr: 0 });
  }
  // The app's order (genus likelihood from the co-occurrence solver, then as delivered), or by
  // credits when the owner has asked for the value lens.
  const byValue = pref("edexoHudCandOrder", "likelihood") === "value";
  const rank: Record<string, number> = {};
  (bc.genusLikelihoods || []).forEach((l, idx) => {
    if (l && l.genus) rank[norm(l.genus)] = idx;
  });
  // Priced as the app prices it: ×5 once nobody has landed here, ×1 once somebody has, the list
  // price tagged "×1 ?" while nothing has said (server/wsChannels.ts slimBodyForHud).
  const foot = bc.footfall || "unknown";
  const mult = foot === "unwalked" ? 5 : 1;
  const multTag = foot === "unwalked" ? "×5" : foot === "walked" ? "×1" : "×1 ?";
  rows.forEach((r, idx) => {
    r.idx = idx;
    // The solver keys genera by data folder ("brain-tree"), not by display name ("Brain Trees").
    const g = norm(r.m.entry?.genusDataDir || r.m.entry?.genus);
    r.rank = Object.prototype.hasOwnProperty.call(rank, g) ? rank[g]! : 9999;
    r.cr = r.m.priceCredits != null && isFinite(r.m.priceCredits) ? Number(r.m.priceCredits) * mult : -1;
  });
  rows.sort((a, b) => (byValue ? b.cr - a.cr || a.idx - b.idx : a.rank - b.rank || a.idx - b.idx));
  const xCount = bioZero ? 0 : rows.length;
  const status =
    (pick.target ? "Target · " : "") +
    (bioZero ? "No biology" : xCount + " candidate" + (xCount === 1 ? "" : "s")) +
    (byValue && !bioZero ? " · by value" : "");
  const facts = {
    body: label,
    sig: xCount + " / " + (sig == null ? "—" : String(sig)),
    dss: st.dssComplete === true,
    target: pick.target,
  };
  if (bioZero) return <Shell d={d} status={status} facts={facts} />;
  // "Unknown plant" rows (shared/unknownPlants.ts, owner 2026-10-03): a signal nothing listed fills.
  const unknown = bc.unknownPlants || [];
  if (!rows.length && !unknown.length)
    return (
      <Shell d={d} status={status} facts={facts}>
        {plain("No candidate species")}
      </Shell>
    );
  const limit = listRowLimit(HUD_LIST_ROWS);
  const hidden = Math.max(0, rows.length - limit);
  return (
    <Shell d={d} status={status} facts={facts}>
      {rows.slice(0, limit).map((r, i) => {
        const m = r.m;
        const e = (m.entry || {}) as Entry;
        const genus = cap((e.genus || "").trim() || "—");
        const sp = cap(speciesOnly(e));
        /*
          Rarity and new-codex (guild tester report, 2026-09-30: "overlays showing the codex rarity").
          The region's tier when the species grows there, else the galaxy-wide one; the app's colours.
        */
        const tier = (m.regionRarity && m.regionRarity.found && m.regionRarity.tier) || (e.rarity && e.rarity.tier);
        const rar = tier ? RARITY[tier] : undefined;
        return (
          <li key={`${e.id ?? ""}-${i}`} className={r.prog ? "has-" + r.prog.cls : undefined} title={(genus + " " + sp).trim()}>
            <span className="name">
              <em>{genus + " "}</em>
              {sp}
              {rar ? (
                <span
                  className="rar"
                  style={{ color: rar[1] }}
                  title={rar[2] + (m.regionRarity && m.regionRarity.found ? " in " + m.regionRarity.region : " galaxy-wide")}
                >
                  {rar[0]}
                </span>
              ) : null}
              {m.codexNew ? (
                // FCX, as on the app's body tabs (owner, 2026-10-01; was "CX1").
                <span
                  className={m.codexFirst ? "cxnew cxnew--first" : "cxnew"}
                  title={
                    m.codexFirst
                      ? "A FIRST codex entry: nobody has logged it in this region yet (EDSM, EDAstro), you would be the first"
                      : "A new entry in your codex here"
                  }
                >
                  {m.codexFirst ? "FCX" : "CX"}
                </span>
              ) : null}
              {r.prog ? <span className={"prog prog--" + r.prog.cls}>{r.prog.text}</span> : null}
            </span>
            <span
              className="cr"
              title={r.cr >= 0 && foot === "unknown" ? (r.cr * 5).toLocaleString() + " CR if you take first footfall here" : undefined}
            >
              {r.cr >= 0 ? r.cr.toLocaleString() + " CR " + multTag : "— CR"}
            </span>
          </li>
        );
      })}
      {unknown.map((u, i) => (
        <li key={"u" + i} className="unknown-plant" title="A signal no listed species fills. Worth a look: it may be a new find.">
          <span className="name">
            <em>? </em>
            {u.genus && u.maybeBacterium
              ? cap(u.genus) + " (switched off)"
              : u.genus
                ? "Unknown " + cap(u.genus)
                : u.maybeBacterium
                  ? "Unknown plant (Bacterium?)"
                  : "Unknown plant"}
          </span>
          <span className="cr">— CR</span>
        </li>
      ))}
      {hidden ? <li className="more">+{hidden} more — all of them in the app</li> : null}
    </Shell>
  );
}

export const candidates: HudSection = {
  initial: () => <Shell d={{}} status="Waiting for journal" facts={NONE} />,
  /* "Only when relevant": a body with biological signals is in focus. */
  relevant: (d) => {
    const pick = resolveListBody(d);
    const sig = pick && pick.body && pick.body.state ? pick.body.state.biologicalSignals : null;
    return typeof sig === "number" && sig > 0;
  },
  title: "Exo candidates",
  render: (d) => <Candidates d={d} />,
};
