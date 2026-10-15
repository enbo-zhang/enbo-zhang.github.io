// micro-dots.js — model beside the dot-array micrographs: a templated array of Pt dots, each capped by a
// Ru dome, with h-BN in the valleys between them.
// Schematic, not to scale: the dot shape, layer thicknesses and the lamella size are chosen for legibility.
// Storyboard (auto-advancing stages, ~5 s dwell each, eased transitions, loops back to 0):
//   0 'Top view'         a patch of the dot array seen almost from above, greyscale like a plan-view SEM: slightly
//                        irregular dots on a locally hexagonal lattice, three grains meeting at wavy boundaries,
//                        a few vacancies
//   1 'FIB slice'        the camera tilts to an oblique view; a grainy protective cap strip is laid along one row
//                        of dots; trenches are milled on both sides (material vanishes in a staircase, sparks
//                        where the beam works), leaving a thin wall that lifts out and turns towards the viewer
//   2 'Cross-section'    the slice face-on and larger: substrate, thin Ta underlayer, Pt dots each capped by a Ru
//                        dome (thicker on top), h-BN pockets in the valleys and thin patchy h-BN on the dot tops
//                        (side walls mostly bare), the grainy FIB cap above following the bumps
//   3 'Elements'         the face recolours, top to bottom, into speckled element maps: Pt red (the FIB cap is Pt
//                        too), Ru blue, N yellow (h-BN), Ta magenta
//   4 'Valley close-up'  zoom into one valley: many thin curved h-BN sheets following the valley's curve, next to
//                        a metal grain with lattice fringes
//   4 → 0                the slice fades, the sample is restored while dark and the camera rises to the top view
// setParam('stage', i) tweens to stage i (then holds it 2x the dwell); setParam('autoplay', false) holds the stage.
// Fires 'model:stage' {index, count} on the canvas whenever the displayed stage changes (and once after creation).
// Drag sideways to rotate (offsets the scripted view, eases back after release).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  clamp, damp, lerp, smoothstep, remap, band, easeInOut, createRenderer, makeLabelSprite, makeGlowSprite,
  observeResize, createLoop, disposeObject,
} from './common.js';

export const STAGES = ['Top view', 'FIB slice', 'Cross-section', 'Elements', 'Valley close-up'];

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const f5 = (x) => Number(x).toFixed(5);
const g2 = (v) => `vec2(${f5(v[0])}, ${f5(v[1])})`;
const g3 = (hex) => { const c = new THREE.Color(hex); return `vec3(${f5(c.r)}, ${f5(c.g)}, ${f5(c.b)})`; };

// ---------------------------------------------------------------- section profile (world units: dot pitch = 1)
// Heights along y; the substrate top is y = 0. Each dot is a rounded cone of Pt rising from a Pt floor, capped by a
// Ru dome that is thick on top and thin on the flanks and in the valleys. Shapes are 2D distance fields (a rounded
// cone per dot, smoothly merged with the floor), so the valleys come out U-shaped and the h-BN sheets drawn in the
// close-up can follow the metal surface as offset curves.
const Y_TA = 0.06;              // top of the Ta underlayer
const Y_FLOOR = 0.2;            // top of the Pt floor between the dots
const PT_R1 = 0.3, PT_R2 = 0.12, PT_TOP = 0.32;    // Pt cone: foot radius, crown radius, height above the floor
const RU_DR = 0.06, RU_CAPR = 0.15, RU_TOP = 0.16; // Ru dome: extra flank radius, extra crown radius, extra on top
const RU_V = 0.035, RU_MIN = 0.03;                 // Ru in the valleys / at least this much over the Pt
const K_PT = 0.08, K_RU = 0.1;                     // fillet sizes where the cone and the dome meet the floor (bell, not skirt)
const K_DOT = 0.2;                                 // smooth merge of neighbouring domes: a round valley bottom, no crease
const Y_SURF = Y_FLOOR + RU_V;  // sample surface between the dots
const POCKET_H = 0.12;          // h-BN pocket depth in a valley
const MEN_H = 0.04, MEN_W = 0.045; // the pocket's top edge climbs this far up the valley walls, within this of the metal
const BN_TOP = 0.026;           // thin h-BN on the dot tops (patchy)
const Y_CAP = 1.15;             // top of the FIB cap
const Y_TR = -0.55;             // bottom of the slice = deepest trench floor
const Y_BASE = -1.3;            // bottom of the sample block

// ---------------------------------------------------------------- sample, trenches, slice
const LAM_HALF = 2.5;           // slice half-length (x): runs from valley to valley across five dots
const LAM_D = 0.5;              // slice thickness (z)
const CAP_W = 0.9;              // width of the deposited cap strip
const TRENCH = 1.85;            // trench width on each side
const NSL = 6;                  // trench slices per side (staircase)
const SLICE_W = TRENCH / NSL;
const STAIR = 0.065;            // depth step of the staircase
const BLOCK_R = 11;             // half-size of the sample block
const PATCH_R = 10.4;           // radius of the dot field
const VIG0 = 6.6, VIG1 = 10.2;  // field vignette (fades the patch edge into the dark)
const LAM_C = new THREE.Vector3(0, (Y_TR + Y_CAP) / 2, 0);   // slice centre (pivot) in its home pose
const LIFT_UP = 1.6, LIFT_FWD = 0.75;

// ---------------------------------------------------------------- close-up detail
const SHEET_SP = 0.0062;        // spacing of the h-BN sheets drawn in the close-up
const SHEET_N = 19;             // enough to fill a pocket; the outer sheets break up more often
const FRINGE_SP = 0.0046;       // lattice-fringe spacing in the metal grains
const GRAIN_CELL = 0.12;        // metal grain size (also gives the diffraction-like mottling in the cross-section)
const EDS_CELL = 0.013;         // speckle size of the element maps
const EDS_AA = 0.016;           // edge blur of the element maps

// ---------------------------------------------------------------- timing
const DWELL = 5.0;
const PROC_DUR = 5.0;           // the FIB sequence in stage 1
const DWELL1 = PROC_DUR + 1.3;
const TRANS = 1.4, TRANS_LONG = 1.6;
const P_CAP = [0.02, 0.26], P_SWAP = 0.27, P_MILL_F = [0.29, 0.52], P_MILL_B = [0.49, 0.72], P_LIFT = 0.75;
const YAW_MAX = THREE.MathUtils.degToRad(35), PITCH_MAX = THREE.MathUtils.degToRad(12);

/** Deterministic PRNG so the dot pattern is the same on every load. */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Per-dot variation along the sliced row (dots at x = -3 … 3): height scale, width scale, x shift.
const rowRng = mulberry32(0x5d07);
const DOTP = Array.from({ length: 7 }, () => ({ h: 0.95 + 0.1 * rowRng(), w: 0.96 + 0.08 * rowRng(), s: (rowRng() - 0.5) * 0.06 }));
/** Signed distance to a vertical rounded cone: foot circle r1 at the origin, crown circle r2 at height h. */
function sdCone(px, py, r1, r2, h) {
  px = Math.abs(px);
  const b = (r1 - r2) / h, a = Math.sqrt(1 - b * b), k = -b * px + a * py;
  if (k < 0) return Math.hypot(px, py) - r1;
  if (k > a * h) return Math.hypot(px, py - h) - r2;
  return a * px + b * py - r1;
}
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
/** Distances to the Pt and Ru surfaces of the sliced row (mirrors secSDF() in the shader); dots at x = i - centre. */
function secSDF(x, y, dotp = DOTP) {
  let mp = 9, mr = 9;
  dotp.forEach((d, i) => {
    const qx = x - (i - (dotp.length - 1) / 2) - d.s, qy = y - Y_FLOOR;
    const r1 = PT_R1 * d.w, r2 = PT_R2 * d.w, tp = PT_TOP * d.h, r2r = r2 + RU_CAPR;
    mp = Math.min(mp, sdCone(qx, qy, r1, r2, tp - r2));
    mr = smin(mr, sdCone(qx, qy, r1 + RU_DR, r2r, tp + RU_TOP - r2r), K_DOT);
  });
  const dPt = smin(y - Y_FLOOR, mp, K_PT);
  return { dPt, dRu: Math.min(smin(y - Y_SURF, mr, K_RU), dPt - RU_MIN) };
}
/** Height of the Ru (or Pt) surface at x, by bisection. */
function surfY(x, which = 'dRu', dotp = DOTP) {
  let lo = 0, hi = 1.2;
  for (let k = 0; k < 34; k++) { const m = (lo + hi) / 2; if (secSDF(x, m, dotp)[which] < 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
// h-BN pocket level in each valley (between dots v-3 and v-2) and the lowest Ru point there.
const VALLEY = Array.from({ length: 6 }, (_, v) => {
  let lo = Infinity, sx = 0, n = 0;
  const ys = Array.from({ length: 201 }, (_, k) => surfY(v - 3 + k / 200));
  lo = Math.min(...ys);
  ys.forEach((y, k) => { if (y < lo + 0.002) { sx += v - 3 + k / 200; n++; } });
  return { x: sx / n, lo, level: lo + POCKET_H * (0.88 + 0.24 * rowRng()) };
});

// ---------------------------------------------------------------- dot field: three grains, perturbed hex lattices
const GRAINS = [
  { c: [0.4, 0.3], th: 0, o: [0, 0] },
  { c: [8.4, -4.6], th: 0.34, o: [0.31, 0.17] },
  { c: [-6.3, 6.9], th: 0.71, o: [0.62, 0.41] },
];
const GRAIN_REACH = 0.55;       // each grain's lattice may run this far past the boundary (closes the gaps there)
const DOT_MIN_SEP = 0.72;       // closest two dots may sit (only happens where two grains meet)
/** How far (x, z) lies past the edge of grain gi (0 inside it); wavy boundaries. */
function grainPen(x, z, gi) {
  let bd = Infinity, dg = 0;
  GRAINS.forEach((g, i) => {
    const d = Math.hypot(x - g.c[0], z - g.c[1]) + 0.6 * Math.sin(0.52 * x + 1.7 * i) * Math.cos(0.43 * z - 0.9 * i);
    bd = Math.min(bd, d);
    if (i === gi) dg = d;
  });
  return dg - bd;
}
function buildField() {
  const rng = mulberry32(0x0d075);
  const cand = [];
  GRAINS.forEach((g, gi) => {
    const c = Math.cos(g.th), s = Math.sin(g.th);
    for (let j = -16; j <= 16; j++) {
      for (let i = -16; i <= 16; i++) {
        const lx = i + j * 0.5 + g.o[0], lz = j * Math.sqrt(3) / 2 + g.o[1];
        const x = c * lx - s * lz, z = s * lx + c * lz;
        const pen = grainPen(x, z, gi);
        if (Math.hypot(x, z) > PATCH_R || pen > GRAIN_REACH) continue;
        cand.push({ x, z, pen, row: gi === 0 && j === 0 && Math.abs(i) <= 3 ? i : null });
      }
    }
  });
  // grain interiors first, then the overhangs fill in wherever there is room
  cand.sort((a, b) => (a.pen > 0) - (b.pen > 0) || a.pen - b.pen);
  const grid = new Map(), dots = [];
  const key = (x, z) => `${Math.floor(x)},${Math.floor(z)}`;
  for (const p of cand) {
    let ok = true;
    for (let a = -1; a <= 1 && ok; a++) {
      for (let b = -1; b <= 1 && ok; b++) {
        for (const q of grid.get(`${Math.floor(p.x) + a},${Math.floor(p.z) + b}`) || []) {
          if (Math.hypot(q.x - p.x, q.z - p.z) < DOT_MIN_SEP) { ok = false; break; }
        }
      }
    }
    if (!ok) continue;
    const nearRow = Math.abs(p.z) < 1.4 && Math.abs(p.x) < 3.6;
    if (!nearRow && rng() < 0.025) continue;                       // a few vacancies, none near the sliced row
    const d = { ...p };
    if (p.row !== null) {
      const dp = DOTP[p.row + 3];
      Object.assign(d, { x: p.row + dp.s, z: 0, sx: dp.w, sz: dp.w, sy: dp.h, rot: rng() * 6.28 });
    } else {
      d.x += (rng() - 0.5) * 0.08; d.z += (rng() - 0.5) * 0.08;
      const sz = 0.95 + 0.1 * rng();
      Object.assign(d, { sx: sz * (0.94 + 0.12 * rng()), sz: sz * (0.94 + 0.12 * rng()), sy: 0.92 + 0.14 * rng(), rot: rng() * 6.28 });
    }
    d.bright = rng() < 0.02 ? 1.28 : 0.84 + 0.22 * rng();
    dots.push(d);
    const k = key(d.x, d.z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(d);
  }
  return dots;
}

// ---------------------------------------------------------------- shader chunks
const GLSL_NOISE = /* glsl */`
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  // Voronoi cells: (cell id, distance to the nearest boundary in cell units)
  vec3 voro(vec2 p) {
    vec2 ip = floor(p), fp = fract(p);
    float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec2 g = vec2(float(i), float(j));
        vec2 r = g + vec2(hash12(ip + g), hash12(ip + g + 19.7)) - fp;
        float d = dot(r, r);
        if (d < d1) { d2 = d1; d1 = d; id = ip + g; } else if (d < d2) { d2 = d; }
      }
    }
    return vec3(id, sqrt(d2) - sqrt(d1));
  }`;

// world-space trench test shared by the field, the block and the cap strip
const GLSL_MILL = /* glsl */`
  uniform float uSlice[${NSL * 2}];
  uniform float uFade;
  bool milledAway(vec3 w) {
    if (abs(w.x) > ${f5(LAM_HALF)}) return false;
    float az = abs(w.z) - ${f5(LAM_D / 2)};
    if (az < 0.0 || az > ${f5(TRENCH)}) return false;
    int j = int(min(floor(az / ${f5(SLICE_W)}), ${f5(NSL - 1)})) + (w.z < 0.0 ? ${NSL} : 0);
    return w.y > uSlice[j] + 0.0005;
  }
  float fieldVignette(vec3 w) { return 1.0 - smoothstep(${f5(VIG0)}, ${f5(VIG1)}, length(w.xz)); }`;

const GLSL_SECTION = /* glsl */`
  uniform vec3 uDotP[7];
  uniform float uPocket[6];
  float sdCone(vec2 p, float r1, float r2, float h) {
    p.x = abs(p.x);
    float b = (r1 - r2) / h, a = sqrt(1.0 - b * b), k = dot(p, vec2(-b, a));
    if (k < 0.0) return length(p) - r1;
    if (k > a * h) return length(p - vec2(0.0, h)) - r2;
    return dot(p, vec2(a, b)) - r1;
  }
  float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.0) / k; return min(a, b) - h * h * k * 0.25; }
  // distances to the Pt and Ru surfaces; crown = closeness to a dot's crown (where the thin h-BN patches sit)
  void secSDF(vec2 p, out float dPt, out float dRu, out float crown) {
    float mp = 9.0, mr = 9.0; crown = 0.0;
    for (int i = 0; i < 7; i++) {
      vec3 d = uDotP[i];
      vec2 q = vec2(p.x - float(i - 3) - d.z, p.y - ${f5(Y_FLOOR)});
      float r1 = ${f5(PT_R1)} * d.y, r2 = ${f5(PT_R2)} * d.y, tp = ${f5(PT_TOP)} * d.x, r2r = r2 + ${f5(RU_CAPR)};
      mp = min(mp, sdCone(q, r1, r2, tp - r2));
      mr = smin(mr, sdCone(q, r1 + ${f5(RU_DR)}, r2r, tp + ${f5(RU_TOP)} - r2r), ${f5(K_DOT)});
      crown = max(crown, 1.0 - smoothstep(0.1, 0.2, abs(q.x)));
    }
    dPt = smin(p.y - ${f5(Y_FLOOR)}, mp, ${f5(K_PT)});
    dRu = min(smin(p.y - ${f5(Y_SURF)}, mr, ${f5(K_RU)}), dPt - ${f5(RU_MIN)});
  }
  // wA = (substrate, Ta, Pt, Ru), wB = (h-BN, cap); dRu = distance above the Ru surface
  void secRegions(vec2 p, float aa, out vec4 wA, out vec2 wB, out float dRu) {
    float dPt, crown;
    secSDF(p, dPt, dRu, crown);
    int v = int(clamp(floor(p.x + 3.0), 0.0, 5.0));
    float lev = uPocket[v] + 0.003 * sin(p.x * 23.0);
    float men = 1.0 - clamp(dRu / ${f5(MEN_W)}, 0.0, 1.0);
    lev += ${f5(MEN_H)} * men * men;            // the stack's top edge curls up a little against the walls (a meniscus)
    float topT = ${f5(BN_TOP)} * crown * smoothstep(0.34, 0.56, vnoise(vec2(p.x * 9.0, 4.2)));
    float aSub = smoothstep(-aa, aa, p.y), aTa = smoothstep(-aa, aa, p.y - ${f5(Y_TA)});
    float aPt = smoothstep(-aa, aa, dPt), aRu = smoothstep(-aa, aa, dRu);
    float bBn = max(1.0 - smoothstep(-aa, aa, p.y - lev), 1.0 - smoothstep(-aa, aa, dRu - topT));
    wA = vec4(1.0 - aSub, aSub * (1.0 - aTa), aTa * (1.0 - aPt), aPt * (1.0 - aRu));
    wB = vec2(aRu * bBn, aRu * (1.0 - bBn));
  }`;

// element-map colours (sRGB) and the natural colours of the section
const EDS = { Pt: '#ff3b2f', Ru: '#4a6bff', N: '#ffe02e', Ta: '#e040fb' };
const NAT = { sub: '#5a6068', ta: '#7a7480', pt: '#d6ccb6', ru: '#97a0aa', bn: '#ecefe6', cap: '#7a756e' };
const CUT_COL = '#8e887b';      // a dot cut open by the trench (flat, like the milled walls)

export function createScene(canvas, options = {}) {
  const reducedMotion = !!options.reducedMotion;
  const renderer = createRenderer(canvas);
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 20, 45);
  const camera = new THREE.PerspectiveCamera(30, 2, 0.05, 80);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envTex = pmrem.fromScene(room, 0.04).texture;
  room.dispose();                         // its boxes and materials are only needed for the bake
  scene.environment = envTex;
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x05060a, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.25); key.position.set(3, 7, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fb0ff, 0.85); rim.position.set(-5, 3, -6); scene.add(rim);

  const root = new THREE.Group();
  scene.add(root);
  const sample = new THREE.Group();       // block + dot field + cap strip (dims away once the slice is out)
  root.add(sample);

  // shared uniforms
  const U = {
    uSlice: { value: new Array(NSL * 2).fill(Y_SURF) },
    uFade: { value: 1 },
    uSwap: { value: 0 },
    uDotP: { value: DOTP.map((d) => new THREE.Vector3(d.h, d.w, d.s)) },
    uPocket: { value: VALLEY.map((v) => v.level) },
    uEds: { value: 0 },
    uClose: { value: 0 },
    uLit: { value: 1 },
  };

  // ---------------------------------------------------------------- sample block (with milled trenches)
  const blockMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.15 });
  blockMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uSlice: U.uSlice, uFade: U.uFade, uSwap: U.uSwap });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;\nvarying vec3 vWN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vW;\nvarying vec3 vWN;\nuniform float uSwap;\n${GLSL_NOISE}\n${GLSL_MILL}
        bool openAt(vec3 w) {
          return milledAway(w) || (uSwap > 0.5 && abs(w.z) < ${f5(LAM_D / 2)} && abs(w.x) < ${f5(LAM_HALF)} && w.y > ${f5(Y_TR)});
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float hidW = 0.0;
        {
          float aa = max(fwidth(vW.y), 1e-4);
          vec3 c = ${g3('#585e66')};
          c = mix(c, ${g3('#6c6772')}, smoothstep(-aa, aa, vW.y));
          c = mix(c, ${g3('#a39a88')}, smoothstep(-aa, aa, vW.y - ${f5(Y_TA)}));
          c = mix(c, ${g3('#868e98')}, smoothstep(-aa, aa, vW.y - ${f5(Y_FLOOR)}));
          c *= 0.9 + 0.12 * vnoise(vec2((vW.x + vW.z) * 24.0, vW.y * 1.4));     // faint milling curtains
          float up = smoothstep(0.5, 0.9, vWN.y);
          float surf = up * step(${f5(Y_SURF - 0.004)}, vW.y);
          c = mix(c, ${g3('#4d535b')} * (0.9 + 0.15 * vnoise(vW.xz * 9.0)), up * (1.0 - surf));   // milled floors
          c = mix(c, ${g3('#1a1c1f')}, surf);                                                  // sample surface
          if (abs(vWN.y) < 0.5 && !openAt(vW + vWN * 0.01)) { c = ${g3('#1a1c1f')}; hidW = 1.0; }   // walls nobody can see yet
          diffuseColor.rgb = c;
        }`)
      // ...and lit like the surface, so the pixel cracks between coplanar box tops never show them as seams
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        if (hidW > 0.5) normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);`)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb *= uFade * fieldVignette(vW);');
  };
  const box = (x0, x1, y0, y1, z0, z1) => {
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    const m = new THREE.Mesh(g, blockMat);
    sample.add(m);
    return m;
  };
  const ZT = LAM_D / 2 + TRENCH;
  box(-BLOCK_R, BLOCK_R, Y_BASE, Y_TR, -BLOCK_R, BLOCK_R);
  // while nothing is milled the top layer is one box (no internal walls, so no edge-on seams in the top view)
  const whole = box(-BLOCK_R, BLOCK_R, Y_TR, Y_SURF, -BLOCK_R, BLOCK_R);
  const pieces = [
    box(-BLOCK_R, -LAM_HALF, Y_TR, Y_SURF, -BLOCK_R, BLOCK_R),
    box(LAM_HALF, BLOCK_R, Y_TR, Y_SURF, -BLOCK_R, BLOCK_R),
    box(-LAM_HALF, LAM_HALF, Y_TR, Y_SURF, ZT, BLOCK_R),
    box(-LAM_HALF, LAM_HALF, Y_TR, Y_SURF, -BLOCK_R, -ZT),
  ];
  const filler = box(-LAM_HALF, LAM_HALF, Y_TR, Y_SURF, -LAM_D / 2, LAM_D / 2);
  // trench slices: boxes standing on the trench floor, their tops lowered as they are milled
  const sliceGeo = new THREE.BoxGeometry(2 * LAM_HALF, 1, SLICE_W);
  sliceGeo.translate(0, 0.5, 0);
  const slices = [];
  for (let side = 0; side < 2; side++) {
    for (let j = 0; j < NSL; j++) {
      const m = new THREE.Mesh(sliceGeo, blockMat);
      const zc = LAM_D / 2 + (j + 0.5) * SLICE_W;
      m.position.set(0, Y_TR, side ? -zc : zc);
      sample.add(m);
      slices.push({ m, j, side, depth: Y_TR + STAIR * j, zc: side ? -zc : zc });
    }
  }

  // ---------------------------------------------------------------- dot field (instanced domes, SEM-like grey)
  // the same profile as the slice face, revolved (one average dot), stopping just above the surface plus a skirt
  const ONE = [{ h: 1, w: 1, s: 0 }];
  let rEnd = 0.6;
  while (rEnd > 0.2 && surfY(rEnd, 'dRu', ONE) - Y_SURF < 0.004) rEnd -= 0.002;
  // sample the profile densely, then keep DOME_PTS points spaced by arc length plus turning angle, so they crowd
  // at the foot and the shoulder and stay sparse on the flanks and the crown (~380 triangles per dot)
  const DOME_PTS = 13, DOME_SEG = 16, TURN_W = 0.2;
  const dense = [[rEnd, -0.03]];
  for (let i = 120; i >= 0; i--) { const r = rEnd * i / 120; dense.push([Math.max(r, 1e-4), surfY(r, 'dRu', ONE) - Y_SURF]); }
  const meas = [0];
  for (let i = 1; i < dense.length; i++) {
    const dx = dense[i][0] - dense[i - 1][0], dy = dense[i][1] - dense[i - 1][1];
    let turn = 0;
    if (i > 1) {
      const px = dense[i - 1][0] - dense[i - 2][0], py = dense[i - 1][1] - dense[i - 2][1];
      turn = Math.abs(Math.atan2(px * dy - py * dx, px * dx + py * dy));
    }
    meas.push(meas[i - 1] + Math.hypot(dx, dy) + TURN_W * turn);
  }
  const prof = [];
  for (let k = 0, i = 1; k < DOME_PTS; k++) {
    const m = meas[meas.length - 1] * k / (DOME_PTS - 1);
    while (i < meas.length - 1 && meas[i] < m) i++;
    const f = clamp((m - meas[i - 1]) / Math.max(meas[i] - meas[i - 1], 1e-9));
    prof.push(new THREE.Vector2(lerp(dense[i - 1][0], dense[i][0], f), lerp(dense[i - 1][1], dense[i][1], f)));
  }
  const domeGeo = new THREE.LatheGeometry(prof, DOME_SEG);
  const dotMat = new THREE.MeshStandardMaterial({ color: 0x939396, roughness: 0.62, metalness: 0.2, side: THREE.DoubleSide });
  dotMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uSlice: U.uSlice, uFade: U.uFade });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 wq = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wq = instanceMatrix * wq;
        #endif
        vW = (modelMatrix * wq).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vW;\n${GLSL_MILL}`)
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (milledAway(vW)) discard;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        // the inside of a dot only shows where the trench has cut it open: draw it as a flat metal cross-section
        float cutFace = gl_FrontFacing ? 0.0 : 1.0;
        diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(0.015, 0.15, vW.y - ${f5(Y_SURF)}));   // the foot fades into the surface`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float rimT = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.2);
          totalEmissiveRadiance += diffuseColor.rgb * (0.05 + 0.48 * rimT);      // SEM-like bright edges
        }`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        gl_FragColor.rgb = mix(gl_FragColor.rgb, ${g3(CUT_COL)}, cutFace);
        gl_FragColor.rgb *= uFade * fieldVignette(vW);`);
  };
  const dots = buildField();
  const rowDots = dots.filter((d) => d.row !== null && Math.abs(d.row) <= 2);
  const fieldDots = dots.filter((d) => !rowDots.includes(d));
  const mkInst = (list) => {
    const im = new THREE.InstancedMesh(domeGeo, dotMat, list.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    list.forEach((d, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.rot);
      m4.compose(new THREE.Vector3(d.x, Y_SURF, d.z), q, new THREE.Vector3(d.sx, d.sy, d.sz));
      im.setMatrixAt(i, m4);
      im.setColorAt(i, c.setScalar(d.bright));
    });
    sample.add(im);
    return im;
  };
  mkInst(fieldDots);
  const rowMesh = mkInst(rowDots);

  // ---------------------------------------------------------------- the slice (one box; its face is drawn by the shader)
  // the large fringed grain in the close-up: in the Ru on the left flank of valley 3
  const FEAT_C = [VALLEY[3].x - 0.19, VALLEY[3].lo + 0.045], FEAT_R = [0.085, 0.07], FEAT_A = 0.62;
  function sectionMaterial(capOnly) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.4, transparent: !capOnly });
    if (capOnly) mat.defines = { CAP_ONLY: '' };
    mat.fog = capOnly;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSec;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          #ifdef CAP_ONLY
            vSec = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #else
            vSec = transformed;
          #endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vSec;
          uniform float uSwap, uEds, uClose, uLit;
          ${GLSL_NOISE}
          ${GLSL_MILL}
          ${GLSL_SECTION}
          // wA, wB: region weights from secRegions() with the blurred EDS_AA edges, like a real map
          vec3 edsColor(vec3 sp, vec4 wA, vec2 wB) {
            vec4 el = vec4(wA.z + 0.8 * wB.y, wA.w, wB.x, wA.y);       // Pt (dots + cap), Ru, N, Ta
            vec4 cum = el * vec4(0.5, 0.58, 0.58, 0.5);
            float tot = cum.x + cum.y + cum.z + cum.w;
            vec2 cell = floor((sp.xy + sp.z * vec2(0.71, 1.31)) / ${f5(EDS_CELL)});
            float h1 = hash12(cell), h2 = hash12(cell + 17.3), h3 = hash12(cell + 41.9);
            vec3 c = vec3(0.0);
            if (h1 < tot) {
              float t = h2 * tot;
              c = t < cum.x ? ${g3(EDS.Pt)} : (t < cum.x + cum.y ? ${g3(EDS.Ru)} : (t < cum.x + cum.y + cum.z ? ${g3(EDS.N)} : ${g3(EDS.Ta)}));
            } else if (h1 > 0.972) {                                    // stray counts
              float k = fract(h2 * 7.13);
              c = 0.55 * (k < 0.45 ? ${g3(EDS.N)} : (k < 0.65 ? ${g3(EDS.Pt)} : (k < 0.85 ? ${g3(EDS.Ru)} : ${g3(EDS.Ta)})));
            }
            return c * (0.4 + 0.8 * h3);
          }`)
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
          #ifdef CAP_ONLY
            if (milledAway(vSec) || (uSwap > 0.5 && abs(vSec.z) < ${f5(LAM_D / 2)})) discard;
          #endif`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 sp = vSec;
          vec2 nzp = sp.xy + sp.z * vec2(0.73, 1.37);
          float aaS = max(max(fwidth(sp.x), fwidth(sp.y)), 1e-5) * 0.8;
          vec4 wA = vec4(0.0); vec2 wB = vec2(0.0, 1.0); float dRu = 1.0;
          #ifndef CAP_ONLY
            // once the element map covers the whole face, its blurred regions also serve the (hidden) shading
            secRegions(sp.xy, uEds > 0.999 ? ${f5(EDS_AA)} : aaS, wA, wB, dRu);
          #endif
          float gCap = vnoise(nzp * 46.0) * 0.6 + vnoise(nzp * 115.0) * 0.4;
          gCap = mix(gCap, 0.5 + 0.3 * (gCap - 0.5), uClose);                  // close up: no big blotches
          vec3 gv = voro(nzp / ${f5(GRAIN_CELL)});
          vec3 cSub = ${g3(NAT.sub)} * (0.93 + 0.1 * vnoise(nzp * 16.0));
          vec3 cTa = ${g3(NAT.ta)} * (0.92 + 0.12 * vnoise(nzp * 30.0));
          vec3 cPt = ${g3(NAT.pt)} * (0.86 + 0.22 * hash12(gv.xy));
          vec3 cRu = ${g3(NAT.ru)} * (0.86 + 0.22 * hash12(gv.xy + 7.7));
          vec3 cBn = ${g3(NAT.bn)} * (0.94 + 0.08 * vnoise(nzp * 60.0));
          vec3 cCap = ${g3(NAT.cap)} * (0.58 + 0.66 * gCap);
          #ifndef CAP_ONLY
          if (uClose > 0.001) {
            // h-BN sheets: offset curves of the metal surface (they follow the U of the valley), gently wavy;
            // continuous near the metal, breaking up more often further out
            float ph = (dRu - 0.003 + 0.0005 * sin(sp.x * 95.0) + 0.0003 * sin(sp.x * 230.0 + 1.3)) / ${f5(SHEET_SP)};
            float fwp = fwidth(ph);
            float n = floor(ph + 0.5);
            float ln = 1.0 - smoothstep(0.07, 0.2 + fwp, abs(ph - n));
            float brk = mix(0.12, 0.42, clamp(n / ${f5(SHEET_N)}, 0.0, 1.0));
            ln *= smoothstep(brk, brk + 0.1, vnoise(vec2(sp.x * 30.0 + n * 1.7, n * 3.7)));
            ln *= step(0.0, n) * (1.0 - smoothstep(${f5(SHEET_N - 1.5)}, ${f5(SHEET_N + 0.5)}, n));
            ln *= 1.0 - smoothstep(0.4, 0.8, fwp);
            vec3 bnC = ${g3(NAT.bn)} * (0.24 + 0.05 * vnoise(sp.xy * 900.0)) + ${g3(NAT.bn)} * 0.78 * ln;
            cBn = mix(cBn, bnC, uClose);
            // lattice fringes: faint, one orientation per grain, and strong in one large Ru grain beside the valley
            float ang = hash12(gv.xy + 3.1) * 3.14159;
            float fp = dot(sp.xy, vec2(cos(ang), sin(ang))) / ${f5(FRINGE_SP)};
            float fr = cos(6.28318 * fp) * (1.0 - smoothstep(0.3, 0.6, fwidth(fp)));
            float gb = mix(0.78, 1.0, smoothstep(0.0, 0.05, gv.z));
            float mG = (1.0 + (0.05 + 0.1 * hash12(gv.xy + 8.3)) * fr) * gb;
            vec2 fq = (sp.xy - ${g2(FEAT_C)}) / ${g2(FEAT_R)};
            float fd = length(fq) + 0.22 * (vnoise(sp.xy * 38.0) - 0.5);
            float feat = 1.0 - smoothstep(0.92, 1.0, fd);
            float fpF = dot(sp.xy, vec2(${f5(Math.cos(FEAT_A))}, ${f5(Math.sin(FEAT_A))})) / ${f5(FRINGE_SP)};
            float frF = cos(6.28318 * fpF) * (1.0 - smoothstep(0.3, 0.6, fwidth(fpF)));
            float mF = 1.5 * (1.0 + 0.45 * frF) * mix(0.7, 1.0, 1.0 - smoothstep(0.8, 0.92, fd));   // brighter, crisp fringes, dark rim
            // a darker, less saturated palette at this scale so the sheets and fringes carry the picture
            vec3 lw = vec3(0.299, 0.587, 0.114);
            cPt = mix(cPt, mix(vec3(dot(cPt, lw)), cPt, 0.5) * 0.46 * mG, uClose);
            cRu = mix(cRu, mix(vec3(dot(cRu, lw)), cRu, 0.5) * 0.44 * mix(mG, mF, feat), uClose);
            // amorphous cap: fine speckle at this scale
            cCap *= mix(1.0, 0.62 * (0.8 + 0.22 * hash12(floor(sp.xy * 1100.0)) + 0.16 * vnoise(sp.xy * 420.0)), uClose);
          }
          #endif
          vec3 secCol = cSub * wA.x + cTa * wA.y + cPt * wA.z + cRu * wA.w + cBn * wB.x + cCap * wB.y;
          diffuseColor.rgb = secCol;
          float secRough = dot(wA, vec4(0.85, 0.6, 0.58, 0.52)) + wB.x * 0.9 + wB.y * 0.8;
          float secMetal = dot(wA, vec4(0.0, 0.4, 0.42, 0.45)) + wB.y * 0.2;
          vec3 secEmit = secCol * (0.16 + 0.22 * wB.x);`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = secRough;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = secMetal;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += secEmit;')
        .replace('#include <opaque_fragment>', `#include <opaque_fragment>
          #ifdef CAP_ONLY
            gl_FragColor.rgb *= uFade * fieldVignette(sp);
          #else
            gl_FragColor.rgb *= uLit;
            if (uEds > 0.001) {
              float sweep = uEds * ${f5(Y_CAP - Y_TR + 0.4)} - (${f5(Y_CAP)} - sp.y);
              float me = smoothstep(0.0, 0.15, sweep);
              if (me > 0.0) {
                vec4 eA = wA; vec2 eB = wB;
                if (uEds <= 0.999) { float dd; secRegions(sp.xy, ${f5(EDS_AA)}, eA, eB, dd); }   // mid-sweep only
                gl_FragColor.rgb = mix(gl_FragColor.rgb, edsColor(sp, eA, eB), me);
              }
            }
          #endif`);
    };
    return mat;
  }
  const lamMat = sectionMaterial(false);
  const pivot = new THREE.Group();          // slice pose (pivot at the slice centre)
  const lamGroup = new THREE.Group();       // section coordinates (y = 0 at the substrate top)
  lamGroup.position.copy(LAM_C).negate();
  pivot.add(lamGroup);
  root.add(pivot);
  const lamGeo = new THREE.BoxGeometry(2 * LAM_HALF, Y_CAP - Y_TR, LAM_D);
  lamGeo.translate(0, (Y_CAP + Y_TR) / 2, 0);
  const lamella = new THREE.Mesh(lamGeo, lamMat);
  lamGroup.add(lamella);

  // cap strip, deposited along the row before milling (same grain as the slice's cap, so the hand-over is seamless)
  const capMat = sectionMaterial(true);
  const capGeo = new THREE.BoxGeometry(2 * LAM_HALF, Y_CAP - Y_SURF + 0.02, CAP_W);
  capGeo.translate(LAM_HALF, (Y_CAP + Y_SURF - 0.02) / 2, 0);
  const capStrip = new THREE.Mesh(capGeo, capMat);
  capStrip.position.x = -LAM_HALF;
  sample.add(capStrip);

  // ---------------------------------------------------------------- beam + sparks (stage 1 only)
  const beamGeo = new THREE.CylinderGeometry(0.16, 0.02, 7, 24, 1, true);
  beamGeo.translate(0, 3.5, 0);
  const beamMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0x9ccbff) } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() { float core = pow(abs(dot(normalize(vN), normalize(vV))), 2.5);
        float a = uOpacity * core * pow(1.0 - vUv.y, 1.5); gl_FragColor = vec4(uColor * a, a); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(beamGeo, beamMat);
  // column tilt: towards -z for the cap; while milling, leaning away from the slice over the trench being cut
  const UP = new THREE.Vector3(0, 1, 0);
  const BEAM_DIR = [new THREE.Vector3(-0.32, 1, -0.38).normalize(), new THREE.Vector3(-0.32, 1, 0.38).normalize()];
  beam.quaternion.setFromUnitVectors(UP, BEAM_DIR[0]);
  beam.renderOrder = 5;
  root.add(beam);
  const sparkRng = mulberry32(0x5a5a);
  const sparks = Array.from({ length: 14 }, () => {
    const s = makeGlowSprite(0xd8ecff, { size: 0.12, opacity: 0 });
    s.renderOrder = 6;
    root.add(s);
    return { s, ph: sparkRng(), sz: 0.08 + 0.1 * sparkRng() };
  });
  const hitGlow = makeGlowSprite(0xbfe0ff, { size: 0.5, opacity: 0 });
  hitGlow.renderOrder = 6;
  root.add(hitGlow);

  // ---------------------------------------------------------------- labels (fixed pixel size)
  const labels = [];
  const FZ = LAM_D / 2 + 0.01;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  function label(text, { pos, anchor = null, key, gate = null, color = '#c7c7cc', parent = lamGroup, bg = 'rgba(0,0,0,0.6)', lineA = 0.6, lineColor = 0xc7c7cc }) {
    const s = makeLabelSprite(text, { color, fontSize: 42, fontFamily: MONO, fontWeight: 500, scale: 0.2, glow: false, background: bg, padding: 12 });
    s.position.copy(pos);
    parent.add(s);
    let line = null, lineMat = null;
    if (anchor) {
      lineMat = new THREE.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      line = new THREE.Line(g, lineMat);
      line.renderOrder = 9;
      line.frustumCulled = false;
      parent.add(line);
    }
    const lb = { s, pos: pos.clone(), line, lineMat, anchor, key, gate, lineA, aspect: s.scale.x / s.scale.y };
    labels.push(lb);
    return lb;
  }
  const V0 = VALLEY[2], V3v = VALLEY[3];         // valleys at x ≈ -0.5 and x ≈ +0.5
  const dotTop = (k) => surfY(k + DOTP[k + 3].s);
  // stage 1
  label('FIB cap', { pos: V3(-1.15, Y_CAP + 0.55, 0), anchor: V3(-1.15, Y_CAP, 0), key: 'l1', parent: root,
    gate: (p) => smoothstep(0.04, 0.09, p) * (1 - smoothstep(0.7, 0.76, p)) });
  // stage 2: natural colours
  const A_RU = V3(1 + DOTP[4].s, dotTop(1) - 0.07, FZ), A_BN = V3(V0.x, (V0.lo + V0.level) / 2, FZ);
  const A_PT = V3(DOTP[3].s, 0.38, FZ), A_TA = V3(VALLEY[4].x, Y_TA / 2, FZ);
  const P_RU = V3(1.05, 0.97, FZ), P_BN = V3(-0.45, 0.97, FZ), P_PT = V3(0.05, -0.3, FZ), P_TA = V3(1.6, -0.3, FZ);
  const capL2 = label('FIB cap', { pos: V3(-1.95, 0.97, FZ), key: 'l2' });   // x follows the framing (resize)
  label('Ru', { pos: P_RU, anchor: A_RU, key: 'l2' });
  label('h-BN', { pos: P_BN, anchor: A_BN, key: 'l2' });
  label('Pt', { pos: P_PT, anchor: A_PT, key: 'l2' });
  label('Ta', { pos: P_TA, anchor: A_TA, key: 'l2' });
  // stage 3: element maps
  const BG3 = 'rgba(0,0,0,0.86)';                // the element map is busy: darker label boxes
  label('Ru', { pos: P_RU, anchor: A_RU, key: 'l3', color: '#8aa0ff', bg: BG3, lineA: 0.95, lineColor: 0xffffff });
  label('N', { pos: P_BN, anchor: A_BN, key: 'l3', color: EDS.N, bg: BG3, lineA: 0.95, lineColor: 0xffffff });
  label('Pt', { pos: P_PT, anchor: A_PT, key: 'l3', color: '#ff6a5e', bg: BG3, lineA: 0.95, lineColor: 0xffffff });
  label('Ta', { pos: P_TA, anchor: A_TA, key: 'l3', color: '#ea7cff', bg: BG3, lineA: 0.95, lineColor: 0xffffff });
  // stage 4: one valley
  label('h-BN layers', { pos: V3(V3v.x + 0.13, V3v.level + 0.075, FZ), anchor: V3(V3v.x + 0.03, V3v.lo + 0.03, FZ), key: 'l4' });
  label('metal grain', { pos: V3(V3v.x - 0.12, V3v.lo - 0.035, FZ), anchor: V3(FEAT_C[0] + 0.01, FEAT_C[1] - 0.02, FZ), key: 'l4' });

  // ---------------------------------------------------------------- stages
  const S1_YAW = 0.42, S1_PITCH = 0.6, FACE_K = 0.88;
  const DISP = LAM_C.clone().add(V3(0, LIFT_UP, LIFT_FWD));
  const lamPt = (x, y, z) => [DISP.x + x, DISP.y + y - LAM_C.y, DISP.z + z];
  const SC = ['proc', 'show', 'dim', 'eds', 'close', 'l1', 'l2', 'l3', 'l4'];
  const zero = { proc: 0, show: 0, dim: 0, eds: 0, close: 0, l1: 0, l2: 0, l3: 0, l4: 0 };
  const REST = [
    { ...zero, t: [0.3, Y_SURF, 0.35], hw: 6.4, hh: 4.0, yaw: 0.12, pitch: 1.36 },
    { ...zero, t: [0, 0.85, 0.45], hw: 4.1, hh: 2.7, yaw: S1_YAW, pitch: S1_PITCH, l1: 1 },
    { ...zero, t: lamPt(0, 0.28, 0), hw: 2.75, hh: 1.0, yaw: 0, pitch: 0, proc: 1, show: 1, dim: 1, l2: 1 },
    { ...zero, t: lamPt(0, 0.28, 0), hw: 2.75, hh: 1.0, yaw: 0, pitch: 0, proc: 1, show: 1, dim: 1, eds: 1, l3: 1 },
    { ...zero, t: lamPt(V3v.x - 0.035, V3v.lo + 0.055, LAM_D / 2), hw: 0.25, hh: 0.14, yaw: 0, pitch: 0, proc: 1, show: 1, dim: 1, close: 1, l4: 1 },
  ];

  let W = 1, H = 1, tanV = 0.27, tanH = 0.37;
  const fitR = (hw, hh) => Math.max(hh / tanV, hw / tanH) * 1.04;
  // cross-section stages: on narrow canvases frame fewer dots so the section still fills the height
  const hwOf = (i) => (i === 2 || i === 3 ? lerp(1.85, REST[i].hw, smoothstep(0.85, 1.3, W / H)) : REST[i].hw);
  const restR = (i) => fitR(hwOf(i), REST[i].hh);
  const S = { t: new THREE.Vector3(...REST[0].t), r: 14, yaw: REST[0].yaw, pitch: REST[0].pitch, lamFade: 1, lamP: 0 };
  for (const k of SC) S[k] = REST[0][k];
  let stage = 0, stageClock = 0, hold = 1, autoplay = true, time = 0;
  let trans = null;
  let emitted = false;
  function emit() {
    emitted = true;
    canvas.dispatchEvent(new CustomEvent('model:stage', { detail: { index: stage, count: STAGES.length } }));
  }
  function setRest(i) {
    const R = REST[i];
    S.t.set(...R.t); S.r = restR(i); S.yaw = R.yaw; S.pitch = R.pitch; S.lamFade = 1;
    for (const k of SC) S[k] = R[k];
    if (i === 1 && reducedMotion) S.proc = 1;                // reduced motion: show the end of the FIB sequence
    S.lamP = S.proc;
  }
  function goTo(i, picked) {
    hold = picked ? 2 : 1;
    stageClock = 0;
    const changed = i !== stage;
    stage = i;
    if (reducedMotion) { trans = null; setRest(i); } else {
      const from = { t: S.t.clone(), r: S.r, yaw: S.yaw, pitch: S.pitch, lamP: S.lamP };
      for (const k of SC) from[k] = S[k];
      const dur = i === 4 || (i === 0 && from.dim > 0.5) ? TRANS_LONG : TRANS;
      trans = { from, to: i, u: 0, dur, back: REST[i].proc < from.proc - 1e-3 };
    }
    if (changed || picked) emit();
  }
  function stepStage(dt) {
    if (trans) {
      trans.u = Math.min(1, trans.u + dt / trans.dur);
      const u = trans.u, e = easeInOut(u), F = trans.from, R = REST[trans.to];
      // camera: zoom towards (or away from) a point that stays put on screen
      const rB = restR(trans.to);
      S.r = Math.exp(lerp(Math.log(F.r), Math.log(rB), e));
      const tB = vTmp.set(...R.t);
      if (rB < F.r) S.t.copy(F.t).sub(tB).multiplyScalar((1 - e) * S.r / F.r).add(tB);
      else S.t.copy(tB).sub(F.t).multiplyScalar(e * S.r / rB).add(F.t);
      S.yaw = lerp(F.yaw, R.yaw, e); S.pitch = lerp(F.pitch, R.pitch, e);
      for (const k of SC) S[k] = lerp(F[k], R[k], e);
      S.lamP = S.proc; S.lamFade = 1;
      if (u >= 1) { trans = null; stageClock = 0; return; }
      if (trans.back) {
        // undoing the FIB sequence: the lifted slice keeps its pose and fades out while the sample is restored
        S.lamP = F.lamP; S.show = F.show;
        if (F.dim > 0.98) {
          // the sample was hidden: restore it at once and let it brighten under the fading slice (a cross-fade)
          S.proc = R.proc;
          S.lamFade = 1 - smoothstep(0, 0.5, u);
          S.dim = lerp(F.dim, R.dim, smoothstep(0.1, 0.75, u));
        } else {
          // the sample is in view: swap it during a short dip (black for under 0.1 s)
          S.proc = u >= 0.23 ? R.proc : F.proc;
          S.lamFade = 1 - smoothstep(0, 0.2, u);
          S.dim = Math.max(S.dim, band(u, 0, 0.2, 0.26, 0.55));
        }
      } else if (R.dim > F.dim) S.dim = lerp(F.dim, R.dim, smoothstep(0, 0.6, u));   // clear the field early
      return;
    }
    stageClock += dt;
    if (stage === 1) S.proc = S.lamP = Math.min(1, stageClock / PROC_DUR);
    const dwell = (stage === 1 ? DWELL1 : DWELL) * hold;
    if (autoplay && stageClock > dwell) goTo((stage + 1) % STAGES.length, false);
  }
  const vTmp = new THREE.Vector3();

  // ---------------------------------------------------------------- per-frame state
  const eTmp = new THREE.Euler(0, 0, 0, 'YXZ');
  const hit = new THREE.Vector3();
  const mill = [0, 0];
  function update() {
    const p = S.proc;
    const capT = remap(p, P_CAP[0], P_CAP[1]);
    const swapped = p >= P_SWAP;
    mill[0] = remap(p, P_MILL_F[0], P_MILL_F[1]); mill[1] = remap(p, P_MILL_B[0], P_MILL_B[1]);
    // trench staircase: outer slices first, inner (deepest) last
    let actSl = null, actTop = 0, cut = swapped;
    for (const sl of slices) {
      const k = NSL - 1 - sl.j, st = (k / NSL) * 0.55;
      const t = smoothstep(0, 1, (mill[sl.side] - st) / 0.45);
      const top = lerp(Y_SURF, sl.depth, t);
      U.uSlice.value[sl.side * NSL + sl.j] = t > 0 ? top : 99;     // 99: untouched, nothing cut away
      const h = top - Y_TR;
      sl.m.visible = h > 1e-3;
      sl.m.scale.y = Math.max(h, 1e-3);
      if (t > 0) cut = true;
      if (t > 0 && t < 1 && (!actSl || sl.j < actSl.j)) { actSl = sl; actTop = top; }
    }
    whole.visible = !cut;
    for (const m of pieces) m.visible = cut;
    for (const sl of slices) sl.m.visible &&= cut;
    U.uSwap.value = swapped ? 1 : 0;
    filler.visible = cut && !swapped;
    rowMesh.visible = !swapped;
    capStrip.visible = capT > 0 && mill[1] < 1;
    capStrip.scale.x = Math.max(capT, 1e-3);
    U.uFade.value = Math.pow(1 - S.dim, 2.2);       // perceptual: fades evenly to black after the sRGB/tone mapping
    sample.visible = S.dim < 0.999;

    // slice pose: lift, come forward, turn to face the stage-1 camera; square to the viewer in stages 2-4
    const l = easeInOut(remap(S.lamP, P_LIFT, 1));
    const rot = smoothstep(0.35, 1, l) * (1 - S.show);
    pivot.position.set(LAM_C.x, LAM_C.y + LIFT_UP * smoothstep(0, 0.65, l), LAM_C.z + LIFT_FWD * smoothstep(0.3, 1, l));
    eTmp.set(-S1_PITCH * FACE_K * rot, S1_YAW * FACE_K * rot, 0, 'YXZ');
    pivot.quaternion.setFromEuler(eTmp);
    lamella.visible = S.lamP >= P_SWAP && S.lamFade > 0.003;
    lamMat.opacity = S.lamFade;
    U.uEds.value = S.eds;
    U.uClose.value = S.close;
    U.uLit.value = lerp(0.74, 1, S.show);           // the slice face is dimmer while it still sits in the lit sample

    // beam: depositing the cap, then milling the trenches
    let act = 0;
    if (capT > 0 && capT < 1) {
      act = smoothstep(0, 0.08, capT) * (1 - smoothstep(0.92, 1, capT));
      hit.set(-LAM_HALF + 2 * LAM_HALF * capT, Y_CAP, 0.28 * Math.sin(time * 11));
      beam.quaternion.setFromUnitVectors(UP, BEAM_DIR[0]);
    } else if (actSl) {
      act = 1;
      hit.set(0.92 * LAM_HALF * Math.sin(time * 6.5), actTop, actSl.zc + 0.4 * SLICE_W * Math.sin(time * 23));
      beam.quaternion.setFromUnitVectors(UP, BEAM_DIR[actSl.zc > 0 ? 1 : 0]);
    }
    act *= S.l1 * (1 - S.dim) * (reducedMotion ? 0 : 1);
    beam.visible = hitGlow.visible = act > 0.003;
    beamMat.uniforms.uOpacity.value = 0.95 * act;
    beam.position.copy(hit);
    hitGlow.position.copy(hit);
    hitGlow.material.opacity = 0.7 * act;
    for (const sp of sparks) {
      const a = time * 2.2 + sp.ph, age = a - Math.floor(a), seed = Math.floor(a) * 7.31 + sp.ph * 91.7;
      const rx = Math.sin(seed * 12.9898) * 0.5, rz = Math.sin(seed * 78.233) * 0.5, ry = Math.abs(Math.sin(seed * 39.4));
      sp.s.visible = act > 0.003;
      if (!sp.s.visible) continue;
      sp.s.position.set(hit.x + rx * 0.5, hit.y + 0.05 + age * (0.25 + 0.35 * ry), hit.z + rz * 0.4);
      const fl = 0.6 + 0.4 * Math.sin(time * 40 + sp.ph * 20);
      sp.s.material.opacity = act * (1 - age) * (1 - age) * fl;
      sp.s.scale.setScalar(sp.sz * (1 - 0.5 * age));
    }
  }

  // ---------------------------------------------------------------- drag to rotate (horizontal drags only)
  let dragYaw = 0, dragPitch = 0, dragging = false, decided = false, x0 = 0, y0 = 0, lastX = 0, lastY = 0;
  const onDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;   // primary button only
    dragging = true; decided = false; x0 = lastX = e.clientX; y0 = lastY = e.clientY;
  };
  const onMove = (e) => {
    if (!dragging) return;
    if (e.buttons === 0) { onUp(); return; }   // released outside the canvas before the drag was captured
    if (!decided) {
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.hypot(dx, dy) < 6) return;
      decided = true;
      if (Math.abs(dy) > Math.abs(dx)) { dragging = false; return; }   // mostly vertical: leave it to page scroll
      try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      canvas.classList.add('is-grabbing');
      lastX = e.clientX; lastY = e.clientY;
    }
    dragYaw = clamp(dragYaw - (e.clientX - lastX) * 0.006, -YAW_MAX, YAW_MAX);
    dragPitch = clamp(dragPitch + (e.clientY - lastY) * 0.003, -PITCH_MAX, PITCH_MAX);
    lastX = e.clientX; lastY = e.clientY;
    if (!loop.running) renderOnce();
  };
  const onUp = () => { dragging = false; canvas.classList.remove('is-grabbing'); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);

  // ---------------------------------------------------------------- camera
  let yawCur = 0, pitchCur = 0;
  function placeCamera(dt) {
    if (dt && !dragging) { const k = damp(0.9, dt); dragYaw -= dragYaw * k; dragPitch -= dragPitch * k; }
    const sway = reducedMotion ? 0 : 0.045 * Math.sin(time * 0.21);
    const swayP = reducedMotion ? 0 : 0.012 * Math.sin(time * 0.17 + 1.1);
    const k = dt ? damp(8, dt) : 1;
    yawCur += (dragYaw + sway - yawCur) * k;
    pitchCur += (dragPitch + swayP - pitchCur) * k;
    if (!trans) S.r = restR(stage);   // follow canvas size changes
    const yaw = S.yaw + yawCur, pitch = clamp(S.pitch + pitchCur, -0.25, 1.5), r = S.r;
    camera.position.set(
      S.t.x + r * Math.sin(yaw) * Math.cos(pitch),
      S.t.y + r * Math.sin(pitch),
      S.t.z + r * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(S.t);
    camera.near = clamp(r * 0.03, 0.01, 0.5);
    camera.far = r + 60;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    scene.fog.near = r + 4;
    scene.fog.far = r + 26;
  }

  // labels: constant pixel height, kept inside the canvas; leader from the anchor to the label's edge
  const vW = new THREE.Vector3(), vD = new THREE.Vector3(), vP = new THREE.Vector3(), vR = new THREE.Vector3(), vU = new THREE.Vector3();
  const EDGE = 6;                    // px between a label box and the canvas edge
  function placeLabels() {
    const small = H < 330 || W < 420;
    const pxH = small ? 23 : 26;
    for (const lb of labels) {
      let a = smoothstep(0.55, 1, S[lb.key]);
      if (lb.gate) a *= lb.gate(S.proc);
      if (lb.s.parent === lamGroup) a *= lamella.visible ? S.lamFade : 0;
      lb.s.visible = a > 0.01;
      if (lb.line) lb.line.visible = lb.s.visible && !!lb.anchor;
      if (!lb.s.visible) continue;
      lb.s.material.opacity = a;
      lb.s.position.copy(lb.pos);
      lb.s.getWorldPosition(vW);
      const depth = -vP.copy(vW).applyMatrix4(camera.matrixWorldInverse).z;
      const wpp = 2 * Math.max(depth, 0.01) * tanV / H;
      const hgt = pxH * wpp;
      lb.s.scale.set(hgt * lb.aspect, hgt, 1);
      // nudge the box back inside the canvas (in the camera plane, so its pixel size is unchanged)
      vP.copy(vW).project(camera);
      const sx = (vP.x + 1) * W / 2, sy = (1 - vP.y) * H / 2, hwx = pxH * lb.aspect / 2 + EDGE, hwy = pxH / 2 + EDGE;
      const dx = (hwx * 2 > W ? W / 2 : clamp(sx, hwx, W - hwx)) - sx;
      const dy = (hwy * 2 > H ? H / 2 : clamp(sy, hwy, H - hwy)) - sy;
      if (vP.z < 1 && (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01)) {
        vR.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(dx * wpp);
        vU.setFromMatrixColumn(camera.matrixWorld, 1).multiplyScalar(-dy * wpp);
        vW.add(vR).add(vU);
        lb.s.position.copy(lb.s.parent.worldToLocal(vW));
      }
      if (!lb.line) continue;
      lb.lineMat.opacity = lb.lineA * a;
      // leader: anchor → edge of the label box (both in the label's parent space)
      vD.copy(lb.anchor).sub(lb.s.position);
      const hx = hgt * lb.aspect / 2 + 2 * wpp, hy = hgt / 2 + 2 * wpp;
      const t = Math.min(Math.abs(vD.x) > 1e-6 ? hx / Math.abs(vD.x) : Infinity, Math.abs(vD.y) > 1e-6 ? hy / Math.abs(vD.y) : Infinity);
      const pos = lb.line.geometry.attributes.position;
      pos.setXYZ(0, lb.anchor.x, lb.anchor.y, lb.anchor.z);
      if (t >= 1) pos.setXYZ(1, lb.anchor.x, lb.anchor.y, lb.anchor.z);
      else pos.setXYZ(1, lb.s.position.x + vD.x * t, lb.s.position.y + vD.y * t, lb.s.position.z + vD.z * t);
      pos.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- render
  function render(_t, dt) {
    dt = Math.max(0, dt || 0);       // never step backwards (e.g. a non-monotonic rAF timestamp)
    if (!reducedMotion && dt) {
      time += dt;
      stepStage(dt);
    }
    update();
    placeCamera(reducedMotion ? 0 : dt);
    scene.updateMatrixWorld();
    placeLabels();
    renderer.render(scene, camera);
  }
  const loop = createLoop(render);
  const renderOnce = () => render(0, 0);

  function resize() {
    W = canvas.clientWidth || 1; H = canvas.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;           // fixed FOV: fitR() backs the camera off for narrow canvases
    camera.updateProjectionMatrix();
    tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    tanH = tanV * camera.aspect;
    capL2.pos.x = -Math.min(1.95, hwOf(2) - 0.62);   // stays over the cap within the narrower framing
    if (!trans) S.r = restR(stage);
    if (!loop.running) renderOnce();
  }
  const unobserve = observeResize(canvas, resize);
  setRest(0);
  resize();
  const emitTimer = setTimeout(() => { if (!emitted) emit(); }, 0);   // once after creation, after the host has attached its listener

  return {
    setProgress() {},
    setParam(name, value) {
      if (name === 'stage') {
        const i = Math.round(Number(value));
        if (!Number.isFinite(i) || i < 0 || i >= STAGES.length) return;
        goTo(i, true);
        if (!loop.running) renderOnce();
      } else if (name === 'autoplay') {
        autoplay = !(value === false || value === 'false' || value === 0 || value === '0');
      }
    },
    resize,
    start() { if (reducedMotion) { renderOnce(); return; } loop.start(); },
    stop() { loop.stop(); },
    dispose() {
      loop.stop(); unobserve(); clearTimeout(emitTimer);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('lostpointercapture', onUp);
      canvas.classList.remove('is-grabbing');
      disposeObject(scene); envTex.dispose(); pmrem.dispose();
      renderer.dispose();
    },
  };
}
