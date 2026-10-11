/**
 * Whether the main screen's header shows "Next boxel" (owner, 2026-10-11: "an option inside of the Boxel menu
 * to show next boxel thing in the main screen, just a check box"). Set in the Boxels screen, read by the
 * header; the Boxels screen can be a window of its own, so a change is announced to this window and reaches
 * the others through the `storage` event. On unless switched off, as it was before the option.
 */
import { useEffect, useState } from "react";

const KEY = "edexo.nextBoxelInHeader";
const EVENT = "edexo:next-boxel-in-header";

export function readNextBoxelInHeader(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeNextBoxelInHeader(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* not remembered, still applies to this window */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

export function useNextBoxelInHeader(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(readNextBoxelInHeader);
  useEffect(() => {
    const here = (ev: Event) => setOn((ev as CustomEvent<boolean>).detail);
    const other = (ev: StorageEvent) => {
      if (ev.key === KEY) setOn(ev.newValue !== "0");
    };
    window.addEventListener(EVENT, here);
    window.addEventListener("storage", other);
    return () => {
      window.removeEventListener(EVENT, here);
      window.removeEventListener("storage", other);
    };
  }, []);
  return [on, writeNextBoxelInHeader];
}
