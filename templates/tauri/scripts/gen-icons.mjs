#!/usr/bin/env node
// 生成内置图标（纯 Node，无第三方库、无外链）：1024 源图 → PNG / ICO。
// 用法：node scripts/gen-icons.mjs [--out src-tauri/icons]
// 换成自己的图标：把 1024×1024 的 PNG 放到 src-tauri/app-icon.png，
// 再执行 `npm run icons`（优先用 Tauri CLI 的 `tauri icon`，失败时回退到本脚本）。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const INK = [0x20, 0x24, 0x2a];
const PAPER = [0xf4, 0xf0, 0xe6];
const ACCENT = [0x3e, 0x6a, 0x56];

function roundedRectCoverage(x, y, size, radius) {
  const inset = 40;
  const left = inset;
  const right = size - inset;
  const top = inset;
  const bottom = size - inset;
  if (x < left || x > right || y < top || y > bottom) return 0;
  const r = radius;
  const cx = x < left + r ? left + r : x > right - r ? right - r : x;
  const cy = y < top + r ? top + r : y > bottom - r ? bottom - r : y;
  const dx = x - cx;
  const dy = y - cy;
  if (Math.hypot(dx, dy) > r) return 0;
  return 1;
}

function bandPoints(cx, y, half, height, skew) {
  return [
    [cx - half + skew, y],
    [cx + half + skew, y],
    [cx + half - skew, y + height],
    [cx - half - skew, y + height],
  ];
}

function inPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i, i += 1) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function renderSource(size) {
  const bands = [
    { y: 250, half: 300, h: 120, color: PAPER, skew: 26 },
    { y: 470, half: 340, h: 120, color: ACCENT, skew: 30 },
    { y: 690, half: 380, h: 120, color: PAPER, skew: 34 },
  ];
  const pts = bands.map((b) => bandPoints(size / 2, b.y * (size / 1024), b.half * (size / 1024), b.h * (size / 1024), b.skew * (size / 1024)));
  const buf = Buffer.alloc(size * size * 4);
  const SS = 2; // 2×2 超采样做抗锯齿
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const bg = roundedRectCoverage(px, py, size, 180 * (size / 1024));
          if (bg === 0) continue;
          let color = INK;
          for (let i = 0; i < bands.length; i += 1) {
            if (inPolygon(px, py, pts[i])) { color = bands[i].color; break; }
          }
          r += color[0]; g += color[1]; b += color[2]; a += 255;
        }
      }
      const n = SS * SS;
      const idx = (y * size + x) * 4;
      buf[idx] = Math.round(r / n);
      buf[idx + 1] = Math.round(g / n);
      buf[idx + 2] = Math.round(b / n);
      buf[idx + 3] = Math.round(a / n);
    }
  }
  return buf;
}

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function downscale(rgba, from, to) {
  const out = Buffer.alloc(to * to * 4);
  const ratio = from / to;
  for (let y = 0; y < to; y += 1) {
    for (let x = 0; x < to; x += 1) {
      const y0 = Math.floor(y * ratio);
      const y1 = Math.min(from, Math.ceil((y + 1) * ratio));
      const x0 = Math.floor(x * ratio);
      const x1 = Math.min(from, Math.ceil((x + 1) * ratio));
      let r = 0; let g = 0; let b = 0; let a = 0;
      let count = 0;
      for (let sy = y0; sy < y1; sy += 1) {
        for (let sx = x0; sx < x1; sx += 1) {
          const idx = (sy * from + sx) * 4;
          r += rgba[idx]; g += rgba[idx + 1]; b += rgba[idx + 2]; a += rgba[idx + 3];
          count += 1;
        }
      }
      const idx = (y * to + x) * 4;
      out[idx] = Math.round(r / count);
      out[idx + 1] = Math.round(g / count);
      out[idx + 2] = Math.round(b / count);
      out[idx + 3] = Math.round(a / count);
    }
  }
  return out;
}

function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const img of images) {
    const e = Buffer.alloc(16);
    e[0] = img.size >= 256 ? 0 : img.size;
    e[1] = img.size >= 256 ? 0 : img.size;
    e[2] = 0;
    e[3] = 0;
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.resolve(root, 'src-tauri/icons');
  fs.mkdirSync(outDir, { recursive: true });

  const source = renderSource(1024);
  const sizes = [1024, 512, 256, 128, 96, 64, 48, 32, 16];
  const cache = new Map();
  cache.set(1024, source);
  for (const size of sizes.slice(1)) cache.set(size, downscale(source, 1024, size));
  const png = (size) => encodePng(cache.get(size), size);

  const write = (name, data) => {
    fs.writeFileSync(path.join(outDir, name), data);
    return data;
  };

  const entry = (size) => ({ size, data: png(size) });

  write('app-icon.png', png(1024));
  write('icon.png', png(512));
  write('32x32.png', png(32));
  write('128x128.png', png(128));
  write('128x128@2x.png', png(256));
  write('icon.ico', encodeIco([32, 48, 64, 128, 256].map(entry)));

  console.log(`图标已生成：${path.relative(root, outDir)}（含 app-icon.png 1024×1024、PNG 多尺寸、ICO）`);
}

main();
