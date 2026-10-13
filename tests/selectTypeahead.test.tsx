// @vitest-environment jsdom
/**
 * ui/Select.tsx type to jump (plan 3.3): a letter moves to the next option starting with it, the same
 * letter again to the one after, letters typed together find "bac…", disabled options are skipped,
 * and typing on the closed control opens it there. Enter picks; arrows still work.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Select, type SelectOption } from "../src/client/ui/Select";

let root: Root | null = null;
let host: HTMLDivElement;

const OPTIONS: SelectOption[] = [
  { value: "", label: "Any genus" },
  { value: "ale", label: "Aleoida" },
  { value: "bac", label: "Bacterium" },
  { value: "bark", label: "Bark Mounds" },
  { value: "brain", label: "Brain Tree", disabled: true },
  { value: "cac", label: "Cactoida" },
];

let picked = "";
function Pick() {
  const [v, setV] = useState("");
  picked = v;
  return createElement(Select, { value: v, options: OPTIONS, onChange: setV, ariaLabel: "Genus" });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  Element.prototype.scrollIntoView = () => {};
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.useRealTimers();
});

const control = () => host.querySelector<HTMLButtonElement>(".ui-select")!;
const key = (k: string) =>
  act(() => {
    control().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
/** The highlighted option's label. */
const active = () => {
  const id = control().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.textContent?.replace("✓", "") : null;
};
const wait = (ms: number) => vi.setSystemTime(Date.now() + ms);

describe("Select type to jump", () => {
  it("opens on a letter there, steps with the same letter, skips disabled, finds a run", () => {
    act(() => root!.render(createElement(Pick)));
    control().focus();
    key("b");
    expect(control().getAttribute("aria-expanded")).toBe("true");
    expect(active()).toBe("Bacterium");
    key("b");
    expect(active()).toBe("Bark Mounds");
    key("b"); // Brain Tree is disabled: round to Bacterium
    expect(active()).toBe("Bacterium");
    wait(1000);
    key("c");
    expect(active()).toBe("Cactoida");
    wait(1000);
    key("B");
    key("a");
    key("r");
    expect(active()).toBe("Bark Mounds");
    key("Enter");
    expect(picked).toBe("bark");
    expect(control().getAttribute("aria-expanded")).toBe("false");
  });

  it("a letter nothing starts with leaves the highlight; arrows still step", () => {
    act(() => root!.render(createElement(Pick)));
    control().focus();
    key("ArrowDown");
    expect(active()).toBe("Any genus");
    wait(1000);
    key("z");
    expect(active()).toBe("Any genus");
    key("ArrowDown");
    expect(active()).toBe("Aleoida");
  });
});
