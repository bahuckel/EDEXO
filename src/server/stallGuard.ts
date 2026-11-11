/**
 * A download's own clock: no answer in `connectMs`, or no bytes for `idleMs` once it streams, aborts it (review
 * 2026-11-10 C9: the index downloads, the NSP list and the updater waited undici's five minutes on a dead connection,
 * "downloading" on screen all that while). The galaxy index download has its own (galaxyIndexFiles.ts), the model.
 * Pass `signal` to the fetch and the pipeline, call `touch` on every chunk and `done` at the end.
 */
export function stallGuard(
  what: string,
  connectMs = 30_000,
  idleMs = 60_000,
): { signal: AbortSignal; touch: () => void; done: () => void } {
  const ac = new AbortController();
  const arm = (ms: number, why: string) => {
    const t = setTimeout(() => ac.abort(new Error(`${what}: ${why}`)), ms);
    t.unref?.();
    return t;
  };
  let timer = arm(connectMs, `no answer in ${connectMs / 1000} s`);
  return {
    signal: ac.signal,
    touch() {
      clearTimeout(timer);
      timer = arm(idleMs, `no data for ${idleMs / 1000} s`);
    },
    done() {
      clearTimeout(timer);
    },
  };
}
