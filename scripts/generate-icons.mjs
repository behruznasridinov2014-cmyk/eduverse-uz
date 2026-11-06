/**
 * Generates the PWA/iOS PNG icons for EDUVERSE-UZ without any dependencies.
 * Draws a rounded square with a vertical gradient and a bold white "E" built
 * from rectangles, then writes a valid PNG (zlib deflate).
 *
 * Run: node scripts/generate-icons.mjs
 */
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "..", "artifacts", "eduverse-uz", "public");

function roundedRectRadius(size) {
  return Math.round(size * 0.22);
}

function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);

  const top = [0x37, 0x4f, 0x68]; // #374f68
  const bottom = [0x14, 0x1e, 0x2a]; // #141e2a

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const radius = roundedRectRadius(size);
      // Rounded-rect mask
      const rx = Math.min(Math.max(x, radius), size - radius);
      const ry = Math.min(Math.max(y, radius), size - radius);
      const dx = x - rx;
      const dy = y - ry;
      const inside = dx * dx + dy * dy <= radius * radius || (x >= radius && x < size - radius) || (y >= radius && y < size - radius);
      if (!inside) {
        px[i + 3] = 0; // transparent
        continue;
      }
      const t = y / (size - 1);
      px[i] = Math.round(top[0] + (bottom[0] - top[0]) * t);
      px[i + 1] = Math.round(top[1] + (bottom[1] - top[1]) * t);
      px[i + 2] = Math.round(top[2] + (bottom[2] - top[2]) * t);
      px[i + 3] = 255;
    }
  }

  // Bold "E" from rectangles
  const white = [0xf2, 0xf5, 0xf7, 255];
  const rect = (x, y, w, h) => {
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const i = (yy * size + xx) * 4;
        px[i] = white[0];
        px[i + 1] = white[1];
        px[i + 2] = white[2];
        px[i + 3] = 255;
      }
    }
  };

  const m = Math.round(size * 0.27); // horizontal margin
  const barH = Math.round(size * 0.065); // stroke width
  const left = m;
  const vertW = barH;
  const mid = size / 2;
  const topY = Math.round(size * 0.26);
  const midY = Math.round(mid - barH / 2);
  const botY = Math.round(size - size * 0.26) - barH;
  rect(left, topY, Math.round(size * 0.46), barH); // top bar
  rect(left, midY, Math.round(size * 0.38), barH); // middle bar
  rect(left, botY, Math.round(size * 0.46), barH); // bottom bar
  rect(left, topY, vertW, botY + barH - topY); // vertical stem

  return px;
}

function crc32Bytes(buffer) {
  if (typeof crc32 === "function") return crc32(buffer);
  // Fallback CRC-32 (IEEE)
  let crc = ~0;
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (~crc) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32Bytes(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(rgba, size) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  // Filter type 0 per scanline
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y += 1) {
    raw[y * stride] = 0;
    for (let x = 0; x < size * 4; x += 1) {
      raw[y * stride + 1 + x] = rgba[y * size * 4 + x];
    }
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const targets = [
  { size: 180, name: "apple-touch-icon.png" },
  { size: 192, name: "icon-192.png" },
  { size: 512, name: "icon-512.png" },
  { size: 512, name: "icon-maskable-512.png" },
  { size: 256, name: "icon-256.png" },
];

mkdirSync(outDir, { recursive: true });
for (const target of targets) {
  const png = encodePNG(drawIcon(target.size), target.size);
  writeFileSync(path.join(outDir, target.name), png);
  console.log(`wrote ${target.name} (${target.size}px, ${png.length} bytes)`);
}
