/**
 * Options › Look › Interface style (2026-11-16): the app drawn as Classic, Holo or Nebula (uiStyle.ts). Kept per PC.
 */
import { FoldPanel } from "../ui/Fold";
import { UI_STYLES, setUiStyle, useUiStyle } from "../uiStyle";

export function InterfaceStyleSetting() {
  const style = useUiStyle();
  const current = UI_STYLES.find((s) => s.style === style) ?? UI_STYLES[0]!;
  return (
    <FoldPanel
      foldKey="options-interface-style"
      defaultOpen={false}
      className="options-meta-block"
      title="Interface style"
      summary={current.label}
      help={
        <p>
          How the app is drawn; the colour scheme still sets the colour. <strong>Classic</strong> is flat panels with
          a thin frame. <strong>Holo</strong> is a cockpit hologram: corner brackets instead of boxes, glowing titles,
          scan lines. <strong>Nebula</strong> is glass over a coloured sky. Kept on this PC.
        </p>
      }
    >
      <div className="options-oneline" role="radiogroup" aria-label="Interface style">
        {UI_STYLES.map((s) => (
          <button
            key={s.style}
            type="button"
            role="radio"
            aria-checked={style === s.style}
            className={`btn-top-toggle${style === s.style ? " btn-top-toggle--on" : ""}`}
            title={s.note}
            onClick={() => setUiStyle(s.style)}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="dim tiny" style={{ marginBottom: 0 }}>
        {current.label}: {current.note}.
      </p>
    </FoldPanel>
  );
}
