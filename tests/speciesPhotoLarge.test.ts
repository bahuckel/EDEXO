/**
 * The lightbox's 2048 px photo (owner, 2026-10-04): `?size=large` serves `_large/<stem>.webp`, and a
 * tree without it — a packaged build has no originals — falls back to the best image there is. And `?size=blur`, the
 * card's 16 px placeholder (UI ideas 2026-11-16 §4.5), never falls back: a whole photo would defeat it.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerSpeciesFilesRoutes } from "../src/server/routes/speciesFilesRoutes.js";
import type { HttpServerOptions, RouteContext } from "../src/server/httpServer.js";
import { listenLocal } from "./helpers/listenLocal.js";

let root: string;
let base: string;
let close: () => void;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "edexo-photo-large-"));
  const photos = path.join(root, "data", "species", "aleoida", "aleoida_photos");
  for (const d of ["_cards", "_large", "_blur"]) mkdirSync(path.join(photos, d), { recursive: true });
  // "both": original, card and large. "packaged": card and large only. "cardonly": a card only.
  writeFileSync(path.join(photos, "both.jpg"), "original");
  writeFileSync(path.join(photos, "_cards", "both.webp"), "card");
  writeFileSync(path.join(photos, "_large", "both.webp"), "large");
  writeFileSync(path.join(photos, "_cards", "packaged.webp"), "card");
  writeFileSync(path.join(photos, "_large", "packaged.webp"), "large");
  writeFileSync(path.join(photos, "_cards", "cardonly.webp"), "card");
  writeFileSync(path.join(photos, "_blur", "both.webp"), "blur");
  const app = express();
  registerSpeciesFilesRoutes(app, {} as HttpServerOptions, { root, webRoot: root } as RouteContext);
  const { server, base: origin } = await listenLocal(app);
  base = `${origin}/species-photos/aleoida`;
  close = () => server.close();
});
afterAll(() => {
  close();
  rmSync(root, { recursive: true, force: true });
});

const body = async (p: string) => {
  const r = await fetch(`${base}/${p}`);
  return r.ok ? r.text() : `HTTP ${r.status}`;
};

describe("species photo sizes", () => {
  it("serves each size where it exists", async () => {
    expect(await body("both.jpg?size=large")).toBe("large");
    expect(await body("both.jpg?size=card")).toBe("card");
    expect(await body("both.jpg")).toBe("original");
  });

  it("falls back to the large image, then the card, where the original was left out", async () => {
    expect(await body("packaged.jpg")).toBe("large");
    expect(await body("packaged.jpg?size=large")).toBe("large");
    expect(await body("cardonly.jpg?size=large")).toBe("card");
    expect(await body("cardonly.jpg")).toBe("card");
    expect(await body("missing.jpg?size=large")).toBe("HTTP 404");
  });

  it("serves the blur where it exists and nothing in its place where it does not", async () => {
    expect(await body("both.jpg?size=blur")).toBe("blur");
    expect(await body("packaged.jpg?size=blur")).toBe("HTTP 404");
    expect(await body("cardonly.jpg?size=blur")).toBe("HTTP 404");
  });
});
