/**
 * The portable exe's splash (discuss item 16, owner 2026-10-23): shown while the exe unpacks, which took several
 * silent seconds on every start. NSIS takes a bitmap only, which sharp does not write, so the pixels come from sharp
 * and the BMP header is written here. Output: build/portable-splash.bmp (build/ is generated, not committed).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "build", "portable-splash.bmp");
const W = 420;
const H = 150;

const text = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="100%" height="100%" fill="#0e0b0a"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" fill="none" stroke="#ff8a1f" stroke-opacity="0.55"/>
  <text x="140" y="68" font-family="Bahnschrift, Segoe UI, sans-serif" font-size="30" font-weight="700" letter-spacing="4" fill="#ffb060">EDEXO</text>
  <text x="140" y="98" font-family="Bahnschrift, Segoe UI, sans-serif" font-size="15" letter-spacing="2" fill="#d9cabb">Getting ready…</text>
</svg>`);
const icon = await sharp(path.join(root, "public", "edexo-icon.png")).resize(96, 96).png().toBuffer();
const { data, info } = await sharp(text)
  .composite([{ input: icon, left: 27, top: Math.round((H - 96) / 2) }])
  .removeAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });

// 24-bit BMP: rows bottom-up, BGR, each row padded to 4 bytes.
const rowSize = Math.ceil((info.width * 3) / 4) * 4;
const pixelBytes = rowSize * info.height;
const bmp = Buffer.alloc(54 + pixelBytes);
bmp.write("BM", 0, "ascii");
bmp.writeUInt32LE(54 + pixelBytes, 2);
bmp.writeUInt32LE(54, 10);
bmp.writeUInt32LE(40, 14);
bmp.writeInt32LE(info.width, 18);
bmp.writeInt32LE(info.height, 22);
bmp.writeUInt16LE(1, 26);
bmp.writeUInt16LE(24, 28);
bmp.writeUInt32LE(pixelBytes, 34);
for (let y = 0; y < info.height; y++) {
  const src = (info.height - 1 - y) * info.width * info.channels;
  const dst = 54 + y * rowSize;
  for (let x = 0; x < info.width; x++) {
    const i = src + x * info.channels;
    bmp[dst + x * 3] = data[i + 2];
    bmp[dst + x * 3 + 1] = data[i + 1];
    bmp[dst + x * 3 + 2] = data[i];
  }
}
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, bmp);
console.info(`[splash] ${path.relative(root, out)} ${info.width}x${info.height}`);
