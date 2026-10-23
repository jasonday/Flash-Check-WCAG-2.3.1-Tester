// Injected into the tested page. Reports the viewport, logs scrolling during
// capture, names the elements under each failing area, and draws an overlay
// marking failing areas. Safe to inject more than once.

(() => {
  if (window.__wcag231) return;
  const scrolls = [];
  const OVERLAY_ID = 'wcag231-overlay-root';
  const MEDIA = new Set(['VIDEO', 'IMG', 'CANVAS', 'IFRAME', 'SVG', 'PICTURE', 'OBJECT', 'EMBED']);

  const onScroll = () => {
    const now = Date.now();
    if (!scrolls.length || now - scrolls[scrolls.length - 1] > 100) scrolls.push(now);
  };
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });

  window.__wcag231 = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'init') {
      scrolls.length = 0;
      removeOverlay();
      sendResponse({
        url: location.href,
        title: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        sources: likelySources(),
      });
    } else if (msg.type === 'collect') {
      sendResponse({
        url: location.href,
        scrolls: scrolls.filter((t) => t >= msg.startedAt - 1000),
        elements: msg.rects.map((r) => (r ? elementsIn(r) : [])),
      });
    } else if (msg.type === 'overlay') {
      drawOverlay(msg.events);
      sendResponse({ ok: true });
    }
  });

  // Short, readable CSS selector for an element.
  function selector(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.localName;
      if (node.id) {
        parts.unshift(`${part}#${CSS.escape(node.id)}`);
        break;
      }
      const cls = [...node.classList].slice(0, 2).map((c) => `.${CSS.escape(c)}`).join('');
      part += cls;
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.localName === node.localName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  }

  function describe(el) {
    const tag = el.tagName;
    const label =
      el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('title') ||
      (el.currentSrc || el.src || '').split('/').pop()?.slice(0, 80) || '';
    let animations = 0;
    try {
      animations = el.getAnimations().length;
    } catch {
      // getAnimations not supported on this node.
    }
    return { selector: selector(el), tag: tag.toLowerCase(), label, animated: animations > 0 };
  }

  // Elements under a failing rect (CSS px, viewport coordinates), most likely
  // flash sources first: media elements, then animated elements, then others.
  function elementsIn(r) {
    const seen = new Map();
    for (const fx of [0.2, 0.5, 0.8]) {
      for (const fy of [0.2, 0.5, 0.8]) {
        const x = r.x + r.w * fx;
        const y = r.y + r.h * fy;
        for (const el of document.elementsFromPoint(x, y)) {
          if (el.closest(`#${OVERLAY_ID}`) || el === document.documentElement || el === document.body) continue;
          seen.set(el, (seen.get(el) || 0) + 1);
        }
      }
    }
    const score = (el) => {
      let s = seen.get(el);
      if (MEDIA.has(el.tagName.toUpperCase())) s += 20;
      try {
        if (el.getAnimations().length) s += 10;
      } catch {
        // ignore
      }
      if (getComputedStyle(el).backgroundImage !== 'none') s += 3;
      return s;
    };
    return [...seen.keys()]
      .sort((a, b) => score(b) - score(a))
      .slice(0, 4)
      .map(describe);
  }

  // Things on the page that might flash, so the tester knows what to play.
  function likelySources() {
    const out = [];
    for (const v of document.querySelectorAll('video')) out.push({ kind: 'video', ...describe(v) });
    for (const c of document.querySelectorAll('canvas')) out.push({ kind: 'canvas', ...describe(c) });
    for (const i of document.querySelectorAll('img')) {
      if (/\.(gif|apng|webp)(\?|$)/i.test(i.currentSrc || i.src)) out.push({ kind: 'possibly animated image', ...describe(i) });
    }
    for (const f of document.querySelectorAll('iframe')) out.push({ kind: 'embedded frame', ...describe(f) });
    let fast = 0;
    for (const a of document.getAnimations()) {
      const d = a.effect?.getComputedTiming?.().duration;
      if (typeof d === 'number' && d > 0 && d < 1000 && fast < 10 && a.effect.target) {
        out.push({ kind: `animation, ${Math.round(d)} ms cycle`, ...describe(a.effect.target) });
        fast++;
      }
    }
    return out.slice(0, 25);
  }

  function removeOverlay() {
    document.getElementById(OVERLAY_ID)?.remove();
  }

  function drawOverlay(events) {
    removeOverlay();
    const host = document.createElement('div');
    host.id = OVERLAY_ID;
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
    const root = host.attachShadow({ mode: 'open' });
    const fmt = (ms) => `${(ms / 1000).toFixed(1)} s`;
    root.innerHTML = `
      <style>
        .box{position:fixed;border:3px solid #b3261e;outline:2px solid #fff;box-sizing:border-box;}
        .tag{position:absolute;left:-3px;top:-3px;transform:translateY(-100%);background:#b3261e;color:#fff;
          font:600 13px/1.3 system-ui,sans-serif;padding:2px 6px;white-space:nowrap;}
        .bar{position:fixed;top:8px;right:8px;pointer-events:auto;background:#fff;color:#1b1b1b;border:2px solid #b3261e;
          font:14px/1.4 system-ui,sans-serif;padding:8px 10px;border-radius:6px;max-width:320px;}
        .bar button{font:inherit;margin-top:6px;padding:4px 10px;border:1px solid #1b1b1b;border-radius:4px;background:#fff;color:#1b1b1b;cursor:pointer;}
        .bar button:focus-visible{outline:3px solid #1f3a93;outline-offset:2px;}
      </style>
      <div class="bar" role="region" aria-label="Flash Check results for WCAG 2.3.1">
        <div><strong>Flash Check, WCAG 2.3.1:</strong> ${events.length} failing area${events.length === 1 ? '' : 's'} marked in red.
        Positions are from the moment of capture and move if the page scrolls.</div>
        <button type="button">Hide markers</button>
      </div>`;
    events.forEach((ev, i) => {
      if (!ev.rect) return;
      const b = document.createElement('div');
      b.className = 'box';
      Object.assign(b.style, { left: `${ev.rect.x}px`, top: `${ev.rect.y}px`, width: `${ev.rect.w}px`, height: `${ev.rect.h}px` });
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = `${i + 1}. ${ev.type === 'red' ? 'Red flash' : 'General flash'}, ${fmt(ev.start)} to ${fmt(ev.end)}`;
      b.append(t);
      root.append(b);
    });
    root.querySelector('button').addEventListener('click', removeOverlay);
    document.documentElement.append(host);
  }
})();
