import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';

/**
 * Standard CRC32 calculation for PNG chunks
 */
function crc32(buf) {
  let crc = -1;
  for (let b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (-(crc & 1) & 0xEDB88320);
    }
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

/**
 * Programmatically create a valid PNG buffer with customizable dimensions and colors
 */
export function createPngBuffer(width = 120, height = 80, withAlpha = true) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const row = Buffer.alloc(1 + width * 4);
  row[0] = 0; // None filter
  for (let x = 0; x < width; x++) {
    const isTopHalf = true;
    row[1 + x * 4] = (x * 2) % 255; // R
    row[1 + x * 4 + 1] = 120;       // G
    row[1 + x * 4 + 2] = 220;       // B
    row[1 + x * 4 + 3] = withAlpha && x < width / 2 ? 180 : 255; // Alpha
  }

  const raw = Buffer.concat(Array(height).fill(row));
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Write a temporary fixture image to OS temp directory
 */
export function writeTempFixture(filename, buffer) {
  const tmpDir = path.join(os.tmpdir(), 'pixelperfect-e2e');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Inspect PNG header and extract natural width & height
 */
export function parsePngDimensions(buffer) {
  // Check PNG signature
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (buffer[i] !== sig[i]) throw new Error(`Invalid PNG signature at byte ${i}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
}

/**
 * Check JPEG signature (FF D8 FF)
 */
export function isJpegSignature(buffer) {
  return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

/**
 * Cleanup temp fixture directory
 */
export function cleanupTempFixtures() {
  const tmpDir = path.join(os.tmpdir(), 'pixelperfect-e2e');
  if (fs.existsSync(tmpDir)) {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup error
    }
  }
}
