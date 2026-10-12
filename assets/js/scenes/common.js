// common.js — shared Three.js helpers for all scenes.
// Owned by animation agent 1. API is stable: functions are only ever ADDED, never renamed/removed.
import * as THREE from 'three';

/** Shared palette (hex numbers) from BRIEF.md. */
export const COLORS = {
  sigmaPlus: 0xff375f,   // σ+ right-handed (magenta)
  sigmaMinus: 0x64d2ff,  // σ− left-handed (cyan)
  nvRed: 0xff3b30,       // NV fluorescence
  nvRedSoft: 0xff6a4d,   // NV fluorescence outer bloom
  laser: 0x30d158,       // 532 nm laser
  nitrogen: 0x5b8cff,    // nitrogen atom
  yig: 0xffb340,         // YIG film tint
  gold: 0xd4af37,        // stripline
  lattice: 0xcfe8ff,     // diamond lattice
  white: 0xffffff,
  grey: 0x8e8e93,        // neutral (B arrow etc.)
};

/** CSS string ('#rrggbb') for a hex number color. */
export function cssColor(hex) {
  return '#' + new THREE.Color(hex).getHexString();
}

/** Clamp x to [a,b]. */
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
/** Linear interpolation. */
export const lerp = (a, b, t) => a + (b - a) * t;
/** Hermite smoothstep of x between edges e0,e1 (returns 0..1). */
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
/** Map p into 0..1 within range [a,b], clamped. */
export const remap = (p, a, b) => clamp((p - a) / (b - a));
/** Cubic ease-in-out on t in 0..1. */
export const easeInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
/** Window: rises 0→1 over [a,b], holds, falls 1→0 over [c,d] (smoothstepped). */
export const band = (p, a, b, c, d) => smoothstep(a, b, p) * (1 - smoothstep(c, d, p));
/** Exponential damping factor for frame-rate independent smoothing: lerp(cur, target, damp(rate, dt)). */
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

/** Pixel-ratio cap: 2 on desktop, 1.5 on phones (four 3D stages on one page; keeps scrolling smooth and cool). */
export const maxPixelRatio = () => Math.min(window.devicePixelRatio || 1, window.matchMedia('(max-width: 734px)').matches ? 1.5 : 2);

/** WebGLRenderer: alpha, antialias, pixelRatio ≤ maxPixelRatio(), sRGB output, ACES tone mapping, transparent clear. */
export function createRenderer(canvas, opts = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', ...opts });
  renderer.setPixelRatio(maxPixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);
  const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
  renderer.setSize(w, h, false);
  return renderer;
}

/**
 * Text label sprite via CanvasTexture (full unicode: σ⁺ ⟩ λ µ ...).
 * opts: {color, fontSize (px on canvas), fontWeight, fontFamily, scale (world height), padding,
 *        background (css or null), glow (bool), opacity, depthTest}
 * Returns a THREE.Sprite; sprite.userData.setText(newText) re-renders.
 */
export function makeLabelSprite(text, opts = {}) {
  const o = {
    color: '#ffffff', fontSize: 64, fontWeight: 500,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", "Segoe UI", Arial, sans-serif',
    scale: 0.3, padding: 16, background: null, glow: true, opacity: 1, depthTest: false, ...opts,
  };
  if (typeof o.color === 'number') o.color = cssColor(o.color);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: o.depthTest, depthWrite: false, opacity: o.opacity });
  const sprite = new THREE.Sprite(mat);
  function draw(t) {
    const font = `${o.fontWeight} ${o.fontSize}px ${o.fontFamily}`;
    ctx.font = font;
    const w = Math.ceil(ctx.measureText(t).width) + o.padding * 2;
    const h = Math.ceil(o.fontSize * 1.35) + o.padding * 2;
    canvas.width = w; canvas.height = h;
    ctx.font = font;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (o.background) {
      ctx.fillStyle = o.background;
      const r = h / 2;
      ctx.beginPath(); ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, h, r); ctx.arcTo(w, h, 0, h, r); ctx.arcTo(0, h, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); ctx.fill();
    }
    if (o.glow) { ctx.shadowColor = o.color; ctx.shadowBlur = o.fontSize * 0.25; }
    ctx.fillStyle = o.color;
    ctx.fillText(t, w / 2, h / 2 + o.fontSize * 0.04);
    tex.needsUpdate = true;
    sprite.scale.set(o.scale * w / h, o.scale, 1);
  }
  draw(text);
  sprite.userData.setText = draw;
  sprite.renderOrder = 10;
  return sprite;
}

let _glowTex = null;
/** Shared radial-gradient texture (white, soft falloff) used by glow sprites. */
export function getGlowTexture() {
  if (_glowTex) return _glowTex;
  const s = 256, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0.0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(255,255,255,0.6)');
  grd.addColorStop(0.4, 'rgba(255,255,255,0.18)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.05)');
  grd.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  _glowTex = new THREE.CanvasTexture(c);
  _glowTex.colorSpace = THREE.SRGBColorSpace;
  return _glowTex;
}

/** Additive radial-gradient glow sprite. opts: {size, opacity}. */
export function makeGlowSprite(color = 0xffffff, opts = {}) {
  const mat = new THREE.SpriteMaterial({
    map: getGlowTexture(), color: new THREE.Color(color), transparent: true,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: opts.depthTest ?? true, opacity: opts.opacity ?? 1,
  });
  const s = new THREE.Sprite(mat);
  const size = opts.size ?? 1;
  s.scale.set(size, size, 1);
  return s;
}

/**
 * Arrow Group of unit-ish length along +Y from origin: cylinder shaft + cone head.
 * opts: {shaftRadius, headRadius, headLength (fraction of length), emissive, opacity, material, segments}
 * Orient with group.quaternion.setFromUnitVectors(UP, dir) or use setArrowDirection().
 * group.userData.setLength(L) rescales shaft while keeping head size.
 */
export function makeArrow(color = 0xffffff, length = 1, opts = {}) {
  const o = { shaftRadius: 0.02, headRadius: 0.06, headLength: 0.18, opacity: 1, segments: 12, ...opts };
  const mat = o.material || new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: o.emissive ?? 0.6, roughness: 0.35, metalness: 0.1,
    transparent: o.opacity < 1, opacity: o.opacity,
  });
  const group = new THREE.Group();
  const shaftGeo = new THREE.CylinderGeometry(o.shaftRadius, o.shaftRadius, 1, o.segments);
  shaftGeo.translate(0, 0.5, 0);
  const headGeo = new THREE.ConeGeometry(o.headRadius, 1, o.segments);
  headGeo.translate(0, 0.5, 0);
  const shaft = new THREE.Mesh(shaftGeo, mat);
  const head = new THREE.Mesh(headGeo, mat);
  group.add(shaft, head);
  const headLen = o.headLength * length;
  function setLength(L) {
    const hl = Math.min(headLen, L * 0.5);
    shaft.scale.set(1, Math.max(1e-4, L - hl), 1);
    head.scale.set(1, hl, 1);
    head.position.y = L - hl;
  }
  setLength(length);
  group.userData = { shaft, head, material: mat, setLength };
  return group;
}

const _UP = new THREE.Vector3(0, 1, 0);
/** Point an arrow (from makeArrow) along direction vector dir (need not be normalized). */
export function setArrowDirection(arrow, dir) {
  const d = dir.clone().normalize();
  arrow.quaternion.setFromUnitVectors(_UP, d);
}

/** ResizeObserver on canvas; calls cb() on size changes. Returns disconnect function. */
export function observeResize(canvas, cb) {
  if (typeof ResizeObserver === 'undefined') {
    window.addEventListener('resize', cb);
    return () => window.removeEventListener('resize', cb);
  }
  const ro = new ResizeObserver(() => cb());
  ro.observe(canvas);
  return () => ro.disconnect();
}

/**
 * Update PerspectiveCamera for aspect. In portrait (aspect<1) widens vertical FOV so horizontal content fits.
 * opts: {baseFov (default camera.userData.baseFov || camera.fov), portraitFovBoost (0..1, default 1 = keep horizontal FOV of 16:9-ish base)}
 */
export function fitCameraToAspect(camera, aspect, opts = {}) {
  if (camera.userData.baseFov == null) camera.userData.baseFov = camera.fov;
  const base = opts.baseFov ?? camera.userData.baseFov;
  const boost = opts.portraitFovBoost ?? 1;
  const refAspect = opts.refAspect ?? 1.2;
  let fov = base;
  if (aspect < refAspect) {
    // keep horizontal FOV equal to that at refAspect, blended by boost
    const hfov = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base) / 2) * refAspect);
    const needed = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hfov / 2) / aspect));
    fov = lerp(base, Math.min(needed, opts.maxFov ?? 95), boost);
  }
  camera.fov = fov;
  camera.aspect = aspect;
  camera.updateProjectionMatrix();
  return fov;
}

/** rAF loop: renderFn(timeSeconds, dtSeconds). Returns {start, stop, running}. dt clamped to 0.1s. */
export function createLoop(renderFn) {
  let id = 0, last = 0, running = false;
  function frame(now) {
    if (!running) return;
    const t = now / 1000;
    const dt = last ? Math.min(0.1, t - last) : 1 / 60;
    last = t;
    renderFn(t, dt);
    id = requestAnimationFrame(frame);
  }
  return {
    start() { if (running) return; running = true; last = 0; id = requestAnimationFrame(frame); },
    stop() { running = false; cancelAnimationFrame(id); },
    get running() { return running; },
  };
}

/** Dispose all geometries/materials/textures under an Object3D. */
export function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const k in m) { const v = m[k]; if (v && v.isTexture && v !== _glowTex) v.dispose(); }
      m.dispose();
    }
  });
}

/** Thin glowing line (tube) between two Vector3 points. opts: {radius, opacity, additive}. */
export function makeTube(a, b, color = 0xffffff, opts = {}) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(opts.radius ?? 0.01, opts.radius ?? 0.01, 1, 8);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: opts.opacity ?? 1, depthWrite: false,
    blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(a);
  m.scale.set(1, len, 1);
  m.quaternion.setFromUnitVectors(_UP, dir.normalize());
  return m;
}

/** Standard soft studio lighting (hemi + key + rim) added to scene; returns the lights group. */
export function addStudioLights(scene, opts = {}) {
  const g = new THREE.Group();
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x0a0a12, opts.hemi ?? 0.6);
  const key = new THREE.DirectionalLight(0xffffff, opts.key ?? 1.6);
  key.position.set(4, 6, 5);
  const rim = new THREE.DirectionalLight(0x9fc8ff, opts.rim ?? 1.0);
  rim.position.set(-5, 2, -4);
  g.add(hemi, key, rim);
  scene.add(g);
  return g;
}

/** True if user prefers reduced motion. */
export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
