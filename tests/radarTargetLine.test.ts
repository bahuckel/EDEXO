// @vitest-environment jsdom
/**
 * The radar draws what the server marks (owner, 2026-11-04: "the next plant outside your samples' range is marked with
 * a line to it - it does not do that"): the copy it draws from kept only the fields listed in it, so the next plant's
 * `target`, a crossing's `located` and a scan's heading never reached the drawing.
 */
import { describe, expect, it } from "vitest";
import { drawMinimap, fmtRadarDistance } from "../src/client/hud/radar.js";
import type { ExoMinimapDTO } from "../src/shared/types.js";

const map = (): ExoMinimapDTO => ({
  radiusM: 500,
  headingDeg: 0,
  minSampleDistanceM: 100,
  marks: [
    { kind: "sample", label: "Rubeum Bioluminescent Anemone", active: true, northM: 0, eastM: 0, distanceM: 0, ringM: 100 },
    { kind: "codex", label: "Rubeum Bioluminescent Anemone (next to sample, located from 2 scans)", active: false, northM: 300, eastM: 0, distanceM: 300, located: "crossing", target: true },
    { kind: "codex", label: "Rubeum Bioluminescent Anemone (scanned from here)", active: false, northM: -200, eastM: 0, distanceM: 200, located: "scanned-from", scanHeadingDeg: 90 },
  ],
});

describe("the radar", () => {
  it("draws the line to the next plant, a crossing's second ring, a single scan's heading and the sample ring", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    expect(drawMinimap(svg, map(), false)).toBe(true);
    const world = svg.querySelector(".mm-world")!;
    expect(world.querySelector(".minimap-target-line")).not.toBeNull();
    expect(world.querySelector(".minimap-codex--outer")).not.toBeNull();
    expect(world.querySelector(".minimap-codex--target")).not.toBeNull();
    expect(world.querySelector(".minimap-codex-heading")).not.toBeNull();
    const ring = world.querySelector(".minimap-sample-ring");
    expect(ring?.getAttribute("r")).toBe("20.0");
  });

  it("draws other species' composition scans yellow, numbers the run's samples, and gives distances a unit (P14, P15)", () => {
    const mm = map();
    mm.marks[0]!.scanNo = 2;
    mm.marks[1]!.active = true; // the run's species: green
    mm.marks.push({ kind: "codex", label: "Far plant", active: false, northM: 1500, eastM: 0, distanceM: 1500 });
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    document.body.appendChild(svg);
    drawMinimap(svg, mm, false);
    const world = svg.querySelector(".mm-world")!;
    expect(world.querySelector(".minimap-codex--target")?.classList.contains("minimap-codex--other")).toBe(false);
    expect(world.querySelectorAll("circle.minimap-codex--other")).toHaveLength(1); // the one scanned from here
    expect(world.querySelector(".minimap-codex-heading--other")).not.toBeNull();
    expect(world.querySelector(".minimap-arrow--codex-other")).not.toBeNull(); // off the map
    expect(world.querySelector(".minimap-scan-no")?.textContent).toBe("2");
    expect(world.querySelector(".minimap-far-label")?.textContent).toBe("1.5 km");
  });

  it("writes metres under a kilometre and kilometres from there", () => {
    expect([0, 640, 999.4, 999.6, 1240, 9960, 12_400].map(fmtRadarDistance)).toEqual([
      "0 m",
      "640 m",
      "999 m",
      "1.0 km",
      "1.2 km",
      "10.0 km",
      "12 km",
    ]);
  });
});
