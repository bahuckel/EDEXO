import { useEffect, useState } from "react";

/**
 * Trailing-edge debounce. Distance tables arrive one system at a time, so the value they feed
 * would otherwise re-run its derived work on every arrival.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
