// Runs a video MediaStream through the flash analyzer.
// Used by the offscreen document (tab capture) and by the test harness page
// (canvas.captureStream), so both exercise the same pipeline.

import { FlashAnalyzer } from './engine.js';

// One analysis pixel covers 2 x 2 CSS px; one cell covers 2 x 2 analysis px,
// so cells are 4 x 4 CSS px (just above the 0.1 degree pattern size).
export const CSS_PX_PER_ANALYSIS_PX = 2;
export const CELL_ANALYSIS_PX = 2;
// Keep at most this many event snapshots per run.
const MAX_SNAPSHOTS = 20;

/**
 * @param {MediaStream} stream video stream whose frames show the viewport
 * @param {object} o
 * @param {{width:number,height:number}} o.viewport viewport size in CSS px
 * @param {number} o.durationMs stop after this long (wall clock)
 * @param {(p:object)=>void} [o.onProgress]
 * @returns {{done: Promise<object>, stop: (reason?:string)=>void}}
 */
export function analyzeStream(stream, { viewport, durationMs, onProgress }) {
  const track = stream.getVideoTracks()[0];
  const width = Math.max(1, Math.round(viewport.width / CSS_PX_PER_ANALYSIS_PX));
  const height = Math.max(1, Math.round(viewport.height / CSS_PX_PER_ANALYSIS_PX));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const analyzer = new FlashAnalyzer({
    width,
    height,
    cellPx: CELL_ANALYSIS_PX,
    cssPerPx: CSS_PX_PER_ANALYSIS_PX,
  });

  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader();
  const snapshots = new Map(); // "type:index" -> ImageData copy
  const startWall = Date.now();
  let firstTs = null;
  let stopReason = null;
  let failingSoFar = { general: false, red: false };
  let lastProgress = 0;

  const stop = (reason = 'stopped') => {
    if (stopReason) return;
    stopReason = reason;
    reader.cancel().catch(() => {});
  };
  const timer = setTimeout(() => stop('duration'), durationMs);
  track.addEventListener('ended', () => stop('ended'));

  const progress = (force) => {
    const now = Date.now();
    if (!onProgress || (!force && now - lastProgress < 500)) return;
    lastProgress = now;
    onProgress({
      elapsedMs: now - startWall,
      durationMs,
      frames: analyzer.frames,
      failingSoFar: { ...failingSoFar },
    });
  };
  const ticker = setInterval(() => progress(false), 500);

  const done = (async () => {
    try {
      while (!stopReason) {
        const { value: frame, done: ended } = await reader.read();
        if (ended || !frame) break;
        const ts = frame.timestamp / 1000; // microseconds -> ms
        if (firstTs === null) firstTs = ts;
        ctx.drawImage(frame, 0, 0, width, height);
        frame.close();
        const img = ctx.getImageData(0, 0, width, height);
        const r = analyzer.pushRgba(ts - firstTs, img.data);
        if (r.general.fraction > analyzer.th.FIELD_AREA_FRACTION) failingSoFar.general = true;
        if (r.red.fraction > analyzer.th.FIELD_AREA_FRACTION) failingSoFar.red = true;
        for (const { type, index } of r.peakChanged) {
          const key = `${type}:${index}`;
          if (snapshots.has(key) || snapshots.size < MAX_SNAPSHOTS) snapshots.set(key, img);
        }
        progress(false);
      }
    } finally {
      clearTimeout(timer);
      clearInterval(ticker);
      track.stop();
    }
    progress(true);

    const result = analyzer.summary();
    result.stopReason = stopReason || 'ended';
    result.startedAt = startWall;
    if (typeof track.stats === 'object' && track.stats) {
      const { deliveredFrames, discardedFrames, totalFrames } = track.stats;
      result.stats.trackStats = { deliveredFrames, discardedFrames, totalFrames };
    }
    for (const type of ['general', 'red']) {
      for (const [i, ev] of result[type].events.entries()) {
        const img = snapshots.get(`${type}:${i}`);
        if (img) ev.snapshot = await toDataUrl(img);
      }
    }
    return result;
  })();

  return { done, stop };
}

async function toDataUrl(img) {
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d').putImageData(img, 0, 0);
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
