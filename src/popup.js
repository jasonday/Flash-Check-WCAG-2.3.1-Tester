const $ = (id) => document.getElementById(id);
const toBackground = (msg) => chrome.runtime.sendMessage({ target: 'background', ...msg });

function showStatus(level, title, lines = []) {
  const box = document.createElement('div');
  box.className = `notice ${level}`;
  const strong = document.createElement('strong');
  strong.textContent = title;
  box.append(strong);
  for (const line of lines) {
    const p = document.createElement('p');
    if (line instanceof Node) p.append(line);
    else p.textContent = line;
    box.append(p);
  }
  $('status').replaceChildren(box);
}

function reportLink(runId) {
  const a = document.createElement('a');
  a.href = `report.html?id=${runId}`;
  a.target = '_blank';
  a.textContent = 'Open the full report';
  return a;
}

function render(state) {
  const capturing = state.status === 'capturing' || state.status === 'processing';
  $('setup').hidden = capturing;
  $('running').hidden = !capturing;
  if (state.status === 'capturing') {
    const left = Math.max(0, Math.ceil((state.durationMs - state.elapsedMs) / 1000));
    $('left').textContent = `${left} s`;
    $('frames').textContent = String(state.frames);
    const f = state.failingSoFar || {};
    const kinds = [f.general && 'general flash', f.red && 'red flash'].filter(Boolean);
    $('sofar').textContent = kinds.length ? kinds.join(', ') : 'None';
    renderSources(state.pageInfo?.sources || []);
  } else if (state.status === 'processing') {
    $('stop').disabled = true;
    showStatus('', 'Analyzing the recording...');
  } else if (state.status === 'done' && state.verdict) {
    showStatus(state.verdict.level, state.verdict.summary, [reportLink(state.runId)]);
  } else if (state.status === 'error') {
    showStatus('fail', 'The test could not run.', [state.message || 'Unknown error.']);
  }
}

let sourcesShown = false;
function renderSources(sources) {
  if (sourcesShown || !sources.length) return;
  sourcesShown = true;
  const h = document.createElement('h3');
  h.textContent = 'Possible flash sources on this page';
  h.style.fontSize = '14px';
  h.style.margin = '0 0 2px';
  const ul = document.createElement('ul');
  for (const s of sources.slice(0, 6)) {
    const li = document.createElement('li');
    li.textContent = `${s.kind}: ${s.label || s.selector}`;
    ul.append(li);
  }
  if (sources.length > 6) {
    const li = document.createElement('li');
    li.textContent = `${sources.length - 6} more in the report`;
    ul.append(li);
  }
  $('sources').replaceChildren(h, ul);
}

async function start(e) {
  e.preventDefault();
  $('start').disabled = true;
  showStatus('', 'Starting...');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^(https?|file):/.test(tab.url || '')) {
      throw new Error('This page cannot be tested. Open a web page (http, https, or a local file) and try again.');
    }
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
    const pageInfo = await chrome.tabs.sendMessage(tab.id, { type: 'init' });
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const res = await toBackground({
      type: 'start',
      streamId,
      tabId: tab.id,
      url: pageInfo.url,
      title: pageInfo.title,
      viewport: pageInfo.viewport,
      durationMs: Number($('duration').value) * 1000,
      options: { overlay: $('overlay').checked, openReport: $('openReport').checked },
      pageInfo: { sources: pageInfo.sources },
    });
    if (res?.error) throw new Error(res.error);
    $('status').replaceChildren();
    await chrome.storage.local.set({ prefs: { duration: $('duration').value, overlay: $('overlay').checked, openReport: $('openReport').checked } });
  } catch (err) {
    showStatus('fail', 'The test could not start.', [friendly(err)]);
  } finally {
    $('start').disabled = false;
  }
}

function friendly(err) {
  const m = err?.message || String(err);
  if (/active stream|already being captured/i.test(m)) return 'This tab is already being recorded by another tool. Stop that recording and try again.';
  if (/Cannot access|chrome:\/\/|extensions gallery/i.test(m)) return 'Chrome does not allow extensions to test this page.';
  return m;
}

async function init() {
  const { prefs } = await chrome.storage.local.get('prefs');
  if (prefs) {
    $('duration').value = prefs.duration;
    $('overlay').checked = prefs.overlay;
    $('openReport').checked = prefs.openReport;
  }
  const { capture } = await chrome.storage.session.get('capture');
  if (capture) render(capture);
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.capture) render(changes.capture.newValue || { status: 'idle' });
  });
  $('form').addEventListener('submit', start);
  $('stop').addEventListener('click', async () => {
    $('stop').disabled = true;
    await toBackground({ type: 'stop' });
  });
}

init();
