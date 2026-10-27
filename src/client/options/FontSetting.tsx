/**
 * Options › Look › Font (owner, 2026-10-27): Bahnschrift, as always, or the EDEXO font. Kept per PC (every window of
 * the app, the launcher and the HUD follow).
 */
import { useSyncExternalStore } from "react";
import { FoldPanel } from "../ui/Fold";
import { setUiFont, uiFont, UI_FONT_EVENT, type UiFont } from "../uiFont";

const FONTS: { font: UiFont; label: string; note: string }[] = [
  { font: "classic", label: "Classic", note: "Bahnschrift, the Windows face the app has always used" },
  { font: "edexo", label: "EDEXO", note: "the app's own face: wider, squarer, the same on every PC (preview)" },
];

function useUiFont(): UiFont {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener(UI_FONT_EVENT, cb);
      return () => window.removeEventListener(UI_FONT_EVENT, cb);
    },
    uiFont,
    () => "classic",
  );
}

export function FontSetting() {
  const font = useUiFont();
  const current = FONTS.find((f) => f.font === font) ?? FONTS[0]!;
  return (
    <FoldPanel
      foldKey="options-font"
      defaultOpen={false}
      className="options-meta-block"
      title="Font"
      summary={current.label}
      help={
        <p>
          The typeface of the app, the launcher and the HUD. <strong>Classic</strong> is Bahnschrift, which comes with
          Windows. <strong>EDEXO</strong> is the app&apos;s own, drawn for it: squarer and wider, with a dotted zero, and
          the same on every PC (Bahnschrift is missing on Linux). It is a preview: some text sits a little wider.
        </p>
      }
    >
      <div className="options-oneline" role="radiogroup" aria-label="Font">
        {FONTS.map((f) => (
          <button
            key={f.font}
            type="button"
            role="radio"
            aria-checked={font === f.font}
            className={`btn-top-toggle${font === f.font ? " btn-top-toggle--on" : ""}`}
            title={f.note}
            onClick={() => setUiFont(f.font)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <p className="dim tiny" style={{ marginBottom: 0 }}>
        {current.label}: {current.note}.
      </p>
    </FoldPanel>
  );
}
