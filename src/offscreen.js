// Offscreen document: receives a tab capture stream ID, captures the tab's
// video, and runs the analysis. It never displays the captured video.

import { analyzeStream } from './capture.js';

let session = null;

const send = (msg) => chrome.runtime.sendMessage({ target: 'background', ...msg }).catch(() => {});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'start') start(msg);
  if (msg.type === 'stop' && session) session.stop('stopped');
});

async function start({ runId, streamId, viewport, durationMs }) {
  if (session) {
    send({ type: 'error', runId, message: 'A capture is already running.' });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          maxFrameRate: 60,
          maxWidth: Math.round(viewport.width * viewport.dpr),
          maxHeight: Math.round(viewport.height * viewport.dpr),
        },
      },
    });
    session = analyzeStream(stream, {
      viewport,
      durationMs,
      onProgress: (p) => send({ type: 'progress', runId, ...p }),
    });
    const result = await session.done;
    send({ type: 'complete', runId, result });
  } catch (e) {
    send({ type: 'error', runId, message: e?.message || String(e) });
  } finally {
    session = null;
  }
}
