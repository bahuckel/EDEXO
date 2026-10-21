import { describe, expect, it } from "vitest";
import { inaraStationIconFromHtml, inaraStationIconFromStyle } from "../../src/shared/colonize/inaraStationIcon";

describe("inaraStationIconFromStyle", () => {
  it("maps Surface Port (-182px) as ground", () => {
    const info = inaraStationIconFromStyle(
      "background-image: url(/images/stations/sprites7.png); background-position: -182px 0px;",
    );
    expect(info.styleType).toBe("Surface Port");
    expect(info.isGround).toBe(true);
    expect(info.spriteX).toBe(182);
    expect(info.isFleetCarrier).toBe(false);
  });

  it("maps Coriolis as space large-pad", () => {
    const info = inaraStationIconFromStyle("background-position: -13px 0px");
    expect(info.styleType).toBe("Starport - Coriolis");
    expect(info.isGround).toBe(false);
    expect(info.largePad).toBe(true);
  });

  it("returns unknown for an unlisted sprite offset", () => {
    const info = inaraStationIconFromStyle("background-position: -999px 0px");
    expect(info.styleType).toBe("unknown");
    expect(info.kind).toBe("unknown");
    expect(info.spriteX).toBe(999);
  });

  it("maps every Station Types.txt offset", () => {
    const cases: [number, string, boolean][] = [
      [13, "Starport - Coriolis", false],
      [26, "Space Outpost", false],
      [156, "Starport - Orbis", false],
      [169, "Starport - Ocellus", false],
      [182, "Surface Port", true],
      [195, "Surface Station", true],
      [247, "Starport - Asteroid Base", false],
      [507, "Carrier", false],
      [871, "Starport - Dodec", false],
    ];
    for (const [x, styleType, ground] of cases) {
      const info = inaraStationIconFromStyle(`background-position: -${x}px 0px`);
      expect(info.styleType).toBe(styleType);
      expect(info.isGround).toBe(ground);
    }
  });

  it("reads a computed-style background-position value", () => {
    const info = inaraStationIconFromStyle("-195px 0px");
    expect(info.styleType).toBe("Surface Station");
    expect(info.isGround).toBe(true);
  });

  it("reads sprite X from a location-cell HTML snippet", () => {
    const html =
      '<div class="stationicon" style="background-image: url(/images/stations/sprites7.png); background-position: -871px 0px;"></div>Dodec Port';
    const info = inaraStationIconFromHtml(html);
    expect(info.styleType).toBe("Starport - Dodec");
    expect(info.isGround).toBe(false);
  });
});
