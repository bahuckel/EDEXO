import type { InaraImportStation } from "./inaraImportTypes";
import { inaraStationIconFromHtml } from "./inaraStationIcon";
import { toLy } from "./systemDistanceLy";

function numFromText(s: string): number | null {
  const t = String(s).replace(/,/g, "").replace(/[^\d.-]/g, " ").trim();
  const m = t.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`, "i")) || tag.match(new RegExp(`${name}='([^']*)'`, "i"));
  return m?.[1] ?? null;
}

function tdInner(tdHtml: string): string {
  const m = tdHtml.match(/^<td\b[^>]*>([\s\S]*)<\/td>$/i);
  return m?.[1] ?? tdHtml;
}

function numFromTd(tdHtml: string): number | null {
  const open = tdHtml.match(/^<td\b[^>]*>/i)?.[0] ?? "";
  const order = attr(open, "data-order");
  if (order != null && order !== "") {
    const n = Number(order);
    if (Number.isFinite(n)) return n;
  }
  return numFromText(stripTags(tdHtml));
}

function parseLocation(tdHtml: string): { stationName: string; systemName: string } {
  const inner = tdInner(tdHtml);
  const sysSpan = inner.match(/<span[^>]*class="[^"]*(?:uppercase|nowrap)[^"]*"[^>]*>([^<]+)/i);
  const systemFromSpan = sysSpan?.[1]?.replace(/\s+/g, " ").trim() || "";
  const pipeParts = stripTags(inner)
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  let stationName = pipeParts[0] || "";
  let systemName = systemFromSpan || pipeParts[1] || "";
  if (pipeParts.length >= 2) {
    stationName = pipeParts[0] ?? "";
    if (!systemName) systemName = pipeParts[1] ?? "";
  }
  return { stationName, systemName };
}

function headerIndex(headers: string[], ...needles: string[]): number {
  const n = headers.map((h) => h.toLowerCase());
  for (const needle of needles) {
    const i = n.findIndex((h) => h.includes(needle));
    if (i >= 0) return i;
  }
  return -1;
}

/**
 * Parse Inara commodity buy-search results (`#DataTables_Table_0` / `.dataTable`).
 * Location cells look like `Broot's Prospect | Swoilz BY-D c1-13` with a single station-market link.
 */
export function parseInaraBuyResultsHtml(html: string): InaraImportStation[] {
  const tableMatch = html.match(
    /<table\b[^>]*(?:id="DataTables_Table_0"|class="[^"]*(?:dataTable|tablesortercollapsed|tablesorter)[^"]*")[^>]*>[\s\S]*?<\/table>/i,
  );
  const table = tableMatch?.[0] ?? html;
  const thead = table.match(/<thead>[\s\S]*?<\/thead>/i)?.[0] ?? "";
  const headers = [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1] ?? ""));
  const locI = headerIndex(headers, "location", "station");
  const padI = headerIndex(headers, "pad");
  const distI = headerIndex(headers, "distance");
  const supplyI = headerIndex(headers, "supply", "stock");
  const demandI = headerIndex(headers, "demand");
  const priceI = headerIndex(headers, "price");
  const updatedI = headerIndex(headers, "updated", "age");
  const stationI = locI >= 0 ? locI : 0;
  if (distI < 0 && supplyI < 0 && priceI < 0) return [];

  const body = table.match(/<tbody>[\s\S]*?<\/tbody>/i)?.[0] ?? table;
  const rows = [...body.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)];
  const stations: InaraImportStation[] = [];
  for (const row of rows) {
    const trAttrs = row[1] ?? "";
    const inner = row[2] ?? "";
    if (/\bchild\b/.test(trAttrs) || /class="[^"]*child/.test(trAttrs)) continue;
    const tds = [...inner.matchAll(/<td\b[^>]*>[\s\S]*?<\/td>/gi)].map((m) => m[0]);
    if (tds.length < 2) continue;
    const locTd = tds[stationI] || tds[0] || "";
    const { stationName, systemName } = parseLocation(locTd);
    if (!stationName || !systemName) continue;
    const supply = supplyI >= 0 ? numFromTd(tds[supplyI] ?? "") : null;
    const demand = demandI >= 0 ? numFromTd(tds[demandI] ?? "") : null;
    const buyPrice = priceI >= 0 ? numFromTd(tds[priceI] ?? "") : null;
    const selling = supply != null && supply > 0;
    if (!selling && demand != null && demand > 0 && (supply == null || supply <= 0)) continue;
    if (!selling && (buyPrice == null || buyPrice <= 0)) continue;
    const dist = distI >= 0 ? numFromTd(tds[distI] ?? "") : null;
    const icon = inaraStationIconFromHtml(locTd);
    const padRaw = padI >= 0 ? stripTags(tds[padI] ?? "") : "";
    const pad = padRaw ? padRaw.charAt(0).toUpperCase() : "";
    stations.push({
      systemName,
      stationName,
      distanceLy: toLy(dist),
      supply,
      buyPrice,
      styleType: icon.styleType,
      stationType: icon.styleType,
      pad: pad && /[SML]/.test(pad) ? pad : null,
      isGround: icon.isGround,
      isPlanetaryOrGround: icon.isGround,
      isFleetCarrier: icon.isFleetCarrier,
      spriteX: icon.spriteX,
      marketUpdatedAt: updatedI >= 0 ? stripTags(tds[updatedI] ?? "") || null : null,
    });
  }
  return stations;
}
