'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'build');
fs.mkdirSync(OUT_DIR, { recursive: true });

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (width * 4 + 1);
    rows[rowStart] = 0;
    rgba.copy(rows, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(rows, { level: 9 });
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function insideRoundedRect(x, y, half, radius) {
  const qx = Math.abs(x) - (half - radius);
  const qy = Math.abs(y) - (half - radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius <= 0;
}

function insideTriangle(x, y) {
  const ax = 0.355;
  const ay = 0.292;
  const bx = 0.735;
  const by = 0.5;
  const cx = 0.355;
  const cy = 0.708;

  const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
  const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
  const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 3;
  const half = 0.5 - 0.012;
  const radius = 0.225;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let count = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = (x + (sx + 0.5) / samples) / size - 0.5;
          const py = (y + (sy + 0.5) / samples) / size - 0.5;
          count += 1;

          if (!insideRoundedRect(px, py, half, radius)) continue;

          const t = Math.min(1, Math.max(0, (px + py + 0.5) / 1.4));
          let cr = lerp(0x74, 0x2b, t);
          let cg = lerp(0xf4, 0xb7, t);
          let cb = lerp(0xd6, 0xd8, t);

          const shine = Math.max(0, 1 - Math.hypot(px + 0.22, py + 0.27) * 2.4) * 0.16;
          cr = lerp(cr, 255, shine);
          cg = lerp(cg, 255, shine);
          cb = lerp(cb, 255, shine);

          if (insideTriangle(px, py)) {
            cr = 0x07;
            cg = 0x16;
            cb = 0x1d;
          }

          r += cr;
          g += cg;
          b += cb;
          a += 255;
        }
      }

      const index = (y * size + x) * 4;
      rgba[index] = Math.round(r / count);
      rgba[index + 1] = Math.round(g / count);
      rgba[index + 2] = Math.round(b / count);
      rgba[index + 3] = Math.round(a / count);
    }
  }

  return encodePng(size, size, rgba);
}

function buildIco(png, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

const icon512 = renderIcon(512);
const icon256 = renderIcon(256);
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), icon512);
fs.writeFileSync(path.join(OUT_DIR, 'icon.ico'), buildIco(icon256, 256));
fs.writeFileSync(path.join(OUT_DIR, 'icon-256.png'), icon256);

console.log('icons written:', {
  png: path.join(OUT_DIR, 'icon.png'),
  ico: path.join(OUT_DIR, 'icon.ico'),
  pngBytes: icon512.length,
  icoBytes: fs.statSync(path.join(OUT_DIR, 'icon.ico')).size,
});
