/*
  The client's request idioms in one place (plan 2026-11-10 Phase 7.4; review 2026-11-07 §8.6, C11: 176 bare fetch
  sites, each spelling the same few lines). Each helper is exactly the idiom it replaces: no timeout, retry or error
  of its own.
*/

/** A JSON body, POST unless `init` says otherwise: the request every switch and action makes. */
export function sendJson(url: string, body: unknown, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers as Record<string, string> | undefined) },
    body: JSON.stringify(body),
  });
}

/** The answer's JSON, or null for an error status. */
export function jsonOrNull<T = unknown>(r: Response): Promise<T> | null {
  return r.ok ? (r.json() as Promise<T>) : null;
}

/** The answer's JSON; an error status rejects with the status as its message. */
export function jsonOrThrow<T = unknown>(r: Response): Promise<T> {
  return r.ok ? (r.json() as Promise<T>) : Promise.reject(new Error(String(r.status)));
}
