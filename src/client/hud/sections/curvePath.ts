/* The outlines' drawing, shared by the ship and its vehicles (ship.tsx, vehicleOutlines.tsx). */

/** A smooth closed curve through the points (Catmull-Rom, each handle at most a third of its segment, so a short
 * edge beside a long one does not overshoot into a hook). Same drawing as the outline review page. */
export function curvePath(pts: readonly (readonly [number, number])[]): string {
  const n = pts.length;
  const P = (k: number) => pts[(k + n) % n]!;
  const f = (v: number) => Math.round(v * 10) / 10;
  let d = `M${f(P(0)[0])} ${f(P(0)[1])}`;
  for (let k = 0; k < n; k++) {
    const [p0, p1, p2, p3] = [P(k - 1), P(k), P(k + 1), P(k + 2)];
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 3;
    const cap = (dx: number, dy: number): [number, number] => {
      const l = Math.hypot(dx, dy);
      return l > seg && l > 0 ? [(dx * seg) / l, (dy * seg) / l] : [dx, dy];
    };
    const t1 = cap((p2[0] - p0[0]) / 6, (p2[1] - p0[1]) / 6);
    const t2 = cap((p3[0] - p1[0]) / 6, (p3[1] - p1[1]) / 6);
    d += ` C${f(p1[0] + t1[0])} ${f(p1[1] + t1[1])} ${f(p2[0] - t2[0])} ${f(p2[1] - t2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} Z`;
}
