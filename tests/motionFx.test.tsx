/**
 * @vitest-environment jsdom
 * The motion effects (owner 2026-11-05, M0-M6): each has a switch, plays only at motion Full, and the parts that use
 * them keep the page's text as it was (rolling digits are drawn by CSS) and fall back to plain text when off.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMotion, fxOn, fxSwitchedOn, setFxSwitchedOn, setMotionLevel } from "../src/client/motionCore";
import { RollingNumber } from "../src/client/ui/RollingNumber";
import { JournalBootScreen, useBootTick } from "../src/client/JournalBootScreen";
import type { JournalBootProgressDTO } from "../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("motion switches", () => {
  it("every effect is on by default and plays only at Full", () => {
    expect(fxOn("press")).toBe(true);
    setMotionLevel("reduced");
    expect(fxOn("press")).toBe(false);
    expect(fxSwitchedOn("press")).toBe(true);
    setMotionLevel("off");
    expect(fxOn("roll")).toBe(false);
  });

  it("a switched-off effect is named on <html> for CSS", () => {
    applyMotion();
    setFxSwitchedOn("expand", false);
    setFxSwitchedOn("press", false);
    expect(fxOn("expand")).toBe(false);
    expect(document.documentElement.dataset.fxOff?.split(" ").sort()).toEqual(["expand", "press"]);
    setFxSwitchedOn("expand", true);
    setFxSwitchedOn("press", true);
    expect(document.documentElement.dataset.fxOff).toBeUndefined();
  });
});

describe("RollingNumber (M3)", () => {
  it("reads as the number itself and draws one column per digit", () => {
    act(() => root.render(<RollingNumber text="1,234 CR" />));
    expect(host.textContent).toBe("1,234 CR");
    const digits = host.querySelectorAll<HTMLElement>(".roll-digit");
    expect([...digits].map((d) => d.style.getPropertyValue("--d"))).toEqual(["1", "2", "3", "4"]);
  });

  it("delays the changed digits 100 ms apart, left first", () => {
    act(() => root.render(<RollingNumber text="1,234" />));
    act(() => root.render(<RollingNumber text="1,299" />));
    const delays = [...host.querySelectorAll<HTMLElement>(".roll-digit")].map((d) =>
      d.style.getPropertyValue("--roll-delay"),
    );
    expect(delays).toEqual(["0ms", "0ms", "0ms", "100ms"]);
  });

  it("is plain text with the effect off", () => {
    setFxSwitchedOn("roll", false);
    act(() => root.render(<RollingNumber text="42" />));
    expect(host.querySelector(".roll-digit")).toBeNull();
    expect(host.textContent).toBe("42");
  });
});

const BOOT: JournalBootProgressDTO = { percent: 80, message: "Reading", filesDone: 8, filesTotal: 10 } as JournalBootProgressDTO;

function Boot({ boot }: { boot: JournalBootProgressDTO | null }) {
  const shown = useBootTick(boot);
  return shown ? <JournalBootScreen boot={shown.boot} connected done={shown.done} /> : <p>app</p>;
}

describe("loaded tick (M6)", () => {
  it("holds the boot screen with the tick once the journal is in, then shows the app", () => {
    vi.useFakeTimers();
    act(() => root.render(<Boot boot={BOOT} />));
    expect(host.querySelector(".journal-boot__tick")).toBeNull();
    act(() => root.render(<Boot boot={null} />));
    expect(host.querySelector(".journal-boot__tick")).not.toBeNull();
    expect(host.textContent).toContain("100%");
    expect(host.textContent).toContain("10 / 10 journal logs");
    act(() => vi.advanceTimersByTime(1000));
    expect(host.textContent).toBe("app");
  });

  it("goes straight to the app with the effect off", () => {
    setFxSwitchedOn("tick", false);
    act(() => root.render(<Boot boot={BOOT} />));
    act(() => root.render(<Boot boot={null} />));
    expect(host.textContent).toBe("app");
  });
});
