/**
 * The Laboratory's crafting view (owner, 2026-10-15: "more like a 'Crafting screen' in some game, dedicated cards for
 * basic/standard/premium, connected to materials with lines, a 'backpack' icon with how many the user has and a gear
 * icon showing how much he can craft").
 *
 * The kind's materials stand in a column, each with what is aboard of it (backpack) out of its cap; the three recipe
 * cards stand beside them, each with how many the materials aboard make (gear) and what one more lacks. A line joins
 * every material to every recipe that takes it, the amount on it: green where what is aboard covers one, red where it
 * does not. Hover a card or a material and its lines light up, the rest dim. The lines are measured off the laid-out
 * nodes, so the column wraps and scales like the rest of the drawer.
 *
 * {@link CraftGraph} is the screen itself; the Jumponium and AFM tabs feed it here, the Guardian tab in GuardianLab.tsx
 * (owner, 2026-11-04: the Guardian tab "needs to be redone in the same way the AFM and Jumponium refills are done").
 */
import { useLayoutEffect, useRef, useState } from "react";
import { elementsOf, jumpElement, type JumponiumDTO, type LabKind } from "@shared/jumponium";
import { Backpack, Cog, ShoppingCart } from "lucide-react";

/** A material node: `held` null for what is bought at a market (cargo, not counted). */
export interface CraftMat {
  key: string;
  /** The node's face: an element symbol, or a short name (`named` on the graph). */
  sym: string;
  label: string;
  held: number | null;
  cap: number;
}
export interface CraftCard {
  id: string;
  name: string;
  bonus?: string;
  count: number;
  /** What one more lacks, already worded ("Nb 2, As 1"). */
  next?: string;
  recipe: { key: string; qty: number }[];
}

interface Line {
  mat: string;
  card: string;
  qty: number;
  state: "ok" | "short" | "buy";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function CraftGraph({ mats, cards, named = false }: { mats: CraftMat[]; cards: CraftCard[]; named?: boolean }) {
  const held = new Map(mats.map((m) => [m.key, m]));
  const box = useRef<HTMLDivElement>(null);
  const matRefs = useRef(new Map<string, HTMLElement>());
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hot, setHot] = useState<{ mat?: string; card?: string } | null>(null);
  // What is drawn changes with the nodes; a key of them keeps the effect from running on every parent render.
  const shape = `${mats.map((m) => `${m.key}:${m.held}`).join(",")}|${cards.map((c) => `${c.id}:${c.count}`).join(",")}`;

  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const measure = () => {
      const r = root.getBoundingClientRect();
      const out: Line[] = [];
      for (const c of cards) {
        const card = cardRefs.current.get(c.id)?.getBoundingClientRect();
        if (!card) continue;
        const n = c.recipe.length;
        c.recipe.forEach((ing, i) => {
          const m = matRefs.current.get(ing.key)?.getBoundingClientRect();
          if (!m) return;
          const h = held.get(ing.key)?.held;
          out.push({
            mat: ing.key,
            card: c.id,
            qty: ing.qty,
            state: h == null ? "buy" : h >= ing.qty ? "ok" : "short",
            x1: m.right - r.left,
            y1: m.top + m.height / 2 - r.top,
            x2: card.left - r.left,
            // The ends spread down the card's edge, so a card's lines do not meet in one point.
            y2: card.top - r.top + (card.height * (i + 1)) / (n + 1),
          });
        });
      }
      setLines(out);
      setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => ro.disconnect();
    // `shape` stands for the nodes; the maps are refs filled during render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  const lit = (l: Line) => !hot || hot.mat === l.mat || hot.card === l.card;

  return (
    <div className={`lab-craft${named ? " lab-craft--named" : ""}`} ref={box} onMouseLeave={() => setHot(null)}>
      <svg className="lab-craft__lines" width={size.w} height={size.h} aria-hidden="true">
        {lines.map((l) => {
          const mx = (l.x1 + l.x2) / 2;
          return (
            <g key={`${l.mat}-${l.card}`} className={`lab-craft__line is-${l.state}${lit(l) ? "" : " is-dim"}`}>
              <path d={`M${l.x1} ${l.y1} C${mx} ${l.y1} ${mx} ${l.y2} ${l.x2} ${l.y2}`} />
              {l.qty > 1 ? (
                <text x={l.x2 - 6} y={l.y2 - 3} textAnchor="end">
                  ×{l.qty}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <ul className="lab-craft__mats" aria-label="Materials">
        {mats.map((m) => {
          const feeds = cards.filter((c) => c.recipe.some((x) => x.key === m.key));
          const short = m.held != null && feeds.some((c) => c.recipe.some((x) => x.key === m.key && (m.held ?? 0) < x.qty));
          return (
            <li
              key={m.key}
              ref={(n) => {
                if (n) matRefs.current.set(m.key, n);
                else matRefs.current.delete(m.key);
              }}
              className={`lab-craft__mat${short ? " is-short" : ""}${m.held == null ? " is-buy" : ""}${hot?.mat === m.key ? " is-hot" : ""}`}
              onMouseEnter={() => setHot({ mat: m.key })}
              title={
                m.held == null
                  ? `${m.label}: a commodity, bought at a market, for ${feeds.map((c) => c.name).join(", ")}`
                  : `${m.label}: ${m.held} of ${m.cap} aboard, for ${feeds.map((c) => c.name).join(", ")}`
              }
            >
              <b className="lab-craft__sym">{m.sym}</b>
              {m.held == null ? (
                <span className="lab-craft__held lab-craft__held--buy">
                  <ShoppingCart size={14} strokeWidth={1.8} aria-hidden="true" />
                  buy
                </span>
              ) : (
                <span className="lab-craft__held">
                  <Backpack size={14} strokeWidth={1.8} aria-hidden="true" />
                  {m.held}
                  <span className="dim">/{m.cap}</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <ul className="lab-craft__cards" aria-label="Recipes">
        {cards.map((c) => (
          <li
            key={c.id}
            ref={(n) => {
              if (n) cardRefs.current.set(c.id, n);
              else cardRefs.current.delete(c.id);
            }}
            className={`lab-craft__card${c.count ? "" : " is-none"}${hot?.card === c.id ? " is-hot" : ""}`}
            onMouseEnter={() => setHot({ card: c.id })}
          >
            <span className="lab-craft__tier">{c.name}</span>
            {c.bonus ? <span className="lab-craft__bonus">{c.bonus}</span> : null}
            <span className="lab-craft__make" title={`The materials aboard make ${c.count}`}>
              <Cog size={14} strokeWidth={1.8} aria-hidden="true" />
              {c.count}
            </span>
            {c.next ? <span className="lab-craft__next">next: {c.next}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Jumponium and AFM tabs' crafting screen. */
export function LabCrafting({ stock, kind }: { stock: JumponiumDTO; kind: LabKind }) {
  const tiers = kind === "fsd" ? stock.tiers : stock.afmTiers;
  const held = new Map(stock.stock.map((s) => [s.key, s]));
  const mats: CraftMat[] = elementsOf(kind).map((k) => {
    const e = jumpElement(k);
    const s = held.get(k);
    return { key: k, sym: e.symbol, label: e.label, held: s?.count ?? 0, cap: s?.cap ?? 0 };
  });
  const cards: CraftCard[] = tiers.map((t) => ({
    id: t.tier,
    name: t.name,
    bonus: t.bonus,
    count: t.count,
    next: t.short.length ? t.short.map((x) => `${x.symbol} ${x.need}`).join(", ") : undefined,
    recipe: t.recipe,
  }));
  return <CraftGraph mats={mats} cards={cards} />;
}
