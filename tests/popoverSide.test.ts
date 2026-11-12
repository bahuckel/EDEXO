/**
 * @vitest-environment jsdom
 *
 * Which way an app-bar panel opens (ui/popoverSide): to the right while it fits, to the left when only
 * that fits, and to the roomier side when neither does (a phone, plan 7.5).
 */
import { afterEach, describe, expect, it } from "vitest";
import { measurePopoverSide } from "../src/client/ui/popoverSide";

const realWidth = window.innerWidth;
afterEach(() => Object.defineProperty(window, "innerWidth", { value: realWidth, configurable: true }));

function side(viewport: number, left: number, right: number, panelWidth = 240) {
  Object.defineProperty(window, "innerWidth", { value: viewport, configurable: true });
  const wrap = { getBoundingClientRect: () => ({ left, right }) } as unknown as HTMLElement;
  const panel = { getBoundingClientRect: () => ({ width: panelWidth }), offsetWidth: panelWidth } as unknown as HTMLElement;
  return measurePopoverSide(wrap, panel, 240);
}

describe("measurePopoverSide", () => {
  it("opens rightwards while the panel fits there", () => {
    expect(side(1400, 900, 930)).toBe("left");
  });
  it("flips when only the left fits", () => {
    expect(side(1400, 1300, 1330)).toBe("right");
  });
  it("takes the roomier side when neither fits (390 px phone)", () => {
    expect(side(390, 212, 242)).toBe("right");
    expect(side(390, 120, 150)).toBe("left");
  });
});
