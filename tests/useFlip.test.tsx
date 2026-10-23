/**
 * @vitest-environment jsdom
 * Rows that move slide from where they were (R3b, useFlip): a row moved by a re-order animates from its old place,
 * a new row fades in, nothing moves at motion Off.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlip } from "../src/client/ui/useFlip";

function List({ items }: { items: string[] }) {
  const ref = useRef<HTMLUListElement>(null);
  useFlip(ref);
  return (
    <ul ref={ref}>
      {items.map((k) => (
        <li key={k} data-flip-key={k}>
          {k}
        </li>
      ))}
    </ul>
  );
}

let calls: { key: string; frames: Keyframe[] }[] = [];
beforeEach(() => {
  calls = [];
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Each row's place is its index in the list, 20 px apart.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const i = [...(this.parentElement?.children ?? [])].indexOf(this);
    return { left: 0, top: i * 20, width: 100, height: 20, right: 100, bottom: i * 20 + 20, x: 0, y: i * 20, toJSON() {} } as DOMRect;
  });
  (HTMLElement.prototype as { animate?: unknown }).animate = function (this: HTMLElement, frames: Keyframe[]) {
    calls.push({ key: this.dataset.flipKey ?? "", frames });
    return {} as Animation;
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
  localStorage.removeItem("edexo.motion");
});

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  return {
    render: (items: string[]) => act(() => root.render(<List items={items} />)),
    unmount: () => act(() => root.unmount()),
  };
}

describe("useFlip", () => {
  it("slides a row that moved from its old place, fades a new one in, and leaves the rest", () => {
    localStorage.setItem("edexo.motion", "full");
    const m = mount();
    m.render(["steel", "titanium", "aluminium"]);
    expect(calls).toEqual([]); // the first render only measures
    m.render(["titanium", "aluminium", "steel", "water"]);
    const steel = calls.find((c) => c.key === "steel")!;
    expect(steel.frames[0]).toEqual({ transform: "translate(0px, -40px)" });
    expect(calls.find((c) => c.key === "water")!.frames[0]).toEqual({ opacity: 0 });
    expect(calls.find((c) => c.key === "titanium")!.frames[0]).toEqual({ transform: "translate(0px, 20px)" });
    m.unmount();
  });

  it("only fades new rows at Reduced, and does nothing at Off", () => {
    localStorage.setItem("edexo.motion", "reduced");
    let m = mount();
    m.render(["a", "b"]);
    m.render(["b", "a", "c"]);
    expect(calls.map((c) => c.key)).toEqual(["c"]);
    m.unmount();
    calls = [];
    localStorage.setItem("edexo.motion", "off");
    m = mount();
    m.render(["a", "b"]);
    m.render(["b", "a", "c"]);
    expect(calls).toEqual([]);
    m.unmount();
  });
});
