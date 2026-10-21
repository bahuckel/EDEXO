import { commodityMergeBucket } from "../../shared/colonize/commodityKey";
import { fetchEdsmJson } from "./galaxySystemCoords";

const EDSM_MATERIALS = "https://www.edsm.net/api-commander-v1/get-materials";

export type EdsmCargoLine = {
  commodityId: string;
  label: string;
  tons: number;
};

function normCmdr(name: string): string {
  return name.trim().replace(/^cmdr\s+/i, "");
}

/** Public EDSM cargo when commander shares inventory; optional apiKey for own account. */
export async function fetchEdsmCommanderCargo(
  commanderName: string,
  apiKey?: string | null,
): Promise<{ ok: true; lines: EdsmCargoLine[] } | { ok: false; err: string }> {
  const commander = normCmdr(commanderName);
  if (!commander) return { ok: false, err: "Empty commander name." };

  const params = new URLSearchParams({ commanderName: commander, type: "cargo" });
  const key = apiKey?.trim();
  if (key) params.set("apiKey", key);

  let payload: unknown;
  try {
    payload = await fetchEdsmJson(`${EDSM_MATERIALS}?${params.toString()}`);
  } catch (e) {
    return { ok: false, err: e instanceof Error ? e.message : String(e) };
  }

  if (!payload || typeof payload !== "object") {
    return { ok: false, err: "Invalid EDSM response." };
  }
  const rec = payload as Record<string, unknown>;
  const msg = typeof rec.msg === "string" ? rec.msg : "";
  if (msg && /not found|private|disabled/i.test(msg)) {
    return { ok: false, err: msg };
  }

  const cargo = rec.cargo;
  if (!Array.isArray(cargo)) {
    return { ok: false, err: msg || "No public cargo on EDSM (wingmate may need shared inventory)." };
  }

  const lines: EdsmCargoLine[] = [];
  for (const row of cargo) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name : typeof r.Name === "string" ? r.Name : "";
    const qtyRaw = r.quantity ?? r.count ?? r.Qty;
    const qty = typeof qtyRaw === "number" ? qtyRaw : typeof qtyRaw === "string" ? Number(qtyRaw) : 0;
    if (!name.trim() || !Number.isFinite(qty) || qty <= 0) continue;
    const id = commodityMergeBucket(name) || name.trim().toLowerCase().replace(/\s+/g, "");
    if (!id) continue;
    lines.push({ commodityId: id, label: name.trim(), tons: Math.max(1, Math.ceil(qty)) });
  }

  return { ok: true, lines };
}
