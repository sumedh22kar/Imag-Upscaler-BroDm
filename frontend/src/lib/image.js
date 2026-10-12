// Browser-side image helpers: probing files the browser may not decode,
// fixing EXIF rotation, and cropping before upload.

import { MAX_UPLOAD_BYTES } from "./print.js";

export const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"];
export const ALLOWED_MIME_TYPES = [
  "image/png",
  "image/x-png",
  "image/jpeg",
  "image/jpg",
  "image/pjpeg",
  "image/jfif",
  "image/webp",
  "image/bmp",
  "image/x-ms-bmp",
  "image/tiff",
  "image/tif",
];

export function isSupportedFile(file) {
  const name = (file?.name || "").toLowerCase();
  const okExt = ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  const okMime = file?.type && ALLOWED_MIME_TYPES.includes(file.type.toLowerCase());
  return Boolean(okExt || okMime);
}

export function isTiff(file) {
  const name = (file?.name || "").toLowerCase();
  return /tiff?$/.test(name) || /tiff?$/.test(file?.type || "");
}

/**
 * Browsers other than Safari cannot decode TIFF, so we read the width and
 * height straight out of the first IFD instead of giving up on the file.
 */
export async function readTiffSize(file) {
  try {
    const head = new DataView(await file.slice(0, 8).arrayBuffer());
    const le = head.getUint16(0) === 0x4949;
    if (head.getUint16(2, le) !== 42) return null;
    const ifd = head.getUint32(4, le);
    const count = new DataView(await file.slice(ifd, ifd + 2).arrayBuffer()).getUint16(0, le);
    const entries = new DataView(await file.slice(ifd + 2, ifd + 2 + count * 12).arrayBuffer());
    let width = 0;
    let height = 0;
    for (let i = 0; i < count; i++) {
      const o = i * 12;
      const tag = entries.getUint16(o, le);
      const type = entries.getUint16(o + 2, le);
      const value = type === 3 ? entries.getUint16(o + 8, le) : entries.getUint32(o + 8, le);
      if (tag === 256) width = value;
      if (tag === 257) height = value;
    }
    return width && height ? { width, height } : null;
  } catch {
    return null;
  }
}

/** Resolves with the decoded size, or rejects when the browser cannot decode the file. */
export function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("decode failed"));
    img.src = url;
  });
}

/**
 * The browser shows photos upright using EXIF, but the server reads raw pixels.
 * When the two disagree the file has to be re-drawn upright before upload.
 */
export async function hasExifRotation(file, displayW, displayH) {
  if (typeof createImageBitmap !== "function") return false;
  try {
    const raw = await createImageBitmap(file, { imageOrientation: "none" });
    const rotated = raw.width !== displayW || raw.height !== displayH;
    raw.close?.();
    return rotated;
  } catch {
    return false;
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

/**
 * Draws the crop rectangle (source pixels, upright) to a lossless PNG.
 * Falls back to near-lossless JPEG only when PNG would break the upload cap.
 */
export async function renderCrop(file, crop) {
  const bitmap =
    typeof createImageBitmap === "function"
      ? await createImageBitmap(file)
      : await new Promise((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("decode failed"));
          img.src = URL.createObjectURL(file);
        });

  const canvas = document.createElement("canvas");
  canvas.width = crop.w;
  canvas.height = crop.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser could not prepare the crop.");
  ctx.drawImage(bitmap, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  bitmap.close?.();

  let blob = await canvasToBlob(canvas, "image/png");
  let ext = ".png";
  if (blob && blob.size > MAX_UPLOAD_BYTES * 0.95) {
    blob = await canvasToBlob(canvas, "image/jpeg", 0.97);
    ext = ".jpg";
  }
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error("This browser could not prepare the crop.");
  return { blob, ext };
}

export function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/:(.*?);/)?.[1] || "application/octet-stream";
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
