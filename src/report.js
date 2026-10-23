// Report page. With ?id=<run> it shows one saved run; without it, the list of
// saved runs and a way to open an exported JSON report.

const main = document.getElementById('main');
const hasStorage = typeof chrome !== 'undefined' && chrome.storage?.local;

// Tiny element builder: h('p', {class: 'x'}, 'text', child, ...)
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}
const SVG_NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat(Infinity)) if (kid != null) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

const secs = (ms) => `${(ms / 1000).toFixed(1)} s`;
const pct = (f) => `${Math.round(f * 1000) / 10}%`;
const num = (n) => Math.round(n).toLocaleString('en-US');
const typeName = (t) => (t === 'red' ? 'Red flash' : 'General flash');
const LEVEL_TITLE = { fail: 'Fail', pass: 'Pass', review: 'Needs review' };

async function init() {
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const file = params.get('file');
  try {
    if (id && hasStorage) {
      const run = (await chrome.storage.local.get(`run:${id}`))[`run:${id}`];
      if (!run) return renderMissing();
      return renderRun(run);
    }
    if (file) return renderRun(await (await fetch(file)).json());
    return renderList();
  } catch (e) {
    main.replaceChildren(h('h1', {}, 'Report could not load'), h('p', {}, e.message));
  }
}

function renderMissing() {
  document.title = 'Report not found | Flash Check';
  main.replaceChildren(h('h1', {}, 'Report not found'), h('p', {}, 'This report may have been removed. Only the 15 most recent reports are kept.'), h('p', {}, h('a', { href: 'report.html' }, 'See all reports')));
}

async function renderList() {
  document.title = 'All reports | Flash Check';
  const runs = hasStorage ? (await chrome.storage.local.get('runs')).runs || [] : [];
  const input = h('input', { type: 'file', id: 'open-json', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      renderRun(JSON.parse(await f.text()));
    } catch {
      alert('That file is not a Flash Check report.');
    }
  });
  const table = runs.length
    ? h('div', { class: 'table-scroll' }, h('table', {},
        h('caption', {}, 'Saved reports, newest first'),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Tested'), h('th', { scope: 'col' }, 'Page'), h('th', { scope: 'col' }, 'Result'))),
        h('tbody', {}, runs.map((r) => h('tr', {},
          h('td', {}, new Date(r.startedAt).toLocaleString()),
          h('td', {}, h('a', { href: `report.html?id=${r.id}` }, r.title || r.url), h('br'), h('span', { class: 'muted' }, r.url)),
          h('td', {}, `${LEVEL_TITLE[r.verdict.level]}. ${r.verdict.summary}`),
        )))))
    : h('p', {}, 'No saved reports yet. Open a web page, select the extension button, and start a test.');
  main.replaceChildren(
    h('h1', {}, 'Flash Check reports'),
    table,
    h('h2', {}, 'Open an exported report'),
    h('p', {}, 'Open a JSON file saved with the "Download JSON" button on a report.'),
    h('label', { for: 'open-json' }, 'Report file '), input,
  );
}

function renderRun(run) {
  const v = run.verdict;
  const events = [...run.general.events, ...run.red.events].sort((a, b) => a.start - b.start);
  document.title = `${LEVEL_TITLE[v.level]}: ${run.title || run.url} | Flash Check`;

  // h() skips null children, so build through a wrapper and unwrap it.
  main.replaceChildren(...h('div', {},
    h('h1', {}, 'Flash Check report'),
    h('div', { class: `notice verdict ${v.level}` },
      h('strong', {}, `${LEVEL_TITLE[v.level]}. ${v.summary}`),
      v.reasons.length ? h('ul', {}, v.reasons.map((r) => h('li', {}, r))) : null,
    ),
    h('div', { class: 'actions' },
      h('button', { type: 'button', onclick: () => downloadJson(run) }, 'Download JSON'),
      h('button', { type: 'button', onclick: (e) => copySummary(run, events, e.currentTarget) }, 'Copy text summary'),
      h('button', { type: 'button', onclick: () => print() }, 'Print'),
    ),
    aboutSection(run),
    failuresSection(run, events),
    belowSection(run),
    chartSection(run),
    sourcesSection(run),
    methodSection(run),
  ).childNodes);
  main.focus();
}

function aboutSection(run) {
  const st = run.stats;
  const g = run.geometry;
  const rows = [
    ['Page', h('a', { href: run.url }, run.title || run.url)],
    ['Address', run.url],
    ['Tested', new Date(run.startedAt).toLocaleString()],
    ['Recorded', `${secs(st.spanMs)} (${num(st.frames)} frames, about ${Math.round(st.fps)} per second)`],
    ['Viewport', `${num(g.viewportCss.w)} by ${num(g.viewportCss.h)} CSS pixels at ${run.viewport?.dpr ?? 1}x device pixel ratio`],
    ['Area limit', `${num(g.failAreaCss)} CSS pixels, which is 25% of a 341 by 256 pixel area (a 10 degree visual field)`],
    ['Frequency limit', 'More than 3 flashes (6 opposing changes) in any one second'],
    ['Ended because', { duration: 'the set time ran out', stopped: 'the tester stopped it', ended: 'the tab closed or capture ended' }[run.stopReason] || run.stopReason],
  ];
  if (st.trackStats?.discardedFrames) rows.push(['Dropped frames', `${num(st.trackStats.discardedFrames)} frames were dropped by the browser`]);
  if (run.scrollCount) rows.push(['Scrolling', `The page scrolled ${run.scrollCount} time${run.scrollCount === 1 ? '' : 's'} during the test`]);
  return h('section', { 'aria-labelledby': 'about-h' },
    h('h2', { id: 'about-h' }, 'About this test'),
    h('dl', { class: 'facts' }, rows.map(([k, val]) => [h('dt', {}, k), h('dd', {}, val)])),
  );
}

function failuresSection(run, events) {
  const sec = h('section', { 'aria-labelledby': 'fail-h' }, h('h2', { id: 'fail-h' }, `Failures (${events.length})`));
  if (!events.length) {
    sec.append(h('p', {}, 'No flashing went over both limits at the same time during this test.'));
    return sec;
  }
  sec.append(h('p', {}, 'Each failure is a period when flashing was faster than 3 per second and covered more than the area limit. Times are from the start of the recording.'));
  events.forEach((ev, i) => sec.append(eventCard(run, ev, i + 1)));
  return sec;
}

function eventCard(run, ev, n) {
  const r = ev.rect;
  const rate = ev.rateIsMinimum ? `${ev.flashesPerSecond} or more` : `${ev.flashesPerSecond}`;
  const facts = [
    ['When', `${secs(ev.start)} to ${secs(ev.end)}`],
    ['Peak flashing area', `${pct(ev.fraction)} of the 10 degree field (${num(ev.areaCss)} CSS pixels; the limit is 25%)`],
    ['Fastest rate', `${rate} flashes per second`],
    ['Location', r ? `${num(r.w)} by ${num(r.h)} CSS pixels, ${num(r.x)} from the left and ${num(r.y)} from the top of the viewport` : 'Not available'],
  ];
  if (ev.duringScroll) facts.push(['Note', 'The page scrolled during this period. Check whether the flashing is real by testing again without scrolling.']);
  const els = ev.elements?.length
    ? h('ul', { class: 'elements' }, ev.elements.map((e) => h('li', {}, h('code', {}, e.selector), e.label ? ` (${e.label})` : '', e.animated ? ', has running animations' : '')))
    : h('p', { class: 'muted' }, 'No elements were found at this location. The page may have navigated or scrolled.');

  return h('article', { class: 'event', 'aria-labelledby': `ev-${n}` },
    h('h3', { id: `ev-${n}` }, `${n}. ${typeName(ev.type)}, ${secs(ev.start)} to ${secs(ev.end)}`),
    h('div', { class: 'event-body' },
      h('div', {},
        h('dl', { class: 'facts' }, facts.map(([k, val]) => [h('dt', {}, k), h('dd', {}, val)])),
        h('h4', {}, 'Likely source elements'),
        els,
      ),
      ev.snapshot && r ? snapshotFigure(run, ev, n) : null,
    ),
  );
}

// Still frame from the moment of peak area, with the failing area outlined.
function snapshotFigure(run, ev, n) {
  const { w, h: vh } = run.geometry.viewportCss;
  const r = ev.rect;
  const desc = `Still frame at ${secs(ev.time)} with the failing area outlined: ${num(r.w)} by ${num(r.h)} CSS pixels at ${num(r.x)}, ${num(r.y)}.`;
  const svg = s('svg', { viewBox: `0 0 ${w} ${vh}`, role: 'img', 'aria-labelledby': `fig-${n}` },
    s('image', { href: ev.snapshot, x: 0, y: 0, width: w, height: vh, preserveAspectRatio: 'none' }),
    s('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: 'none', stroke: '#ffffff', 'stroke-width': Math.max(4, w / 160) }),
    s('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: 'none', stroke: '#e3241b', 'stroke-width': Math.max(2, w / 320), 'stroke-dasharray': `${w / 60} ${w / 120}` }),
  );
  return h('figure', {}, svg, h('figcaption', { id: `fig-${n}` }, desc));
}

function belowSection(run) {
  const items = ['general', 'red']
    .map((t) => ({ t, p: run[t].subThresholdPeak }))
    .filter((x) => x.p && !run[x.t].failed);
  if (!items.length) return null;
  return h('section', { 'aria-labelledby': 'below-h' },
    h('h2', { id: 'below-h' }, 'Fast flashing below the area limit'),
    h('p', {}, 'These areas flashed more than 3 times per second but stayed under the area limit, so they pass. They are worth a look: people closer to the screen, or at higher zoom, see a larger area.'),
    h('ul', {}, items.map(({ t, p }) => h('li', {},
      `${typeName(t)} at ${secs(p.time)}: ${pct(p.fraction)} of the field (${num(p.areaCss)} CSS pixels), `,
      p.rect ? `${num(p.rect.w)} by ${num(p.rect.h)} pixels at ${num(p.rect.x)}, ${num(p.rect.y)}.` : '',
    ))),
  );
}

function chartSection(run) {
  const tl = run.timeline;
  if (!tl.length) return null;
  const W = 900;
  const H = 260;
  const m = { l: 48, r: 16, t: 14, b: 34 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const tMax = Math.max(1000, tl[tl.length - 1].t + 100);
  const yMax = Math.max(0.5, ...tl.map((p) => Math.max(p.g, p.r))) * 1.05;
  const x = (t) => m.l + (t / tMax) * iw;
  const y = (f) => m.t + ih - (Math.min(f, yMax) / yMax) * ih;
  const path = (key) => tl.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p[key]).toFixed(1)}`).join('');

  const yTicks = [0, 0.25, 0.5, 0.75, 1, 1.5, 2].filter((v) => v <= yMax);
  const step = [1, 2, 5, 10, 15, 30, 60, 120].find((sv) => tMax / 1000 / sv <= 10) || 300;
  const xTicks = [];
  for (let t = 0; t <= tMax; t += step * 1000) xTicks.push(t);

  const cross = s('line', { class: 'cross', y1: m.t, y2: m.t + ih, visibility: 'hidden' });
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-labelledby': 'chart-desc' },
    yTicks.map((v) => [s('line', { class: 'grid', x1: m.l, x2: m.l + iw, y1: y(v), y2: y(v) }), s('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, `${v * 100}%`)]),
    xTicks.map((t) => s('text', { x: x(t), y: H - 12, 'text-anchor': 'middle' }, `${t / 1000}s`)),
    s('line', { class: 'limit', x1: m.l, x2: m.l + iw, y1: y(0.25), y2: y(0.25) }),
    s('text', { class: 'label', x: m.l + iw - 4, y: y(0.25) - 6, 'text-anchor': 'end' }, 'Limit: 25%'),
    s('path', { class: 'line s1', d: path('g') }),
    s('path', { class: 'line s2', d: path('r') }),
    cross,
  );
  const tip = h('div', { class: 'tip', hidden: true });
  const wrap = h('div', { class: 'chart-wrap' }, svg, tip);
  svg.addEventListener('pointermove', (e) => {
    const box = svg.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const t = ((px - m.l) / iw) * tMax;
    if (t < 0 || t > tMax) return hide();
    let best = tl[0];
    for (const p of tl) if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p;
    cross.setAttribute('x1', x(best.t));
    cross.setAttribute('x2', x(best.t));
    cross.setAttribute('visibility', 'visible');
    tip.hidden = false;
    tip.replaceChildren(h('strong', {}, secs(best.t)), h('br'), `General flash: ${pct(best.g)}`, h('br'), `Red flash: ${pct(best.r)}`);
    const left = (x(best.t) / W) * box.width;
    tip.style.left = `${Math.min(left + 12, box.width - 170)}px`;
    tip.style.top = '8px';
  });
  const hide = () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
  };
  svg.addEventListener('pointerleave', hide);

  const swatch = (cls) => s('svg', { viewBox: '0 0 28 10', 'aria-hidden': 'true', class: 'chart' }, s('path', { class: `line ${cls}`, d: 'M1,5 L27,5' }));
  // Table view: one row per second that had any fast flashing.
  const perSec = new Map();
  for (const p of tl) {
    const k = Math.floor(p.t / 1000);
    const cur = perSec.get(k) || { g: 0, r: 0 };
    perSec.set(k, { g: Math.max(cur.g, p.g), r: Math.max(cur.r, p.r) });
  }
  const rows = [...perSec].filter(([, v]) => v.g > 0 || v.r > 0);

  return h('section', { 'aria-labelledby': 'chart-h' },
    h('h2', { id: 'chart-h' }, 'Fast flashing area over time'),
    h('p', { id: 'chart-desc' }, `Share of the 10 degree field covered by content flashing more than 3 times per second, for the whole ${secs(run.stats.spanMs)} recording. Anything above the 25% line fails. Peak: general flash ${pct(run.general.peakFraction)}, red flash ${pct(run.red.peakFraction)}.`),
    h('div', { class: 'legend' }, h('span', {}, swatch('s1'), 'General flash (solid)'), h('span', {}, swatch('s2'), 'Red flash (dashed)')),
    wrap,
    h('details', {},
      h('summary', {}, 'Show as a table'),
      rows.length
        ? h('div', { class: 'table-scroll' }, h('table', {},
            h('caption', {}, 'Highest flashing area in each second (seconds with no fast flashing left out)'),
            h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Second'), h('th', { scope: 'col' }, 'General flash area'), h('th', { scope: 'col' }, 'Red flash area'))),
            h('tbody', {}, rows.map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, `${k} to ${k + 1} s`), h('td', {}, pct(v.g)), h('td', {}, pct(v.r))))),
          ))
        : h('p', {}, 'No fast flashing at any point.'),
    ),
  );
}

function sourcesSection(run) {
  const src = run.pageInfo?.sources || [];
  return h('section', { 'aria-labelledby': 'src-h' },
    h('h2', { id: 'src-h' }, 'Possible flash sources found on the page'),
    src.length
      ? [h('p', {}, 'Found when the test started. Make sure each one was playing during the test, or test it separately.'),
         h('ul', {}, src.map((x) => h('li', {}, `${x.kind}: `, h('code', {}, x.selector), x.label ? ` (${x.label})` : '')))]
      : h('p', {}, 'No videos, canvases, animated images, frames, or fast animations were found when the test started.'),
  );
}

function methodSection() {
  return h('section', { 'aria-labelledby': 'method-h' },
    h('h2', { id: 'method-h' }, 'How this was tested'),
    h('ul', {},
      h('li', {}, 'The tab was recorded at up to 60 frames per second and split into cells of 4 by 4 CSS pixels. Detail smaller than that averages out, matching the WCAG note that very fine patterns are not flashes.'),
      h('li', {}, 'General flash: a change in relative luminance of 0.1 or more where the darker state is below 0.8. Luminance uses the WCAG 2.2 formula (sRGB threshold 0.04045).'),
      h('li', {}, 'Red flash: a change of more than 0.2 in CIE 1976 u\'v\' color where one state is saturated red (R / (R + G + B) of 0.8 or more). This is the WCAG 2.2 working definition.'),
      h('li', {}, 'A flash is two opposing changes. An area fails when it makes more than 6 changes (3 flashes) in one second and covers more than 25% of any 341 by 256 CSS pixel area.'),
      h('li', {}, 'This result covers only what was on screen during the recording, at this window size and zoom. WCAG asks for content to be checked at the largest size a user may view it.'),
      h('li', {}, 'Automated results support, and do not replace, an expert review. A pass here is not a medical safety guarantee.'),
    ),
  );
}

function downloadJson(run) {
  const blob = new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `flash-check-${run.id}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copySummary(run, events, btn) {
  const lines = [
    `Flash Check (WCAG 2.3.1): ${LEVEL_TITLE[run.verdict.level]}. ${run.verdict.summary}`,
    `Page: ${run.url}`,
    `Tested: ${new Date(run.startedAt).toLocaleString()}, ${secs(run.stats.spanMs)} recorded at about ${Math.round(run.stats.fps)} frames per second`,
    `Viewport: ${run.geometry.viewportCss.w} by ${run.geometry.viewportCss.h} CSS pixels`,
    ...run.verdict.reasons.map((r) => `Note: ${r}`),
    ...events.map((ev, i) =>
      `${i + 1}. ${typeName(ev.type)} from ${secs(ev.start)} to ${secs(ev.end)}: peak ${pct(ev.fraction)} of the field, ${ev.flashesPerSecond}${ev.rateIsMinimum ? '+' : ''} flashes per second` +
      (ev.rect ? `, at ${ev.rect.x}, ${ev.rect.y} size ${ev.rect.w} by ${ev.rect.h}` : '') +
      (ev.elements?.[0] ? `, likely ${ev.elements[0].selector}` : '')),
  ];
  await navigator.clipboard.writeText(lines.join('\n'));
  const old = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => (btn.textContent = old), 1500);
}

init();
