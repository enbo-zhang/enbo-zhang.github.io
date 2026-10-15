// micro-mtj.js — model beside the micrograph "Nanoscale tunnel-junction pillar".
// A spin-orbit-torque MRAM cell: an MTJ pillar (Pt cap, perpendicular SAF of two Co/Pt multilayers around Ru, Ta,
// FeCoB reference layer, MgO) etched down to the MgO and standing on a wide write-path strip (FeCoB free layer,
// Ir spin Hall layer, in-plane SAF Co/Ru/Co, IrMn) on the substrate; a C hard mask with an opening on the pillar top,
// SiN encapsulation with a planarised top and an Au top contact that reaches the Pt cap through the opening.
// Schematic, not to scale: no dimensions, thin layers exaggerated so each one is visible.
// Storyboard (auto-advancing stages, ~5 s dwell each, eased transitions, loops back to 0):
//   0 'Device'            oblique view: the write-path strip (layered front edge) runs across on the substrate, the
//                         pillar stands on it at the centre inside the translucent SiN, the Au strip lies on top
//   1 'Pillar stack'      SiN, Au and hard mask fade; the camera comes in nearly face-on and the pillar layers lift
//                         apart as discs above the free layer (a wide slab); layer labels in a column, brackets for
//                         the perpendicular SAF and the MTJ, small white magnetisation arrows
//   2 'Write path stack'  the pillar settles (dimmed); the camera drops to the strip's front edge and the film layers
//                         separate downward; labels, the in-plane SAF bracket, free ↕ and Co → / ← arrows
//   3 'Cross-section'     everything closes up, SiN and Au return, the front half is cut away and the camera turns
//                         face-on: the section faces show the layer bands, C shoulders beside the Au plug
//   4 'Write current'     back to oblique: current pulses run along the write path, the pillar foot glows
//   4 → 0                 the current fades and the camera swings back
// setParam('stage', i) tweens to stage i (then holds it 2x the dwell); setParam('autoplay', false) holds the stage.
// Fires 'model:stage' {index, count} on the canvas whenever the displayed stage changes (and once after creation).
// Drag to rotate (offsets the scripted view, eases back after release).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  clamp, damp, lerp, smoothstep, remap, band, easeInOut, createRenderer, makeLabelSprite, getGlowTexture,
  makeArrow, setArrowDirection, observeResize, fitCameraToAspect, createLoop, disposeObject,
} from './common.js';

export const STAGES = ['Device', 'Pillar stack', 'Write path stack', 'Cross-section', 'Write current'];

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

// ---------------------------------------------------------------- geometry (world units, schematic)
const WP_X = 3.0, WP_Z = 1.1;                // write-path strip: half length (x), half width (z); its top is y = 0
const SUB_X = 3.6, SUB_Z = 1.5, SUB_T = 0.45; // substrate under the strip
// |x| range over which the strip fades into the dark (per stage: f0 / f1), so it never meets the canvas edge bright;
// refitted per canvas size (fitFades): the oblique stages pull it in where the canvas would cut it, the stack stages
// keep the film's faded ends inside the room between the brackets and the label column
const FADE0 = [2.15, 2.95];
const F1_MIN = 1.9;                          // oblique stages: the strip never fades out before this
const BLOCK_X = 2.1;                         // SiN block / Au strip half length
const BLOCK_X3 = 3.0;                        // ... stretched in the cross-section, so SiN and Au run off both frame edges
const SIN_TOP = 1.0;                        // planarised SiN top = hard-mask top
const AU_T = 0.3, AU_Z = 0.78;               // Au strip thickness and half width
const AU_S3 = 5;                             // Au thickness factor in the cross-section (its top runs off the frame)
const PH = 0.65;                             // assembled pillar height (Pt cap top)
const C_RIN = 0.28;                          // radius of the opening in the hard mask (Au plug)
// pillar outline [r, y] bottom → top: flared foot at the MgO, then slightly tapered; the hard mask continues it
const PROFILE = [[0.92, 0], [0.91, 0.022], [0.82, 0.045], [0.73, 0.075], [0.68, 0.105], [0.62, PH], [0.6, SIN_TOP]];
// Co/Pt multilayers as deposited: n Co sublayers with a Pt sublayer between each two, so Co at both ends (against
// Ta / Ru below and Ru / the Pt cap above) and n - 0.5 periods: the lower block 3.5, the upper 5.5. Sublayers keep
// their real Co : Pt ratio, on one scale for both blocks (together as tall as the rest of the stack allows)
const CO_T = 0.4, PT_T = 1;
const coptT = (n) => (n * CO_T + (n - 1) * PT_T) * (0.38 / (10 * CO_T + 8 * PT_T));
// pillar layers bottom → top: assembled thickness t, exploded thickness te (thin layers exaggerated)
const PILLAR = [
  { k: 'mgo', mat: 'mgo', t: 0.045, te: 0.1 },
  { k: 'ref', mat: 'fecob', t: 0.06, te: 0.19 },
  { k: 'ta', mat: 'ta', t: 0.03, te: 0.09 },
  { k: 'cpl', mat: 'copt', t: coptT(4), te: 2 * coptT(4), stripes: { n: 4 } },
  { k: 'ru1', mat: 'ru', t: 0.035, te: 0.09 },
  { k: 'cpu', mat: 'copt', t: coptT(6), te: 2 * coptT(6), stripes: { n: 6 } },
  { k: 'pt', mat: 'pt', t: 0.1, te: 0.17 },
];
// write-path film top → bottom (then the substrate)
const FILM = [
  { k: 'free', mat: 'fecob', t: 0.05, te: 0.21 },
  { k: 'ir', mat: 'ir', t: 0.055, te: 0.12 },
  { k: 'co1', mat: 'co', t: 0.06, te: 0.12 },
  { k: 'ru2', mat: 'ru', t: 0.035, te: 0.09 },
  { k: 'co2', mat: 'co', t: 0.06, te: 0.12 },
  { k: 'irmn', mat: 'irmn', t: 0.09, te: 0.17 },
];
const FILM_T = FILM.reduce((s, f) => s + f.t, 0);
const G1 = 0.13, G2 = 0.13;                  // exploded gaps (pillar / film)
const SEG = 40;                              // lathe segments per half
const CUT_EPS = 0.004;                       // SiN section face sits just behind the cut so the pillar wins
const CUT_Z = 0.006;                         // cut plane + outline sit just in front of the section faces (no z-fight)

// ---------------------------------------------------------------- current
const PACKETS = 4;                           // current packets along the strip (spacing wraps seamlessly)
const PERIOD = (2 * WP_X) / PACKETS;
const SPEED = 1.1;                           // packet speed (world units / s)
const PULSE_W = 0.16;                        // packet half-width in the strip's emissive glow
const PER_PACKET = 14;                       // particles per packet (8 on the front face, 6 on the top)
const C_CURRENT = 0x7fd4ff;
const ARROW_Y = -FILM_T + 0.075, ARROW_Z = 1.32;   // direction arrow, on the substrate in front of the strip

// ---------------------------------------------------------------- motion
const DWELL = 5.0;                           // seconds a stage is shown after its transition
const SWAY = 0.05;                           // idle yaw drift amplitude (rad)
const YAW_MAX = 0.61, PITCH_MAX = 0.21;      // drag clamps (±35°, ±12°)
const FRAME_FILL = 0.88;                     // fraction of the view the stage's frame box may fill
const YAW1 = 0.3;                            // stage-1 yaw (the pillar arrows sit on the discs' near side)

// per-stage targets: camera (yaw, pitch, frame box centre + half extents; pitchp / hxp = pitch / half width at portrait
// aspects; rt / rb = room above / below the box for labels on leaders; c1 / c2 = weight of the stack stages' label
// column and brackets in the framing; up = where the fit leaves spare height (narrow canvases), the share of it the
// content moves up (negative: down); f0 / f1 = strip fade range, refitted per canvas size), sx (SiN / Au length factor:
// the cross-section runs them off both frame edges and the Au off the top), enc (SiN, Au, hard mask), fl (film below
// the free layer and substrate), pd (pillar brightness), ex1 / ex2 (pillar / film explode), cut, cur (current), labels
// l0..l4
const SX3 = BLOCK_X3 / BLOCK_X;
const PRESETS = [
  { yaw: 0.55, pitch: 0.32, pitchp: 0.32, cx: 0, cy: 0.4, cz: 0, hx: 2.45, hxp: 2.0, hy: 0.92, hz: 1.1, rt: 0, rb: 0, c1: 0, c2: 0, up: 0, f0: FADE0[0], f1: FADE0[1], sx: 1,
    enc: 1, fl: 1, pd: 1, ex1: 0, ex2: 0, cut: 0, cur: 0, l0: 1, l1: 0, l2: 0, l3: 0, l4: 0 },
  // the free layer is a wide slab under the pillar; its faded ends stay clear of the label column and the brackets
  { yaw: YAW1, pitch: 0.12, pitchp: 0.12, cx: 0, cy: 0.99, cz: 0.15, hx: 1.55, hxp: 1.4, hy: 1.33, hz: 0.6, rt: 0, rb: 0, c1: 1, c2: 0, up: 0, f0: 1.2, f1: 1.6, sx: 1,
    enc: 0, fl: 0, pd: 1, ex1: 1, ex2: 0, cut: 0, cur: 0, l0: 0, l1: 1, l2: 0, l3: 0, l4: 0 },
  // nearly edge-on, so only the layers' front faces show and the gaps between them read dark
  { yaw: 0.2, pitch: 0.035, pitchp: 0.035, cx: 0, cy: -0.72, cz: 0.6, hx: 1.2, hxp: 1.2, hy: 1.36, hz: 0.5, rt: 0, rb: 0, c1: 0, c2: 1, up: 0, f0: 0.95, f1: 1.25, sx: 1,
    enc: 0, fl: 1, pd: 0.32, ex1: 0, ex2: 1, cut: 0, cur: 0, l0: 0, l1: 0, l2: 1, l3: 0, l4: 0 },
  // face-on section (the box's near face is the cut plane), framed on the pillar like the TEM: SiN, Au and the write
  // path run off both edges, the Au off the top; labels sit on the section itself
  { yaw: 0, pitch: 0, pitchp: 0, cx: 0, cy: 0.44, cz: -0.55, hx: 1.4, hxp: 1.1, hy: 0.87, hz: 0.55, rt: 0, rb: 0, c1: 0, c2: 0, up: -0.6, f0: 2.6, f1: 3.0, sx: SX3,
    enc: 1, fl: 1, pd: 1, ex1: 0, ex2: 0, cut: 1, cur: 0, l0: 0, l1: 0, l2: 0, l3: 1, l4: 0 },
  { yaw: -0.6, pitch: 0.36, pitchp: 0.56, cx: 0, cy: 0.2, cz: 0.15, hx: 2.2, hxp: 2.1, hy: 0.62, hz: 1.2, rt: 0, rb: 0, c1: 0, c2: 0, up: 0.85, f0: FADE0[0], f1: FADE0[1], sx: 1,
    enc: 1, fl: 1, pd: 1, ex1: 0, ex2: 0, cut: 0, cur: 1, l0: 0, l1: 0, l2: 0, l3: 0, l4: 1 },
];
const CAM_KEYS = ['yaw', 'pitch', 'pitchp', 'cx', 'cy', 'cz', 'hx', 'hxp', 'hy', 'hz', 'rt', 'rb', 'c1', 'c2', 'up', 'f0', 'f1'];
const LABEL_KEYS = ['l0', 'l1', 'l2', 'l3', 'l4'];
// [duration, delay] in seconds per parameter when entering each stage; ex1, ex2 and cut run linearly (staged inside).
// Into the section the camera starts rising at once and the film closes a beat later, so the frame's bottom never
// opens onto black while the layers move up.
const TIMING = [
  { cam: [1.6, 0], enc: [0.7, 0.5], fl: [0.7, 0.3], pd: [0.7, 0], ex1: [1.2, 0], ex2: [1.2, 0], cut: [1.2, 0], cur: [0.8, 0], sx: [1.0, 0], lIn: [0.5, 1.3] },
  { cam: [1.6, 0], enc: [0.5, 0], fl: [0.6, 0], pd: [0.6, 0], ex1: [1.3, 0.3], ex2: [0.9, 0], cut: [1.0, 0], cur: [0.6, 0], sx: [0.5, 0], lIn: [0.5, 1.4] },
  { cam: [1.6, 0], enc: [0.5, 0], fl: [0.6, 0.2], pd: [0.8, 0.2], ex1: [0.8, 0], ex2: [1.2, 0.4], cut: [1.0, 0], cur: [0.6, 0], sx: [0.5, 0], lIn: [0.5, 1.5] },
  { cam: [1.5, 0], enc: [0.7, 0.3], fl: [0.6, 0], pd: [0.6, 0], ex1: [0.9, 0], ex2: [1.2, 0.3], cut: [1.3, 0.5], cur: [0.6, 0], sx: [0.8, 0.2], lIn: [0.5, 1.8] },
  { cam: [1.6, 0], enc: [0.7, 0], fl: [0.6, 0], pd: [0.6, 0], ex1: [0.9, 0], ex2: [0.9, 0], cut: [1.2, 0], cur: [1.0, 0.8], sx: [1.0, 0], lIn: [0.5, 1.5] },
];
const L_OUT = [0.35, 0];
const LINEAR = new Set(['ex1', 'ex2', 'cut']);
// label pill height and leader length in CSS px (small canvases use the smaller set: pill 26 px keeps the cap height
// above 9 px; the stack stages shrink it further only when their label column would not fit the height), the floor
// of that shrink, and the canvas margin
const LBL = { pxH: 27, lead: 22 }, LBL_SMALL = { pxH: 26, lead: 18 }, LBL_MIN = 20, LBL_M = 6;
const COL_GAP = 3;                          // gap between the stack stages' column labels
const BR_TICK = 6, BR_GAP = 6;              // bracket tick length, gap between bracket and its label
const BR_GUT = 12;                          // least gap (CSS px) between a bracket and the film's faded ends

// ---------------------------------------------------------------- materials (muted, lab style)
const MAT = {
  pt: { color: 0xddd3c0, metalness: 0.8, roughness: 0.32 },
  copt: { color: 0xffffff, metalness: 0.78, roughness: 0.34 },
  co: { color: 0x7d93ad, metalness: 0.72, roughness: 0.36 },
  ru: { color: 0x8ea88a, metalness: 0.6, roughness: 0.4 },
  ta: { color: 0x8a4a38, metalness: 0.45, roughness: 0.45 },
  // FeCoB: matte enough that the wide free-layer slab never turns into a bright sheet at grazing views
  fecob: { color: 0x76a9cf, metalness: 0.35, roughness: 0.58, envMapIntensity: 0.55 },
  // MgO: dark smoky glass (soft reflection, slightly see-through), not a polished metal rim
  mgo: { color: 0x2f3a46, metalness: 0.05, roughness: 0.38, envMapIntensity: 0.6, opacity: 0.88 },
  ir: { color: 0xc9a660, metalness: 0.75, roughness: 0.34 },
  irmn: { color: 0x5d6778, metalness: 0.5, roughness: 0.45 },
  sub: { color: 0x34363b, metalness: 0.08, roughness: 0.75 },
  c: { color: 0x2f3034, metalness: 0.05, roughness: 0.8 },
  au: { color: 0xf6d58e, metalness: 0.8, roughness: 0.3, envMapIntensity: 2.2 },
};
const CO_TINT = new THREE.Color(0x5a6e88), PT_TINT = new THREE.Color(0xcfc6b4);   // Co/Pt stripes (linear in GLSL)
// section faces of the metal layers are darker than their outer surfaces, so the cut pillar and film read dark
// against the pale SiN section, as in the TEM
const SECTION_DARK = 0.6;
// Co/Pt bands: a Co band is drawn at least CO_MIN_PX tall (on small canvases it widens into the Pt between, up to
// CO_MAX of a period, so the band count and the block's height stay), and the bands blend into their mean colour
// where a period gets under PAIR_FADE px (the far, oblique views), so they never alias
const CO_MIN_PX = 1.6, CO_MAX = 0.45, PAIR_FADE = [2.2, 3.4];

/** Deterministic PRNG (same as hamr-media.js) so the particle layout is identical on every load. */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Outline radius at assembled height y (pillar, then hard mask). */
function radiusAt(y) {
  for (let i = 1; i < PROFILE.length; i++) {
    const [r0, y0] = PROFILE[i - 1], [r1, y1] = PROFILE[i];
    if (y <= y1) return lerp(r0, r1, clamp((y - y0) / (y1 - y0 || 1)));
  }
  return PROFILE[PROFILE.length - 1][0];
}
/** Outline [r, y] between heights y0 and y1, shifted so it starts at y = 0. */
function segProfile(y0, y1) {
  const pts = [[radiusAt(y0), y0]];
  for (const [r, y] of PROFILE) if (y > y0 + 1e-6 && y < y1 - 1e-6) pts.push([r, y]);
  pts.push([radiusAt(y1), y1]);
  return pts.map(([r, y]) => [r, y - y0]);
}
/** Distance from x to the nearest current-packet centre at time t (packets move +x and wrap over the strip). */
function packetDist(x, t) {
  const ph = (((x + WP_X - t * SPEED) / PERIOD) % 1 + 1) % 1;
  return Math.min(ph, 1 - ph) * PERIOD;
}
const f4 = (n) => Number(n).toFixed(4);

// ---------------------------------------------------------------- geometry builders (halves split at z = 0)
/** Box x ∈ [-hx, hx], y ∈ [y0, y1]; whole (z ∈ [-hz, hz]) or the front (z ≥ 0) / back half. */
function box(hx, y0, y1, hz, front) {
  const whole = front === undefined;
  const g = new THREE.BoxGeometry(2 * hx, y1 - y0, whole ? 2 * hz : hz);
  g.translate(0, (y0 + y1) / 2, whole ? 0 : (front ? hz / 2 : -hz / 2));
  return g;
}
/** Solid of revolution of prof ([r, y] bottom → top), optionally with a central hole of radius rin (a ring).
 *  Whole: one group-less geometry. Half (front: z ≥ 0): groups [side, top, bottom, (inner wall,) section at z = 0]. */
function revolve(prof, front, rin = 0) {
  const whole = front === undefined;
  const seg = whole ? 2 * SEG : SEG;
  const phi0 = whole ? 0 : (front ? -Math.PI / 2 : Math.PI / 2), phiL = whole ? 2 * Math.PI : Math.PI;
  const [rb, yb] = prof[0], [rt, yt] = prof[prof.length - 1];
  const side = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg, phi0, phiL);
  const disc = (r, a0) => (rin > 0 ? new THREE.RingGeometry(rin, r, seg, 1, a0, phiL) : new THREE.CircleGeometry(r, seg, a0, phiL));
  const top = disc(rt, whole ? 0 : (front ? Math.PI : 0));
  top.rotateX(-Math.PI / 2); top.translate(0, yt, 0);
  const bot = disc(rb, whole ? 0 : (front ? 0 : Math.PI));
  bot.rotateX(Math.PI / 2); bot.translate(0, yb, 0);
  const parts = [side, top, bot];
  if (rin > 0) parts.push(new THREE.LatheGeometry([new THREE.Vector2(rin, yt), new THREE.Vector2(rin, yb)], seg, phi0, phiL));
  if (!whole) {
    const shapes = [];
    if (rin > 0) {
      for (const sx of [1, -1]) {
        const s = new THREE.Shape();
        // one shoulder: inner edge up the opening, outer edge along the profile (ShapeGeometry fixes the winding)
        s.moveTo(sx * rin, yb);
        prof.forEach(([r, y]) => s.lineTo(sx * r, y));
        s.lineTo(sx * rin, yt);
        shapes.push(s);
      }
    } else {
      const s = new THREE.Shape();
      prof.forEach(([r, y], i) => (i ? s.lineTo(r, y) : s.moveTo(r, y)));
      for (let i = prof.length - 1; i >= 0; i--) s.lineTo(-prof[i][0], prof[i][1]);
      shapes.push(s);
    }
    const cut = new THREE.ShapeGeometry(shapes);
    if (front) cut.rotateY(Math.PI);
    parts.push(cut);
  }
  const g = mergeGeometries(parts, !whole);
  parts.forEach((p) => p.dispose());
  return g;
}
/** Half of the SiN block: end faces, outer side, top with a half-round opening over the pillar, cavity wall. */
function nitrideHalf(front) {
  const sz = front ? 1 : -1;
  const parts = [];
  for (const sx of [-1, 1]) {
    const g = new THREE.PlaneGeometry(WP_Z, SIN_TOP);
    g.rotateY(sx * Math.PI / 2);
    g.translate(sx * BLOCK_X, SIN_TOP / 2, sz * WP_Z / 2);
    parts.push(g);
  }
  const side = new THREE.PlaneGeometry(2 * BLOCK_X, SIN_TOP);
  if (!front) side.rotateY(Math.PI);
  side.translate(0, SIN_TOP / 2, sz * WP_Z);
  parts.push(side);
  const R = PROFILE[PROFILE.length - 1][0] + 0.004, n = 24, sy = front ? -1 : 1;
  const s = new THREE.Shape();
  s.moveTo(-BLOCK_X, 0); s.lineTo(-R, 0);
  for (let i = 1; i < n; i++) { const a = Math.PI * (1 - i / n); s.lineTo(R * Math.cos(a), sy * R * Math.sin(a)); }
  s.lineTo(R, 0); s.lineTo(BLOCK_X, 0); s.lineTo(BLOCK_X, sy * WP_Z); s.lineTo(-BLOCK_X, sy * WP_Z);
  const top = new THREE.ShapeGeometry(s);
  top.rotateX(-Math.PI / 2); top.translate(0, SIN_TOP, 0);
  parts.push(top);
  // cavity wall hugging the pillar and hard mask (profile reversed so its normals face the axis)
  const wall = new THREE.LatheGeometry(PROFILE.slice().reverse().map(([r, y]) => new THREE.Vector2(r + 0.006, y)), SEG,
    front ? -Math.PI / 2 : Math.PI / 2, Math.PI);
  parts.push(wall);
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}
/** Edge segments of one half of the SiN block (no edges along the cut). */
function nitrideEdges(front) {
  const z1 = (front ? 1 : -1) * WP_Z, v = [];
  const seg = (a, b) => v.push(...a, ...b);
  for (const y of [0, SIN_TOP]) {
    seg([-BLOCK_X, y, z1], [BLOCK_X, y, z1]);
    for (const x of [-BLOCK_X, BLOCK_X]) seg([x, y, 0], [x, y, z1]);
  }
  for (const x of [-BLOCK_X, BLOCK_X]) seg([x, 0, z1], [x, SIN_TOP, z1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return g;
}
/** 1D label relaxation: items {want, size} (centres along one axis) are packed in order with gap, kept in [lo, hi];
 *  sets item.pos (centre). Overlapping neighbours merge into clusters centred on their mean wish. When all the items
 *  cannot fit, the gap shrinks first, then the whole run is centred on [lo, hi]. */
function relax(items, gap, lo, hi) {
  items.sort((a, b) => a.want - b.want);
  const total = items.reduce((s, it) => s + it.size, 0);
  if (items.length > 1 && total + gap * (items.length - 1) > hi - lo) gap = Math.max(0, (hi - lo - total) / (items.length - 1));
  const len = (c) => c.items.reduce((s, it) => s + it.size, 0) + gap * (c.items.length - 1);
  const place = (c) => {
    let off = 0, acc = 0;
    for (const it of c.items) { acc += it.want - (off + it.size / 2); off += it.size + gap; }
    const l = len(c);
    c.start = l > hi - lo ? (lo + hi - l) / 2 : clamp(acc / c.items.length, lo, hi - l);
  };
  const cls = [];
  for (const it of items) {
    const c = { items: [it] };
    place(c); cls.push(c);
    while (cls.length > 1) {
      const b = cls[cls.length - 1], a = cls[cls.length - 2];
      if (a.start + len(a) + gap <= b.start + 1e-6) break;
      a.items.push(...b.items); cls.pop(); place(a);
    }
  }
  for (const c of cls) { let off = c.start; for (const it of c.items) { it.pos = off + it.size / 2; off += it.size + gap; } }
}

export function createScene(canvas, options = {}) {
  const reducedMotion = !!options.reducedMotion;
  const renderer = createRenderer(canvas);
  renderer.toneMappingExposure = 1.05;
  renderer.autoClear = false;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 12, 30);
  const camera = new THREE.PerspectiveCamera(30, 1.4, 0.1, 80);
  // labels, leaders and brackets live in a screen-space overlay (CSS px), drawn after the model
  const overlay = new THREE.Scene();
  const ocam = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04), envTex = envRT.texture;
  room.dispose();
  scene.environment = envTex;
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x05060a, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.25); key.position.set(3, 7, 5); scene.add(key);
  // rim from the left-behind, kept off the azimuth opposite the cameras so flat tops don't mirror it into a white sheen
  const rimLight = new THREE.DirectionalLight(0x7fb0ff, 0.85); rimLight.position.set(-7, 3, -1); scene.add(rimLight);

  const root = new THREE.Group();
  scene.add(root);
  const U = {
    uTime: { value: 0 }, uOn: { value: 0 }, uF0: { value: FADE0[0] }, uF1: { value: FADE0[1] }, uDim: { value: 1 }, uSub: { value: 0 }, uLo: { value: 0.22 },
  };

  // ---------------------------------------------------------------- materials
  // shader additions (local coordinates): fade = strip ends fade into the dark; cur = packets of current glow along
  // the write path (emissive); dim = pillar brightness; sub = substrate darkens downward (lifted, with a faint top
  // edge, while the write-path stack is labelled); stripes = Co/Pt multilayer, its n dark Co sublayers and the pale
  // Pt between them drawn as bands (see CO_MIN_PX), Co at the block's bottom and top
  const vec3 = (c) => `vec3(${f4(c.r)}, ${f4(c.g)}, ${f4(c.b)})`;
  function hook(mat, o) {
    const st = o.stripes;
    const cacheKey = `mtj-${o.fade ? 'f' : ''}${o.cur ? 'c' : ''}${o.dim ? 'd' : ''}${o.sub ? 's' : ''}${st ? `-${st.n}-${st.t}` : ''}`;
    mat.customProgramCacheKey = () => cacheKey;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { uTime: U.uTime, uOn: U.uOn, uF0: U.uF0, uF1: U.uF1, uDim: U.uDim, uSub: U.uSub, uLo: U.uLo });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vLoc;${st ? '\nvarying float vNy;' : ''}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvLoc = position;${st ? '\nvNy = normal.y;' : ''}`);
      let fs = sh.fragmentShader.replace('#include <common>',
        `#include <common>\nvarying vec3 vLoc;\nuniform float uTime;\nuniform float uOn;\nuniform float uF0;\nuniform float uF1;\nuniform float uDim;\nuniform float uSub;\nuniform float uLo;${st ? '\nvarying float vNy;' : ''}`);
      if (st) {
        const T = st.n * CO_T + (st.n - 1) * PT_T;
        fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
          {
            // u: height in the block in sublayer units (Co = CO_T, Pt = PT_T); Co band k starts at k periods, the last
            // one ends at the top. A band under CO_MIN_PX widens and the period shrinks to keep n bands in the block
            float mtjU = min(clamp(vLoc.y / ${f4(st.t)}, 0.0, 1.0) * ${f4(T)}, ${f4(T - 1e-3)});
            float mtjFw = max(fwidth(mtjU), 1e-5);
            float mtjA = clamp(${f4(CO_MIN_PX)} * mtjFw, ${f4(CO_T)}, ${f4(CO_MAX * (CO_T + PT_T))});
            float mtjP = (${f4(T)} - mtjA) / ${f4(st.n - 1)};
            float mtjI = floor(mtjU / mtjP);
            float mtjM = mtjU - mtjI * mtjP;
            // signed distance to the nearest Co / Pt interface (< 0 in Co); the block's own ends are not interfaces
            float mtjLo = mtjI < 0.5 ? 1e3 : mtjM;
            float mtjHi = mtjI > ${f4(st.n - 1.5)} ? 1e3 : mtjA - mtjM;
            float mtjD = mtjM < mtjA ? -min(mtjLo, mtjHi) : min(mtjM - mtjA, mtjP - mtjM);
            float mtjCo = 1.0 - smoothstep(-0.5 * mtjFw, 0.5 * mtjFw, mtjD);
            // periods under PAIR_FADE px, and the block's flat top and bottom faces, take the mean colour
            float mtjK = smoothstep(${f4(PAIR_FADE[0])}, ${f4(PAIR_FADE[1])}, mtjP / mtjFw) * step(abs(vNy), 0.9);
            diffuseColor.rgb *= mix(${vec3(PT_TINT)}, ${vec3(CO_TINT)}, mix(mtjA / mtjP, mtjCo, mtjK));
          }`);
      }
      if (o.cur) {
        fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float mtjPh = fract((vLoc.x + ${f4(WP_X)} - uTime * ${f4(SPEED)}) / ${f4(PERIOD)});
          float mtjD = min(mtjPh, 1.0 - mtjPh) * ${f4(PERIOD)};
          float mtjPulse = exp(-mtjD * mtjD / ${f4(2 * PULSE_W * PULSE_W)});
          totalEmissiveRadiance += vec3(0.30, 0.72, 1.0) * uOn * (0.06 + 0.9 * mtjPulse);`);
      }
      let tail = '';
      if (o.fade) tail += 'float mtjFd = 1.0 - smoothstep(uF0, uF1, abs(vLoc.x));\ngl_FragColor.rgb *= mtjFd;\n';
      if (o.sub) {
        tail += `gl_FragColor.rgb *= mix(uLo, 1.0, smoothstep(${f4(-SUB_T + 0.03)}, -0.04, vLoc.y)) * (1.0 + 0.9 * uSub);\n`;
        tail += 'gl_FragColor.rgb += uSub * mtjFd * vec3(0.07, 0.078, 0.09) * (1.0 - smoothstep(0.0, 0.03, -vLoc.y));\n';
      }
      if (o.dim) tail += 'gl_FragColor.rgb *= uDim;\n';
      if (tail) fs = fs.replace('#include <dithering_fragment>', `#include <dithering_fragment>\n${tail}`);
      sh.fragmentShader = fs;
    };
  }
  // section = the flat cut face (matte, so the cross-section reads like a polished section rather than a mirror).
  // Every part material is transparent (opacity 1 while shown) so parts can fade in and out between stages.
  function makeMat(def, section, o) {
    const d = MAT[def];
    let p;
    if (def === 'au' && section) p = { color: 0xf0c060, metalness: 0.7, roughness: 0.42 };
    else if (section) {
      p = { color: new THREE.Color(d.color).multiplyScalar(SECTION_DARK), metalness: Math.min(d.metalness, 0.3), roughness: Math.max(d.roughness, 0.6) };
      if (def === 'mgo') p.color = new THREE.Color(0x3c4856);
    } else p = { ...d };
    // a see-through material (MgO) keeps its own opacity as the base the stage fades scale
    const base = section ? 1 : (p.opacity ?? 1);
    delete p.opacity;
    const m = new THREE.MeshStandardMaterial({ ...p, transparent: true, opacity: base });
    m.userData.base = base;
    hook(m, o);
    return m;
  }
  const SIN_OPACITY = 0.17;
  const makeSinMat = (side) => new THREE.MeshStandardMaterial({
    color: 0xbcd3e6, metalness: 0, roughness: 0.22, transparent: true, opacity: SIN_OPACITY, depthWrite: false, side,
  });

  // ---------------------------------------------------------------- parts (whole, plus back / front halves for the cut)
  // each part: outer group (position) → inner group (vertical scale = exploded / assembled thickness) → meshes
  const partList = [];
  const P_ = {};   // parts by key
  function addPart(key, def, kind, geoArgs, o, alphaKey) {
    const outer = new THREE.Group(), inner = new THREE.Group(), front = new THREE.Group();
    outer.add(inner); inner.add(front); root.add(outer);
    const mk = (isFront) => {
      const mat = makeMat(def, false, o), sec = makeMat(def, true, o);
      const geo = kind === 'box' ? box(...geoArgs, isFront) : revolve(geoArgs[0], isFront, geoArgs[1] || 0);
      // material groups: revolve = [side, top, bottom, (inner wall,) section]; box = [+x, -x, +y, -y, +z, -z]
      let mats;
      if (kind === 'box') mats = [mat, mat, mat, mat, isFront ? mat : sec, isFront ? sec : mat];
      else mats = geo.groups.map((g, i) => (i === geo.groups.length - 1 ? sec : mat));
      const mesh = new THREE.Mesh(geo, mats);
      mesh.renderOrder = isFront ? 1 : 0;
      return { mesh, mat, sec };
    };
    const b = mk(false), f = mk(true);
    const fullGeo = kind === 'box' ? box(...geoArgs) : revolve(geoArgs[0], undefined, geoArgs[1] || 0);
    const full = new THREE.Mesh(fullGeo, b.mat);
    inner.add(b.mesh, full); front.add(f.mesh);
    const pt = { key, outer, inner, front, back: b.mesh, full, baseMats: [b.mat, b.sec], frontMats: [f.mat, f.sec], alphaKey, y0: 0, th: 0 };
    partList.push(pt); P_[key] = pt;
    return pt;
  }
  // pillar layers (local y ∈ [0, t])
  let yA = 0;
  for (const L of PILLAR) {
    L.yA = yA;
    const prof = segProfile(yA, yA + L.t);
    const o = { dim: true, stripes: L.stripes ? { ...L.stripes, t: L.t } : null };
    const pt = addPart(L.k, L.mat, 'rev', [prof], o, null);
    pt.L = L;
    yA += L.t;
  }
  // hard mask (a ring around the opening), Au plug through it, Au strip on the planarised SiN
  addPart('c', 'c', 'rev', [segProfile(PH, SIN_TOP), C_RIN], { dim: true }, 'enc');
  addPart('plug', 'au', 'rev', [[[C_RIN - 0.003, 0], [C_RIN - 0.003, SIN_TOP - PH]]], { dim: true }, 'enc');
  addPart('au', 'au', 'box', [BLOCK_X, 0, AU_T, AU_Z], { dim: true }, 'enc');
  // write-path film (local y ∈ [-t, 0]) and substrate
  for (const F of FILM) {
    const pt = addPart(F.k, F.mat, 'box', [WP_X, -F.t, 0, WP_Z], { fade: true, cur: true }, F.k === 'free' ? null : 'fl');
    pt.F = F;
  }
  addPart('sub', 'sub', 'box', [SUB_X, -SUB_T, 0, SUB_Z], { fade: true, sub: true }, 'fl');

  // SiN block (translucent halves, no whole mesh) and its section face
  const sin = { front: new THREE.Group(), group: new THREE.Group(), mats: [], geos: [], edges: [], sx: 1 };
  sin.group.add(sin.front); root.add(sin.group);
  for (const isFront of [false, true]) {
    const geo = nitrideHalf(isFront);
    const back = new THREE.Mesh(geo, makeSinMat(THREE.BackSide));
    const face = new THREE.Mesh(geo, makeSinMat(THREE.FrontSide));
    back.renderOrder = 3; face.renderOrder = 5;
    const edges = new THREE.LineSegments(nitrideEdges(isFront),
      new THREE.LineBasicMaterial({ color: 0xcfe3f2, transparent: true, opacity: 0.3, depthWrite: false }));
    edges.renderOrder = 5;
    (isFront ? sin.front : sin.group).add(back, face, edges);
    sin.mats.push({ mat: back.material, base: SIN_OPACITY, front: isFront }, { mat: face.material, base: SIN_OPACITY, front: isFront },
      { mat: edges.material, base: 0.3, front: isFront, edge: true });
    sin.geos.push({ geo, x0: Float32Array.from({ length: geo.attributes.position.count }, (_, i) => geo.attributes.position.getX(i)) });
    sin.edges.push(edges);
  }
  // section face of the SiN (frosted, appears with the cut; the pillar's own section covers its middle). Nearly
  // opaque once the cut is done, and then it writes depth, so the section reads as a filled slice. It stops just
  // under the Au strip, so the two faces never fight along their interface.
  sin.cutMat = new THREE.MeshStandardMaterial({
    color: 0xc9dceb, emissive: 0x2a3440, metalness: 0, roughness: 0.85, transparent: true, opacity: 0, depthWrite: false,
  });
  sin.cut = new THREE.Mesh(new THREE.PlaneGeometry(2 * BLOCK_X, SIN_TOP - 0.004), sin.cutMat);
  sin.cut.position.set(0, (SIN_TOP - 0.004) / 2, -CUT_EPS);
  sin.cut.renderOrder = 4;
  sin.group.add(sin.cut);
  /** Length factor of the SiN block and the Au strip (the ends move out; the cavity round the pillar stays). */
  function setBlockX(f) {
    if (Math.abs(f - sin.sx) < 1e-5) return;
    sin.sx = f;
    for (const { geo, x0 } of sin.geos) {
      const pos = geo.attributes.position;
      for (let i = 0; i < x0.length; i++) if (Math.abs(x0[i]) > BLOCK_X - 1e-4) pos.setX(i, Math.sign(x0[i]) * BLOCK_X * f);
      pos.needsUpdate = true;
      geo.computeBoundingSphere();
    }
    for (const e of sin.edges) e.scale.x = f;
    sin.cut.scale.x = f;
    P_.au.outer.scale.x = f;
  }

  // ---------------------------------------------------------------- cut plane (appears briefly as the section opens)
  // unit plane / outline, sized on resize to sit inside the cross-section's view
  const CP = { x: 1.7, y0: -0.5, y1: 1.36 };
  const planeMat = new THREE.MeshBasicMaterial({
    color: 0x9fd8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), planeMat);
  plane.renderOrder = 6;
  const outlineMat = new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.5, -0.5, 0), new THREE.Vector3(0.5, -0.5, 0), new THREE.Vector3(0.5, 0.5, 0), new THREE.Vector3(-0.5, 0.5, 0),
  ]), outlineMat);
  outline.renderOrder = 6;
  root.add(plane, outline);
  function sizeCutPlane() {
    for (const o of [plane, outline]) { o.scale.set(2 * CP.x, CP.y1 - CP.y0, 1); o.position.set(0, (CP.y0 + CP.y1) / 2, CUT_Z); }
  }

  // ---------------------------------------------------------------- magnetisation arrows (stack stages only)
  // Thin white arrows built from a unit shaft and unit cone(s), sized every frame: their world size, but never smaller
  // on screen than a readable minimum (a phone-sized canvas still shows which way each one points), and never taller
  // than their layer.
  const arrowMat1 = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const arrowMatF = arrowMat1.clone(), arrowMat2 = arrowMat1.clone();
  const unitShaft = new THREE.CylinderGeometry(1, 1, 1, 10), unitHead = new THREE.ConeGeometry(1, 1, 14);
  // on-screen minimums (CSS px); a double arrow needs more length, so its two heads never meet in a diamond
  const ARW = { len: 14, len2: 17, headW: 5.2, headL: 4.6, shaftW: 2 };
  const mags = [];
  /** dir: 'up' | 'down' | 'both' | 'right' | 'left'; L: world length, cap: largest world length (its layer);
   *  at(v) writes the arrow centre; over: the on-screen minimum wins over the cap (the arrow may overhang a thin
   *  layer on a small canvas rather than shrink into an unreadable mark). */
  function addMag(L, cap, dir, mat, at, over = false) {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(unitShaft, mat), head = new THREE.Mesh(unitHead, mat);
    g.add(shaft, head);
    let head2 = null;
    if (dir === 'both') { head2 = new THREE.Mesh(unitHead, mat); head2.rotation.z = Math.PI; g.add(head2); }
    if (dir === 'down') g.rotation.z = Math.PI;
    else if (dir === 'right') g.rotation.z = -Math.PI / 2;
    else if (dir === 'left') g.rotation.z = Math.PI / 2;
    g.traverse((o) => { o.renderOrder = 9; });
    root.add(g);
    mags.push({ m: g, mat, shaft, head, head2, L, cap, at, over });
  }
  const vFwd = new THREE.Vector3(), vArw = new THREE.Vector3();
  /** Size the visible arrows for the current camera (after it is placed). */
  function sizeArrows() {
    camera.getWorldDirection(vFwd);
    for (const g of mags) {
      if (!g.m.visible) continue;
      const depth = vArw.copy(g.m.position).sub(camera.position).dot(vFwd);
      const wpp = 2 * Math.max(depth, 0.1) * tanV / H;            // world units per CSS px at the arrow
      const n = g.head2 ? 2 : 1;
      const minLen = (n === 2 ? ARW.len2 : ARW.len) * wpp;
      const len = g.over ? Math.max(Math.min(g.L, g.cap), minLen) : Math.min(Math.max(g.L, minLen), g.cap);
      // a double arrow's heads take at most 0.28 of it each, so a clear shaft stays between them
      const hl = Math.min(Math.max(Math.min(0.065, g.L * 0.32), ARW.headL * wpp), len * (n === 2 ? 0.28 : 0.5));
      const hr = Math.max(0.03, ARW.headW / 2 * wpp), sr = Math.max(0.0115, ARW.shaftW / 2 * wpp);
      const y0 = -len / 2 + (n === 2 ? hl * 0.9 : 0), y1 = len / 2 - hl * 0.9;
      g.shaft.position.y = (y0 + y1) / 2; g.shaft.scale.set(sr, Math.max(y1 - y0, 1e-4), sr);
      g.head.position.y = len / 2 - hl / 2; g.head.scale.set(hr, hl, hr);
      if (g.head2) { g.head2.position.y = -len / 2 + hl / 2; g.head2.scale.set(hr, hl, hr); }
    }
  }
  const nearDir = new THREE.Vector3(Math.sin(YAW1), 0, Math.cos(YAW1));
  /** Point just off the near side of pillar layer k (as seen from the stage-1 camera), at its mid-height. */
  const discFront = (k, off = 0.05) => (v) => {
    const pt = P_[k], r = radiusAt(pt.L.yA + pt.L.t / 2) + off;
    v.set(nearDir.x * r, pt.y0 + pt.th / 2, nearDir.z * r);
  };
  const filmFront = (k, x = 0) => (v) => { const pt = P_[k]; v.set(x, pt.y0 - pt.th / 2, WP_Z + 0.045); };
  const teOf = (k) => (PILLAR.find((l) => l.k === k) || FILM.find((f) => f.k === k)).te * 0.85;
  addMag(0.3, teOf('cpu'), 'down', arrowMat1, discFront('cpu'));
  addMag(0.22, teOf('cpl'), 'up', arrowMat1, discFront('cpl'));
  addMag(0.15, teOf('ref'), 'up', arrowMat1, discFront('ref'));
  addMag(0.17, teOf('free'), 'both', arrowMatF, filmFront('free'), true);
  addMag(0.5, 0.5, 'right', arrowMat2, filmFront('co1'));
  addMag(0.5, 0.5, 'left', arrowMat2, filmFront('co2'));

  // ---------------------------------------------------------------- write current: packets of glowing particles + foot glow
  const rand = mulberry32(0x4d544a);
  const NP = PACKETS * PER_PACKET;
  const pX0 = new Float32Array(NP), pTw = new Float32Array(NP);
  const pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3);
  for (let k = 0, i = 0; k < PACKETS; k++) {
    for (let j = 0; j < PER_PACKET; j++, i++) {
      pX0[i] = k * PERIOD + (rand() + rand() - 1) * 0.28;
      pTw[i] = rand() * Math.PI * 2;
      if (j < 8) { pPos[i * 3 + 1] = -0.04 - rand() * (FILM_T - 0.08); pPos[i * 3 + 2] = WP_Z + 0.025; }   // front face
      else { pPos[i * 3 + 1] = 0.035; pPos[i * 3 + 2] = (rand() * 2 - 1) * (WP_Z - 0.14); }               // top surface
    }
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const pMat = new THREE.PointsMaterial({
    size: 0.34, map: getGlowTexture(), vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false,
  });
  const particles = new THREE.Points(pGeo, pMat);
  particles.frustumCulled = false;
  particles.renderOrder = 7;
  root.add(particles);
  const C_P = new THREE.Color(C_CURRENT);

  const footGlowMat = new THREE.MeshBasicMaterial({
    map: getGlowTexture(), color: C_CURRENT, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const footGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.0), footGlowMat);
  footGlow.rotation.x = -Math.PI / 2;
  footGlow.position.y = 0.01;
  footGlow.renderOrder = 7;
  root.add(footGlow);

  const arrow = makeArrow(C_CURRENT, 2.4, { shaftRadius: 0.02, headRadius: 0.07, headLength: 0.1, emissive: 0.9 });
  arrow.userData.material.transparent = true;
  arrow.userData.material.depthWrite = false;
  arrow.userData.material.opacity = 0;
  setArrowDirection(arrow, new THREE.Vector3(1, 0, 0));
  arrow.position.set(-1.2, ARROW_Y, ARROW_Z);
  arrow.traverse((o) => { o.renderOrder = 8; });
  // depth-only copy of the shaft and head, drawn just before the arrow (after everything else, so nothing behind it
  // is cut out): while the arrow fades, only its nearest surface is shaded, so the cone base, the cone's far side and
  // the shaft's end don't blend on top of each other
  const arrowDepthMat = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  for (const m of [arrow.userData.shaft, arrow.userData.head]) {
    const d = new THREE.Mesh(m.geometry, arrowDepthMat);
    d.position.copy(m.position); d.quaternion.copy(m.quaternion); d.scale.copy(m.scale);
    d.renderOrder = 7.5;
    arrow.add(d);
  }
  root.add(arrow);

  // ---------------------------------------------------------------- labels (screen-space overlay, fixed pixel size)
  const dotCanvas = (draw) => {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    draw(c.getContext('2d'));
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  };
  const disc = (g, r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(16, 16, r, 0, Math.PI * 2); g.fill(); };
  const dotTex = dotCanvas((g) => disc(g, 11, '#fff'));
  // anchor dot of a dark leader (over the pale SiN section): light core in a dark ring, visible on light and dark
  const ringTex = dotCanvas((g) => { disc(g, 15, '#14171c'); disc(g, 8, '#f2f4f7'); });
  /** Label pill (same look as makeLabelSprite's); text with '\n' becomes a pill of several centred lines.
   *  Returns {s: sprite, wk / hk: width / height per pill height px}. */
  function makeText(text, color, left = false) {
    let s;
    const lines = text.split('\n');
    if (lines.length === 1) {
      s = makeLabelSprite(text, { color, fontSize: 42, fontFamily: MONO, fontWeight: 500, scale: 1, glow: false, background: 'rgba(0,0,0,0.6)', padding: 12 });
    } else {
      const fs = 42, pad = 12, font = `500 ${fs}px ${MONO}`, h1 = Math.ceil(fs * 1.35), lh = Math.ceil(fs * 1.15);
      const c = document.createElement('canvas'), g = c.getContext('2d');
      g.font = font;
      const w = Math.ceil(Math.max(...lines.map((t) => g.measureText(t).width))) + pad * 2;
      const h = h1 + lh * (lines.length - 1) + pad * 2, r = (h1 + pad * 2) / 2;
      c.width = w; c.height = h;
      g.fillStyle = 'rgba(0,0,0,0.6)';
      g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.fill();
      g.font = font; g.textAlign = left ? 'left' : 'center'; g.textBaseline = 'middle'; g.fillStyle = color;
      lines.forEach((t, i) => g.fillText(t, left ? pad : w / 2, pad + h1 / 2 + i * lh + fs * 0.04));
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
      s.scale.set(w / (h1 + pad * 2), h / (h1 + pad * 2), 1);
    }
    // mipmapped so the 3x minified text stays clean; drawn untouched by tone mapping
    const tex = s.material.map;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; tex.needsUpdate = true;
    s.material.toneMapped = false;
    s.material.opacity = 0;
    s.renderOrder = 3;
    s.visible = false;
    overlay.add(s);
    return { s, wk: s.scale.x, hk: s.scale.y };
  }
  function makeLeader(dark) {
    const mat = new THREE.LineBasicMaterial({ color: dark ? 0x14171c : 0xd8d8de, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3)), mat);
    line.frustumCulled = false; line.renderOrder = 1; line.visible = false;
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: dark ? ringTex : dotTex, color: dark ? 0xffffff : 0xe8e8ee, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false }));
    dot.renderOrder = 2; dot.visible = false;
    overlay.add(line, dot);
    return { line, dot, dotPx: dark ? 7 : 5, ink: dark ? 0.85 : 0.6 };
  }
  const freeLabels = [];
  /**
   * Free label (stages 0, 3, 4): side 'l' | 'r' | 'a' | 'b' with a leader, 'ul' up and to the left with an elbow
   * leader (up from the anchor, then left), 'c' centred on the anchor; anchor(v) writes the world point (evaluated
   * every frame, so it follows the parts). clear: a second point the label is pushed out past on its side; dark: the
   * leader runs over the light SiN section, so it is drawn dark; narrow: a two-line text used when the one-line pill
   * would be pushed back over its own anchor by the canvas edge.
   */
  function addLabel(text, color, key, side, anchor, { clear = null, dark = false, narrow = null } = {}) {
    const t = makeText(text, color);
    const lb = { t, texts: [t], key, side, anchor, clear };
    if (narrow) { lb.tn = makeText(narrow, color); lb.texts.push(lb.tn); }
    if (side !== 'c') Object.assign(lb, makeLeader(dark));
    freeLabels.push(lb);
  }
  const columns = { l1: [], l2: [] }, brackets = { l1: [], l2: [] };
  const C_TXT = '#e6e9ee', C_BR = '#c9ced6';
  const NARROW_W = 420;                      // below this canvas width the long column labels wrap to two lines
  /** Layer label for a stack stage's column (right of the stack), anchor on the layer's right edge; narrow: the
   *  two-line text used on narrow canvases. */
  function addCol(text, key, anchor, narrow = null) {
    const t = makeText(text, C_TXT), tn = narrow ? makeText(narrow, C_TXT, true) : t;   // wrapped lines flush left
    columns[key].push({ t, tn, texts: tn === t ? [t] : [t, tn], ...makeLeader(false), key, anchor, a: { x: 0, y: 0 } });
  }
  /** Group bracket (left of the stack): top(v) / bot(v) its ends, its left edge points used to place the line. The
   *  label (two lines where long) sits beside the bracket; compact: a narrower, taller text for narrow canvases
   *  (always level, never turned, and no taller than its bracket). */
  function addBracket(text, key, top, bot, compact = null) {
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
    const seg = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(24), 3)), mat);
    seg.frustumCulled = false; seg.renderOrder = 1; seg.visible = false;
    overlay.add(seg);
    const t = makeText(text, C_BR), tc = compact ? makeText(compact, C_BR) : t;
    brackets[key].push({ t, tc, texts: tc === t ? [t] : [t, tc], key, top, bot, seg, mat });
  }

  const camRight = new THREE.Vector3(1, 0, 0);
  /** Point on pillar layer k's silhouette at fraction f of its height (side +1: camera right, −1: camera left). */
  const rimOf = (k, f = 0.5, side = 1) => (v) => {
    const pt = P_[k], r = radiusAt(pt.L.yA + pt.L.t * f) * side;
    v.set(camRight.x * r, pt.y0 + pt.th * f, camRight.z * r);
  };
  /** x moved in to the lit part of the film (|x| at most a little inside the fade start f0), sign kept. */
  const litX = (x, m = 0.05) => () => Math.sign(x) * Math.min(Math.abs(x), P.f0 - m);
  /** Point on the front face of film part k at fraction f of its height down from the top (x: number or litX). */
  const faceOf = (k, x, f = 0.5, z = WP_Z) => (v) => { const pt = P_[k]; v.set(typeof x === 'function' ? x() : x, pt.y0 - pt.th * f, z); };
  const C_AU = '#f2c66b', C_SIN = '#cfe3f2', C_MET = '#d9dde3', C_MGO = '#bfe6ff', C_CUR = '#9fdcff';
  // 0 Device
  addLabel('Au top contact', C_AU, 'l0', 'a', (v) => v.set(-1.25, SIN_TOP + AU_T, -AU_Z));
  addLabel('MTJ pillar', '#ffffff', 'l0', 'r', (v) => { const r = radiusAt(0.4); v.set(camRight.x * r, 0.4, camRight.z * r); });
  const wp0 = litX(-1.95, -0.1);
  addLabel('Write path', C_MET, 'l0', 'b', (v) => v.set(wp0(), -FILM_T, WP_Z));
  addLabel('SiN', C_SIN, 'l0', 'c', (v) => v.set(-1.4, SIN_TOP / 2, WP_Z));
  // 1 Pillar stack: one label per layer in a column on the right, brackets on the left
  addCol('Pt cap', 'l1', rimOf('pt'));
  addCol('Co/Pt multilayer', 'l1', rimOf('cpu'), 'Co/Pt\nmultilayer');
  addCol('Ru', 'l1', rimOf('ru1'));
  addCol('Co/Pt multilayer', 'l1', rimOf('cpl'), 'Co/Pt\nmultilayer');
  addCol('Ta', 'l1', rimOf('ta'));
  addCol('FeCoB reference layer', 'l1', rimOf('ref'), 'FeCoB\nreference\nlayer');
  addCol('MgO', 'l1', rimOf('mgo'));
  addCol('FeCoB free layer', 'l1', faceOf('free', litX(0.9)), 'FeCoB\nfree layer');
  addBracket('Perpendicular\nSAF', 'l1', rimOf('cpu', 1, -1), rimOf('cpl', 0, -1), 'Perpen-\ndicular\nSAF');
  addBracket('MTJ', 'l1', rimOf('ref', 1, -1), faceOf('free', litX(-0.95), 1));
  // 2 Write path stack (anchors inside the bright part of the film; it fades out before the column and the bracket)
  const XA2 = litX(0.9), XB2 = litX(-0.95);
  addCol('FeCoB free layer', 'l2', faceOf('free', XA2), 'FeCoB\nfree layer');
  addCol('Ir spin Hall layer', 'l2', faceOf('ir', XA2), 'Ir spin\nHall layer');
  addCol('Co', 'l2', faceOf('co1', XA2));
  addCol('Ru', 'l2', faceOf('ru2', XA2));
  addCol('Co', 'l2', faceOf('co2', XA2));
  addCol('IrMn', 'l2', faceOf('irmn', XA2));
  addCol('Substrate', 'l2', (v) => v.set(XA2(), P_.sub.y0 - 0.1, SUB_Z));
  addBracket('In-plane\nSAF', 'l2', faceOf('co1', XB2, 0), faceOf('co2', XB2, 1), 'In-\nplane\nSAF');
  // 3 Cross-section: labels sit on the section (Au and the write path on their own bands, SiN on its face), the
  // C hard mask from its right shoulder, MgO up and to the left of the foot (elbow leader into the SiN, clear of the
  // write path); leaders over the pale SiN are dark
  const footR = PROFILE[0][0];
  addLabel('Au top contact', C_AU, 'l3', 'c', (v) => v.set(-1.0, SIN_TOP + AU_T / 2, 0));
  addLabel('SiN', C_SIN, 'l3', 'c', (v) => v.set(-1.05, 0.62, 0));
  const HM_Y = (PH + SIN_TOP) / 2, HM_R = radiusAt(HM_Y) - 0.035;   // dot just inside the shoulder: the leader runs over the SiN
  addLabel('C hard mask', C_MET, 'l3', 'r', (v) => v.set(camRight.x * HM_R, HM_Y, camRight.z * HM_R), { dark: true, narrow: 'C hard\nmask' });
  addLabel('MgO', C_MGO, 'l3', 'ul', (v) => { const r = -radiusAt(0.0225); v.set(camRight.x * r, 0.0225, camRight.z * r); },
    { clear: (v) => v.set(-camRight.x * (footR + 0.05), 0.0225, -camRight.z * (footR + 0.05)), dark: true });
  addLabel('Write path', C_MET, 'l3', 'c', (v) => v.set(1.25, -FILM_T / 2, 0));
  // 4 Write current
  addLabel('Write current', C_CUR, 'l4', 'b', (v) => v.set(0, ARROW_Y, ARROW_Z));
  const wp4 = litX(2.05, -0.1);
  addLabel('Write path', C_MET, 'l4', 'r', (v) => v.set(wp4(), -FILM_T / 2, WP_Z));

  // ---------------------------------------------------------------- stage state + tweens
  const P = { ...PRESETS[0] };
  // strip fade range per stage for the current canvas size (fitFades); the stage targets use it instead of the presets'
  const FF = PRESETS.map((p) => ({ f0: p.f0, f1: p.f1 }));
  const tweens = {};
  let stage = 0, stageClock = 0, hold = 1, autoplay = true, transEnd = 0, disposed = false;
  let time = 0, W = 1, H = 1, tanV = 0.27, tanH = 0.37;
  /** Label pill height and leader length (CSS px) for the current canvas size. */
  function labelPx() { return (H < 400 || W < 480) ? LBL_SMALL : LBL; }
  // the first 'model:stage' goes out on a timer (after the host has attached its listener); a stage picked before it
  // fires is reported by that same event rather than twice
  let initEmitPending = true;
  function emit() {
    if (disposed) return;
    canvas.dispatchEvent(new CustomEvent('model:stage', { detail: { index: stage, count: STAGES.length } }));
  }
  function goTo(i, picked, silent = false) {
    stage = i; stageClock = 0; hold = picked ? 2 : 1;
    const to = { ...PRESETS[i], ...FF[i] }, tm = TIMING[i];
    transEnd = 0;
    for (const k in to) {
      let dt;
      if (CAM_KEYS.includes(k)) dt = tm.cam;
      else if (LABEL_KEYS.includes(k)) dt = to[k] > 0 ? tm.lIn : L_OUT;
      else dt = tm[k];
      const [dur, delay] = dt;
      if (Math.abs(to[k] - P[k]) > 1e-6) transEnd = Math.max(transEnd, dur + delay);
      if (reducedMotion) { P[k] = to[k]; delete tweens[k]; continue; }
      tweens[k] = { from: P[k], to: to[k], t0: time + delay, dur, linear: LINEAR.has(k) };
    }
    // reduced motion has no loop to ease a drag back, so each picked stage starts from its designed view
    if (reducedMotion) { dragYaw = 0; dragPitch = 0; }
    camTw = reducedMotion || silent ? null : { from: camDist, t0: time + tm.cam[1], dur: tm.cam[0] };
    if (!silent && !initEmitPending) emit();
  }
  function stepTweens() {
    for (const k in tweens) {
      const tw = tweens[k];
      const u = clamp((time - tw.t0) / tw.dur);
      P[k] = lerp(tw.from, tw.to, tw.linear ? u : easeInOut(u));
      if (u >= 1) delete tweens[k];
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

  // ---------------------------------------------------------------- camera: fit the stage's frame box at any aspect
  // The stack stages keep a column of labels on the right and the brackets on the left: the frame box is fitted into
  // the rest of the canvas and the view is shifted (view offset) so the box sits centred in that free rectangle.
  const res = { 1: { L: 0, R: 0, compact: false, ext: 0 }, 2: { L: 0, R: 0, compact: false, ext: 0 } };
  const camTarget = new THREE.Vector3();
  const vB = new THREE.Vector3(), vR = new THREE.Vector3(), vU = new THREE.Vector3(), vP = new THREE.Vector3();
  /** Distance at which a box (half extents hx, hy, hz around the target) fits margins mH, mV (tangents). */
  function fitDistance(yaw, pitch, hx, hy, hz, mH, mV) {
    vB.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    vR.set(Math.cos(yaw), 0, -Math.sin(yaw));
    vU.crossVectors(vB, vR);
    let d = 0;
    for (let i = 0; i < 8; i++) {
      vP.set(i & 1 ? hx : -hx, i & 2 ? hy : -hy, i & 4 ? hz : -hz);
      const f = vP.dot(vB);
      d = Math.max(d, f + Math.abs(vP.dot(vR)) / mH, f + Math.abs(vP.dot(vU)) / mV);
    }
    return d;
  }
  /** Pitch of stage parameters p at the canvas aspect: portrait canvases may look down more steeply (pitchp), so a
   *  wide subject stands taller there; blended across aspect 1 like the frame width. */
  function pitchOf(p) { return lerp(p.pitchp, p.pitch, smoothstep(0.85, 1.15, camera.aspect)); }
  /** Frame of stage parameters p at view (yaw, pitch) with the stack stages' explode extension e1 / e2 (world):
   *  frame centre height and half extents, reserved screen room (CSS px) and the camera distance. */
  function frameFor(p, yaw, pitch, e1, e2, out) {
    // portrait canvases use the stage's narrower frame (hxp), blended across aspect 1 so a resize never jumps
    out.hx = lerp(p.hxp, p.hx, smoothstep(0.85, 1.15, camera.aspect));
    // stack stages on tall canvases: the explode gaps open further (res.ext) and the frame grows with them — the
    // pillar upward, the film downward
    out.cy = p.cy + (e1 - e2) / 2;
    out.hy = p.hy + (e1 + e2) / 2;
    // reserved screen room (CSS px): label column / brackets of the stack stages, leaders above / below in the others
    const lp = labelPx(), cs = clamp(p.c1 + p.c2);
    const needTB = lp.lead + lp.pxH + LBL_M + 4;
    out.L = p.c1 * res[1].L + p.c2 * res[2].L; out.R = p.c1 * res[1].R + p.c2 * res[2].R;
    out.T = p.rt * needTB + cs * LBL_M; out.B = p.rb * needTB + cs * LBL_M;
    const aw = Math.max(40, W - out.L - out.R), ah = Math.max(40, H - out.T - out.B);
    const fill = lerp(FRAME_FILL, 0.95, cs);
    const mV = tanV * (ah / H) * fill;
    out.d = fitDistance(yaw, pitch, out.hx, out.hy, p.hz, tanH * (aw / W) * fill, mV);
    // where the width sets the distance, height is left over above and below the box: 'up' moves the view within it
    // (the content goes up by that share of it, or down when negative), so a narrow canvas has no empty band
    if (p.up) {
      const spare = (out.d - fitDistance(yaw, pitch, out.hx, out.hy, p.hz, 1e3, mV)) * mV;
      out.cy -= clamp(p.up * spare, -1, 1) / Math.cos(pitch);
    }
    return out;
  }
  const fr = {}, frTo = {};
  // camera distance tween: while the stage's camera keys ease, the distance never drops below a straight blend of the
  // two stages' fitted distances (the frame box turning through a narrower silhouette would otherwise dip the zoom)
  let camTw = null;
  let yawCur = 0, pitchCur = 0, camDist = 10;
  function placeCamera(dt) {
    if (dt && !dragging) { const k = damp(0.9, dt); dragYaw -= dragYaw * k; dragPitch -= dragPitch * k; }
    // no sway on the face-on section: SiN and Au run past the frame edges and would tilt with it
    const sway = reducedMotion ? 0 : SWAY * Math.sin(time * 0.23) * (1 - P.cut);
    const k = dt ? damp(8, dt) : 1;
    yawCur += (dragYaw + sway - yawCur) * k;
    pitchCur += (dragPitch - pitchCur) * k;
    const yaw = P.yaw + yawCur, pitch = clamp(pitchOf(P) + pitchCur, -0.08, 1.2);
    const e1 = P.c1 * res[1].ext * open1, e2 = P.c2 * res[2].ext * open2;
    frameFor(P, yaw, pitch, e1, e2, fr);
    camDist = fr.d;
    if (camTw) {
      const u = clamp((time - camTw.t0) / camTw.dur);
      if (u >= 1) camTw = null;
      else {
        const to = PRESETS[stage];
        const dTo = frameFor(to, to.yaw + yawCur, clamp(pitchOf(to) + pitchCur, -0.08, 1.2),
          to.c1 * res[1].ext * to.ex1, to.c2 * res[2].ext * to.ex2, frTo).d;
        camDist = Math.max(camDist, lerp(camTw.from, dTo, easeInOut(u)));
      }
    }
    const { L, R, T, B } = fr;
    camera.setViewOffset(W, H, (R - L) / 2, (B - T) / 2, W, H);
    camTarget.set(P.cx, fr.cy, P.cz);
    camera.position.set(
      camTarget.x + camDist * Math.sin(yaw) * Math.cos(pitch),
      camTarget.y + camDist * Math.sin(pitch),
      camTarget.z + camDist * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(camTarget);
    camera.updateMatrixWorld();
    camRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
    scene.fog.near = camDist - 1;
    scene.fog.far = camDist + 16;
  }

  // ---------------------------------------------------------------- per-frame state
  function setA(m, a) { m.opacity = (m.userData.base ?? 1) * a; m.depthWrite = a > 0.98; }
  /** Explode: pillar layers stack upward from the free layer (top gaps open first), film layers drop downward. */
  let open1 = 0, open2 = 0;   // how far the pillar / film gaps are open (0..1)
  function layout() {
    setBlockX(P.sx);
    const n = PILLAR.length;
    let y = 0;
    open1 = 0; open2 = 0;
    for (let i = 0; i < n; i++) {
      const pt = P_[PILLAR[i].k], L = pt.L;
      const k0 = 0.3 * (n - 1 - i) / (n - 1);
      const s = easeInOut(remap(P.ex1, k0, k0 + 0.7));
      pt.th = lerp(L.t, L.te, s);
      y += (G1 + res[1].ext / n) * s;
      open1 += s / n;
      pt.y0 = y; y += pt.th;
      pt.outer.position.y = pt.y0; pt.inner.scale.y = pt.th / L.t;
    }
    const lift = y - PH;
    P_.c.outer.position.y = P_.plug.outer.position.y = y;
    P_.au.outer.position.y = SIN_TOP + lift;
    // the Au grows upward with the section's stretch, so its top runs off the frame there
    P_.au.inner.scale.y = lerp(1, AU_S3, clamp((P.sx - 1) / (SX3 - 1)));
    const sF = easeInOut(Math.max(P.ex1, P.ex2));
    let top = 0;
    const g2 = G2 + res[2].ext / FILM.length;
    for (let j = 0; j < FILM.length; j++) {
      const pt = P_[FILM[j].k], F = pt.F;
      if (j > 0) {
        const k0 = 0.3 * (FILM.length - j) / FILM.length, s = easeInOut(remap(P.ex2, k0, k0 + 0.7));
        top -= g2 * s; open2 += s / FILM.length;
      }
      pt.th = lerp(F.t, F.te, j === 0 ? sF : easeInOut(remap(P.ex2, 0, 0.8)));
      pt.y0 = top; top -= pt.th;
      pt.outer.position.y = pt.y0; pt.inner.scale.y = pt.th / F.t;
    }
    const sS = easeInOut(remap(P.ex2, 0, 0.7));
    top -= g2 * sS; open2 += sS / FILM.length;
    P_.sub.y0 = top; P_.sub.outer.position.y = top;
  }
  function update() {
    layout();
    // cut: the cut plane lights up, the front half fades out in place (no offset ghost of it), then the SiN's
    // section face fills in
    const fa = 1 - smoothstep(0.05, 0.45, P.cut);
    const split = P.cut > 1e-4;
    for (const pt of partList) {
      const a = pt.alphaKey ? P[pt.alphaKey] : 1;
      pt.outer.visible = a > 0.003;
      pt.full.visible = !split; pt.back.visible = split;
      pt.front.visible = split && a * fa > 0.003;
      for (const m of pt.baseMats) setA(m, a);
      for (const m of pt.frontMats) setA(m, a * fa);
    }
    sin.group.visible = P.enc > 0.003;
    sin.front.visible = P.enc * fa > 0.003;
    // the back half's edges would show through the finished section as dashes: they go as it fills in
    const eb = 1 - smoothstep(0.4, 0.6, P.cut);
    for (const f of sin.mats) f.mat.opacity = f.base * P.enc * (f.front ? fa : f.edge ? eb : 1);
    // the section fills in while the front half fades (no moment of an empty box), and is fully opaque once the cut
    // is done, so nothing behind it (the write path's back half) shows through
    sin.cutMat.opacity = lerp(0.92, 1, smoothstep(0.9, 1, P.cut)) * smoothstep(0.08, 0.5, P.cut) * P.enc;
    sin.cutMat.depthWrite = sin.cutMat.opacity > 0.85;
    sin.cut.visible = sin.cutMat.opacity > 0.003;
    // the cut plane and its outline flash only while the section opens, not while it closes
    const pa = PRESETS[stage].cut > 0.5 ? band(P.cut, 0.02, 0.2, 0.55, 0.95) : 0;
    planeMat.opacity = 0.06 * pa; outlineMat.opacity = 0.7 * pa;
    plane.visible = outline.visible = pa > 0.003;
    U.uF0.value = P.f0; U.uF1.value = P.f1; U.uDim.value = P.pd;
    // the substrate lifts where it is a subject: labelled in the write-path stack, and under the section (an even mid
    // grey band like the TEM's, not a dark one)
    const sc = smoothstep(0.5, 1, P.cut);
    U.uSub.value = Math.max(P.l2, 0.7 * sc);
    U.uLo.value = Math.max(lerp(0.22, 0.6, P.l2), lerp(0.22, 0.9, sc));
    // magnetisation arrows
    arrowMat1.opacity = P.l1; arrowMat2.opacity = P.l2; arrowMatF.opacity = Math.max(P.l1, P.l2);
    for (const g of mags) { g.m.visible = g.mat.opacity > 0.003; if (g.m.visible) g.at(g.m.position); }
    // write current
    const on = P.cur;
    U.uTime.value = time; U.uOn.value = on;
    particles.visible = on > 0.003;
    if (particles.visible) {
      for (let i = 0; i < NP; i++) {
        const x = ((pX0[i] + time * SPEED) % (2 * WP_X) + 2 * WP_X) % (2 * WP_X) - WP_X;
        pPos[i * 3] = x;
        const b = on * (1 - smoothstep(P.f0 - 0.3, P.f1 - 0.2, Math.abs(x))) * (0.7 + 0.3 * Math.sin(time * 6 + pTw[i]));
        pCol[i * 3] = C_P.r * b; pCol[i * 3 + 1] = C_P.g * b; pCol[i * 3 + 2] = C_P.b * b;
      }
      pGeo.attributes.position.needsUpdate = true;
      pGeo.attributes.color.needsUpdate = true;
    }
    const d0 = packetDist(0, time);
    const under = Math.exp(-(d0 * d0) / (2 * 0.45 * 0.45));     // a packet passing under the pillar
    footGlowMat.opacity = on * (0.3 + 0.45 * under);
    footGlow.visible = on > 0.003;
    arrow.userData.material.opacity = P.l4;
    arrow.visible = P.l4 > 0.003;
  }

  // ---------------------------------------------------------------- label placement (CSS px, y down)
  const vA = new THREE.Vector3(), vC = new THREE.Vector3(), sA = { x: 0, y: 0 }, sC = { x: 0, y: 0 };
  function toScreen(v, out) { vC.copy(v).project(camera); out.x = (vC.x + 1) / 2 * W; out.y = (1 - vC.y) / 2 * H; return out; }
  /** Show text t of label lb (hiding its other variants) centred at (cx, cy), pill height pxH per line height. */
  function showText(lb, t, cx, cy, pxH, a, rot = 0) {
    for (const o of lb.texts) if (o !== t) o.s.visible = false;
    t.s.visible = true;
    t.s.position.set(cx, H - cy, 0);
    t.s.scale.set(pxH * t.wk, pxH * t.hk, 1);
    t.s.material.rotation = rot;
    t.s.material.opacity = a;
  }
  function setLeader(lb, pts, a) {
    const pos = lb.line.geometry.attributes.position;
    for (let i = 0; i < 3; i++) pos.setXYZ(i, pts[2 * i], H - pts[2 * i + 1], 0);
    pos.needsUpdate = true;
    lb.line.visible = lb.dot.visible = true;
    lb.line.material.opacity = lb.ink * a;
    lb.dot.position.set(pts[0], H - pts[1], 0);
    lb.dot.scale.setScalar(lb.dotPx);
    lb.dot.material.opacity = 0.9 * a;
  }
  function hide(lb) {
    for (const t of lb.texts) t.s.visible = false;
    if (lb.line) lb.line.visible = lb.dot.visible = false;
    if (lb.seg) lb.seg.visible = false;
  }
  const fp = { lx: 0, ly: 0, hw: 0, hh: 0, push: 0 };
  /** Position of free label lb's text t for anchor sA (and its clear point sC): fp = centre, half size, and how far
   *  the canvas edges pushed it back from where it wanted to be. */
  function freePos(lb, t, pxH, lead) {
    const M = LBL_M;
    const hw = pxH * t.wk / 2, hh = pxH * t.hk / 2;
    let lx = sA.x, ly = sA.y;
    if (lb.side === 'r') lx = sA.x + lead + hw;
    else if (lb.side === 'l') lx = sA.x - lead - hw;
    else if (lb.side === 'a') ly = sA.y - lead - hh;
    else if (lb.side === 'b') ly = sA.y + lead + hh;
    else if (lb.side === 'ul') { lx = sA.x - lead - hw; ly = sA.y - lead - hh; }
    if (lb.clear) {
      const gap = lead * 0.5;
      if (lb.side === 'r') lx = Math.max(lx, sC.x + gap + hw);
      else if (lb.side === 'l' || lb.side === 'ul') lx = Math.min(lx, sC.x - gap - hw);
      else if (lb.side === 'a') ly = Math.min(ly, sC.y - gap - hh);
      else if (lb.side === 'b') ly = Math.max(ly, sC.y + gap + hh);
    }
    const cx = clamp(lx, hw + M, Math.max(hw + M, W - hw - M)), cy = clamp(ly, hh + M, Math.max(hh + M, H - hh - M));
    Object.assign(fp, { lx: cx, ly: cy, hw, hh, push: Math.max(Math.abs(cx - lx), Math.abs(cy - ly)) });
    return fp;
  }
  function placeFree(lb, a, pxH, lead) {
    lb.anchor(vA); toScreen(vA, sA);
    if (lb.clear) { lb.clear(vA); toScreen(vA, sC); }
    let t = lb.t;
    // pushed back by the edge far enough to crowd its own anchor: the two-line text, if the label has one
    if (freePos(lb, t, pxH, lead).push > lead * 0.4 && lb.tn) { t = lb.tn; freePos(lb, t, pxH, lead); }
    const { lx, ly, hw, hh } = fp;
    showText(lb, t, lx, ly, pxH, a);
    if (!lb.line) return;
    if (lb.side === 'ul') { setLeader(lb, [sA.x, sA.y, sA.x, ly, Math.min(sA.x, lx + hw), ly], a); return; }
    let ex = lx, ey = ly;
    if (lb.side === 'r') ex = lx - hw; else if (lb.side === 'l') ex = lx + hw;
    else if (lb.side === 'a') ey = ly + hh; else ey = ly - hh;
    setLeader(lb, [sA.x, sA.y, sA.x, sA.y, ex, ey], a);
  }
  /** Column text of a stack-stage label (two lines on narrow canvases where it has them). */
  const colText = (lb) => (W < NARROW_W ? lb.tn : lb.t);
  /** Pill height and leader length of a stack stage: the canvas's set, shrunk (not below LBL_MIN) when the label
   *  column would not fit the canvas height. */
  function stackPx(key) {
    const base = labelPx(), col = columns[key];
    const lines = col.reduce((n, lb) => n + colText(lb).hk, 0);
    const fit = Math.floor((H - 2 * LBL_M - (col.length - 1) * COL_GAP) / lines);
    const pxH = clamp(fit, LBL_MIN, base.pxH);
    return { pxH, lead: Math.round(base.lead * pxH / base.pxH) };
  }
  /** Film parts whose faded ends the stack stages keep clear of their brackets and label column, per stage. */
  const SPAN_KEYS = { 1: ['free'], 2: [...FILM.map((f) => f.k), 'sub'] };
  const vE = new THREE.Vector3(), span = { lo: 0, hi: 0 };
  /** Screen x range (CSS px) of the film's visible ends at |x| = xv for the world boxes [y0, y1, z] (top face front
   *  and back, front face bottom) seen by cam. */
  function filmSpan(xv, boxes, cam, out) {
    out.lo = Infinity; out.hi = -Infinity;
    for (const [y0, y1, z] of boxes) {
      for (const sx of [-1, 1]) {
        for (const [y, zz] of [[y0, z], [y0, -z], [y1, z]]) {
          vE.set(sx * xv, y, zz).project(cam);
          const x = (vE.x + 1) / 2 * W;
          out.lo = Math.min(out.lo, x); out.hi = Math.max(out.hi, x);
        }
      }
    }
    return out;
  }
  const VIS = 0.9;                            // where in the fade a film end still shows (its brightness ~3 %)
  const visEnd = (f0, f1) => f0 + VIS * (f1 - f0);
  const liveBoxes = (keys) => keys.map((k) => {
    const pt = P_[k];
    return k === 'sub' ? [pt.y0, pt.y0 - SUB_T, SUB_Z] : [pt.y0, pt.y0 - pt.th, WP_Z];
  });
  /** Stack stage: layer labels in a column right of the stack (relaxed so they never overlap, leaders with an elbow),
   *  group brackets on the left (two-line labels beside them, the compact texts on narrow canvases). Both keep a
   *  gutter from the film's faded ends. */
  function placeStack(key, sIdx, a) {
    const M = LBL_M, col = columns[key], brs = brackets[key];
    const { pxH, lead } = stackPx(key);
    filmSpan(visEnd(P.f0, P.f1), liveBoxes(SPAN_KEYS[sIdx]), camera, span);
    let maxAx = span.hi, maxW = 0;
    for (const lb of col) {
      const t = colText(lb);
      lb.anchor(vA); toScreen(vA, lb.a);
      maxAx = Math.max(maxAx, lb.a.x); maxW = Math.max(maxW, pxH * t.wk);
      lb.want = lb.a.y; lb.size = pxH * t.hk;
    }
    const colX = clamp(maxAx + lead + 8, M, W - M - maxW);
    relax(col.slice(), COL_GAP, M, H - M);
    for (const lb of col) {
      const t = colText(lb), w = pxH * t.wk;
      showText(lb, t, colX + w / 2, lb.pos, pxH, a);
      const ex = Math.max(lb.a.x, colX - lead);
      setLeader(lb, [lb.a.x, lb.a.y, ex, lb.a.y, colX - 2, lb.pos], a);
    }
    // brackets: one shared line x left of the stack and of the film's faded ends (a gutter of BR_GUT)
    const compact = res[sIdx].compact;
    let maxBW = 0, minX = span.lo - BR_GUT + 8;
    for (const br of brs) {
      const t = compact ? br.tc : br.t;
      br.top(vA); toScreen(vA, sA); br.y0 = sA.y; minX = Math.min(minX, sA.x);
      br.bot(vA); toScreen(vA, sA); br.y1 = sA.y; minX = Math.min(minX, sA.x);
      maxBW = Math.max(maxBW, pxH * t.wk);
      br.want = (br.y0 + br.y1) / 2; br.size = pxH * t.hk;
    }
    const bx = clamp(minX - 8, M + maxBW + BR_GAP + 2, W);
    relax(brs.slice(), 6, M, H - M);
    for (const br of brs) {
      const t = compact ? br.tc : br.t;
      showText(br, t, bx - BR_GAP - pxH * t.wk / 2, br.pos, pxH, a);
      const yc = (br.y0 + br.y1) / 2, p = br.seg.geometry.attributes.position;
      const pts = [[bx + BR_TICK, br.y0], [bx, br.y0], [bx, br.y0], [bx, br.y1], [bx, br.y1], [bx + BR_TICK, br.y1], [bx - 3, yc], [bx, yc]];
      pts.forEach(([x, y], i) => p.setXYZ(i, x, H - y, 0));
      p.needsUpdate = true;
      br.seg.visible = true;
      br.mat.opacity = 0.5 * a;
    }
  }
  function placeLabels() {
    const { pxH, lead } = labelPx();
    for (const lb of freeLabels) { const a = P[lb.key]; if (a > 0.01) placeFree(lb, a, pxH, lead); else hide(lb); }
    for (const [key, sIdx] of [['l1', 1], ['l2', 2]]) {
      const a = P[key];
      if (a > 0.01) placeStack(key, sIdx, a);
      else { columns[key].forEach(hide); brackets[key].forEach(hide); }
    }
  }

  // ---------------------------------------------------------------- render
  function render(_t, dt) {
    if (!reducedMotion && dt) {
      time += dt;
      stageClock += dt;
      if (autoplay && stageClock > transEnd + DWELL * hold) goTo((stage + 1) % STAGES.length, false);
    }
    stepTweens();
    update();
    placeCamera(dt);
    sizeArrows();
    root.updateMatrixWorld();
    placeLabels();
    renderer.clear();
    renderer.render(scene, camera);
    renderer.clearDepth();
    renderer.render(overlay, ocam);
  }
  const loop = createLoop(render);
  const renderOnce = () => { if (!disposed) render(0, 0); };

  /** Screen room the stack stages reserve (label column right, brackets left), whether the brackets use their compact
   *  texts, and how much further the explode gaps open (ext, world height) when the free rectangle is taller than the
   *  stack needs, so a narrow canvas gets a taller stack instead of empty space above and below it. */
  function reserve() {
    const M = LBL_M;
    for (const [key, s] of [['l1', 1], ['l2', 2]]) {
      const { pxH, lead } = stackPx(key);
      const colW = Math.max(...columns[key].map((lb) => pxH * colText(lb).wk));
      const brW = Math.max(...brackets[key].map((br) => pxH * br.t.wk));
      const brWc = Math.max(...brackets[key].map((br) => pxH * br.tc.wk));
      const R = M + colW + lead + 8 + 4;
      const Lh = M + brW + BR_GAP + 8 + BR_TICK, Lc = M + brWc + BR_GAP + 8 + BR_TICK;
      const pr = PRESETS[s];
      // projected size of the frame box (world units) at the stage's view
      const pw = 2 * (pr.hx * Math.cos(pr.yaw) + pr.hz * Math.sin(pr.yaw));
      const ph = 2 * (pr.hy * Math.cos(pr.pitch) + pr.hz * Math.sin(pr.pitch));
      const kV = (H - 2 * M) / ph;
      // the full bracket texts unless they would shrink the stack a lot (the stretch below makes up the rest) and
      // leave it narrow on screen
      const compact = (W - Lh - R) / pw < 0.75 * kV && W - Lh - R < 220;
      const L = compact ? Lc : Lh;
      const kH = Math.max(1, W - L - R) / pw;
      const stretch = clamp(kV / kH, 1, 2.1);
      res[s] = { L, R, compact, ext: (stretch - 1) * ph / Math.cos(pr.pitch) };
    }
  }
  /** Rest view of stage s for the current canvas size (no drag, no sway) on the scratch camera cam2; returns its frame. */
  const cam2 = new THREE.PerspectiveCamera();
  function poseRest(s) {
    const p = PRESETS[s];
    cam2.fov = camera.fov; cam2.aspect = camera.aspect; cam2.near = camera.near; cam2.far = camera.far;
    const pitch = pitchOf(p);
    const f = frameFor(p, p.yaw, pitch, p.c1 * res[1].ext * p.ex1, p.c2 * res[2].ext * p.ex2, frTo);
    cam2.setViewOffset(W, H, (f.R - f.L) / 2, (f.B - f.T) / 2, W, H);
    const cp = Math.cos(pitch);
    cam2.position.set(p.cx + f.d * Math.sin(p.yaw) * cp, f.cy + f.d * Math.sin(pitch), p.cz + f.d * Math.cos(p.yaw) * cp);
    cam2.lookAt(p.cx, f.cy, p.cz);
    cam2.updateMatrixWorld();
    return f;
  }
  /** Strip fade range per stage for this canvas size (FF). Oblique stages: the fade ends inside the canvas (pulled in
   *  where the canvas would cut the strip while it is still lit). Stack stages: the visible ends sit as far out as the
   *  room between the brackets and the label column allows (the free layer a wide slab, the brackets over black). */
  function fitFades() {
    const sp = { lo: 0, hi: 0 };
    for (const s of [0, 4]) {
      poseRest(s);
      const m = 4 + 0.02 * W;   // room for the idle sway
      const boxes = [[0, -FILM_T, WP_Z], [-FILM_T, -FILM_T - SUB_T, SUB_Z]];
      let f1 = FADE0[1];
      for (; f1 > F1_MIN; f1 -= 0.02) {
        filmSpan(f1 - 0.05, boxes, cam2, sp);
        if (sp.lo >= m && sp.hi <= W - m) break;
      }
      f1 = Math.max(f1, F1_MIN);
      FF[s] = { f1, f0: f1 - (FADE0[1] - FADE0[0]) };
    }
    // stack stages at rest: the exploded free layer (stage 1); the exploded film and the substrate (stage 2)
    const g2 = G2 + res[2].ext / FILM.length, sumTe = FILM.reduce((n, f) => n + f.te, 0);
    const filmBot = -(sumTe + (FILM.length - 1) * g2), subTop = filmBot - g2;
    const fits = {
      1: { boxes: [[0, -FILM[0].te, WP_Z]], len: 0.4, lo: 1.1, hi: 1.75 },
      2: { boxes: [[0, filmBot, WP_Z], [subTop, subTop - SUB_T, SUB_Z]], len: 0.3, lo: 1.0, hi: 1.5 },
    };
    for (const s of [1, 2]) {
      const f = poseRest(s), o = fits[s];
      let xv = o.hi;
      for (; xv > o.lo; xv -= 0.01) {
        filmSpan(xv, o.boxes, cam2, sp);
        if (sp.lo >= f.L + 4 && sp.hi <= W - f.R + 4) break;
      }
      xv = Math.max(xv, o.lo);
      FF[s] = { f0: xv - VIS * o.len, f1: xv + (1 - VIS) * o.len };
    }
    for (const k of ['f0', 'f1']) {
      if (tweens[k]) tweens[k].to = FF[stage][k]; else P[k] = FF[stage][k];
    }
  }
  /** Canvas-size dependent detail: the cut plane's size (inside the section's view). */
  function sizeDetail() {
    const p3 = PRESETS[3];
    const d3 = frameFor(p3, p3.yaw, pitchOf(p3), p3.c1 * res[1].ext * p3.ex1, p3.c2 * res[2].ext * p3.ex2, frTo).d;
    const s3 = { d: d3, cy: frTo.cy };
    // the section face (z = 0) lies nearer than the stage-3 target (cz); keep the outline a little inside the view
    const dz = Math.max(1, s3.d + p3.cz * Math.cos(p3.yaw));
    CP.x = Math.min(2.4, 0.9 * dz * tanH);
    const hv = 0.9 * dz * tanV;
    CP.y0 = Math.max(-0.75, s3.cy - hv); CP.y1 = Math.min(1.6, s3.cy + hv);
    sizeCutPlane();
  }
  function resize() {
    if (disposed) return;
    W = canvas.clientWidth || 1; H = canvas.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.clearViewOffset();
    fitCameraToAspect(camera, W / H, { refAspect: 1.3, portraitFovBoost: 0.5, maxFov: 46 });
    tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    tanH = tanV * camera.aspect;
    ocam.right = W; ocam.top = H; ocam.updateProjectionMatrix();
    reserve();
    fitFades();
    sizeDetail();
    if (!loop.running) renderOnce();
  }
  const unobserve = observeResize(canvas, resize);
  goTo(0, false, true);
  resize();
  // once after creation, after the host has attached its listener (and reporting any stage it has already picked)
  const emitTimer = setTimeout(() => { initEmitPending = false; emit(); }, 0);

  return {
    setProgress() {},
    setParam(name, value) {
      if (disposed) return;
      if (name === 'stage') {
        if (value === '' || value == null) return;   // a missing attribute is not stage 0
        const i = Math.round(Number(value));
        if (!Number.isFinite(i) || i < 0 || i >= STAGES.length) return;
        goTo(i, true);
        if (!loop.running) renderOnce();
      } else if (name === 'autoplay') {
        const was = autoplay;
        autoplay = !(value === false || value === 'false' || value === 0 || value === '0');
        // turned back on: the current stage gets a full dwell before it moves on
        if (autoplay && !was) stageClock = Math.min(stageClock, transEnd);
      }
    },
    resize,
    start() { if (disposed) return; if (reducedMotion) { renderOnce(); return; } loop.start(); },
    stop() { loop.stop(); },
    dispose() {
      disposed = true;
      loop.stop(); unobserve(); clearTimeout(emitTimer);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('lostpointercapture', onUp);
      canvas.classList.remove('is-grabbing');
      disposeObject(scene); disposeObject(overlay); dotTex.dispose(); ringTex.dispose(); envRT.dispose(); pmrem.dispose();
      renderer.dispose();
    },
  };
}
