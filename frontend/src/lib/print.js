// Pure print-prep maths. No DOM, no network, so it is trivially testable.
// Rounding matches the Spring Boot PrintSizeCalculator: round(mm / 25.4 * dpi).

export const MIN_SIDE = 16;
export const MAX_SIDE = 8192;
export const MAX_UPLOAD_BYTES = 52_428_800;
export const AI_MAX_LONG_SIDE = 4096;

export const PAPERS = {
  "4x6": { label: "4×6 in", wMm: 101.6, hMm: 152.4 },
  "5x7": { label: "5×7 in", wMm: 127, hMm: 177.8 },
  "8x10": { label: "8×10 in", wMm: 203.2, hMm: 254 },
  A5: { label: "A5", wMm: 148, hMm: 210 },
  A4: { label: "A4", wMm: 210, hMm: 297 },
  A3: { label: "A3", wMm: 297, hMm: 420 },
  LETTER: { label: "Letter", wMm: 215.9, hMm: 279.4 },
  LEGAL: { label: "Legal", wMm: 215.9, hMm: 355.6 },
};

export const DPI_CHOICES = [
  { value: 72, label: "72", hint: "Screen" },
  { value: 150, label: "150", hint: "Draft" },
  { value: 300, label: "300", hint: "Print" },
  { value: 600, label: "600", hint: "Fine art" },
];

export const mmToPx = (mm, dpi) => Math.round((mm / 25.4) * dpi);
export const mmToCm = (mm) => mm / 10;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Paper size in millimetres, or null when the custom fields are not usable. */
export function getPaperMm({ preset, orientation, unit, customW, customH }) {
  if (preset === "CUSTOM") {
    const w = Number(customW);
    const h = Number(customH);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
    const k = unit === "in" ? 25.4 : 10;
    return { w: w * k, h: h * k };
  }
  const p = PAPERS[preset];
  if (!p) return null;
  return orientation === "landscape" ? { w: p.hMm, h: p.wMm } : { w: p.wMm, h: p.hMm };
}

export function paperToPixels(paperMm, dpi) {
  if (!paperMm) return null;
  return { w: mmToPx(paperMm.w, dpi), h: mmToPx(paperMm.h, dpi) };
}

/** Highest DPI at which this paper still fits under the pixel cap. */
export function maxDpiForPaper(paperMm) {
  if (!paperMm) return null;
  const longestIn = Math.max(paperMm.w, paperMm.h) / 25.4;
  return Math.floor(MAX_SIDE / longestIn);
}

/** Largest box with the source aspect ratio that fits inside the target. */
export function fitWithin(srcW, srcH, targetW, targetH) {
  if (!srcW || !srcH || !targetW || !targetH) return { w: targetW, h: targetH };
  const srcRatio = srcW / srcH;
  const targetRatio = targetW / targetH;
  return srcRatio > targetRatio
    ? { w: targetW, h: Math.round(targetW / srcRatio) }
    : { w: Math.round(targetH * srcRatio), h: targetH };
}

/** Crop rectangle (in source pixels) that fills the target aspect ratio. */
export function computeCrop(srcW, srcH, targetW, targetH, fx = 0.5, fy = 0.5) {
  const srcRatio = srcW / srcH;
  const targetRatio = targetW / targetH;
  let w = srcW;
  let h = srcH;
  if (srcRatio > targetRatio) w = Math.round(srcH * targetRatio);
  else h = Math.round(srcW / targetRatio);
  w = clamp(w, 1, srcW);
  h = clamp(h, 1, srcH);
  return {
    x: Math.round((srcW - w) * clamp(fx, 0, 1)),
    y: Math.round((srcH - h) * clamp(fy, 0, 1)),
    w,
    h,
  };
}

export function isCropNeeded(crop, srcW, srcH) {
  return crop.w < srcW || crop.h < srcH;
}

/**
 * How many source pixels land on each inch of paper.
 * Works for every sizing mode because the output tag DPI scales it:
 * a 2x upscale tagged 300 dpi means the source only carries 150 dpi of real data.
 */
export function sourceDensity(usedW, usedH, outW, outH, dpi) {
  if (!usedW || !usedH || !outW || !outH || !dpi) return null;
  return Math.min((usedW / outW) * dpi, (usedH / outH) * dpi);
}

export const VERDICTS = [
  { id: "low", min: 0, label: "Soft", note: "Will look soft up close. Fine from a distance, but upscaling can't add real detail." },
  { id: "fair", min: 150, label: "Fair", note: "Fine for posters and anything viewed from a distance." },
  { id: "good", min: 200, label: "Good", note: "Holds up for most prints at normal viewing distance." },
  { id: "great", min: 300, label: "Print-ready", note: "Sharp enough to inspect up close." },
];

export function qualityVerdict(density) {
  if (density == null) return null;
  let current = VERDICTS[0];
  for (const v of VERDICTS) if (density >= v.min) current = v;
  return { ...current, step: VERDICTS.indexOf(current) + 1, steps: VERDICTS.length };
}

export function aspectLabel(w, h) {
  if (!w || !h) return "—";
  const r = w / h;
  const known = [
    [1, "1:1"],
    [16 / 9, "16:9"],
    [9 / 16, "9:16"],
    [4 / 3, "4:3"],
    [3 / 4, "3:4"],
    [3 / 2, "3:2"],
    [2 / 3, "2:3"],
    [5 / 4, "5:4"],
    [4 / 5, "4:5"],
  ];
  for (const [value, label] of known) if (Math.abs(r - value) < 0.02) return label;
  return `${r.toFixed(2)}:1`;
}

export const formatBytes = (bytes) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export const formatCm = (mm) => `${(mm / 10).toFixed(1)}`;

export function extensionFor(format) {
  switch ((format || "").toUpperCase()) {
    case "JPEG":
    case "JPG":
      return ".jpg";
    case "WEBP":
      return ".webp";
    case "BMP":
      return ".bmp";
    case "TIFF":
    case "TIF":
      return ".tiff";
    default:
      return ".png";
  }
}

export function safeBaseName(name) {
  const base = (name || "image")
    .replace(/\.[^/.]+$/, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .split("")
    .filter((ch) => ch.charCodeAt(0) >= 32)
    .join("")
    .trim()
    .slice(0, 80);
  return base || "image";
}

/**
 * Formats a clean, readable and descriptive output filename for downloaded results.
 * E.g.:
 * - Scale: "photo-2x-3072x5504-ai.png" or "photo-2x-3072x5504.png"
 * - Paper: "photo-A4-3508x2480-300dpi.png" or "photo-4x6in-1800x1200-300dpi-ai.png"
 * - Pixels: "photo-3840x2160-300dpi.png"
 */
export function formatOutputFilename({
  originalName,
  mode = "paper",
  scale = 2,
  paperPreset = "A4",
  paperLabel,
  targetWidth,
  targetHeight,
  dpi = 300,
  model = "bicubic",
  outputFormat = "PNG",
}) {
  const base = safeBaseName(originalName);
  const ext = extensionFor(outputFormat);
  const aiTag = model === "ai_pro" ? "-ai" : "";

  if (mode === "scale") {
    const dims = targetWidth && targetHeight ? `-${targetWidth}x${targetHeight}` : "";
    return `${base}-${scale}x${dims}${aiTag}${ext}`;
  }

  if (mode === "paper") {
    let sheetTag = "custom";
    if (paperPreset !== "CUSTOM") {
      const p = PAPERS[paperPreset];
      sheetTag = p ? p.label.replace("×", "x").replace(" in", "in") : paperPreset;
    } else if (paperLabel) {
      sheetTag = paperLabel;
    }
    const dims = targetWidth && targetHeight ? `-${targetWidth}x${targetHeight}` : "";
    return `${base}-${sheetTag}${dims}-${dpi}dpi${aiTag}${ext}`;
  }

  // mode === "pixels" or fallback
  const dims = targetWidth && targetHeight ? `-${targetWidth}x${targetHeight}` : "-upscaled";
  return `${base}${dims}-${dpi}dpi${aiTag}${ext}`;
}
