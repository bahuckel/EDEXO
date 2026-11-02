/**
 * The photograph has to be the colour the row is claiming.
 *
 * The app predicts which variant a body will grow, and the commanders are photographing the
 * variants one at a time. The hero image on the species card has paired the two since the variants
 * arrived — but the rule lived inline in that component, so the **rows** view never got it: a row
 * printed "Cactoida Peperatis - Amethyst" beside a photograph of the Teal one, which is a different
 * plant, and the row was the thing naming it.
 *
 * Reported by the owner as "if we have a matching color for the plant it should match it". The rule
 * is one function now, and this is the test that keeps both callers honest.
 */
import { describe, expect, it } from "vitest";
import { heroPhotoUrlFor, variantPhotoUrlFor } from "../src/client/speciesMatchHelpers.js";
import { pendingLinePhoto } from "../src/server/organicValue.js";

const AMETHYST = "/species-photos/cactoida/Cactoida-peperatis-Amethyst.jpg";
const TEAL = "/species-photos/cactoida/Cactoida-peperatis-Teal.jpg";
const YELLOW = "/species-photos/cactoida/Cactoida-peperatis-Yellow.jpg";

const m = {
  // `photoUrl` is the server's own pick, and deliberately not the variant: it knows nothing about
  // the body the commander is looking at.
  photoUrl: TEAL,
  photoVariants: [
    { url: AMETHYST, colour: "Amethyst" },
    { url: TEAL, colour: "Teal" },
    { url: YELLOW, colour: "Yellow" },
  ],
};

describe("picking the photograph of the predicted colour", () => {
  it("returns the variant the prediction named", () => {
    expect(variantPhotoUrlFor(m, "Amethyst")).toBe(AMETHYST);
    expect(variantPhotoUrlFor(m, "Yellow")).toBe(YELLOW);
  });

  it("does not care how the colour was capitalised or spaced", () => {
    // The prediction is display text and the filename is a stem; neither is the other's authority.
    expect(variantPhotoUrlFor(m, "amethyst")).toBe(AMETHYST);
    expect(variantPhotoUrlFor(m, "  Amethyst ")).toBe(AMETHYST);
  });

  it("gives back nothing for a colour nobody has photographed", () => {
    expect(variantPhotoUrlFor(m, "Green")).toBeNull();
    expect(heroPhotoUrlFor(m, "Green")).toBe(TEAL);
  });

  it("refuses to choose when the rule had nothing to read", () => {
    expect(variantPhotoUrlFor(m, "(unknown)")).toBeNull();
    expect(variantPhotoUrlFor(m, "")).toBeNull();
    expect(variantPhotoUrlFor(m, null)).toBeNull();
    expect(heroPhotoUrlFor(m, "(unknown)")).toBe(TEAL);
  });

  it("shows a colour the body can grow when the rule allows more than one (owner, 2026-11-02)", () => {
    // Concha renibus "Red or White" showed the Aquamarine photograph while a White one was in the tree.
    expect(variantPhotoUrlFor(m, "Red or Yellow")).toBe(YELLOW);
    expect(variantPhotoUrlFor(m, "Amethyst or Yellow")).toBe(AMETHYST);
    expect(variantPhotoUrlFor(m, "Lime or Cyan")).toBeNull();
    expect(heroPhotoUrlFor(m, "Lime or Cyan")).toBe(TEAL);
  });

  it("shows the sampled colour on the unsold-samples list (owner, 2026-11-02)", () => {
    // The game's variant names the colour: "Cactoida Peperatis - Yellow".
    const photo = { photoUrl: m.photoUrl, photoVariants: m.photoVariants };
    expect(pendingLinePhoto(photo, "Cactoida Peperatis - Yellow")).toBe(YELLOW);
    expect(pendingLinePhoto(photo, "Cactoida Peperatis - amethyst")).toBe(AMETHYST);
    expect(pendingLinePhoto(photo, "Cactoida Peperatis - Green")).toBe(TEAL);
    expect(pendingLinePhoto(photo, "Cactoida Peperatis")).toBe(TEAL);
  });

  it("falls back to the species photograph for a species nobody has shot by variant", () => {
    const plain = { photoUrl: "/species-photos/aleoida/Aleoida-arcus.jpg", photoVariants: [] };
    expect(variantPhotoUrlFor(plain, "Green")).toBeNull();
    expect(heroPhotoUrlFor(plain, "Green")).toBe(plain.photoUrl);
  });

  it("is stable rather than random, which is what a list being scanned needs", () => {
    // Same input, same picture, every render — the owner asked for "a random one" as the fallback,
    // and a list that reshuffles its thumbnails between frames is worse than one that repeats.
    const a = heroPhotoUrlFor(m, "Green");
    const b = heroPhotoUrlFor(m, "Green");
    expect(a).toBe(b);
  });
});
