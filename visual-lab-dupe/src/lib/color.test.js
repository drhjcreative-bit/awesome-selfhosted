import { describe, it, expect } from "vitest";
import { hexToRgb, hslToRgb } from "./color.js";

describe("hexToRgb", () => {
  it("parses a 6-digit hex with a leading #", () => {
    expect(hexToRgb("#00f0ff")).toEqual([0, 240, 255]);
  });

  it("parses a 6-digit hex without a leading #", () => {
    expect(hexToRgb("ff8800")).toEqual([255, 136, 0]);
  });

  it("is case-insensitive", () => {
    expect(hexToRgb("#AABBCC")).toEqual([170, 187, 204]);
    expect(hexToRgb("#aabbcc")).toEqual([170, 187, 204]);
  });

  it("parses black and white at the boundaries", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#ffffff")).toEqual([255, 255, 255]);
  });

  it("falls back to default cyan for 3-digit shorthand (unsupported)", () => {
    // Documents a real limitation: the regex only accepts 6-digit hex.
    expect(hexToRgb("#fff")).toEqual([0, 240, 255]);
  });

  it("falls back to default cyan for unparseable input", () => {
    expect(hexToRgb("")).toEqual([0, 240, 255]);
    expect(hexToRgb("rebeccapurple")).toEqual([0, 240, 255]);
    expect(hexToRgb("#12345")).toEqual([0, 240, 255]);
    expect(hexToRgb("#gggggg")).toEqual([0, 240, 255]);
  });
});

describe("hslToRgb", () => {
  // Sample the six 60° hue sextants at full saturation, mid lightness. Each
  // exercises a different branch of the sextant selection.
  const cases = [
    [0, [255, 0, 0]], // red
    [60, [255, 255, 0]], // yellow
    [120, [0, 255, 0]], // green
    [180, [0, 255, 255]], // cyan
    [240, [0, 0, 255]], // blue
    [300, [255, 0, 255]], // magenta
  ];

  it.each(cases)("maps hue %i (s=1,l=0.5) to a primary/secondary", (h, rgb) => {
    const [r, g, b] = hslToRgb(h, 1, 0.5).map(Math.round);
    expect([r, g, b]).toEqual(rgb);
  });

  it("returns gray when saturation is 0 regardless of hue", () => {
    const [r, g, b] = hslToRgb(200, 0, 0.5).map(Math.round);
    expect([r, g, b]).toEqual([128, 128, 128]);
  });

  it("returns black at lightness 0 and white at lightness 1", () => {
    expect(hslToRgb(120, 1, 0).map(Math.round)).toEqual([0, 0, 0]);
    expect(hslToRgb(120, 1, 1).map(Math.round)).toEqual([255, 255, 255]);
  });

  it("wraps hue at 360 back to 0 (red)", () => {
    expect(hslToRgb(360, 1, 0.5).map(Math.round)).toEqual(
      hslToRgb(0, 1, 0.5).map(Math.round),
    );
  });

  it("wraps hues above 360", () => {
    expect(hslToRgb(420, 1, 0.5).map(Math.round)).toEqual(
      hslToRgb(60, 1, 0.5).map(Math.round),
    );
  });

  it("wraps negative hues into range", () => {
    // -60 should behave like 300 (magenta).
    expect(hslToRgb(-60, 1, 0.5).map(Math.round)).toEqual([255, 0, 255]);
  });

  it("keeps every channel within [0, 255]", () => {
    for (let h = 0; h < 360; h += 17) {
      for (const l of [0.1, 0.4, 0.6, 0.9]) {
        for (const channel of hslToRgb(h, 0.8, l)) {
          expect(channel).toBeGreaterThanOrEqual(0);
          expect(channel).toBeLessThanOrEqual(255);
        }
      }
    }
  });
});
