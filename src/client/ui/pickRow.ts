/*
  A table row that picks something on the map, from the mouse and the keyboard alike (review 2026-11-10 F6: three pick
  tables had only `onClick`, so Tab never reached them). Enter or Space on the row picks; a key pressed on a control
  inside it (the copy button) stays that control's.
*/
import type { KeyboardEvent } from "react";

export function pickRow(onPick: () => void) {
  return {
    className: "is-pickable",
    tabIndex: 0,
    onClick: onPick,
    onKeyDown: (ev: KeyboardEvent<HTMLElement>) => {
      if (ev.target !== ev.currentTarget || (ev.key !== "Enter" && ev.key !== " ")) return;
      ev.preventDefault();
      onPick();
    },
  };
}
