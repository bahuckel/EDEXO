/**
 * Options › Look › Header picture (plan-1.4.0 §6.3): the artwork behind the header, from the whole turning picture
 * down to none. Kept per PC (every window of the app follows).
 */
import { HEADER_ART_MODES, setHeaderArtMode, useHeaderArtMode } from "../headerArt/mode";
import { useMotionLevel } from "../motion";
import { FoldPanel } from "../ui/Fold";

export function HeaderPictureSetting() {
  const mode = useHeaderArtMode();
  const motion = useMotionLevel();
  const current = HEADER_ART_MODES.find((m) => m.mode === mode) ?? HEADER_ART_MODES[0]!;
  return (
    <FoldPanel
      foldKey="options-header-picture"
      defaultOpen={false}
      className="options-meta-block"
      title="Header picture"
      summary={current.label}
      help={
        <p>
          The picture behind the top of the app: the surface of a planet under its sky, in the colour scheme&apos;s
          colours. Its skyline is the system&apos;s own, its land follows the kind of body on show (icy, rocky,
          metal-rich), and the plants standing on it are the genera the app expects or has found on that body: a
          body without biology is bare ground. <strong>Turning</strong> lets the sky turn once in 30 minutes;{" "}
          <strong>Still</strong> keeps the picture and stops the sky; <strong>Calm</strong> leaves stars and a low
          line of ground; <strong>Off</strong> shows no picture.
        </p>
      }
    >
      <div className="options-oneline" role="radiogroup" aria-label="Header picture">
        {HEADER_ART_MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={mode === m.mode}
            className={`btn-top-toggle${mode === m.mode ? " btn-top-toggle--on" : ""}`}
            title={m.note}
            onClick={() => setHeaderArtMode(m.mode)}
          >
            {m.label}
          </button>
        ))}
      </div>
      <p className="dim tiny" style={mode === "turning" && motion !== "full" ? undefined : { marginBottom: 0 }}>
        {current.label}: {current.note}.
      </p>
      {mode === "turning" && motion !== "full" ? (
        <p className="dim tiny" style={{ marginBottom: 0 }}>
          The sky turns under Motion: Full only; it stands still now.
        </p>
      ) : null}
    </FoldPanel>
  );
}
