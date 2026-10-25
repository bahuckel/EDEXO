/* ============================================================== Ship ======================== */
/*
  The ship's damage part by part (discuss item 32, owner 2026-10-22: "a top-down 2D ship view with per-part damage
  %"; server: shared/shipDamage.ts). The ship you fly seen from above (shared/shipOutlines.ts: all 49 ships, owner
  2026-10-24 "include them in 1.3.0") with each module where it sits - weapons, utilities, core modules and internals by
  their Loadout slot - each coloured by its health. A module the data does not place keeps the old spot (core modules
  down the middle, weapons on the wings, utilities along the spine, the internals as one block); a ship it does not
  know (a newer one) gets the old dart. Under it, the parts that are not whole, worst first, with their damage. The
  hull is live (HullDamage); a module is as of the last Loadout or AFMU, and the note says when.

  Its vehicles (1.3.1, owner 2026-10-25: "ship deployed vehicles ... Nomad, Rhino, the SRVs"): a row each for an SRV,
  fighter or Nomad that is out, lost, or back damaged, with its hull and who drives it; while the commander is in one,
  that vehicle is the picture and the ship becomes a row (vehicleOutlines.tsx).
*/
import type { ShipDamageState, ShipPart, ShipVehicle } from "../../../shared/shipDamage";
import { healthTier } from "../../../shared/shipDamage";
import { SHIP_OUTLINES, type ShipOutline as Outline } from "../../../shared/shipOutlines";
import type { HudSnapshot } from "../types";
import { Head, type HudSection } from "../parts";
import { VehicleIcon, VehicleView } from "./vehicleOutlines";
import { curvePath } from "./curvePath";

const LIST = 6;
/** Under this a part counts as damaged and is listed; above it, everyday wear (98-99 % after any trip) is summed up. */
const DAMAGED = 0.95;
const pct = (h: number | null) => (h == null ? "?" : `${Math.round(h * 100)}%`);
const dmg = (h: number | null) => (h == null ? "?" : `${Math.round((1 - h) * 100)}%`);
/** The worst health of a group, for a zone drawn as one. */
const worst = (parts: ShipPart[]) =>
  parts.reduce<number | null>((w, p) => (p.health == null ? w : w == null ? p.health : Math.min(w, p.health)), null);

function ago(iso: string | null): string {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(m)) return "";
  if (m < 2) return "just now";
  if (m < 90) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}

/** Where each core module sits along the spine, nose (top) to tail. */
const CORE_AT: Record<string, number> = {
  Radar: 22,
  LifeSupport: 40,
  PowerDistributor: 58,
  PowerPlant: 74,
  FrameShiftDrive: 92,
  FuelTank: 108,
  MainEngines: 126,
};

/** Where a core module sits along the length when the data does not place it (fraction of the length, nose 0). */
const CORE_ALONG: Record<string, number> = {
  Radar: 0.14,
  LifeSupport: 0.27,
  PowerDistributor: 0.4,
  PowerPlant: 0.52,
  FrameShiftDrive: 0.64,
  FuelTank: 0.76,
  MainEngines: 0.9,
};

/** The data's place for a slot: internals are keyed without their size ("Slot05_Size4" -> "Slot05"). */
function slotAt(o: Outline, slot: string): readonly [number, number] | null {
  return o.slots[slot] ?? o.slots[slot.replace(/_Size\d+$/, "")] ?? null;
}

function ShipOutline({ s }: { s: ShipDamageState }) {
  const o = s.ship ? SHIP_OUTLINES[s.ship.toLowerCase()] : undefined;
  if (!o) return <GenericOutline s={s} />;
  // The outline in its own frame (y 0..100 nose to tail, x across), fitted into the 240 x 150 box above the label.
  const half: [number, number][] = [];
  for (let k = 0; k + 1 < o.half.length; k += 2) half.push([o.half[k]!, o.half[k + 1]!]);
  const full = [...half, ...half.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number])];
  const top = Math.min(...half.map((p) => p[1]));
  const bottom = Math.max(...half.map((p) => p[1]));
  const span = Math.max(...half.map((p) => p[0]), 1);
  const k = Math.min(224 / (2 * span), 126 / (bottom - top));
  const oy = 4 + (126 - (bottom - top) * k) / 2;
  const X = (x: number) => 120 + x * k;
  const Y = (y: number) => oy + (y - top) * k;
  const len = bottom - top;

  const hull = healthTier(s.hull);
  const core = s.parts.filter((p) => p.group === "core" && p.slot !== "Armour");
  const weapons = s.parts.filter((p) => p.group === "hardpoint");
  const utility = s.parts.filter((p) => p.group === "utility");
  const internals = s.parts.filter((p) => p.group === "optional");
  const placedInternals = internals.filter((p) => slotAt(o, p.slot));
  const looseInternals = internals.filter((p) => !slotAt(o, p.slot));
  const title = (p: ShipPart) => <title>{`${p.label} ${pct(p.health)}`}</title>;
  return (
    <svg className="ship-view" viewBox="0 0 240 150" role="img" aria-label={`Hull ${pct(s.hull)}`}>
      <path className={`ship-hull ship--${hull}`} d={curvePath(full.map(([x, y]) => [X(x), Y(y)] as const))} />
      {looseInternals.length ? (
        <rect
          className={`ship-part ship-block ship--${healthTier(worst(looseInternals))}`}
          x={120 - 5}
          y={Y(top + 0.38 * len)}
          width="10"
          height={0.3 * len * k}
          rx="2"
        />
      ) : null}
      {placedInternals.map((p) => {
        const at = slotAt(o, p.slot)!;
        return (
          <circle key={p.slot} className={`ship-part ship--${healthTier(p.health)}`} cx={X(at[0])} cy={Y(at[1])} r="3">
            {title(p)}
          </circle>
        );
      })}
      {core.map((p) => {
        const at = slotAt(o, p.slot) ?? [0, top + (CORE_ALONG[p.slot] ?? 0.5) * len];
        return (
          <circle key={p.slot} className={`ship-part ship--${healthTier(p.health)}`} cx={X(at[0])} cy={Y(at[1])} r="4.5">
            {title(p)}
          </circle>
        );
      })}
      {weapons.map((p, i) => {
        const side = i % 2 === 0 ? -1 : 1;
        const at = slotAt(o, p.slot) ?? [side * Math.min(span * 0.6, 8 + Math.floor(i / 2) * 5), top + 0.3 * len + Math.floor(i / 2) * 6];
        return (
          <rect key={p.slot} className={`ship-part ship--${healthTier(p.health)}`} x={X(at[0]) - 3.5} y={Y(at[1]) - 3.5} width="7" height="7">
            {title(p)}
          </rect>
        );
      })}
      {utility.map((p, i) => {
        const at = slotAt(o, p.slot) ?? [(i % 2 ? 1 : -1) * Math.min(span * 0.4, 5), top + 0.2 * len + Math.floor(i / 2) * 6];
        return (
          <circle key={p.slot} className={`ship-part ship--${healthTier(p.health)}`} cx={X(at[0])} cy={Y(at[1])} r="2.5">
            {title(p)}
          </circle>
        );
      })}
      <text className="ship-hull-label" x="120" y="146" textAnchor="middle">
        {`hull ${pct(s.hull)}`}
      </text>
    </svg>
  );
}

/** Every ship before 1.3.0's outlines, and any ship they do not know: one dart. */
function GenericOutline({ s }: { s: ShipDamageState }) {
  const hull = healthTier(s.hull);
  const core = s.parts.filter((p) => p.group === "core" && p.slot !== "Armour");
  const weapons = s.parts.filter((p) => p.group === "hardpoint");
  const utility = s.parts.filter((p) => p.group === "utility");
  const internals = s.parts.filter((p) => p.group === "optional");
  // Weapons along the wings' front edges, alternating left and right.
  const wing = (i: number) => {
    const side = i % 2 === 0 ? -1 : 1;
    const k = Math.floor(i / 2);
    return { x: 120 + side * (34 + k * 16), y: 84 + k * 9 };
  };
  return (
    <svg className="ship-view" viewBox="0 0 240 150" role="img" aria-label={`Hull ${pct(s.hull)}`}>
      {/* The hull: one dart for every ship. */}
      <path
        className={`ship-hull ship--${hull}`}
        d="M120 6 L136 40 L140 70 L214 112 L212 124 L144 112 L138 138 L120 132 L102 138 L96 112 L28 124 L26 112 L100 70 L104 40 Z"
      />
      {internals.length ? <rect className={`ship-part ship-block ship--${healthTier(worst(internals))}`} x="108" y="48" width="24" height="70" rx="3" /> : null}
      {core.map((p) => (
        <circle key={p.slot} className={`ship-part ship--${healthTier(p.health)}`} cx="120" cy={CORE_AT[p.slot] ?? 70} r="5.5">
          <title>{`${p.label} ${pct(p.health)}`}</title>
        </circle>
      ))}
      {weapons.map((p, i) => {
        const at = wing(i);
        return <rect key={p.slot} className={`ship-part ship--${healthTier(p.health)}`} x={at.x - 4} y={at.y - 4} width="8" height="8" />;
      })}
      {utility.map((p, i) => (
        <circle key={p.slot} className={`ship-part ship--${healthTier(p.health)}`} cx={i % 2 ? 132 : 108} cy={30 + Math.floor(i / 2) * 9} r="3" />
      ))}
      <text className="ship-hull-label" x="120" y="146" textAnchor="middle">
        {`hull ${pct(s.hull)}`}
      </text>
    </svg>
  );
}

/** The vehicles worth a row: out, lost, or back in the hangar damaged. A whole one in the hangar is left out. */
function vehicleRows(s: ShipDamageState): ShipVehicle[] {
  return (s.vehicles ?? []).filter((v) => v.key !== s.inVehicle && (v.state !== "docked" || (v.hull != null && v.hull < DAMAGED)));
}

function vehicleState(v: ShipVehicle): string {
  if (v.state === "destroyed") return "lost";
  if (v.state === "docked") return "in the hangar";
  return v.pilot === "crew" ? "out · crew" : "out";
}

function VehicleRow({ v }: { v: ShipVehicle }) {
  return (
    <div className={`row ship-row--${v.state === "destroyed" ? "bad" : healthTier(v.hull)}`}>
      <span className="k">
        <VehicleIcon v={v} />
        {v.name}
        <small className="ship-veh-state">{vehicleState(v)}</small>
      </span>
      <span className="v">{v.state === "destroyed" ? "—" : pct(v.hull)}</span>
    </div>
  );
}

/** The commander in an SRV, a fighter or the Nomad: that vehicle is the picture, and the ship becomes a row. */
function InVehicle({ s, v }: { s: ShipDamageState; v: ShipVehicle }) {
  const ship = s.shipName || s.ship || "Your ship";
  return (
    <>
      <Head title="Ship" status={`${v.name} ${pct(v.hull)}`} />
      <div className="hud-big">
        {v.name}
        <small>{` from ${ship}`}</small>
      </div>
      <VehicleView v={v} label={v.hull == null ? "hull ?" : `hull ${pct(v.hull)}`} />
      <div className={`row ship-row--${healthTier(s.hull)}`}>
        <span className="k">{ship}</span>
        <span className="v">{`hull ${pct(s.hull)}`}</span>
      </div>
      {vehicleRows(s).map((x) => (
        <VehicleRow key={x.key} v={x} />
      ))}
      <p className="hud-note hud-explain">
        {v.hull == null ? "No hit taken since it launched." : `Its hull as of its last hit, ${ago(v.hullAt)}.`}
      </p>
    </>
  );
}

function Ship({ s }: { s: ShipDamageState }) {
  const inside = s.inVehicle ? (s.vehicles ?? []).find((v) => v.key === s.inVehicle) : undefined;
  if (inside) return <InVehicle s={s} v={inside} />;
  const hurt = s.parts.filter((p) => p.health != null && p.health < DAMAGED).sort((a, b) => (a.health ?? 1) - (b.health ?? 1));
  const worn = s.parts.filter((p) => p.health != null && p.health >= DAMAGED && p.health < 0.995).length;
  const name = s.shipName || s.ship || "Your ship";
  const vehicles = vehicleRows(s);
  return (
    <>
      <Head title="Ship" status={`hull ${pct(s.hull)}`} />
      <div className="hud-big">
        {name}
        {s.shipIdent ? <small>{` ${s.shipIdent}`}</small> : null}
      </div>
      <ShipOutline s={s} />
      {hurt.length ? (
        hurt.slice(0, LIST).map((p) => (
          <div key={p.slot} className={`row ship-row--${healthTier(p.health)}`}>
            <span className="k">{p.label}</span>
            <span className="v">
              {pct(p.health)}
              <small>{` −${dmg(p.health)}`}</small>
            </span>
          </div>
        ))
      ) : (
        <p className="hud-note">{worn ? "No module damaged." : "Every module whole."}</p>
      )}
      {hurt.length > LIST ? <p className="hud-note">{`+${hurt.length - LIST} more`}</p> : null}
      {worn ? <p className="hud-note">{`${worn} lightly worn (95 % or more)`}</p> : null}
      {vehicles.map((v) => (
        <VehicleRow key={v.key} v={v} />
      ))}
      <p className="hud-note hud-explain">{`Hull live; modules as of the last outfitting or repair, ${ago(s.loadoutAt)}.`}</p>
    </>
  );
}

export const ship: HudSection = {
  title: "Ship",
  /* "Only when relevant": the hull or a module is damaged (under 95 %), not merely worn. */
  relevant: (d: HudSnapshot) => {
    const s = d.shipDamage;
    return (
      !!s &&
      ((s.hull != null && s.hull < DAMAGED) ||
        s.parts.some((p) => p.health != null && p.health < DAMAGED) ||
        // A vehicle out there taking hits (1.3.1).
        (s.vehicles ?? []).some((v) => v.state === "out" && v.hull != null && v.hull < DAMAGED))
    );
  },
  /* Amber while anything is badly hurt (under 50 %). */
  state: (d) => {
    const s = d.shipDamage;
    if (!s) return null;
    const bad =
      healthTier(s.hull) === "bad" ||
      s.parts.some((p) => healthTier(p.health) === "bad") ||
      (s.vehicles ?? []).some((v) => v.state === "out" && healthTier(v.hull) === "bad");
    return bad ? "warn" : null;
  },
  initial: () => (
    <>
      <Head title="Ship" status="…" />
      <p className="hud-note">Waiting for the ship's loadout…</p>
    </>
  ),
  render: (d) =>
    d.shipDamage ? (
      <Ship s={d.shipDamage} />
    ) : (
      <>
        <Head title="Ship" status="—" />
        <p className="hud-note">No loadout yet: the game writes one when you load in, outfit or repair.</p>
      </>
    ),
};
