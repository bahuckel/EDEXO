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
 */
import { useLayoutEffect, useRef, useState } from "react";
import { elementsOf, jumpElement, type JumpElement, type JumponiumDTO, type LabKind } from "@shared/jumponium";
import { Backpack, Cog } from "lucide-react";

interface Line {
  el: JumpElement;
  tier: string;
  qty: number;
  ok: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function LabCrafting({ stock, kind }: { stock: JumponiumDTO; kind: LabKind }) {
  const tiers = kind === "fsd" ? stock.tiers : stock.afmTiers;
  const held = new Map(stock.stock.map((s) => [s.key, s]));
  const els = elementsOf(kind);
  const box = useRef<HTMLDivElement>(null);
  const matRefs = useRef(new Map<JumpElement, HTMLElement>());
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [lines, setLines] = useState<Line[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hot, setHot] = useState<{ el?: JumpElement; tier?: string } | null>(null);

  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    const measure = () => {
      const r = root.getBoundingClientRect();
      const out: Line[] = [];
      for (const t of tiers) {
        const card = cardRefs.current.get(t.tier)?.getBoundingClientRect();
        if (!card) continue;
        const n = t.recipe.length;
        t.recipe.forEach((ing, i) => {
          const m = matRefs.current.get(ing.key)?.getBoundingClientRect();
          if (!m) return;
          out.push({
            el: ing.key,
            tier: t.tier,
            qty: ing.qty,
            ok: (held.get(ing.key)?.count ?? 0) >= ing.qty,
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
    // The stock and the kind change what is drawn; the maps are refs filled during render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stock, kind]);

  const lit = (l: Line) => !hot || hot.el === l.el || hot.tier === l.tier;

  return (
    <div className="lab-craft" ref={box} onMouseLeave={() => setHot(null)}>
      <svg className="lab-craft__lines" width={size.w} height={size.h} aria-hidden="true">
        {lines.map((l) => {
          const mx = (l.x1 + l.x2) / 2;
          return (
            <g key={`${l.el}-${l.tier}`} className={`lab-craft__line${l.ok ? " is-ok" : " is-short"}${lit(l) ? "" : " is-dim"}`}>
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
        {els.map((k) => {
          const e = jumpElement(k);
          const s = held.get(k);
          const feeds = tiers.filter((t) => t.recipe.some((x) => x.key === k));
          const short = feeds.some((t) => t.recipe.some((x) => x.key === k && (s?.count ?? 0) < x.qty));
          return (
            <li
              key={k}
              ref={(n) => {
                if (n) matRefs.current.set(k, n);
                else matRefs.current.delete(k);
              }}
              className={`lab-craft__mat${short ? " is-short" : ""}${hot?.el === k ? " is-hot" : ""}`}
              onMouseEnter={() => setHot({ el: k })}
              title={`${e.label}: ${s?.count ?? 0} of ${s?.cap ?? 0} aboard, for ${feeds.map((t) => t.name).join(", ")}`}
            >
              <b className="lab-craft__sym">{e.symbol}</b>
              <span className="lab-craft__held">
                <Backpack size={14} strokeWidth={1.8} aria-hidden="true" />
                {s?.count ?? 0}
                <span className="dim">/{s?.cap ?? 0}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <ul className="lab-craft__cards" aria-label="Recipes">
        {tiers.map((t) => (
          <li
            key={t.tier}
            ref={(n) => {
              if (n) cardRefs.current.set(t.tier, n);
              else cardRefs.current.delete(t.tier);
            }}
            className={`lab-craft__card${t.count ? "" : " is-none"}${hot?.tier === t.tier ? " is-hot" : ""}`}
            onMouseEnter={() => setHot({ tier: t.tier })}
          >
            <span className="lab-craft__tier">{t.name}</span>
            {t.bonus ? <span className="lab-craft__bonus">{t.bonus}</span> : null}
            <span className="lab-craft__make" title={`The materials aboard make ${t.count}`}>
              <Cog size={14} strokeWidth={1.8} aria-hidden="true" />
              {t.count}
            </span>
            {t.short.length ? (
              <span className="lab-craft__next">next: {t.short.map((x) => `${x.symbol} ${x.need}`).join(", ")}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
