// hamr-media.js — Scene B: "A medium with walls of h-BN".
// Granular L1₀ FePt film (columnar grains, perpendicular magnetization) with h-BN at the grain boundaries,
// on a seed layer, a copper heat sink and a substrate.
// Storyboard (progress p):
//   0.00–0.25  the granular film and its layer stack, slow 3/4 drift
//   0.25–0.50  zoom into one grain: alternating Fe / Pt planes (L1₀) wrapped in layered h-BN sheets
//   0.50–0.80  back out: a laser spot heats a few grains; the front half is cut away to show heat
//              flowing DOWN into the heat sink, barely sideways (tight hot spot)
//   0.80–1.00  straight-on cross-section with a temperature profile across the spot (steep edge at Tc)
// setParam('boundary', 'hbn' | 'carbon' | 'auto'): 'carbon' swaps the h-BN walls for a conventional amorphous-carbon
// segregant; heat leaks sideways through it (wider, blurrier spot, gentler profile). 'auto' = h-BN. Animated smoothly.
// Drag to rotate (offsets the scripted view).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  clamp, damp, lerp, smoothstep, band, easeInOut, createRenderer, makeLabelSprite, makeGlowSprite,
  observeResize, fitCameraToAspect, createLoop, disposeObject,
} from './common.js';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const SQ3 = Math.sqrt(3);

// ---- geometry constants (world units; one grain ≈ 1 unit across)
const R = 0.5;                 // honeycomb cell circumradius
const RI = R * SQ3 / 2;        // cell inradius (centre → boundary)
const GH = 1.1;                // grain (film) height; film spans y 0..GH
const S_HBN = 0.875;           // grain size relative to its cell with h-BN boundaries
const TC = 0.45;               // Curie threshold on the normalised temperature scale
const Y_SEED = -0.15, Y_SINK = -0.85, Y_SUB = -1.8;
const CUT_Z = 0.1;             // grains in front of this are removed for the cross-section
const FACE_Z = 0.46;           // front face of the cut layer stack

// ---- heat colormap (inferno-like), stops in linear working space
const HEAT = ['#1b0c41', '#781c6d', '#ed6925', '#fbb61a', '#fcffa4'].map((c) => new THREE.Color(c));
function heatColor(t, out) {
  const x = clamp(t) * 4;
  const i = Math.min(3, Math.floor(x));
  return out.copy(HEAT[i]).lerp(HEAT[i + 1], x - i);
}
const g3 = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
const HEAT_GLSL = `
  vec3 heatmap(float t) {
    t = clamp(t, 0.0, 1.0) * 4.0;
    if (t < 1.0) return mix(${g3(HEAT[0])}, ${g3(HEAT[1])}, t);
    if (t < 2.0) return mix(${g3(HEAT[1])}, ${g3(HEAT[2])}, t - 1.0);
    if (t < 3.0) return mix(${g3(HEAT[2])}, ${g3(HEAT[3])}, t - 2.0);
    return mix(${g3(HEAT[3])}, ${g3(HEAT[4])}, t - 3.0);
  }`;

/** Deterministic PRNG so the grain pattern is the same on every load. */
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Normalised temperature of the hot spot at lateral distance r. m = 1 with h-BN, 0 without. */
function spotParams(m) {
  return { A: lerp(0.78, 1.0, m), w: lerp(2.0, 1.0, m), n: lerp(2.0, 4.0, m) };
}
const spotT = (r, sp) => sp.A * Math.exp(-Math.pow(Math.abs(r) / sp.w, sp.n));

export function createScene(canvas, options = {}) {
  const reducedMotion = !!options.reducedMotion;
  const renderer = createRenderer(canvas);
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 22, 46);
  const camera = new THREE.PerspectiveCamera(30, 2, 0.05, 80);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x05060a, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.25); key.position.set(3, 7, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fb0ff, 0.85); rim.position.set(-5, 3, -6); scene.add(rim);

  const root = new THREE.Group();
  scene.add(root);
  const rand = mulberry32(20240617);
  const dummy = new THREE.Object3D();
  const tmpC = new THREE.Color();

  // ---------------------------------------------------------------- grains (honeycomb, pointy along z)
  const cells = [];
  for (let j = -7; j <= 6; j++) {
    for (let i = -8; i <= 7; i++) {
      const odd = ((j % 2) + 2) % 2;
      const x = (i + odd * 0.5) * SQ3 * R, z = j * 1.5 * R;
      if (Math.abs(x) > 7.1) continue;
      cells.push({
        x, z, j,
        sH: S_HBN + (rand() - 0.5) * 0.04,
        up: rand() < 0.5,
        ph: rand() * Math.PI * 2,
        r: Math.hypot(x, z),
      });
    }
  }
  const NG = cells.length;
  const zFront = Math.max(...cells.map((c) => c.z));
  const xMin = Math.min(...cells.map((c) => c.x)) - R, xMax = Math.max(...cells.map((c) => c.x)) + R;
  const zMin = Math.min(...cells.map((c) => c.z)) - R;
  // target grain for the atomic close-up: front row, right of centre
  let target = -1;
  cells.forEach((c, i) => { if (c.z === zFront && (target < 0 || Math.abs(c.x - 2.6) < Math.abs(cells[target].x - 2.6))) target = i; });
  const TG = cells[target];
  // its right-hand neighbour is lifted out during the close-up so the shared boundary can be seen
  const nbr = cells.findIndex((c) => Math.abs(c.x - (TG.x + 2 * RI)) < 1e-3 && Math.abs(c.z - TG.z) < 1e-3);
  const closeCells = [target, nbr].filter((i) => i >= 0);
  const cellIndex = new Map(cells.map((c, i) => [`${c.x.toFixed(3)},${c.z.toFixed(3)}`, i]));
  const hasCell = (x, z) => cellIndex.has(`${x.toFixed(3)},${z.toFixed(3)}`);

  const grainGeo = new THREE.CylinderGeometry(R, R, GH, 6, 1);
  grainGeo.translate(0, GH / 2, 0);
  const heatAttr = new THREE.InstancedBufferAttribute(new Float32Array(NG), 1);
  heatAttr.setUsage(THREE.DynamicDrawUsage);
  grainGeo.setAttribute('aHeat', heatAttr);
  const grainMat = new THREE.MeshStandardMaterial({ color: 0x7d8aa0, metalness: 0.55, roughness: 0.42, envMapIntensity: 0.55 });
  grainMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHeat;\nvarying float vHeat;\nvarying float vGy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat;\nvGy = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vHeat;\nvarying float vGy;\n${HEAT_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float hh = vHeat * mix(0.42, 1.0, clamp(vGy / ${GH.toFixed(3)}, 0.0, 1.0));
        totalEmissiveRadiance += heatmap(0.22 + 0.78 * hh) * smoothstep(0.03, 0.3, hh) * (0.5 + 2.2 * hh);
        diffuseColor.rgb *= 1.0 - 0.6 * smoothstep(0.05, 0.6, hh);`);
  };
  const grains = new THREE.InstancedMesh(grainGeo, grainMat, NG);
  grains.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(grains);

  // ---------------------------------------------------------------- h-BN walls (one slab per honeycomb edge)
  const walls = [];
  const NORMALS = [0, 60, 120, 180, 240, 300].map((d) => (d * Math.PI) / 180);
  cells.forEach((c, ci) => {
    NORMALS.forEach((th, k) => {
      const nx = Math.cos(th), nz = Math.sin(th);
      const neighbour = hasCell(c.x + nx * 2 * RI, c.z + nz * 2 * RI);
      if (k >= 3 && neighbour) return;          // shared edge already owned by the neighbour
      walls.push({ x: c.x + nx * RI, z: c.z + nz * RI, rotY: Math.PI / 2 - th, cell: ci, th });
    });
  });
  const NW = walls.length;
  const targetWalls = new Set();
  walls.forEach((w, i) => {
    if (closeCells.some((ci) => Math.abs(Math.hypot(w.x - cells[ci].x, w.z - cells[ci].z) - RI) < 0.01)) targetWalls.add(i);
  });
  const wallGeo = new THREE.BoxGeometry(R * 1.04, GH * 0.995, 1);
  wallGeo.translate(0, GH / 2, 0);
  const wallU = { uRim: { value: 1 } };
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xbfe9ff, emissive: 0x7fd0ff, emissiveIntensity: 0.25, roughness: 0.2, metalness: 0, envMapIntensity: 0.3,
    transparent: true, opacity: 0.38, depthWrite: false, side: THREE.DoubleSide,
  });
  wallMat.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = wallU.uRim;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWy;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWy = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWy;\nuniform float uRim;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float rimT = smoothstep(${(GH - 0.07).toFixed(3)}, ${GH.toFixed(3)}, vWy) + 0.5 * smoothstep(0.06, 0.0, vWy);
        totalEmissiveRadiance += vec3(0.35, 0.78, 1.0) * rimT * 1.3 * uRim;
        diffuseColor.a = min(1.0, diffuseColor.a * (1.0 + 1.2 * rimT));`);
  };
  const wallMesh = new THREE.InstancedMesh(wallGeo, wallMat, NW);
  wallMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  wallMesh.renderOrder = 2;
  root.add(wallMesh);

  // ---------------------------------------------------------------- magnetization arrows (instanced)
  const AL = 0.56;
  const shaft = new THREE.CylinderGeometry(0.034, 0.034, AL - 0.17, 10); shaft.translate(0, (AL - 0.17) / 2, 0);
  const head = new THREE.ConeGeometry(0.09, 0.17, 14); head.translate(0, AL - 0.085, 0);
  const arrowGeo = mergeGeometries([shaft, head]); arrowGeo.translate(0, -AL / 2, 0);
  shaft.dispose(); head.dispose();
  const vColorEmissive = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n#ifdef USE_COLOR\ntotalEmissiveRadiance += vColor.rgb * 0.5;\n#endif');
  };
  const arrowMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 });
  arrowMat.onBeforeCompile = vColorEmissive;
  const arrows = new THREE.InstancedMesh(arrowGeo, arrowMat, NG);
  arrows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const C_UP = new THREE.Color(0x64d2ff), C_DOWN = new THREE.Color(0xff9f0a), C_HOT = new THREE.Color(0x8a8f99);
  cells.forEach((c, i) => arrows.setColorAt(i, c.up ? C_UP : C_DOWN));
  root.add(arrows);

  // ---------------------------------------------------------------- layer stack
  const layerDefs = [
    { y0: Y_SEED, y1: 0, mat: new THREE.MeshStandardMaterial({ color: 0x5d6675, metalness: 0.3, roughness: 0.5 }), edge: 0x9fb4d0 },
    { y0: Y_SINK, y1: Y_SEED, mat: new THREE.MeshStandardMaterial({ color: 0xc8804a, metalness: 1, roughness: 0.3, envMapIntensity: 1.6 }), edge: 0xffa060 },
    { y0: Y_SUB, y1: Y_SINK, mat: new THREE.MeshStandardMaterial({ color: 0x1c1f26, metalness: 0.2, roughness: 0.55 }), edge: 0x5a6a85 },
  ];
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const layerX0 = xMin - 0.25, layerX1 = xMax + 0.25, layerZ0 = zMin - 0.2;
  const zFull = zFront + R + 0.15;
  const layers = layerDefs.map((d) => {
    const mesh = new THREE.Mesh(unitBox, d.mat);
    root.add(mesh);
    const edgeMat = new THREE.MeshBasicMaterial({ color: d.edge, transparent: true, opacity: 0.55, toneMapped: false, depthWrite: false });
    const edge = new THREE.Mesh(unitBox, edgeMat);       // glowing front-top rim
    root.add(edge);
    return { ...d, mesh, edge };
  });
  function placeLayers(zf) {
    for (const L of layers) {
      const h = L.y1 - L.y0;
      L.mesh.scale.set(layerX1 - layerX0, h, zf - layerZ0);
      L.mesh.position.set((layerX0 + layerX1) / 2, (L.y0 + L.y1) / 2, (zf + layerZ0) / 2);
      L.edge.scale.set(layerX1 - layerX0 + 0.002, 0.012, 0.012);
      L.edge.position.set((layerX0 + layerX1) / 2, L.y1, zf);
    }
  }

  // heat flowing down through the cut face: additive plume over the seed / heat sink / substrate
  const plumeU = { uAmp: { value: 0 }, uW: { value: 0.7 }, uTime: { value: 0 }, uOn: { value: 0 } };
  const plume = new THREE.Mesh(
    new THREE.PlaneGeometry(layerX1 - layerX0, -Y_SUB + 0.02, 160, 40),
    new THREE.ShaderMaterial({
      uniforms: plumeU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float uAmp; uniform float uW; uniform float uTime; uniform float uOn; varying vec3 vW;
        ${HEAT_GLSL}
        void main(){
          float y = vW.y;
          float d = clamp(-y / ${(-Y_SINK).toFixed(3)}, 0.0, 1.0);          // depth from film bottom to heat-sink bottom
          float w = uW * (1.0 + 1.9 * d);
          float T = uAmp * (0.72 - 0.4 * d) * exp(-pow(abs(vW.x) / w, 2.0));
          float inSink = step(y, ${Y_SEED.toFixed(3)}) * step(${Y_SINK.toFixed(3)}, y);
          T *= 1.0 + inSink * 0.28 * sin(26.0 * d - uTime * 3.2);           // stripes flowing downward
          T *= exp(min(0.0, y - ${Y_SINK.toFixed(3)}) * 4.0);              // little reaches the substrate
          float a = smoothstep(0.02, 0.28, T) * uOn * (0.35 + 0.9 * T);
          gl_FragColor = vec4(heatmap(0.2 + 0.8 * T), a);
          #include <colorspace_fragment>
        }`,
    }),
  );
  plume.position.set((layerX0 + layerX1) / 2, Y_SUB / 2 + 0.01, FACE_Z + 0.004);
  plume.renderOrder = 3;
  root.add(plume);

  // ---------------------------------------------------------------- laser spot
  const LASER = 0xff5a36;
  const beamU = { uColor: { value: new THREE.Color(LASER) }, uOn: { value: 0 } };
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(1.25, 0.42, 7, 48, 1, true),
    new THREE.ShaderMaterial({
      uniforms: beamU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ vY = position.y / 7.0 + 0.5; vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOn; varying float vY; varying vec3 vN; varying vec3 vV;
        void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
        float a = (0.3 * pow(1.0 - vY, 1.5) * f + 0.18 * exp(-vY * 10.0)) * uOn;
        gl_FragColor = vec4(uColor, a);
        #include <colorspace_fragment>
        }`,
    }),
  );
  beam.position.set(0, GH + 3.5, 0);
  beam.renderOrder = 6;
  root.add(beam);
  const spotGlow = makeGlowSprite(0xff7a4a, { size: 2.2, opacity: 0 });
  spotGlow.position.set(0, GH + 0.12, 0);
  const spotCore = makeGlowSprite(0xffd2a0, { size: 0.8, opacity: 0 });
  spotCore.position.set(0, GH + 0.1, 0);
  root.add(spotGlow, spotCore);

  // heat-flow particles on the cut face: down into the heat sink; sideways only without h-BN
  const flowDown = [], flowSide = [];
  for (let i = 0; i < 44; i++) {
    const s = makeGlowSprite(0xffa54a, { size: 0.22, opacity: 0 });
    s.userData = { ph: rand(), u: rand() * 2 - 1 };
    flowDown.push(s); root.add(s);
  }
  for (let i = 0; i < 22; i++) {
    const s = makeGlowSprite(0xff8a3a, { size: 0.2, opacity: 0 });
    s.userData = { ph: rand(), side: i % 2 ? 1 : -1, y: 0.15 + rand() * 0.85 };
    flowSide.push(s); root.add(s);
  }

  // ---------------------------------------------------------------- atomic close-up of the target grain
  const sphereGeo = new THREE.SphereGeometry(1, 12, 8);
  const atomMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.25 });
  atomMat.onBeforeCompile = vColorEmissive;
  const insideHex = (x, z, ri) => Math.abs(x) <= ri && Math.abs(0.5 * x + (SQ3 / 2) * z) <= ri && Math.abs(0.5 * x - (SQ3 / 2) * z) <= ri;
  // L1₀ FePt: Fe and Pt planes alternate along c (the vertical easy axis); each plane is a square net,
  // successive planes offset by half a diagonal
  const fept = [];
  const AS = 0.084, AC = 0.073;
  const nLayers = Math.floor((GH - 0.06) / AC) + 1;
  for (let k = 0; k < nLayers; k++) {
    const y = 0.035 + k * AC;
    const off = (k % 2) * AS / 2;
    for (let ix = -8; ix <= 8; ix++) {
      for (let iz = -8; iz <= 8; iz++) {
        const x = ix * AS + off, z = iz * AS + off;
        if (!insideHex(x, z, 0.372)) continue;
        fept.push({ x: TG.x + x, y, z: TG.z + z, r: k % 2 ? 0.034 : 0.027, fe: k % 2 === 0, st: k / nLayers });
      }
    }
  }
  const feptMesh = new THREE.InstancedMesh(sphereGeo, atomMat, fept.length);
  const C_FE = new THREE.Color(0xc86b4a), C_PT = new THREE.Color(0xd9dde3);
  fept.forEach((a, i) => feptMesh.setColorAt(i, a.fe ? C_FE : C_PT));
  root.add(feptMesh);
  // h-BN: a few hexagonal sheets stacked parallel to each boundary face (B and N alternate)
  const bn = [], bonds = [];
  const BB = 0.034;
  [0].forEach((deg) => {
    const th = (deg * Math.PI) / 180;
    const n = v(Math.cos(th), 0, Math.sin(th)), t = v(-Math.sin(th), 0, Math.cos(th));
    [0.398, 0.432, 0.466, 0.5].forEach((d, si) => {
      const half = d / SQ3 - 0.01;
      const at = (u, y) => v(TG.x, y, TG.z).addScaledVector(n, d).addScaledVector(t, u);
      const A = new Map(), B = new Map();
      const rows = Math.floor((GH - 0.06) / (1.5 * BB));
      const cols = Math.ceil(half / (SQ3 * BB)) + 1;
      for (let j = 0; j <= rows; j++) {
        for (let i = -cols; i <= cols; i++) {
          const u = (i + (j % 2) * 0.5) * SQ3 * BB;
          if (Math.abs(u) > half) continue;
          const yA = 0.03 + j * 1.5 * BB;
          const swap = si % 2 === 1;
          A.set(`${i},${j}`, bn.length); bn.push({ p: at(u, yA), b: !swap, st: si * 0.2 });
          if (yA + BB < GH - 0.02) { B.set(`${i},${j}`, bn.length); bn.push({ p: at(u, yA + BB), b: swap, st: si * 0.2 }); }
        }
      }
      for (const [k2, bi] of B) {
        const [i, j] = k2.split(',').map(Number);
        const ai = A.get(k2); if (ai != null) bonds.push(bn[ai].p, bn[bi].p);
        const nb = j % 2 === 0 ? [i - 1, i] : [i, i + 1];
        for (const ii of nb) { const a2 = A.get(`${ii},${j + 1}`); if (a2 != null) bonds.push(bn[bi].p, bn[a2].p); }
      }
    });
  });
  const bnMesh = new THREE.InstancedMesh(sphereGeo, atomMat, bn.length);
  const C_B = new THREE.Color(0xffb3c1), C_N = new THREE.Color(0x7fa7ff);
  bn.forEach((a, i) => bnMesh.setColorAt(i, a.b ? C_B : C_N));
  root.add(bnMesh);
  const bondMat = new THREE.LineBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0, depthWrite: false });
  const bondLines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(bonds), bondMat);
  root.add(bondLines);
  let lastCm = -1;
  function placeAtoms(cm) {
    if (Math.abs(cm - lastCm) < 1e-4) return;
    lastCm = cm;
    const vis = cm > 0.001;
    feptMesh.visible = bnMesh.visible = bondLines.visible = vis;
    if (!vis) return;
    fept.forEach((a, i) => {
      const s = a.r * easeInOut(smoothstep(a.st * 0.55, a.st * 0.55 + 0.45, cm));
      dummy.position.set(a.x, a.y, a.z); dummy.quaternion.identity(); dummy.scale.setScalar(Math.max(1e-4, s));
      dummy.updateMatrix(); feptMesh.setMatrixAt(i, dummy.matrix);
    });
    bn.forEach((a, i) => {
      const s = 0.016 * easeInOut(smoothstep(0.25 + a.st * 0.5, 0.5 + a.st * 0.5, cm));
      dummy.position.copy(a.p); dummy.scale.setScalar(Math.max(1e-4, s));
      dummy.updateMatrix(); bnMesh.setMatrixAt(i, dummy.matrix);
    });
    feptMesh.instanceMatrix.needsUpdate = true;
    bnMesh.instanceMatrix.needsUpdate = true;
    bondMat.opacity = 0.8 * smoothstep(0.55, 1, cm);
  }

  // ---------------------------------------------------------------- temperature profile (cross-section)
  const prof = new THREE.Group();
  prof.position.z = FACE_Z + 0.05;
  root.add(prof);
  const PX = 5.0, PY0 = 2.05, PS = 1.45, PN = 240;
  const ribbonGeo = new THREE.BufferGeometry();
  ribbonGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PN * 2 * 3), 3));
  ribbonGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PN * 2 * 3), 3));
  const fillGeo = new THREE.BufferGeometry();
  fillGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PN * 2 * 3), 3));
  fillGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PN * 2 * 3), 3));
  const idx = [];
  for (let i = 0; i < PN - 1; i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  ribbonGeo.setIndex(idx); fillGeo.setIndex(idx);
  const ribbonMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false });
  const fillMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
  const ribbon = new THREE.Mesh(ribbonGeo, ribbonMat); ribbon.renderOrder = 8;
  const fill = new THREE.Mesh(fillGeo, fillMat); fill.renderOrder = 7;
  prof.add(fill, ribbon);
  const axisMat = new THREE.LineBasicMaterial({ color: 0x8e8e93, transparent: true, opacity: 0 });
  prof.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([v(-PX, PY0, 0), v(PX, PY0, 0)]), axisMat));
  const tcMat = new THREE.LineDashedMaterial({ color: 0xc7c7cc, dashSize: 0.12, gapSize: 0.09, transparent: true, opacity: 0 });
  const tcLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([v(-PX, PY0 + PS * TC, 0), v(PX, PY0 + PS * TC, 0)]), tcMat);
  tcLine.computeLineDistances();
  prof.add(tcLine);
  const edgeDots = [makeGlowSprite(0xfcffa4, { size: 0.42, opacity: 0 }), makeGlowSprite(0xfcffa4, { size: 0.42, opacity: 0 })];
  // short guides dropping from the Tc crossings to the film: where the written bit's edge freezes
  const guideMat = new THREE.LineDashedMaterial({ color: 0xfbb61a, dashSize: 0.06, gapSize: 0.06, transparent: true, opacity: 0 });
  const guides = edgeDots.map(() => {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([v(0, 0, 0), v(0, -1, 0)]), guideMat);
    l.computeLineDistances(); prof.add(l); return l;
  });
  edgeDots.forEach((d) => prof.add(d));
  let lastProfM = -1;
  function buildProfile(m) {
    if (Math.abs(m - lastProfM) < 1e-4) return;
    lastProfM = m;
    const sp = spotParams(m);
    const pts = [];
    for (let i = 0; i < PN; i++) {
      const x = -PX + (2 * PX * i) / (PN - 1);
      pts.push([x, PY0 + PS * spotT(x, sp), spotT(x, sp)]);
    }
    const rp = ribbonGeo.attributes.position.array, rc = ribbonGeo.attributes.color.array;
    const fp = fillGeo.attributes.position.array, fc = fillGeo.attributes.color.array;
    const hw = 0.028;
    for (let i = 0; i < PN; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(PN - 1, i + 1)];
      let nx = -(b[1] - a[1]), ny = b[0] - a[0];
      const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
      const [x, y, T] = pts[i];
      rp.set([x + nx * hw, y + ny * hw, 0, x - nx * hw, y - ny * hw, 0], i * 6);
      heatColor(0.25 + 0.75 * T, tmpC);
      const k = 0.35 + 0.65 * smoothstep(0.02, 0.3, T);
      rc.set([tmpC.r * k, tmpC.g * k, tmpC.b * k, tmpC.r * k, tmpC.g * k, tmpC.b * k], i * 6);
      fp.set([x, PY0, 0, x, y, 0], i * 6);
      const f = 0.22 * smoothstep(0.0, 0.3, T);
      fc.set([tmpC.r * f * 0.2, tmpC.g * f * 0.2, tmpC.b * f * 0.2, tmpC.r * f, tmpC.g * f, tmpC.b * f], i * 6);
    }
    ribbonGeo.attributes.position.needsUpdate = ribbonGeo.attributes.color.needsUpdate = true;
    fillGeo.attributes.position.needsUpdate = fillGeo.attributes.color.needsUpdate = true;
    ribbonGeo.computeBoundingSphere(); fillGeo.computeBoundingSphere();
    const xc = sp.w * Math.pow(-Math.log(TC / sp.A), 1 / sp.n);
    edgeDots.forEach((d, i) => d.position.set(i ? xc : -xc, PY0 + PS * TC, 0.01));
    guides.forEach((g, i) => {
      g.position.set(i ? xc : -xc, PY0 + PS * TC, 0);
      g.scale.set(1, PY0 + PS * TC - GH - 0.05, 1);
    });
  }

  // ---------------------------------------------------------------- labels
  const labels = [];
  function label(text, pos, { group, color = '#c7c7cc', scale = 0.24, minor = false } = {}) {
    const s = makeLabelSprite(text, { color, fontSize: 42, fontFamily: MONO, fontWeight: 500, scale, glow: false, background: 'rgba(0,0,0,0.6)', padding: 12 });
    s.position.copy(pos);
    Object.assign(s.userData, { base: s.scale.clone(), group, minor });
    labels.push(s); root.add(s);
    return s;
  }
  const xr = xMax - 1.2;
  label('FePt grains', v(1.2, GH + 1.0, zFront - 0.6), { group: 'intro', color: '#c9d3e3' });
  label('h-BN boundaries', v(-2.6, GH + 0.7, zFront - 0.3), { group: 'intro', color: '#bfe9ff' });
  label('seed layer', v(xr, Y_SEED / 2, zFull + 0.1), { group: 'intro', color: '#9aa3b2', scale: 0.2, minor: true });
  label('heat sink', v(xr, (Y_SEED + Y_SINK) / 2, zFull + 0.1), { group: 'intro', color: '#e0a070' });
  label('substrate', v(xr, (Y_SINK + Y_SUB) / 2, zFull + 0.1), { group: 'intro', color: '#8e8e93', scale: 0.2, minor: true });
  const lc = (dx, dy, dz) => v(TG.x + dx, dy, TG.z + dz);
  label('L1₀ FePt', lc(-0.25, GH + 0.16, 0.3), { group: 'atomic', color: '#d9dde3', scale: 0.1 });
  label('Fe', lc(-0.62, 0.62, 0.25), { group: 'atomic', color: '#e08a6a', scale: 0.1 });
  label('Pt', lc(-0.62, 0.45, 0.25), { group: 'atomic', color: '#d9dde3', scale: 0.1 });
  label('h-BN', lc(0.62, GH + 0.16, 0.1), { group: 'atomic', color: '#bfe9ff', scale: 0.1 });
  label('laser', v(0.95, GH + 4.2, 0), { group: 'heat', color: '#ff8a6a', scale: 0.26 });
  label('heat sink', v(-4.4, (Y_SEED + Y_SINK) / 2, FACE_Z + 0.08), { group: 'section', color: '#e0a070', scale: 0.22 });
  label('Tc', v(PX - 0.25, PY0 + PS * TC + 0.2, FACE_Z + 0.05), { group: 'profile', color: '#c7c7cc', scale: 0.22 });
  label('temperature', v(-PX + 1.0, PY0 + 0.25, FACE_Z + 0.05), { group: 'profile', color: '#fbb61a', scale: 0.2, minor: true });

  // ---------------------------------------------------------------- storyboard camera
  const T0 = v(TG.x + 0.22, 0.55, TG.z);
  const KEYS = [
    { p: 0.00, t: v(0, -0.3, 0), r: 23, yaw: 0.55, pitch: 0.6 },
    { p: 0.20, t: v(0.4, -0.2, 0.4), r: 20, yaw: 0.36, pitch: 0.52 },
    { p: 0.31, t: T0, r: 3.4, yaw: 0.32, pitch: 0.3 },
    { p: 0.46, t: T0, r: 3.1, yaw: 0.55, pitch: 0.24 },
    { p: 0.57, t: v(0, 0.3, 0), r: 12.5, yaw: 0.3, pitch: 0.8 },
    { p: 0.64, t: v(0, 0.3, 0), r: 11.5, yaw: 0.22, pitch: 0.74 },
    { p: 0.78, t: v(0, 0.1, 0.4), r: 10.8, yaw: 0.42, pitch: 0.38 },
    { p: 0.90, t: v(0, 0.85, 0.45), r: 13.2, yaw: 0.0, pitch: 0.1 },
    { p: 1.00, t: v(0, 0.85, 0.45), r: 12.6, yaw: -0.04, pitch: 0.1 },
  ];
  const view = { t: v(0, 0, 0), r: 10, yaw: 0, pitch: 0.5 };
  function viewAt(p) {
    let i = 1;
    while (i < KEYS.length - 1 && KEYS[i].p < p) i++;
    const k0 = KEYS[i - 1], k1 = KEYS[i];
    const u = easeInOut(clamp((p - k0.p) / ((k1.p - k0.p) || 1)));
    view.t.lerpVectors(k0.t, k1.t, u);
    view.r = Math.exp(lerp(Math.log(k0.r), Math.log(k1.r), u));
    view.yaw = lerp(k0.yaw, k1.yaw, u);
    view.pitch = lerp(k0.pitch, k1.pitch, u);
    return view;
  }

  let dragYaw = 0, dragPitch = 0, rMult = 1, small = false;
  let dragging = false, lastX = 0, lastY = 0, idleSince = 0, time = 2.4;
  let progT = 0, prog = 0;
  let bTarget = 1, mix = 1;      // boundary: 1 = h-BN, 0 = carbon
  const C_HBN = new THREE.Color(0xbfe9ff), C_CARBON = new THREE.Color(0x4a4d55);
  const E_HBN = new THREE.Color(0x7fd0ff), E_CARBON = new THREE.Color(0x000000);
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
  function placeCamera(dt) {
    const sway = reducedMotion ? 0 : 0.08 * Math.sin((time - idleSince) * 0.13) * clamp((time - idleSince - 1.5) / 3);
    const k = dt ? damp(8, dt) : 1;
    yawCur.v += (dragYaw + (dragging ? 0 : sway) - yawCur.v) * k;
    pitchCur.v += (dragPitch - pitchCur.v) * k;
    const vw = viewAt(prog);
    const r = vw.r * lerp(rMult, 1 + (rMult - 1) * 0.5, band(prog, 0.27, 0.31, 0.46, 0.5));
    const yaw = vw.yaw + yawCur.v, pitch = clamp(vw.pitch + pitchCur.v, 0.03, 1.3);
    camera.position.set(vw.t.x + r * Math.sin(yaw) * Math.cos(pitch), vw.t.y + r * Math.sin(pitch), vw.t.z + r * Math.cos(yaw) * Math.cos(pitch));
    camera.lookAt(vw.t);
  }

  // ---------------------------------------------------------------- per-frame state
  const euler = new THREE.Euler();
  function update(dt) {
    const p = prog;
    mix = reducedMotion || !dt ? bTarget : mix + (bTarget - mix) * damp(2.6, dt);
    if (Math.abs(mix - bTarget) < 1e-3) mix = bTarget;
    const m = mix;
    const cm = band(p, 0.25, 0.33, 0.45, 0.51);              // atomic close-up
    const heatOn = smoothstep(0.5, 0.6, p);
    const laser = smoothstep(0.49, 0.56, p) * (1 - 0.55 * smoothstep(0.8, 0.88, p));
    const cut = smoothstep(0.62, 0.77, p);
    const profA = smoothstep(0.8, 0.9, p);
    const sp = spotParams(m);
    const flick = reducedMotion ? 1 : 1 + 0.025 * Math.sin(time * 7.3) + 0.015 * Math.sin(time * 12.7);
    const tgHide = smoothstep(0.0, 0.45, cm);

    // grains, arrows
    const heat = heatAttr.array;
    for (let i = 0; i < NG; i++) {
      const c = cells[i];
      const T = heatOn * spotT(c.r, sp) * flick;
      heat[i] = T;
      const k = c.z > CUT_Z ? (c.z - CUT_Z) / (zFront - CUT_Z) : -1;
      const rm = k < 0 ? 0 : smoothstep(1 - k, 1 - k + 0.25, cut * 1.25);
      let s = c.sH * (1 - rm), sy = 1 - rm;
      if (i === target || i === nbr) { s *= 1 - tgHide; sy *= 1 - tgHide; }
      dummy.position.set(c.x, 0, c.z); dummy.quaternion.identity(); dummy.scale.set(Math.max(1e-4, s), Math.max(1e-4, sy), Math.max(1e-4, s));
      dummy.updateMatrix(); grains.setMatrixAt(i, dummy.matrix);
      // above Tc the magnetization loses order: the arrow shrinks, greys and wobbles
      const dis = smoothstep(TC - 0.1, TC + 0.05, T);
      const wob = reducedMotion ? 0.5 : Math.sin(time * 5.1 + c.ph * 7);
      euler.set((c.up ? 0 : Math.PI) + dis * 0.55 * wob, 0, dis * 0.55 * Math.cos(time * 4.3 + c.ph * 5));
      dummy.quaternion.setFromEuler(euler);
      const as = (1 - rm) * lerp(1, 0.45, dis) * (i === nbr ? 1 - tgHide : 1);
      dummy.position.set(c.x, GH + 0.08 + AL / 2 * (1 - rm), c.z);
      dummy.scale.setScalar(Math.max(1e-4, as));
      dummy.updateMatrix(); arrows.setMatrixAt(i, dummy.matrix);
      arrows.setColorAt(i, tmpC.copy(c.up ? C_UP : C_DOWN).lerp(C_HOT, dis));
    }
    heatAttr.needsUpdate = true;
    grains.instanceMatrix.needsUpdate = true;
    arrows.instanceMatrix.needsUpdate = true;
    arrows.instanceColor.needsUpdate = true;

    // grain-boundary walls: translucent h-BN (m = 1) or dark amorphous carbon (m = 0)
    const thick = 0.062;
    wallMat.color.copy(C_CARBON).lerp(C_HBN, m);
    wallMat.emissive.copy(E_CARBON).lerp(E_HBN, m);
    wallMat.opacity = lerp(0.82, 0.38, m);
    wallU.uRim.value = smoothstep(0.2, 1, m) * (reducedMotion ? 1 : 0.85 + 0.15 * Math.sin(time * 1.7));
    for (let i = 0; i < NW; i++) {
      const w = walls[i];
      const k = w.z > CUT_Z ? (w.z - CUT_Z) / (zFront + RI - CUT_Z) : -1;
      const rm = k < 0 ? 0 : smoothstep(1 - k, 1 - k + 0.25, cut * 1.25);
      let sy = 1 - rm;
      if (targetWalls.has(i)) sy *= 1 - smoothstep(0.1, 0.5, cm);
      dummy.position.set(w.x, 0, w.z); dummy.rotation.set(0, w.rotY, 0);
      dummy.scale.set(1, Math.max(1e-4, sy), Math.max(1e-4, thick * (sy > 1e-3 ? 1 : 0)));
      dummy.updateMatrix(); wallMesh.setMatrixAt(i, dummy.matrix);
    }
    dummy.rotation.set(0, 0, 0);
    wallMesh.instanceMatrix.needsUpdate = true;

    placeAtoms(cm);

    // layer stack, cut face, heat flow
    const zf = lerp(zFull, FACE_Z, smoothstep(0.15, 1, cut));
    placeLayers(zf);
    plume.visible = cut > 0.02 && heatOn > 0.01;
    plumeU.uOn.value = heatOn * smoothstep(0.3, 0.9, cut);
    plumeU.uAmp.value = lerp(0.55, 1.0, m) * flick;
    plumeU.uW.value = lerp(1.6, 0.68, m);
    plumeU.uTime.value = time;
    const flowA = heatOn * smoothstep(0.45, 1, cut);
    flowDown.forEach((s) => {
      const { ph, u } = s.userData;
      const l = reducedMotion ? ph : (time * 0.32 + ph) % 1;
      const y = lerp(GH - 0.15, Y_SINK + 0.05, l);
      const depth = clamp(-y / -Y_SINK);
      const w0 = lerp(1.2, 0.42, m);
      s.position.set(u * w0 * (1 + 1.6 * depth), y, FACE_Z + 0.03);
      s.material.opacity = flowA * lerp(0.55, 1, m) * smoothstep(0, 0.12, l) * (1 - smoothstep(0.75, 1, l)) * (1 - 0.5 * Math.abs(u));
      s.visible = s.material.opacity > 0.01;
    });
    flowSide.forEach((s) => {
      const { ph, side, y } = s.userData;
      const l = reducedMotion ? ph : (time * 0.28 + ph) % 1;
      s.position.set(side * lerp(0.35, 3.3, l), y, FACE_Z + 0.03);
      s.material.opacity = flowA * (1 - m) * smoothstep(0, 0.1, l) * (1 - l);
      s.visible = s.material.opacity > 0.01;
    });

    // laser
    beamU.uOn.value = laser * (reducedMotion ? 1 : 0.92 + 0.08 * Math.sin(time * 9));
    beam.visible = laser > 0.005;
    spotGlow.material.opacity = 0.75 * laser;
    spotCore.material.opacity = 0.9 * laser;
    spotGlow.scale.setScalar(lerp(2.6, 1.9, m));

    // profile
    prof.visible = profA > 0.005;
    if (prof.visible) {
      buildProfile(m);
      ribbonMat.opacity = profA; fillMat.opacity = profA;
      axisMat.opacity = 0.5 * profA; tcMat.opacity = 0.75 * profA;
      guideMat.opacity = 0.7 * profA;
      edgeDots.forEach((d) => { d.material.opacity = profA * (reducedMotion ? 0.9 : 0.75 + 0.25 * Math.sin(time * 3)); });
    }

    // labels
    const alpha = {
      intro: band(p, 0.03, 0.09, 0.19, 0.24),
      atomic: band(p, 0.33, 0.37, 0.45, 0.49),
      heat: band(p, 0.55, 0.6, 0.7, 0.76),
      section: smoothstep(0.74, 0.8, p),
      profile: profA,
    };
    for (const s of labels) {
      const a = alpha[s.userData.group];
      s.material.opacity = a;
      s.visible = a > 0.01 && !(small && s.userData.minor);
    }
  }

  // ---------------------------------------------------------------- render
  function render(_t, dt) {
    if (!reducedMotion) time += dt;
    prog = reducedMotion || !dt ? progT : prog + (progT - prog) * damp(6, dt);
    update(dt);
    placeCamera(dt);
    renderer.render(scene, camera);
  }
  const loop = createLoop(render);
  const renderOnce = () => render(0, 0);

  function resize() {
    const width = canvas.clientWidth || 1, height = canvas.clientHeight || 1;
    const aspect = width / height;
    renderer.setSize(width, height, false);
    fitCameraToAspect(camera, aspect, { refAspect: 1.6, maxFov: 62 });
    rMult = aspect < 0.8 ? 1.3 : aspect < 1.3 ? 1.12 : 1;
    small = width < 640;
    const ls = small ? 1.4 : 1;
    labels.forEach((s) => s.scale.copy(s.userData.base).multiplyScalar(ls));
    if (!loop.running) renderOnce();
  }
  const unobserve = observeResize(canvas, resize);
  resize();

  return {
    setProgress(pv) { progT = clamp(pv); if (!loop.running) renderOnce(); },
    setParam(name, value) {
      if (name !== 'boundary') return;
      bTarget = value === 'carbon' ? 0 : 1;        // 'hbn' and 'auto' → h-BN
      if (!loop.running) renderOnce();
    },
    resize,
    start() { if (reducedMotion) { renderOnce(); return; } loop.start(); },
    stop() { loop.stop(); },
    dispose() {
      loop.stop(); unobserve();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      disposeObject(scene); envTex.dispose(); pmrem.dispose();
      renderer.dispose();
    },
  };
}
