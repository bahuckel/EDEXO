/**
 * Options › Look › Motion (R3b, 2026-10-23): how much the app moves. Kept per PC (every window of the app follows).
 * The effects below the level (owner 2026-11-05) each have their own switch; they play only under Full.
 */
import { FoldPanel } from "../ui/Fold";
import {
  MOTION_FX,
  setFxSwitchedOn,
  setMotionLevel,
  useFxSwitch,
  useMotionLevel,
  type MotionFx,
  type MotionLevel,
} from "../motion";

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
          show fewer animations); <strong>Off</strong> makes every change instant. The effects below (a button press,
          the explanations opening, rolling numbers, the loaded tick, dragging the launcher&apos;s HUD order, pulling a
          list to refresh it) can each be switched off; they play under Full only.
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
      <p className="dim tiny">
        {current.label}: {current.note}.
      </p>
      <div className="options-motion-fx" role="group" aria-label="Motion effects">
        {MOTION_FX.map((f) => (
          <FxSwitch key={f.fx} fx={f.fx} label={f.label} note={f.note} off={level !== "full"} />
        ))}
      </div>
      {level !== "full" ? (
        <p className="dim tiny" style={{ marginBottom: 0 }}>
          The effects play under Full only.
        </p>
      ) : null}
    </FoldPanel>
  );
}

function FxSwitch({ fx, label, note, off }: { fx: MotionFx; label: string; note: string; off: boolean }) {
  const on = useFxSwitch(fx);
  return (
    <label className={`options-motion-fx__row${off ? " dim" : ""}`} title={note}>
      <input type="checkbox" checked={on} onChange={(ev) => setFxSwitchedOn(fx, ev.target.checked)} /> {label}
      <span className="dim tiny"> · {note}</span>
    </label>
  );
}
