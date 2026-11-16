/**
 * The plants of the header artwork: filled shapes in the canvas' current fill and stroke, base at 0,0,
 * up is -y, about `s` px tall. Each returns the places that glow (tube mouths, gills, mats), in its own
 * coordinates. Drawn dark against the sky; the edge light and the glow are added by the scene.
 */
import { TAU, lerp } from "./maths";

type Ctx = CanvasRenderingContext2D;
type Rnd = () => number;

export type Glint =
  | { x: number; y: number; r: number; e?: number }
  | { line: [number, number, number, number]; w: number }
  | { wave: [number, number, number, number, number]; w: number };

export type PlantKind =
  | "tussock"
  | "tubus"
  | "cactoida"
  | "fungoida"
  | "brain"
  | "frutexa"
  | "aleoida"
  | "osseus"
  | "clypeus"
  | "shards"
  | "stratum"
  | "concha"
  | "bacterium";

export const PLANT: Record<PlantKind, (c: Ctx, s: number, r: Rnd) => Glint[]> = {
  tussock(c, s, r) {
    const n = 11 + ((r() * 7) | 0);
    for (let i = 0; i < n; i++) {
      const a = (r() - 0.5) * 1.55;
      const len = s * (0.5 + 0.5 * r()) * (1 - 0.28 * Math.abs(a));
      const bw = s * 0.03;
      const bx = (r() - 0.5) * s * 0.16;
      const tx = bx + Math.sin(a) * len + (r() - 0.5) * s * 0.1;
      const ty = -Math.cos(a) * len;
      const qx = bx + Math.sin(a) * len * 0.3;
      const qy = -Math.cos(a) * len * 0.72;
      c.beginPath();
      c.moveTo(bx - bw, 0.5);
      c.quadraticCurveTo(qx - bw, qy, tx, ty);
      c.quadraticCurveTo(qx + bw, qy, bx + bw, 0.5);
      c.fill();
    }
    return [];
  },
  tubus(c, s, r) {
    const n = 3 + ((r() * 3) | 0);
    const g: Glint[] = [];
    for (let i = 0; i < n; i++) {
      const x0 = (i - (n - 1) / 2) * s * 0.17 + (r() - 0.5) * s * 0.05;
      const th = s * (0.55 + 0.65 * r());
      const tw = s * 0.07;
      const lean = (r() - 0.5) * 0.16 * th;
      c.beginPath();
      c.moveTo(x0 - tw * 0.6, 0.5);
      c.lineTo(x0 + lean - tw * 0.5, -th);
      c.lineTo(x0 + lean + tw * 0.5, -th);
      c.lineTo(x0 + tw * 0.6, 0.5);
      c.fill();
      c.beginPath();
      c.ellipse(x0 + lean, -th, tw * 0.95, tw * 0.42, 0, 0, TAU);
      c.fill();
      g.push({ x: x0 + lean, y: -th - tw * 0.1, r: tw * 0.55, e: 0.38 });
    }
    return g;
  },
  cactoida(c, s, r) {
    const g: Glint[] = [];
    c.lineCap = "round";
    c.lineJoin = "round";
    c.lineWidth = s * 0.15;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, -s * 0.92);
    c.stroke();
    g.push({ x: 0, y: -s, r: s * 0.035 });
    const arms = 2 + ((r() * 2) | 0);
    for (let i = 0; i < arms; i++) {
      const side = i % 2 ? 1 : -1;
      const k = 0.25 + r() * 0.3;
      const dx = side * s * (0.24 + r() * 0.1);
      const up = s * (0.25 + r() * 0.25);
      c.lineWidth = s * 0.11;
      c.beginPath();
      c.moveTo(0, -s * k);
      c.quadraticCurveTo(dx, -s * k, dx, -s * k - up);
      c.stroke();
      g.push({ x: dx, y: -s * k - up - s * 0.06, r: s * 0.03 });
    }
    return g;
  },
  fungoida(c, s, r) {
    const n = 2 + ((r() * 2) | 0);
    const g: Glint[] = [];
    for (let i = 0; i < n; i++) {
      const x0 = (i - (n - 1) / 2) * s * 0.42 + (r() - 0.5) * s * 0.1;
      const hh = s * (0.5 + 0.5 * r());
      const lean = (r() - 0.5) * hh * 0.25;
      const rx = hh * 0.4;
      const ry = hh * 0.3;
      c.lineCap = "round";
      c.lineWidth = hh * 0.09;
      c.beginPath();
      c.moveTo(x0, 0);
      c.quadraticCurveTo(x0, -hh * 0.5, x0 + lean, -hh * 0.8);
      c.stroke();
      c.beginPath();
      c.ellipse(x0 + lean, -hh * 0.72, rx, ry, 0, Math.PI, TAU);
      c.quadraticCurveTo(x0 + lean, -hh * 0.62, x0 + lean - rx, -hh * 0.72);
      c.fill();
      g.push({ line: [x0 + lean - rx * 0.8, -hh * 0.7, x0 + lean + rx * 0.8, -hh * 0.7], w: 1 });
    }
    return g;
  },
  brain(c, s, r) {
    c.lineCap = "round";
    c.lineWidth = s * 0.13;
    c.beginPath();
    c.moveTo(0, 0);
    c.quadraticCurveTo(s * 0.04, -s * 0.25, 0, -s * 0.5);
    c.stroke();
    c.beginPath();
    c.arc(0, -s * 0.68, s * 0.28, 0, TAU);
    c.fill();
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU + r();
      const rr = s * (0.13 + r() * 0.06);
      c.beginPath();
      c.arc(Math.cos(a) * s * 0.24, -s * 0.68 + Math.sin(a) * s * 0.2, rr, 0, TAU);
      c.fill();
    }
    const g: Glint[] = [];
    for (let i = 0; i < 3; i++) {
      const y = -s * (0.56 + i * 0.1);
      const x = s * 0.2;
      g.push({ wave: [-x, y, x, y, s * 0.045], w: 0.9 });
    }
    return g;
  },
  frutexa(c, s, r) {
    const g: Glint[] = [];
    c.lineCap = "round";
    const br = (x: number, y: number, a: number, len: number, wd: number, d: number): void => {
      const x2 = x + Math.sin(a) * len;
      const y2 = y - Math.cos(a) * len;
      c.lineWidth = wd;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x2, y2);
      c.stroke();
      if (d === 0) {
        c.beginPath();
        c.arc(x2, y2, wd * 1.5, 0, TAU);
        c.fill();
        if (r() < 0.35) g.push({ x: x2, y: y2, r: wd * 0.9 });
        return;
      }
      br(x2, y2, a - 0.3 - r() * 0.35, len * 0.7, wd * 0.72, d - 1);
      br(x2, y2, a + 0.3 + r() * 0.35, len * 0.7, wd * 0.72, d - 1);
    };
    br(0, 0, (r() - 0.5) * 0.3, s * 0.36, s * 0.07, 3);
    return g;
  },
  aleoida(c, s, r) {
    const n = 7 + ((r() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const a = lerp(-1.25, 1.25, i / (n - 1)) + (r() - 0.5) * 0.12;
      const len = s * (0.55 + 0.3 * r()) * (1 - 0.2 * Math.abs(a));
      const wd = s * 0.11;
      const tx = Math.sin(a) * len;
      const ty = -Math.cos(a) * len;
      const nx = Math.cos(a) * wd;
      const ny = Math.sin(a) * wd;
      const mx = tx * 0.45;
      const my = ty * 0.45;
      c.beginPath();
      c.moveTo(0, 0.5);
      c.quadraticCurveTo(mx - nx, my - ny, tx, ty);
      c.quadraticCurveTo(mx + nx, my + ny, 0, 0.5);
      c.fill();
    }
    c.lineCap = "round";
    c.lineWidth = s * 0.035;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(s * 0.03, -s * 1.02);
    c.stroke();
    return [{ x: s * 0.03, y: -s * 1.04, r: s * 0.05 }];
  },
  osseus(c, s) {
    c.lineCap = "round";
    c.lineWidth = s * 0.1;
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(0, -s * 0.86);
    c.stroke();
    const g: Glint[] = [];
    const shelves: [number, number][] = [
      [0.3, 0.44],
      [0.58, 0.33],
      [0.84, 0.21],
    ];
    for (const [y, rx] of shelves) {
      c.beginPath();
      c.ellipse(0, -s * y, s * rx, s * rx * 0.2, 0, 0, TAU);
      c.fill();
      g.push({ line: [-s * rx * 0.85, -s * y + s * rx * 0.2, s * rx * 0.85, -s * y + s * rx * 0.2], w: 0.7 });
    }
    return g;
  },
  clypeus(c, s, r) {
    const g: Glint[] = [];
    const lobes: [number, number, number][] = [
      [-0.26, -0.28, 0.72],
      [0.02, 0.05, 1],
      [0.3, 0.3, 0.66],
    ];
    for (const [x, rot, k] of lobes) {
      c.save();
      c.translate(s * x, 0);
      c.rotate(rot + (r() - 0.5) * 0.1);
      c.beginPath();
      c.ellipse(0, 0, s * 0.2 * k, s * 0.86 * k, 0, Math.PI, TAU);
      c.fill();
      c.restore();
      g.push({ x: s * x + Math.sin(rot) * s * 0.8 * k, y: -Math.cos(rot) * s * 0.84 * k, r: s * 0.03 });
    }
    return g;
  },
  shards(c, s, r) {
    const n = 5 + ((r() * 3) | 0);
    const g: Glint[] = [];
    for (let i = 0; i < n; i++) {
      const x0 = (i - (n - 1) / 2) * s * 0.15 + (r() - 0.5) * s * 0.06;
      const len = s * (0.45 + 0.6 * r());
      const lean = (i - (n - 1) / 2) * s * 0.07 + (r() - 0.5) * s * 0.1;
      const bw = s * 0.075;
      c.beginPath();
      c.moveTo(x0 - bw, 0.5);
      c.lineTo(x0 + lean - bw * 0.25, -len * 0.82);
      c.lineTo(x0 + lean, -len);
      c.lineTo(x0 + lean + bw * 0.4, -len * 0.78);
      c.lineTo(x0 + bw, 0.5);
      c.fill();
      g.push({ line: [x0, -len * 0.1, x0 + lean, -len * 0.98], w: 0.7 });
    }
    return g;
  },
  stratum(c, s, r) {
    const g: Glint[] = [];
    for (let i = 0; i < 4; i++) {
      const rx = s * (0.95 - i * 0.17);
      const x = (r() - 0.5) * s * 0.2;
      const y = -i * s * 0.11;
      c.beginPath();
      c.ellipse(x, y, rx, rx * 0.16, 0, 0, TAU);
      c.fill();
      if (i) g.push({ line: [x - rx * 0.7, y + rx * 0.1, x + rx * 0.7, y + rx * 0.1], w: 0.6 });
    }
    return g;
  },
  concha(c, s) {
    c.beginPath();
    c.ellipse(0, -s * 0.22, s * 0.46, s * 0.26, 0, 0, Math.PI);
    c.fill();
    c.save();
    c.translate(-s * 0.44, -s * 0.24);
    c.rotate(-0.62);
    c.beginPath();
    c.ellipse(s * 0.44, 0, s * 0.46, s * 0.24, 0, Math.PI, TAU);
    c.fill();
    c.restore();
    return [{ x: s * 0.06, y: -s * 0.3, r: s * 0.13, e: 0.7 }];
  },
  bacterium(c, s, r) {
    const g: Glint[] = [];
    for (let i = 0; i < 12; i++)
      g.push({ x: (r() - 0.5) * s * 1.7, y: 1 + r() * 3 - (r() < 0.25 ? s * 0.12 : 0), r: 0.7 + r() * 1.5, e: 0.5 });
    c.beginPath();
    c.ellipse(0, 0.5, s * 0.8, s * 0.07, 0, 0, TAU);
    c.fill();
    return g;
  },
};

/** How tall each stands against the line-up's size (a Tubus towers, a Stratum is a slab). */
export const PLANT_H: Record<PlantKind, number> = {
  tussock: 0.8,
  tubus: 1.25,
  cactoida: 1,
  fungoida: 0.8,
  brain: 1,
  frutexa: 1.05,
  aleoida: 0.72,
  osseus: 0.85,
  clypeus: 0.8,
  shards: 0.95,
  stratum: 0.34,
  concha: 0.5,
  bacterium: 0.4,
};
