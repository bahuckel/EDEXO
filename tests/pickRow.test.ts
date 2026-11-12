/** Review 2026-11-10 F6: the map's pick tables answer the keyboard; a key on a control inside a row stays the control's. */
import { describe, expect, it, vi } from "vitest";
import { pickRow } from "../src/client/ui/pickRow.js";

const key = (k: string, onRow = true) => {
  const row = {};
  return { key: k, target: onRow ? row : {}, currentTarget: row, preventDefault: vi.fn() } as never;
};

describe("pickRow", () => {
  it("is reachable by Tab and picks on click, Enter and Space", () => {
    const onPick = vi.fn();
    const p = pickRow(onPick);
    expect(p).toMatchObject({ className: "is-pickable", tabIndex: 0 });
    p.onClick();
    p.onKeyDown(key("Enter"));
    const space = key(" ");
    p.onKeyDown(space);
    expect(onPick).toHaveBeenCalledTimes(3);
    expect((space as { preventDefault: () => void }).preventDefault).toHaveBeenCalled();
  });

  it("leaves other keys, and keys on a button inside the row, alone", () => {
    const onPick = vi.fn();
    const p = pickRow(onPick);
    p.onKeyDown(key("a"));
    p.onKeyDown(key("Enter", false));
    expect(onPick).not.toHaveBeenCalled();
  });
});
