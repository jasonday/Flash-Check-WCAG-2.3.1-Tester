import test from 'node:test';
import assert from 'node:assert/strict';
import { FlashAnalyzer, relativeLuminance, chromaticity, SRGB_TO_LINEAR } from '../src/engine.js';

// Analysis frame of 480 x 270 px at 2 CSS px per px = a 960 x 540 CSS viewport.
const W = 480;
const H = 270;
const CSS_PER_PX = 2;

// Builds a frame filled with `bg`, with an optional rectangle (CSS px) in `fg`.
function frame(bg, fg, rect) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) d.set([...bg, 255], i * 4);
  if (fg && rect) {
    const x0 = Math.floor(rect.x / CSS_PER_PX);
    const y0 = Math.floor(rect.y / CSS_PER_PX);
    const x1 = Math.ceil((rect.x + rect.w) / CSS_PER_PX);
    const y1 = Math.ceil((rect.y + rect.h) / CSS_PER_PX);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d.set([...fg, 255], (y * W + x) * 4);
  }
  return d;
}

// Runs `seconds` of video at `fps`; colorAt(t) returns [bg, fg, rect].
function run({ seconds = 2, fps = 60, colorAt }) {
  const a = new FlashAnalyzer({ width: W, height: H, cellPx: 2, cssPerPx: CSS_PER_PX });
  const cache = new Map();
  for (let i = 0; i < seconds * fps; i++) {
    const t = (i * 1000) / fps;
    const [bg, fg, rect] = colorAt(t);
    const key = JSON.stringify([bg, fg, rect]);
    if (!cache.has(key)) cache.set(key, frame(bg, fg, rect));
    a.pushRgba(t, cache.get(key));
  }
  return a.summary();
}

const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
// The epsilon keeps float error in frame times from shifting a toggle by a frame.
const square = (hz) => (t) => Math.floor((t / 1000) * hz * 2 + 1e-9) % 2 === 0;

test('sRGB linearization uses the WCAG 2.2 threshold', () => {
  assert.equal(SRGB_TO_LINEAR[0], 0);
  assert.ok(Math.abs(SRGB_TO_LINEAR[255] - 1) < 1e-6);
  // 10/255 = 0.0392 sits between 0.03928 and 0.04045, so it must use the linear segment.
  assert.ok(Math.abs(SRGB_TO_LINEAR[10] - 10 / 255 / 12.92) < 1e-7);
  assert.ok(Math.abs(relativeLuminance(255, 0, 0) - 0.2126) < 1e-4);
});

test('pure red has the expected u\'v\' chromaticity', () => {
  const [u, v] = chromaticity(1, 0, 0);
  assert.ok(Math.abs(u - 0.4507) < 0.001);
  assert.ok(Math.abs(v - 0.5229) < 0.001);
});

test('full screen black/white at 10 Hz fails general flash', () => {
  const r = run({ colorAt: (t) => [square(10)(t) ? WHITE : BLACK] });
  assert.equal(r.general.failed, true);
  assert.ok(r.general.peakFraction > 0.95);
  assert.ok(r.general.events[0].flashesPerSecond >= 5);
});

test('full screen at 3 flashes per second passes', () => {
  const r = run({ seconds: 3, colorAt: (t) => [square(3)(t) ? WHITE : BLACK] });
  assert.equal(r.general.failed, false);
  assert.equal(r.general.peakFraction, 0);
});

test('full screen at 4 flashes per second fails', () => {
  const r = run({ seconds: 3, colorAt: (t) => [square(4)(t) ? WHITE : BLACK] });
  assert.equal(r.general.failed, true);
});

test('flashing area under 25% of the 341 x 256 field passes', () => {
  // 140 x 140 = 19,600 CSS px, under the 21,824 px limit.
  const rect = { x: 200, y: 100, w: 140, h: 140 };
  const r = run({ colorAt: (t) => [BLACK, square(10)(t) ? WHITE : BLACK, rect] });
  assert.equal(r.general.failed, false);
  assert.ok(r.general.subThresholdPeak.fraction > 0.2 && r.general.subThresholdPeak.fraction <= 0.25);
  const box = r.general.subThresholdPeak.rect;
  assert.deepEqual([box.x, box.y, box.w, box.h], [200, 100, 140, 140]);
});

test('flashing area over 25% of the field fails and is located', () => {
  // 160 x 160 = 25,600 CSS px.
  const rect = { x: 400, y: 200, w: 160, h: 160 };
  const r = run({ colorAt: (t) => [BLACK, square(10)(t) ? WHITE : BLACK, rect] });
  assert.equal(r.general.failed, true);
  const box = r.general.events[0].rect;
  assert.deepEqual([box.x, box.y, box.w, box.h], [400, 200, 160, 160]);
});

test('bright flicker where the darker state is 0.80 or more passes', () => {
  // sRGB 232 ~ 0.807 luminance, 255 = 1.0: change > 0.1 but darker >= 0.8.
  const r = run({ colorAt: (t) => [square(10)(t) ? WHITE : [232, 232, 232]] });
  assert.ok(relativeLuminance(232, 232, 232) >= 0.8);
  assert.equal(r.general.failed, false);
});

test('luminance changes under 10% pass', () => {
  // 100 -> 0.127, 120 -> 0.188: delta 0.061.
  const r = run({ colorAt: (t) => [square(10)(t) ? [120, 120, 120] : [100, 100, 100]] });
  assert.equal(r.general.failed, false);
});

test('smooth sinusoidal fade at 5 Hz is caught across frames', () => {
  const r = run({
    colorAt: (t) => {
      const v = Math.round(127.5 + 127.5 * Math.sin((2 * Math.PI * 5 * t) / 1000));
      return [[v, v, v]];
    },
  });
  assert.equal(r.general.failed, true);
});

test('red flash with no luminance change fails red only', () => {
  // Pure red (L = 0.2126) against a grey of nearly equal luminance.
  const grey = [127, 127, 127];
  assert.ok(Math.abs(relativeLuminance(...grey) - 0.2126) < 0.01);
  const r = run({ colorAt: (t) => [square(6)(t) ? [255, 0, 0] : grey] });
  assert.equal(r.red.failed, true);
  assert.equal(r.general.failed, false);
});

test('blue/grey chromatic flicker is not a red flash', () => {
  const r = run({ colorAt: (t) => [square(6)(t) ? [0, 0, 255] : [60, 60, 60]] });
  assert.equal(r.red.failed, false);
});

test('irregular frame timing still counts transitions in real time', () => {
  // Frames arrive in clumps (as tab capture does); 10 Hz flashing for 2 s.
  const a = new FlashAnalyzer({ width: W, height: H });
  const w = frame(WHITE);
  const b = frame(BLACK);
  let t = 0;
  while (t < 2000) {
    a.pushRgba(t, square(10)(t) ? w : b);
    t += 20 + (Math.floor(t) % 3) * 7;
  }
  assert.equal(a.summary().general.failed, true);
});

test('static content produces no flashing', () => {
  const r = run({ colorAt: () => [WHITE, BLACK, { x: 0, y: 0, w: 300, h: 300 }] });
  assert.equal(r.general.failed, false);
  assert.equal(r.red.failed, false);
  assert.equal(r.stats.changedFrames, 0);
});

test('fine checkerboard inversion passes but still counts as page activity', () => {
  const a = new FlashAnalyzer({ width: W, height: H });
  const board = (phase) => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) d.fill(((x + y) & 1) ^ phase ? 255 : 0, (y * W + x) * 4, (y * W + x) * 4 + 3);
    return d;
  };
  const f = [board(0), board(1)];
  for (let i = 0; i < 120; i++) a.pushRgba((i * 1000) / 60, f[Math.floor(i / 3) % 2]);
  const r = a.summary();
  assert.equal(r.general.failed, false);
  assert.ok(r.stats.changedFrames > 30);
});
