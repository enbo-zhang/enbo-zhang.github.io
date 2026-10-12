// Scene 2 — "Spin waves, with a handedness"
// Damon–Eshbach spin waves in a YIG film, launched by a gold stripline.
//
// Physics coordinates are used directly (camera.up = +z):
//   film in the x–y plane (top surface at z = 0), z = height above the film,
//   stripline along y at x = 0, bias field B in-plane along +y (flipB → −y),
//   waves propagate along ±x with phase φ = k|x| − ωt (fronts move outward).
//
// Magnetization precesses right-handed about B on BOTH sides (m_x = A cos φ, m_z = s·A sin φ,
// s = +1 for B ∥ +y). The stray field above the film, B_x ∝ cos(kx − ωt),
// B_z ∝ −sgn(k)·sin(kx − ωt), times e^{−|k|z}, is right-handed about B (σ+, magenta) for the
// wave travelling toward −x and left-handed (σ−, cyan) for the wave toward +x.
// Flipping B mirrors the problem (x → −x): the lab-frame rotation on each side stays, but
// handedness relative to B swaps, so σ+/σ− colours swap sides and the strong side moves to −x.
//
// Contract: export function createScene(canvas, options) → { setProgress, setParam, resize, start, stop, dispose }
// setParam('flipB', bool) — reverse B (smoothly), swapping σ+/σ− sides.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { maxPixelRatio } from './common.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------- local helpers
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };

const COL = {
  plus: new THREE.Color('#ff375f'),   // σ+  right-handed
  minus: new THREE.Color('#64d2ff'),  // σ−  left-handed
  amber: new THREE.Color('#ffb340'),
  gold: new THREE.Color('#d4af37'),
  white: new THREE.Color('#f5f5f7'),
};

const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", Helvetica, Arial, sans-serif';

function makeLabel(text, { size = 0.6, color = '#f5f5f7', weight = 600 } = {}) {
  const px = 96;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  ctx.font = `${weight} ${px}px ${FONT}`;
  const w = Math.ceil(ctx.measureText(text).width + px * 0.6);
  const h = Math.ceil(px * 1.35);
  c.width = w; c.height = h;
  ctx.font = `${weight} ${px}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = px * 0.15;
  ctx.fillStyle = color;
  ctx.fillText(text, w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, opacity: 0 });
  const s = new THREE.Sprite(mat);
  s.scale.set(size * w / h, size, 1);
  s.renderOrder = 20;
  return s;
}

function radialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Arrow centred on the origin, pointing +y, total length 1.
function arrowGeometry({ shaftR = 0.035, headR = 0.09, headL = 0.3, seg = 10 } = {}) {
  const shaftL = 1 - headL;
  const shaft = new THREE.CylinderGeometry(shaftR, shaftR, shaftL, seg, 1);
  shaft.translate(0, -0.5 + shaftL / 2, 0);
  const head = new THREE.ConeGeometry(headR, headL, seg * 2, 1);
  head.translate(0, 0.5 - headL / 2, 0);
  const g = mergeGeometries([shaft.toNonIndexed(), head.toNonIndexed()]);
  shaft.dispose(); head.dispose();
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- scene constants
const FILM_W = 20;          // x extent
const FILM_D = 12;          // y extent
const YIG_T = 0.3;
const GGG_T = 1.0;
const LAMBDA = 3.0;         // display units
const K = (2 * Math.PI) / LAMBDA;
const OMEGA = 2 * Math.PI / 2.4; // one precession period ≈ 2.4 s
const STRIP_W = 0.6;
const ENV_L = 9.0;          // envelope decay length away from the stripline
const NONRECIP = 0.2;       // extra amplitude on the favoured side (+x for B ∥ +y)
const STRAY_Y = -3.0;        // the x–z slice where the stray field is drawn (toward the viewer)

function envelope(x, f) {
  const ax = Math.abs(x);
  const side = 1 + NONRECIP * (1 + Math.sign(x) * f) * 0.5; // smooth in f
  return Math.exp(-ax / ENV_L) * side / (1 + NONRECIP);
}

// ---------------------------------------------------------------- createScene
export function createScene(canvas, options = {}) {
  // sticky story scene (text beats on the left) vs. playground stage
  const beatsLeft = !!canvas.closest?.('.scene');
  const reducedMotion = !!options.reducedMotion;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(maxPixelRatio());
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  scene.environment = envTex;

  const camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.1, 400);
  camera.up.set(0, 0, 1);

  // ---------------- lights: soft key, cool + warm rims
  scene.add(new THREE.HemisphereLight(0x8fa6c8, 0x120a04, 0.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(8, -10, 16);
  scene.add(key);
  const rimCool = new THREE.DirectionalLight(0x9cc8ff, 1.4);
  rimCool.position.set(-14, 14, 4);
  scene.add(rimCool);
  const rimWarm = new THREE.DirectionalLight(0xffc27a, 0.9);
  rimWarm.position.set(16, 10, 2);
  scene.add(rimWarm);

  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };

  // ---------------- floor glow (grounds the slab on black)
  const floor = new THREE.Mesh(
    track(new THREE.PlaneGeometry(44, 30)),
    track(new THREE.MeshBasicMaterial({
      map: track(radialTexture([[0, 'rgba(255,170,70,0.20)'], [0.45, 'rgba(255,140,40,0.06)'], [1, 'rgba(0,0,0,0)']])),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }))
  );
  floor.position.z = -YIG_T - GGG_T - 0.6;
  scene.add(floor);

  // ---------------- substrate (GGG) and film (YIG)
  const ggg = new THREE.Mesh(
    track(new THREE.BoxGeometry(FILM_W, FILM_D, GGG_T)),
    track(new THREE.MeshPhysicalMaterial({
      color: 0x2a1c10, roughness: 0.28, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.15,
      envMapIntensity: 0.6, transparent: true, opacity: 0.94,
    }))
  );
  ggg.position.z = -YIG_T - GGG_T / 2;
  scene.add(ggg);

  const yigMat = track(new THREE.MeshPhysicalMaterial({
    color: 0xd27512, roughness: 0.38, metalness: 0.0, clearcoat: 0.3, clearcoatRoughness: 0.3,
    emissive: 0x5a2600, emissiveIntensity: 0.5, envMapIntensity: 0.3,
    transparent: true, opacity: 0.82, ior: 1.5, specularIntensity: 0.25,
  }));
  const yig = new THREE.Mesh(track(new THREE.BoxGeometry(FILM_W, FILM_D, YIG_T)), yigMat);
  yig.position.z = -YIG_T / 2;
  yig.renderOrder = 1;
  scene.add(yig);

  // crisp edge highlights
  const edgeMat = track(new THREE.LineBasicMaterial({ color: 0xffd08a, transparent: true, opacity: 0.35 }));
  const yigEdges = new THREE.LineSegments(track(new THREE.EdgesGeometry(yig.geometry)), edgeMat);
  yigEdges.position.copy(yig.position);
  scene.add(yigEdges);
  const gggEdgeMat = track(new THREE.LineBasicMaterial({ color: 0x8a6a48, transparent: true, opacity: 0.25 }));
  const gggEdges = new THREE.LineSegments(track(new THREE.EdgesGeometry(ggg.geometry)), gggEdgeMat);
  gggEdges.position.copy(ggg.position);
  scene.add(gggEdges);

  // ---------------- wave overlay on the film surface (ripple + glowing fronts)
  const waveUniforms = {
    uTime: { value: 0 }, uK: { value: K }, uOmega: { value: OMEGA },
    uFront: { value: 0 }, uWave: { value: 0 }, uFlip: { value: 1 },
    uEnvL: { value: ENV_L }, uNR: { value: NONRECIP }, uHalfD: { value: FILM_D / 2 },
    uAmber: { value: new THREE.Color('#ffb340') }, uHot: { value: new THREE.Color('#fff1d6') },
  };
  const waveMat = track(new THREE.ShaderMaterial({
    uniforms: waveUniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uTime, uK, uOmega, uFront, uWave, uFlip, uEnvL, uNR;
      varying float vA; varying float vPhi; varying vec2 vXY;
      void main(){
        vec3 p = position;
        float ax = abs(p.x);
        float phi = uK*ax - uOmega*uTime;
        float side = 1.0 + uNR*(1.0 + sign(p.x)*uFlip)*0.5;
        float env = exp(-ax/uEnvL) * side / (1.0 + uNR);
        float front = 1.0 - smoothstep(uFront - 1.6, uFront, ax);
        float nearS = smoothstep(0.32, 0.9, ax);
        float a = uWave * env * front * nearS;
        p.z += 0.05 * a * sin(phi);
        vA = a; vPhi = phi; vXY = p.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uAmber, uHot; uniform float uHalfD;
      varying float vA; varying float vPhi; varying vec2 vXY;
      void main(){
        float s = 0.5 + 0.5*sin(vPhi);
        float crest = pow(s, 7.0);
        float edge = smoothstep(uHalfD, uHalfD - 1.2, abs(vXY.y));
        vec3 col = mix(uAmber, uHot, crest*crest) * (0.04 + 0.7*crest + 0.08*s);
        gl_FragColor = vec4(col * vA * edge * 0.75, 1.0);
      }`,
  }));
  const waveSurf = new THREE.Mesh(track(new THREE.PlaneGeometry(FILM_W, FILM_D, 260, 8)), waveMat);
  waveSurf.position.z = 0.004;
  waveSurf.renderOrder = 3;
  scene.add(waveSurf);

  // ---------------- gold stripline
  const stripMat = track(new THREE.MeshPhysicalMaterial({
    color: COL.gold, metalness: 1.0, roughness: 0.22, envMapIntensity: 1.4,
    clearcoat: 0.4, clearcoatRoughness: 0.2, emissive: 0xffb340, emissiveIntensity: 0,
  }));
  const strip = new THREE.Mesh(track(new THREE.BoxGeometry(STRIP_W, FILM_D + 1.2, 0.12)), stripMat);
  strip.position.z = 0.06;
  strip.renderOrder = 4;
  scene.add(strip);
  // microwave pulse glow along the stripline
  const pulseTex = track(radialTexture([[0, 'rgba(255,220,150,1)'], [0.3, 'rgba(255,170,60,0.45)'], [1, 'rgba(0,0,0,0)']]));
  const pulseMat = track(new THREE.MeshBasicMaterial({ map: pulseTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  const pulse = new THREE.Mesh(track(new THREE.PlaneGeometry(2.6, FILM_D + 3)), pulseMat);
  pulse.position.z = 0.14;
  pulse.renderOrder = 5;
  scene.add(pulse);

  // ---------------- magnetization arrows (InstancedMesh)
  const mPos = [];
  for (let x = -FILM_W / 2 + 0.5; x <= FILM_W / 2 - 0.49; x += 0.5) {
    if (Math.abs(x) < 0.6) continue;
    for (let y = -FILM_D / 2 + 0.75; y <= FILM_D / 2 - 0.74; y += 0.75) mPos.push(x, y);
  }
  const M_COUNT = mPos.length / 2;
  const mGeo = track(arrowGeometry({ shaftR: 0.034, headR: 0.085, headL: 0.32 }));
  const mMat = track(new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 0.3, roughness: 0.35, envMapIntensity: 0.9, transparent: true, opacity: 1,
    emissive: 0x222222,
  }));
  const mMesh = new THREE.InstancedMesh(mGeo, mMat, M_COUNT);
  mMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mMesh.setColorAt(0, COL.white);
  mMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mMesh.frustumCulled = false;
  mMesh.renderOrder = 6;
  scene.add(mMesh);
  const M_LEN = 0.68;
  const M_Z = 0.2;

  // ---------------- stray field arrows above the film, slice y = STRAY_Y
  const sRows = [0.38, 0.75, 1.15, 1.6];
  const sPos = [];
  for (const z of sRows) {
    for (let x = 0.9; x <= FILM_W / 2 - 0.3; x += 0.6) { sPos.push(-x, z); sPos.push(x, z); }
  }
  const S_COUNT = sPos.length / 2;
  const sGeo = track(arrowGeometry({ shaftR: 0.05, headR: 0.13, headL: 0.36 }));
  const sMat = track(new THREE.MeshStandardMaterial({
    color: 0xffffff, metalness: 0.1, roughness: 0.3, envMapIntensity: 0.5,
    emissive: 0xffffff, emissiveIntensity: 0.0, transparent: true, opacity: 0,
  }));
  // emissive should follow the instance colour: patch the shader to use vColor for emission
  sMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n totalEmissiveRadiance = vColor * 0.85;'
    );
  };
  const sMesh = new THREE.InstancedMesh(sGeo, sMat, S_COUNT);
  sMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sMesh.setColorAt(0, COL.plus);
  sMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  sMesh.frustumCulled = false;
  sMesh.renderOrder = 8;
  scene.add(sMesh);

  // faint vertical sheet marking the x–z slice, tinted by handedness and fading with height
  const sheetUniforms = {
    uK: { value: K }, uFlip: { value: 1 }, uAlpha: { value: 0 },
    uPlus: { value: COL.plus.clone() }, uMinus: { value: COL.minus.clone() },
  };
  const sheetMat = track(new THREE.ShaderMaterial({
    uniforms: sheetUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
    fragmentShader: /* glsl */`
      uniform float uK, uFlip, uAlpha; uniform vec3 uPlus, uMinus; varying vec3 vP;
      void main(){
        float z = vP.y;                 // plane local y → world z
        float x = vP.x;
        float w = 0.5 + 0.5*uFlip;      // weight of 'left = σ+'
        float leftPlus = w;
        float t = x < 0.0 ? leftPlus : 1.0 - leftPlus;
        vec3 col = mix(uMinus, uPlus, t);
        float decay = exp(-uK * z * 0.55);
        float edge = smoothstep(10.0, 8.5, abs(x)) * smoothstep(0.3, 0.9, abs(x));
        gl_FragColor = vec4(col * decay * edge * uAlpha, 1.0);
      }`,
  }));
  const sheet = new THREE.Mesh(track(new THREE.PlaneGeometry(FILM_W, 2.6, 1, 1)), sheetMat);
  sheet.geometry.translate(0, 1.3, 0);
  sheet.rotation.x = Math.PI / 2; // plane local y → world z
  sheet.position.set(0, STRAY_Y, 0.02);
  sheet.renderOrder = 7;
  scene.add(sheet);

  // ---------------- orbit glyphs (rotation sense of the stray field) + σ labels
  function makeGlyph(color, handed /* +1 right-handed about +y, −1 left */) {
    const g = new THREE.Group();
    const R = 0.62;
    const pts = [];
    const span = Math.PI * 1.55;
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * span;
      pts.push(new THREE.Vector3(R * Math.cos(a), 0, -handed * R * Math.sin(a)));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.035, 8, false), mat);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 18), mat);
    const a = span;
    head.position.set(R * Math.cos(a), 0, -handed * R * Math.sin(a));
    const tangent = new THREE.Vector3(-Math.sin(a), 0, -handed * Math.cos(a)).normalize();
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    // tiny centre dot (axis = B, pointing into the cross-section)
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), mat);
    g.add(tube, head, dot);
    track(tube.geometry); track(head.geometry); track(dot.geometry); track(mat);
    g.userData = { mat, handed };
    g.renderOrder = 9;
    return g;
  }
  const GLYPH_Z = 2.55, GLYPH_X = 6.0;
  // left side: σ+ (magenta, right-handed) when B ∥ +y; σ− when flipped.  Right side opposite.
  // In the lab frame the left-side field always turns right-handed about +y and the right side
  // left-handed (set by geometry); σ± is defined relative to B, so flipping B only swaps the labels.
  const glyphs = {
    leftPlus: makeGlyph(COL.plus, +1), leftMinus: makeGlyph(COL.minus, +1),
    rightPlus: makeGlyph(COL.plus, -1), rightMinus: makeGlyph(COL.minus, -1),
  };
  glyphs.leftPlus.position.set(-GLYPH_X, STRAY_Y, GLYPH_Z);
  glyphs.leftMinus.position.set(-GLYPH_X, STRAY_Y, GLYPH_Z);
  glyphs.rightPlus.position.set(GLYPH_X, STRAY_Y, GLYPH_Z);
  glyphs.rightMinus.position.set(GLYPH_X, STRAY_Y, GLYPH_Z);
  Object.values(glyphs).forEach((g) => scene.add(g));

  const lblLeftPlus = makeLabel('σ+', { size: 0.62, color: '#ff375f' });
  const lblLeftMinus = makeLabel('σ−', { size: 0.62, color: '#64d2ff' });
  const lblRightPlus = makeLabel('σ+', { size: 0.62, color: '#ff375f' });
  const lblRightMinus = makeLabel('σ−', { size: 0.62, color: '#64d2ff' });
  [lblLeftPlus, lblLeftMinus].forEach((l) => l.position.set(-GLYPH_X - 1.25, STRAY_Y, GLYPH_Z));
  [lblRightPlus, lblRightMinus].forEach((l) => l.position.set(GLYPH_X + 1.25, STRAY_Y, GLYPH_Z));
  const lblDirL = makeLabel('←  wave', { size: 0.42, color: 'rgba(245,245,247,0.8)', weight: 500 });
  const lblDirR = makeLabel('wave  →', { size: 0.42, color: 'rgba(245,245,247,0.8)', weight: 500 });
  lblDirL.position.set(-GLYPH_X, STRAY_Y, GLYPH_Z + 0.95);
  lblDirR.position.set(GLYPH_X, STRAY_Y, GLYPH_Z + 0.95);
  [lblLeftPlus, lblLeftMinus, lblRightPlus, lblRightMinus, lblDirL, lblDirR].forEach((l) => scene.add(l));

  // ---------------- B arrow
  const bGroup = new THREE.Group();
  const bMat = track(new THREE.MeshPhysicalMaterial({
    color: 0xe8e8ed, metalness: 0.6, roughness: 0.25, envMapIntensity: 1.2, clearcoat: 1, transparent: true, opacity: 1,
  }));
  const bArrow = new THREE.Mesh(track(arrowGeometry({ shaftR: 0.07, headR: 0.22, headL: 0.12, seg: 16 })), bMat);
  bArrow.scale.set(1, 6.0, 1);
  bGroup.add(bArrow);
  const lblB = makeLabel('B', { size: 0.85, weight: 600 });
  lblB.position.set(0, 3.6, 0.35);
  bGroup.add(lblB);
  bGroup.position.set(-FILM_W / 2 - 1.3, 0, 0.3);
  scene.add(bGroup);

  // ---------------- camera path (z-up physics coordinates)
  const camKeys = [
    { p: 0.00, pos: [14, -20, 11.5], tgt: [0, 0, -0.4], fov: 34 },
    { p: 0.22, pos: [11, -17.5, 9.5], tgt: [0.5, 0, -0.2], fov: 34 },
    { p: 0.45, pos: [10.5, -14.5, 7.0], tgt: [3.0, -1.0, 0.0], fov: 33 },
    { p: 0.64, pos: [5.0, -21.0, 7.0], tgt: [0.0, -2.0, 0.6], fov: 33 },
    { p: 0.78, pos: [2.5, -23.0, 4.2], tgt: [0, -2.5, 0.9], fov: 32 },
    { p: 0.93, pos: [0.0, -27.0, 1.6], tgt: [0, -3.0, 1.0], fov: 30 },
    { p: 1.00, pos: [0.0, -27.5, 1.6], tgt: [0, -3.0, 1.0], fov: 30 },
  ];
  const _a = new THREE.Vector3(), _b = new THREE.Vector3();
  function sampleCam(p, outPos, outTgt) {
    let i = 0;
    while (i < camKeys.length - 2 && p > camKeys[i + 1].p) i++;
    const A = camKeys[i], B = camKeys[i + 1];
    const t = easeInOut((p - A.p) / (B.p - A.p));
    outPos.set(...A.pos).lerp(_a.set(...B.pos), t);
    outTgt.set(...A.tgt).lerp(_b.set(...B.tgt), t);
    return lerp(A.fov, B.fov, t);
  }

  // ---------------- state
  let progressTarget = 0, progress = 0;
  let flipTarget = 1, flip = 1;
  let time = reducedMotion ? 0.55 : 0;
  let running = false, rafId = 0, lastT = 0;
  let aspect = 16 / 9;
  let disposed = false;

  const _q = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _s = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _c = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0);
  const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
  const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3();
  const hx = FILM_W / 2, hy = FILM_D / 2;
  const FIT_MAIN = [[-hx, -hy, 0], [hx, -hy, 0], [-hx, hy, 0], [hx, hy, 0], [-hx, -hy, -1.3], [hx, -hy, -1.3]];
  const FIT_END = [[-hx, -hy, 0], [hx, -hy, 0], [-hx, 0, 3.4], [hx, 0, 3.4], [0, -hy, -1.3]];

  function update(dt) {
    const p = progress;
    const f = flip;
    const t = time;

    // ---- storyboard weights
    const wave = smoothstep(0.24, 0.34, p);
    const front = lerp(0, FILM_W / 2 + 2.5, smoothstep(0.25, 0.52, p));
    const launch = smoothstep(0.22, 0.28, p) * (1 - smoothstep(0.36, 0.5, p));
    const stray = smoothstep(0.55, 0.66, p);
    const glyphA = smoothstep(0.62, 0.72, p);
    const endView = smoothstep(0.82, 0.95, p);

    // ---- wave surface
    waveUniforms.uTime.value = t;
    waveUniforms.uFront.value = front;
    waveUniforms.uWave.value = wave * (1 - 0.35 * stray);
    waveUniforms.uFlip.value = f;

    // ---- stripline pulse
    const throb = reducedMotion ? 0.8 : 0.75 + 0.25 * Math.sin(t * OMEGA * 2);
    pulseMat.opacity = (0.95 * launch + 0.22 * wave) * throb;
    stripMat.emissiveIntensity = 0.55 * launch + 0.06 * wave;

    // ---- magnetization arrows: precess right-handed about B, same sense on both sides
    const alpha = (Math.PI / 2) * (1 - f);          // rotate equilibrium +y → −y about z when flipping
    const ex = -Math.sin(alpha), ey = Math.cos(alpha);
    const ux = Math.cos(alpha), uy = Math.sin(alpha); // in-plane transverse direction (x̂ rotated)
    const sense = Math.abs(f) < 1e-3 ? 0 : f;          // precession sense follows B
    const ampMax = 0.62;
    for (let i = 0; i < M_COUNT; i++) {
      const x = mPos[2 * i], y = mPos[2 * i + 1];
      const ax = Math.abs(x);
      const phi = K * ax - OMEGA * t;
      const fr = 1 - smoothstep(front - 1.6, front, ax);
      const A = ampMax * wave * fr * envelope(x, f) * smoothstep(0.32, 0.9, ax);
      const c = Math.cos(phi), s = Math.sin(phi);
      _d.set(ex + A * c * ux, ey + A * c * uy, A * sense * s).normalize();
      _q.setFromUnitVectors(Y, _d);
      _p.set(x, y, M_Z + 0.05 * A * s);
      const hide = y < STRAY_Y + 0.6 ? 1 - 0.9 * stray : 1; // clear the view in front of the stray-field slice
      _s.set(hide, M_LEN * hide, hide);
      _m.compose(_p, _q, _s);
      mMesh.setMatrixAt(i, _m);
      const glow = 0.55 + 0.45 * (A / ampMax) * Math.pow(0.5 + 0.5 * s, 2) * 2.0;
      _c.setRGB(0.92 * glow, 0.9 * glow, 0.86 * glow);
      mMesh.setColorAt(i, _c);
    }
    mMesh.instanceMatrix.needsUpdate = true;
    mMesh.instanceColor.needsUpdate = true;
    mMat.opacity = 1 - 0.5 * stray - 0.25 * endView;

    // ---- stray field: B_x ∝ cos(k|x| − ωt), B_z ∝ −sgn(x)·sin(k|x| − ωt), × e^{−k z}
    // (lab-frame sense per side is fixed by geometry; flipping B mirrors the problem, so the
    //  handedness *relative to B* — σ± colour — swaps sides while the strong side moves to −x)
    const wL = 0.5 + 0.5 * f; // weight: left side is σ+ (magenta)
    for (let i = 0; i < S_COUNT; i++) {
      const x = sPos[2 * i], z = sPos[2 * i + 1];
      const ax = Math.abs(x);
      const th = K * ax - OMEGA * t;
      const amp = envelope(x, f) * Math.exp(-K * z);
      const bx = Math.cos(th), bz = -Math.sign(x) * Math.sin(th);
      _d.set(bx, 0, bz);
      const dl = _d.length();
      if (dl < 1e-4) _d.set(1, 0, 0); else _d.multiplyScalar(1 / dl);
      _q.setFromUnitVectors(Y, _d);
      const L = stray * (0.18 + 0.95 * Math.pow(amp, 0.6)) * (0.35 + 0.65 * dl);
      _p.set(x, STRAY_Y, z);
      _s.set(Math.max(L, 1e-4) * 0.9 + 0.1 * stray, Math.max(L, 1e-4), Math.max(L, 1e-4) * 0.9 + 0.1 * stray);
      _m.compose(_p, _q, _s);
      sMesh.setMatrixAt(i, _m);
      const tPlus = x < 0 ? wL : 1 - wL;
      _c.copy(COL.minus).lerp(COL.plus, tPlus).multiplyScalar(0.55 + 0.9 * Math.pow(amp, 0.5));
      sMesh.setColorAt(i, _c);
    }
    sMesh.instanceMatrix.needsUpdate = true;
    sMesh.instanceColor.needsUpdate = true;
    sMat.opacity = stray;
    sMesh.visible = stray > 0.001;
    sheetUniforms.uAlpha.value = 0.16 * stray;
    sheetUniforms.uFlip.value = f;

    // ---- orbit glyphs: rotate at ω in the field's sense
    const rot = OMEGA * t;
    const show = glyphA;
    glyphs.leftPlus.userData.mat.opacity = show * wL;
    glyphs.leftMinus.userData.mat.opacity = show * (1 - wL);
    glyphs.rightPlus.userData.mat.opacity = show * (1 - wL);
    glyphs.rightMinus.userData.mat.opacity = show * wL;
    // positive rotation about +y = right-handed about +y (rotation.y)
    glyphs.leftPlus.rotation.y = glyphs.leftMinus.rotation.y = rot;
    glyphs.rightPlus.rotation.y = glyphs.rightMinus.rotation.y = -rot;
    Object.values(glyphs).forEach((g) => { g.visible = show > 0.001; });
    lblLeftPlus.material.opacity = show * wL;
    lblLeftMinus.material.opacity = show * (1 - wL);
    lblRightPlus.material.opacity = show * (1 - wL);
    lblRightMinus.material.opacity = show * wL;
    lblDirL.material.opacity = lblDirR.material.opacity = show * 0.8 * (1 - 0.3 * endView);

    // ---- B arrow (flip rotates it smoothly about z)
    bGroup.rotation.z = alpha;
    const bDim = 1 - 0.75 * smoothstep(0.55, 0.68, p) * (1 - endView);
    lblB.material.opacity = bDim;
    bMat.opacity = bDim;

    // ---- camera
    let fov = sampleCam(p, camPos, camTgt);
    if (!reducedMotion) {
      const drift = 1 - endView;
      camPos.x += Math.sin(t * 0.13) * 0.8 * drift;
      camPos.z += Math.sin(t * 0.17 + 1.0) * 0.35 * drift;
    }
    // portrait / narrow: widen fov a bit, then pull back just enough that the key content fits
    if (aspect < 1.25) {
      const narrow = smoothstep(1.25, 0.55, aspect);
      fov = fov + 10 * narrow;
      // portrait: raise the camera so the slab fills more of the tall frame (not in the cross-section view)
      camPos.z += narrow * 9 * (1 - endView);
    }
    // wide sticky frames: the text beats sit top-left, so fit the slab into the right part of the frame
    // end view: keep the B arrow at the film's left edge clear of the section rail (titles shown on wide screens)
    const cw = canvas.clientWidth || 1;
    const railRoom = beatsLeft && cw >= 1024 && document.querySelector('.gnav__rail') ? (150 / cw) * endView : 0;
    const leftRoom = Math.max(railRoom, beatsLeft ? 0.38 * smoothstep(1.15, 1.4, aspect) * (1 - endView) : 0);
    const tanV = Math.tan(THREE.MathUtils.degToRad(fov) / 2), tanH = tanV * aspect * (1 - leftRoom);
    _fwd.copy(camTgt).sub(camPos);
    const baseDist = _fwd.length();
    _fwd.multiplyScalar(1 / baseDist);
    _right.crossVectors(_fwd, camera.up).normalize();
    _up.crossVectors(_right, _fwd);
    // playground (fixed frame, no beats): fit tightly instead of keeping the authored distance
    const fitPts = endView > 0.5 || !beatsLeft ? FIT_END : FIT_MAIN;
    let need = beatsLeft ? baseDist : 0;
    for (const q of fitPts) {
      _p.set(q[0], q[1], q[2]).sub(camTgt);
      const along = _p.dot(_fwd);
      need = Math.max(need, Math.abs(_p.dot(_right)) / (0.94 * tanH) + along, Math.abs(_p.dot(_up)) / (0.9 * tanV) + along);
    }
    if (!beatsLeft) need *= 1.08; // breathing room for the B arrow at the film edge
    camPos.copy(camTgt).addScaledVector(_fwd, -need);
    camera.position.copy(camPos);
    camera.fov = fov;
    camera.lookAt(camTgt);
    const vw = canvas.clientWidth || 1, vh = canvas.clientHeight || 1;
    camera.setViewOffset(vw, vh, -leftRoom * vw / 2, 0, vw, vh);
  }

  function render() { renderer.render(scene, camera); }

  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(0.05, lastT ? (now - lastT) / 1000 : 0.016);
    lastT = now;
    if (!reducedMotion) time += dt;
    // damped progress + flip for cinematic smoothness
    progress += (progressTarget - progress) * (1 - Math.exp(-dt * 6));
    if (Math.abs(progressTarget - progress) < 1e-4) progress = progressTarget;
    flip += (flipTarget - flip) * (1 - Math.exp(-dt * 3.2));
    if (Math.abs(flipTarget - flip) < 1e-3) flip = flipTarget;
    update(dt);
    render();
  }

  function resize() {
    const w = canvas.clientWidth || canvas.width || 1;
    const h = canvas.clientHeight || canvas.height || 1;
    renderer.setSize(w, h, false);
    aspect = w / h;
    camera.aspect = aspect;
    update(0);
    render();
  }

  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  if (ro) ro.observe(canvas);
  resize();

  function renderStill() {
    if (reducedMotion || !running) { progress = progressTarget; flip = flipTarget; update(0); render(); }
  }

  return {
    setProgress(p) {
      progressTarget = clamp(+p || 0);
      renderStill();
    },
    setParam(name, value) {
      if (name === 'flipB') {
        flipTarget = value ? -1 : 1;
        renderStill();
      }
    },
    resize,
    start() {
      if (running || disposed) return;
      running = true; lastT = 0;
      rafId = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      cancelAnimationFrame(rafId);
    },
    dispose() {
      disposed = true;
      running = false;
      cancelAnimationFrame(rafId);
      if (ro) ro.disconnect();
      scene.traverse((o) => {
        if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); }
      });
      disposables.forEach((d) => d.dispose && d.dispose());
      mMesh.dispose(); sMesh.dispose();
      envTex.dispose(); pmrem.dispose();
      renderer.dispose();
    },
  };
}
