/**
 * Your construction sites, a card each (R5b, cards mockup P2): docked first, then the most recent; progress with what
 * your hold adds, Left / In hold / You, the biggest needs, the full list in a fold, and the site's own settings
 * (where to shop around, its plan rules, the HUD pin, putting it away). Finished and put-away sites in folds.
 */
import { useRef, useState } from "react";
import { useFlip } from "../../ui/useFlip";
import { depotDisplayLabel } from "../../../shared/colonize/depotLabel";
import { formatTons as tons } from "../../../shared/colonize/formatPrice";
import { colonyOf } from "../../../shared/colonize/ownColony";
import { siteMaterials, siteTotals } from "../../../shared/colonize/siteMaterials";
import type { DepotSnapshot, OwnColony } from "../../../shared/colonize/types";
import type { ColonizeModel } from "../useColonize";
import { BTN, BTN_LINK, Panel } from "./ui";
import { MaterialRows } from "./MaterialList";
import { SiteRulesForm } from "./SiteRules";
import { CreditsFold } from "./CreditsFold";

/** What the column needs of the model; the phone view (PhoneView.tsx) passes a read-only one. */
type SitesModel = Pick<ColonizeModel, "snap" | "setDepotRefPin" | "setArchived" | "setProject" | "setHudFollow" | "shipCargoByKey"> & {
  ui: Pick<ColonizeModel["ui"], "depotRefPins" | "projects" | "hudFollow">;
};

const TOP = 3;

export function SitesColumn({ m, readOnly = false }: { m: SitesModel; readOnly?: boolean }) {
  const snap = m.snap;
  const dockedId = snap?.liveDocked?.marketId ?? null;
  // Docked first (owner, 2026-10-22: as on the HUD), then the most recent.
  const active = [...(snap?.activeDepots ?? [])].sort(
    (a, b) => Number(b.marketId === dockedId) - Number(a.marketId === dockedId) || (b.lastTimestamp ?? "").localeCompare(a.lastTimestamp ?? ""),
  );
  const done = snap?.completedDepots ?? [];
  const away = snap?.archivedDepots ?? [];
  const total = active.reduce((a, d) => a + siteTotals(d).remaining, 0);
  const failed = done.filter((d) => d.failed).length;
  // The hold hint shows on one card only (15a c): the docked site, else the one the HUD follows.
  const hintId = active.some((d) => d.marketId === dockedId) ? dockedId : m.ui.hudFollow;
  return (
    <div className="cz-side">
      <Panel
        k="sites"
        title="Your sites"
        aside={<span className="cz-aside-note">{active.length ? `${active.length} building · ${tons(total)} left` : "none building"}</span>}
      >
        <div className="cz-stack" style={{ gap: "0.9rem" }}>
          {active.length ? (
            <div className="cz-sites">
              {active.map((d) => (
                <SiteCard key={d.marketId} d={d} m={m} readOnly={readOnly} holdHint={d.marketId === hintId} />
              ))}
            </div>
          ) : (
            <p className="cz-lead">No site is being built. Dock at a construction site and it appears here.</p>
          )}
          <CreditsFold systems={snap?.creditsBySystem ?? []} />
          {done.length ? (
            <details className="cz-fold">
              <summary>
                Finished ({done.length}){failed ? ` · ${done.length - failed} built · ${failed} failed` : ""}
              </summary>
              <div className="cz-sites">
                {done.map((d) => (
                  <SiteCard key={d.marketId} d={d} m={m} readOnly={readOnly} />
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

function SiteCard({ d, m, readOnly = false, holdHint = false }: { d: DepotSnapshot; m: SitesModel; readOnly?: boolean; holdHint?: boolean }) {
  const t = siteTotals(d);
  const label = depotDisplayLabel(d);
  // Still needed first, biggest first; delivered in full last, in green (owner, 2026-10-22).
  const materials = siteMaterials(d, m.shipCargoByKey);
  const open = materials.filter((r) => !r.done);
  const delivered = materials.length - open.length;
  const docked = m.snap?.liveDocked?.marketId === d.marketId;
  const finished = d.complete || d.failed || t.remaining <= 0;
  const colonies = m.snap?.ownColonies ?? [];
  // A commander with no claim at all sees "Helping" too (a guild member, 2026-10-25: a site listed although he owns
  // none). Unknown while the site's system is.
  const yours = d.starSystem ? !!colonyOf(d, colonies) : null;
  const followed = m.ui.hudFollow === d.marketId;
  const you = (d.contributions ?? []).reduce((a, c) => a + c.totalTons, 0);
  const inHold = open.reduce((a, r) => a + r.aboard, 0);
  const boost = holdHint && t.required > 0 ? Math.min(100 - t.pct, (inHold / t.required) * 100) : 0;
  const hub = m.ui.depotRefPins[d.marketId] ?? "";
  const [editHub, setEditHub] = useState(false);
  const [hubText, setHubText] = useState(hub);
  // A material delivered in full slides to the bottom (useFlip) instead of jumping there.
  const flipRef = useRef<HTMLElement>(null);
  useFlip(flipRef);
  const tone = d.failed ? " cz-sitecard--failed" : finished ? " cz-sitecard--built" : docked ? " cz-sitecard--docked" : "";
  return (
    <article ref={flipRef} className={`cz-card cz-sitecard${tone}`} aria-label={label}>
      <div className="cz-sitecard__head">
        <div className="min0">
          <div className="cz-site__name">{label}</div>
          <div className="cz-small cz-dim">{d.starSystem ?? "System not known yet"}</div>
          <div className="cz-chiprow">
            {yours === true ? <span className="sys-chip sys-chip--accent">Your colony</span> : null}
            {yours === false ? (
              <span
                className="sys-chip sys-chip--dim"
                title={
                  colonies.length
                    ? "A system another commander claimed: you docked here or delivered, so you are helping build it. Put away hides the card."
                    : "No claim of yours is in the journals on this PC: another commander's site you docked at or delivered to. Put away hides the card. (A claim made before these journals is not known.)"
                }
              >
                Helping
              </span>
            ) : null}
            {docked ? <span className="sys-chip sys-chip--ok">Docked</span> : null}
            {followed && !finished ? <span className="sys-chip sys-chip--accent">On the HUD</span> : null}
            {d.failed ? <span className="sys-chip sys-chip--danger">Failed</span> : finished ? <span className="sys-chip sys-chip--live">Built</span> : null}
          </div>
        </div>
        <div className={`cz-pct${d.failed ? " cz-dim" : finished ? " cz-live" : " cz-hi"}`}>{Math.floor(t.pct)}%</div>
      </div>
      <div
        className="cz-bar"
        role="progressbar"
        aria-label={`${label}: ${Math.floor(t.pct)}% built`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.floor(t.pct)}
      >
        <i
          className={`cz-bar__fill${d.failed ? " cz-bar__fill--failed" : finished ? " cz-bar__fill--done" : ""}`}
          style={{ width: `${finished && !d.failed ? 100 : t.pct}%` }}
        />
        {boost > 0 ? <i className="cz-bar__boost" style={{ left: `${t.pct}%`, width: `${boost}%` }} /> : null}
      </div>
      {finished ? null : (
        <div className="cz-barcap">
          {boost >= 0.5 ? <span className="cz-ok">+{Math.round(boost)} % with your hold</span> : <span />}
          <span className="cz-dim">
            {tons(t.required - t.remaining)} of {tons(t.required)}
          </span>
        </div>
      )}
      <div className="facts cz-facts3">
        {finished ? (
          <div className={`fact ${d.failed ? "fact--tone-other" : "fact--tone-yours"}`}>
            <span className="fact-k">Built</span>
            <span className="fact-v">{d.failed ? "Failed" : "Finished"}</span>
          </div>
        ) : (
          <>
            <div className="fact cz-fact--hot">
              <span className="fact-k">Left</span>
              <span className="fact-v">{tons(t.remaining)}</span>
            </div>
            {inHold > 0 ? (
              <div className="fact fact--tone-open">
                <span className="fact-k">In hold</span>
                <span className="fact-v">{tons(inHold)}</span>
              </div>
            ) : null}
          </>
        )}
        <div className="fact">
          <span className="fact-k">You</span>
          <span className="fact-v">{tons(you)}</span>
        </div>
      </div>
      {finished ? null : (
        <>
          <MaterialRows rows={open.slice(0, TOP)} flipPrefix="top" />
          {materials.length > TOP ? (
            <details className="cz-fold">
              <summary>
                Materials · {open.length} open{delivered ? ` · ${delivered} delivered` : ""}
              </summary>
              <MaterialRows rows={materials.slice(Math.min(TOP, open.length))} showOf flipPrefix="all" />
            </details>
          ) : null}
          {readOnly ? null : (
            <details className="cz-fold">
              <summary>This site's settings</summary>
              <SiteRulesForm label={label} settings={m.ui.projects[d.marketId]} onChange={(s) => m.setProject(d.marketId, s)} />
            </details>
          )}
        </>
      )}
      {readOnly ? null : (
        <div className="cz-sitecard__foot">
          {finished ? (
            <span />
          ) : editHub ? (
            <form
              className="cz-row cz-sitecard__hub"
              onSubmit={(e) => {
                e.preventDefault();
                m.setDepotRefPin(d.marketId, hubText.trim());
                setEditHub(false);
              }}
            >
              <label className="cz-label" htmlFor={`cz-hub-${d.marketId}`}>
                Shop around
              </label>
              <input
                id={`cz-hub-${d.marketId}`}
                className="cz-input"
                value={hubText}
                // Opened by the commander's own click: the box takes the focus it was opened for.
                autoFocus
                placeholder={d.starSystem ?? "a system"}
                onChange={(e) => setHubText(e.target.value)}
                onBlur={() => {
                  m.setDepotRefPin(d.marketId, hubText.trim());
                  setEditHub(false);
                }}
              />
            </form>
          ) : (
            <button type="button" className={BTN_LINK} title="Where the plan looks for sellers for this site; click to change it" onClick={() => setEditHub(true)}>
              Shop around: {hub || d.starSystem || "—"}
            </button>
          )}
          <span className="cz-sitecard__acts">
            {finished ? null : (
              <button
                type="button"
                className={`${BTN_LINK}${followed ? " is-on" : ""}`}
                aria-pressed={followed}
                title={
                  followed
                    ? "The HUD follows this site (unless you are docked at another). Click to let it follow the next trip again."
                    : "Make the HUD follow this site, whatever the next trip delivers to. Docked at a site, the HUD shows that one."
                }
                onClick={() => m.setHudFollow(followed ? null : d.marketId)}
              >
                {followed ? "Unpin from HUD" : "Follow on HUD"}
              </button>
            )}
            <button type="button" className={BTN_LINK} onClick={() => m.setArchived(d.marketId, true)}>
              Put away
            </button>
          </span>
        </div>
      )}
    </article>
  );
}
