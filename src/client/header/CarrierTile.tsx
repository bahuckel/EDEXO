/**
 * His carrier's jump in Compare's tray (owner, 2026-11-02: the countdown was on the HUD only). The same phases as the
 * HUD's Carrier section (shared/ownAssets.ts carrierPhase): counting down, locked down, jumping, cooldown. Hidden
 * when there is nothing to count. It ticks every second only while it shows something; no tones here, the HUD has them.
 */
import { useEffect, useState } from "react";
import { Anchor } from "lucide-react";
import { carrierPhase, type OwnCarrierJumpDTO } from "@shared/ownAssets";
import { fmtClock } from "@shared/format";

export function CarrierTile({ jump }: { jump: OwnCarrierJumpDTO | null | undefined }) {
  const [now, setNow] = useState(() => Date.now());
  const ph = carrierPhase(jump, now);
  const active = ph != null;
  useEffect(() => {
    if (!jump) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [jump]);
  if (!active) return null;

  const to = ph.kind === "cooldown" ? null : ph.body && ph.body !== ph.system ? ph.body : ph.system;
  const who = jump?.callsign ? (jump.name ? `${jump.name} (${jump.callsign})` : jump.callsign) : (jump?.name ?? "Your carrier");
  const label =
    ph.kind === "countdown" ? "Carrier jump" : ph.kind === "lockdown" ? "Locked down" : ph.kind === "jumping" ? "Jumping" : "Cooldown";
  const value =
    ph.kind === "countdown"
      ? fmtClock(ph.toDepartMs)
      : ph.kind === "lockdown"
        ? fmtClock(ph.toDepartMs)
        : ph.kind === "jumping"
          ? to
          : fmtClock(ph.leftMs);
  const title =
    ph.kind === "countdown"
      ? `${who} jumps to ${to} in ${fmtClock(ph.toDepartMs)}; lockdown (pads closed) in ${fmtClock(ph.toLockdownMs)}.`
      : ph.kind === "lockdown"
        ? `${who} is locked down: no docking or launching. It jumps to ${to} in ${fmtClock(ph.toDepartMs)}.`
        : ph.kind === "jumping"
          ? `${who} is jumping to ${to}.`
          : `${who} can jump again in ${fmtClock(ph.leftMs)}.`;
  const fuel = jump?.fuel != null ? ` Tritium: ${jump.fuel} t.` : "";
  const warn = ph.kind === "lockdown" || ph.kind === "jumping";

  return (
    <div
      className={`d-scan-card d-scan-card--header-row header-route-mini header-carrier tray-tile${warn ? " header-carrier--warn" : ""}`}
      title={`${title}${fuel} The lockdown and cooldown times are the game's usual ones, not read from the journal.`}
    >
      <span className="tray-tile__label">
        <Anchor className="tray-tile__ico" aria-hidden="true" />
        {label}
      </span>
      <span className="tray-tile__value">{value}</span>
    </div>
  );
}
