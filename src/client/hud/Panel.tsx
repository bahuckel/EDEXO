/*
  The HUD panel: the chosen sections in order, inside #hud, with the fill layer under them and the optional credit
  line above or below. Each section is a <section class="hud-section hud-section--NAME" data-section="NAME">, its
  state colour and its "only when relevant" idle class on it — the markup public/hud/main.js built, so hud.css and
  everything that reads the page stayed as they were.
*/
import { memo, useLayoutEffect, useRef, type ReactNode } from "react";
import type { HudSnapshot } from "./types";
import { PHONE, creditPlace, pref } from "./theme";
import type { HudSection } from "./parts";
import { useLiveRev, usePrefsRev, useSnapshot, useTickRev } from "./store";

/*
  "Only when relevant" (guild tester report, 2026-09-30; opt-in). A section with a `relevant(d)` rule steps aside
  while the rule says no, and comes back the moment it says yes. It waits five seconds before stepping aside, so a
  value that flickers for a frame does not make the HUD blink. Sections without a rule (next jump, data value,
  achievement) always stay. The phone picks its sections with its chips and ignores this.
*/
export const RELEVANT_HOLD_MS = 5000;
export function relevantOn(): boolean {
  return !PHONE && pref("edexoHudRelevant", "0") === "1";
}

function relevantNow(
  sections: Record<string, HudSection>,
  list: string[],
  d: HudSnapshot | null,
  now: number,
  lastRelevantAt: Record<string, number>,
): Record<string, boolean> {
  const on = relevantOn();
  const shown: Record<string, boolean> = {};
  for (const n of list) {
    const rule = sections[n]!.relevant;
    if (!on || typeof rule !== "function" || !d) {
      shown[n] = true;
      continue;
    }
    let yes = false;
    try {
      yes = !!rule(d);
    } catch {
      yes = true;
    }
    if (yes || lastRelevantAt[n] === undefined) lastRelevantAt[n] = yes ? now : now - RELEVANT_HOLD_MS;
    shown[n] = yes || now - lastRelevantAt[n]! < RELEVANT_HOLD_MS;
  }
  return shown;
}

/*
  State colours: a single-section page retints its whole panel (frame included) the way the cockpit does; in the
  merged HUD only the section itself retints, so a finished discovery scan does not paint the sample tracker blue
  for the rest of the visit.
*/
const SectionHost = memo(function SectionHost({
  sections,
  name,
  d,
  idle,
  single,
}: {
  sections: Record<string, HudSection>;
  name: string;
  d: HudSnapshot | null;
  idle: boolean;
  single: boolean;
  /** Changes on what makes this section draw again (a tick, a radar frame, a settings change). */
  rev: string;
}) {
  const sec = sections[name]!;
  let state: ReturnType<NonNullable<HudSection["state"]>> = null;
  try {
    state = d && sec.state ? sec.state(d) : null;
  } catch {
    /* one broken section must not take the others down */
  }
  /*
    A one-section page wears its section's state on the whole panel. Cleared as well when the page stops being one:
    the phone's set changes in place, and a panel left blue from one Discovery scan turned every section blue
    (owner, 2026-10-15).
  */
  useLayoutEffect(() => {
    const whole = single ? state : null;
    const shell = document.querySelector(".shell");
    const panel = document.querySelector(".panel");
    shell?.classList.toggle("shell--ok", whole === "ok");
    shell?.classList.toggle("shell--warn", whole === "warn");
    panel?.classList.toggle("panel--ok", whole === "ok");
    panel?.classList.toggle("panel--warn", whole === "warn");
  });
  let content: ReactNode = null;
  try {
    // Before the first snapshot a section shows its waiting state, as the old markup did.
    content = d ? sec.render(d) : sec.initial ? sec.initial() : sec.render({});
  } catch {
    /* one broken section must not take the others down */
  }
  return (
    <section
      className={`hud-section hud-section--${name}${idle ? " hud-section--idle" : ""}${state ? ` hud-section--${state}` : ""}`}
      data-section={name}
    >
      {content}
    </section>
  );
});

function Credit({ bottom }: { bottom: boolean }) {
  return (
    <section
      id="hudCredit"
      className={"hud-section hud-section--credit" + (bottom ? " hud-section--credit-bottom" : "")}
      aria-label="HUD Overlay by EDEXO-Compare"
    >
      <div className="hud-head">
        <span className="hud-title">HUD Overlay by EDEXO-Compare</span>
      </div>
    </section>
  );
}

export function Panel({
  sections,
  list,
  onIdle,
  onRendered,
}: {
  sections: Record<string, HudSection>;
  list: string[];
  /** Nothing on this page to show: the host takes the window out of the stack (main.tsx). */
  onIdle: (idle: boolean) => void;
  /** After every commit: the page tells the host window how tall it is. */
  onRendered: () => void;
}) {
  const d = useSnapshot();
  const tick = useTickRev();
  const live = useLiveRev();
  const prefs = usePrefsRev();
  const lastRelevantAt = useRef<Record<string, number>>({});
  const shown = relevantNow(sections, list, d, Date.now(), lastRelevantAt.current);
  const idle = !list.some((n) => shown[n]);
  const single = list.length === 1;
  useLayoutEffect(() => {
    onIdle(idle);
    onRendered();
  });
  const credit = creditPlace();
  return (
    <>
      <div className="panel__fill" aria-hidden="true" />
      {credit === "top" ? <Credit bottom={false} /> : null}
      {list.map((n) => {
        const sec = sections[n]!;
        const rev = `${prefs}|${sec.ticks ? tick : 0}|${sec.live ? live : 0}`;
        return (
          <SectionHost
            key={n}
            sections={sections}
            name={n}
            d={d}
            idle={!shown[n]}
            single={single}
            rev={rev}
          />
        );
      })}
      {credit === "bottom" ? <Credit bottom /> : null}
    </>
  );
}
