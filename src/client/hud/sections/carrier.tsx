import type { HudSnapshot } from "../types";
import { fmtClock, type SectionState } from "../core";
import { playCue } from "../audio";
import { Head, type HudSection } from "../parts";

/* ============================================================== Carrier ===================== */
/*
  His fleet carrier's jump (owner, 2026-11-02: "carrier jump timer - yes"). The server sends times, not a countdown
  (shared/ownAssets.ts ownCarrierJump): the departure, the lockdown 3 min 20 s before it, the arrival about a minute
  after it and the end of the cooldown. The section counts them itself every second, and runs on from the jump
  into the cooldown without waiting for another snapshot. Nothing scheduled and no cooldown: it has nothing to say.
*/
type Jump = NonNullable<HudSnapshot["carrierJump"]>;

export type CarrierPhase =
  | { kind: "countdown"; system: string; body: string | null; toDepartMs: number; toLockdownMs: number }
  | { kind: "lockdown"; system: string; body: string | null; toDepartMs: number }
  | { kind: "jumping"; system: string; body: string | null }
  | { kind: "cooldown"; leftMs: number };

/** Where the carrier's jump stands at `nowMs`, or null when there is nothing to count. */
export function carrierPhase(cj: Jump | null | undefined, nowMs: number): CarrierPhase | null {
  if (!cj) return null;
  const p = cj.pending;
  if (p && nowMs < p.lockdownMs)
    return { kind: "countdown", system: p.system, body: p.body, toDepartMs: p.departureMs - nowMs, toLockdownMs: p.lockdownMs - nowMs };
  if (p && nowMs < p.departureMs) return { kind: "lockdown", system: p.system, body: p.body, toDepartMs: p.departureMs - nowMs };
  if (p && nowMs < p.arriveMs) return { kind: "jumping", system: p.system, body: p.body };
  if (cj.cooldownUntilMs != null && nowMs < cj.cooldownUntilMs) return { kind: "cooldown", leftMs: cj.cooldownUntilMs - nowMs };
  return null;
}

/*
  One tone when the pads close and one when it jumps, with the sample tones' switch (Sound in the HUD settings): on the
  edge seen by this page, so a page opened during a lockdown stays quiet.
*/
let cuePrev: CarrierPhase["kind"] | null | undefined;
function cueCarrier(ph: CarrierPhase | null): void {
  const kind = ph?.kind ?? null;
  if (cuePrev !== undefined && kind !== cuePrev) {
    if (kind === "lockdown" && cuePrev === "countdown") playCue("carrierLockdown");
    else if (kind === "jumping" && (cuePrev === "lockdown" || cuePrev === "countdown")) playCue("carrierJump");
  }
  cuePrev = kind;
}

function Carrier({ d }: { d: HudSnapshot }) {
  const cj = d.carrierJump;
  const ph = carrierPhase(cj, Date.now());
  cueCarrier(ph);
  const who = cj?.callsign ? (cj.name ? `${cj.name} (${cj.callsign})` : cj.callsign) : (cj?.name ?? null);
  const status =
    ph?.kind === "countdown"
      ? fmtClock(ph.toDepartMs)
      : ph?.kind === "lockdown"
        ? "Locked down"
        : ph?.kind === "jumping"
          ? "Jumping"
          : ph?.kind === "cooldown"
            ? "Cooldown"
            : "Idle";
  return (
    <>
      <Head title="Carrier" status={status} />
      {!ph ? (
        <p className="hud-note" data-f="idle">
          No carrier jump scheduled.
        </p>
      ) : ph.kind === "cooldown" ? (
        <div className="row">
          <span className="k">Next jump possible in</span>
          <span className="v" data-f="cooldown">
            {fmtClock(ph.leftMs)}
          </span>
        </div>
      ) : (
        <>
          <div className="row">
            <span className="k">{ph.kind === "jumping" ? "Jumping to" : "Jumps to"}</span>
            <span className="v" data-f="to">
              {ph.body && ph.body !== ph.system ? ph.body : ph.system}
            </span>
          </div>
          {ph.kind === "countdown" ? (
            <div className="row">
              <span className="k">Lockdown in</span>
              <span className="v" data-f="lockdown">
                {fmtClock(ph.toLockdownMs)}
              </span>
            </div>
          ) : null}
          {ph.kind === "lockdown" ? (
            <div className="row">
              <span className="k">Departs in</span>
              <span className="v" data-f="depart">
                {fmtClock(ph.toDepartMs)}
              </span>
            </div>
          ) : null}
        </>
      )}
      {ph && (who || cj?.fuel != null) ? (
        <p className="hud-note hud-explain" data-f="who">
          {[who, cj?.fuel != null ? `${cj.fuel} t tritium` : null].filter(Boolean).join(" · ")}
        </p>
      ) : null}
    </>
  );
}

export const carrier: HudSection = {
  title: "Carrier",
  relevant: (d) => carrierPhase(d.carrierJump, Date.now()) != null,
  // Amber while the pads are closed or the jump is under way: no docking or launching now.
  state: (d): SectionState => {
    const k = carrierPhase(d.carrierJump, Date.now())?.kind;
    return k === "lockdown" || k === "jumping" ? "warn" : null;
  },
  render: (d) => <Carrier d={d} />,
  ticks: true,
};
