// Writes icons/icon{16,32,48,128}.png with no dependencies: a dark blue
// rounded square with a white lightning bolt, rasterized with 4x4 supersampling.
import { writeFileSync, mkdirSync } from 'node:fs';
import { encodePng } from './png.mjs';

const BG = [31, 58, 147];
const FG = [255, 255, 255];
// Bolt polygon in a 0..1 unit square.
const BOLT = [[0.58, 0.1], [0.27, 0.56], [0.48, 0.56], [0.4, 0.9], [0.73, 0.42], [0.52, 0.42], [0.62, 0.1]];

function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inRoundRect(x, y, r) {
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function png(size) {
  const SS = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let bg = 0;
      let fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          if (!inRoundRect(u, v, 0.2)) continue;
          if (inPoly(u, v, BOLT)) fg++;
          else bg++;
        }
      }
      const n = SS * SS;
      const a = (bg + fg) / n;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++) raw[o + c] = a ? Math.round((BG[c] * bg + FG[c] * fg) / (bg + fg)) : 0;
      raw[o + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, raw);
}

const dir = new URL('../icons/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(new URL(`icon${size}.png`, dir), png(size));
console.log('icons written');
