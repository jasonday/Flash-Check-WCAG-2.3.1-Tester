// Writes test-pages/sample-report.json: a synthetic run with one general flash
// failure and one red flash failure, for previewing the report page with
// report.html?file=../test-pages/sample-report.json
import { writeFileSync } from 'node:fs';
import { FlashAnalyzer } from '../src/engine.js';
import { verdict } from '../src/verdict.js';
import { rgbaToPng } from './png.mjs';

const VIEW = { width: 1280, height: 720, dpr: 2 };
const W = VIEW.width / 2;
const H = VIEW.height / 2;
const a = new FlashAnalyzer({ width: W, height: H });

function fillRect(d, x, y, w, h, [r, g, b]) {
  for (let yy = Math.floor(y / 2); yy < Math.ceil((y + h) / 2); yy++) {
    for (let xx = Math.floor(x / 2); xx < Math.ceil((x + w) / 2); xx++) d.set([r, g, b, 255], (yy * W + xx) * 4);
  }
}

// A light page with a header bar, a 10 Hz banner from 1 to 4 s, and a red
// alert box flashing at 6 Hz from 5 to 7 s.
function render(t) {
  const d = new Uint8ClampedArray(W * H * 4);
  fillRect(d, 0, 0, VIEW.width, VIEW.height, [246, 247, 249]);
  fillRect(d, 0, 0, VIEW.width, 64, [31, 58, 147]);
  for (let i = 0; i < 6; i++) fillRect(d, 80, 420 + i * 36, 520, 14, [200, 204, 210]);
  const on = (hz) => Math.floor((t / 1000) * hz * 2 + 1e-9) % 2 === 1;
  fillRect(d, 80, 110, 520, 260, t > 1000 && t < 4000 && on(10) ? [255, 255, 255] : [20, 20, 20]);
  fillRect(d, 760, 140, 360, 220, t > 5000 && t < 7000 && on(6) ? [255, 0, 0] : [127, 127, 127]);
  return d;
}

const snaps = new Map();
for (let i = 0; i < 9 * 60; i++) {
  const t = (i * 1000) / 60;
  const frame = render(t);
  const r = a.pushRgba(t, frame);
  for (const { type, index } of r.peakChanged) snaps.set(`${type}:${index}`, frame);
}

const result = a.summary();
for (const type of ['general', 'red']) {
  result[type].events.forEach((ev, i) => {
    const f = snaps.get(`${type}:${i}`);
    if (f) ev.snapshot = `data:image/png;base64,${rgbaToPng(W, H, f).toString('base64')}`;
    ev.elements = type === 'red'
      ? [{ selector: 'div.alert-banner', tag: 'div', label: 'Sale ends soon', animated: true }]
      : [{ selector: 'section.hero > video', tag: 'video', label: 'promo.mp4', animated: false }];
    ev.duringScroll = false;
  });
}
const run = {
  id: 'sample',
  url: 'https://example.com/sample-page',
  title: 'Sample page (synthetic data)',
  viewport: VIEW,
  pageInfo: { sources: [{ kind: 'video', selector: 'section.hero > video', label: 'promo.mp4' }, { kind: 'animation, 166 ms cycle', selector: 'div.alert-banner', label: '' }] },
  navigatedAway: false,
  scrollCount: 0,
  ...result,
  stopReason: 'duration',
  startedAt: Date.UTC(2026, 9, 22, 15, 0, 0),
};
run.verdict = verdict(run);
writeFileSync(new URL('../test-pages/sample-report.json', import.meta.url), JSON.stringify(run));
console.log(run.verdict, result.general.events.length, result.red.events.length);
