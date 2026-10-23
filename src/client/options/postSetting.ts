/**
 * One settings POST, shared by the contribution panels.
 *
 * Lifted out of the EDSM fetch panel when the others arrived: three copies of "post JSON, read
 * `{ok, error}` back, turn a thrown fetch into an error object" drift, and the one that drifts is
 * the one that stops reporting failures.
 */
export async function postSetting(
  path: string,
  body: unknown,
  method = "POST",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: method === "DELETE" ? undefined : JSON.stringify(body),
    });
    return (await r.json()) as { ok: boolean; error?: string };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Request failed." };
  }
}
