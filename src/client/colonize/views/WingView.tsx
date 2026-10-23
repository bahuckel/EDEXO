/**
 * Your wing: who is flying with you (from the journal), what each of them carries (EDSM, when they share it), and
 * who is hauling what, so two commanders do not buy the same steel (R5b, cards mockup P12): member cards in a grid,
 * one stacked bar per material in each member's colour (the open rest is the empty track), covered materials last in
 * green, as delivered ones are.
 */
import { useMemo, useState } from "react";
import { pickWingColor, wingColor, type WingCargoClaim, type WingMember } from "../../../shared/colonize/wingManifest";
import { depotDisplayLabel } from "../../../shared/colonize/depotLabel";
import { formatTons as t } from "../../../shared/colonize/formatPrice";
import type { ColonizeModel } from "../useColonize";
import { Select } from "../../ui/Select";
import { BTN, BTN_LINK, Panel } from "./ui";

export function WingView({ m }: { m: ColonizeModel }) {
  const roster = m.snap?.wingRoster ?? [];
  const members = m.wingMembers;
  const [name, setName] = useState("");
  const needs = useMemo(() => m.summary?.rows ?? [], [m.summary]);
  // Each material: the claims on it, member by member, in the members' order.
  const claimsOf = useMemo(() => {
    const by = new Map<string, { member: WingMember; tons: number }[]>();
    for (const w of members) for (const c of w.claims) by.set(c.commodityId, [...(by.get(c.commodityId) ?? []), { member: w, tons: c.tons }]);
    return by;
  }, [members]);
  const rows = useMemo(
    () =>
      needs
        .map((r) => {
          const parts = claimsOf.get(r.id) ?? [];
          const claimed = parts.reduce((a, p) => a + p.tons, 0);
          return { ...r, parts, claimed, open: Math.max(0, r.totalTonsNeeded - claimed) };
        })
        // Open first, most open first; covered last (as delivered materials).
        .sort((a, b) => Number(a.open <= 0) - Number(b.open <= 0) || b.open - a.open),
    [needs, claimsOf],
  );
  const openTotal = rows.reduce((a, r) => a + r.open, 0);

  const update = (id: string, f: (w: WingMember) => WingMember) => m.setWingMembers(members.map((w) => (w.id === id ? f(w) : w)));
  const addMember = () => {
    const n = name.trim();
    if (!n || members.some((w) => w.name.toLowerCase() === n.toLowerCase())) return;
    m.setWingMembers([...members, { id: `manual-${Date.now()}`, name: n, color: pickWingColor(members.length), claims: [] }]);
    setName("");
  };

  return (
    <div className="cz-cols">
      <div className="cz-wide cz-stack">
        <Panel
          k="wing"
          title="Your wing"
          aside={
            <button type="button" className={BTN} disabled={m.wingBusy || !roster.length} onClick={() => void m.syncWing()}>
              {m.wingBusy ? "Asking EDSM…" : "Ask EDSM again"}
            </button>
          }
        >
          <div className="cz-stack">
          <p className="cz-lead">
            {roster.length
              ? `${roster.length} in your wing per the journal. Cargo comes from EDSM for commanders who share it.`
              : "Nobody in your wing per the journal. Add a commander by hand to split the hauling."}
          </p>
          {m.wingNotes.length ? (
            <ul className="cz-note cz-note--info" style={{ margin: 0, paddingLeft: 28 }}>
              {m.wingNotes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
          {m.snap && !m.snap.edsmApiKeyPresent && roster.length ? (
            <p className="cz-note cz-note--warn" style={{ margin: 0 }}>
              No EDSM key saved: only commanders with public EDSM cargo show up. Add your key in EDEXO's settings.
            </p>
          ) : null}
          <form
            className="cz-row"
            style={{ justifyContent: "flex-start", alignItems: "center", gap: 8 }}
            onSubmit={(e) => {
              e.preventDefault();
              addMember();
            }}
          >
            <input className="cz-input" aria-label="Commander name" placeholder="Commander name" value={name} onChange={(e) => setName(e.target.value)} />
            <button type="submit" className={BTN} disabled={!name.trim()}>
              Add commander
            </button>
          </form>
          </div>
        </Panel>
        {members.length ? (
          <div className="cz-members">
            {members.map((w) => (
              <MemberCard
                key={w.id}
                w={w}
                m={m}
                onChange={(f) => update(w.id, f)}
                onRemove={() => m.setWingMembers(members.filter((x) => x.id !== w.id))}
              />
            ))}
          </div>
        ) : null}
      </div>

      <aside className="cz-side">
        <Panel
          k="wing-split"
          title="Who hauls what"
          aside={rows.length ? <span className="cz-aside-note">{openTotal > 0 ? `${t(openTotal)} open` : "all covered"}</span> : undefined}
        >
          {rows.length ? (
            <div className="cz-stack" style={{ gap: "0.8rem" }}>
              {members.length ? (
                <div className="cz-legend">
                  {members.map((w) => (
                    <span key={w.id} className="cz-member-chip">
                      <i style={{ background: wingColor(w.color) }} />
                      {w.name}
                    </span>
                  ))}
                  <span className="cz-member-chip">
                    <i style={{ background: "var(--accent-a12)", outline: "1px solid var(--accent-a35)" }} />
                    Open
                  </span>
                </div>
              ) : null}
              <ul className="cz-mats cz-claims">
                {rows.map((r) => (
                  <li key={r.id} className={`cz-mat${r.open <= 0 ? " is-covered" : ""}`}>
                    <span className="cz-mat__name" title={r.label}>
                      {r.label}
                    </span>
                    {r.open <= 0 ? (
                      <span className="cz-mat__v">
                        ✓ covered <small>{t(r.totalTonsNeeded)}</small>
                      </span>
                    ) : (
                      <span className="cz-mat__v">
                        <span className="cz-hi">open {t(r.open)}</span>
                        {r.claimed > 0 ? <small className="cz-dim"> of {t(r.totalTonsNeeded)}</small> : null}
                      </span>
                    )}
                    <span className="cz-sbar" aria-hidden="true">
                      {r.parts.map((p) => (
                        <i
                          key={p.member.id}
                          title={`${p.member.name}: ${t(p.tons)}`}
                          style={{ width: `${Math.min(100, (p.tons / Math.max(1, r.totalTonsNeeded)) * 100)}%`, background: wingColor(p.member.color) }}
                        />
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="cz-dim" style={{ margin: 0 }}>
              Nothing needed: no site is building.
            </p>
          )}
        </Panel>
      </aside>
    </div>
  );
}

function MemberCard({
  w,
  m,
  onChange,
  onRemove,
}: {
  w: WingMember;
  m: ColonizeModel;
  onChange: (f: (w: WingMember) => WingMember) => void;
  onRemove: () => void;
}) {
  const needs = useMemo(() => m.summary?.rows ?? [], [m.summary]);
  const sites = m.snap?.activeDepots ?? [];
  const [pick, setPick] = useState("");
  const [tons, setTons] = useState("");
  const setClaims = (claims: WingCargoClaim[]) => onChange((x) => ({ ...x, claims }));
  const add = () => {
    const need = needs.find((r) => r.id === pick);
    const n = Math.round(Number(tons));
    if (!need || !(n > 0)) return;
    const others = w.claims.filter((c) => c.commodityId !== need.id);
    setClaims([...others, { commodityId: need.id, label: need.label, tons: n, targetDepotMarketId: null }]);
    setPick("");
    setTons("");
  };
  const total = w.claims.reduce((a, c) => a + c.tons, 0);
  const color = wingColor(w.color);
  const needOf = (id: string) => needs.find((r) => r.id === id)?.totalTonsNeeded ?? 0;
  return (
    <article className="cz-card cz-member" style={{ borderLeftColor: color }} aria-label={w.name}>
      <div className="cz-cardhead">
        <b className="cz-site__name">{w.name}</b>
        <button type="button" className={BTN_LINK} onClick={onRemove}>
          Remove
        </button>
      </div>
      <div className="facts cz-facts3">
        <div className="fact">
          <span className="fact-k">Hauling</span>
          <span className="fact-v">{t(total)}</span>
        </div>
        <div className="fact">
          <span className="fact-k">Claims</span>
          <span className="fact-v">{w.claims.length}</span>
        </div>
      </div>
      {w.claims.length ? (
        <ul className="cz-mats">
          {w.claims.map((c) => (
            <li key={c.commodityId} className="cz-claimrow">
              <span className="cz-mat__name" title={c.label}>
                {c.label}
              </span>
              {sites.length > 1 ? (
                <Select
                  ariaLabel={`${c.label} for`}
                  value={c.targetDepotMarketId ?? ""}
                  options={[{ value: "", label: "any site" }, ...sites.map((d) => ({ value: d.marketId, label: depotDisplayLabel(d) }))]}
                  onChange={(v) => setClaims(w.claims.map((x) => (x.commodityId === c.commodityId ? { ...x, targetDepotMarketId: v || null } : x)))}
                />
              ) : (
                <span />
              )}
              <span className="cz-dim cz-num">{t(c.tons)}</span>
              <button
                type="button"
                className="btn-top-neutral cz-x"
                aria-label={`Drop ${c.label}`}
                onClick={() => setClaims(w.claims.filter((x) => x.commodityId !== c.commodityId))}
              >
                ×
              </button>
              <span className="cz-mbar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (c.tons / Math.max(1, needOf(c.commodityId))) * 100)}%`, background: color }} />
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="cz-small cz-dim" style={{ margin: 0 }}>
          Hauling nothing yet.
        </p>
      )}
      {needs.length ? (
        <form
          className="cz-row"
          style={{ justifyContent: "flex-start", alignItems: "center", gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Select
            ariaLabel="Commodity"
            value={pick}
            options={[{ value: "", label: "Hauls…" }, ...needs.map((r) => ({ value: r.id, label: r.label }))]}
            onChange={(v) => setPick(v)}
          />
          <input className="cz-input" style={{ width: 90 }} inputMode="numeric" aria-label="Tons" placeholder="tons" value={tons} onChange={(e) => setTons(e.target.value.replace(/[^\d]/g, ""))} />
          <button type="submit" className={BTN} disabled={!pick || !tons}>
            Claim
          </button>
        </form>
      ) : null}
    </article>
  );
}
