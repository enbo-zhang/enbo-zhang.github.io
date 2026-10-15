// micro-kagome.js — model beside the micrograph "Kagome-type pattern in Mn3Sn".
// Textbook Mn3Sn (hexagonal, P6₃/mmc), ideal kagome (the small "breathing" distortion is ignored), on a W seed
// layer on an MgO substrate. The kagome planes stand UPRIGHT: world y is the film normal, each kagome sheet lies
// in a world x–y plane and the sheets stack along world z, which lies in the film plane.
// Geometry uses the real cell shapes (hexagonal a, c; bcc W; rock-salt MgO) on one uniform scale (a = 1);
// the gaps between the film, the seed and the substrate are schematic.
// Storyboard (auto-advancing stages, ~5 s dwell each, eased transitions, loops back to 0):
//   0 'Kagome net'          one upright Mn kagome sheet seen face-on, standing with its flat bottom row on a dim
//                           ground (the top plane of the W seed, faint, over a soft floor glow); thin bonds, faint
//                           up/down triangle fills, one hexagon ring glows softly
//   1 'Sn in the hexagons'  Sn atoms grow in at the hexagon centres of that sheet, from the glowing ring outwards
//   2 'Stacked layers'      the camera swings to an oblique view and further upright sheets (B, A, B, …, each with
//                           the cell's in-plane offset) slide in along z from behind, making a row of upright
//                           sheets. Each sheet is a faint upright pane; the atoms shrink and the sheets behind the
//                           front one fall off steeply in brightness (bonds and fills on the front sheet only), so
//                           the front kagome net stays legible and the rest read as a receding row. Each back sheet
//                           arrives already at its dimmed value. Labels "Mn", "Sn".
//   3 'On the W seed'       the W seed slab (neutral satin grey, thin outline) and the MgO substrate (matte stone,
//                           wide, fading outwards) come in under the stack; the faint ground beads shrink onto the
//                           seed's atom size as it arrives; the camera pulls back and rises a little; the back
//                           sheets come up a little towards a gentler fall-off (less on small canvases).
//                           Labels "Mn₃Sn" ("Mn3Sn" on small canvases), "W seed", "MgO substrate".
//   3 → 0                   the substrate dims back to the faint ground, the extra sheets slide out along z at
//                           their dimmed value while the atoms stay small, then the atoms grow back, the camera
//                           returns face-on and the Sn shrink away
// setParam('stage', i) tweens to stage i (then holds it 2x the dwell); setParam('autoplay', false) holds the stage.
// Fires 'model:stage' {index, count} on the canvas whenever the displayed stage changes (and once after creation).
// Drag to rotate (offsets the scripted view, eases back after release; with reduced motion it snaps back on release).
// The returned object carries read-only `debug` positions (scene units) of the full stage-3 structure for review.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  clamp, damp, lerp, smoothstep, easeInOut, remap, createRenderer, makeLabelSprite,
  observeResize, createLoop, disposeObject,
} from './common.js';

export const STAGES = ['Kagome net', 'Sn in the hexagons', 'Stacked layers', 'On the W seed'];

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// ---------------------------------------------------------------- lattice (pure, no three.js)
const SQ3 = Math.sqrt(3), SQ2 = Math.SQRT2, SQ6 = Math.sqrt(6);
// textbook cell sizes in ångström: geometry only, never displayed
const A_HEX = 5.67, C_HEX = 4.53, A_W = 3.165, A_MGO = 4.217;
const UNIT = 1 / A_HEX;            // world units per ångström (hexagonal a = 1)
const C_LAT = C_HEX * UNIT;        // hexagonal c
const A_BCC = A_W * UNIT;          // W cubic cell
const A_RS = A_MGO * UNIT;         // MgO cubic cell
const BOND = 0.5;                  // Mn–Mn nearest neighbour in the ideal kagome (a/2), also Sn–Mn

// Fractional (x, y) in the hexagonal cell: layer A at w = 1/4, layer B at w = 3/4.
const CELL = {
  A: { sn: [1 / 3, 2 / 3], mn: [[5 / 6, 2 / 3], [1 / 3, 1 / 6], [5 / 6, 1 / 6]] },
  B: { sn: [2 / 3, 1 / 3], mn: [[1 / 6, 1 / 3], [2 / 3, 5 / 6], [1 / 6, 5 / 6]] },
};
// a1 = (1, 0), a2 = (−1/2, √3/2) mapped straight onto world (x, y): rows of triangles run along x (horizontal).
// Shifted down by √3/12 so layer A's lowest dense Mn row sits on y = 0 (x = 0 is an A hexagon centre).
const Y_SHIFT = -SQ3 / 12;
const hexToXY = (fx, fy) => [fx - fy / 2, fy * SQ3 / 2 + Y_SHIFT];

// The stack: sheet k = 0 is the front one (largest z), sheets alternate A B A B … going back along −z,
// c/2 apart (A at w = 1/4, B at w = 3/4 of the same cell).
const N_SHEETS = 6;
const SHEET_DZ = C_LAT / 2;
const SHEET_Z = Array.from({ length: N_SHEETS }, (_, k) => ((N_SHEETS - 1) / 2 - k) * SHEET_DZ);
const SHEET_TYPE = SHEET_Z.map((_, k) => (k % 2 ? 'B' : 'A'));
const Z_FRONT = SHEET_Z[0], Z_BACK = SHEET_Z[N_SHEETS - 1];

// Patch outline, tested on triangle centroids (their heights are odd multiples of √3/12 and their x multiples of
// 1/2, so these cuts sit in gaps): flat bottom (A: a full dense row on y = 0), flat top, straight sides, and the
// top corners cut back along the lattice's 60° lines above yCh (a half-hexagon outline standing on a flat base).
const PATCH = { yMin: 0.05, yMax: 3.45, xHalf: 2.25, yCh: 2.1 };
const inPatch = (cx, cy) => cy >= PATCH.yMin && cy <= PATCH.yMax && Math.abs(cx) <= PATCH.xHalf
  && Math.abs(cx) + Math.max(0, cy - PATCH.yCh) / SQ3 <= PATCH.xHalf + 1e-9;

/**
 * One upright kagome sheet ('A' | 'B') in its own x–y plane.
 * Returns { mn: [{x, y}], sn: [{x, y}], tris: [{v: [i, j, k], up}], bonds: [[i, j]] } where tris are the
 * corner-sharing Mn triangles (up = apex above the base), bonds their edges, and Sn only where all six Mn of the
 * hexagon around it are in the patch.
 */
function kagomeSheet(type) {
  const cell = CELL[type];
  const inBox = (x, y) => Math.abs(x) < PATCH.xHalf + 1 && y > PATCH.yMin - 1 && y < PATCH.yMax + 1;
  const sites = [], hexes = [];
  for (let i = -10; i <= 10; i++) {
    for (let j = -3; j <= 8; j++) {
      for (const [fx, fy] of cell.mn) {
        const [x, y] = hexToXY(fx + i, fy + j);
        if (inBox(x, y)) sites.push({ x, y });
      }
      const [x, y] = hexToXY(cell.sn[0] + i, cell.sn[1] + j);
      if (inBox(x, y)) hexes.push({ x, y });
    }
  }
  const isBond = (p, q) => Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - BOND) < 1e-6;
  const nb = sites.map(() => []);
  for (let a = 0; a < sites.length; a++) {
    for (let b = a + 1; b < sites.length; b++) if (isBond(sites[a], sites[b])) { nb[a].push(b); nb[b].push(a); }
  }
  const tris = [];
  for (let a = 0; a < sites.length; a++) {
    for (const b of nb[a]) {
      if (b <= a) continue;
      for (const c of nb[b]) {
        if (c <= b || !nb[c].includes(a)) continue;
        const ys = [sites[a].y, sites[b].y, sites[c].y];
        const cx = (sites[a].x + sites[b].x + sites[c].x) / 3, cy = (ys[0] + ys[1] + ys[2]) / 3;
        if (!inPatch(cx, cy)) continue;
        tris.push({ v: [a, b, c], up: Math.max(...ys) - cy > cy - Math.min(...ys) });
      }
    }
  }
  const remapIdx = new Map(), mn = [];
  for (const t of tris) for (const m of t.v) if (!remapIdx.has(m)) { remapIdx.set(m, mn.length); mn.push({ x: sites[m].x, y: sites[m].y }); }
  tris.forEach((t) => { t.v = t.v.map((m) => remapIdx.get(m)); });
  const bonds = [];
  for (const t of tris) for (let e = 0; e < 3; e++) bonds.push([t.v[e], t.v[(e + 1) % 3]]);
  // the flat bottom row (layer A, on y = 0): the trim drops the down-triangles hanging below it, and with them every
  // other bond of the row; those Mn are still nearest neighbours, so bond them to give the sheet a straight base
  const base = mn.map((_, i) => i).filter((i) => Math.abs(mn[i].y) < 1e-6).sort((i, j) => mn[i].x - mn[j].x);
  for (let n = 1; n < base.length; n++) {
    const i = base[n - 1], j = base[n];
    if (isBond(mn[i], mn[j]) && !bonds.some(([p, q]) => (p === i && q === j) || (p === j && q === i))) bonds.push([i, j]);
  }
  const sn =hexes.filter((h) => mn.filter((m) => isBond(m, h)).length === 6).map((h) => ({ x: h.x, y: h.y }));
  return { mn, sn, tris, bonds };
}

// W seed, bcc: world x ∥ ex, y ∥ ey (film normal), z ∥ ez (the stacking direction); a slab of W_PLANES
// atomic planes (spacing a/√6) just under the film, a little larger than the film.
const W_PLANES = 3, W_X = 2.75, W_Z = 1.6;
const W_DPLANE = A_BCC / SQ6;
const W_TOP = -0.34;                // top W plane (schematic gap under the film's lowest row on y = 0)
function wSlab() {
  const ex = [-1 / SQ3, 1 / SQ3, 1 / SQ3], ey = [2 / SQ6, 1 / SQ6, 1 / SQ6], ez = [0, 1 / SQ2, -1 / SQ2];
  const dot = (p, e) => p[0] * e[0] + p[1] * e[1] + p[2] * e[2];
  const out = [], n = 9;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
    for (const b of [0, 0.5]) {
      const p = [(i + b) * A_BCC, (j + b) * A_BCC, (k + b) * A_BCC];
      const x = dot(p, ex), y = dot(p, ey), z = dot(p, ez);
      const m = Math.round(-y / W_DPLANE);
      if (m < 0 || m >= W_PLANES || Math.abs(x) > W_X || Math.abs(z) > W_Z) continue;
      out.push({ x, y: W_TOP + y, z, m });
    }
  }
  return out;
}

// MgO substrate, rock salt (Mg and O alternate): world x ∥ ex, y ∥ ey, z ∥ ez. A few planes (spacing a/(2√2))
// under the W, wide, fading out towards an elliptical rim and downwards.
const M_PLANES = 3, M_RX = 4.9, M_RZ = 3.9;
const M_DPLANE = A_RS / (2 * SQ2);
const W_BOT = W_TOP - (W_PLANES - 1) * W_DPLANE;
const M_TOP = W_BOT - 0.44;
function mgoSlab() {
  const ex = [1 / SQ2, -1 / SQ2, 0], ey = [1 / SQ2, 1 / SQ2, 0], ez = [0, 0, 1];
  const dot = (p, e) => p[0] * e[0] + p[1] * e[1] + p[2] * e[2];
  const h = A_RS / 2, out = [], n = 20;
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) for (let k = -n; k <= n; k++) {
    const p = [i * h, j * h, k * h];
    const y = dot(p, ey);
    const m = Math.round(-y / M_DPLANE);
    if (m < 0 || m >= M_PLANES) continue;
    const x = dot(p, ex), z = dot(p, ez);
    const r = Math.hypot(x / M_RX, z / M_RZ);
    if (r > 0.97) continue;
    const fade = (1 - smoothstep(0.42, 0.97, r)) * (1 - 0.28 * m);
    out.push({ x, y: M_TOP + y, z, m, o: ((i + j + k) & 1) === 1, fade });
  }
  return out;
}

// ---------------------------------------------------------------- scene constants
const R_MN = 0.085, R_SN = 0.105, R_W = 0.085;
const ROW_ATOMS = 0.56;            // Mn/Sn scale in the row of sheets (stage 2): small, so each sheet stays open
const SLAB_ATOMS = 0.7;            // … and in the film block on the seed (stage 3, seen from further away)
// W beads follow the film's atom scale at about the Mn size in every stage (metallic radii: W ≈ Mn, both below
// Sn), so neither the ground nor the seed is drawn bigger than the film's atoms; R_W_SEED is their size on the seed
const W_K = 1.04;
const R_W_SEED = R_MN * SLAB_ATOMS * W_K;
// MgO substrate: O about the W size, Mg about half of it (ionic radii)
const R_O = R_W_SEED, R_MG = 0.55 * R_O;
const FILL_OPACITY = 0.15, DOWN_K = 0.6, BOND_OPACITY = 0.34;
const FRAME_OPACITY = 0.36, FRAME_SINGLE = 0.4;   // sheet frames; FRAME_SINGLE scales them while only one stands
const PANE_OPACITY = 0.05, PANE_SINGLE = 0.5;     // faint pane inside each frame (overlaps step up behind the front)
// Depth cue once the sheets stand in a row, per sheet k (0 = front): two profiles mixed by the preset's `dp`.
// Gentle: brightness falls off linearly to the back (the film block, stage 3). Steep: the front sheet keeps full
// brightness, its bonds and fills, the others fall off fast and keep only faint bonds (the row, stage 2).
// Brightness only: every sheet's atoms keep one size (same atoms; perspective alone makes the back ones smaller).
// A back sheet carries its dimming the whole time it stands (it slides in and out at its dimmed value); the front
// sheet's frame and pane switch from the single-sheet look to the row look as the sheet behind it comes and goes.
const kOf = (k) => k / (N_SHEETS - 1);
const DIM_LIN = Array.from({ length: N_SHEETS }, (_, k) => 1 - 0.62 * kOf(k));
// the fade scales linear light, so the steep profile is written as on-screen brightness and raised to 2.2
const DIM_STEEP = Array.from({ length: N_SHEETS }, (_, k) => (k ? Math.pow(0.12 + 0.43 * Math.pow(0.62, k - 1), 2.2) : 1));
const BOND_STEEP = Array.from({ length: N_SHEETS }, (_, k) => (k ? 0.45 * Math.pow(0.45, k - 1) : 1));
const FILL_STEEP = Array.from({ length: N_SHEETS }, (_, k) => (k === 0 ? 1 : k === 1 ? 0.2 : 0));
const FRAME_ROW = Array.from({ length: N_SHEETS }, (_, k) => (k ? 1.05 - 0.4 * kOf(k) : 1.5));   // front brightest
const SLIDE = 2.2;                 // sheets slide in along z from this far behind their place
const ARR_SPREAD = 0.62, ARR_LEN = 0.38;   // stacking windows on st: sheet k arrives over [t0, t0 + ARR_LEN]
const GROUND = 0.42, GROUND_2 = 0.16;      // the W top plane (and, fainter, the next one) as the ground, stages 0–2
const FLOOR_OPACITY = 0.2;         // soft floor glow under the ground, stages 0–2
const GROW_K = 1.2;                // Sn growth stagger (ring first, then outwards)
const DWELL = 5.0;                 // seconds a stage is shown after its transition
const SWAY = 0.05;                 // idle yaw drift amplitude (rad)
const YAW_MAX = 0.61, PITCH_MAX = 0.21;     // drag clamps (±35°, ±12°)
const C_MN = 0xffb340, C_SN = 0xcfe8ff, C_RING = 0xffe3b8, C_PANE = 0xb8c8de, C_FLOOR = 0x8d99ab;
// W: neutral mid-grey metal, satin rather than mirror-bright (darker than the pale cool Sn and without its blue, so
// the film/seed interface separates); MgO: matte warm stone (O light, Mg dark) so the seed and the substrate read apart
const C_W = 0x9c9b98, C_O = 0x8b847b, C_MG = 0x4f4b46, C_WFRAME = 0xcfd0d2;

// Per-stage targets. Camera: yaw / pitch, framed box (centre cx cy cz, half sizes hx hy hz) and shift (content moved
// right by this fraction of the width, room for labels on the left); hyW / shW replace hy / shift on wide canvases
// (aspect past about 1.6, where the labels have room anyway). Content: g Sn growth, st stacking, sub seed +
// substrate, hl ring highlight, as atom scale, dp depth-cue steepness (dpS on small canvases, where the film block
// is packed into fewer pixels and needs its back sheets further down); label alphas lMn / lSn (single sheet),
// l2 (stack), l3 (film stack).
const PRESETS = [
  { yaw: 0.1, pitch: 0.2, cx: 0, cy: 1.85, cz: Z_FRONT - 0.1, hx: 2.4, hy: 2.3, hz: 0.5, shift: 0, hyW: 2.3, shW: 0,
    g: 0, st: 0, sub: 0, hl: 1, as: 1, dp: 1, dpS: 1, lMn: 1, lSn: 0, l2: 0, l3: 0 },
  { yaw: -0.1, pitch: 0.2, cx: 0, cy: 1.85, cz: Z_FRONT - 0.1, hx: 2.4, hy: 2.3, hz: 0.5, shift: 0, hyW: 2.3, shW: 0,
    g: 1, st: 0, sub: 0, hl: 0.4, as: 1, dp: 1, dpS: 1, lMn: 1, lSn: 1, l2: 0, l3: 0 },
  { yaw: 0.76, pitch: 0.25, cx: 0, cy: 1.65, cz: 0, hx: 2.35, hy: 2.05, hz: 1.4, shift: 0.07, hyW: 2.05, shW: 0.04,
    g: 1, st: 1, sub: 0, hl: 0, as: ROW_ATOMS, dp: 1, dpS: 1, lMn: 0, lSn: 0, l2: 1, l3: 0 },
  { yaw: 0.62, pitch: 0.42, cx: 0, cy: 0.95, cz: 0.1, hx: 2.9, hy: 2.75, hz: 1.8, shift: 0.09, hyW: 2.45, shW: 0.02,
    g: 1, st: 1, sub: 1, hl: 0, as: SLAB_ATOMS, dp: 0.7, dpS: 0.85, lMn: 0, lSn: 0, l2: 0, l3: 1 },
];
const CAM_KEYS = ['yaw', 'pitch', 'cx', 'cy', 'cz', 'hx', 'hy', 'hz', 'shift', 'hyW', 'shW'];
const P_KEYS = Object.keys(PRESETS[0]);
// [duration, delay] in seconds per parameter when entering each stage; g and st run linearly (staggered inside);
// dpS runs on dp's timing
const TIMING = [
  { cam: [1.8, 0.5], g: [1.0, 1.4], st: [1.7, 0.25], sub: [0.9, 0], hl: [0.8, 1.9], as: [1.0, 1.7], dp: [1.2, 0.6], lMn: [0.5, 2.1], lSn: [0.3, 0], l2: [0.3, 0], l3: [0.3, 0] },
  { cam: [1.4, 0], g: [2.0, 0.2], st: [1.4, 0], sub: [0.8, 0], hl: [0.8, 0.2], as: [1.0, 0], dp: [1.0, 0], lMn: [0.5, 0.3], lSn: [0.5, 1.7], l2: [0.3, 0], l3: [0.3, 0] },
  { cam: [1.6, 0], g: [1.0, 0], st: [2.4, 0.35], sub: [0.9, 0], hl: [0.6, 0], as: [1.2, 0.3], dp: [1.2, 0.3], lMn: [0.3, 0], lSn: [0.3, 0], l2: [0.6, 2.4], l3: [0.3, 0] },
  { cam: [1.6, 0.2], g: [1.0, 0], st: [1.6, 0], sub: [1.6, 0.1], hl: [0.5, 0], as: [1.0, 0], dp: [1.2, 0.2], lMn: [0.3, 0], lSn: [0.3, 0], l2: [0.35, 0], l3: [0.6, 1.5] },
];
const LINEAR = new Set(['g', 'st', 'sub']);

const deepFreeze = (o) => { Object.values(o).forEach((v) => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
const easeOutBack = (t) => { t = clamp(t); const c1 = 1.5, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const growAt = (g, rn) => easeOutBack(g * (1 + GROW_K) - GROW_K * rn);

/**
 * Lit material fade: multiplies the shaded colour by a per-material uniform (and, when `instanced`, by a
 * per-instance attribute aFade; instances under 0.003 collapse to nothing). Fading to black is the same as fading
 * out over the black panel, and keeps the atoms opaque (no sorting artefacts). Returns the uniform.
 */
function addFade(mat, instanced) {
  const u = { value: 1 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFade = u;
    if (instanced) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aFade;\nvarying float vFade;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFade = aFade;\nif (aFade < 0.003) transformed *= 0.0;');
    }
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uFade;${instanced ? '\nvarying float vFade;' : ''}`)
      .replace('#include <opaque_fragment>', `outgoingLight *= uFade${instanced ? ' * vFade' : ''};\n#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => (instanced ? 'kagome-fade-inst' : 'kagome-fade');
  return u;
}

export function createScene(canvas, options = {}) {
  const reducedMotion = !!options.reducedMotion;
  const renderer = createRenderer(canvas);
  renderer.toneMappingExposure = 1.05;
  // GL lines are one device pixel wide whatever the pixel ratio: lift their opacity on dense screens so the bonds
  // and sheet frames keep about the same weight as at 1x
  const lineK = Math.pow(clamp(renderer.getPixelRatio(), 1, 2), 0.6);
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 10, 30);
  const camera = new THREE.PerspectiveCamera(26, 1.4, 0.1, 80);

  // environment map: bake once, then free the generator and the room scene (only the render target is kept; it is
  // freed through the target in dispose(), since disposing a render-target texture does not free its GPU storage)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  scene.environment = envRT.texture;
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x05060a, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.3); key.position.set(3, 7, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fb0ff, 0.8); rim.position.set(-5, 3, -6); scene.add(rim);

  const root = new THREE.Group();
  scene.add(root);
  const sphereHi = new THREE.SphereGeometry(1, 14, 10);       // Mn / Sn
  const sphereLo = new THREE.IcosahedronGeometry(1, 1);       // W / MgO (smooth normals)
  const dummy = new THREE.Object3D();

  // ---------------------------------------------------------------- kagome sheets
  const DATA = { A: kagomeSheet('A'), B: kagomeSheet('B') };
  const geoms = {};
  for (const type of ['A', 'B']) {
    const d = DATA[type];
    const nT = d.tris.length, cMn = new THREE.Color(C_MN);
    const fPos = new Float32Array(nT * 9), fCol = new Float32Array(nT * 9);    d.tris.forEach((t, i) => t.v.forEach((m, j) => {
      const kk = t.up ? 1 : DOWN_K;
      fPos.set([d.mn[m].x, d.mn[m].y, 0], i * 9 + j * 3);
      fCol.set([cMn.r * kk, cMn.g * kk, cMn.b * kk], i * 9 + j * 3);
    }));
    const fill = new THREE.BufferGeometry();
    fill.setAttribute('position', new THREE.BufferAttribute(fPos, 3));
    fill.setAttribute('color', new THREE.BufferAttribute(fCol, 3));
    const bPos = new Float32Array(d.bonds.length * 6);
    d.bonds.forEach(([i, j], n) => bPos.set([d.mn[i].x, d.mn[i].y, 0, d.mn[j].x, d.mn[j].y, 0], n * 6));
    const bond = new THREE.BufferGeometry();
    bond.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
    geoms[type] = { fill, bond };
  }
  // the highlighted hexagon: the A-sheet hexagon centre (Sn site) nearest the middle of the patch
  const midY = (PATCH.yMin + PATCH.yMax) / 2;
  const HEX = DATA.A.sn.reduce((b, s) => (Math.hypot(s.x, s.y - midY) < Math.hypot(b.x, b.y - midY) ? s : b));
  const snRMax = Math.max(...DATA.A.sn.map((s) => Math.hypot(s.x - HEX.x, s.y - HEX.y)));
  // a thin upright frame around each sheet (the same outline for A and B, a little outside the atoms): in the
  // oblique views a row of these reads as a row of upright sheets even where the atoms overlap on screen
  const allMn = [...DATA.A.mn, ...DATA.B.mn];
  const FP = 0.24;
  const fX = Math.max(...allMn.map((a) => Math.abs(a.x))) + FP;
  const fTop = Math.max(...allMn.map((a) => a.y)) + FP, fBot = -0.16;
  const fT = Math.max(...allMn.map((a) => Math.abs(a.x) + Math.max(0, a.y - PATCH.yCh) / SQ3)) + FP;
  const fCornerY = PATCH.yCh + (fT - fX) * SQ3, fTopX = fT - (fTop - PATCH.yCh) / SQ3;
  // outline, counter-clockwise from the bottom left: [0] bottom left, [3] [4] top right / left, [5] left corner
  const FRAME_PTS = [[-fX, fBot], [fX, fBot], [fX, fCornerY], [fTopX, fTop], [-fTopX, fTop], [-fX, fCornerY]];
  const frameGeo = new THREE.BufferGeometry().setFromPoints(FRAME_PTS.map(([x, y]) => new THREE.Vector3(x, y, 0)));
  const paneGeo = new THREE.ShapeGeometry(new THREE.Shape(FRAME_PTS.map(([x, y]) => new THREE.Vector2(x, y))));

  function buildSheet(k) {
    const type = SHEET_TYPE[k], d = DATA[type];
    const group = new THREE.Group();
    group.position.z = SHEET_Z[k];
    const fillMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: FILL_OPACITY, depthWrite: false, side: THREE.DoubleSide });
    const fills = new THREE.Mesh(geoms[type].fill, fillMat);
    fills.renderOrder = 1;
    const bondMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: BOND_OPACITY, depthWrite: false });
    const bonds = new THREE.LineSegments(geoms[type].bond, bondMat);
    bonds.renderOrder = 2;
    const mnMat = new THREE.MeshStandardMaterial({ color: C_MN, metalness: 0.45, roughness: 0.32, emissive: 0xff9a1a, emissiveIntensity: 0.2 });
    const snMat = new THREE.MeshStandardMaterial({ color: C_SN, metalness: 0.3, roughness: 0.26, emissive: 0x9cc8ff, emissiveIntensity: 0.14 });
    const mnU = addFade(mnMat, false), snU = addFade(snMat, false);
    const mnMesh = new THREE.InstancedMesh(sphereHi, mnMat, d.mn.length);
    const snMesh = new THREE.InstancedMesh(sphereHi, snMat, d.sn.length);
    // instances move inside a fixed patch: one bounding sphere for the whole sheet, never recomputed
    mnMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, midY, 0), 3.2);
    snMesh.boundingSphere = mnMesh.boundingSphere.clone();
    const frameMat = new THREE.LineBasicMaterial({ color: 0xe9eef5, transparent: true, opacity: 0, depthWrite: false });
    const frame = new THREE.LineLoop(frameGeo, frameMat);
    frame.renderOrder = 2;
    const paneMat = new THREE.MeshBasicMaterial({ color: C_PANE, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const pane = new THREE.Mesh(paneGeo, paneMat);
    pane.position.z = -0.002;
    group.add(pane, fills, bonds, frame, mnMesh, snMesh);
    root.add(group);
    const rn = d.sn.map((s) => Math.hypot(s.x - HEX.x, s.y - HEX.y) / snRMax);
    return { k, type, d, rn, group, fillMat, bondMat, frameMat, paneMat, mnMesh, snMesh, mnU, snU, lastAs: -1, lastG: -1, f: 1 };
  }
  const sheets = SHEET_Z.map((_, k) => buildSheet(k));
  const S0 = sheets[0];

  function setSheetAtoms(S, as, g) {
    const gg = S === S0 ? g : 1;
    if (S.lastAs === as && S.lastG === gg) return;
    dummy.quaternion.identity();
    if (S.lastAs !== as) {
      const mn = S.d.mn;
      for (let i = 0; i < mn.length; i++) {
        dummy.position.set(mn[i].x, mn[i].y, 0); dummy.scale.setScalar(R_MN * as); dummy.updateMatrix();
        S.mnMesh.setMatrixAt(i, dummy.matrix);
      }
      S.mnMesh.instanceMatrix.needsUpdate = true;
    }
    const sn = S.d.sn;
    for (let i = 0; i < sn.length; i++) {
      const grow = S === S0 ? growAt(gg, S.rn[i]) : 1;
      dummy.position.set(sn[i].x, sn[i].y, 0); dummy.scale.setScalar(Math.max(1e-4, R_SN * as * grow)); dummy.updateMatrix();
      S.snMesh.setMatrixAt(i, dummy.matrix);
    }
    S.snMesh.instanceMatrix.needsUpdate = true;
    S.lastAs = as; S.lastG = gg;
  }

  // ring highlight around one hexagon of the front sheet (corners on the Mn: RingGeometry's first corner is on +x)
  const RING_W = 0.03, RING_W_SMALL = 0.045;
  let ringW = RING_W;
  const ringGeo = (w) => new THREE.RingGeometry(BOND - w, BOND + w, 6, 1);
  const ringMat = new THREE.MeshBasicMaterial({ color: C_RING, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo(ringW), ringMat);
  ring.position.set(HEX.x, HEX.y, 0.004);
  ring.renderOrder = 4;
  const hexFillMat = new THREE.MeshBasicMaterial({ color: C_RING, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const hexFill = new THREE.Mesh(new THREE.CircleGeometry(BOND, 6), hexFillMat);
  hexFill.position.set(HEX.x, HEX.y, 0.002);
  hexFill.renderOrder = 1;
  S0.group.add(hexFill, ring);

  // ---------------------------------------------------------------- W seed (its top plane doubles as the ground)
  const W_ATOMS = wSlab();
  const wGeo = sphereLo.clone();
  const wFade = new THREE.InstancedBufferAttribute(new Float32Array(W_ATOMS.length), 1);
  wGeo.setAttribute('aFade', wFade);
  const wMat = new THREE.MeshStandardMaterial({ color: C_W, metalness: 0.7, roughness: 0.42, envMapIntensity: 0.7 });
  addFade(wMat, true);
  const wMesh = new THREE.InstancedMesh(wGeo, wMat, W_ATOMS.length);
  let wR = -1;                       // bead radius drawn now: R_W × the film's atom scale × W_K (setWRadius)
  function setWRadius(r) {
    if (Math.abs(r - wR) < 1e-6) return;
    wR = r;
    dummy.quaternion.identity();
    W_ATOMS.forEach((a, i) => {
      dummy.position.set(a.x, a.y, a.z); dummy.scale.setScalar(r); dummy.updateMatrix();
      wMesh.setMatrixAt(i, dummy.matrix);
    });
    wMesh.instanceMatrix.needsUpdate = true;
  }
  setWRadius(R_W * W_K);
  wMesh.computeBoundingSphere();     // at the largest radius: covers the shrunk beads too
  root.add(wMesh);
  // a thin outline of the seed slab (same language as the sheet frames): reads as one layer, not loose atoms; it is
  // only drawn on the seed, so it is padded for the seed's bead size
  const wPad = R_W_SEED + 0.05;
  const wxs = W_ATOMS.map((a) => Math.abs(a.x)), wzs = W_ATOMS.map((a) => Math.abs(a.z));
  const wBox = new THREE.BoxGeometry(2 * (Math.max(...wxs) + wPad), W_TOP - W_BOT + 2 * wPad, 2 * (Math.max(...wzs) + wPad));
  const wFrameGeo = new THREE.EdgesGeometry(wBox);
  wBox.dispose();
  const wFrameMat = new THREE.LineBasicMaterial({ color: C_WFRAME, transparent: true, opacity: 0, depthWrite: false });
  const wFrame = new THREE.LineSegments(wFrameGeo, wFrameMat);
  wFrame.position.y = (W_TOP + W_BOT) / 2;
  wFrame.renderOrder = 2;
  wFrame.visible = false;
  root.add(wFrame);
  // soft floor glow just under the ground (stages 0–2): a radial gradient (procedural), so the ground beads read as
  // the edge of a floor the sheets stand on; it hands over to the real seed and substrate in stage 3
  const floorTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const floorMat = new THREE.MeshBasicMaterial({ color: C_FLOOR, map: floorTex, transparent: true, opacity: 0, depthWrite: false });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(7.6, 5.6), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, W_TOP - 0.03, 0.5);
  floor.renderOrder = -1;
  root.add(floor);
  let wLastSt = -1, wLastSub = -1;
  function updateW(st, sub) {
    if (Math.abs(st - wLastSt) < 1e-5 && Math.abs(sub - wLastSub) < 1e-5) return;
    wLastSt = st; wLastSub = sub;
    // ground strip under the sheets that are standing (front sheet first, the strip grows back with the stack) and
    // out to the seed's front edge, the top plane plus a fainter second one so it reads as a floor, not a bead line
    const zLo = lerp(Z_FRONT, Z_BACK, easeInOut(st)) - 0.55;
    for (let i = 0; i < W_ATOMS.length; i++) {
      const a = W_ATOMS[i];
      const strip = smoothstep(zLo - 0.6, zLo, a.z) * (1 - 0.55 * smoothstep(Z_FRONT, W_Z, a.z))
        * (1 - smoothstep(2.3, 2.75, Math.abs(a.x)));
      const ground = a.m === 0 ? GROUND * strip : a.m === 1 ? GROUND_2 * strip : 0;
      const full = smoothstep(a.m * 0.16, a.m * 0.16 + 0.5, sub);
      wFade.array[i] = lerp(ground, 1, full);
    }
    wFade.needsUpdate = true;
  }

  // ---------------------------------------------------------------- MgO substrate
  const MG_ATOMS = mgoSlab();
  const mgoGroup = new THREE.Group();
  root.add(mgoGroup);
  const mgoU = [];
  for (const isO of [false, true]) {
    const list = MG_ATOMS.filter((a) => a.o === isO);
    const geo = sphereLo.clone();
    geo.setAttribute('aFade', new THREE.InstancedBufferAttribute(new Float32Array(list.map((a) => a.fade)), 1));
    const mat = new THREE.MeshStandardMaterial({ color: isO ? C_O : C_MG, metalness: 0, roughness: 0.92, envMapIntensity: 0.35 });
    mgoU.push(addFade(mat, true));
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((a, i) => {
      dummy.position.set(a.x, a.y, a.z); dummy.scale.setScalar(isO ? R_O : R_MG); dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.computeBoundingSphere();
    mgoGroup.add(mesh);
  }

  // ---------------------------------------------------------------- labels (fixed pixel size, placed in screen space)
  const labels = [];
  const scoreOf = (dir) => (a) => a.x * dir[0] + a.y * dir[1] + (a.z ?? 0) * (dir[2] ?? 0);
  const best = (list, f) => list.reduce((b, a) => (f(a) > f(b) ? a : b));
  /**
   * spec: { text, color, key, anchor: () => Vector3 (world), rim: () => the anchor atom's radius as drawn now (world),
   *   dir: [x, y] screen direction (y down),
   *   leadW?: minimum leader in world units, avoid?: 'top' (keep the box above the front sheet's frame) | 'left'
   *   (keep it left of the frame), only?: 'small' | 'large' (shown on small / large canvases only) }
   */
  function label(spec) {
    const s = makeLabelSprite(spec.text, { color: spec.color, fontSize: 42, fontFamily: MONO, fontWeight: 500, scale: 1, glow: false, background: 'rgba(0,0,0,0.6)', padding: 12 });
    s.material.opacity = 0;
    s.visible = false;
    const lineMat = new THREE.LineBasicMaterial({ color: 0xd8d8de, transparent: true, opacity: 0, depthWrite: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), lineMat);
    line.frustumCulled = false;
    line.renderOrder = 9;
    line.visible = false;
    const n = Math.hypot(spec.dir[0], spec.dir[1]);
    labels.push({ ...spec, s, line, lineMat, aspect: s.scale.x / s.scale.y, ux: spec.dir[0] / n, uy: spec.dir[1] / n });
    root.add(s, line);
  }
  const sheetAtom = (S, kind, f) => {
    const a = best(S.d[kind], f);
    const p = new THREE.Vector3();
    return () => p.set(a.x, a.y, 0).applyMatrix4(S.group.matrixWorld);
  };
  const fixedAtom = (list, f, group) => {
    const a = best(list, f);
    const p = new THREE.Vector3();
    return () => (group ? p.set(a.x, a.y, a.z).applyMatrix4(group.matrixWorld) : p.set(a.x, a.y, a.z));
  };
  const C_LMN = '#ffc870', C_LSN = '#d8ecff', C_LGREY = '#d4d7dc';
  const rimMn = () => R_MN * P.as, rimSn = () => R_SN * P.as, rimW = () => wR, rimO = () => R_O;
  // single sheet, face-on: labels above the top rows, clear of the sheet's frame
  label({ text: 'Mn', color: C_LMN, key: 'lMn', anchor: sheetAtom(S0, 'mn', scoreOf([0.3, 1])), rim: rimMn, dir: [0.3, -1], leadW: 0.22, avoid: 'top' });
  label({ text: 'Sn', color: C_LSN, key: 'lSn', anchor: sheetAtom(S0, 'sn', scoreOf([-0.55, 1])), rim: rimSn, dir: [-0.3, -1], leadW: 0.62, avoid: 'top' });
  // the row of sheets, oblique: labels off the front sheet's free (left) side, outside its frame
  label({ text: 'Mn', color: C_LMN, key: 'l2', anchor: sheetAtom(S0, 'mn', scoreOf([-1, 0.35])), rim: rimMn, dir: [-1, -0.55], avoid: 'left' });
  label({ text: 'Sn', color: C_LSN, key: 'l2', anchor: sheetAtom(S0, 'sn', scoreOf([-1, -0.25])), rim: rimSn, dir: [-1, 0.25], avoid: 'left' });
  // the film stack: film, seed and substrate, each from its front-left corner. The subscript shrinks to a smudge on
  // small canvases, so those get the plain-digit form.
  const yaw3 = PRESETS[3].yaw, leftOf = (a) => -(a.x * Math.cos(yaw3) - a.z * Math.sin(yaw3));
  const filmAnchor = sheetAtom(S0, 'mn', scoreOf([-1, 0.55]));
  label({ text: 'Mn₃Sn', color: C_LMN, key: 'l3', anchor: filmAnchor, rim: rimMn, dir: [-1, -0.45], only: 'large' });
  label({ text: 'Mn3Sn', color: C_LMN, key: 'l3', anchor: filmAnchor, rim: rimMn, dir: [-1, -0.45], only: 'small' });
  label({ text: 'W seed', color: C_LGREY, key: 'l3', anchor: fixedAtom(W_ATOMS.filter((a) => a.m === 1), leftOf), rim: rimW, dir: [-1, 0.05] });
  // the substrate label points at the substrate's top plane in front of the seed (not next to the seed's corner)
  const wzMax = Math.max(...W_ATOMS.map((w) => w.z));
  const mgoTop = MG_ATOMS.filter((a) => a.m === 0 && a.fade > 0.5);
  const mgoFront = mgoTop.filter((a) => a.z > wzMax + 0.4);
  label({ text: 'MgO substrate', color: C_LGREY, key: 'l3', anchor: fixedAtom(mgoFront.length ? mgoFront : mgoTop, leftOf, mgoGroup), rim: rimO, dir: [-0.55, 1] });

  // ---------------------------------------------------------------- stage state + tweens
  const P = { ...PRESETS[0] };
  // one preallocated tween record per parameter (the per-frame step allocates nothing)
  const tweens = P_KEYS.map((key) => ({ key, on: false, from: 0, to: 0, t0: 0, dur: 1, linear: LINEAR.has(key) }));
  let stage = 0, stageClock = 0, hold = 1, autoplay = true, transEnd = 0, started = false, disposed = false, emitted = false;
  let time = 0, W = 1, H = 1, tanV = 0.23, tanH = 0.32, small = false;
  function emit() {
    if (disposed) return;
    emitted = true;
    canvas.dispatchEvent(new CustomEvent('model:stage', { detail: { index: stage, count: STAGES.length } }));
  }
  function goTo(i, picked, silent = false) {
    stage = i; stageClock = 0; hold = picked ? 2 : 1;
    const to = PRESETS[i], tm = TIMING[i];
    transEnd = 0;
    for (const tw of tweens) {
      const k = tw.key;
      const [dur, delay] = CAM_KEYS.includes(k) ? tm.cam : tm[k === 'dpS' ? 'dp' : k];
      transEnd = Math.max(transEnd, dur + delay);
      tw.on = false;
      if (reducedMotion) { P[k] = to[k]; continue; }
      if (P[k] === to[k]) continue;
      tw.on = true; tw.from = P[k]; tw.to = to[k]; tw.t0 = time + delay; tw.dur = dur;
    }
    // reduced motion: a stage jump always lands exactly on the preset view (no drag offset left over)
    if (reducedMotion) resetDrag();
    if (!silent) emit();
  }
  function stepTweens() {
    for (let n = 0; n < tweens.length; n++) {
      const tw = tweens[n];
      if (!tw.on) continue;
      const u = clamp((time - tw.t0) / tw.dur);
      P[tw.key] = lerp(tw.from, tw.to, tw.linear ? u : easeInOut(u));
      if (u >= 1) tw.on = false;
    }
  }

  // ---------------------------------------------------------------- drag to rotate (horizontal drags only)
  // Primary button / first touch only; the pointer is captured on press (as in hamr-media.js) so the release is
  // always seen, and a move with no button held ends any drag that lost its release.
  // With reduced motion there is no loop to ease the offset back, so releasing snaps to the preset (one render).
  let dragYaw = 0, dragPitch = 0, dragging = false, decided = false, x0 = 0, y0 = 0, lastX = 0, lastY = 0;
  let yawCur = 0, pitchCur = 0;      // eased drag + sway offsets actually applied to the camera
  function resetDrag() {
    const moved = dragYaw !== 0 || dragPitch !== 0 || yawCur !== 0 || pitchCur !== 0;
    dragYaw = dragPitch = yawCur = pitchCur = 0;
    return moved;
  }
  const onDown = (e) => {
    if (e.button !== 0 || !e.isPrimary) return;
    dragging = true; decided = false; x0 = lastX = e.clientX; y0 = lastY = e.clientY;
    try { canvas.setPointerCapture?.(e.pointerId); } catch { /* pointer already gone */ }
  };
  const onUp = (e) => {
    try { if (e && e.type !== 'lostpointercapture' && canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    dragging = false; decided = false; canvas.classList.remove('is-grabbing');
    if (reducedMotion && resetDrag()) redraw();
  };
  const onMove = (e) => {
    if (!dragging || !e.isPrimary) return;
    if (e.buttons === 0) { onUp(e); return; }
    if (!decided) {
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.hypot(dx, dy) < 6) return;
      decided = true;
      if (Math.abs(dy) > Math.abs(dx)) { dragging = false; return; }   // mostly vertical: leave it to page scroll
      canvas.classList.add('is-grabbing');
      lastX = e.clientX; lastY = e.clientY;
    }
    dragYaw = clamp(dragYaw - (e.clientX - lastX) * 0.006, -YAW_MAX, YAW_MAX);
    dragPitch = clamp(dragPitch + (e.clientY - lastY) * 0.003, -PITCH_MAX, PITCH_MAX);
    lastX = e.clientX; lastY = e.clientY;
    redraw();
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('lostpointercapture', onUp);

  // ---------------------------------------------------------------- camera: fit the current box at any aspect
  const camTarget = new THREE.Vector3();
  const vB = new THREE.Vector3(), vR = new THREE.Vector3(), vU = new THREE.Vector3(), vP = new THREE.Vector3();
  const FIT = 0.9;
  /**
   * Distance at which the box (half sizes hx, hy, hz around the target) fits the view, with the target drawn
   * `shift` of the width right of centre (setViewOffset). Solved for the actual box at a fixed vertical FOV instead
   * of common.js fitCameraToAspect: the framed extent changes shape with the stage (one upright sheet face-on, a
   * deep row of sheets at a slant, the whole film stack) and with the camera angle.
   */
  function fitDistance(yaw, pitch, shift, hy) {
    vB.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    vR.set(Math.cos(yaw), 0, -Math.sin(yaw));
    vU.crossVectors(vB, vR);
    const mR = tanH * FIT * (1 - 2 * shift), mL = tanH * FIT * (1 + 2 * shift), mV = tanV * FIT;
    let d = 0;
    for (let i = 0; i < 8; i++) {
      vP.set(i & 1 ? P.hx : -P.hx, i & 2 ? hy : -hy, i & 4 ? P.hz : -P.hz);
      const f = vP.dot(vB), r = vP.dot(vR), u = vP.dot(vU);
      d = Math.max(d, f + (r > 0 ? r / mR : -r / mL), f + Math.abs(u) / mV);
    }
    return d;
  }
  let camDist = 10, shiftCur = -1, wideK = 0;
  function placeCamera(dt) {
    if (dt && !dragging) { const k = damp(0.9, dt); dragYaw -= dragYaw * k; dragPitch -= dragPitch * k; }
    const sway = reducedMotion ? 0 : SWAY * Math.sin(time * 0.23);
    const k = dt ? damp(8, dt) : 1;
    yawCur += (dragYaw + sway - yawCur) * k;
    pitchCur += (dragPitch - pitchCur) * k;
    const yaw = P.yaw + yawCur, pitch = clamp(P.pitch + pitchCur, 0.04, 0.75);
    const shift = lerp(P.shift, P.shW, wideK), hy = lerp(P.hy, P.hyW, wideK);
    if (Math.abs(shift - shiftCur) > 1e-5) {
      shiftCur = shift;
      camera.setViewOffset(W, H, -shiftCur * W, 0, W, H);
    }
    camTarget.set(P.cx, P.cy, P.cz);
    camDist = fitDistance(yaw, pitch, shift, hy);
    camera.position.set(
      camTarget.x + camDist * Math.sin(yaw) * Math.cos(pitch),
      camTarget.y + camDist * Math.sin(pitch),
      camTarget.z + camDist * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();
    const R = Math.hypot(P.hx, hy, P.hz);
    scene.fog.near = camDist - R * 0.2;
    scene.fog.far = camDist + R * 3.2;
  }

  // ---------------------------------------------------------------- per-frame state
  function update() {
    const st = P.st, dp = small ? P.dpS : P.dp;
    // the front sheet takes the row look (brighter frame and pane) as the sheet right behind it arrives, and drops
    // it as that sheet leaves (it is the first in and the last out)
    const rowOn = smoothstep(0, 0.6, remap(st, 0, ARR_LEN));
    for (let n = 0; n < sheets.length; n++) {
      const S = sheets[n], k = S.k;
      let fade = 1, z = SHEET_Z[k], depth = rowOn;
      if (k > 0) {
        const t0 = ((k - 1) / (N_SHEETS - 2)) * ARR_SPREAD;
        const u = remap(st, t0, t0 + ARR_LEN);
        fade = smoothstep(0, 0.6, u);
        z -= SLIDE * (1 - easeOutCubic(u));
        depth = 1;                   // a back sheet slides in and out at its dimmed value, never brighter
      }
      S.group.position.z = z;
      S.group.visible = fade > 0.003;
      // depth cue: the gentle and the steep profile mixed by dp
      const lin = DIM_LIN[k];
      S.f = fade * lerp(1, lerp(lin, DIM_STEEP[k], dp), depth);
      S.mnU.value = S.snU.value = S.f;
      S.bondMat.opacity = BOND_OPACITY * lineK * fade * lerp(1, lerp(lin, BOND_STEEP[k], dp), depth);
      S.fillMat.opacity = FILL_OPACITY * fade * lerp(1, lerp(lin, FILL_STEEP[k], dp), depth);
      S.fillMat.visible = S.fillMat.opacity > 0.002;
      const frameK = lerp(FRAME_SINGLE, lerp(lin, FRAME_ROW[k], dp), depth);
      S.frameMat.opacity = FRAME_OPACITY * lineK * fade * frameK;
      S.paneMat.opacity = PANE_OPACITY * fade * lerp(PANE_SINGLE, 1, depth);
      setSheetAtoms(S, P.as, P.g);
    }
    floorMat.opacity = FLOOR_OPACITY * (1 - smoothstep(0.05, 0.7, P.sub));
    floor.visible = floorMat.opacity > 0.002;
    // seed + ground, substrate (rises a little as it comes in)
    updateW(st, P.sub);
    setWRadius(R_W * P.as * W_K);
    const sub = easeInOut(P.sub);
    mgoU[0].value = mgoU[1].value = smoothstep(0.15, 1, P.sub);
    mgoGroup.position.y = -0.35 * (1 - sub);
    mgoGroup.visible = P.sub > 0.15;
    wFrameMat.opacity = 0.42 * lineK * smoothstep(0.35, 1, P.sub);
    wFrame.visible = wFrameMat.opacity > 0.003;
    // ring highlight
    const breathe = reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(time * 1.6);
    ringMat.opacity = (small ? 0.95 : 0.85) * P.hl * breathe;
    hexFillMat.opacity = (small ? 0.24 : 0.18) * P.hl * breathe;
    ring.visible = hexFill.visible = P.hl > 0.005;
  }

  // labels: fixed pixel size, a short leader from the anchor atom in a set screen direction, kept inside the
  // canvas and clear of the front sheet's frame (avoid); a label that would overlap one placed before it is pushed
  // along y. The leader runs from the atom's rim to the edge of the label's box (never under the text).
  const vA = new THREE.Vector3(), vL = new THREE.Vector3(), vC = new THREE.Vector3(), vF = new THREE.Vector3();
  const vE = new THREE.Vector3();
  /**
   * Distance from the centre of a pill-shaped label box (half width hw, half height hh, round ends of radius hh, as
   * makeLabelSprite draws its background) to its edge along the unit screen direction (ux, uy).
   */
  function pillExit(ux, uy, hw, hh) {
    const cx = Math.max(0, hw - hh), ax = Math.abs(ux), ay = Math.abs(uy);
    if (ay > 1e-6 && ax * (hh / ay) <= cx) return hh / ay;          // through the flat top or bottom edge
    const b = ax * cx;                                               // through a round end (centre at ±cx)
    return b + Math.sqrt(Math.max(0, b * b - cx * cx + hh * hh));
  }
  const placed = labels.map(() => ({ x: 0, y: 0, bw: 0, bh: 0 }));   // pool, one record per label
  const FRAME_GAP = 5;                 // px between a label box and the frame it avoids
  /** Screen position (CSS px) of the front sheet's frame vertex i, into vF (x, y). */
  function frameVertex(i) {
    vF.set(FRAME_PTS[i][0], FRAME_PTS[i][1], 0).applyMatrix4(S0.group.matrixWorld).project(camera);
    vF.set((vF.x + 1) / 2 * W, (1 - vF.y) / 2 * H, 0);
    return vF;
  }
  /** Move a label box (centre lx, ly; half sizes bw, bh) off the frame; returns the new centre in vC (x, y). */
  function avoidFrame(lb, lx, ly, bw, bh) {
    if (lb.avoid === 'top') {
      // the frame's top edge is near-horizontal in the face-on views: keep the box above its higher end
      const y3 = frameVertex(3).y, x3 = vF.x, y4 = frameVertex(4).y, x4 = vF.x;
      if (lx + bw > Math.min(x3, x4) - FRAME_GAP && lx - bw < Math.max(x3, x4) + FRAME_GAP) ly = Math.min(ly, Math.min(y3, y4) - FRAME_GAP - bh);
    } else if (lb.avoid === 'left') {
      // keep the box left of the frame's left side (bottom-left, left corner and top-left vertices)
      const xl = Math.min(frameVertex(0).x, frameVertex(5).x, frameVertex(4).x);
      lx = Math.min(lx, xl - FRAME_GAP - bw);
    }
    return vC.set(clamp(lx, bw + 2, W - bw - 2), clamp(ly, bh + 2, H - bh - 2), 0);
  }
  function placeLabels() {
    const pxH = small ? 21 : 24, lead = small ? 16 : 24;
    let nPlaced = 0;
    for (let n = 0; n < labels.length; n++) {
      const lb = labels[n];
      const a = P[lb.key];
      lb.s.visible = lb.line.visible = a > 0.01 && (!lb.only || (lb.only === 'small') === small);
      if (!lb.s.visible) continue;
      lb.s.material.opacity = a;
      lb.lineMat.opacity = 0.6 * a;
      vA.copy(lb.anchor());
      const depth = -vL.copy(vA).applyMatrix4(camera.matrixWorldInverse).z;
      vL.copy(vA).project(camera);
      const sx = (vL.x + 1) / 2 * W, sy = (1 - vL.y) / 2 * H;
      const wpp = 2 * depth * tanV / H;                  // world units per CSS pixel at the anchor's depth
      const rimPx = lb.rim() * 1.2 / wpp;
      const bw = pxH * lb.aspect / 2 + 3, bh = pxH / 2 + 3;
      // centre so that the box edge sits `lead` px beyond the atom rim along the direction
      const reach = rimPx + Math.max(lead, (lb.leadW || 0) / wpp) + Math.min(bw / Math.max(Math.abs(lb.ux), 1e-3), bh / Math.max(Math.abs(lb.uy), 1e-3));
      avoidFrame(lb, sx + lb.ux * reach, sy + lb.uy * reach, bw, bh);
      let lx = vC.x, ly = vC.y;
      for (let pass = 0; pass < 3; pass++) {
        for (let m = 0; m < nPlaced; m++) {
          const q = placed[m];
          if (Math.abs(lx - q.x) < bw + q.bw && Math.abs(ly - q.y) < bh + q.bh) {
            const down = ly >= q.y;
            ly = down ? q.y + q.bh + bh : q.y - q.bh - bh;
            ly = clamp(ly, bh + 2, H - bh - 2);
          }
        }
      }
      const rec = placed[nPlaced++];
      rec.x = lx; rec.y = ly; rec.bw = bw; rec.bh = bh;
      lb.s.position.set(lx / W * 2 - 1, 1 - ly / H * 2, vL.z).unproject(camera);
      lb.s.scale.set(pxH * lb.aspect * wpp, pxH * wpp, 1);
      // leader, in screen space: from the atom's rim towards the label, ending where it meets the box, then both
      // ends unprojected at the anchor's depth (the label's too); no leader when the box sits on the atom
      const ldx = lx - sx, ldy = ly - sy, len = Math.hypot(ldx, ldy);
      const ux = len > 1e-6 ? ldx / len : lb.ux, uy = len > 1e-6 ? ldy / len : lb.uy;
      const toBox = len - pillExit(ux, uy, pxH * lb.aspect / 2, pxH / 2);
      lb.line.visible = toBox - rimPx > 3;
      if (!lb.line.visible) continue;
      vC.set((sx + ux * rimPx) / W * 2 - 1, 1 - (sy + uy * rimPx) / H * 2, vL.z).unproject(camera);
      vE.set((sx + ux * toBox) / W * 2 - 1, 1 - (sy + uy * toBox) / H * 2, vL.z).unproject(camera);
      const pos = lb.line.geometry.attributes.position;
      pos.setXYZ(0, vC.x, vC.y, vC.z);
      pos.setXYZ(1, vE.x, vE.y, vE.z);
      pos.needsUpdate = true;
    }
  }

  // ---------------------------------------------------------------- render
  function render(_t, dt) {
    if (disposed) return;
    if (!reducedMotion && dt) {
      time += dt;
      stageClock += dt;
      if (autoplay && stageClock > transEnd + DWELL * hold) goTo((stage + 1) % STAGES.length, false);
    }
    stepTweens();
    update();
    placeCamera(dt);
    root.updateMatrixWorld();
    placeLabels();
    renderer.render(scene, camera);
  }
  const loop = createLoop(render);
  const renderOnce = () => render(0, 0);
  /** Out-of-loop redraw (reduced motion, or a drag while paused): only while the host has the scene started. */
  const redraw = () => { if (started && !disposed && !loop.running) renderOnce(); };

  function resize() {
    if (disposed) return;
    W = canvas.clientWidth || 1; H = canvas.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;            // fixed FOV: fitDistance() backs the camera off for narrow canvases
    shiftCur = -1;                    // re-apply the view offset for the new size
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    tanH = tanV * camera.aspect;
    wideK = smoothstep(1.55, 2.1, camera.aspect);
    small = H < 330 || W < 420;
    const w = small ? RING_W_SMALL : RING_W;
    if (w !== ringW) { ringW = w; ring.geometry.dispose(); ring.geometry = ringGeo(w); }
    redraw();
  }
  const unobserve = observeResize(canvas, resize);
  goTo(0, false, true);
  resize();
  // once after creation, after the host has attached its listener (skipped if a stage set by the host already fired)
  const emitTimer = setTimeout(() => { if (!emitted) emit(); }, 0);

  // Read-only positions of the full stage-3 structure for reviewers' self-checks: scene units (hexagonal a = 1),
  // where `unitsPerAngstrom` converts the textbook cell sizes (Å) into scene units. Plain arrays, frozen.
  const debug = deepFreeze({
    unitsPerAngstrom: UNIT,
    mn: sheets.flatMap((S) => S.d.mn.map((a) => [a.x, a.y, SHEET_Z[S.k]])),
    sn: sheets.flatMap((S) => S.d.sn.map((a) => [a.x, a.y, SHEET_Z[S.k]])),
    w: W_ATOMS.map((a) => [a.x, a.y, a.z]),
    mgo: MG_ATOMS.map((a) => [a.x, a.y, a.z]),
    mgoIsO: MG_ATOMS.map((a) => a.o),
    sheetsZ: SHEET_Z.slice(),
    sheetsType: SHEET_TYPE.slice(),
  });

  return {
    debug,
    /** Triangles drawn in the last frame (renderer.info). */
    stats() { return { triangles: renderer.info.render.triangles, calls: renderer.info.render.calls }; },
    setProgress() {},
    setParam(name, value) {
      if (disposed) return;
      if (name === 'stage') {
        // only a number or a numeric string: '' / ' ' / null / booleans / arrays would coerce to stage 0
        if (typeof value === 'string' ? value.trim() === '' : typeof value !== 'number') return;
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        const i = Math.round(n);
        if (i < 0 || i >= STAGES.length) return;
        goTo(i, true);
        redraw();
      } else if (name === 'autoplay') {
        const was = autoplay;
        autoplay = !(value === false || value === 'false' || value === 0 || value === '0');
        // resuming: the stage on screen gets a fresh dwell (an unfinished transition keeps its own clock)
        if (autoplay && !was) stageClock = Math.min(stageClock, transEnd);
      }
    },
    resize,
    start() { if (disposed) return; started = true; if (reducedMotion) { renderOnce(); return; } loop.start(); },
    stop() { started = false; loop.stop(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      started = false; loop.stop(); unobserve(); clearTimeout(emitTimer);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('lostpointercapture', onUp);
      canvas.classList.remove('is-grabbing');
      disposeObject(scene); sphereLo.dispose(); envRT.dispose();   // the render target: disposing only its texture leaks it
      renderer.dispose();
    },
  };
}
