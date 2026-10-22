/**
 * Your construction sites: progress, what is left, the biggest needs; finished and put-away sites in folds.
 * A site's details hold its full list, where to shop around (its hub) and putting it away.
 */
import { useState } from "react";
import { depotDisplayLabel } from "../../../shared/colonize/depotLabel";
import { colonyOf } from "../../../shared/colonize/ownColony";
import type { DepotSnapshot, OwnColony, ResourceRow } from "../../../shared/colonize/types";
import type { ColonizeModel } from "../useColonize";
import { BTN, Fact, Panel } from "./ui";

const left = (r: ResourceRow) => Math.max(0, r.required - r.provided);
const tons = (n: number) => `${Math.round(n).toLocaleString("en-US")} t`;

function siteTotals(d: DepotSnapshot) {
  const required = d.resources.reduce((a, r) => a + r.required, 0);
  const remaining = d.resources.reduce((a, r) => a + left(r), 0);
  const pct = d.progress != null ? d.progress * 100 : required > 0 ? ((required - remaining) / required) * 100 : 0;
  return { required, remaining, pct: Math.max(0, Math.min(100, pct)) };
}

/** What the column needs of the model; the phone view (PhoneView.tsx) passes a read-only one. */
type SitesModel = Pick<ColonizeModel, "snap" | "setDepotRefPin" | "setArchived"> & { ui: Pick<ColonizeModel["ui"], "depotRefPins"> };

export function SitesColumn({ m, readOnly = false }: { m: SitesModel; readOnly?: boolean }) {
  const snap = m.snap;
  const active = snap?.activeDepots ?? [];
  const done = snap?.completedDepots ?? [];
  const away = snap?.archivedDepots ?? [];
  const total = active.reduce((a, d) => a + siteTotals(d).remaining, 0);
  return (
    <div className="cz-side">
      <Panel
        k="sites"
        title="Your sites"
        aside={<span className="cz-aside-note">{active.length ? `${active.length} building · ${tons(total)} left` : "none building"}</span>}
      >
        <div className="cz-sites">
          {active.map((d) => (
            <SiteCard key={d.marketId} d={d} m={m} readOnly={readOnly} />
          ))}
          {done.length ? (
            <details className="cz-fold">
              <summary>Finished ({done.length})</summary>
              <div className="cz-stack">
                {done.map((d) => (
                  <SiteCard key={d.marketId} d={d} m={m} compact readOnly={readOnly} />
                ))}
              </div>
            </details>
          ) : null}
          <ColoniesFold m={m} />
          {away.length && !readOnly ? (
            <details className="cz-fold">
              <summary>Put away ({away.length})</summary>
              <div className="cz-stack">
                {away.map((d) => (
                  <div key={d.marketId} className="cz-row" style={{ alignItems: "center" }}>
                    <span>
                      <b>{depotDisplayLabel(d)}</b>
                      <div className="cz-small cz-dim">{d.starSystem}</div>
                    </span>
                    <button type="button" className={BTN} onClick={() => m.setArchived(d.marketId, false)}>
                      Bring back
                    </button>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}

/**
 * The systems the commander claimed (owner, 2026-10-21: "own sites from colonies"), each with what was built there.
 * Known from the journal's `ColonisationSystemClaim`, so a claim made before the journals on this PC is missing.
 */
function ColoniesFold({ m }: { m: SitesModel }) {
  const colonies = m.snap?.ownColonies ?? [];
  if (!colonies.length) return null;
  const count = (list: DepotSnapshot[] | undefined, c: OwnColony) => (list ?? []).filter((d) => colonyOf(d, [c])).length;
  return (
    <details className="cz-fold" data-testid="colonies">
      <summary>Your colonies ({colonies.length})</summary>
      <ul className="cz-list">
        {colonies.map((c) => {
          const building = count(m.snap?.activeDepots, c);
          const done = count(m.snap?.completedDepots, c);
          return (
            <li key={c.systemAddress}>
              <span>
                <b>{c.name}</b>
                <div className="cz-small cz-dim">claimed {c.claimedAt.slice(0, 10)}</div>
              </span>
              <span className="cz-small cz-dim cz-num">
                {building ? <span className="cz-own">{building} building</span> : null}
                {building && done ? " · " : null}
                {done ? `${done} finished` : null}
                {!building && !done ? "nothing built yet" : null}
              </span>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** "Your colony" on a site in a claimed system; "helping" on one elsewhere, once the claims are known at all. */
function Whose({ d, colonies }: { d: DepotSnapshot; colonies: OwnColony[] }) {
  if (!colonies.length || !d.starSystem) return null;
  return colonyOf(d, colonies) ? (
    <span className="cz-own"> · your colony</span>
  ) : (
    <span className="cz-dim" title="A system another commander claimed: you are helping build it">
      {" "}
      · helping
    </span>
  );
}

function SiteCard({ d, m, compact = false, readOnly = false }: { d: DepotSnapshot; m: SitesModel; compact?: boolean; readOnly?: boolean }) {
  const t = siteTotals(d);
  const needs = d.resources.filter((r) => left(r) > 0).sort((a, b) => left(b) - left(a));
  const docked = m.snap?.liveDocked?.marketId === d.marketId;
  const [hub, setHub] = useState(m.ui.depotRefPins[d.marketId] ?? "");
  const finished = d.complete || t.remaining <= 0;
  return (
    <article className={`cz-site${docked ? " cz-site--docked" : ""}`} aria-label={depotDisplayLabel(d)}>
      <div className="cz-row" style={{ alignItems: "flex-start" }}>
        <div>
          <div className="cz-site__name">{depotDisplayLabel(d)}</div>
          <div className="cz-small cz-dim">
            {d.starSystem ?? "System not known yet"}
            <Whose d={d} colonies={m.snap?.ownColonies ?? []} />
            {docked ? <span className="cz-ok"> · docked here</span> : null}
          </div>
        </div>
        <div className={`cz-big cz-num${finished ? " cz-ok" : " cz-hi"}`}>{Math.floor(t.pct)}%</div>
      </div>
      <div className="cz-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(t.pct)}>
        <div className={`cz-bar__fill${finished ? " cz-bar__fill--done" : ""}`} style={{ width: `${t.pct}%` }} />
      </div>
      {finished ? (
        <div className="facts cz-facts">
          <Fact k="Built" v="Finished" tone="open" />
        </div>
      ) : (
        <div className="facts cz-facts">
          <Fact k="Left" v={tons(t.remaining)} tone="hot" />
          <Fact k="Of" v={tons(t.required)} />
        </div>
      )}
      {!compact && needs.length ? (
        <ul className="cz-list">
          {needs.slice(0, 3).map((r) => (
            <li key={r.name}>
              <span>{r.nameLocalised || r.name}</span>
              <span className="cz-num cz-soft">{tons(left(r))}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {!compact ? (
        <details className="cz-more">
          <summary>{needs.length > 3 ? `All ${needs.length} materials, and more` : "More"}</summary>
          <div className="cz-stack" style={{ marginTop: 10 }}>
            <ul className="cz-list">
              {needs.map((r) => (
                <li key={r.name}>
                  <span>{r.nameLocalised || r.name}</span>
                  <span className="cz-num cz-dim">
                    {tons(left(r))} <span className="cz-small">of {tons(r.required)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {readOnly ? null : (
              <form
                className="cz-row"
                style={{ alignItems: "center", justifyContent: "flex-start" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  m.setDepotRefPin(d.marketId, hub.trim());
                }}
              >
                <label className="cz-label" htmlFor={`cz-hub-${d.marketId}`}>
                  Shop around
                </label>
                <input
                  id={`cz-hub-${d.marketId}`}
                  className="cz-input"
                  value={hub}
                  placeholder={d.starSystem ?? "a system"}
                  onChange={(e) => setHub(e.target.value)}
                  onBlur={() => m.setDepotRefPin(d.marketId, hub.trim())}
                />
              </form>
            )}
            {readOnly ? null : (
              <button type="button" className={BTN} style={{ alignSelf: "flex-start" }} onClick={() => m.setArchived(d.marketId, true)}>
                Put this site away
              </button>
            )}
          </div>
        </details>
      ) : null}
    </article>
  );
}
