/**
 * `useState` that a screen drawn again finds where it left it, for as long as the window (owner, 2026-10-29: the
 * galaxy map came back zoomed out, its search, plan and menu gone). The galaxy tab is let go after ten minutes behind
 * other tabs (TabSlot) and drawn afresh when it comes back; plain state started over. Held in memory only, so a new
 * window or a restart still starts clean (usePersistedState is the one that outlives the app). Keep small things here:
 * what is kept is never let go, which would undo the release.
 */
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

const store = new Map<string, unknown>();

/** The kept value, for code outside a render (the map restoring its selection once the engine exists). */
export function keptValue<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function useKeptState<T>(
  key: string,
  /** The first value, or a function of the kept one (undefined when nothing is kept) when something may override it. */
  initial: T | ((kept: T | undefined) => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    const kept = store.get(key) as T | undefined;
    if (typeof initial === "function") return (initial as (kept: T | undefined) => T)(kept);
    return store.has(key) ? (kept as T) : initial;
  });
  useEffect(() => {
    store.set(key, value);
  }, [key, value]);
  return [value, setValue];
}
