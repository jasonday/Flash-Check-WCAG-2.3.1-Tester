// Shared flash scenarios for the demo page and the automated harness.
// Sizes are CSS px. `expect` is the correct WCAG 2.3.1 outcome.
export const SCENARIOS = [
  {
    id: 'large-10hz', name: 'Large black and white flash, 10 per second', w: 600, h: 400, hz: 10,
    a: '#000000', b: '#ffffff', expect: { general: 'fail', red: 'pass' },
    why: '240,000 CSS px flashing far above 3 per second.',
  },
  {
    id: 'small-10hz', name: 'Small flash under the area limit, 10 per second', w: 140, h: 140, hz: 10,
    a: '#000000', b: '#ffffff', expect: { general: 'pass', red: 'pass' },
    why: '19,600 CSS px is under the 21,824 px limit.',
  },
  {
    id: 'medium-10hz', name: 'Medium flash over the area limit, 10 per second', w: 200, h: 200, hz: 10,
    a: '#000000', b: '#ffffff', expect: { general: 'fail', red: 'pass' },
    why: '40,000 CSS px is over the 21,824 px limit.',
  },
  {
    id: 'large-2hz', name: 'Large slow flash, 2 per second', w: 600, h: 400, hz: 2,
    a: '#000000', b: '#ffffff', expect: { general: 'pass', red: 'pass' },
    why: '2 flashes per second is under the 3 per second limit.',
  },
  {
    id: 'red-6hz', name: 'Saturated red and grey of equal brightness, 6 per second', w: 400, h: 300, hz: 6,
    a: '#ff0000', b: '#7f7f7f', expect: { general: 'pass', red: 'fail' },
    why: 'No luminance change, but a saturated red change of more than 0.2 in u\'v\'.',
  },
  {
    id: 'bright-10hz', name: 'Flicker between white and light grey, 10 per second', w: 600, h: 400, hz: 10,
    a: '#e8e8e8', b: '#ffffff', expect: { general: 'pass', red: 'pass' },
    why: 'The darker state is above 0.80 relative luminance.',
  },
  {
    id: 'checker-10hz', name: 'Fine 2 px checkerboard inverting, 10 per second', w: 400, h: 300, hz: 10,
    a: '#000000', b: '#ffffff', checker: 2, expect: { general: 'pass', red: 'pass' },
    why: 'Squares smaller than 0.1 degree are not a flash under WCAG.',
  },
];

// Paints scenario `sc` at time `t` (ms) into a 2D context at (x, y).
export function paint(ctx, sc, t, x = 0, y = 0) {
  const phase = Math.floor((t / 1000) * sc.hz * 2) % 2;
  if (!sc.checker) {
    ctx.fillStyle = phase ? sc.b : sc.a;
    ctx.fillRect(x, y, sc.w, sc.h);
    return;
  }
  const c = sc.checker;
  for (let yy = 0; yy < sc.h; yy += c) {
    for (let xx = 0; xx < sc.w; xx += c) {
      const on = ((xx / c + yy / c) & 1) ^ phase;
      ctx.fillStyle = on ? sc.b : sc.a;
      ctx.fillRect(x + xx, y + yy, c, c);
    }
  }
}
