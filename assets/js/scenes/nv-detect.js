// Scene 3 — "Reading direction at a single point"
// Scanning NV probe above a YIG film. Spectrum panel shows σ+ / σ− ODMR dips.
// Geometry (consistent with the paper): stripline at x = 0, B along +y (three: −z),
// etched pit on the LEFT. Above the film: wave toward −x ⇒ σ+ (magenta), toward +x ⇒ σ− (cyan).
// Incident wave (stripline → pit, −x) = σ+ ; reflected wave (pit → stripline, +x) = σ−.
// The microwave frequency is FIXED (never swept). At a given frequency the incident and reflected
// waves share one wavelength and form a standing-wave pattern between the stripline and the pit.
// The NV dims only when the microwave sits on an NV line AND the local field has that handedness.
// Final top-down maps use the simulated σ+ / σ− maps (site/assets/data/pit-maps.png: R = σ+, G = σ−),
// with a procedural fallback if the data cannot be loaded.
//
// API: createScene(canvas, { reducedMotion }) → { setProgress, setParam, resize, start, stop, dispose }
// setParam('channel', 'plus' | 'minus' | 'both' | 'auto')
//   plus/minus: microwave fixed on the σ+ (upper) / σ− (lower) NV line
//   both      : re-tunes between the two fixed frequencies every ~2.5 s
//   auto      : σ+ line during the scan and incident beat, re-tuned to σ− for the reflected beat.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { maxPixelRatio } from './common.js';

/* ------------------------------------------------------------------ helpers */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const remap = (x, a, b) => clamp((x - a) / (b - a));
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';
const C = {
  plus: '#ff375f', minus: '#64d2ff', nv: '#ff3b30', nv2: '#ff6a4d',
  laser: '#30d158', gold: '#d4af37', amber: '#ffb340',
};

// physical-ish layout (scene units)
const STRIP_HW = 0.35;
const XE = -7.4;          // pit right edge (reflecting edge)
const PX0 = -8.4;         // pit left edge
const PHZ = 2.6;          // pit half-length along y (three z)
const TIP_H = 0.55;       // NV height above film
const SPEC_FP = 0.68;     // σ+ line (higher frequency)
const SPEC_FM = 0.36;     // σ− line (lower frequency)
// spin-wave wavenumbers at the two fixed frequencies (σ+ line: shorter wave; ratio as in the simulation)
const KP = 2.6;
const KM = 1.36;
// simulated map extents (pit edge at x = 0, stripline off-map to the right)
const DX0 = -4.193, DX1 = 19.607, DY0 = -10.442, DY1 = 10.657;
const MY0 = -9.41, MY1 = 9.63;   // displayed y window (keeps the card aspect undistorted)
const PIT_X0 = -2.3, PIT_HY = 5.1;

function glowTexture(size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.65)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeLabel(text, { color = '#f5f5f7', size = 0.42, weight = 600, pill = false } = {}) {
  const fs = 96;
  const c = document.createElement('canvas');
  let g = c.getContext('2d');
  g.font = `${weight} ${fs}px ${FONT}`;
  const w = Math.ceil(g.measureText(text).width + fs * (pill ? 1.1 : 0.5));
  c.width = w; c.height = Math.ceil(fs * 1.35);
  g = c.getContext('2d');
  g.font = `${weight} ${fs}px ${FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  if (pill) {
    roundRect(g, 2, 8, w - 4, c.height - 16, (c.height - 16) / 2);
    g.fillStyle = 'rgba(12,12,14,0.62)'; g.fill();
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.10)'; g.stroke();
  }
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = 12;
  g.fillStyle = color;
  g.fillText(text, w / 2, c.height / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(size * c.width / c.height, size, 1);
  s.renderOrder = 20;
  return s;
}

function makeArrow(from, to, color, { radius = 0.035, head = 0.32, headR = 0.11, opacity = 0.95 } = {}) {
  const g = new THREE.Group();
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  dir.normalize();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, toneMapped: false, depthWrite: false });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, len - head, 12), mat);
  shaft.position.y = (len - head) / 2;
  const tip = new THREE.Mesh(new THREE.ConeGeometry(headR, head, 20), mat);
  tip.position.y = len - head / 2;
  g.add(shaft, tip);
  g.position.copy(from);
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  return g;
}

function setGroupOpacity(obj, a) {
  obj.visible = a > 0.003;
  obj.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = m.opacity;
      m.opacity = m.userData.baseOpacity * a;
      if (m.uniforms && m.uniforms.uAlpha) m.uniforms.uAlpha.value = a;
    }
  });
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const RGB_P = hexRgb(C.plus), RGB_M = hexRgb(C.minus);

/* --------------------------------------------------------- film shader (3D) */
const FILM_COMMON = /* glsl */`
uniform float uTime, uPit, uRefl, uMaskP, uMaskM, uAmpL, uAmpR, uK;
#define XE ${XE.toFixed(2)}
#define PX0 ${PX0.toFixed(2)}
#define PHZ ${PHZ.toFixed(2)}
#define OM 2.4
#define FOC 6.5
float pitMask(vec2 p){
  float ix = smoothstep(PX0-0.05, PX0+0.05, p.x) * (1.0 - smoothstep(XE-0.05, XE+0.05, p.x));
  float iz = 1.0 - smoothstep(PHZ-0.05, PHZ+0.05, abs(p.y));
  return ix*iz;
}
float gAI, gAR, gAM;   // local amplitudes of incident / reflected / right-going waves
void waveField(vec2 p, out float wP, out float wM, out float wR){
  float x = p.x, z = p.y;
  float edgeZ = (1.0 - smoothstep(5.2, 6.95, abs(z))) * (1.0 - smoothstep(10.5, 11.95, abs(x)));
  // incident toward −x  (σ+ above the film)
  float aL = uAmpL * smoothstep(0.3, 0.9, -x) * exp(x/24.0);
  float dx = max(XE - x, 0.0);
  float sx = smoothstep(XE+0.1, XE-0.4, x);
  float sz = 1.0 - smoothstep(PHZ-0.35-0.12*dx, PHZ+0.35+0.12*dx, abs(z));
  float shadow = 1.0 - uPit*sx*sz;
  shadow *= 1.0 - uPit*pitMask(p);
  gAI = aL*shadow*edgeZ;
  wP = gAI*cos(uK*x + OM*uTime);
  // toward +x (σ− above the film)
  float aR = uAmpR * smoothstep(0.3, 0.9, x) * exp(-x/24.0);
  gAM = aR*edgeZ;
  wM = gAM*cos(uK*x - OM*uTime);
  // reflected from the pit edge, toward +x, converging beam (σ−). Same frequency ⇒ same k as the
  // incident wave; phase-matched at the edge, so incident + reflected form a standing wave.
  float d = x - XE;
  float hw = PHZ*abs(1.0 - d/FOC) + 0.55;
  float gain = sqrt(clamp(PHZ/hw, 0.0, 3.0));
  float env = 1.0 - smoothstep(hw-0.35, hw+0.35, abs(z));
  float inside = smoothstep(0.0, 0.25, d) * (1.0 - smoothstep(-1.2, 0.2, x));
  float front = 1.0 - smoothstep(uRefl*9.0-1.2, uRefl*9.0, d);
  gAR = 0.95*uAmpL*smoothstep(0.0, 0.15, uRefl)*env*gain*exp(-d/14.0)*inside*front*edgeZ;
  wR = gAR*cos(uK*(2.0*XE - x) + OM*uTime);
}
`;

const FILM_VERT = /* glsl */`
${FILM_COMMON}
varying vec3 vWorld;
void main(){
  vec3 pos = position;
  float wP, wM, wR;
  waveField(pos.xz, wP, wM, wR);
  pos.y += 0.07*(wP + wM + wR) - 0.30*uPit*pitMask(pos.xz);
  vec4 w = modelMatrix * vec4(pos, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const FILM_FRAG = /* glsl */`
${FILM_COMMON}
uniform float uAlpha;
varying vec3 vWorld;
void main(){
  vec2 p = vWorld.xz;
  float wP, wM, wR;
  waveField(p, wP, wM, wR);
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (n.y < 0.0) n = -n;
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 L = normalize(vec3(-0.35, 1.0, 0.55));
  float diff = clamp(dot(n, L), 0.0, 1.0);
  vec3 H = normalize(L + V);
  float spec = pow(clamp(dot(n, H), 0.0, 1.0), 90.0);
  float fres = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 4.0);

  vec3 amberA = vec3(0.16, 0.09, 0.025);
  vec3 amberB = vec3(0.36, 0.21, 0.065);
  float r = length(p*vec2(0.055, 0.09));
  vec3 base = mix(amberB, amberA, clamp(r, 0.0, 1.0)) * (0.6 + 0.5*diff);
  float sumW = wP + wM + wR;
  base *= 1.0 + 0.35*sumW;

  vec3 cy = vec3(1.0, 0.215, 0.37);
  vec3 mg = vec3(0.39, 0.82, 1.0);
  float mp = mix(0.08, 1.0, uMaskP), mm = mix(0.08, 1.0, uMaskM);
  // travelling crests: magenta = incident (toward −x), cyan = reflected / right-going (toward +x)
  float cP = smoothstep(0.45, 0.98, wP / max(gAI, 0.04)) * clamp(gAI*2.2, 0.0, 1.0);
  float cR = smoothstep(0.45, 0.98, wR / max(gAR, 0.04)) * clamp(gAR*2.2, 0.0, 1.0);
  float cMr = smoothstep(0.25, 0.95, wM / max(gAM, 0.04)) * clamp(gAM*2.5, 0.0, 1.0);
  float cM = max(cR, cMr);
  // standing wave where incident and reflected overlap: fixed fringes ∥ pit edge, period λ/2
  float ov = gAI*gAR;
  float fr = ov / (gAI*gAI + gAR*gAR + 0.02) * cos(2.0*uK*(p.x - XE));
  vec3 col = base;
  col *= 1.0 + 0.6*fr;
  col += vec3(1.0, 0.86, 0.62) * smoothstep(0.15, 0.5, fr) * 0.12;
  // σ+ stays red in front of the pit (Fig. 3e): the fringes only modulate it, never blank it
  col = mix(col, cy*0.85*(1.0 + 0.35*fr), cP*0.75*mp) + cy*cP*0.25*mp;
  col = mix(col, mg*0.85, cM*0.75*mm) + mg*cM*0.25*mm;
  col += vec3(1.0, 0.9, 0.75) * (spec*0.35 + fres*0.10);

  float pm = pitMask(p)*uPit;
  col = mix(col, vec3(0.03, 0.028, 0.026) + 0.06*diff, pm);
  float rim = pm*(1.0 - pm)*4.0;
  col += vec3(1.0, 0.7, 0.3)*rim*0.35*uPit;
  gl_FragColor = vec4(col, uAlpha);
}
`;

/* ------------------------------------------------------- map shader (HUD) */
const MAP_VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const MAP_FRAG = /* glsl */`
uniform float uChannel, uReveal, uAlpha, uAspect, uUseData;
uniform vec3 uColor;
uniform sampler2D uData;
varying vec2 vUv;
vec2 cexpi(float a){ return vec2(cos(a), sin(a)); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float plusMap(vec2 p){
  float k = 1.142;                         // shorter wave
  float x = p.x, y = p.y;
  float dx = max(-x, 0.0);
  float sz = 1.0 - smoothstep(5.0-0.5-0.22*dx, 5.0+0.5+0.22*dx, abs(y));
  float sx = smoothstep(0.3, -0.5, x);
  float A = (1.0 - sx*sz*0.97) * exp((x-22.0)/70.0);
  vec2 f = vec2(0.85, 0.0) + A*cexpi(-k*x);
  // weak back-reflection → standing wave near the edge
  float rr = 0.32*exp(-max(x, 0.0)/4.5)*(1.0 - smoothstep(4.4, 5.4, abs(y)))*smoothstep(-0.2, 0.2, x);
  f += rr*cexpi(k*x + 3.14159);
  // diffraction from the two corners → chevrons
  for (int i = 0; i < 2; i++){
    vec2 c = vec2(0.0, i == 0 ? 5.0 : -5.0);
    float rc = length(p - c);
    f += 0.26*cexpi(k*rc + 0.6)/sqrt(1.0 + 0.6*rc) * smoothstep(-0.5, 0.5, x);
  }
  float I = dot(f, f) / 3.6;
  float pit = step(${PIT_X0.toFixed(2)}, x)*step(x, 0.0)*step(abs(y), ${PIT_HY.toFixed(2)});
  return I*(1.0 - pit);
}
float minusMap(vec2 p){
  float k = 0.598;                         // longer wave
  float x = p.x, y = p.y;
  float d = max(x, 0.0);
  float F = 14.0;
  float hw = 5.0*abs(1.0 - d/F) + 1.1;
  float gain = sqrt(clamp(5.0/hw, 0.0, 3.2));
  float env = 1.0 - smoothstep(hw-0.9, hw+0.9, abs(y));
  float edge = exp(-pow((abs(y)-hw)/0.7, 2.0))*0.35;
  float B = (env*0.85 + edge)*gain*smoothstep(-0.2, 0.6, x)*exp(-d/40.0);
  vec2 f = vec2(0.36, 0.0) + B*cexpi(k*x);
  float I = (dot(f, f) - 0.13) / 2.5;
  return max(I, 0.0);
}
void main(){
  // rounded corners
  vec2 q = vUv*vec2(uAspect, 1.0);
  float rad = 0.03;
  vec2 cq = clamp(q, vec2(rad), vec2(uAspect-rad, 1.0-rad));
  float corner = 1.0 - smoothstep(rad-0.004, rad, length(q - cq));
  // scan pixels
  vec2 grid = vec2(176.0, 140.0);
  vec2 uvq = (floor(vUv*grid) + 0.5)/grid;
  vec2 p = vec2(mix(${DX0.toFixed(3)}, ${DX1.toFixed(3)}, uvq.x), mix(${MY0.toFixed(2)}, ${MY1.toFixed(2)}, uvq.y));
  float I;
  if (uUseData > 0.5) {
    // simulated maps: R = σ+ , G = σ− (contrast, 0–15 % → 0–1); window to the visible range
    vec2 tuv = vec2(uvq.x, (p.y - ${DY0.toFixed(3)}) / ${(DY1 - DY0).toFixed(3)});
    vec4 d = texture2D(uData, tuv);
    // σ+ (Fig. 3e) is bright everywhere but the pit and its shadow, so map it near-linearly;
    // σ− (Fig. 3f) keeps a steep curve so the converging beam stands out from its side lobes
    if (uChannel < 0.5) I = pow(clamp(d.r / 0.95, 0.0, 1.0), 1.25);
    else I = pow(clamp((d.g - 0.06) / 0.86, 0.0, 1.0), 1.9) * 0.98;
  } else {
    I = uChannel < 0.5 ? plusMap(p) : minusMap(p);
    I += (hash(floor(vUv*grid)) - 0.5)*0.045;
  }
  I = clamp(I, 0.0, 1.2);
  vec3 bg = vec3(0.035, 0.035, 0.04);
  vec3 col = mix(bg, uColor*0.95, smoothstep(0.0, 0.75, I));
  col += vec3(1.0)*smoothstep(0.78, 1.15, I)*0.55;
  // raster reveal (top → bottom), bright scan line
  float yl = 1.0 - uReveal;
  float shown = smoothstep(yl - 0.004, yl + 0.004, vUv.y);
  float line = exp(-pow((vUv.y - yl)*160.0, 2.0)) * step(uReveal, 0.999);
  col = mix(bg, col, shown) + uColor*line*0.9;
  gl_FragColor = vec4(col, uAlpha*corner);
}
`;

/* --------------------------------------------------------- camera keyframes */
// [p, tx, ty, tz, azDeg, elDeg, halfW, halfH]
const KEYS = [
  [0.00, -3.0, 0.6, 0.6, -30, 30, 12.5, 6.4],
  [0.15, -5.0, 0.9, 0.3, -24, 23, 7.8, 4.2],
  [0.30, -6.2, 1.0, 0.2, -16, 17, 6.2, 3.5],
  [0.45, 0.0, 1.0, 0.2, -6, 19, 8.0, 4.3],
  [0.60, 5.6, 1.0, 0.2, 8, 18, 6.6, 3.7],
  [0.70, -1.5, 0.8, 0.4, -18, 30, 10.0, 5.6],
  [0.80, -5.0, 0.7, 0.3, -32, 36, 7.6, 4.3],
  [0.88, -4.6, 0.4, 0.0, -18, 55, 9.0, 5.5],
  [0.97, -3.5, 0.0, 0.0, 0, 88, 11.0, 7.0],
  [1.00, -3.5, 0.0, 0.0, 0, 88, 11.0, 7.0],
];
function sampleKeys(p) {
  const n = KEYS.length;
  let i = 0;
  while (i < n - 2 && p > KEYS[i + 1][0]) i++;
  const k0 = KEYS[Math.max(i - 1, 0)], k1 = KEYS[i], k2 = KEYS[i + 1], k3 = KEYS[Math.min(i + 2, n - 1)];
  const t0 = k1[0], t1 = k2[0];
  const t = clamp((p - t0) / (t1 - t0));
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  const out = [];
  for (let j = 1; j < 8; j++) {
    const m1 = (k2[j] - k0[j]) / Math.max(k2[0] - k0[0], 1e-4) * (t1 - t0);
    const m2 = (k3[j] - k1[j]) / Math.max(k3[0] - k1[0], 1e-4) * (t1 - t0);
    out.push(h00 * k1[j] + h10 * m1 + h01 * k2[j] + h11 * m2);
  }
  return out;
}

function probeX(p) {
  if (p < 0.30) return -7;
  if (p < 0.60) return lerp(-7, 7, easeInOut(remap(p, 0.30, 0.60)));
  if (p < 0.74) return lerp(7, -4, easeInOut(remap(p, 0.60, 0.74)));
  return -4;
}

/* ================================================================ scene */
export function createScene(canvas, options = {}) {
  const reduced = !!options.reducedMotion;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(maxPixelRatio());
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.autoClear = false;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(renderer), 0.04);
  scene.environment = envRT.texture;

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);
  const disposables = [];
  const track = (x) => { disposables.push(x); return x; };
  const glowTex = track(glowTexture());

  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(-6, 12, 8);
  scene.add(key, new THREE.AmbientLight(0xffffff, 0.15));

  /* ---------------- film + substrate ---------------- */
  const FW = 24, FD = 14;
  const filmUniforms = {
    uTime: { value: 0 }, uPit: { value: 0 }, uRefl: { value: 0 },
    uMaskP: { value: 1 }, uMaskM: { value: 1 }, uAmpL: { value: 0.78 }, uAmpR: { value: 1.0 }, uK: { value: KP },
    uAlpha: { value: 1 },
  };
  const filmGeo = track(new THREE.PlaneGeometry(FW, FD, 300, 175));
  filmGeo.rotateX(-Math.PI / 2);
  const filmMat = track(new THREE.ShaderMaterial({
    uniforms: filmUniforms, vertexShader: FILM_VERT, fragmentShader: FILM_FRAG,
  }));
  const film = new THREE.Mesh(filmGeo, filmMat);
  scene.add(film);

  const slabMat = track(new THREE.MeshPhysicalMaterial({
    color: 0xb87a22, roughness: 0.35, metalness: 0, transparent: true, opacity: 0.92,
    emissive: 0x2a1500, envMapIntensity: 0.6,
  }));
  const hiddenMat = track(new THREE.MeshBasicMaterial({ visible: false }));
  const slab = new THREE.Mesh(track(new THREE.BoxGeometry(FW, 0.3, FD)), [slabMat, slabMat, hiddenMat, slabMat, slabMat, slabMat]);
  slab.position.y = -0.152;
  scene.add(slab);
  const subMat = track(new THREE.MeshPhysicalMaterial({
    color: 0x26262a, roughness: 0.25, metalness: 0, clearcoat: 0.6, envMapIntensity: 0.5,
  }));
  const sub = new THREE.Mesh(track(new THREE.BoxGeometry(FW, 1.1, FD)), subMat);
  sub.position.y = -0.31 - 0.55;
  scene.add(sub);

  // stripline
  const goldMat = track(new THREE.MeshStandardMaterial({
    color: 0xd4af37, metalness: 1, roughness: 0.22, emissive: 0x3a2a00, envMapIntensity: 1.4,
  }));
  const strip = new THREE.Mesh(track(new THREE.BoxGeometry(STRIP_HW * 2, 0.14, FD)), goldMat);
  strip.position.y = 0.07;
  scene.add(strip);

  // B arrow (along +y physical = three −z)
  const bGroup = new THREE.Group();
  // local origin = arrow head; placed and scaled per frame so it stays inside the frame
  bGroup.add(makeArrow(new THREE.Vector3(0, 0, 4.2), new THREE.Vector3(0, 0, 0), 0xe5e5ea,
    { radius: 0.04, head: 0.45, headR: 0.15, opacity: 0.9 }));
  const bLabel = makeLabel('B', { size: 0.7, color: '#f5f5f7', weight: 600 });
  bLabel.position.set(-0.6, 0.3, 0.3);
  bGroup.add(bLabel);
  scene.add(bGroup);

  // direction chips (scan phase)
  const chips = new THREE.Group();
  chips.add(makeArrow(new THREE.Vector3(-3.2, 0.45, 4.4), new THREE.Vector3(-6.6, 0.45, 4.4), C.plus));
  chips.add(makeArrow(new THREE.Vector3(3.2, 0.45, 4.4), new THREE.Vector3(6.6, 0.45, 4.4), C.minus));
  const lp = makeLabel('σ⁺', { color: C.plus, size: 0.62 }); lp.position.set(-7.4, 0.5, 4.4);
  const lm = makeLabel('σ⁻', { color: C.minus, size: 0.62 }); lm.position.set(7.4, 0.5, 4.4);
  chips.add(lp, lm);
  scene.add(chips);

  // reflection arrows
  const reflArrows = new THREE.Group();
  reflArrows.add(makeArrow(new THREE.Vector3(-1.0, 0.45, 3.7), new THREE.Vector3(-5.6, 0.45, 3.7), C.plus));
  reflArrows.add(makeArrow(new THREE.Vector3(-6.7, 0.45, 4.7), new THREE.Vector3(-2.1, 0.45, 4.7), C.minus));
  const li = makeLabel('incident · σ⁺', { color: C.plus, size: 0.34, pill: true }); li.position.set(-3.3, 0.85, 3.25);
  const lr = makeLabel('reflected · σ⁻', { color: C.minus, size: 0.34, pill: true }); lr.position.set(-4.4, 0.85, 5.2);
  reflArrows.add(li, lr);
  scene.add(reflArrows);

  const pitLabel = makeLabel('etched pit', { color: '#e5e5ea', size: 0.32, weight: 500, pill: true });
  pitLabel.position.set((PX0 + XE) / 2, 0.75, PHZ + 0.75);
  scene.add(pitLabel);

  /* ---------------- probe ---------------- */
  const probe = new THREE.Group();
  scene.add(probe);
  const glassMat = track(new THREE.MeshPhysicalMaterial({
    color: 0xeaf6ff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.32,
    clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.5, iridescenceIOR: 1.6,
    envMapIntensity: 2.6, flatShading: true, specularIntensity: 1, depthWrite: false,
  }));
  const edgeMat = track(new THREE.LineBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.45 }));
  const tipGeo = track(new THREE.ConeGeometry(0.34, 1.1, 6, 1));
  tipGeo.rotateX(Math.PI);
  tipGeo.translate(0, 0.55, 0);
  const tip = new THREE.Mesh(tipGeo, glassMat);
  tip.renderOrder = 5;
  probe.add(tip, new THREE.LineSegments(track(new THREE.EdgesGeometry(tipGeo)), edgeMat));
  const plateGeo = track(new THREE.BoxGeometry(0.95, 0.26, 0.95));
  plateGeo.translate(0, 1.23, 0);
  const plate = new THREE.Mesh(plateGeo, glassMat);
  plate.renderOrder = 5;
  probe.add(plate, new THREE.LineSegments(track(new THREE.EdgesGeometry(plateGeo)), edgeMat));

  // tuning fork hint
  const fork = new THREE.Group();
  fork.position.set(0, 1.36, 0);
  fork.rotation.x = 0.09;
  probe.add(fork);
  const quartzMat = track(new THREE.MeshPhysicalMaterial({
    color: 0xf2f6fb, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.22, emissive: 0x2a3038,
    clearcoat: 1, envMapIntensity: 2.0, depthWrite: false,
  }));
  const qEdge = track(new THREE.LineBasicMaterial({ color: 0xdfe8f5, transparent: true, opacity: 0.22 }));
  const prongGeo = track(new THREE.BoxGeometry(0.55, 0.24, 6.6));
  for (const px of [0, 1.05]) {
    const g = prongGeo.clone(); track(g);
    g.translate(px, 0.12, -3.0);
    const m = new THREE.Mesh(g, quartzMat); m.renderOrder = 4;
    fork.add(m, new THREE.LineSegments(track(new THREE.EdgesGeometry(g)), qEdge));
    const e = new THREE.Mesh(track(new THREE.BoxGeometry(0.16, 0.012, 6.2)), goldMat);
    e.position.set(px, 0.248, -3.1);
    fork.add(e);
  }
  const baseGeo = track(new THREE.BoxGeometry(2.1, 0.5, 1.2));
  baseGeo.translate(0.525, 0.25, -6.9);
  const baseM = new THREE.Mesh(baseGeo, quartzMat); baseM.renderOrder = 4;
  fork.add(baseM, new THREE.LineSegments(track(new THREE.EdgesGeometry(baseGeo)), qEdge));

  // green laser (focused cone from above)
  const laserMat = track(new THREE.ShaderMaterial({
    uniforms: { uAlpha: { value: 1 }, uColor: { value: new THREE.Color(C.laser) } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = position.y/7.0 + 0.5; vec4 mv = modelViewMatrix*vec4(position,1.0);
      vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uAlpha; uniform vec3 uColor; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
      float a = 0.26*pow(1.0 - vY, 1.4)*f + 0.16*exp(-vY*12.0);
      gl_FragColor = vec4(uColor, a*uAlpha); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  const laser = new THREE.Mesh(track(new THREE.CylinderGeometry(0.42, 0.02, 7, 40, 1, true)), laserMat);
  laser.position.y = 3.5 + 0.08;
  laser.renderOrder = 6;
  probe.add(laser);

  // NV + glow
  const nvCoreMat = track(new THREE.MeshBasicMaterial({ color: 0xff5040, toneMapped: false }));
  const nvCore = new THREE.Mesh(track(new THREE.SphereGeometry(0.045, 16, 12)), nvCoreMat);
  nvCore.position.y = 0.09;
  probe.add(nvCore);
  const mkGlow = (color, opacity, scale) => {
    const m = track(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const s = new THREE.Sprite(m); s.scale.setScalar(scale); s.position.y = 0.09; s.renderOrder = 8;
    probe.add(s); return s;
  };
  const glowA = mkGlow(C.nv2, 1.0, 0.75);
  const glowB = mkGlow(C.nv, 0.45, 2.4);
  const glowC = mkGlow(C.nv, 0.12, 5.5);

  // handedness orbit glyphs around the NV (plane ⟂ B)
  const orbit = new THREE.Group();
  orbit.position.y = 0.09;
  probe.add(orbit);
  const mkRing = (r, color) => {
    const m = track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, toneMapped: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    const ring = new THREE.Mesh(track(new THREE.TorusGeometry(r, 0.01, 8, 128)), m);
    orbit.add(ring);
    const dots = [];
    for (let i = 0; i < 7; i++) {
      const dm = track(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: 1 - i / 7, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const d = new THREE.Sprite(dm); d.scale.setScalar(0.22 * (1 - i / 10));
      orbit.add(d); dots.push(d);
    }
    return { ring, dots, r };
  };
  const ringP = mkRing(0.52, C.plus);
  const ringM = mkRing(0.70, C.minus);

  /* ---------------- HUD (orthographic overlay) ---------------- */
  const hud = new THREE.Scene();
  const hudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
  const quad = track(new THREE.PlaneGeometry(1, 1));

  const veilMat = track(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  const veil = new THREE.Mesh(quad, veilMat);
  veil.renderOrder = 0;
  hud.add(veil);

  // spectrum panel
  const specCanvas = document.createElement('canvas');
  const specCtx = specCanvas.getContext('2d');
  const specTex = track(new THREE.CanvasTexture(specCanvas));
  specTex.colorSpace = THREE.SRGBColorSpace;
  specTex.minFilter = THREE.LinearFilter;
  specTex.generateMipmaps = false;
  const specMat = track(new THREE.MeshBasicMaterial({ map: specTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity: 0 }));
  const specMesh = new THREE.Mesh(quad, specMat);
  specMesh.renderOrder = 10;
  hud.add(specMesh);

  // map cards
  const CARD_W = 1024, HEAD_H = 184, MAP_H = 820;
  function makeCard(channel) {
    const isP = channel === 0;
    const color = isP ? C.plus : C.minus;
    const group = new THREE.Group();
    const mapMat = track(new THREE.ShaderMaterial({
      uniforms: {
        uChannel: { value: channel }, uReveal: { value: 0 }, uAlpha: { value: 0 },
        uUseData: { value: 0 }, uData: { value: null },
        uAspect: { value: CARD_W / MAP_H }, uColor: { value: new THREE.Color(color) },
      },
      vertexShader: MAP_VERT, fragmentShader: MAP_FRAG, transparent: true, depthTest: false, depthWrite: false,
    }));
    const map = new THREE.Mesh(quad, mapMat);
    map.renderOrder = 4;
    group.add(map);

    // header
    const hc = document.createElement('canvas');
    hc.width = CARD_W; hc.height = HEAD_H;
    const hg = hc.getContext('2d');
    hg.fillStyle = color;
    hg.beginPath(); hg.arc(22, 66, 14, 0, Math.PI * 2); hg.fill();
    hg.font = `600 58px ${FONT}`; hg.textBaseline = 'middle';
    hg.fillStyle = color; hg.fillText(isP ? 'σ⁺ channel' : 'σ⁻ channel', 56, 66);
    hg.font = `400 38px ${FONT}`; hg.fillStyle = 'rgba(235,235,245,0.62)';
    hg.fillText(isP ? 'incident wave  ·  upper NV line  ·  simulation' : 'reflected wave  ·  lower NV line  ·  simulation', 2, 134);
    const htex = track(new THREE.CanvasTexture(hc)); htex.colorSpace = THREE.SRGBColorSpace;
    const headMat = track(new THREE.MeshBasicMaterial({ map: htex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity: 0 }));
    const head = new THREE.Mesh(quad, headMat);
    head.renderOrder = 5;
    group.add(head);

    // annotations over map
    const ac = document.createElement('canvas');
    ac.width = CARD_W; ac.height = MAP_H;
    const ag = ac.getContext('2d');
    const mx = (x) => (x - DX0) / (DX1 - DX0) * CARD_W;
    const my = (y) => (MY1 - y) / (MY1 - MY0) * MAP_H;
    ag.setLineDash([12, 9]); ag.lineWidth = 3; ag.strokeStyle = 'rgba(255,255,255,0.75)';
    ag.strokeRect(mx(PIT_X0), my(PIT_HY), mx(0) - mx(PIT_X0), my(-PIT_HY) - my(PIT_HY));
    ag.setLineDash([]);
    ag.font = `500 28px ${FONT}`; ag.fillStyle = 'rgba(255,255,255,0.8)'; ag.textAlign = 'center';
    ag.fillText('pit', mx(PIT_X0 / 2), my(PIT_HY) - 18);
    // arrow showing propagation direction
    const ay = my(8.1);
    const ax0 = isP ? mx(17.5) : mx(4.5), ax1 = isP ? mx(11) : mx(11);
    ag.strokeStyle = 'rgba(255,255,255,0.9)'; ag.fillStyle = 'rgba(255,255,255,0.9)'; ag.lineWidth = 3;
    ag.beginPath(); ag.moveTo(ax0, ay); ag.lineTo(ax1, ay); ag.stroke();
    const s = Math.sign(ax1 - ax0);
    ag.beginPath(); ag.moveTo(ax1 + s * 4, ay); ag.lineTo(ax1 - s * 18, ay - 11); ag.lineTo(ax1 - s * 18, ay + 11); ag.closePath(); ag.fill();
    ag.font = `500 30px ${FONT}`; ag.textAlign = s < 0 ? 'left' : 'right';
    ag.fillText(isP ? 'k' : 'k', ax0 + (s < 0 ? 12 : -12), ay + 1 + 10);
    const atex = track(new THREE.CanvasTexture(ac)); atex.colorSpace = THREE.SRGBColorSpace;
    const annoMat = track(new THREE.MeshBasicMaterial({ map: atex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity: 0 }));
    const anno = new THREE.Mesh(quad, annoMat);
    anno.renderOrder = 6;
    group.add(anno);
    hud.add(group);
    return { group, map, mapMat, head, headMat, anno, annoMat };
  }
  const cardP = makeCard(0);
  const cardM = makeCard(1);

  // simulated maps (fetched relative to this module); procedural maps stay as the fallback
  let disposed = false;
  new THREE.TextureLoader().load(new URL('../../data/pit-maps.png', import.meta.url).href, (tex) => {
    if (disposed) { tex.dispose(); return; }
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    track(tex);
    for (const c of [cardP, cardM]) { c.mapMat.uniforms.uData.value = tex; c.mapMat.uniforms.uUseData.value = 1; }
    if (!running) render(0);
  }, undefined, () => { /* keep the procedural fallback */ });

  /* ---------------- state ---------------- */
  const _v3 = new THREE.Vector3(), _ndc = new THREE.Vector2();
  const _ray = new THREE.Raycaster();
  const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.35);
  let W = 1, H = 1, dpr = 1;
  let target = 0, prog = 0;
  let channel = 'auto';
  // f: microwave tuning, 0 = σ+ line, 1 = σ− line (re-tuned in discrete steps, never swept)
  const sm = { f: 0, cam: null, offX: 0, offY: 0 };
  let running = false, raf = 0, lastT = performance.now(), time = reduced ? 1.7 : 0;
  let panel = { w: 300, h: 186, x: 0, y: 0 };
  let portrait = false;
  // 'card': a small fixed preview with no caption column (home page); tucks the spectrum into a corner
  let card = false;
  const CARD_AZ = 16, CARD_EL = 4;

  function layoutHUD() {
    hudCam.left = -W / 2; hudCam.right = W / 2; hudCam.top = H / 2; hudCam.bottom = -H / 2;
    hudCam.updateProjectionMatrix();
    veil.scale.set(W + 4, H + 4, 1);
    portrait = W / H < 0.9;
    const m = Math.max(16, Math.min(W, H) * 0.04);
    if (portrait) {
      const pw = Math.min(W - 32, 440);
      panel = { w: pw, h: pw * 0.62, x: 0, y: -H / 2 + m + pw * 0.31 + 8 };
    } else if (card) {
      const pw = clamp(W * 0.32, Math.min(200, W * 0.38), 280);
      panel = { w: pw, h: pw * 0.62, x: -W / 2 + m + pw / 2, y: H / 2 - m - pw * 0.31 };
    } else {
      const pw = clamp(W * 0.3, 300, 470);
      panel = { w: pw, h: pw * 0.62, x: W / 2 - m - pw / 2 - W * 0.02, y: H * 0.1 };
    }
    specMesh.scale.set(panel.w, panel.h, 1);
    specMesh.position.set(Math.round(panel.x), Math.round(panel.y), 0);
    const cw0 = Math.round(panel.w * dpr);
    const cw = Math.min(cw0, 1200);
    if (specCanvas.width !== cw) {
      specCanvas.width = cw;
      specCanvas.height = Math.round(cw * 0.62);
      specTex.dispose();
    }
    // cards
    const ratio = (HEAD_H + MAP_H) / CARD_W;
    let cw2, gap;
    const cards = [cardP, cardM];
    // maps live in the upper part of the frame; the final beat + channel control sit below them
    const top = (W < 735 ? 44 : 48) + H * 0.03;
    const bottom = H * (portrait ? 0.6 : 0.66);
    const midY = H / 2 - (top + bottom) / 2; // HUD y (up) of the band's centre
    if (!portrait) {
      gap = Math.max(24, W * 0.035);
      cw2 = Math.min(W * 0.4, 600, (bottom - top) / ratio);
      cards.forEach((c, i) => { c.cx = (i === 0 ? -1 : 1) * (cw2 / 2 + gap / 2); c.cy = midY; });
    } else {
      gap = 16;
      cw2 = Math.min(W - 40, 460, (bottom - top - gap) / 2 / ratio);
      const ch = cw2 * ratio;
      cards.forEach((c, i) => { c.cx = 0; c.cy = midY + (i === 0 ? 1 : -1) * (ch / 2 + gap / 2); });
    }
    for (const c of cards) {
      c.cw = cw2;
      const ch = cw2 * ratio, hh = cw2 * HEAD_H / CARD_W, mh = cw2 * MAP_H / CARD_W;
      c.head.scale.set(cw2, hh, 1); c.head.position.set(0, ch / 2 - hh / 2, 0);
      c.map.scale.set(cw2, mh, 1); c.map.position.set(0, -ch / 2 + mh / 2, 0);
      c.anno.scale.set(cw2, mh, 1); c.anno.position.copy(c.map.position);
    }
  }

  function resize() {
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    dpr = maxPixelRatio();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    W = w; H = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    layoutHUD();
    if (!running) render();
  }

  /* ---------------- spectrum drawing ---------------- */
  const lor = (f, f0, g = 0.045) => 1 / (1 + ((f - f0) / g) ** 2);
  const noiseSeed = Array.from({ length: 400 }, (_, i) => Math.sin(i * 12.9898 + 78.233) * 43758.5453 % 1);

  function drawSpectrum(st) {
    const g = specCtx;
    const cw = specCanvas.width, ch = specCanvas.height;
    const s = cw / 600;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, cw, ch);
    g.setTransform(s, 0, 0, s, 0, 0);
    const LW = 600, LH = 372;
    // glass panel
    roundRect(g, 1, 1, LW - 2, LH - 2, 26);
    const bgG = g.createLinearGradient(0, 0, 0, LH);
    bgG.addColorStop(0, 'rgba(44,44,48,0.82)');
    bgG.addColorStop(1, 'rgba(18,18,20,0.86)');
    g.fillStyle = bgG; g.fill();
    g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,255,255,0.12)'; g.stroke();

    // title + legend
    g.textBaseline = 'middle';
    g.font = `600 13px ${FONT}`;
    try { g.letterSpacing = '1.5px'; } catch (e) { /* ignore */ }
    g.fillStyle = 'rgba(235,235,245,0.55)';
    g.textAlign = 'left';
    g.fillText('SPECTRUM AT THE TIP', 28, 36);
    try { g.letterSpacing = '0px'; } catch (e) { /* ignore */ }
    g.font = `600 15px ${FONT}`;
    g.textAlign = 'right';
    const legend = [[C.minus, 'σ⁻', st.mM], [C.plus, 'σ⁺', st.mP]];
    let lx = LW - 28;
    for (const [col, txt, m] of legend) {
      g.globalAlpha = 0.35 + 0.65 * m;
      g.fillStyle = 'rgba(245,245,247,0.9)'; g.fillText(txt, lx, 36);
      const tw = g.measureText(txt).width;
      g.fillStyle = col; g.beginPath(); g.arc(lx - tw - 10, 36, 4.5, 0, Math.PI * 2); g.fill();
      lx -= tw + 34;
    }
    g.globalAlpha = 1;

    const x0 = 58, x1 = 572, y0 = 72, y1 = 300;
    const yb = y0 + 34;
    const scale = (y1 - yb) * 0.78;
    const X = (f) => x0 + f * (x1 - x0);
    // axes
    g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, y0 - 4); g.lineTo(x0, y1); g.lineTo(x1, y1); g.stroke();
    g.setLineDash([2, 5]); g.strokeStyle = 'rgba(255,255,255,0.10)';
    g.beginPath(); g.moveTo(x0, yb); g.lineTo(x1, yb); g.stroke(); g.setLineDash([]);
    g.font = `500 13px ${FONT}`; g.fillStyle = 'rgba(235,235,245,0.5)';
    g.textAlign = 'right'; g.fillText('frequency →', x1, y1 + 22);
    g.save(); g.translate(x0 - 22, (y0 + y1) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center';
    g.fillText('brightness', 0, 0); g.restore();

    const N = 240;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const f = i / (N - 1);
      const cp = st.dP * lor(f, SPEC_FP);
      const cm = st.dM * lor(f, SPEC_FM);
      pts.push({ x: X(f), y: yb + (cp + cm) * scale, cp, cm });
    }
    // dip fills
    const fills = [[C.plus, 'cp', st.mP], [C.minus, 'cm', st.mM]];
    for (const [col, key, m] of fills) {
      const [r, gg, b] = hexRgb(col);
      const grd = g.createLinearGradient(0, yb, 0, yb + scale);
      grd.addColorStop(0, `rgba(${r},${gg},${b},0.0)`);
      grd.addColorStop(1, `rgba(${r},${gg},${b},${0.32 * (0.25 + 0.75 * m)})`);
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(pts[0].x, yb);
      for (const p of pts) g.lineTo(p.x, yb + p[key] * scale);
      g.lineTo(pts[N - 1].x, yb); g.closePath(); g.fill();
    }
    // data points (noisy measurement)
    g.fillStyle = 'rgba(255,255,255,0.28)';
    for (let i = 1; i < N; i += 3) {
      const nz = noiseSeed[i % 400] - 0.5;
      const nz2 = Math.sin(i * 1.7 + st.t * 2.3) * 0.5;
      g.beginPath(); g.arc(pts[i].x, pts[i].y + (nz * 0.7 + nz2 * 0.3) * 9, 1.5, 0, Math.PI * 2); g.fill();
    }
    // curve, colored by contribution
    g.lineWidth = 2.2; g.lineCap = 'round';
    for (let i = 1; i < N; i++) {
      const a = pts[i - 1], b = pts[i];
      const wp = clamp(b.cp * 6 * (0.3 + 0.7 * st.mP)), wm = clamp(b.cm * 6 * (0.3 + 0.7 * st.mM));
      const r = Math.round(lerp(lerp(245, RGB_P[0], wp), RGB_M[0], wm));
      const gg = Math.round(lerp(lerp(245, RGB_P[1], wp), RGB_M[1], wm));
      const bb = Math.round(lerp(lerp(247, RGB_P[2], wp), RGB_M[2], wm));
      g.strokeStyle = `rgb(${r},${gg},${bb})`;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    // NV line references (fixed positions on the frequency axis)
    g.textAlign = 'center';
    for (const [f0, col, txt, m] of [[SPEC_FM, C.minus, 'σ⁻ line', st.mM], [SPEC_FP, C.plus, 'σ⁺ line', st.mP]]) {
      const [r, gg, b] = hexRgb(col);
      g.strokeStyle = `rgba(${r},${gg},${b},${0.22 + 0.25 * m})`; g.lineWidth = 1;
      g.setLineDash([3, 4]);
      g.beginPath(); g.moveTo(X(f0), yb - 8); g.lineTo(X(f0), y1); g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 0.5 + 0.5 * m;
      g.font = `600 14px ${FONT}`; g.fillStyle = col;
      g.fillText(txt, X(f0), y1 + 18);
      g.globalAlpha = 1;
    }
    // dip sublabels (which wave is being read)
    for (const [f0, d, sub] of [[SPEC_FP, st.dP, st.subP], [SPEC_FM, st.dM, st.subM]]) {
      const a = clamp(d * 4) * sub.a;
      if (a < 0.01) continue;
      g.globalAlpha = a;
      g.font = `500 13px ${FONT}`; g.fillStyle = 'rgba(235,235,245,0.8)';
      g.fillText(sub.text, X(f0), Math.min(yb + d * scale + 20, y1 - 8));
    }
    g.globalAlpha = 1;
    // microwave: fixed frequency marker
    const fc = st.fc;
    const cx = X(fc);
    const cp = st.dP * lor(fc, SPEC_FP), cm = st.dM * lor(fc, SPEC_FM);
    const cy = yb + (cp + cm) * scale;
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, y0 + 2); g.lineTo(cx, y1); g.stroke();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(cx, y0 + 4); g.lineTo(cx - 6, y0 - 5); g.lineTo(cx + 6, y0 - 5); g.closePath(); g.fill();
    g.font = `500 12px ${FONT}`; g.fillStyle = 'rgba(235,235,245,0.75)';
    g.textAlign = cx > x1 - 60 ? 'right' : 'center';
    g.fillText('microwave (fixed)', cx > x1 - 60 ? cx + 6 : cx, y0 - 15);
    g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 12;
    g.beginPath(); g.arc(cx, cy, 4.2, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    specTex.needsUpdate = true;
  }

  /* ---------------- per-frame update ---------------- */
  function update(dt) {
    const k = reduced ? 1 : 1 - Math.exp(-dt * 7);
    prog = reduced ? target : prog + (target - prog) * k;
    if (Math.abs(target - prog) < 1e-5) prog = target;
    const p = prog;
    const t = time;

    // fixed microwave frequency (discrete re-tunes only)
    let fT;
    if (channel === 'plus') fT = 0;
    else if (channel === 'minus') fT = 1;
    else if (channel === 'both') fT = reduced ? 0 : Math.floor(t / 2.5) % 2;
    else fT = p < 0.81 ? 0 : 1;   // auto: σ+ for the scan + incident beat, σ− for the reflected beat
    const kc = reduced ? 1 : 1 - Math.exp(-dt * 9);
    sm.f += (fT - sm.f) * kc;
    if (Math.abs(fT - sm.f) < 1e-3) sm.f = fT;
    const fsel = sm.f;
    const maskP = 1 - fsel, maskM = fsel;

    // storyboard
    const uPit = smoothstep(0.60, 0.68, p);
    const uRefl = remap(p, 0.66, 0.80);
    const px = probeX(p);
    const bob = reduced ? 0 : Math.sin(t * 1.1) * 0.025;
    probe.position.set(px, TIP_H + bob, 0);

    // dip depths from local wave content at the tip
    const shadowAt = 1;
    const incL = smoothstep(0.35, 2.2, -px) * shadowAt;
    const incR = smoothstep(0.35, 2.2, px);
    const refl = smoothstep(0, 0.35, uRefl) * smoothstep(XE + 0.2, XE + 1.0, px) * (1 - smoothstep(-1.2, 0.4, px));
    const dP = 0.78 * incL;
    const dM = clamp(0.9 * incR + 0.95 * refl);

    // microwave sits on one NV line; the NV only responds to the matching handedness there
    const fc = lerp(SPEC_FP, SPEC_FM, easeInOut(fsel));
    const onP = lor(fc, SPEC_FP), onM = lor(fc, SPEC_FM);
    const dipAtCursor = dP * onP + dM * onM;

    const specA = smoothstep(0.10, 0.20, p) * (1 - smoothstep(0.87, 0.91, p));
    const reflLabel = smoothstep(0.70, 0.78, p) * (px < -1 ? 1 : 0);
    if (specA > 0.003) {
      drawSpectrum({
        dP: dP * onP, dM: dM * onM, mP: maskP, mM: maskM, fc, t,
        subP: { text: 'incident', a: reflLabel },
        subM: { text: 'reflected', a: reflLabel },
      });
    }
    specMat.opacity = specA;
    specMesh.visible = specA > 0.003;

    // NV glow: brightness = ODMR curve at the microwave frequency (only once the spectrum is "on")
    const mwOn = smoothstep(0.08, 0.2, p);
    const bright = 1 - 0.62 * dipAtCursor * mwOn;
    const pulse = reduced ? 1 : 1 + 0.05 * Math.sin(t * 2.6);
    glowA.material.opacity = 0.95 * bright * pulse;
    glowB.material.opacity = 0.42 * bright * bright;
    glowC.material.opacity = 0.12 * bright * bright;
    glowA.scale.setScalar(0.55 + 0.25 * bright);
    glowB.scale.setScalar(1.4 + 1.1 * bright);
    glowC.scale.setScalar(3.2 + 2.6 * bright);
    nvCoreMat.color.setRGB(1, 0.32 + 0.12 * bright, 0.25).multiplyScalar(0.55 + 0.45 * bright);

    // orbit glyphs: σ+ clockwise as seen looking along B (from +z toward −z)
    const ringAP = clamp(dP * 1.6) * (0.25 + 0.75 * maskP) * mwOn;
    const ringAM = clamp(dM * 1.4) * (0.25 + 0.75 * maskM) * mwOn;
    const om = 2.4;
    for (const [rg, a, sgn] of [[ringP, ringAP, -1], [ringM, ringAM, 1]]) {
      rg.ring.material.opacity = 0.35 * a;
      rg.ring.visible = a > 0.01;
      rg.dots.forEach((d, i) => {
        const th = sgn * (om * t - i * 0.09) + (sgn > 0 ? 0.5 : 2.2);
        d.position.set(Math.cos(th) * rg.r, Math.sin(th) * rg.r, 0);
        d.material.opacity = a * (1 - i / 7) * 0.9;
        d.visible = a > 0.01;
      });
    }

    // film uniforms
    filmUniforms.uTime.value = t;
    filmUniforms.uPit.value = uPit;
    filmUniforms.uRefl.value = uRefl;
    // once the pit is in, the film shows only the tuned channel, as in the simulated maps (Fig. 3e/f):
    // σ+ = incident wave everywhere but the pit and its shadow; σ− = the reflected beam
    const offFloor = 0.45 * (1 - uPit);
    filmUniforms.uMaskP.value = offFloor + (1 - offFloor) * maskP;
    filmUniforms.uMaskM.value = offFloor + (1 - offFloor) * maskM;
    filmUniforms.uK.value = lerp(KP, KM, fsel);
    goldMat.emissiveIntensity = reduced ? 1 : 1 + 0.6 * Math.max(0, Math.sin(t * 2.4));

    // labels / helpers
    const fade3d = 1 - smoothstep(0.88, 0.93, p);
    setGroupOpacity(chips, smoothstep(0.03, 0.12, p) * (1 - smoothstep(0.52, 0.6, p)));
    setGroupOpacity(reflArrows, smoothstep(0.73, 0.79, p) * (1 - smoothstep(0.86, 0.9, p)));
    li.material.opacity *= 0.45 + 0.55 * maskP;
    lr.material.opacity *= 0.45 + 0.55 * maskM;
    setGroupOpacity(pitLabel, smoothstep(0.63, 0.69, p) * (1 - smoothstep(0.84, 0.88, p)));
    setGroupOpacity(bGroup, fade3d);
    laserMat.uniforms.uAlpha.value = 0.9 * fade3d;

    // veil + maps
    const veilA = smoothstep(0.885, 0.94, p);
    veilMat.opacity = 0.95 * veilA;
    veil.visible = veilA > 0.003;
    const cardA = smoothstep(0.90, 0.95, p);
    const cardS = lerp(0.95, 1, easeInOut(cardA));
    const cards = [[cardP, channel === 'minus' ? 0 : 1, remap(p, 0.915, 0.985)], [cardM, channel === 'plus' ? 0 : 1, remap(p, 0.93, 0.998)]];
    for (const [c, m, rev] of cards) {
      c.m = c.m === undefined || reduced ? m : c.m + (m - c.m) * kc;
      const a = cardA * (0.22 + 0.78 * c.m);
      c.group.visible = a > 0.003;
      c.group.position.set(c.cx * lerp(0.9, 1, cardA), c.cy, 0);
      c.group.scale.setScalar(cardS);
      c.mapMat.uniforms.uAlpha.value = a;
      c.mapMat.uniforms.uReveal.value = reduced ? (p > 0.95 ? 1 : rev) : rev;
      c.headMat.opacity = a;
      c.annoMat.opacity = a * smoothstep(0.55, 0.95, c.mapMat.uniforms.uReveal.value);
    }

    // camera
    const kv = sampleKeys(p);
    if (!sm.cam || reduced) sm.cam = kv.slice();
    else for (let i = 0; i < kv.length; i++) sm.cam[i] += (kv[i] - sm.cam[i]) * (1 - Math.exp(-dt * 10));
    let [tx, ty, tz, az, el, hw, hh] = sm.cam;
    if (card) { az += CARD_AZ; el += CARD_EL; }
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const aspect = W / H;
    let dist = Math.max(hh / tanH, (portrait ? 0.8 : 1) * hw / (tanH * aspect));
    const azr = THREE.MathUtils.degToRad(az), elr = THREE.MathUtils.degToRad(el);
    camera.position.set(
      tx + dist * Math.sin(azr) * Math.cos(elr),
      ty + dist * Math.sin(elr),
      tz + dist * Math.cos(azr) * Math.cos(elr),
    );
    camera.lookAt(tx, ty, tz);
    // keep the probe clear of the text beat (top-left) and the spectrum panel (right)
    let offX = 0, offY = 0;
    camera.clearViewOffset();
    camera.updateMatrixWorld();
    _v3.set(px, TIP_H, 0).project(camera);
    const beatA = card ? 0 : 1 - smoothstep(0.86, 0.9, p);
    if (portrait) {
      // the text beat sits across the top: drop the tip into the band between it and the spectrum panel
      const sy = (1 - _v3.y) / 2 * H;
      offY = lerp(H * 0.15 * specA, sy - H * 0.47, beatA);
    } else {
      const sx = (_v3.x + 1) / 2 * W;
      // beat column: right of the section rail on wide screens (see .beat--top-left in site.css)
      const beatRight = Math.max(W >= 1024 ? 184 : 16, (W - 1200) / 2) + 360;
      let L = card ? Math.max(W * 0.38, panel.x + W / 2 + panel.w / 2 + 24) : lerp(W * 0.1, beatRight + 60, beatA);
      let R = card ? W * 0.9 : lerp(W * 0.9, panel.x + W / 2 - panel.w / 2 - 90, specA);
      if (L > R) L = R = (L + R) / 2;
      if (sx < L) offX = sx - L; else if (sx > R) offX = sx - R;
    }
    camera.setViewOffset(W, H, offX, offY, W, H);
    camera.updateMatrixWorld();
    // pin the B arrow to a free corner of the frame so it never clips at the edge
    _ndc.set((portrait ? 0.88 : card ? 0.9 : 0.93) * 2 - 1, -((portrait ? 0.42 : card ? 0.6 : 0.7) * 2 - 1));
    _ray.setFromCamera(_ndc, camera);
    if (_ray.ray.intersectPlane(_plane, _v3)) {
      bGroup.position.copy(_v3);
      bGroup.scale.setScalar(clamp(0.12 * _ray.ray.origin.distanceTo(_v3) * tanH, 0.25, 1.5));
    }

    return veilA;
  }

  function render(dt = 0) {
    const veilA = update(dt);
    renderer.clear();
    if (veilA < 0.999) renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(hud, hudCam);
  }

  function frame(now) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    if (!reduced) time += dt;
    render(dt);
  }

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();

  return {
    setProgress(p) {
      target = clamp(Number(p) || 0);
      if (reduced || !running) { prog = target; sm.cam = null; render(0); }
    },
    setParam(name, value) {
      if (name === 'layout') { card = value === 'card'; layoutHUD(); if (!running) render(0); return; }
      if (name === 'channel' && ['plus', 'minus', 'both', 'auto'].includes(value)) {
        channel = value;
        if (reduced || !running) render(1);
      }
    },
    resize,
    start() {
      if (running) return;
      running = true;
      lastT = performance.now();
      if (reduced) { render(0); running = false; return; }
      raf = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(raf); },
    dispose() {
      disposed = true;
      running = false; cancelAnimationFrame(raf);
      ro.disconnect();
      for (const d of disposables) d.dispose?.();
      scene.traverse((o) => { if (o.isSprite && o.material.map && o.material.map !== glowTex) { o.material.map.dispose(); o.material.dispose(); } });
      for (const g of [chips, reflArrows, bGroup]) g.traverse((o) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      envRT.dispose(); pmrem.dispose();
      renderer.dispose();
    },
  };
}
