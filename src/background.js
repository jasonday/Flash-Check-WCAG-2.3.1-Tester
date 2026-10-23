import { verdict } from './verdict.js';

// Service worker: coordinates the popup, the offscreen capture document, the
// content script on the tested page, and saved results.

const OFFSCREEN_URL = 'src/offscreen.html';
const MAX_RUNS = 15;
const COLORS = { fail: '#b3261e', pass: '#146c2e', busy: '#1f3a93', warn: '#7a4d00' };

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'background') return;
  handle(msg)
    .then((r) => sendResponse(r ?? { ok: true }))
    .catch((e) => sendResponse({ error: e?.message || String(e) }));
  return true;
});

async function handle(msg) {
  switch (msg.type) {
    case 'start':
      return startRun(msg);
    case 'stop':
      await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
      return;
    case 'progress':
      return onProgress(msg);
    case 'complete':
      return onComplete(msg);
    case 'error':
      return onError(msg);
  }
}

const getState = async () => (await chrome.storage.session.get('capture')).capture || { status: 'idle' };
const setState = (capture) => chrome.storage.session.set({ capture });

async function badge(tabId, text, color) {
  await chrome.action.setBadgeText({ tabId, text });
  if (color) {
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' });
  }
}

async function ensureOffscreen() {
  const existing = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  if (existing.length) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Capture the tab video to measure flashing for WCAG 2.3.1.',
  });
}

async function closeOffscreen() {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // Already closed.
  }
}

async function startRun({ streamId, tabId, url, title, viewport, durationMs, options, pageInfo }) {
  const state = await getState();
  if (state.status === 'capturing') throw new Error('A capture is already running. Stop it first.');
  const runId = `${Date.now()}`;
  await setState({
    status: 'capturing',
    runId,
    tabId,
    url,
    title,
    viewport,
    durationMs,
    options,
    pageInfo,
    elapsedMs: 0,
    frames: 0,
    failingSoFar: { general: false, red: false },
  });
  await badge(tabId, 'REC', COLORS.busy);
  await ensureOffscreen();
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'start', runId, streamId, viewport, durationMs });
  return { runId };
}

async function onProgress({ runId, elapsedMs, frames, failingSoFar }) {
  const state = await getState();
  if (state.runId !== runId || state.status !== 'capturing') return;
  await setState({ ...state, elapsedMs, frames, failingSoFar });
  const left = Math.max(0, Math.ceil((state.durationMs - elapsedMs) / 1000));
  await badge(state.tabId, left > 99 ? 'REC' : `${left}s`, COLORS.busy);
}

async function onComplete({ runId, result }) {
  const state = await getState();
  if (state.runId !== runId) return;
  await setState({ ...state, status: 'processing' });
  await closeOffscreen();

  const events = [...result.general.events, ...result.red.events];
  let page = null;
  try {
    page = await chrome.tabs.sendMessage(state.tabId, {
      type: 'collect',
      rects: events.map((e) => e.rect),
      startedAt: result.startedAt,
    });
  } catch {
    // Page navigated or closed; report without page details.
  }

  // Mark failures that overlap with page scrolling, which can mimic flashing.
  const scrolls = page?.scrolls || [];
  for (const ev of events) {
    const s = result.startedAt + ev.start - 1000;
    const e = result.startedAt + ev.end + 250;
    ev.duringScroll = scrolls.some((t) => t >= s && t <= e);
  }
  events.forEach((ev, i) => (ev.elements = page?.elements?.[i] || []));

  const run = {
    id: runId,
    url: state.url,
    title: state.title,
    viewport: state.viewport,
    pageInfo: state.pageInfo,
    navigatedAway: page ? page.url !== state.url : true,
    scrollCount: scrolls.length,
    ...result,
  };
  run.verdict = verdict(run);
  await saveRun(run);

  await setState({ status: 'done', runId, tabId: state.tabId, verdict: run.verdict, url: state.url });
  const v = run.verdict.level;
  await badge(state.tabId, v === 'fail' ? 'FAIL' : v === 'pass' ? 'PASS' : '?', COLORS[v] || COLORS.warn);

  if (state.options?.overlay && page && events.length) {
    chrome.tabs.sendMessage(state.tabId, { type: 'overlay', events: events.map(overlayInfo) }).catch(() => {});
  }
  if (state.options?.openReport !== false) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`src/report.html?id=${runId}`), openerTabId: state.tabId });
  }
}

function overlayInfo(ev) {
  return { type: ev.type, start: ev.start, end: ev.end, rect: ev.rect, fraction: ev.fraction };
}

async function saveRun(run) {
  const { runs = [] } = await chrome.storage.local.get('runs');
  const entry = { id: run.id, url: run.url, title: run.title, startedAt: run.startedAt, verdict: run.verdict };
  const next = [entry, ...runs.filter((r) => r.id !== run.id)];
  const dropped = next.slice(MAX_RUNS).map((r) => `run:${r.id}`);
  await chrome.storage.local.set({ runs: next.slice(0, MAX_RUNS), [`run:${run.id}`]: run });
  if (dropped.length) await chrome.storage.local.remove(dropped);
}

async function onError({ runId, message }) {
  const state = await getState();
  if (state.runId !== runId) return;
  await closeOffscreen();
  await setState({ status: 'error', runId, tabId: state.tabId, message });
  await badge(state.tabId, 'ERR', COLORS.fail);
}

// If the tested tab closes mid-run, stop the capture cleanly.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.status === 'capturing' && state.tabId === tabId) {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
  }
});
