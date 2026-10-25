/*
  The ship's vehicles seen from above, for the HUD's Ship section (1.3.1, owner 2026-10-25: "ship deployed vehicles ...
  Nomad, Rhino, the SRVs"). Each known model has its outline (shared/vehicleOutlines.ts: the SRVs, the Nomad and the six
  fighters, reviewed by the owner), drawn like the ships and coloured by the vehicle's hull. A model the app does not
  know yet gets its kind's drawn shape (an SRV, a fighter), so a new vehicle never breaks the section.
*/
import type { ShipVehicle } from "../../../shared/shipDamage";
import { healthTier } from "../../../shared/shipDamage";
import { VEHICLE_OUTLINES } from "../../../shared/vehicleOutlines";
import { curvePath } from "./curvePath";

/** A known model's outline as one closed path, fitted (aspect kept) and centred in the box. */
export function outlinePath(type: string | null, x: number, y: number, w: number, h: number): string | null {
  const half = type ? VEHICLE_OUTLINES[type] : undefined;
  if (!half) return null;
  const right: [number, number][] = [];
  for (let k = 0; k + 1 < half.length; k += 2) right.push([half[k]!, half[k + 1]!]);
  const full = [...right, ...right.slice(1, -1).reverse().map(([a, b]) => [-a, b] as [number, number])];
  const ys = full.map((p) => p[1]);
  const top = Math.min(...ys);
  const len = Math.max(...ys) - top;
  const span = Math.max(...full.map((p) => p[0]), 1);
  const k = Math.min(w / (2 * span), h / len);
  const oy = y + (h - len * k) / 2;
  return curvePath(full.map(([a, b]) => [x + w / 2 + a * k, oy + (b - top) * k] as const));
}

type Shape = { body: string; details: string[] };

/** A rectangle with rounded corners, as a path (x, y, width, height, radius). */
const rr = (x: number, y: number, w: number, h: number, r: number) =>
  `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} ` +
  `H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
/** A wheel on each side at these heights. */
const wheels = (xl: number, xr: number, w: number, ys: [number, number][]) =>
  ys.flatMap(([y0, y1]) => [rr(xl, y0, w, y1 - y0, 2), rr(xr, y0, w, y1 - y0, 2)]);

const SCARAB: Shape = {
  body: rr(30, 16, 40, 68, 8),
  details: [
    ...wheels(21, 71, 8, [
      [20, 34],
      [43, 57],
      [66, 80],
    ]),
    rr(38, 20, 24, 12, 4),
  ],
};
const SCORPION: Shape = {
  body: "M50 10 L66 24 V84 Q66 90 60 90 H40 Q34 90 34 84 V24 Z",
  details: [
    ...wheels(24, 67, 9, [
      [22, 40],
      [64, 82],
    ]),
    "M50 50 m-9 0 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0",
    "M48 30 H52 V52 H48 Z",
  ],
};
const RHINO: Shape = {
  body: rr(26, 8, 48, 84, 6),
  details: [
    ...wheels(17, 75, 8, [
      [12, 26],
      [32, 46],
      [54, 68],
      [74, 88],
    ]),
    rr(34, 12, 32, 16, 4),
    rr(38, 66, 24, 18, 2),
  ],
};
const NOMAD: Shape = {
  body: "M50 12 L72 28 V62 L50 80 L28 62 V28 Z",
  details: [
    "M30 32 L14 18 M70 32 L86 18 M30 58 L14 76 M70 58 L86 76",
    "M14 18 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0",
    "M86 18 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0",
    "M14 76 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0",
    "M86 76 m-4 0 a4 4 0 1 0 8 0 a4 4 0 1 0 -8 0",
    "M42 20 L50 15 L58 20 V30 H42 Z",
  ],
};
const FIGHTER: Shape = {
  body: "M50 8 L82 76 L60 68 L50 88 L40 68 L18 76 Z",
  details: ["M44 26 L50 16 L56 26 V38 H44 Z"],
};

export function vehicleShape(v: Pick<ShipVehicle, "kind" | "type">): Shape {
  if (v.type === "mev_rhino") return RHINO;
  if (v.type === "combat_multicrew_srv_01") return SCORPION;
  if (v.kind === "slv") return NOMAD;
  if (v.kind === "fighter") return FIGHTER;
  return SCARAB;
}

/** The model's outline in the 100 x 100 box, else its kind's drawn shape. */
function Drawn({ v }: { v: ShipVehicle }) {
  const tier = healthTier(v.hull);
  const d = outlinePath(v.type, 4, 4, 92, 92);
  if (d) return <path className={`ship-hull ship--${tier}`} d={d} vectorEffect="non-scaling-stroke" />;
  const s = vehicleShape(v);
  return (
    <>
      {s.details.map((d, i) => (
        <path key={i} className="ship-veh-detail" d={d} vectorEffect="non-scaling-stroke" />
      ))}
      <path className={`ship-hull ship--${tier}`} d={s.body} vectorEffect="non-scaling-stroke" />
    </>
  );
}

/** The vehicle the commander is in, drawn as big as the ship would be. */
export function VehicleView({ v, label }: { v: ShipVehicle; label: string }) {
  const d = outlinePath(v.type, 8, 4, 224, 126);
  return (
    <svg className="ship-view" viewBox="0 0 240 150" role="img" aria-label={`${v.name} ${label}`}>
      {d ? (
        <path className={`ship-hull ship--${healthTier(v.hull)}`} d={d} />
      ) : (
        <g transform="translate(62 0) scale(1.16)">
          <Drawn v={v} />
        </g>
      )}
      <text className="ship-hull-label" x="120" y="146" textAnchor="middle">
        {label}
      </text>
    </svg>
  );
}

/** A small one, in front of a vehicle's row. */
export function VehicleIcon({ v }: { v: ShipVehicle }) {
  return (
    <svg className="ship-veh-icon" viewBox="0 0 100 100" aria-hidden="true">
      <Drawn v={v} />
    </svg>
  );
}
