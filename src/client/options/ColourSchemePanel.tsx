/**
 * Options: the colour scheme and Tab view (moved out of OptionsPanels.tsx, audit 2026-10-22).
 */
import { tabStore, useTabState } from "../tabs/tabStore";
import { readBackdropOn, setBackdropOn } from "../HexSignals";
import { FoldPanel } from "../ui/Fold";
import { APP_THEME_PRESETS, resolveAppTheme, rgbToHex, type AppThemeChoice, type SavedAppTheme } from "@shared/appThemes";
import {
  readAppContrast,
  readAppTheme,
  readSavedThemes,
  setAppContrast,
  setAppTheme,
  writeSavedThemes,
  type AppContrast,
} from "../appTheme";
import { useState } from "react";

/**
 * The app's colour scheme (guild tester report, 2026-09-30): presets to pick from, a colour of your
 * own, and your own saved under a name. Everything drawn in the accent follows; colours that mean
 * something (live green, done blue, warnings, rarity, the ×5 badge) stay as they are. Per device.
 */
export function ColourSchemePanel() {
  const [choice, setChoice] = useState<AppThemeChoice>(() => readAppTheme());
  const [backdrop, setBackdrop] = useState(readBackdropOn);
  const [saved, setSaved] = useState<SavedAppTheme[]>(() => readSavedThemes());
  const [name, setName] = useState("");
  const current = resolveAppTheme(choice);
  const [contrast, setContrast] = useState<AppContrast>(() => readAppContrast());
  const changeContrast = (c: AppContrast) => {
    setContrast(c);
    setAppContrast(c);
  };
  const lifted = contrast.readable && resolveAppTheme(choice, { readable: true }).lifted === true;
  const currentHex = "custom" in choice ? choice.custom : rgbToHex(current.rgb);
  const pick = (c: AppThemeChoice) => {
    setChoice(c);
    setAppTheme(c);
  };
  const isOn = (c: AppThemeChoice) => JSON.stringify(c) === JSON.stringify(choice);
  const save = () => {
    const n = name.trim().slice(0, 24);
    if (!n) return;
    const next = [...saved.filter((s) => s.name.toLowerCase() !== n.toLowerCase()), { name: n, hex: currentHex }];
    setSaved(next);
    writeSavedThemes(next);
    pick({ custom: currentHex, name: n });
    setName("");
  };
  const remove = (n: string) => {
    const next = saved.filter((s) => s.name !== n);
    setSaved(next);
    writeSavedThemes(next);
  };
  const presetLabel = APP_THEME_PRESETS.find((p) => p.key === current.key)?.label;
  return (
    <FoldPanel
      foldKey="options-colour-scheme"
      defaultOpen={false}
      className="options-meta-block"
      title="Colour scheme"
      summary={presetLabel ?? ("name" in choice && choice.name ? choice.name : "Your own")}
      help={
        <p>
          The app&apos;s accent colour. Colours that mean something keep theirs whatever you pick: green for the live
          sampling run, blue for done, red and yellow for warnings, the rarity colours, the planet-type colours and the ×5 badge. The panels and text take a tint of your colour too. The HUD overlays
          have their own colours, in the launcher&apos;s Overlays settings. Kept on this device.
        </p>
      }
    >
      <div className="theme-swatches" role="radiogroup" aria-label="Colour scheme">
        {APP_THEME_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            role="radio"
            aria-checked={isOn({ preset: p.key })}
            className={`theme-swatch${isOn({ preset: p.key }) ? " theme-swatch--on" : ""}`}
            style={{ ["--swatch" as string]: `rgb(${p.rgb})` }}
            title={p.label}
            onClick={() => pick({ preset: p.key })}
          >
            <span className="theme-swatch__dot" />
            {p.label}
          </button>
        ))}
        {saved.map((s) => (
          <span key={s.name} className="theme-saved">
            <button
              type="button"
              role="radio"
              aria-checked={isOn({ custom: s.hex, name: s.name })}
              className={`theme-swatch${isOn({ custom: s.hex, name: s.name }) ? " theme-swatch--on" : ""}`}
              style={{ ["--swatch" as string]: s.hex }}
              onClick={() => pick({ custom: s.hex, name: s.name })}
            >
              <span className="theme-swatch__dot" />
              {s.name}
            </button>
            <button type="button" className="theme-saved__x" title={`Forget "${s.name}"`} onClick={() => remove(s.name)}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="theme-custom">
        <label>
          <span className="dim">Your own colour</span>{" "}
          <input type="color" value={currentHex} onChange={(ev) => pick({ custom: ev.target.value })} />
        </label>
        <input
          className="theme-name"
          value={name}
          maxLength={24}
          placeholder="Name it to keep it"
          onChange={(ev) => setName(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === "Enter") save();
          }}
        />
        <button type="button" className="btn-top-toggle" disabled={!name.trim()} onClick={save}>
          Save scheme
        </button>
      </div>
      {/* Readability (owner, 2026-10-13: a dark colour made text, checkmarks and the rest unreadable). */}
      <label
        className="options-toggle"
        title="A colour too dark to read on the black page (under 4.5 : 1 contrast) is drawn lighter, the same hue: text, checkmarks, chips and borders stay readable. Off draws your colour exactly as picked."
      >
        <input
          type="checkbox"
          checked={contrast.readable}
          onChange={(ev) => changeContrast({ ...contrast, readable: ev.target.checked })}
        />
        <span>Keep it readable (lighten a dark colour)</span>
      </label>
      {lifted ? <p className="dim tiny">This colour is too dark to read on the page: it is drawn lighter, in the same hue.</p> : null}
      <div className="theme-custom">
        <label className="options-toggle" title="Off: the text takes the scheme's own tint. On: the colour you pick, with its dimmer shades for secondary text.">
          <input
            type="checkbox"
            checked={contrast.text != null}
            onChange={(ev) => changeContrast({ ...contrast, text: ev.target.checked ? (contrast.text ?? "#ffffff") : null })}
          />
          <span>Text colour of my own</span>
        </label>
        {contrast.text != null ? (
          <input
            type="color"
            value={contrast.text}
            aria-label="Text colour"
            onChange={(ev) => changeContrast({ ...contrast, text: ev.target.value })}
          />
        ) : (
          <span className="dim tiny">auto: the scheme&apos;s</span>
        )}
      </div>
      <label
        className="options-toggle"
        title="The slow glimmer and signals over the hexagon grid behind the app. Off leaves the grid still. Kept on this device."
      >
        <input
          type="checkbox"
          checked={backdrop}
          onChange={(ev) => {
            setBackdrop(ev.target.checked);
            setBackdropOn(ev.target.checked);
          }}
        />
        <span>Animated background</span>
      </label>
      <TabViewToggle />
    </FoldPanel>
  );
}

/**
 * Tab view (owner, 2026-10-06, tabs/tabStore.ts): the big screens open as tabs beside Main instead of
 * pop-ups. On by default, in the app and in the browser; kept on this device.
 */
function TabViewToggle() {
  const st = useTabState();
  return (
    <label
      className="options-toggle"
      title="Galaxy map, Boxels, My discoveries, Encyclopedia, Achievements, Statistics, Bookmarks, Points of interest, Carriers, Unfinished business and the Session log open as tabs beside Main, instead of pop-ups over it. Off, they open as they always did. Kept on this device."
    >
      <input type="checkbox" checked={st.on} onChange={(ev) => tabStore.setOn(ev.target.checked)} />
      <span>Tab view — screens open as tabs</span>
    </label>
  );
}
