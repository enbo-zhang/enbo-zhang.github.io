// hamr-write.js — Scene A of the HAMR project: "Writing with heat".
// Two worlds, joined by a fade through black:
//   macro: spinning platter, actuator arm, suspension and the slider flying over a track;
//   head:  a cut-away of the slider's trailing edge (cut plane z = 0) above a granular FePt medium.
// Down-track = +x: the medium moves +x under the head (leading side −x, trailing side +x).
// Head layout along x: waveguide core → gold NFT (disk + peg at the air-bearing surface) → write pole → return pole.
// Physics of the write (all in the head frame, so the thermal profile is stationary):
//   T(x,z) = peak · exp(−(x−xh)²/2σx² − z²/2σz²), σx larger on the downstream side (the medium drags heat along).
//   Grains with T > Tc lose their magnetization; as they leave the spot they cool through Tc on the freeze
//   isotherm x_f(z) (curved), and the magnetization freezes along the write-pole field at that moment.
//   A grain at x > x_f(z) crossed it at t_c = t − (x − x_f)/v, so its bit = pattern(t_c): curved bit transitions.
// Storyboard (progress p):
//   0.00–0.20  platter, arm and slider; camera moves to the slider's trailing edge
//   0.20–0.45  cut-away: laser diode → waveguide (light pulses) → NFT; tip glows, a small light spot forms
//   0.45–0.75  at the air-bearing surface: grains stream under the head, heat past Tc, get written, freeze
//   0.75–1.00  pull back: the written track, with a temperature-vs-down-track curve and a dashed Tc line
// Drag to rotate (offsets the scripted view).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  COLORS, clamp, damp, lerp, smoothstep, remap, easeInOut, createRenderer, makeLabelSprite, makeGlowSprite,
  getGlowTexture, observeResize, fitCameraToAspect, createLoop, disposeObject,
} from './common.js';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

const C = {
  laser: 0xff5a36,
  nftHot: 0xfff1c9,
  fept: 0x8e9bb0,
  up: 0x64d2ff,
  down: 0xff9f0a,
  copper: 0xb87333,
  substrate: 0x1c1f26,
  insulator: 0xe8eef7,
  rim: 0xbfe9ff,
};
const HEAT_STOPS = [0x1b0c41, 0x781c6d, 0xed6925, 0xfbb61a, 0xfcffa4].map((h) => new THREE.Color(h));
function heatColor(t, out) {
  t = clamp(t) * 4;
  const i = Math.min(3, Math.floor(t));
  return out.copy(HEAT_STOPS[i]).lerp(HEAT_STOPS[i + 1], t - i);
}
const GLSL_INFERNO = `
vec3 heatMap(float t) {
  t = clamp(t, 0.0, 1.0) * 4.0;
  vec3 c0 = vec3(0.106, 0.047, 0.255), c1 = vec3(0.471, 0.110, 0.427), c2 = vec3(0.929, 0.412, 0.145),
       c3 = vec3(0.984, 0.714, 0.102), c4 = vec3(0.988, 1.0, 0.643);
  if (t < 1.0) return mix(c0, c1, t);
  if (t < 2.0) return mix(c1, c2, t - 1.0);
  if (t < 3.0) return mix(c2, c3, t - 2.0);
  return mix(c3, c4, t - 3.0);
}`;
/** Deterministic ±1 from an integer-ish seed. */
function hsign(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s) < 0.5 ? 1 : -1; }

// ---------------------------------------------------------------- head-world constants
const HA = 0.3;              // air-bearing surface height above the grain tops (exaggerated fly height)
const TOP = 2.2;             // slider top
const XH = 0.02;             // hot-spot centre (directly under the NFT peg at x = 0)
const SX_UP = 0.24, SX_DN = 0.3, SZ = 0.38;   // thermal spot widths
const THETA = 0.5;           // Tc relative to the peak temperature
const VEL = 0.32;            // medium speed (+x), world units / s
const BIT = 0.33;            // bit length
const TBIT = BIT / VEL;
const PITCH = 0.11;          // grain pitch
const X0 = -3.2, LEN = 8.8;  // medium window along x
const WID = 2.6;             // medium width along z
const GH = 0.22;             // grain height
const BAND = 0.9;            // track pitch for the pre-existing neighbouring tracks
const ZR = SZ * Math.sqrt(2 * Math.log(1 / THETA));   // half-width of the written track
const sxAt = (x) => (x < XH ? SX_UP : SX_DN);

export function createScene(canvas, options = {}) {
  const reducedMotion = !!options.reducedMotion;
  const renderer = createRenderer(canvas);
  renderer.toneMappingExposure = 1.05;
  const camera = new THREE.PerspectiveCamera(32, 2, 0.02, 80);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const textures = [];

  function lights(scene) {
    scene.environment = envTex;
    scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x05060a, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 6, 5); scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fb0ff, 0.8); rim.position.set(-4, 2, -5); scene.add(rim);
  }

  // labels: mono pills like lab-setup; constant on-screen size (scaled with camera distance)
  const labels = [];
  function label(parent, text, pos, { color = '#c7c7cc', group = 'x', size = 0.032 } = {}) {
    const s = makeLabelSprite(text, { color, fontSize: 42, fontFamily: MONO, fontWeight: 500, scale: 1, glow: false, background: 'rgba(0,0,0,0.6)', padding: 12 });
    s.position.copy(pos);
    s.userData.aspect = s.scale.x / s.scale.y;
    s.userData.size = size;
    s.userData.group = group;
    parent.add(s);
    labels.push(s);
    return s;
  }

  // ================================================================ MACRO WORLD
  const macro = new THREE.Scene();
  macro.fog = new THREE.Fog(0x000000, 12, 22);
  lights(macro);
  const R = 3;
  const S = v3(0, 0.03, 2.25);                      // slider position over the track (on +z, medium moves +x here)

  // platter: concentric tracks + faint servo wedges so the spin reads
  const pc = document.createElement('canvas'); pc.width = pc.height = 1024;
  const pg = pc.getContext('2d');
  pg.fillStyle = '#6d727b'; pg.fillRect(0, 0, 1024, 1024);
  for (let r = 70; r < 512; r += 1.5) {
    const b = 95 + Math.floor(40 * Math.abs(Math.sin(r * 0.37) * Math.sin(r * 0.071)));
    pg.strokeStyle = `rgb(${b},${b + 3},${b + 9})`; pg.lineWidth = 1.2;
    pg.beginPath(); pg.arc(512, 512, r, 0, Math.PI * 2); pg.stroke();
  }
  pg.strokeStyle = 'rgba(20,24,30,0.35)'; pg.lineWidth = 3;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    pg.beginPath(); pg.moveTo(512 + 80 * Math.cos(a), 512 + 80 * Math.sin(a));
    pg.quadraticCurveTo(512 + 300 * Math.cos(a + 0.12), 512 + 300 * Math.sin(a + 0.12), 512 + 510 * Math.cos(a + 0.2), 512 + 510 * Math.sin(a + 0.2));
    pg.stroke();
  }
  pg.strokeStyle = 'rgba(100,210,255,0.55)'; pg.lineWidth = 2;            // the track being written
  pg.beginPath(); pg.arc(512, 512, (S.z / R) * 512, 0, Math.PI * 2); pg.stroke();
  const platTex = new THREE.CanvasTexture(pc);
  platTex.colorSpace = THREE.SRGBColorSpace; platTex.anisotropy = 8;
  textures.push(platTex);
  const platTop = new THREE.MeshStandardMaterial({ map: platTex, metalness: 0.95, roughness: 0.22 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 1, roughness: 0.18 });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x24272d, metalness: 0.5, roughness: 0.5 });
  const blackM = new THREE.MeshStandardMaterial({ color: 0x0f1013, metalness: 0.3, roughness: 0.6 });
  const alu = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.9, roughness: 0.32 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xd2d6dc, metalness: 1, roughness: 0.25 });
  const goldM = new THREE.MeshStandardMaterial({ color: COLORS.gold, metalness: 1, roughness: 0.28 });
  const coilM = new THREE.MeshStandardMaterial({ color: C.copper, metalness: 0.9, roughness: 0.35, emissive: C.copper, emissiveIntensity: 0.1 });
  const rimLine = new THREE.MeshBasicMaterial({ color: C.rim, toneMapped: false, transparent: true, opacity: 0.6 });

  const platter = new THREE.Group(); macro.add(platter);
  platter.add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, 0.06, 160), [chrome, platTop, darkM]));
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.16, 48), chrome); hub.position.y = 0.11; platter.add(hub);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), blackM);
    sc.position.set(0.38 * Math.cos(a), 0.2, 0.38 * Math.sin(a)); platter.add(sc);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.012, 8, 64), rimLine); ring.rotation.x = Math.PI / 2; ring.position.y = 0.19; platter.add(ring);
  // base casting with a glowing rim
  const base = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.2, 7.4), blackM); base.position.set(-0.9, -0.2, 0.3); macro.add(base);
  for (const [x, z, w, d] of [[-0.9, -3.4, 9.6, 0.02], [-0.9, 4.0, 9.6, 0.02], [-5.7, 0.3, 0.02, 7.4], [3.9, 0.3, 0.02, 7.4]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.012, d), rimLine); m.position.set(x, -0.095, z); macro.add(m);
  }
  // actuator: pivot, E-block, arm, VCM coil, load beam, slider
  const P = v3(-4.5, 0.1, 2.6);
  const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.4, 40), alu); pivot.position.copy(P); macro.add(pivot);
  const pivCap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 32), chrome); pivCap.position.copy(P).add(v3(0, 0.23, 0)); macro.add(pivCap);
  const vcm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.12, 1.3), darkM); vcm.position.set(P.x - 0.9, 0.06, P.z); macro.add(vcm);
  const coil = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 10, 40), coilM); coil.rotation.x = Math.PI / 2; coil.scale.set(1, 1.3, 1); coil.position.set(P.x - 0.85, 0.16, P.z); macro.add(coil);
  const armShape = new THREE.Shape();
  armShape.moveTo(0, -0.34); armShape.lineTo(2.9, -0.12); armShape.lineTo(2.9, 0.12); armShape.lineTo(0, 0.34); armShape.closePath();
  const armHole = new THREE.Path(); armHole.absellipse(1.3, 0, 0.45, 0.1, 0, Math.PI * 2, true); armShape.holes.push(armHole);
  const armGeo = new THREE.ExtrudeGeometry(armShape, { depth: 0.07, bevelEnabled: true, bevelSize: 0.01, bevelThickness: 0.01, bevelSegments: 2 });
  armGeo.rotateX(Math.PI / 2);
  const arm = new THREE.Mesh(armGeo, alu); arm.position.set(P.x, 0.2, P.z); macro.add(arm);
  arm.rotation.y = -Math.atan2(S.z - P.z, S.x - P.x);
  const armEnd = v3(P.x + 2.9 * Math.cos(arm.rotation.y), 0.16, P.z - 2.9 * Math.sin(arm.rotation.y));
  // load beam (thin triangular steel) from arm tip to the slider
  const lb = new THREE.Shape();
  const lbLen = Math.hypot(S.x - armEnd.x, S.z - armEnd.z) + 0.05;
  lb.moveTo(0, -0.11); lb.lineTo(lbLen, -0.035); lb.lineTo(lbLen, 0.035); lb.lineTo(0, 0.11); lb.closePath();
  const lbGeo = new THREE.ExtrudeGeometry(lb, { depth: 0.012, bevelEnabled: false }); lbGeo.rotateX(Math.PI / 2);
  const loadBeam = new THREE.Mesh(lbGeo, steel);
  loadBeam.position.set(armEnd.x, 0.14, armEnd.z);
  loadBeam.rotation.set(0, -Math.atan2(S.z - armEnd.z, S.x - armEnd.x), -Math.atan2(0.1, lbLen));
  macro.add(loadBeam);
  const flexLine = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.008, 0.05), new THREE.MeshStandardMaterial({ color: 0xd98a2b, metalness: 0.4, roughness: 0.5 }));
  flexLine.position.set(P.x + 1.45, 0.285, P.z + 0.18); macro.add(flexLine);
  // slider (trailing edge at +x) with the laser diode on its back and bond pads on the trailing face
  const slider = new THREE.Group(); slider.position.copy(S); macro.add(slider);
  const sBody = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.07, 0.24), new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.35, roughness: 0.45 }));
  sBody.position.y = 0.045; slider.add(sBody);
  const sCoat = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.07, 0.24), new THREE.MeshStandardMaterial({ color: C.insulator, metalness: 0.1, roughness: 0.2, transparent: true, opacity: 0.55 }));
  sCoat.position.set(0.165, 0.045, 0); slider.add(sCoat);
  const padM = new THREE.MeshStandardMaterial({ color: COLORS.gold, metalness: 0.6, roughness: 0.3, emissive: COLORS.gold, emissiveIntensity: 0.5 });
  for (let i = 0; i < 4; i++) { const pd = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.02, 0.03), padM); pd.position.set(0.182, 0.05, -0.08 + i * 0.053); slider.add(pd); }
  const diode = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.05), darkM); diode.position.set(0.12, 0.115, 0); slider.add(diode);
  const diodeGlowM = makeGlowSprite(C.laser, { size: 0.12, opacity: 0.9 }); diodeGlowM.position.set(0.12, 0.09, 0.03); slider.add(diodeGlowM);
  const nftGlowM = makeGlowSprite(C.nftHot, { size: 0.08, opacity: 0.0 }); nftGlowM.position.set(0.17, 0.012, 0); slider.add(nftGlowM);
  const gimbal = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 0.1), steel); gimbal.position.set(-0.02, 0.09, 0); slider.add(gimbal);
  label(macro, 'spinning disk', v3(-1.6, 0.25, 1.2), { group: 'macro', size: 0.03 });
  label(macro, 'slider', v3(0.05, 0.32, 2.25), { group: 'macro', size: 0.03 });
  label(macro, 'arm', v3(-3.2, 0.5, 2.6), { group: 'macro', size: 0.03 });

  // ================================================================ HEAD WORLD
  const head = new THREE.Scene();
  head.fog = new THREE.Fog(0x000000, 10, 20);
  lights(head);
  const headMats = [];
  const hm = (mat) => { mat.transparent = true; mat.userData.baseOp = mat.opacity; headMats.push(mat); return mat; };
  function hbox(x0, x1, y0, y1, z0, z1, mat, parent = head) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), mat);
    m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    parent.add(m);
    return m;
  }
  const edgeMat = hm(new THREE.LineBasicMaterial({ color: C.rim, transparent: true, opacity: 0.35 }));
  function edges(mesh) {
    const l = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edgeMat);
    l.position.copy(mesh.position); mesh.parent.add(l); return l;
  }
  const ZB = -1.4;                                         // back of the cut-away (cut plane at z = 0)
  // slider body (AlTiC) and the alumina overcoat that holds the head
  const altic = hm(new THREE.MeshStandardMaterial({ color: 0x2c2f36, metalness: 0.4, roughness: 0.5 }));
  edges(hbox(-3.4, -0.45, HA, TOP, ZB, 0, altic));
  const alumina = hm(new THREE.MeshPhysicalMaterial({ color: C.insulator, metalness: 0, roughness: 0.15, opacity: 0.16, depthWrite: false, clearcoat: 1, envMapIntensity: 1.6 }));
  const coat = hbox(-0.45, 1.35, HA, TOP, ZB, -0.004, alumina); coat.renderOrder = 3; edges(coat);
  // glowing air-bearing-surface line along the cut
  const absGlowMat = hm(new THREE.MeshBasicMaterial({ color: C.rim, toneMapped: false, opacity: 0.8 }));
  hbox(-3.4, 1.35, HA - 0.004, HA + 0.004, -0.004, 0.004, absGlowMat);
  // laser diode on its submount on the slider back, emitting down into the waveguide
  const subM = hm(new THREE.MeshStandardMaterial({ color: 0x5a5f69, metalness: 0.6, roughness: 0.4 }));
  edges(hbox(-0.8, -0.27, TOP, TOP + 0.75, -0.5, 0, subM));
  const diodeM = hm(new THREE.MeshStandardMaterial({ color: 0x1d2027, metalness: 0.5, roughness: 0.35 }));
  edges(hbox(-0.27, 0.01, TOP, TOP + 0.62, -0.32, 0, diodeM));
  const stripeM = hm(new THREE.MeshBasicMaterial({ color: C.laser, toneMapped: false, opacity: 0.9 }));
  hbox(-0.145, -0.115, TOP + 0.02, TOP + 0.6, -0.002, 0.004, stripeM);
  const ledMats = [0, 1, 2].map(() => hm(new THREE.MeshBasicMaterial({ color: 0x30d158, toneMapped: false })));
  ledMats.forEach((m, i) => hbox(-0.72 + i * 0.09, -0.66 + i * 0.09, TOP + 0.66, TOP + 0.69, -0.002, 0.006, m));
  const diodeGlow = makeGlowSprite(C.laser, { size: 0.5 }); diodeGlow.position.set(-0.13, TOP + 0.02, 0.02); head.add(diodeGlow);
  // waveguide: cladding + core running down to the NFT
  const coreX = -0.13, CORE_BOT = HA + 0.25;
  const cladM = hm(new THREE.MeshStandardMaterial({ color: 0x9fb7d6, metalness: 0, roughness: 0.2, opacity: 0.25, depthWrite: false }));
  hbox(coreX - 0.11, coreX + 0.11, CORE_BOT - 0.05, TOP, -0.3, -0.002, cladM);
  const coreM = hm(new THREE.MeshBasicMaterial({ color: C.laser, toneMapped: false, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false }));
  hbox(coreX - 0.045, coreX + 0.045, CORE_BOT, TOP, -0.12, 0.002, coreM);
  // NFT: gold "lollipop" disk with a peg reaching down to the air-bearing surface
  const nftM = hm(new THREE.MeshStandardMaterial({ color: COLORS.gold, metalness: 1, roughness: 0.25, emissive: C.nftHot, emissiveIntensity: 0 }));
  // half disk (cut at z = 0): the θ∈[0,π] half (local x ≥ 0) maps to −z, the cylinder axis to x
  const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 48, 1, false, 0, Math.PI), nftM);
  disk.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(v3(0, 0, -1), v3(1, 0, 0), v3(0, -1, 0)));
  disk.position.set(0, HA + 0.42, 0); head.add(disk);
  const peg = hbox(-0.03, 0.03, HA, HA + 0.26, -0.06, 0, nftM);
  const pegGlow = makeGlowSprite(C.nftHot, { size: 0.3, opacity: 0 }); pegGlow.position.set(0, HA - 0.01, 0.04); head.add(pegGlow);
  const nearField = makeGlowSprite(0xffffff, { size: 0.12, opacity: 0 }); nearField.position.set(0, HA * 0.5, 0.02); head.add(nearField);
  const spotLight = new THREE.PointLight(0xffd59a, 0, 2.2, 1.6); spotLight.position.set(0.02, HA * 0.6, 0.15); head.add(spotLight);
  // write pole + yoke + return pole, extruded from a cross-section profile (cut at z = 0)
  const poleShape = new THREE.Shape();
  [[0.22, HA], [0.2, HA + 0.62], [0.2, 1.72], [1.25, 1.72], [1.25, HA], [1.02, HA], [1.02, 1.5], [0.48, 1.5], [0.48, HA + 0.62], [0.38, HA + 0.2], [0.38, HA]]
    .forEach(([x, y], i) => (i ? poleShape.lineTo(x, y) : poleShape.moveTo(x, y)));
  poleShape.closePath();
  const poleGeo = new THREE.ExtrudeGeometry(poleShape, { depth: 0.55, bevelEnabled: false }); poleGeo.translate(0, 0, -0.55);
  const poleM = hm(new THREE.MeshStandardMaterial({ color: 0x9aa3b2, metalness: 0.85, roughness: 0.3, emissive: C.up, emissiveIntensity: 0 }));
  const pole = new THREE.Mesh(poleGeo, poleM); head.add(pole);
  const poleEdge = new THREE.LineSegments(new THREE.EdgesGeometry(poleGeo, 30), edgeMat); head.add(poleEdge);
  // coil turns between main pole and return pole (cross-sections light up with the write current)
  const coilTurnMats = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
    const m = hm(new THREE.MeshStandardMaterial({ color: C.copper, metalness: 0.8, roughness: 0.3, emissive: C.copper, emissiveIntensity: 0.15 }));
    coilTurnMats.push(m);
    hbox(0.6 + j * 0.2, 0.74 + j * 0.2, HA + 0.45 + i * 0.28, HA + 0.6 + i * 0.28, -0.4, 0, m);
  }
  const poleGlow = makeGlowSprite(C.up, { size: 0.32, opacity: 0 }); poleGlow.position.set(0.3, HA * 0.55, 0.03); head.add(poleGlow);

  // light pulses running down the waveguide
  const pulses = [];
  for (let i = 0; i < 6; i++) { const s = makeGlowSprite(C.laser, { size: 0.26, opacity: 0 }); s.position.set(coreX, 0, 0.01); head.add(s); pulses.push(s); }
  const PULSE_TOP = TOP + 0.02, PULSE_BOT = HA + 0.36, PULSE_GAP = 0.42, PULSE_SPEED = 1.3;
  const pulseSpan = PULSE_TOP - PULSE_BOT;

  // ---------------------------------------------------------------- medium: layers + instanced grains
  const medium = new THREE.Group(); head.add(medium);
  const layerBox = (y0, y1, mat) => { const m = hbox(X0, X0 + LEN, y0, y1, -WID / 2 - 0.05, WID / 2 + 0.05, mat, medium); return m; };
  layerBox(-GH - 0.03, -GH, new THREE.MeshStandardMaterial({ color: 0x40454f, metalness: 0.3, roughness: 0.5 }));                  // seed / interlayer
  layerBox(-GH - 0.15, -GH - 0.03, new THREE.MeshStandardMaterial({ color: C.copper, metalness: 0.9, roughness: 0.35 }));         // heat sink
  layerBox(-GH - 0.7, -GH - 0.15, new THREE.MeshStandardMaterial({ color: C.substrate, metalness: 0.2, roughness: 0.6 }));        // substrate
  // heat flowing down into the heat sink under the spot
  const sinkGlowMat = new THREE.MeshBasicMaterial({ map: getGlowTexture(), color: 0xed6925, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const sinkGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sinkGlowMat);
  sinkGlow.position.set(XH + 0.1, -GH - 0.09, WID / 2 + 0.056); sinkGlow.scale.set(1.2, 0.35, 1); medium.add(sinkGlow);
  const spotGlowMat = new THREE.MeshBasicMaterial({ map: getGlowTexture(), color: 0xfbb61a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const spotGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), spotGlowMat);
  spotGlow.rotation.x = -Math.PI / 2; spotGlow.position.set(XH + 0.04, 0.004, 0); spotGlow.scale.set(SX_DN * 4.2, SZ * 4.2, 1); spotGlow.renderOrder = 4; medium.add(spotGlow);

  // grain layout: hex packing, rows along x
  const rowsZ = Math.floor(WID / (PITCH * 0.866));
  const cols = Math.floor(LEN / PITCH);
  const N = rowsZ * cols;
  const gU = new Float32Array(N), gZ = new Float32Array(N), gR = new Float32Array(N);
  {
    let k = 0, seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let r = 0; r < rowsZ; r++) for (let c = 0; c < cols; c++) {
      gU[k] = X0 + (c + (r % 2) * 0.5) * PITCH + (rnd() - 0.5) * 0.02;
      gZ[k] = -WID / 2 + (r + 0.5) * PITCH * 0.866 + (rnd() - 0.5) * 0.02;
      gR[k] = 0.8 + 0.16 * rnd();
      k++;
    }
  }
  const grainGeo = new THREE.CylinderGeometry(PITCH / Math.sqrt(3), PITCH / Math.sqrt(3) * 1.04, GH, 6, 1);
  grainGeo.translate(0, -GH / 2, 0);                                  // top at y = 0
  const heatAttr = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  heatAttr.setUsage(THREE.DynamicDrawUsage);
  grainGeo.setAttribute('aHeat', heatAttr);
  const grainMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.5, flatShading: true, envMapIntensity: 0.7 });
  grainMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHeat;\nvarying float vHeat;\nvarying float vLY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat;\nvLY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHeat;\nvarying float vLY;\n' + GLSL_INFERNO)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float topW = smoothstep(-0.1, 0.0, vLY);
        diffuseColor.rgb *= 1.0 - 0.75 * smoothstep(0.05, 0.4, vHeat) * topW;
        totalEmissiveRadiance += heatMap(vHeat) * smoothstep(0.02, 0.3, vHeat) * (0.5 + 2.2 * topW);
        totalEmissiveRadiance += vColor * 0.18 * topW;`);
  };
  const grains = new THREE.InstancedMesh(grainGeo, grainMat, N);
  grains.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  grains.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  grains.instanceColor.setUsage(THREE.DynamicDrawUsage);
  grains.frustumCulled = false;
  medium.add(grains);
  // magnetization arrows (one per grain), centred above the grain top
  const ARROW_L = 0.19, ARROW_Y = 0.13;
  const aShaft = new THREE.CylinderGeometry(0.012, 0.012, 0.68, 6); aShaft.translate(0, -0.16, 0);
  const aHead = new THREE.ConeGeometry(0.034, 0.32, 8); aHead.translate(0, 0.34, 0);
  const arrowGeo = mergeGeometries([aShaft, aHead]);
  aShaft.dispose(); aHead.dispose();
  const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.4 });
  arrowMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor * 0.75;');
  };
  // arrows only on the track being written (plus a grain of margin): the tops' tint carries the neighbours
  const arrIdx = [];
  for (let i = 0; i < N; i++) if (Math.abs(gZ[i]) < ZR + 0.06) arrIdx.push(i);
  const arrSlot = new Int32Array(N).fill(-1);
  arrIdx.forEach((g, k) => { arrSlot[g] = k; });
  const arrows = new THREE.InstancedMesh(arrowGeo, arrowMat, arrIdx.length);
  arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  arrows.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(arrIdx.length * 3), 3);
  arrows.instanceColor.setUsage(THREE.DynamicDrawUsage);
  arrows.frustumCulled = false;
  medium.add(arrows);

  const cUp = new THREE.Color(C.up), cDown = new THREE.Color(C.down), cSteel = new THREE.Color(C.fept).multiplyScalar(0.45);
  const tmpC = new THREE.Color();
  // write intervals (sim-time windows when the laser heated above Tc), so the track only holds what was really written
  let intervals = [];
  function updateMedium(time, heatAmp, p) {
    const gm = grains.instanceMatrix.array, am = arrows.instanceMatrix.array;
    const gc = grains.instanceColor.array, ac = arrows.instanceColor.array, ha = heatAttr.array;
    // when the reader scrolls on quickly, extend the latest interval back so the pull-back shows a full track
    const fill = remap(p, 0.55, 0.85) * (LEN / VEL);
    for (let i = 0; i < N; i++) {
      const s = gU[i] - X0 + VEL * time;
      const wraps = Math.floor(s / LEN);
      const x = X0 + (s - wraps * LEN);
      const z = gZ[i];
      const d = x - VEL * time;                           // fixed disk coordinate of this grain
      const dx = x - XH, sx = sxAt(x);
      const h = heatAmp * Math.exp(-(dx * dx) / (2 * sx * sx) - (z * z) / (2 * SZ * SZ));
      // magnetization: old data unless this grain cooled through Tc under the pole during a write interval
      const band = Math.round(z / BAND), zb = z - band * BAND;
      let m = hsign(band * 977 + Math.floor((d - 0.5 * zb * zb) / BIT));
      if (intervals.length && Math.abs(z) < ZR) {
        const zr = ZR;
        const xf = XH + SX_DN * Math.sqrt(Math.max(0, 2 * Math.log(1 / THETA) * (1 - (z * z) / (zr * zr))));
        if (x > xf) {
          const tc = time - (x - xf) / VEL;
          let hit = false;
          for (let k = 0; k < intervals.length; k++) {
            const iv = intervals[k];
            const a = k === intervals.length - 1 && iv.b === Infinity ? Math.min(iv.a, time - fill) : iv.a;
            if (tc >= a && tc <= iv.b) { hit = true; break; }
          }
          if (hit) m = hsign(Math.floor(tc / TBIT) + 5000);
        }
      }
      const amp = h >= THETA ? 0 : Math.pow(1 - h / THETA, 0.35);
      const edge = smoothstep(X0, X0 + 0.5, x) * smoothstep(X0 + LEN, X0 + LEN - 0.5, x);
      const r = gR[i] * edge;
      let o = i * 16;
      gm[o] = r; gm[o + 1] = 0; gm[o + 2] = 0; gm[o + 3] = 0;
      gm[o + 4] = 0; gm[o + 5] = 1; gm[o + 6] = 0; gm[o + 7] = 0;
      gm[o + 8] = 0; gm[o + 9] = 0; gm[o + 10] = r; gm[o + 11] = 0;
      gm[o + 12] = x; gm[o + 13] = 0; gm[o + 14] = z; gm[o + 15] = 1;
      ha[i] = h;
      const mc = m > 0 ? cUp : cDown;
      const onTrack = Math.abs(z) < ZR;
      tmpC.copy(cSteel).lerp(mc, (onTrack ? 0.55 : 0.13) * amp);
      gc[i * 3] = tmpC.r; gc[i * 3 + 1] = tmpC.g; gc[i * 3 + 2] = tmpC.b;
      const k = arrSlot[i];
      if (k < 0) continue;
      const L = ARROW_L * amp * edge, w = edge * Math.min(1, amp * 2.5);
      o = k * 16;
      am[o] = w; am[o + 1] = 0; am[o + 2] = 0; am[o + 3] = 0;
      am[o + 4] = 0; am[o + 5] = m * L; am[o + 6] = 0; am[o + 7] = 0;
      am[o + 8] = 0; am[o + 9] = 0; am[o + 10] = m * w; am[o + 11] = 0;
      am[o + 12] = x; am[o + 13] = ARROW_Y; am[o + 14] = z; am[o + 15] = 1;
      o = k * 3;
      ac[o] = mc.r; ac[o + 1] = mc.g; ac[o + 2] = mc.b;
    }
    grains.instanceMatrix.needsUpdate = true; arrows.instanceMatrix.needsUpdate = true;
    grains.instanceColor.needsUpdate = true; arrows.instanceColor.needsUpdate = true;
    heatAttr.needsUpdate = true;
  }

  // ---------------------------------------------------------------- thermal profile (stage 4)
  const plot = new THREE.Group(); head.add(plot);
  const YB = HA + 0.55, HC = 1.45, PX0 = -1.7, PX1 = 4.6;
  const prof = (x) => Math.exp(-((x - XH) ** 2) / (2 * sxAt(x) ** 2));
  const curvePts = [];
  for (let i = 0; i <= 260; i++) { const x = lerp(PX0, PX1, i / 260); curvePts.push(v3(x, YB + HC * prof(x), 0.02)); }
  const curve = new THREE.CatmullRomCurve3(curvePts);
  const TUBE_SEG = 400, TUBE_RAD = 8;
  const tubeGeo = new THREE.TubeGeometry(curve, TUBE_SEG, 0.02, TUBE_RAD, false);
  {
    const pos = tubeGeo.attributes.position, col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { heatColor(0.15 + 0.85 * (pos.getY(i) - YB) / HC, tmpC); col[i * 3] = tmpC.r; col[i * 3 + 1] = tmpC.g; col[i * 3 + 2] = tmpC.b; }
    tubeGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const plotMats = [];
  const pm = (mat) => { mat.transparent = true; mat.depthTest = false; mat.depthWrite = false; mat.userData.baseOp = mat.opacity; plotMats.push(mat); return mat; };
  const tube = new THREE.Mesh(tubeGeo, pm(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false })));
  tube.renderOrder = 20; plot.add(tube);
  // translucent fill under the curve
  {
    const n = 200, pos = new Float32Array((n + 1) * 2 * 3), col = new Float32Array((n + 1) * 2 * 4), idx = [];
    for (let i = 0; i <= n; i++) {
      const x = lerp(PX0, PX1, i / n), t = prof(x);
      pos.set([x, YB, 0.01, x, YB + HC * t, 0.01], i * 6);
      heatColor(0.15 + 0.85 * t, tmpC);
      col.set([tmpC.r, tmpC.g, tmpC.b, 0.0, tmpC.r, tmpC.g, tmpC.b, 0.35], i * 8);
      if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4));
    g.setIndex(idx);
    const fill = new THREE.Mesh(g, pm(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })));
    fill.renderOrder = 19; plot.add(fill);
  }
  const axisM = pm(new THREE.LineBasicMaterial({ color: 0x8e8e93, opacity: 0.8 }));
  const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([v3(PX0, YB, 0.01), v3(PX1 + 0.15, YB, 0.01)]), axisM);
  axis.renderOrder = 18; plot.add(axis);
  const yAxis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([v3(PX0, YB, 0.01), v3(PX0, YB + HC + 0.2, 0.01)]), axisM);
  yAxis.renderOrder = 18; plot.add(yAxis);
  const YTC = YB + HC * THETA;
  const tcLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([v3(PX0, YTC, 0.015), v3(PX1, YTC, 0.015)]),
    pm(new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.08, gapSize: 0.06, opacity: 0.85 })));
  tcLine.computeLineDistances(); tcLine.renderOrder = 21; plot.add(tcLine);
  const XF0 = XH + SX_DN * Math.sqrt(2 * Math.log(1 / THETA));
  const drop = new THREE.Line(new THREE.BufferGeometry().setFromPoints([v3(XF0, YTC, 0.03), v3(XF0, 0.02, 0.03)]),
    pm(new THREE.LineDashedMaterial({ color: 0xfcffa4, dashSize: 0.05, gapSize: 0.05, opacity: 0.9 })));
  drop.computeLineDistances(); drop.renderOrder = 21; plot.add(drop);
  const freezeDot = makeGlowSprite(0xfcffa4, { size: 0.3, depthTest: false }); freezeDot.position.set(XF0, YTC, 0.03); freezeDot.renderOrder = 22; plot.add(freezeDot);
  plotMats.push(freezeDot.material); freezeDot.material.userData.baseOp = 1;
  const plotLabels = [
    label(plot, 'Tc', v3(PX1 + 0.25, YTC, 0.02), { group: 'plot', color: '#ffffff' }),
    label(plot, 'T', v3(PX0, YB + HC + 0.35, 0.02), { group: 'plot', color: '#fbb61a' }),
    label(plot, 'down-track →', v3(PX1 - 0.55, YB + 0.17, 0.02), { group: 'plot', color: '#8e8e93', size: 0.026 }),
    label(plot, 'bit freezes', v3(XF0 + 0.75, YTC + 0.32, 0.03), { group: 'plot', color: '#fcffa4', size: 0.026 }),
  ];
  plotLabels.forEach((s) => s.renderOrder = 30);

  // head-world labels
  label(head, 'laser diode', v3(-0.55, TOP + 1.0, 0.05), { group: 'cut' });
  label(head, 'waveguide', v3(-0.75, 1.35, 0.05), { group: 'cut' });
  label(head, 'NFT', v3(-0.38, HA + 0.42, 0.1), { group: 'nft', color: '#e8c766' });
  label(head, 'write pole', v3(0.82, HA + 0.12, 0.2), { group: 'nft' });
  label(head, 'FePt grains', v3(-1.1, -0.05, WID / 2 + 0.25), { group: 'grain' });
  label(head, 'T > Tc', v3(XH - 0.1, 0.06, 0.62), { group: 'grain', color: '#fbb61a' });
  label(head, 'heat sink', v3(1.9, -GH - 0.09, WID / 2 + 0.3), { group: 'grain', color: '#c08a5a', size: 0.024 });

  // ---------------------------------------------------------------- veil (fade through black between worlds)
  const veilMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), veilMat);
  veil.position.z = -0.1; veil.renderOrder = 999; veil.frustumCulled = false;
  camera.add(veil);

  // ---------------------------------------------------------------- camera storyboard
  const MKEYS = [
    { p: 0.0, t: v3(-0.9, -0.1, 0.9), r: 11.5, yaw: 0.55, pitch: 0.66 },
    { p: 0.09, t: v3(-0.4, 0.0, 1.6), r: 6.0, yaw: 0.75, pitch: 0.45 },
    { p: 0.21, t: v3(0.15, 0.07, 2.25), r: 0.75, yaw: 1.05, pitch: 0.22 },
  ];
  const HKEYS = [
    { p: 0.21, t: v3(-0.35, 1.25, 0), r: 8.4, yaw: 0.32, pitch: 0.16 },
    { p: 0.32, t: v3(-0.2, 1.3, 0), r: 7.4, yaw: 0.22, pitch: 0.12 },
    { p: 0.44, t: v3(0.05, 0.55, 0), r: 4.0, yaw: 0.3, pitch: 0.16 },
    { p: 0.53, t: v3(0.25, 0.15, 0.3), r: 3.5, yaw: 0.5, pitch: 0.3 },
    { p: 0.72, t: v3(0.55, 0.1, 0.25), r: 3.9, yaw: 0.66, pitch: 0.36 },
    { p: 0.87, t: v3(1.15, 0.75, 0), r: 8.6, yaw: 0.38, pitch: 0.36 },
    { p: 1.0, t: v3(1.25, 0.75, 0), r: 9.0, yaw: 0.34, pitch: 0.34 },
  ];
  const view = { t: v3(0, 0, 0), r: 1, yaw: 0, pitch: 0 };
  function viewAt(keys, p) {
    let i = 1;
    while (i < keys.length - 1 && keys[i].p < p) i++;
    const k0 = keys[i - 1], k1 = keys[i];
    const u = easeInOut(clamp((p - k0.p) / ((k1.p - k0.p) || 1)));
    view.t.lerpVectors(k0.t, k1.t, u);
    view.r = Math.exp(lerp(Math.log(k0.r), Math.log(k1.r), u));
    view.yaw = lerp(k0.yaw, k1.yaw, u);
    view.pitch = lerp(k0.pitch, k1.pitch, u);
    return view;
  }

  // drag to rotate (offset on top of the scripted view)
  let dragYaw = 0, dragPitch = 0, rMult = 1;
  let dragging = false, lastX = 0, lastY = 0, idleSince = 0, time = reducedMotion ? 9.4 : 3.0;
  let progT = 0, prog = 0;
  const onDown = (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture?.(e.pointerId); canvas.classList.add('is-grabbing'); };
  const onMove = (e) => {
    if (!dragging) return;
    dragYaw = clamp(dragYaw - (e.clientX - lastX) * 0.006, -1.0, 1.0);
    dragPitch = clamp(dragPitch + (e.clientY - lastY) * 0.004, -0.3, 0.5);
    lastX = e.clientX; lastY = e.clientY; idleSince = time;
    if (!loop.running) renderOnce();
  };
  const onUp = () => { dragging = false; idleSince = time; canvas.classList.remove('is-grabbing'); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  const yawCur = { v: 0 }, pitchCur = { v: 0 };
  function placeCamera(keys, dt) {
    const sway = reducedMotion ? 0 : 0.08 * Math.sin((time - idleSince) * 0.13) * clamp((time - idleSince - 1.5) / 3);
    const k = dt ? damp(8, dt) : 1;
    yawCur.v += (dragYaw + (dragging ? 0 : sway) - yawCur.v) * k;
    pitchCur.v += (dragPitch - pitchCur.v) * k;
    const vw = viewAt(keys, prog);
    const r = vw.r * rMult, yaw = vw.yaw + yawCur.v, pitch = clamp(vw.pitch + pitchCur.v, -0.05, 1.3);
    camera.position.set(vw.t.x + r * Math.sin(yaw) * Math.cos(pitch), vw.t.y + r * Math.sin(pitch), vw.t.z + r * Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(vw.t);
  }
  const _wp = new THREE.Vector3();
  function sizeLabels(alphaOf) {
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    for (const s of labels) {
      const a = alphaOf(s.userData.group);
      s.material.opacity = a;
      s.visible = a > 0.01;
      if (!s.visible) continue;
      s.getWorldPosition(_wp);
      const hgt = s.userData.size * (small ? 1.35 : 1) * camera.position.distanceTo(_wp) * tanH * 2;
      s.scale.set(hgt * s.userData.aspect, hgt, 1);
    }
  }

  // ---------------------------------------------------------------- render
  let width = 1, height = 1, small = false;
  function render(_t, dt) {
    if (!reducedMotion) time += dt;
    prog = reducedMotion || !dt ? progT : prog + (progT - prog) * damp(6, dt);
    const p = prog;
    const black = smoothstep(0.155, 0.205, p) * (1 - smoothstep(0.215, 0.265, p));
    veilMat.opacity = black;
    const inHead = p >= 0.21;
    if (!inHead) {
      if (intervals.length) intervals = [];
      platter.rotation.y = time * 1.1;
      const lit = smoothstep(0.1, 0.18, p);
      diodeGlowM.material.opacity = 0.4 + 0.5 * lit;
      nftGlowM.material.opacity = lit * (0.6 + 0.3 * Math.sin(time * 6));
      coilM.emissiveIntensity = 0.1 + 0.25 * (0.5 + 0.5 * Math.sin(time * 3));
      macro.add(camera);
      placeCamera(MKEYS, dt);
      const aMacro = 1 - smoothstep(0.06, 0.12, p);
      sizeLabels((g) => (g === 'macro' ? aMacro : 0));
      renderer.render(macro, camera);
      return;
    }
    // ---- head world
    const light = smoothstep(0.24, 0.34, p);                 // laser on, light in the waveguide
    const nftOn = smoothstep(0.3, 0.42, p);                  // NFT tip glows, light spot forms
    const heatAmp = smoothstep(0.38, 0.5, p);                // hot spot in the medium
    const ghost = smoothstep(0.75, 0.86, p);                 // head fades to a ghost for the pull-back
    const plotOn = smoothstep(0.8, 0.92, p);
    const flick = reducedMotion ? 1 : 0.9 + 0.1 * Math.sin(time * 13.0) * Math.sin(time * 7.3);

    // write intervals
    if (reducedMotion) intervals = heatAmp > THETA + 0.02 ? [{ a: -Infinity, b: Infinity }] : [];
    else {
      const last = intervals[intervals.length - 1];
      const on = heatAmp > THETA + 0.02;
      if (on && (!last || last.b !== Infinity)) { intervals.push({ a: time, b: Infinity }); if (intervals.length > 4) intervals.shift(); }
      if (!on && last && last.b === Infinity) last.b = time;
    }
    updateMedium(time, heatAmp, p);

    // laser + waveguide pulses
    diodeGlow.material.opacity = 0.25 + 0.75 * light * flick;
    diodeGlow.scale.setScalar(0.35 + 0.25 * light);
    stripeM.userData.baseOp = 0.3 + 0.7 * light;
    coreM.userData.baseOp = 0.08 + 0.32 * light;
    const off = ((reducedMotion ? 0.5 : time) * PULSE_SPEED) % PULSE_GAP;
    pulses.forEach((s, i) => {
      const dd = off + i * PULSE_GAP;
      s.visible = dd <= pulseSpan && light > 0.01;
      if (!s.visible) return;
      s.position.y = PULSE_TOP - dd;
      s.material.opacity = light * clamp(dd / 0.15) * clamp((pulseSpan - dd) / 0.25) * (1 - 0.6 * ghost);
    });
    // NFT
    nftM.emissiveIntensity = nftOn * 0.55 * flick;
    pegGlow.material.opacity = nftOn * 0.95 * flick * (1 - 0.5 * ghost);
    pegGlow.scale.setScalar(0.18 + 0.2 * nftOn);
    nearField.material.opacity = nftOn * flick;
    nearField.scale.setScalar(0.08 + 0.1 * nftOn);
    spotLight.intensity = nftOn * 0.9 * flick;
    spotGlowMat.opacity = 0.15 * nftOn + 0.28 * heatAmp * flick;
    sinkGlowMat.opacity = 0.7 * heatAmp;
    // write pole: field direction follows the current bit; coil turns light up with it
    const bitNow = hsign(Math.floor(time / TBIT) + 5000);
    const poleOn = smoothstep(0.42, 0.5, p);
    const bitC = bitNow > 0 ? cUp : cDown;
    poleM.emissive.copy(bitC); poleM.emissiveIntensity = 0.07 * poleOn;
    poleGlow.material.color.copy(bitC); poleGlow.material.opacity = 0.75 * poleOn * (1 - 0.5 * ghost);
    coilTurnMats.forEach((m, i) => { m.emissive.copy(poleOn > 0.01 ? bitC : tmpC.setHex(C.copper)); m.emissiveIntensity = 0.12 + 0.3 * poleOn * ((i % 2) ? 1 : 0.7); });
    ledMats.forEach((m, i) => m.color.setHex(light > 0.5 && Math.floor(time * 3) % 3 === i ? 0x30d158 : 0x0f3d1c));
    absGlowMat.userData.baseOp = 0.55 + (reducedMotion ? 0 : 0.25 * Math.sin(time * 2.2));
    // head ghosting for the pull-back
    for (const m of headMats) m.opacity = m.userData.baseOp * lerp(1, m === alumina ? 0.5 : 0.22, ghost);
    plot.visible = plotOn > 0.001;
    for (const m of plotMats) m.opacity = m.userData.baseOp * plotOn;
    tube.geometry.setDrawRange(0, Math.ceil(TUBE_SEG * clamp(remap(p, 0.8, 0.95))) * TUBE_RAD * 6);

    head.add(camera);
    placeCamera(HKEYS, dt);
    const aCut = smoothstep(0.24, 0.3, p) * (1 - smoothstep(0.42, 0.47, p));
    const aNft = smoothstep(0.36, 0.42, p) * (1 - smoothstep(0.66, 0.72, p));
    const aGrain = smoothstep(0.5, 0.56, p) * (1 - smoothstep(0.7, 0.76, p));
    sizeLabels((g) => (g === 'cut' ? aCut : g === 'nft' ? aNft : g === 'grain' ? aGrain : g === 'plot' ? plotOn : 0));
    renderer.render(head, camera);
  }
  const loop = createLoop(render);
  const renderOnce = () => render(0, 0);

  function resize() {
    width = canvas.clientWidth || 1; height = canvas.clientHeight || 1;
    const aspect = width / height;
    renderer.setSize(width, height, false);
    fitCameraToAspect(camera, aspect, { refAspect: 1.6, maxFov: 68 });
    rMult = aspect < 0.8 ? 1.25 : aspect < 1.3 ? 1.08 : 1;
    small = width < 640;
    if (!loop.running) renderOnce();
  }
  const unobserve = observeResize(canvas, resize);
  resize();

  return {
    setProgress(pv) { progT = clamp(pv); if (!loop.running) renderOnce(); },
    setParam() {},
    resize,
    start() { if (reducedMotion) { renderOnce(); return; } loop.start(); },
    stop() { loop.stop(); },
    dispose() {
      loop.stop(); unobserve();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      camera.remove(veil); veil.geometry.dispose(); veilMat.dispose();
      disposeObject(macro); disposeObject(head);
      textures.forEach((t) => t.dispose()); envTex.dispose(); pmrem.dispose();
      renderer.dispose();
    },
  };
}
