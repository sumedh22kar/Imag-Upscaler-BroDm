import { describe, expect, it } from "vitest";
import {
  aspectLabel,
  computeCrop,
  fitWithin,
  formatBytes,
  getPaperMm,
  maxDpiForPaper,
  mmToPx,
  paperToPixels,
  qualityVerdict,
  safeBaseName,
  sourceDensity,
} from "./print.js";

describe("print maths", () => {
  it("matches the backend rounding for A4 at 300 DPI", () => {
    expect(paperToPixels({ w: 210, h: 297 }, 300)).toEqual({ w: 2480, h: 3508 });
  });

  it("matches the backend rounding for Letter at 150 DPI", () => {
    expect(mmToPx(215.9, 150)).toBe(1275);
    expect(mmToPx(279.4, 150)).toBe(1650);
  });

  it("swaps a preset for landscape", () => {
    expect(getPaperMm({ preset: "A4", orientation: "landscape" })).toEqual({ w: 297, h: 210 });
  });

  it("converts custom sizes from inches and centimetres", () => {
    expect(getPaperMm({ preset: "CUSTOM", unit: "in", customW: "8", customH: "10" })).toEqual({ w: 203.2, h: 254 });
    expect(getPaperMm({ preset: "CUSTOM", unit: "cm", customW: "10", customH: "15" })).toEqual({ w: 100, h: 150 });
  });

  it("rejects unusable custom sizes", () => {
    expect(getPaperMm({ preset: "CUSTOM", unit: "cm", customW: "", customH: "5" })).toBeNull();
    expect(getPaperMm({ preset: "CUSTOM", unit: "cm", customW: "-2", customH: "5" })).toBeNull();
  });

  it("finds the highest DPI that keeps a sheet under the pixel cap", () => {
    const dpi = maxDpiForPaper({ w: 297, h: 420 });
    expect(mmToPx(420, dpi)).toBeLessThanOrEqual(8192);
    expect(mmToPx(420, dpi + 2)).toBeGreaterThan(8192);
  });
});

describe("fit and crop", () => {
  it("fits inside the box without distortion", () => {
    expect(fitWithin(800, 600, 3508, 2480)).toEqual({ w: 3307, h: 2480 });
    expect(fitWithin(600, 800, 2480, 3508)).toEqual({ w: 2480, h: 3307 });
  });

  it("crops to the target shape and honours the focus point", () => {
    const centre = computeCrop(800, 600, 2480, 3508);
    expect(centre.h).toBe(600);
    expect(centre.w).toBe(424);
    expect(centre.x).toBe(188);

    const left = computeCrop(800, 600, 2480, 3508, 0, 0.5);
    const right = computeCrop(800, 600, 2480, 3508, 1, 0.5);
    expect(left.x).toBe(0);
    expect(right.x).toBe(800 - right.w);
  });

  it("does not crop when the shape already matches", () => {
    expect(computeCrop(1240, 1754, 2480, 3508)).toMatchObject({ x: 0, y: 0, w: 1240, h: 1754 });
  });
});

describe("print quality", () => {
  it("measures the pixels per inch the original carries", () => {
    expect(sourceDensity(1240, 1754, 2480, 3508, 300)).toBeCloseTo(150, 5);
    expect(sourceDensity(2480, 3508, 2480, 3508, 300)).toBe(300);
  });

  it("uses the weaker axis", () => {
    expect(sourceDensity(1000, 500, 2000, 2000, 300)).toBeCloseTo(75, 5);
  });

  it("maps density to a verdict", () => {
    expect(qualityVerdict(100).id).toBe("low");
    expect(qualityVerdict(150).id).toBe("fair");
    expect(qualityVerdict(220).id).toBe("good");
    expect(qualityVerdict(300).id).toBe("great");
    expect(qualityVerdict(null)).toBeNull();
  });
});

describe("labels", () => {
  it("names common aspect ratios", () => {
    expect(aspectLabel(1600, 900)).toBe("16:9");
    expect(aspectLabel(1000, 1000)).toBe("1:1");
    expect(aspectLabel(1500, 1000)).toBe("3:2");
  });

  it("formats sizes", () => {
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1048576)).toBe("5.0 MB");
  });

  it("makes safe file names", () => {
    expect(safeBaseName("my:photo?.jpg")).toBe("my_photo_");
    expect(safeBaseName("")).toBe("image");
  });
});
