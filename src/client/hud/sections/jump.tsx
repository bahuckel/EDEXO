import { Fragment, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { HudSnapshot } from "../types";
import { api, esc } from "../core";
import { pref } from "../theme";
import { FuelPump, Head, type HudSection } from "../parts";

/* ============================================================== Next jump ==================== */
/*
  StarClass from `StartJump`. Scoopable main-sequence classes are the game's KGBFOAM rule; the
  rest earns a yellow triangle (no fuel there), a black hole a red one, a neutron star a blue one
  for those who boost. Everything else the journal can write (white dwarfs, T Tauri, Herbig,
  Wolf-Rayet, carbon stars) is simply "not scoopable".
*/
export function starKind(cls: string | null | undefined): { kind: string; label: string; note: string } {
  const c = String(cls || "").toUpperCase();
  if (!c) return { kind: "unknown", label: "?", note: "Star class unknown" };
  if (c === "H" || c === "SUPERMASSIVEBLACKHOLE")
    return {
      kind: "hole",
      label: c === "H" ? "Black hole" : "Supermassive black hole",
      note: "Black hole — no scoop, drop out early",
    };
  if (c === "N") return { kind: "neutron", label: "Neutron star", note: "Neutron star — jet cone boost, no scoop" };
  if (/^[KGBFOAM]$/.test(c)) return { kind: "scoop", label: c + " class", note: "Scoopable" };
  return { kind: "noscoop", label: c, note: "Not scoopable" };
}

type JumpTarget = NonNullable<HudSnapshot["jumpTarget"]> & {
  source?: string;
  discoveredByYou?: boolean;
  likelyFirstFootfall?: boolean | null;
};

/*
  Who has been to the system ahead (owner, 2026-10-06; it read "nobody has been here"): Undiscovered in
  light green, Discovered in dark orange-red, Discovered by you in blue, each with a shadow so it reads
  on a green-tinted custom HUD. Undiscovered / Discovered come from EDSM (server/firstFootfallLookup.ts:
  no answer yet shows nothing); "by you" from the commander's journals. Only before arriving.
*/
function Discovered({ jt }: { jt: JumpTarget | null }) {
  let label: string | null = null;
  let kind = "";
  if (jt && jt.starSystem && !jt.arrived) {
    if (jt.discoveredByYou) {
      label = "Discovered by you";
      kind = "you";
    } else if (jt.likelyFirstFootfall === true) {
      label = "Undiscovered";
      kind = "new";
    } else if (jt.likelyFirstFootfall === false) {
      label = "Discovered";
      kind = "known";
    }
  }
  return (
    <div className={"jump__disc" + (kind ? " jump__disc--" + kind : "")} data-f="disc" hidden={!label}>
      {label || ""}
    </div>
  );
}

/*
  "Next boxel" (plan 2.7, 2026-10-11): the expedition planner's best boxel within 500 ly by first-footfall
  credits per jump, one line under the jump. Off unless chosen in the launcher (edexoHudNextBoxel), like the
  credit line. Asked once per system the ship is in, with light=1: it never makes the server load the galaxy
  index for a HUD line. A failed ask (no position yet, a server error) is asked again after half a minute.
*/
type Boxel = { name: string; distanceLy: number; evPerJump: number };
const nextBoxel: { key: string | null; boxel: Boxel | null; failedAt: number } = { key: null, boxel: null, failedAt: 0 };
const boxelListeners = new Set<() => void>();
let boxelRev = 0;
function askNextBoxel(key: string): void {
  const retry = nextBoxel.failedAt && Date.now() - nextBoxel.failedAt > 30000;
  if (!key || (key === nextBoxel.key && !retry)) return;
  nextBoxel.key = key;
  nextBoxel.failedAt = 0;
  fetch(api("/api/expedition/field?radius=500&limit=1&light=1"), { cache: "no-store" })
    .then((r) => {
      if (!r.ok) nextBoxel.failedAt = Date.now();
      return r.ok ? (r.json() as Promise<{ boxels?: { name?: string; code?: string; distanceLy: number; evPerJump: number }[] }>) : null;
    })
    .then((j) => {
      const b = j && j.boxels && j.boxels[0];
      nextBoxel.boxel = b ? { name: b.name || b.code + " boxel", distanceLy: b.distanceLy, evPerJump: b.evPerJump } : null;
      boxelRev++;
      for (const l of boxelListeners) l();
    })
    .catch(() => {
      nextBoxel.failedAt = Date.now();
    });
}
const millions = (v: number) =>
  v >= 1e9 ? (v / 1e9).toFixed(1) + " B" : v >= 1e6 ? (v / 1e6).toFixed(1) + " M" : Math.round(v / 1e3) + " k";

function NextBoxel({ d }: { d: HudSnapshot }) {
  useSyncExternalStore(
    (l) => {
      boxelListeners.add(l);
      return () => boxelListeners.delete(l);
    },
    () => boxelRev,
  );
  const on = pref("edexoHudNextBoxel", "0") === "1";
  const key = d.currentSystemAddress != null ? String(d.currentSystemAddress) : "";
  useLayoutEffect(() => {
    if (on) askNextBoxel(key);
  });
  const b = on ? nextBoxel.boxel : null;
  return (
    <div className="jump__boxel" data-f="boxel" hidden={!b}>
      {b ? (
        <>
          <span className="jump__boxel-k">Next boxel</span> {b.name}{" "}
          <span className="jump__boxel-v">
            {Math.round(b.distanceLy)} ly · {millions(b.evPerJump)}/jump
          </span>
        </>
      ) : null}
    </div>
  );
}

/*
  Boxel scanning (owner, 2026-10-06): what the boxel run or the F6 / F8 / F9 keys put on the clipboard,
  since a key press in the game shows nothing else — paste it in the galaxy map.
*/
function BoxelCopied({ d }: { d: HudSnapshot }) {
  const c = d.boxelCopied as { name?: string; run?: boolean; source?: string } | null | undefined;
  return (
    <div className="jump__copied" data-f="copied" hidden={!c || !c.name}>
      {c && c.name ? (
        <>
          <span className="jump__copied-k">Copied</span> {c.name}
          {c.source === "neutron" ? (
            <>
              {" "}
              <span className="jump__copied-run">· neutron route</span>
            </>
          ) : c.run ? (
            <>
              {" "}
              <span className="jump__copied-run">· boxel run</span>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/*
  The neutron route being flown (plan 8.5, server/neutronLive.ts): which stop of how many, what to do where the ship
  is — scoop the system's own star, supercharge — and the stop after (on the clipboard). The game plots the normal
  jumps between two stops itself; "scoop on the way" when they are more than a tank.
*/
/* "Use Jumponium" (1.2.16): the FSD injections planned for the stretch to the next stop, one per normal jump. */
const INJECT_NAME: Record<string, string> = { basic: "Basic", standard: "Standard", premium: "Premium" };

/* Planned from what is aboard since 1.2.17; this still says so when the hold makes fewer (review 1.2.16). */
function injectStock(d: HudSnapshot, inj: { tier: string; count: number }): string {
  const j = d.jumponium;
  if (!j || !j.known || !j.tiers) return "";
  const t = j.tiers.filter((x) => x.tier === inj.tier)[0];
  return t && t.count < inj.count ? " (you can make " + t.count + ")" : "";
}

function NeutronLive({ d }: { d: HudSnapshot }) {
  const n = d.neutronLive;
  if (!n)
    return <div className="jump__neutron" data-f="neutron" hidden />;
  if (n.done)
    return (
      <div className="jump__neutron" data-f="neutron">
        <span className="jump__neutron-k">Neutron route</span> done · {n.destination}
      </div>
    );
  if (n.replanning)
    return (
      <div className="jump__neutron" data-f="neutron">
        <span className="jump__neutron-k">Neutron</span> off the route · re-plotting from here…
      </div>
    );
  const todo: ReactNode[] = [];
  if (n.refuelHere)
    todo.push(
      <span key="fuel" className="jump__neutron-do jump__neutron-do--fuel">
        <FuelPump level="yellow" />
        {n.refuelHalf ? "Scoop to half a tank here" : "Scoop here"}
        {n.scoopLs != null ? " (" + Math.round(n.scoopLs).toLocaleString("en-US") + " ls)" : ""}
      </span>,
    );
  if (n.superchargeHere)
    todo.push(
      <span key="boost" className="jump__neutron-do jump__neutron-do--boost">
        ⚡ Supercharge here
      </span>,
    );
  return (
    <div className={"jump__neutron" + (todo.length ? " jump__neutron--act" : "")} data-f="neutron">
      <span className="jump__neutron-k">
        Neutron {n.at}/{n.total}
      </span>{" "}
      {todo.map((t, i) => (
        <Fragment key={i}>
          {i ? " " : null}
          {t}
        </Fragment>
      ))}
      {todo.length ? " " : null}
      {n.next ? (
        <span className="jump__neutron-next">
          › {n.next}
          {n.nextJumps > 1 ? " · " + n.nextJumps + " jumps" : ""}
          {n.scoopOnWay ? " · scoop on the way" : ""}
          {n.nextInject ? " · ⚗ " + n.nextInject.count + " " + INJECT_NAME[n.nextInject.tier] + injectStock(d, n.nextInject) : ""}
        </span>
      ) : null}
    </div>
  );
}

/* An AFMU fitted (the Laboratory, 1.2.16): it repairs the FSD in flight; how many refills the hold makes. */
function afmuHint(d: HudSnapshot): string {
  const j = d.jumponium;
  if (!j || !j.afmu || !j.afmu.length) return "";
  let refills = 0;
  for (const t of j.afmTiers || []) refills += t.count || 0;
  return " (AFMU fitted" + (j.known ? " · " + refills + " refill" + (refills === 1 ? "" : "s") + " makeable" : "") + ")";
}

/*
  The FSD's health (plan 8.4): the last Loadout's, less the supercharges since. Under 80 % in red — further jumps
  before a repair are not recommended (owner, 2026-10-13); while a neutron route is flown, shown always.
*/
function FsdHealth({ d }: { d: HudSnapshot }) {
  const f = d.fsdHealth;
  if (!f || (!f.warn && !d.neutronLive)) return <div className="jump__fsd" data-f="fsd" hidden />;
  return (
    <div className={"jump__fsd" + (f.warn ? " jump__fsd--warn" : "")} data-f="fsd">
      <span className="jump__neutron-k">FSD</span> {(f.estimate ? "~" : "") + Math.round(f.health * 100) + " %"}
      {f.warn ? " · repair before more supercharges" + afmuHint(d) : ""}
    </div>
  );
}

/*
  The route strip under the card (owner, 2026-09-13): the next hops as star-class letters in the
  KGBFOAM colours, a fuel pump on the star where the tank says to scoop — yellow to plan on it,
  red when skipping it means running dry. `⛽ +N` when that star is beyond the hops shown.

  An imperative island, like the radar: the strip is built, then hops are dropped off its end until it fits one
  row (owner, 2026-09-14), which needs the laid-out widths. React renders the element and nothing in it.
*/
export function fuelPumpHtml(level: string): string {
  return (
    '<svg class="hop__fuel hop__fuel--' +
    level +
    '" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15M4 20h12M7 7h6v4H7zM15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0v-7l-2.5-2.5"/></svg>'
  );
}
type Nav = NonNullable<NonNullable<HudSnapshot["liveShipFuelRange"]>["navRoute"]>;
type Hop = Nav["ahead"][number];

export function renderRouteStrip(d: HudSnapshot, el: HTMLElement): void {
  const nav = d.liveShipFuelRange && d.liveShipFuelRange.navRoute;
  const hops = nav && nav.ahead ? nav.ahead : [];
  if (!nav || !hops.length) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  /*
    The red pump that is not on a hop ahead goes first (owner, 2026-10-12: at the end of the line it
    "does not really show you where you should refuel"): on the star the ship is at when that is the
    last one the tank reaches, or "!" when no scoopable star is in reach at all.
  */
  let html = "";
  if (nav.refuelInHops === 0 && nav.refuelLevel !== "none") {
    html +=
      '<span class="hop hop--beyond hop--here' +
      // Red text only with the red pump (review 1.2.16: a yellow pump sat beside a red "here").
      (nav.refuelLevel === "red" ? " hop--dry" : "") +
      '" title="' +
      (nav.refuelLevel === "red"
        ? "Scoop here: past this star the tank runs dry with no star to scoop"
        : "Scoop here: the furthest scoopable star this tank reaches") +
      '">' +
      fuelPumpHtml(nav.refuelLevel) +
      'here</span><span class="hop__sep" aria-hidden="true">››</span>';
  } else if (nav.refuelInHops == null && nav.refuelLevel === "red") {
    html +=
      '<span class="hop hop--beyond hop--dry" title="No scoopable star within reach on this tank">' +
      fuelPumpHtml("red") +
      '!</span><span class="hop__sep" aria-hidden="true">››</span>';
  }
  for (let i = 0; i < hops.length; i++) {
    const h = hops[i]!;
    const k = starKind(h.starClass);
    /*
      The arrow's colour says what EDSM knows about the system it points at (owner, 2026-09-24):
      orange = someone has been there, electric blue = no record at all, grey = no answer.
      The arrow only — the hop keeps the star-class colour, which is the fuel question.
    */
    const ff = h.likelyFirstFootfall;
    const sepClass = ff === true ? " hop__sep--first" : ff === false ? "" : " hop__sep--unknown";
    const sepTitle = ff == null && h.firstFootfallNote ? ' title="' + esc(h.firstFootfallNote) + '"' : "";
    html +=
      (i ? '<span class="hop__sep' + sepClass + '"' + sepTitle + ' aria-hidden="true">››</span>' : "") +
      '<span class="hop hop--' +
      k.kind +
      '" title="' +
      esc(h.starSystem + " — " + k.label + (ff === true ? " — nobody has been here" : "")) +
      '">' +
      esc(h.starClass || "?") +
      (h.refuel && h.refuel !== "none" ? fuelPumpHtml(h.refuel) : "") +
      "</span>";
  }
  if (nav.refuelInHops != null && nav.refuelInHops > hops.length && nav.refuelLevel !== "none") {
    html +=
      '<span class="hop__sep" aria-hidden="true">››</span><span class="hop hop--beyond" title="Scoop in ' +
      nav.refuelInHops +
      ' jumps">' +
      fuelPumpHtml(nav.refuelLevel) +
      "+" +
      (nav.refuelInHops - hops.length) +
      "</span>";
  }
  el.innerHTML = html;
  el.hidden = false;
  fitRouteStrip(el, hops);
}

/**
 * One row, no wrapping (owner, 2026-09-14): drop hops off the end until the strip fits its width. If the pump's
 * hop is cut, a "+N" with the pump takes the last place so the scoop is never lost. Writes back how many hops
 * survived (`data-shown` of `data-of`) — the row's own answer, which depends on the HUD's width and scale.
 */
export function fitRouteStrip(el: HTMLElement, hops: Hop[]): number {
  let pumpIdx = -1;
  for (let i = 0; i < hops.length; i++) if (hops[i]!.refuel && hops[i]!.refuel !== "none") pumpIdx = i;
  let guard = 0;
  let shown = el.querySelectorAll(".hop:not(.hop--beyond)").length;
  while (el.scrollWidth > el.clientWidth + 1 && guard++ < 60) {
    const kids = el.children;
    if (kids.length < 3) break;
    // remove the last hop and the separator before it
    el.removeChild(kids[kids.length - 1]!);
    if (el.lastElementChild && el.lastElementChild.classList.contains("hop__sep")) el.removeChild(el.lastElementChild);
    shown = el.querySelectorAll(".hop:not(.hop--beyond)").length;
    if (pumpIdx >= shown && !el.querySelector(".hop--beyond")) {
      const tail = document.createElement("span");
      tail.className = "hop hop--beyond";
      tail.title = "Scoop in " + (pumpIdx + 1) + " jumps";
      tail.innerHTML = fuelPumpHtml(hops[pumpIdx]!.refuel) + "+" + (pumpIdx + 1 - shown);
      const sep = document.createElement("span");
      sep.className = "hop__sep";
      sep.setAttribute("aria-hidden", "true");
      sep.textContent = "››";
      el.appendChild(sep);
      el.appendChild(tail);
    }
  }
  shown = el.querySelectorAll(".hop:not(.hop--beyond)").length;
  el.dataset.shown = String(shown);
  el.dataset.of = String(hops.length);
  /*
    The whole plot is rarely on screen. Saying which part of it this is costs nothing and stops the
    strip reading as the entire route when it is the first thirteen hops of forty.
  */
  el.title = shown >= hops.length ? shown + " jumps ahead" : shown + " of " + hops.length + " jumps ahead";
  return shown;
}

function RouteStrip({ d }: { d: HudSnapshot }) {
  const el = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (el.current) renderRouteStrip(d, el.current);
  });
  return <div className="jump__route" data-f="route" hidden ref={el} />;
}

function Jump({ d }: { d: HudSnapshot }) {
  const jt = d.jumpTarget as JumpTarget | null | undefined;
  const has = !!(jt && jt.starSystem);
  const k = has ? starKind(jt!.starClass) : null;
  const src = (has && jt!.source) || "jump";
  const status = !has
    ? "No jump"
    : src === "target"
      ? "Targeted"
      : src === "route"
        ? "Next on route"
        : jt!.arrived
          ? "Arrived"
          : "Jumping";
  /*
    The triangle keeps its star-class colour. An earlier version turned it blue for an unvisited
    system and the owner asked for it back: the colour there already answers "is there fuel",
    which is the question the triangle exists for. The note below carries the other fact in words.
  */
  const boxCls = !has ? "jump jump--none" : "jump jump--" + k!.kind + (jt!.arrived ? " jump--arrived" : "") + " jump--src-" + src;
  return (
    <>
      <Head title="Next jump" status={status} />
      <div className={boxCls} data-f="jump">
        <div className="jump__tri" data-f="tri" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 3 22 20H2Z" />
            <path className="jump__mark" d="M12 9v5M12 16.5v1" />
          </svg>
        </div>
        <div className="jump__body">
          <div className="hud-big jump__sys" data-f="sys">
            {has ? jt!.starSystem : "—"}
          </div>
          <div className="jump__cls">
            <span className="jump__star" data-f="star">
              {has ? k!.label : "—"}
            </span>
            <span className="jump__note" data-f="note">
              {has ? k!.note : ""}
            </span>
          </div>
          <Discovered jt={has ? jt! : null} />
        </div>
      </div>
      <RouteStrip d={d} />
      <NeutronLive d={d} />
      <FsdHealth d={d} />
      <BoxelCopied d={d} />
      <NextBoxel d={d} />
    </>
  );
}

export const jump: HudSection = {
  title: "Next jump",
  render: (d) => <Jump d={d} />,
};
