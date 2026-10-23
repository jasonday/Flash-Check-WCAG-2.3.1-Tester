// WCAG 2.2 Success Criterion 2.3.1 (Three Flashes or Below Threshold) analysis engine.
//
// Pure module with no browser dependencies so it can run in the extension's
// offscreen document, in a test page, or in Node for unit tests.
//
// Method, in short:
//   1. Each frame is reduced to a grid of small cells (about 4 x 4 CSS px).
//      Pixel values are linearized before averaging, so a cell's luminance is
//      physically correct. Detail smaller than a cell averages out, which
//      matches the Understanding document's note that checkerboards with
//      squares under 0.1 degree (about 3.4 CSS px) are not a violation.
//   2. Every cell runs two state machines: one for general flash transitions
//      (relative luminance) and one for red flash transitions (CIE 1976 u'v'
//      chromaticity with a saturated red end state).
//   3. A cell is "flashing too fast" when it has had more than 6 transitions
//      (more than 3 flashes) inside the trailing one-second window.
//   4. On every frame a 341 x 256 CSS px window (the 10 degree visual field)
//      is slid across the grid. If the fast-flashing cells inside any window
//      cover more than 25% of it, that frame fails.

export const WCAG22 = Object.freeze({
  // General flash: opposing changes of 10% or more of max relative luminance,
  // where the darker state is below 0.80.
  LUMINANCE_DELTA: 0.1,
  DARKER_MAX: 0.8,
  // Red flash (WCAG 2.2 working definition): one state has R/(R+G+B) >= 0.8
  // and the two states differ by more than 0.2 in CIE 1976 u'v'.
  RED_RATIO_MIN: 0.8,
  RED_CHROMA_DELTA: 0.2,
  // A flash is two opposing transitions. "No more than three flashes" in any
  // one second means a 7th transition inside one second fails. This matches
  // the counting used by EA's IRIS and is the conservative reading.
  MAX_TRANSITIONS_PER_WINDOW: 6,
  WINDOW_MS: 1000,
  // 10 degree visual field, expressed in CSS px, and the share of it that
  // may flash concurrently (25%, or 21,824 CSS px).
  FIELD_CSS_W: 341,
  FIELD_CSS_H: 256,
  FIELD_AREA_FRACTION: 0.25,
});

// Linear R+G+B below this is treated as black, which has no meaningful
// chromaticity. Without it, near-black pixels with a slight red cast would
// count as "saturated red". Implementation choice, not part of WCAG.
export const RED_MIN_LINEAR_SUM = 0.01;

// D65 white point in u'v', used for black and other achromatic states.
const WHITE_U = 0.1978;
const WHITE_V = 0.4683;

// How many transition timestamps each cell remembers. Must be greater than
// MAX_TRANSITIONS_PER_WINDOW; extra slots let reports show the actual rate.
const RING = 12;
const EPS = 1e-6;
const TIME_SLACK_MS = 1;

// sRGB 8-bit to linear, using the WCAG 2.2 threshold of 0.04045.
export const SRGB_TO_LINEAR = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    lut[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  return lut;
})();

export function relativeLuminance(r, g, b) {
  return 0.2126 * SRGB_TO_LINEAR[r] + 0.7152 * SRGB_TO_LINEAR[g] + 0.0722 * SRGB_TO_LINEAR[b];
}

// Linear RGB to CIE 1976 u'v' using the matrix given in the Understanding doc.
export function chromaticity(R, G, B) {
  const X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const Z = 0.0193339 * R + 0.119192 * G + 0.9503041 * B;
  const d = X + 15 * Y + 3 * Z;
  if (R + G + B < RED_MIN_LINEAR_SUM || d <= 0) return [WHITE_U, WHITE_V];
  return [(4 * X) / d, (9 * Y) / d];
}

export class FlashAnalyzer {
  /**
   * @param {object} o
   * @param {number} o.width  analysis frame width in pixels
   * @param {number} o.height analysis frame height in pixels
   * @param {number} [o.cellPx=2] analysis pixels per cell side
   * @param {number} [o.cssPerPx=2] CSS px per analysis pixel
   * @param {object} [o.thresholds=WCAG22]
   */
  constructor({ width, height, cellPx = 2, cssPerPx = 2, thresholds = WCAG22 }) {
    this.w = width;
    this.h = height;
    this.cellPx = cellPx;
    this.cssPerPx = cssPerPx;
    this.th = thresholds;
    this.cellCss = cellPx * cssPerPx;

    const cols = (this.cols = Math.ceil(width / cellPx));
    const rows = (this.rows = Math.ceil(height / cellPx));
    const n = (this.n = cols * rows);

    this.colOf = new Int32Array(width);
    for (let x = 0; x < width; x++) this.colOf[x] = Math.floor(x / cellPx);
    this.rowBase = new Int32Array(height);
    for (let y = 0; y < height; y++) this.rowBase[y] = Math.floor(y / cellPx) * cols;
    this.cellCount = new Float32Array(n);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) this.cellCount[this.rowBase[y] + this.colOf[x]]++;
    }

    this.sumR = new Float32Array(n);
    this.sumG = new Float32Array(n);
    this.sumB = new Float32Array(n);

    // General flash state machine (see updateGeneral).
    this.gExt = new Float32Array(n);
    this.gStart = new Float32Array(n);
    this.gLo = new Float32Array(n);
    this.gHi = new Float32Array(n);
    this.gDir = new Int8Array(n);
    this.gCounted = new Uint8Array(n);

    // Red flash state: the chromaticity anchor and whether it was saturated red.
    this.rU = new Float32Array(n);
    this.rV = new Float32Array(n);
    this.rRed = new Uint8Array(n);

    this.gRing = new Float64Array(n * RING).fill(-Infinity);
    this.rRing = new Float64Array(n * RING).fill(-Infinity);
    this.gHead = new Uint8Array(n);
    this.rHead = new Uint8Array(n);
    this.gFlag = new Uint8Array(n);
    this.rFlag = new Uint8Array(n);
    this.sat = new Int32Array((cols + 1) * (rows + 1));

    const th = this.th;
    this.fieldW = Math.max(1, Math.min(cols, Math.round(th.FIELD_CSS_W / this.cellCss)));
    this.fieldH = Math.max(1, Math.min(rows, Math.round(th.FIELD_CSS_H / this.cellCss)));
    this.fieldAreaCss = th.FIELD_CSS_W * th.FIELD_CSS_H;
    this.cellAreaCss = this.cellCss * this.cellCss;

    this.frames = 0;
    this.firstT = null;
    this.lastT = null;
    this.maxGapMs = 0;
    this.changedFrames = 0;
    this.timeline = [];
    this.types = {
      general: this._typeState(),
      red: this._typeState(),
    };
  }

  _typeState() {
    return { events: [], current: null, peakFraction: 0, subPeak: null };
  }

  /**
   * Analyze one RGBA frame (Uint8ClampedArray or Uint8Array, width*height*4).
   * @param {number} t frame time in milliseconds (any origin, must increase)
   * @returns {{t:number, general:object, red:object, peakChanged:Array}}
   */
  pushRgba(t, data) {
    const { w, h, sumR, sumG, sumB, colOf, rowBase } = this;
    sumR.fill(0);
    sumG.fill(0);
    sumB.fill(0);
    const L = SRGB_TO_LINEAR;
    let i = 0;
    for (let y = 0; y < h; y++) {
      const rb = rowBase[y];
      for (let x = 0; x < w; x++, i += 4) {
        const c = rb + colOf[x];
        sumR[c] += L[data[i]];
        sumG[c] += L[data[i + 1]];
        sumB[c] += L[data[i + 2]];
      }
    }
    // Pixel-level change check, so patterns that average out per cell (fine
    // checkerboards, equal-luminance color swaps) still count as activity.
    let changed = false;
    const prev = this.prevData;
    if (prev) {
      for (let j = 0; j < data.length; j++) {
        if (data[j] !== prev[j]) {
          changed = true;
          break;
        }
      }
      prev.set(data);
    } else {
      this.prevData = new Uint8Array(data);
    }
    return this._pushCells(t, changed);
  }

  _pushCells(t, changed) {
    const first = this.frames === 0;
    if (first) this.firstT = t;
    else this.maxGapMs = Math.max(this.maxGapMs, t - this.lastT);
    this.lastT = t;
    this.frames++;

    const th = this.th;
    const D = th.LUMINANCE_DELTA - EPS;
    const DARK = th.DARKER_MAX;
    const RED_D2 = th.RED_CHROMA_DELTA * th.RED_CHROMA_DELTA;
    const RED_MIN = th.RED_RATIO_MIN;
    const back = th.MAX_TRANSITIONS_PER_WINDOW + 1;
    // 1 ms of slack so float error in frame times can't turn exactly 3
    // flashes per second into a failure.
    const since = t - th.WINDOW_MS + TIME_SLACK_MS;
    const { n, sumR, sumG, sumB, cellCount } = this;
    const { gExt, gStart, gLo, gHi, gDir, gCounted, gRing, gHead, gFlag } = this;
    const { rU, rV, rRed, rRing, rHead, rFlag } = this;
    let gTotal = 0;
    let rTotal = 0;

    for (let c = 0; c < n; c++) {
      const k = cellCount[c];
      const R = sumR[c] / k;
      const G = sumG[c] / k;
      const B = sumB[c] / k;
      const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;

      // Red state: chromaticity and saturation of this cell right now.
      const S = R + G + B;
      let u = WHITE_U;
      let v = WHITE_V;
      let isRed = 0;
      if (S >= RED_MIN_LINEAR_SUM) {
        const X = 0.4124564 * R + 0.3575761 * G + 0.1804375 * B;
        const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
        const Z = 0.0193339 * R + 0.119192 * G + 0.9503041 * B;
        const d = X + 15 * Y + 3 * Z;
        u = (4 * X) / d;
        v = (9 * Y) / d;
        isRed = R / S >= RED_MIN ? 1 : 0;
      }

      if (first) {
        gExt[c] = gStart[c] = gLo[c] = gHi[c] = lum;
        gDir[c] = 0;
        rU[c] = u;
        rV[c] = v;
        rRed[c] = isRed;
        continue;
      }
      // General flash. A "leg" is a run of luminance moving in one direction.
      // The leg counts as a transition once it spans >= 0.1 with its darker
      // end below 0.8. A new leg starts only when luminance reverses by
      // >= 0.1 from the leg's extreme, so noise and small wobbles are ignored
      // and slow fades spread over many frames are still caught.
      let gHit = false;
      const dir = gDir[c];
      if (dir === 0) {
        if (lum < gLo[c]) gLo[c] = lum;
        if (lum > gHi[c]) gHi[c] = lum;
        if (lum - gLo[c] >= D) {
          gDir[c] = 1;
          gStart[c] = gLo[c];
          gExt[c] = lum;
          gHit = gStart[c] < DARK;
          gCounted[c] = gHit ? 1 : 0;
        } else if (gHi[c] - lum >= D) {
          gDir[c] = -1;
          gStart[c] = gHi[c];
          gExt[c] = lum;
          gHit = lum < DARK;
          gCounted[c] = gHit ? 1 : 0;
        }
      } else if ((lum - gExt[c]) * dir >= 0) {
        gExt[c] = lum;
        if (!gCounted[c] && Math.abs(lum - gStart[c]) >= D && Math.min(lum, gStart[c]) < DARK) {
          gHit = true;
          gCounted[c] = 1;
        }
      } else if (Math.abs(gExt[c] - lum) >= D) {
        gDir[c] = -dir;
        gStart[c] = gExt[c];
        gExt[c] = lum;
        gHit = Math.min(lum, gStart[c]) < DARK;
        gCounted[c] = gHit ? 1 : 0;
      }
      if (gHit) {
        gRing[c * RING + gHead[c]] = t;
        gHead[c] = (gHead[c] + 1) % RING;
      }
      // Cell is flashing too fast if the transition `back` steps ago is
      // inside the current one-second window.
      const gf = gRing[c * RING + ((gHead[c] - back + RING) % RING)] > since ? 1 : 0;
      gFlag[c] = gf;
      gTotal += gf;

      // Red flash. Re-anchor whenever chromaticity moves more than 0.2 from
      // the anchor; that move is a red transition if either end is saturated
      // red. Alternating red/non-red states therefore yield opposing pairs.
      const du = u - rU[c];
      const dv = v - rV[c];
      if (du * du + dv * dv > RED_D2) {
        if (isRed || rRed[c]) {
          rRing[c * RING + rHead[c]] = t;
          rHead[c] = (rHead[c] + 1) % RING;
        }
        rU[c] = u;
        rV[c] = v;
        rRed[c] = isRed;
      } else if (isRed) {
        rRed[c] = 1;
      }
      const rf = rRing[c * RING + ((rHead[c] - back + RING) % RING)] > since ? 1 : 0;
      rFlag[c] = rf;
      rTotal += rf;
    }
    if (changed) this.changedFrames++;

    const general = gTotal ? this._bestWindow(this.gFlag) : { cells: 0, x: 0, y: 0 };
    const red = rTotal ? this._bestWindow(this.rFlag) : { cells: 0, x: 0, y: 0 };
    general.fraction = (general.cells * this.cellAreaCss) / this.fieldAreaCss;
    red.fraction = (red.cells * this.cellAreaCss) / this.fieldAreaCss;

    const peakChanged = [];
    this._track('general', general, t, this.gFlag, this.gRing, peakChanged);
    this._track('red', red, t, this.rFlag, this.rRing, peakChanged);

    const bucket = Math.floor((t - this.firstT) / 100);
    const tl = this.timeline;
    if (!tl.length || tl[tl.length - 1].b !== bucket) {
      tl.push({ b: bucket, g: general.fraction, r: red.fraction });
    } else {
      const last = tl[tl.length - 1];
      last.g = Math.max(last.g, general.fraction);
      last.r = Math.max(last.r, red.fraction);
    }

    return { t, general, red, peakChanged };
  }

  // Slide the visual-field window over a flag grid with a summed-area table
  // and return the window position holding the most flagged cells.
  _bestWindow(flags) {
    const { cols, rows, sat, fieldW, fieldH } = this;
    const W = cols + 1;
    for (let y = 0; y < rows; y++) {
      let rowSum = 0;
      const o = (y + 1) * W;
      const p = y * W;
      const f = y * cols;
      for (let x = 0; x < cols; x++) {
        rowSum += flags[f + x];
        sat[o + x + 1] = sat[p + x + 1] + rowSum;
      }
    }
    let best = -1;
    let bx = 0;
    let by = 0;
    for (let y = 0; y + fieldH <= rows; y++) {
      const top = y * W;
      const bot = (y + fieldH) * W;
      for (let x = 0; x + fieldW <= cols; x++) {
        const s = sat[bot + x + fieldW] - sat[top + x + fieldW] - sat[bot + x] + sat[top + x];
        if (s > best) {
          best = s;
          bx = x;
          by = y;
        }
      }
    }
    return { cells: Math.max(0, best), x: bx, y: by };
  }

  // Bounding box (CSS px) of the flashing region that the best window found:
  // every flagged cell connected to a flagged cell inside the window. Gaps of
  // one cell are bridged so text or borders inside a flashing area don't split it.
  _bbox(flags, win) {
    const { cols, rows, fieldW, fieldH, cellCss } = this;
    if (!this._seen) {
      this._seen = new Uint8Array(this.n);
      this._queue = new Int32Array(this.n);
    }
    const seen = this._seen;
    const queue = this._queue;
    seen.fill(0);
    let head = 0;
    let tail = 0;
    for (let y = win.y; y < win.y + fieldH; y++) {
      for (let x = win.x; x < win.x + fieldW; x++) {
        const c = y * cols + x;
        if (flags[c]) {
          seen[c] = 1;
          queue[tail++] = c;
        }
      }
    }
    if (!tail) return null;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    while (head < tail) {
      const c = queue[head++];
      const cx = c % cols;
      const cy = (c - cx) / cols;
      if (cx < x0) x0 = cx;
      if (cx > x1) x1 = cx;
      if (cy < y0) y0 = cy;
      if (cy > y1) y1 = cy;
      for (let dy = -2; dy <= 2; dy++) {
        const ny = cy + dy;
        if (ny < 0 || ny >= rows) continue;
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          if (nx < 0 || nx >= cols) continue;
          const nc = ny * cols + nx;
          if (flags[nc] && !seen[nc]) {
            seen[nc] = 1;
            queue[tail++] = nc;
          }
        }
      }
    }
    const vw = this.w * this.cssPerPx;
    const vh = this.h * this.cssPerPx;
    const x = x0 * cellCss;
    const y = y0 * cellCss;
    return {
      x,
      y,
      w: Math.min(vw, (x1 + 1) * cellCss) - x,
      h: Math.min(vh, (y1 + 1) * cellCss) - y,
    };
  }

  // Highest transition count in the last second among flagged cells of a window.
  _maxTransitions(flags, ring, win, t) {
    const { cols, fieldW, fieldH } = this;
    const since = t - this.th.WINDOW_MS + TIME_SLACK_MS;
    let max = 0;
    for (let y = win.y; y < win.y + fieldH; y++) {
      for (let x = win.x; x < win.x + fieldW; x++) {
        const c = y * cols + x;
        if (!flags[c]) continue;
        let count = 0;
        for (let k = 0; k < RING; k++) if (ring[c * RING + k] > since) count++;
        if (count > max) max = count;
      }
    }
    return max;
  }

  _track(type, win, t, flags, ring, peakChanged) {
    const st = this.types[type];
    const fails = win.fraction > this.th.FIELD_AREA_FRACTION;
    if (win.fraction > st.peakFraction) st.peakFraction = win.fraction;
    if (!win.cells) return;

    const describe = () => {
      const transitions = this._maxTransitions(flags, ring, win, t);
      return {
        fraction: win.fraction,
        areaCss: Math.round(win.cells * this.cellAreaCss),
        time: t - this.firstT,
        rect: this._bbox(flags, win),
        flashesPerSecond: transitions / 2,
        rateIsMinimum: transitions >= RING,
      };
    };

    if (!fails) {
      if (!st.subPeak || win.fraction > st.subPeak.fraction) st.subPeak = describe();
      return;
    }
    const rel = t - this.firstT;
    let ev = st.current;
    if (!ev || rel - ev.end > this.th.WINDOW_MS) {
      ev = st.current = { type, start: rel, end: rel, peak: null };
      st.events.push(ev);
    }
    ev.end = rel;
    if (!ev.peak || win.fraction > ev.peak.fraction) {
      ev.peak = describe();
      peakChanged.push({ type, index: st.events.length - 1 });
    }
    // The area often peaks before the rate does, so track the rate separately.
    const transitions = this._maxTransitions(flags, ring, win, t);
    if (transitions / 2 > ev.peak.flashesPerSecond) {
      ev.peak.flashesPerSecond = transitions / 2;
      ev.peak.rateIsMinimum = transitions >= RING;
    }
  }

  summary() {
    const span = this.frames > 1 ? this.lastT - this.firstT : 0;
    const out = {
      criterion: 'WCAG 2.2 SC 2.3.1 Three Flashes or Below Threshold',
      thresholds: { ...this.th, RED_MIN_LINEAR_SUM },
      geometry: {
        viewportCss: { w: this.w * this.cssPerPx, h: this.h * this.cssPerPx },
        cellCss: this.cellCss,
        fieldCss: { w: this.fieldW * this.cellCss, h: this.fieldH * this.cellCss },
        failAreaCss: Math.round(this.fieldAreaCss * this.th.FIELD_AREA_FRACTION),
      },
      stats: {
        frames: this.frames,
        changedFrames: this.changedFrames,
        spanMs: span,
        fps: span > 0 ? ((this.frames - 1) * 1000) / span : 0,
        maxGapMs: this.maxGapMs,
      },
      timeline: this.timeline.map(({ b, g, r }) => ({ t: b * 100, g, r })),
    };
    for (const type of ['general', 'red']) {
      const st = this.types[type];
      out[type] = {
        failed: st.events.length > 0,
        peakFraction: st.peakFraction,
        events: st.events.map(({ type: ty, start, end, peak }) => ({ type: ty, start, end, ...peak })),
        subThresholdPeak: st.subPeak,
      };
    }
    return out;
  }
}
