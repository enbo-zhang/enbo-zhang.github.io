// site.js — nav, reveals, sticky scene driver, playground controls, lightbox.
// Plain ES module, no dependencies. Scene modules are imported lazily relative
// to this file, so the site works at any base path (localhost or GitHub Pages).

import { initOdmr } from './odmr.js';

const root = document.documentElement;
root.classList.remove('no-js');
root.classList.add('js');

const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = reducedMQ.matches;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

/* ------------------------------------------------------------------------ */
/* Nav: mobile menu + page progress + scroll cue                            */
/* ------------------------------------------------------------------------ */
function initNav() {
  const nav = $('.gnav');
  if (!nav) return;
  const btn = $('.gnav__menu-btn', nav);
  const links = $('.gnav__links', nav);
  const setOpen = (open) => {
    nav.classList.toggle('is-open', open);
    btn?.setAttribute('aria-expanded', String(open));
    btn?.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
  };
  btn?.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  links?.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) { setOpen(false); btn?.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (nav.classList.contains('is-open') && !nav.contains(e.target)) setOpen(false);
  });
  window.matchMedia('(min-width: 735px)').addEventListener('change', (e) => { if (e.matches) setOpen(false); });
}

// section rail: each link fills with the reader's progress through its part (up to the next part)
const railSegs = $$('.gnav__rail .rail__seg').map((a) => ({ a, el: document.getElementById(a.hash.slice(1)) })).filter((s) => s.el);
function updateRail() {
  if (!railSegs.length) return;
  const docEnd = document.documentElement.scrollHeight;
  const y = window.scrollY + window.innerHeight * 0.35;
  const atEnd = window.scrollY >= docEnd - window.innerHeight - 2;
  let current = 0;
  railSegs.forEach((s, i) => {
    const start = s.el.getBoundingClientRect().top + window.scrollY;
    const end = i + 1 < railSegs.length ? railSegs[i + 1].el.getBoundingClientRect().top + window.scrollY : docEnd;
    const f = atEnd ? 1 : clamp((y - start) / Math.max(1, end - start));
    s.a.style.setProperty('--fill', f.toFixed(4));
    if (y >= start) current = i;
  });
  if (atEnd) current = railSegs.length - 1;
  railSegs.forEach((s, i) => { if (i === current) s.a.setAttribute('aria-current', 'true'); else s.a.removeAttribute('aria-current'); });
  if (current !== railCurrent) {
    // show the new part's name for a moment
    if (railCurrent !== -1) {
      const rail = railSegs[0].a.closest('.gnav__rail');
      rail?.classList.add('is-flash');
      clearTimeout(railFlashTimer);
      railFlashTimer = setTimeout(() => rail?.classList.remove('is-flash'), 1800);
    }
    railCurrent = current;
  }
  updateRailTicks();
}
let railCurrent = -1, railFlashTimer = 0;

// Rail ticks: one dot per scene stop, placed where that stop falls along its part of the rail.
let railTicks = [];   // { el, s, i }
function initRailTicks() {
  if (!railSegs.length) return;
  stickies.forEach((s) => {
    if (!s.keys?.length) return;
    const seg = [...railSegs].reverse().find((r) => r.el.compareDocumentPosition(s.section) & Node.DOCUMENT_POSITION_FOLLOWING || r.el === s.section);
    const track = seg && $('.rail__track', seg.a);
    if (!track) return;
    s.keys.forEach((_, i) => {
      const el = document.createElement('span');
      el.className = 'rail__tick';
      track.appendChild(el);
      railTicks.push({ el, s, i, seg });
    });
  });
  updateRailTicks();
}
function updateRailTicks() {
  if (!railTicks.length) return;
  const y = window.scrollY;
  const probe = window.innerHeight * 0.35;
  const docEnd = document.documentElement.scrollHeight;
  const stops = new Map();
  railTicks.forEach((t) => {
    if (!stops.has(t.s)) stops.set(t.s, sceneStops(t.s));
    const g = stops.get(t.s);
    if (!g) { t.el.hidden = true; return; }
    t.el.hidden = false;
    const idx = railSegs.indexOf(t.seg);
    const start = t.seg.el.getBoundingClientRect().top + y;
    const end = idx + 1 < railSegs.length ? railSegs[idx + 1].el.getBoundingClientRect().top + y : docEnd;
    const at = clamp((g.ys[t.i] + probe - start) / Math.max(1, end - start));
    t.el.style.setProperty('--at', `${(at * 100).toFixed(2)}%`);
    const d = y - g.ys[t.i];
    t.el.classList.toggle('is-current', Math.abs(d) <= 4);
    t.el.classList.toggle('is-passed', d > 4);
  });
}
function updatePageChrome() {
  updateRail();
  root.classList.toggle('is-scrolled', window.scrollY > window.innerHeight * 0.05);
}

/* ------------------------------------------------------------------------ */
/* Reveal on scroll                                                         */
/* ------------------------------------------------------------------------ */
function initReveals() {
  const items = $$('[data-reveal], [data-reveal-group]');
  $$('[data-reveal-group]').forEach((g) => {
    Array.from(g.children).forEach((c, i) => c.style.setProperty('--i', String(i)));
  });
  if (!('IntersectionObserver' in window) || reducedMotion) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -10% 0px' });
  items.forEach((el) => io.observe(el));
}

/* ------------------------------------------------------------------------ */
/* Scene loading                                                            */
/* ------------------------------------------------------------------------ */
let webglOK = null;
function hasWebGL() {
  if (webglOK !== null) return webglOK;
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    webglOK = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webglOK = false; }
  return webglOK;
}

const moduleCache = new Map();
function loadSceneModule(name) {
  if (!/^[a-z0-9-]+$/.test(name)) return Promise.reject(new Error('bad scene name'));
  if (!moduleCache.has(name)) {
    moduleCache.set(name, import(new URL(`./scenes/${name}.js`, import.meta.url).href));
  }
  return moduleCache.get(name);
}

// host element -> { scene, pending: Map(param -> value), failed }
const hosts = new Map();

function hostRecord(el) {
  if (!hosts.has(el)) hosts.set(el, { scene: null, pending: new Map(), failed: false, mounting: null, visible: false });
  return hosts.get(el);
}

function setParamOn(el, name, value) {
  const rec = hostRecord(el);
  rec.pending.set(name, value);
  if (rec.scene) {
    try { rec.scene.setParam?.(name, value); } catch (err) { console.warn('[scene] setParam failed', err); }
  }
}

async function mountScene(el, name, canvas, onFail) {
  const rec = hostRecord(el);
  if (rec.scene || rec.failed) return rec.scene;
  if (rec.mounting) return rec.mounting;
  rec.mounting = (async () => {
    try {
      if (!hasWebGL()) throw new Error('WebGL unavailable');
      const mod = await loadSceneModule(name);
      if (typeof mod.createScene !== 'function') throw new Error(`${name}: createScene missing`);
      const scene = mod.createScene(canvas, { reducedMotion });
      if (!scene || typeof scene.setProgress !== 'function') throw new Error(`${name}: bad scene object`);
      rec.scene = scene;
      try { scene.resize?.(); } catch { /* scene handles its own sizing */ }
      rec.pending.forEach((v, k) => { try { scene.setParam?.(k, v); } catch (e) { console.warn(e); } });
      return scene;
    } catch (err) {
      console.warn(`[scene] "${name}" unavailable, showing static fallback.`, err);
      rec.failed = true;
      onFail?.(err);
      return null;
    } finally {
      rec.mounting = null;
    }
  })();
  return rec.mounting;
}

/* ------------------------------------------------------------------------ */
/* Sticky scroll scenes                                                     */
/* ------------------------------------------------------------------------ */
const stickies = [];

function initStickyScenes() {
  $$('.scene[data-scene]').forEach((section) => {
    const name = section.dataset.scene;
    const canvas = $('.scene__canvas', section);
    const beats = $$('.beat', section).map((el) => ({
      el,
      start: parseFloat(el.dataset.start) || 0,
      end: parseFloat(el.dataset.end ?? '1'),
      active: null,
    }));
    const controls = $('.scene__controls', section);
    const s = { section, name, canvas, sticky: $('.scene__sticky', section), beats, controls, showFrom: parseFloat(controls?.dataset.showFrom ?? '0.85'), pace: parsePace(section.dataset.pace), p: -1, target: 0, inView: false };
    stickies.push(s);
    hostRecord(section);

    const fail = () => {
      section.classList.add('scene--static');
      section.classList.remove('is-ready');
      updateScrollState(true);
    };

    if (!('IntersectionObserver' in window)) { fail(); return; }

    // Mount when the section approaches (half a viewport ahead).
    const mountIO = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      mountIO.disconnect();
      mountScene(section, name, canvas, fail).then((scene) => {
        if (!scene) return;
        section.classList.add('is-ready');
        s.p = -1;
        updateSticky(s, true);
        if (s.inView) scene.start?.();
      });
    }, { rootMargin: '50% 0px 50% 0px' });
    mountIO.observe(section);

    // Start / stop with visibility.
    const viewIO = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        s.inView = en.isIntersecting;
        const scene = hostRecord(section).scene;
        if (!scene) return;
        try { s.inView ? scene.start?.() : scene.stop?.(); } catch (e) { console.warn(e); }
      });
    }, { rootMargin: '0px' });
    viewIO.observe(section);
  });
}

const FADE = 0.03;
function beatState(p, start, end, isLast) {
  if (p < start || p > end) return null;
  const fadeIn = clamp((p - start) / FADE);
  const fadeOut = isLast && end >= 1 ? 1 : clamp((end - p) / FADE);
  const opacity = Math.min(fadeIn, fadeOut);
  // enter: +1 → 0 (from below), exit: 0 → −1 (upwards)
  const y = fadeIn < 1 ? 1 - fadeIn : (fadeOut < 1 ? -(1 - fadeOut) : 0);
  return { opacity, y };
}

// Pacing: data-pace="story:scroll …" anchors (both 0–1, increasing) give each part of the storyboard a
// share of the scroll in proportion to how much moves in it, so one wheel step changes the view by about
// the same amount everywhere. Without it, story progress = scroll fraction.
function parsePace(attr) {
  if (!attr) return null;
  const pts = attr.trim().split(/\s+/).map((pair) => pair.split(':').map(Number));
  if (pts.length < 2 || pts.some((pt) => pt.length !== 2 || pt.some((n) => !Number.isFinite(n)))) return null;
  return pts;
}
function paced(pace, f) {
  if (!pace) return f;
  for (let i = 1; i < pace.length; i++) {
    const [p0, s0] = pace[i - 1], [p1, s1] = pace[i];
    if (f <= s1 || i === pace.length - 1) return clamp(p0 + (p1 - p0) * ((f - s0) / ((s1 - s0) || 1)));
  }
  return f;
}

// Scroll position → target progress. The span uses the pinned stage's own height (100svh), not
// innerHeight, so a phone's collapsing address bar doesn't make the story jump.
function readTarget(s) {
  const rect = s.section.getBoundingClientRect();
  const span = rect.height - (s.sticky?.offsetHeight || window.innerHeight);
  return span > 0 ? paced(s.pace, clamp(-rect.top / span)) : 0;
}

function updateSticky(s, force = false) {
  const { section } = s;
  const rect = section.getBoundingClientRect();
  const vh = window.innerHeight;
  // Skip off-screen sections (cheap) unless forced.
  if (!force && (rect.bottom < -vh || rect.top > vh * 2)) return;
  s.target = readTarget(s);
  // The story follows the scroll through a short ease, so wheel steps and flings glide instead of jumping.
  // Only very large jumps (section links, first view) and reduced motion go straight there; page-down
  // and fast flings still glide, so a stage is never skipped.
  if (force || reducedMotion || s.p < 0 || Math.abs(s.target - s.p) > 0.6 || section.classList.contains('scene--static')) {
    renderSticky(s, s.target, force);
  } else {
    kickEase();
  }
}

const EASE_TAU = 110;   // ms; time constant of the scroll ease
let easeRaf = 0, easeLast = 0;
function kickEase() {
  if (easeRaf) return;
  easeLast = performance.now();
  easeRaf = requestAnimationFrame(easeStep);
}
function easeStep(now) {
  const k = 1 - Math.exp(-Math.min(64, now - easeLast) / EASE_TAU);
  easeLast = now;
  let moving = false;
  stickies.forEach((s) => {
    if (s.p < 0 || Math.abs(s.target - s.p) < 1e-5) return;
    const d = s.target - s.p;
    renderSticky(s, Math.abs(d) < 0.0004 ? s.target : s.p + d * k);
    if (s.p !== s.target) moving = true;
  });
  easeRaf = moving ? requestAnimationFrame(easeStep) : 0;
}

function renderSticky(s, p, force = false) {
  const { section } = s;
  const isStatic = section.classList.contains('scene--static');
  if (!force && Math.abs(p - s.p) < 1e-5) return;
  s.p = p;

  const scene = hostRecord(section).scene;
  if (scene && !isStatic) {
    try { scene.setProgress(p); } catch (e) { console.warn('[scene] setProgress failed', e); }
  }
  if (isStatic) return;

  const last = s.beats.length - 1;
  s.beats.forEach((b, i) => {
    const st = beatState(p, b.start, b.end, i === last);
    const el = b.el;
    if (!st) {
      if (b.active !== false) {
        el.classList.remove('is-active');
        el.style.opacity = '0';
        el.setAttribute('aria-hidden', 'true');
        b.active = false;
      }
      return;
    }
    if (b.active !== true) { el.classList.add('is-active'); el.removeAttribute('aria-hidden'); b.active = true; }
    el.style.opacity = st.opacity.toFixed(3);
    el.style.setProperty('--beat-y', `calc(${st.y.toFixed(3)} * var(--beat-distance))`);
  });

  if (s.controls) {
    const show = p >= s.showFrom && !hostRecord(section).failed;
    const wasShown = s.controls.classList.contains('is-visible');
    s.controls.classList.toggle('is-visible', show);
    if (show) refreshSegmentedIn(s.controls);
    else if (wasShown) {
      // Leaving the interactive range: hand the storyboard back to the scene.
      if (s.controls.contains(document.activeElement)) document.activeElement.blur();
      $$('.segmented', s.controls).forEach((g) => g._reset?.());
    }
  }
}

let ticking = false;
function updateScrollState(force = false) {
  updatePageChrome();
  stickies.forEach((s) => updateSticky(s, force));
}
function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => { ticking = false; updateScrollState(); });
}

/* ------------------------------------------------------------------------ */
/* Keyframe stepping inside the sticky scenes                               */
/* ------------------------------------------------------------------------ */
// Each scene has stops ("keyframes"): by default one per caption, just before it starts to fade out, and
// the very end for a last caption that runs to 1. Override with data-keys="0.2 0.5 1" (story progress),
// opt out with data-step="false". Inside a scene one wheel gesture, swipe or arrow key glides to the next
// stop; before the first stop and after the last one the page scrolls normally, so you can always leave.
const KEY_BEFORE_END = 0.035;
const STEP_SLOP = 2;   // px

function sceneKeys(s) {
  const attr = s.section.dataset.keys;
  if (attr) return attr.trim().split(/\s+/).map(Number).filter((k) => Number.isFinite(k)).map((k) => clamp(k)).sort((a, b) => a - b);
  const last = s.beats.length - 1;
  return s.beats.map((b, i) => (i === last && b.end >= 1 ? 1 : clamp(b.end - KEY_BEFORE_END)));
}
// story progress → scroll fraction (inverse of paced)
function unpaced(pace, k) {
  if (!pace) return k;
  for (let i = 1; i < pace.length; i++) {
    const [p0, s0] = pace[i - 1], [p1, s1] = pace[i];
    if (k <= p1 || i === pace.length - 1) return clamp(s0 + (s1 - s0) * ((k - p0) / ((p1 - p0) || 1)));
  }
  return k;
}
// absolute scroll positions of a scene's stops, measured now (layout can change at any time)
function sceneStops(s) {
  if (s.section.dataset.step === 'false' || s.section.classList.contains('scene--static') || !s.keys?.length) return null;
  const rect = s.section.getBoundingClientRect();
  const span = rect.height - (s.sticky?.offsetHeight || window.innerHeight);
  if (span <= 0) return null;
  const top = Math.round(rect.top + window.scrollY);
  return { top, end: top + span, ys: s.keys.map((k) => Math.round(top + span * unpaced(s.pace, k))) };
}

// Where a scroll of `dist` px in direction `dir` from `y` should go, or null to let the page scroll.
function stopFor(y, dir, dist) {
  for (const s of stickies) {
    const g = sceneStops(s);
    if (!g) continue;
    const { top, end, ys } = g;
    const first = ys[0], last = ys[ys.length - 1];
    if (dir > 0) {
      if (y < top - STEP_SLOP) { if (y + dist >= top - STEP_SLOP) return first; continue; }
      if (y < last - STEP_SLOP) return ys.find((v) => v > y + STEP_SLOP);
    } else {
      if (y > end + STEP_SLOP) { if (y - dist <= end + STEP_SLOP) return last; continue; }
      if (y > first + STEP_SLOP) return [...ys].reverse().find((v) => v < y - STEP_SLOP);
    }
  }
  return null;
}

let stepAnim = null;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function glideTo(y) {
  const from = window.scrollY;
  const dist = Math.abs(y - from);
  if (stepAnim) cancelAnimationFrame(stepAnim.raf);
  if (reducedMotion || dist < 1) { window.scrollTo({ top: y, behavior: 'instant' }); stepAnim = null; return; }
  const dur = clamp(450 + 0.6 * dist, 650, 1400);
  const t0 = performance.now();
  stepAnim = { to: y, raf: 0 };
  const tick = (now) => {
    const t = clamp((now - t0) / dur);
    window.scrollTo({ top: from + (y - from) * easeInOutCubic(t), behavior: 'instant' });
    if (t < 1) stepAnim.raf = requestAnimationFrame(tick);
    else stepAnim = null;
  };
  stepAnim.raf = requestAnimationFrame(tick);
}
function stopGlide() { if (stepAnim) { cancelAnimationFrame(stepAnim.raf); stepAnim = null; } }

function initStepper() {
  stickies.forEach((s) => { s.keys = sceneKeys(s); });
  if (!stickies.some((s) => s.keys.length)) return;

  // Wheel / trackpad: one gesture = one stop. A gesture's later events (and trackpad momentum) are
  // swallowed until the wheel goes quiet, reverses, or clearly kicks again after the glide has finished.
  let lastT = 0, lastAbs = 0, lockDir = 0;
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    const d = e.deltaY * unit;
    if (!d) return;
    const dir = Math.sign(d), abs = Math.abs(d);
    const now = performance.now();
    const quiet = now - lastT > 220;
    const kick = abs > lastAbs * 1.5 + 4;
    lastT = now; lastAbs = abs;
    if (lockDir) {
      const fresh = quiet || dir !== lockDir || (!stepAnim && kick);
      if (!fresh) { e.preventDefault(); return; }
      lockDir = 0;
    }
    const target = stopFor(stepAnim && dir === Math.sign(stepAnim.to - window.scrollY) ? stepAnim.to : window.scrollY, dir, abs);
    if (target == null) return;
    e.preventDefault();
    lockDir = dir;
    glideTo(target);
  }, { passive: false });

  // Keys: arrows, page up/down, space. Left alone inside form fields and the scene's own controls.
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const el = e.target;
    if (el instanceof Element && el.closest('input, textarea, select, [contenteditable], .segmented, [role="slider"], .lightbox')) return;
    const vh = window.innerHeight;
    const map = { ArrowDown: [1, 40], ArrowUp: [-1, 40], PageDown: [1, vh * 0.9], PageUp: [-1, vh * 0.9], ' ': [e.shiftKey ? -1 : 1, vh * 0.9] };
    const m = map[e.key];
    if (!m) return;
    const target = stopFor(stepAnim ? stepAnim.to : window.scrollY, m[0], m[1]);
    if (target == null) return;
    e.preventDefault();
    glideTo(target);
  });

  // Touch: inside a scene a swipe steps once; outside, native scrolling (with momentum). If momentum
  // carries the page into a scene, it settles on the next stop once the scroll stops.
  let tY = 0, tDecided = null, tStepped = false, touching = false, lastDir = 1, settleTimer = 0, fromTouch = false;
  window.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tDecided = false; return; }
    touching = true; fromTouch = true;
    tY = e.touches[0].clientY; tDecided = null; tStepped = false;
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    if (tDecided === false || e.touches.length !== 1) return;
    const dy = tY - e.touches[0].clientY;
    if (tDecided === null) {
      if (Math.abs(dy) < 6) return;
      lastDir = Math.sign(dy);
      tDecided = !!stepAnim || stopFor(window.scrollY, lastDir, 1) != null;
    }
    if (!tDecided) return;
    if (e.cancelable) e.preventDefault();
    if (!tStepped && Math.abs(dy) > 28) {
      tStepped = true;
      const dir = Math.sign(dy);
      const target = stopFor(stepAnim ? stepAnim.to : window.scrollY, dir, Math.abs(dy));
      if (target != null) glideTo(target);
    }
  }, { passive: false });
  const touchEnd = () => { touching = false; };
  window.addEventListener('touchend', touchEnd, { passive: true });
  window.addEventListener('touchcancel', touchEnd, { passive: true });
  window.addEventListener('wheel', () => { fromTouch = false; }, { passive: true });
  window.addEventListener('scroll', () => {
    if (!fromTouch) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      if (touching || stepAnim) return;
      const y = window.scrollY;
      for (const s of stickies) {
        const g = sceneStops(s);
        if (!g || y <= g.top + STEP_SLOP || y >= g.ys[g.ys.length - 1] - STEP_SLOP) continue;
        if (g.ys.some((v) => Math.abs(v - y) <= STEP_SLOP)) return;
        const t = stopFor(y, lastDir, 0);
        if (t != null) glideTo(t);
        return;
      }
    }, 140);
  }, { passive: true });

  // A click or drag (rail links, the scrollbar) takes over from a glide.
  window.addEventListener('pointerdown', stopGlide, { passive: true });
}

/* ------------------------------------------------------------------------ */
/* Fixed-progress scenes (playground)                                       */
/* ------------------------------------------------------------------------ */
function initFixedScenes() {
  $$('[data-scene-fixed]').forEach((stage) => {
    const name = stage.dataset.sceneFixed;
    const canvas = $('canvas', stage);
    const progress = parseFloat(stage.dataset.progress ?? '0.5');
    const rec = hostRecord(stage);
    // Initial params from data-init-*
    Object.keys(stage.dataset).filter((k) => k.startsWith('init')).forEach((k) => {
      const param = k.slice(4);
      const key = param === 'Flipb' ? 'flipB' : param.charAt(0).toLowerCase() + param.slice(1);
      if (!rec.pending.has(key)) {
        const raw = stage.dataset[k];
        rec.pending.set(key, raw === 'true' ? true : raw === 'false' ? false : raw);
      }
    });
    const fail = () => stage.classList.add('is-failed');
    if (!('IntersectionObserver' in window)) { fail(); return; }
    const mountIO = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      mountIO.disconnect();
      mountScene(stage, name, canvas, fail).then((scene) => {
        if (!scene) return;
        try { scene.setProgress(progress); } catch (e) { console.warn(e); }
        stage.classList.add('is-ready');
        if (rec.visible) scene.start?.();
      });
    }, { rootMargin: '50% 0px 50% 0px' });
    mountIO.observe(stage);
    const viewIO = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        rec.visible = en.isIntersecting;
        if (!rec.scene) return;
        try { rec.visible ? rec.scene.start?.() : rec.scene.stop?.(); } catch (e) { console.warn(e); }
      });
    });
    viewIO.observe(stage);
  });
}

/* ------------------------------------------------------------------------ */
/* Segmented controls + switches                                            */
/* ------------------------------------------------------------------------ */
function positionThumb(group, instant = false) {
  const thumb = $('.segmented__thumb', group);
  const checked = $('[role="radio"][aria-checked="true"]', group);
  if (!thumb || !checked || !checked.offsetWidth) return;
  if (instant) group.classList.add('is-instant');
  group.style.setProperty('--thumb-x', `${checked.offsetLeft}px`);
  group.style.setProperty('--thumb-w', `${checked.offsetWidth}px`);
  group.dataset.checked = checked.dataset.value;
  if (instant) requestAnimationFrame(() => requestAnimationFrame(() => group.classList.remove('is-instant')));
}
function refreshSegmentedIn(ctx) {
  $$('.segmented', ctx).forEach((g) => { if (!g.dataset.positioned) { positionThumb(g, true); g.dataset.positioned = '1'; } });
}

function applyControl(targetSel, param, value, captionSel, captionText) {
  const target = targetSel ? $(targetSel) : null;
  if (target) setParamOn(target, param, value);
  if (captionSel && captionText != null) {
    const cap = $(captionSel);
    if (cap) cap.textContent = captionText;
  }
  document.dispatchEvent(new CustomEvent('pg:param', { detail: { target: targetSel, param, value } }));
}

function initSegmented() {
  $$('.segmented[role="radiogroup"]').forEach((group) => {
    const radios = $$('[role="radio"]', group);
    const select = (btn, focus = false) => {
      radios.forEach((r) => {
        const on = r === btn;
        r.setAttribute('aria-checked', String(on));
        r.tabIndex = on ? 0 : -1;
      });
      if (focus) btn.focus();
      group.dataset.touched = '1';
      positionThumb(group);
      applyControl(group.dataset.target, group.dataset.param, btn.dataset.value, group.dataset.caption, btn.dataset.captionText);
    };
    const current = radios.find((r) => r.getAttribute('aria-checked') === 'true') || radios[0];
    radios.forEach((r) => { r.tabIndex = r === current ? 0 : -1; });
    // Seed the initial value (without moving focus).
    const target = group.dataset.target && $(group.dataset.target);
    if (target && group.dataset.seed !== 'false') hostRecord(target).pending.set(group.dataset.param, current.dataset.value);
    group.dataset.checked = current.dataset.value;
    group.dataset.default = current.dataset.value;
    // Reset hook: restore default UI and send the reset value (e.g. 'auto') to the scene.
    group._reset = () => {
      if (!group.dataset.touched) return;
      delete group.dataset.touched;
      const def = radios.find((r) => r.dataset.value === group.dataset.default) || radios[0];
      radios.forEach((r) => { const on = r === def; r.setAttribute('aria-checked', String(on)); r.tabIndex = on ? 0 : -1; });
      positionThumb(group, true);
      const cap = group.dataset.caption && $(group.dataset.caption);
      if (cap) cap.textContent = def.dataset.captionText || '';
      if (target && group.dataset.reset) setParamOn(target, group.dataset.param, group.dataset.reset);
    };

    radios.forEach((r) => r.addEventListener('click', () => select(r)));
    group.addEventListener('keydown', (e) => {
      const i = radios.indexOf(document.activeElement);
      if (i < 0) return;
      let n = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % radios.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + radios.length) % radios.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = radios.length - 1;
      if (n === null) return;
      e.preventDefault();
      select(radios[n], true);
    });
    positionThumb(group, true);
  });
  const reposition = () => $$('.segmented[role="radiogroup"]').forEach((g) => positionThumb(g, true));
  window.addEventListener('resize', reposition, { passive: true });
  document.fonts?.ready.then(reposition);
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(reposition);
    $$('.segmented[role="radiogroup"]').forEach((g) => ro.observe(g));
  }
}

function initSwitches() {
  $$('[role="switch"][data-param]').forEach((sw) => {
    const target = sw.dataset.target && $(sw.dataset.target);
    if (target) hostRecord(target).pending.set(sw.dataset.param, sw.getAttribute('aria-checked') === 'true');
    sw.addEventListener('click', () => {
      const on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(on));
      applyControl(sw.dataset.target, sw.dataset.param, on, sw.dataset.caption, on ? sw.dataset.captionOn : sw.dataset.captionOff);
    });
  });
}

/* ------------------------------------------------------------------------ */
/* Lightbox                                                                 */
/* ------------------------------------------------------------------------ */
function initLightbox() {
  const dialog = $('dialog.lightbox');
  const cards = $$('.figure-card');
  if (!dialog || !cards.length) return;
  if (typeof dialog.showModal !== 'function') {
    // Very old browsers: open the full image directly.
    cards.forEach((c) => c.addEventListener('click', () => { window.location.href = c.dataset.full; }));
    return;
  }
  const img = $('.lightbox__img', dialog);
  const title = $('.lightbox__title', dialog);
  const text = $('.lightbox__text', dialog);
  let index = 0;
  let opener = null;

  const show = (i) => {
    index = (i + cards.length) % cards.length;
    const card = cards[index];
    const thumb = $('img', card);
    img.src = card.dataset.full;
    img.width = Number(card.dataset.fullW) || 2000;
    img.height = Number(card.dataset.fullH) || 1400;
    img.alt = thumb?.alt || '';
    title.textContent = $('.figure-card__title', card)?.textContent || '';
    text.textContent = $('.figure-card__caption', card)?.textContent || '';
  };

  cards.forEach((card, i) => card.addEventListener('click', () => {
    opener = card;
    show(i);
    root.classList.add('is-locked');
    dialog.showModal();
    $('.lightbox__close', dialog).focus();
  }));

  const close = () => dialog.close();
  $('.lightbox__close', dialog).addEventListener('click', close);
  $('.lightbox__prev', dialog).addEventListener('click', () => show(index - 1));
  $('.lightbox__next', dialog).addEventListener('click', () => show(index + 1));
  // Click on the backdrop / empty area closes.
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog || e.target.classList.contains('lightbox__inner')) close();
  });
  dialog.addEventListener('close', () => {
    root.classList.remove('is-locked');
    opener?.focus();
  });
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(index - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); show(index + 1); }
    else if (e.key === 'Tab') {
      // Focus trap (showModal makes the page inert; this also cycles within the dialog).
      const f = $$('button', dialog).filter((b) => b.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
}

/* ------------------------------------------------------------------------ */
/* Boot                                                                     */
/* ------------------------------------------------------------------------ */
function initRanges() {
  $$('input[type="range"][data-param]').forEach((input) => {
    const out = $(`output[for="${input.id}"]`);
    const update = () => {
      const v = +input.value;
      if (out) out.textContent = `${v.toFixed(+(input.dataset.digits || 1))} ${input.dataset.unit || ''}`.trim();
      const target = $(input.dataset.target);
      if (target) setParamOn(target, input.dataset.param, v);
    };
    input.addEventListener('input', update);
    update();
  });
}

function boot() {
  initNav();
  initReveals();
  initSegmented();
  initSwitches();
  initStickyScenes();
  initFixedScenes();
  initStepper();
  initRailTicks();
  initLightbox();
  initRanges();
  initOdmr();
  updateScrollState(true);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => {
    hosts.forEach((rec) => { try { rec.scene?.resize?.(); } catch { /* noop */ } });
    updateScrollState(true);
  }, { passive: true });
  reducedMQ.addEventListener?.('change', (e) => { reducedMotion = e.matches; });
  window.addEventListener('pagehide', (e) => {
    if (e.persisted) return;
    hosts.forEach((rec) => { try { rec.scene?.dispose?.(); } catch { /* noop */ } });
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
