/**
 * M3 Rolling number (owner 2026-11-05): when a number changes, its changed digits roll into place, 100 ms apart (the
 * leftmost first). Before, numbers only flashed (useValueFlash, still used beside this).
 *
 * The text is given already formatted ("1.2M CR", "37 / 112"); every digit is a column 0-9 drawn by CSS (::before, so
 * the page's text, copy and tests read only the number itself, from the hidden copy). Columns are counted from the
 * right, so a number growing a digit keeps its columns. Plain text when the effect is off (Options › Look › Motion ›
 * Rolling numbers, level Full).
 */
import { useEffect, useRef, type CSSProperties } from "react";
import { useFx } from "../motion";
import "./rollingNumber.css";

const STAGGER_MS = 100;

export function RollingNumber({ text, className }: { text: string; className?: string }) {
  const on = useFx("roll");
  // The text last drawn (set after drawing, so a second render of the same change still compares with it).
  const prev = useRef(text);
  const last = prev.current;
  useEffect(() => {
    prev.current = text;
  }, [text]);
  if (!on) return <span className={className}>{text}</span>;

  const chars = [...text];
  const old = [...last];
  // Changed digit columns (from the right), ranked left to right for the delays.
  const changed: number[] = [];
  chars.forEach((c, i) => {
    const fromRight = chars.length - 1 - i;
    if (/\d/.test(c) && old[old.length - 1 - fromRight] !== c) changed.push(fromRight);
  });
  return (
    <span className={`roll-num${className ? ` ${className}` : ""}`}>
      <span className="roll-num__text">{text}</span>
      <span className="roll-num__digits" aria-hidden="true">
        {chars.map((c, i) => {
          const fromRight = chars.length - 1 - i;
          if (!/\d/.test(c)) return <span key={`c${fromRight}`} className="roll-char" data-c={c} />;
          const rank = changed.indexOf(fromRight);
          const style = { "--d": c, "--roll-delay": `${Math.max(0, rank) * STAGGER_MS}ms` } as CSSProperties;
          return <span key={`d${fromRight}`} className="roll-digit" style={style} />;
        })}
      </span>
    </span>
  );
}
