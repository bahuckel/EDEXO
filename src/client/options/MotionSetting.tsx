/**
 * Options › Look › Motion (R3b, 2026-10-23): how much the app moves. Kept per PC (every window of the app follows).
 */
import { FoldPanel } from "../ui/Fold";
import { setMotionLevel, useMotionLevel, type MotionLevel } from "../motion";

const LEVELS: { level: MotionLevel; label: string; note: string }[] = [
  { level: "full", label: "Full", note: "panels, pop-ups and menus fade and slide in and out; moved rows slide" },
  { level: "reduced", label: "Reduced", note: "fades only, nothing slides" },
  { level: "off", label: "Off", note: "every change is instant" },
];

export function MotionSetting() {
  const level = useMotionLevel();
  const current = LEVELS.find((l) => l.level === level) ?? LEVELS[0]!;
  return (
    <FoldPanel
      foldKey="options-motion"
      defaultOpen={false}
      className="options-meta-block"
      title="Motion"
      summary={current.label}
      help={
        <p>
          How screens, pop-ups, menus and lists change. <strong>Full</strong> fades and slides them over a fifth of a
          second; <strong>Reduced</strong> keeps the fades and drops the movement (the default when Windows is set to
          show fewer animations); <strong>Off</strong> makes every change instant.
        </p>
      }
    >
      <div className="options-oneline" role="radiogroup" aria-label="Motion">
        {LEVELS.map((l) => (
          <button
            key={l.level}
            type="button"
            role="radio"
            aria-checked={level === l.level}
            className={`btn-top-toggle${level === l.level ? " btn-top-toggle--on" : ""}`}
            title={l.note}
            onClick={() => setMotionLevel(l.level)}
          >
            {l.label}
          </button>
        ))}
      </div>
      <p className="dim tiny" style={{ marginBottom: 0 }}>
        {current.label}: {current.note}.
      </p>
    </FoldPanel>
  );
}
