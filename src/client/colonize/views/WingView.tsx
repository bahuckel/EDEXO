/**
 * Your wing: who is flying with you (from the journal), what each of them carries (EDSM, when they share it), and
 * who is hauling what, so two commanders do not buy the same steel.
 */
import { useMemo, useState } from "react";
import { pickWingColor, type WingCargoClaim, type WingMember } from "../../../shared/colonize/wingManifest";
import { depotDisplayLabel } from "../../../shared/colonize/depotLabel";
import type { ColonizeModel } from "../useColonize";

const t = (n: number) => `${Math.round(n).toLocaleString("en-US")} t`;

export function WingView({ m }: { m: ColonizeModel }) {
  const roster = m.snap?.wingRoster ?? [];
  const members = m.wingMembers;
  const [name, setName] = useState("");
  const needs = m.summary?.rows ?? [];
  const claimed = useMemo(() => {
    const by = new Map<string, number>();
    for (const w of members) for (const c of w.claims) by.set(c.commodityId, (by.get(c.commodityId) ?? 0) + c.tons);
    return by;
  }, [members]);

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
        <section className="cz-panel cz-stack" aria-labelledby="cz-wing-h">
          <div className="cz-row">
            <div>
              <h2 id="cz-wing-h" className="cz-h2">
                Your wing
              </h2>
              <p className="cz-small cz-dim" style={{ margin: 0 }}>
                {roster.length
                  ? `${roster.length} in your wing per the journal. Cargo comes from EDSM for commanders who share it.`
                  : "Nobody in your wing per the journal. Add a commander by hand to split the hauling."}
              </p>
            </div>
            <button type="button" className="cz-btn" disabled={m.wingBusy || !roster.length} onClick={() => void m.syncWing()}>
              {m.wingBusy ? "Asking EDSM…" : "Ask EDSM again"}
            </button>
          </div>
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
            <button type="submit" className="cz-btn" disabled={!name.trim()}>
              Add commander
            </button>
          </form>
        </section>
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

      <aside className="cz-side cz-panel cz-stack" aria-labelledby="cz-split-h">
        <h2 id="cz-split-h" className="cz-h2">
          Who hauls what
        </h2>
        {needs.length ? (
          <ul className="cz-list cz-num">
            {needs.map((r) => {
              const c = claimed.get(r.id) ?? 0;
              const open = Math.max(0, r.totalTonsNeeded - c);
              return (
                <li key={r.id}>
                  <span>{r.label}</span>
                  <span>
                    {c > 0 ? <span style={{ color: "var(--ok)" }}>{t(c)} claimed · </span> : null}
                    <span className={open > 0 ? undefined : "cz-dim"}>{open > 0 ? `${t(open)} open` : "covered"}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="cz-dim" style={{ margin: 0 }}>
            Nothing needed: no site is building.
          </p>
        )}
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
  const needs = m.summary?.rows ?? [];
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
  return (
    <article className="cz-panel cz-stack" style={{ borderLeft: `3px solid ${w.color}` }} aria-label={w.name}>
      <div className="cz-row" style={{ alignItems: "center" }}>
        <div>
          <b style={{ fontSize: 17 }}>{w.name}</b>
          <div className="cz-small cz-dim">{w.claims.length ? `hauling ${t(total)}` : "hauling nothing yet"}</div>
        </div>
        <button type="button" className="cz-btn cz-btn--quiet cz-small" onClick={onRemove}>
          Remove
        </button>
      </div>
      {w.claims.length ? (
        <ul className="cz-list cz-num">
          {w.claims.map((c) => (
            <li key={c.commodityId}>
              <span>{c.label}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {sites.length > 1 ? (
                  <select
                    className="cz-select cz-small"
                    aria-label={`${c.label} for`}
                    value={c.targetDepotMarketId ?? ""}
                    onChange={(e) =>
                      setClaims(w.claims.map((x) => (x.commodityId === c.commodityId ? { ...x, targetDepotMarketId: e.target.value || null } : x)))
                    }
                  >
                    <option value="">any site</option>
                    {sites.map((d) => (
                      <option key={d.marketId} value={d.marketId}>
                        {depotDisplayLabel(d)}
                      </option>
                    ))}
                  </select>
                ) : null}
                <span className="cz-dim">{t(c.tons)}</span>
                <button
                  type="button"
                  className="cz-iconbtn"
                  aria-label={`Drop ${c.label}`}
                  onClick={() => setClaims(w.claims.filter((x) => x.commodityId !== c.commodityId))}
                >
                  ×
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {needs.length ? (
        <form
          className="cz-row"
          style={{ justifyContent: "flex-start", alignItems: "center", gap: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <select className="cz-select" aria-label="Commodity" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Hauls…</option>
            {needs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <input className="cz-input" style={{ width: 90 }} inputMode="numeric" aria-label="Tons" placeholder="tons" value={tons} onChange={(e) => setTons(e.target.value.replace(/[^\d]/g, ""))} />
          <button type="submit" className="cz-btn" disabled={!pick || !tons}>
            Claim
          </button>
        </form>
      ) : null}
    </article>
  );
}
