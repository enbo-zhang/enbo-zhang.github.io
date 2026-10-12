// three-omega.js — Scene C: "Measuring heat across 2D layers" (differential 3ω method).
// Sample: Si substrate, [h-BN/FePt]×N multilayer, thin insulator, gold heater line with 4 pads
// (outer pair carries the current, inner pair senses the voltage). The front half of the chip is a
// ghosted cut-away so the cross-section under the heater line is visible.
// Storyboard (progress p):
//   0.00–0.20  the sample, slowly turning; layer stack labelled
//   0.20–0.45  AC current at ω sloshes along the line; heating at 2ω sends thermal waves (half-cylinder
//              shells) into the film and the Si; a panel shows I (ω), T (2ω), V (3ω)
//   0.45–0.70  a reference chip (same heater, no multilayer) joins; the heater on the film runs hotter;
//              the panel compares the two temperature rises → "ΔT film"
//   0.70–1.00  dive into the cut face: FePt | h-BN sheets | FePt, atoms; phonon packets coming down from
//              the heater side mostly bounce at the van der Waals gap, a few cross
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  clamp, damp, lerp, smoothstep, easeInOut, createRenderer, makeLabelSprite, makeGlowSprite, makeArrow,
  setArrowDirection, observeResize, fitCameraToAspect, createLoop, disposeObject,
} from './common.js';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const TAU = Math.PI * 2;

// chip geometry (world units, thicknesses exaggerated)
const W = 4, D = 2.8, SI = 1.2;            // width (x), depth (z), Si thickness
const NP = 7, PER = 0.1, HF = 0.32;        // periods, period thickness, h-BN fraction of a period
const TF = NP * PER;                       // multilayer thickness
const INS = 0.04, HT = 0.035;              // insulator, heater thickness
const LINE_W = 0.1, LINE_L = 2.2;          // heater line (runs along z)
const FREQ = 0.5;                          // current frequency (Hz, visual)
const DT_FILM = 0.9;                       // extra heater temperature from the film (ref heater = 1)
const T_NORM = 1 + DT_FILM;
const LAM = 0.72, KSLOW = 1.6, LDEC = 0.95; // thermal wavelength, film slowness, decay length

// inferno-like heat map
const HEAT_HEX = ['#1b0c41', '#781c6d', '#ed6925', '#fbb61a', '#fcffa4'];
const HEAT = HEAT_HEX.map((c) => new THREE.Color(c));
function heatColor(t, out) {
  t = clamp(t) * 4;
  const i = Math.min(3, Math.floor(t));
  return out.copy(HEAT[i]).lerp(HEAT[i + 1], t - i);
}
const glslVec = (c) => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
const HEAT_GLSL = `
  vec3 heatMap(float t) {
    t = clamp(t, 0.0, 1.0) * 4.0;
    vec3 c0 = ${glslVec(HEAT[0])}, c1 = ${glslVec(HEAT[1])}, c2 = ${glslVec(HEAT[2])}, c3 = ${glslVec(HEAT[3])}, c4 = ${glslVec(HEAT[4])};
    if (t < 1.0) return mix(c0, c1, t);
    if (t < 2.0) return mix(c1, c2, t - 1.0);
    if (t < 3.0) return mix(c2, c3, t - 2.0);
    return mix(c3, c4, t - 3.0);
  }`;

/** Polyline with arc-length lookup. */
function polyline(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum[cum.length - 1];
  return {
    total,
    at(s, out) {
      s = clamp(s, 0, total);
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      return out.lerpVectors(pts[i - 1], pts[i], (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1));
    },
  };
}

export function createScene(canvas, options = {}) {
  const reducedMotion = !!options.reducedMotion;
  const renderer = createRenderer(canvas);
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 2, 0.02, 80);
  scene.add(camera);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const textures = [];
  function addLights(s) {
    s.environment = envTex;
    s.add(new THREE.HemisphereLight(0xcfe8ff, 0x05060a, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 6, 5); s.add(key);
    const rim = new THREE.DirectionalLight(0x7fb0ff, 0.9); rim.position.set(-4, 2, -5); s.add(rim);
  }
  addLights(scene);

  const M = {
    si: new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 0.35, roughness: 0.45 }),
    fept: new THREE.MeshStandardMaterial({ color: 0x8e9bb0, metalness: 0.85, roughness: 0.32 }),
    hbn: new THREE.MeshStandardMaterial({ color: 0xbfe9ff, emissive: 0x4f8fb0, emissiveIntensity: 0.35, metalness: 0, roughness: 0.25 }),
    ins: new THREE.MeshStandardMaterial({ color: 0xe8eef7, metalness: 0, roughness: 0.2, transparent: true, opacity: 0.75 }),
    stage: new THREE.MeshStandardMaterial({ color: 0x07080b, metalness: 0.3, roughness: 0.7, envMapIntensity: 0.3 }),
  };
  const ghostMat = (color, opacity) => new THREE.MeshStandardMaterial({
    color, metalness: 0, roughness: 0.15, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide,
  });
  const G = { si: ghostMat(0x6d7a90, 0.07), film: ghostMat(0x9fc4dc, 0.1), ins: ghostMat(0xe8eef7, 0.12) };
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.28, depthWrite: false });
  const layerLineMat = new THREE.LineBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.22, depthWrite: false });
  const rimMat = new THREE.MeshBasicMaterial({ color: 0x64d2ff, toneMapped: false, transparent: true, opacity: 0.7 });

  // ---------------------------------------------------------------- chip builder
  function makeChip(film) {
    const g = new THREE.Group();
    const tf = film ? TF : 0;
    const yIns = tf + INS, yTop = yIns + HT;
    const add = (m) => { g.add(m); return m; };
    // back half: solid layers
    function solid(y0, y1, mat) {
      const m = add(new THREE.Mesh(new THREE.BoxGeometry(W, y1 - y0, D / 2), mat));
      m.position.set(0, (y0 + y1) / 2, -D / 4);
    }
    solid(-SI, 0, M.si);
    if (film) for (let i = 0; i < NP; i++) { solid(i * PER, i * PER + PER * HF, M.hbn); solid(i * PER + PER * HF, (i + 1) * PER, M.fept); }
    solid(tf, yIns, M.ins);
    // front half: ghost (cut-away)
    function ghost(y0, y1, mat) {
      const m = add(new THREE.Mesh(new THREE.BoxGeometry(W, y1 - y0, D / 2), mat));
      m.position.set(0, (y0 + y1) / 2, D / 4); m.renderOrder = 1;
    }
    ghost(-SI, 0, G.si);
    if (film) ghost(0, tf, G.film);
    ghost(tf, yIns, G.ins);
    const outline = add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(W, SI + yIns, D / 2)), edgeMat));
    outline.position.set(0, (yIns - SI) / 2, D / 4);
    if (film) {   // faint period lines on the ghost's outer faces
      const pts = [];
      for (let i = 1; i < NP * 2; i++) {
        const y = Math.floor(i / 2) * PER + (i % 2 ? PER * HF : 0);
        pts.push(-W / 2, y, D / 2, W / 2, y, D / 2, W / 2, y, 0, W / 2, y, D / 2);
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      add(new THREE.LineSegments(geo, layerLineMat));
    }
    // glowing rim around the cut face
    const rim = (x, y, w, h) => { const m = add(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), rimMat)); m.position.set(x, y, 0.004); };
    const fh = SI + yIns, fy = (yIns - SI) / 2;
    rim(0, yIns, W, 0.012); rim(0, -SI, W, 0.012); rim(-W / 2, fy, 0.012, fh); rim(W / 2, fy, 0.012, fh);

    // cross-section face: layers + temperature field (thermal waves at 2ω)
    const faceU = {
      uTime: { value: 0 }, uOn: { value: 0 }, uTf: { value: Math.max(tf, 1e-3) }, uDT: { value: film ? DT_FILM : 0 },
      uPer: { value: PER }, uHf: { value: HF }, uIns: { value: yIns }, uFilm: { value: film ? 1 : 0 },
      cSi: { value: new THREE.Color(0x1f2430) }, cH: { value: new THREE.Color(0x9fd6f2) }, cF: { value: new THREE.Color(0x6b7890) },
      cIns: { value: new THREE.Color(0xd8e0ea) },
    };
    const faceGeo = new THREE.PlaneGeometry(W, fh, 1, 1); faceGeo.translate(0, fy, 0);
    const faceMat = new THREE.ShaderMaterial({
      uniforms: faceU, toneMapped: false,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        varying vec2 vP;
        uniform float uTime, uOn, uTf, uDT, uPer, uHf, uIns, uFilm;
        uniform vec3 cSi, cH, cF, cIns;
        ${HEAT_GLSL}
        void main() {
          float x = vP.x, y = vP.y;
          float tf = uTf * uFilm;
          vec3 col;
          if (y < 0.0) col = cSi * (0.7 + 0.5 * smoothstep(-${SI.toFixed(2)}, 0.0, y));
          else if (y < tf) {
            float f = fract(y / uPer);
            col = f < uHf ? cH : cF;
            float e = min(abs(f - uHf), min(f, 1.0 - f)) * uPer;
            col += vec3(0.25, 0.35, 0.45) * (1.0 - smoothstep(0.0, 0.004, e));
          } else col = cIns;
          // temperature amplitude: Si spreading + series drop across the film (low cross-plane k)
          float dFilm = clamp(tf - y, 0.0, tf);
          float dSi = max(-y, 0.0);
          float Tsi = exp(-sqrt(x * x + dSi * dSi + 0.004) / ${LDEC.toFixed(3)});
          float frac = uFilm > 0.5 ? dFilm / uTf : 1.0;
          float w = 0.14 + 0.3 * frac;
          float Tf = uDT * (1.0 - frac) * exp(-x * x / (w * w));
          float T = (Tsi + Tf) / ${T_NORM.toFixed(3)};
          // thermal wave: slower (shorter wavelength) across the film
          float dv = dFilm * ${KSLOW.toFixed(3)} + dSi;
          float reff = sqrt(x * x + dv * dv);
          float ph = 6.2831853 * (2.0 * ${FREQ.toFixed(3)} * uTime - reff / ${LAM.toFixed(3)});
          float h = uOn * T * (0.62 + 0.38 * cos(ph));
          vec3 hc = heatMap(h * 1.05);
          col = mix(col, hc, smoothstep(0.04, 0.42, h) * 0.88);
          float crest = pow(0.5 + 0.5 * cos(ph), 10.0) * uOn * smoothstep(0.02, 0.3, T);
          col += hc * crest * 0.55;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const face = add(new THREE.Mesh(faceGeo, faceMat));
    face.position.z = 0.0015;

    // isotherm shells (half cylinders under the line, in the cut-away half), expanding at 2ω
    const shellGeo = new THREE.CylinderGeometry(1, 1, D / 2 * 0.86, 64, 1, true, -Math.PI / 2, Math.PI);
    shellGeo.rotateX(Math.PI / 2); shellGeo.translate(0, 0, D / 4 * 0.86);
    const shells = [];
    for (let k = 0; k < 3; k++) {
      const u = { uR: { value: 0.5 }, uTf: { value: tf }, uA: { value: 0 }, uColor: { value: new THREE.Color() } };
      const mat = new THREE.ShaderMaterial({
        uniforms: u, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
        vertexShader: `
          uniform float uR, uTf; varying vec3 vL;
          void main() {
            float x = uR * position.x;
            float dv = uR * (-position.y);
            float k = ${KSLOW.toFixed(3)};
            float y = dv < uTf * k ? uTf - dv / k : -(dv - uTf * k);
            vL = vec3(x, y, position.z);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(vL, 1.0);
          }`,
        fragmentShader: `
          uniform float uA; uniform vec3 uColor; varying vec3 vL;
          void main() {
            if (vL.y < -${SI.toFixed(3)} || abs(vL.x) > ${(W / 2).toFixed(3)}) discard;
            float a = uA * (1.0 - smoothstep(${(D / 4).toFixed(3)}, ${(D / 2 * 0.86).toFixed(3)}, vL.z));
            gl_FragColor = vec4(uColor, a);
            #include <colorspace_fragment>
          }`,
      });
      const m = add(new THREE.Mesh(shellGeo, mat));
      m.renderOrder = 2;
      shells.push(u);
    }

    // heater line + leads + 4 pads (outer: current, inner: voltage)
    const heaterMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.28, emissive: 0x000000 });
    const padMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 1, roughness: 0.32 });
    const hy = yIns + HT / 2;
    function bar(x0, z0, x1, z1, w, mat) {
      const m = add(new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) + w, HT, Math.abs(z1 - z0) + w), mat));
      m.position.set((x0 + x1) / 2, hy, (z0 + z1) / 2);
      return m;
    }
    const zI = LINE_L / 2, zV = 0.55, xI = -1.25, xV = 1.25, PAD = 0.46;
    bar(0, -zI, 0, zI, LINE_W, heaterMat);
    for (const s of [-1, 1]) {
      bar(xI, s * zI, 0, s * zI, 0.07, padMat);
      bar(0, s * zV, xV, s * zV, 0.05, padMat);
      add(new THREE.Mesh(new THREE.BoxGeometry(PAD, HT * 1.2, PAD), padMat)).position.set(xI - PAD / 2, hy, s * zI);
      add(new THREE.Mesh(new THREE.BoxGeometry(PAD, HT * 1.2, PAD), padMat)).position.set(xV + PAD / 2, hy, s * zV);
    }
    // heater glow
    const glows = [];
    for (let i = 0; i < 6; i++) {
      const s = add(makeGlowSprite(0xed6925, { size: 0.55, opacity: 0 }));
      s.position.set(0, yTop + 0.03, lerp(-zI * 0.9, zI * 0.9, i / 5));
      glows.push(s);
    }
    // current: dots sloshing back and forth at ω through the current leads and the line
    const path = polyline([v(xI, yTop + 0.012, zI), v(0, yTop + 0.012, zI), v(0, yTop + 0.012, -zI), v(xI, yTop + 0.012, -zI)]);
    const NDOT = 22, gap = path.total / NDOT;
    const dots = [];
    for (let i = 0; i < NDOT; i++) dots.push(add(makeGlowSprite(0xfff1c9, { size: 0.1, opacity: 0 })));
    // stage disc with glowing rim
    const stage = add(new THREE.Mesh(new THREE.CylinderGeometry(2.75, 2.85, 0.06, 64), M.stage));
    stage.position.y = -SI - 0.04;
    const ring = add(new THREE.Mesh(new THREE.TorusGeometry(2.8, 0.008, 6, 128), rimMat));
    ring.rotation.x = Math.PI / 2; ring.position.y = -SI - 0.01;

    const tmp = new THREE.Color();
    const tHeat = film ? T_NORM : 1;
    function update(time, on, shellA) {
      faceU.uTime.value = time; faceU.uOn.value = on;
      const osc = Math.cos(TAU * 2 * FREQ * time);
      const th = on * (tHeat / T_NORM) * (0.62 + 0.38 * osc);
      heatColor(th, tmp);
      heaterMat.emissive.copy(tmp); heaterMat.emissiveIntensity = 1.6 * th;
      glows.forEach((s) => { s.material.color.copy(tmp); s.material.opacity = 0.9 * th; s.scale.setScalar(0.35 + 0.35 * th); });
      const off = 0.32 * Math.sin(TAU * FREQ * time);
      dots.forEach((s, i) => {
        const d = ((i + 0.5) * gap + off + path.total) % path.total;
        path.at(d, s.position);
        s.material.opacity = on * 0.95 * clamp(d / 0.2) * clamp((path.total - d) / 0.2);
        s.visible = on > 0.01;
      });
      const ph = (2 * FREQ * time) % 1;
      shells.forEach((u, k) => {
        const R = LAM * (ph + k);
        u.uR.value = Math.max(0.02, R);
        const f = (1 - R / (3 * LAM)) * smoothstep(0, 0.2, R);
        u.uA.value = shellA * f * (film ? 0.55 : 0.4);
        heatColor(0.35 + 0.55 * (1 - R / (3 * LAM)) * (film ? 1 : 0.7), u.uColor.value);
      });
    }
    return { group: g, update, yTop, yIns, zI, zV, xI, xV, PAD };
  }

  const sample = makeChip(true);
  scene.add(sample.group);
  const ref = makeChip(false);
  scene.add(ref.group);

  // ---------------------------------------------------------------- labels
  const labels = [];
  function label(text, pos, { color = '#c7c7cc', scale = 0.17, parent = scene, show = [0, 0.5], minor = false } = {}) {
    const s = makeLabelSprite(text, {
      color, fontSize: 42, fontFamily: MONO, fontWeight: 500, scale, glow: false, background: 'rgba(0,0,0,0.6)', padding: 12,
    });
    s.position.copy(pos);
    Object.assign(s.userData, { base: s.scale.clone(), show, minor });
    labels.push(s);
    parent.add(s);
    return s;
  }
  const sg = sample.group, rg = ref.group;
  label('[h-BN/FePt]×N', v(W / 2 + 0.95, TF / 2, 0.05), { color: '#bfe9ff', parent: sg, show: [0, 0.47] });
  label('Si', v(W / 2 + 0.4, -SI / 2, 0.05), { parent: sg, show: [0, 0.47], minor: true });
  label('insulator', v(-W / 2 - 0.6, TF + INS, 0.05), { color: '#8e8e93', parent: sg, show: [0.02, 0.22], minor: true });
  label('heater', v(0.05, sample.yTop + 0.28, -sample.zI - 0.1), { color: '#e6c766', parent: sg, show: [0, 0.24] });
  label('I · ω', v(sample.xI + sample.PAD / 2 + 0.15, sample.yTop + 0.25, sample.zI), { color: '#fff1c9', parent: sg, show: [0.2, 0.47] });
  label('V · 3ω', v(sample.xV + sample.PAD / 2, sample.yTop + 0.25, sample.zV), { color: '#64d2ff', parent: sg, show: [0.2, 0.47] });
  label('sample', v(0, sample.yTop + 0.7, -0.6), { color: '#f5f5f7', scale: 0.3, parent: sg, show: [0.5, 0.71] });
  label('reference · no film', v(0, ref.yTop + 0.7, -0.6), { color: '#f5f5f7', scale: 0.3, parent: rg, show: [0.5, 0.71] });
  // bracket for the multilayer on the cut face
  const brMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff, toneMapped: false, transparent: true, opacity: 0.9 });
  const bracket = new THREE.Group(); sg.add(bracket);
  const bpart = (x, y, w, h) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.01), brMat); m.position.set(x, y, 0.01); bracket.add(m); };
  bpart(W / 2 + 0.14, TF / 2, 0.014, TF); bpart(W / 2 + 0.09, 0, 0.1, 0.014); bpart(W / 2 + 0.09, TF, 0.1, 0.014);

  // ---------------------------------------------------------------- HUD panel (attached to the camera)
  const PW = 640, PH = 400;
  const pCanvas = document.createElement('canvas'); pCanvas.width = PW; pCanvas.height = PH;
  const pg = pCanvas.getContext('2d');
  const pTex = new THREE.CanvasTexture(pCanvas); pTex.colorSpace = THREE.SRGBColorSpace; pTex.anisotropy = 4;
  textures.push(pTex);
  const panelMat = new THREE.MeshBasicMaterial({ map: pTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), panelMat);
  panel.renderOrder = 20;
  camera.add(panel);
  const HUD_D = 4;
  function rrect(x, y, w, h, r) {
    pg.beginPath(); pg.moveTo(x + r, y); pg.arcTo(x + w, y, x + w, y + h, r); pg.arcTo(x + w, y + h, x, y + h, r);
    pg.arcTo(x, y + h, x, y, r); pg.arcTo(x, y, x + w, y, r); pg.closePath();
  }
  function drawPanel(aA, aB, grow, time) {
    pg.clearRect(0, 0, PW, PH);
    pg.globalAlpha = 1;
    rrect(6, 6, PW - 12, PH - 12, 26);
    pg.fillStyle = 'rgba(8,10,16,0.78)'; pg.fill();
    pg.lineWidth = 2; pg.strokeStyle = 'rgba(120,170,220,0.35)'; pg.stroke();
    pg.font = `500 22px ${MONO}`; pg.textBaseline = 'middle';
    if (aA > 0.01) {
      pg.globalAlpha = aA;
      pg.fillStyle = '#8e8e93'; pg.textAlign = 'left';
      pg.fillText('heater signals', 34, 40);
      const rows = [
        { name: 'I', tag: 'ω', color: '#fff1c9', f: (t) => Math.cos(TAU * FREQ * t) },
        { name: 'T', tag: '2ω', color: '#ed6925', f: (t) => Math.cos(TAU * 2 * FREQ * t - 0.6) },
        { name: 'V', tag: '3ω', color: '#64d2ff', f: (t) => 0.55 * Math.cos(TAU * 3 * FREQ * t - 0.6) },
      ];
      const x0 = 170, x1 = PW - 36, span = 2.4;
      rows.forEach((r, i) => {
        const yc = 112 + i * 104, amp = 34;
        pg.strokeStyle = 'rgba(255,255,255,0.1)'; pg.lineWidth = 1.5;
        pg.beginPath(); pg.moveTo(x0, yc); pg.lineTo(x1, yc); pg.stroke();
        pg.font = `600 30px ${MONO}`; pg.fillStyle = '#f5f5f7'; pg.textAlign = 'left';
        pg.fillText(r.name, 38, yc);
        pg.font = `500 26px ${MONO}`; pg.fillStyle = r.color;
        pg.fillText(r.tag, 78, yc);
        pg.strokeStyle = r.color; pg.lineWidth = 3.5; pg.shadowColor = r.color; pg.shadowBlur = 10;
        pg.beginPath();
        for (let k = 0; k <= 160; k++) {
          const tt = time - span + (span * k) / 160;
          const x = lerp(x0, x1, k / 160), y = yc - amp * r.f(tt);
          if (k) pg.lineTo(x, y); else pg.moveTo(x, y);
        }
        pg.stroke(); pg.shadowBlur = 0;
      });
    }
    if (aB > 0.01) {
      pg.globalAlpha = aB;
      pg.fillStyle = '#8e8e93'; pg.textAlign = 'left'; pg.font = `500 22px ${MONO}`;
      pg.fillText('heater temperature rise', 34, 40);
      const base = 338, hRef = 118 * grow, hExtra = 112 * grow;
      const flick = 1 + 0.03 * Math.cos(TAU * 2 * FREQ * time);
      pg.strokeStyle = 'rgba(255,255,255,0.18)'; pg.lineWidth = 2;
      pg.beginPath(); pg.moveTo(60, base); pg.lineTo(PW - 60, base); pg.stroke();
      // reference
      let gr = pg.createLinearGradient(0, base, 0, base - hRef);
      gr.addColorStop(0, '#781c6d'); gr.addColorStop(1, '#ed6925');
      pg.fillStyle = gr; pg.fillRect(120, base - hRef * flick, 120, hRef * flick);
      // sample = same Si part + the film's extra
      pg.fillStyle = gr; pg.fillRect(320, base - hRef * flick, 120, hRef * flick);
      gr = pg.createLinearGradient(0, base - hRef, 0, base - hRef - hExtra);
      gr.addColorStop(0, '#fbb61a'); gr.addColorStop(1, '#fcffa4');
      pg.shadowColor = '#fbb61a'; pg.shadowBlur = 18;
      pg.fillStyle = gr; pg.fillRect(320, base - (hRef + hExtra) * flick, 120, hExtra * flick);
      pg.shadowBlur = 0;
      // dashed line at reference level + bracket
      pg.setLineDash([8, 8]); pg.strokeStyle = 'rgba(255,255,255,0.45)';
      pg.beginPath(); pg.moveTo(240, base - hRef * flick); pg.lineTo(460, base - hRef * flick); pg.stroke(); pg.setLineDash([]);
      if (grow > 0.3) {
        const yA = base - hRef * flick, yB = base - (hRef + hExtra) * flick;
        pg.strokeStyle = '#fcffa4'; pg.lineWidth = 3;
        pg.beginPath(); pg.moveTo(462, yA); pg.lineTo(474, yA); pg.lineTo(474, yB); pg.lineTo(462, yB); pg.stroke();
        pg.fillStyle = '#fcffa4'; pg.font = `600 26px ${MONO}`;
        pg.fillText('ΔT film', 488, (yA + yB) / 2);
      }
      pg.font = `500 22px ${MONO}`; pg.fillStyle = '#c7c7cc'; pg.textAlign = 'center';
      pg.fillText('reference', 180, base + 30); pg.fillText('sample', 380, base + 30);
    }
    pg.globalAlpha = 1;
    pTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- micro scene: the interface
  const micro = new THREE.Scene();
  addLights(micro);
  const mcam = new THREE.PerspectiveCamera(34, 2, 0.05, 60);
  const atoms = [];   // {x,y,z, mesh, idx, base: Color}
  const SP = 0.2, DY = 0.19, NPL = 5, GAPV = 0.42, SHEET = 0.33;
  const XB = 1.7, ZB = 0.8;
  const sheetY = [-SHEET, 0, SHEET];
  const topY0 = SHEET + GAPV, botY0 = -SHEET - GAPV;          // planes nearest the gap
  const FE = new THREE.Color(0xc86b4a), PT = new THREE.Color(0xd9dde3), BB = new THREE.Color(0xffb3c1), NN = new THREE.Color(0x7fa7ff);
  const spec = { fe: [], pt: [], b: [], n: [] };
  for (const [y0, dir] of [[topY0, 1], [botY0, -1]]) {
    for (let j = 0; j < NPL; j++) {
      const y = y0 + dir * j * DY;
      for (let i = -8; i <= 8; i++) for (let k = -4; k <= 4; k++) {
        if ((i + k + j) % 2 !== 0) continue;
        (j % 2 === 0 ? spec.fe : spec.pt).push([i * SP, y, k * SP]);
      }
    }
  }
  const BL = 0.17, A1 = Math.sqrt(3) * BL;
  const bondPts = [];
  sheetY.forEach((y, si) => {
    for (let r = -4; r <= 4; r++) for (let c = -7; c <= 7; c++) {
      const bx = c * A1 + (r % 2 ? A1 / 2 : 0), bz = r * 1.5 * BL;
      const pA = [bx, y, bz], pB = [bx, y, bz + BL];
      if (Math.abs(bx) > XB || bz + BL > ZB + 0.1 || bz < -ZB - 0.1) continue;
      const [s1, s2] = si % 2 ? ['n', 'b'] : ['b', 'n'];   // AA' stacking: B over N
      spec[s1].push(pA); spec[s2].push(pB);
      bondPts.push(...pA, ...pB);
      // bonds from pB up-left/up-right to next row's atoms
      for (const dx of [-A1 / 2, A1 / 2]) {
        const q = [bx + dx, y, bz + 1.5 * BL];
        if (Math.abs(q[0]) <= XB && q[2] <= ZB + 0.1) bondPts.push(...pB, ...q);
      }
    }
  });
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  const iMeshes = {};
  const dummy = new THREE.Object3D();
  for (const [key, list, rad, col] of [['fe', spec.fe, 0.08, FE], ['pt', spec.pt, 0.095, PT], ['b', spec.b, 0.055, BB], ['n', spec.n, 0.06, NN]]) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: key === 'pt' ? 0.6 : 0.2, roughness: 0.35, emissive: col, emissiveIntensity: key === 'b' || key === 'n' ? 0.35 : 0.12 });
    const im = new THREE.InstancedMesh(sphere, mat, list.length);
    list.forEach((p, i) => {
      dummy.position.set(p[0], p[1], p[2]); dummy.scale.setScalar(rad); dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix); im.setColorAt(i, col);
      atoms.push({ x: p[0], y: p[1], z: p[2], im, i, rad, col });
    });
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    micro.add(im);
    iMeshes[key] = im;
  }
  const bondGeo = new THREE.BufferGeometry(); bondGeo.setAttribute('position', new THREE.Float32BufferAttribute(bondPts, 3));
  micro.add(new THREE.LineSegments(bondGeo, new THREE.LineBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.45 })));
  for (const y of sheetY) {
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(2 * XB, 2 * ZB), new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide }));
    pl.rotation.x = -Math.PI / 2; pl.position.y = y; micro.add(pl);
  }
  // van der Waals gaps: faint glowing slabs with edge outlines
  const gapMat = new THREE.MeshBasicMaterial({ color: 0x64d2ff, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const gapEdge = new THREE.LineBasicMaterial({ color: 0x64d2ff, transparent: true, opacity: 0.55, toneMapped: false });
  for (const yc of [(SHEET + topY0) / 2, -(SHEET + topY0) / 2]) {
    const bg = new THREE.BoxGeometry(2 * XB + 0.2, GAPV - 0.16, 2 * ZB + 0.2);
    const m = new THREE.Mesh(bg, gapMat); m.position.y = yc; micro.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(bg), gapEdge); e.position.y = yc; micro.add(e);
  }
  const mLabels = [];
  const mLabel = (text, pos, color = '#c7c7cc', sc = 0.24) => {
    const s = makeLabelSprite(text, { color, fontSize: 42, fontFamily: MONO, fontWeight: 500, scale: sc, glow: false, background: 'rgba(0,0,0,0.6)', padding: 12 });
    s.position.copy(pos); s.userData.base = s.scale.clone(); micro.add(s); mLabels.push(s); return s;
  };
  const topMid = topY0 + DY * 2, botMid = botY0 - DY * 2;
  mLabel('FePt', v(-XB - 0.55, topMid, 0), '#c8d2e0');
  mLabel('h-BN', v(-XB - 0.55, 0, 0), '#bfe9ff');
  mLabel('FePt', v(-XB - 0.55, botMid, 0), '#c8d2e0');
  mLabel('van der Waals gap', v(XB + 0.2, (SHEET + topY0) / 2 + 0.02, ZB + 0.25), '#64d2ff');
  mLabel('heat from heater', v(XB - 0.2, topY0 + DY * 4 + 0.75, 0), '#fbb61a', 0.2);
  const heatArrow = makeArrow(0xed6925, 0.5, { shaftRadius: 0.025, headRadius: 0.075, emissive: 1.2 });
  setArrowDirection(heatArrow, v(0, -1, 0));
  heatArrow.position.set(XB - 0.2, topY0 + DY * 4 + 0.6, 0);
  micro.add(heatArrow);

  // phonon packets: come down from the hot FePt, mostly reflect at the gap, a few cross
  const NPK = 14, PK_SPEED = 0.8;
  const Y_START = topY0 + DY * 4 + 0.15, Y_GAP1 = topY0 - 0.04, Y_GAP2 = botY0 + 0.04, Y_END = botY0 - DY * 4 - 0.15;
  const hash = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const packets = [];
  for (let i = 0; i < NPK; i++) {
    const trail = [];
    for (let k = 0; k < 4; k++) {
      const s = makeGlowSprite(k === 0 ? 0xfcffa4 : 0xed6925, { size: k === 0 ? 0.7 : 0.5 - k * 0.08, opacity: 0, depthTest: false });
      s.renderOrder = 8;
      micro.add(s); trail.push(s);
    }
    packets.push({ trail, phase: hash(i, 0.5) * 5, cycle: 4.6 + hash(i, 1.3) * 1.2, pos: v(0, 0, 0), a: 0, dir: v(0, -1, 0) });
  }
  // distance s along a packet's path → y (and whether it is moving down) for a cycle outcome
  function packetY(s, tr1, tr2) {
    const d1 = Y_START - Y_GAP1;
    if (s <= d1) return [Y_START - s, -1, s / 0.15, 1];
    if (!tr1) { const y = Y_GAP1 + (s - d1); return [y, 1, 1, (Y_START - y) / 0.3]; }
    const d2 = d1 + (Y_GAP1 - Y_GAP2);
    if (s <= d2) return [Y_GAP1 - (s - d1), -1, 1, 1];
    if (!tr2) { const y = Y_GAP2 + (s - d2); return [y, 1, 1, (0 - y) / 0.25]; }
    const y = Y_GAP2 - (s - d2); return [y, -1, 1, (y - Y_END) / 0.3];
  }
  function updatePackets(time) {
    packets.forEach((pk, i) => {
      const tt = time + pk.phase;
      const cyc = Math.floor(tt / pk.cycle);
      const sNow = (tt - cyc * pk.cycle) * PK_SPEED;
      const tr1 = hash(i * 3.1, cyc) < 0.18, tr2 = hash(i * 5.7, cyc + 0.3) < 0.5;
      const x0 = (hash(i, cyc + 7) * 2 - 1) * 1.1, z0 = (hash(i + 9, cyc) * 2 - 1) * 0.55;
      const dx = (hash(i + 4, cyc + 2) * 2 - 1) * 0.35;
      pk.trail.forEach((s, k) => {
        const sk = sNow - k * 0.09;
        if (sk < 0) { s.visible = false; return; }
        const [y, vy, fin, fout] = packetY(sk, tr1, tr2);
        const a = clamp(fin) * clamp(fout);
        s.visible = a > 0.01;
        s.position.set(x0 + dx * sk, y, z0);
        s.material.opacity = a * (k === 0 ? 1 : 0.55 - k * 0.12);
        if (k === 0) { pk.pos.copy(s.position); pk.a = a; pk.dir.set(dx, vy, 0).normalize(); }
      });
    });
  }
  const tmpC = new THREE.Color(), hotC = new THREE.Color(0xfbb61a);
  function updateAtoms(time) {
    for (const at of atoms) {
      let w = 0, dxs = 0, dys = 0;
      for (const pk of packets) {
        if (pk.a < 0.02) continue;
        const ddx = at.x - pk.pos.x, ddy = at.y - pk.pos.y, ddz = at.z - pk.pos.z;
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
        if (d2 > 0.5) continue;
        const e = Math.exp(-d2 / 0.09) * pk.a;
        const osc = Math.sin(40 * (ddx * pk.dir.x + ddy * pk.dir.y) - time * 20);
        w += e; dxs += e * osc * pk.dir.x; dys += e * osc * pk.dir.y;
      }
      const amp = reducedMotion ? 0.02 : 0.05;
      dummy.position.set(at.x + dxs * amp, at.y + dys * amp, at.z);
      dummy.scale.setScalar(at.rad * (1 + 0.25 * Math.min(1, w)));
      dummy.updateMatrix();
      at.im.setMatrixAt(at.i, dummy.matrix);
      at.im.setColorAt(at.i, tmpC.copy(at.col).lerp(hotC, Math.min(1, w) * 0.85));
    }
    for (const k in iMeshes) { iMeshes[k].instanceMatrix.needsUpdate = true; iMeshes[k].instanceColor.needsUpdate = true; }
  }

  // ---------------------------------------------------------------- veil (fade through black)
  const veilScene = new THREE.Scene();
  const veilCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const veilMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false });
  veilScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), veilMat));

  // ---------------------------------------------------------------- camera
  let portrait = false, aspect = 2, rMult = 1;
  const refOff = v(-4.9, 0, 0);
  let KEYS = [];
  function buildKeys() {
    const mid = refOff.clone().multiplyScalar(0.5).add(v(0, portrait ? 0.2 : -0.1, 0));
    const dive = v(0, TF - 0.08, 0);
    KEYS = [
      { p: 0.00, t: v(0, -0.35, 0), r: 9.6, yaw: 0.5, pitch: 0.4 },
      { p: 0.18, t: v(0, -0.3, 0), r: 9.0, yaw: 0.42, pitch: 0.36 },
      { p: 0.30, t: v(0, -0.2, 0.25), r: 8.0, yaw: 0.32, pitch: 0.27 },
      { p: 0.44, t: v(0, -0.15, 0.25), r: 7.7, yaw: 0.26, pitch: 0.25 },
      { p: 0.56, t: mid, r: 13.2, yaw: 0.3, pitch: 0.3 },
      { p: 0.68, t: mid, r: 12.8, yaw: 0.24, pitch: 0.27 },
      { p: 0.735, t: dive.clone().add(v(0, 0.02, 0)), r: 2.4, yaw: 0.06, pitch: 0.12 },
      { p: 0.785, t: dive, r: 0.3, yaw: 0.0, pitch: 0.03 },
      { p: 1.00, t: dive, r: 0.3, yaw: 0.0, pitch: 0.03 },
    ];
  }
  const view = { t: v(0, 0, 0), r: 8, yaw: 0, pitch: 0.4 };
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
  function orbit(cam, t, r, yaw, pitch) {
    cam.position.set(t.x + r * Math.sin(yaw) * Math.cos(pitch), t.y + r * Math.sin(pitch), t.z + r * Math.cos(yaw) * Math.cos(pitch));
    cam.lookAt(t);
  }
  const tgt = v(0, 0, 0);
  function layoutPanel(aPanel) {
    const h = HUD_D * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), hw = h * aspect;
    let pw;
    if (!portrait) { pw = Math.min(hw * 0.62, h * 1.05); panel.position.set(hw - pw / 2 - hw * 0.05, -h * 0.02, -HUD_D); }
    else { pw = Math.min(hw * 1.6, h * 0.9); panel.position.set(0, -h * 0.5, -HUD_D); }
    panel.scale.set(pw / 1.6, pw / 1.6, 1);
    panel.visible = aPanel > 0.01;
  }

  // ---------------------------------------------------------------- render
  let time = 1.15, progT = 0, prog = 0, small = false, panelA = 0;
  function renderMain(p, dt) {
    const on = smoothstep(0.2, 0.27, p);
    const shellA = on * (1 - smoothstep(0.7, 0.75, p));
    const refIn = easeInOut(smoothstep(0.46, 0.57, p));
    sample.update(time, on, shellA);
    rg.visible = refIn > 0.002;
    if (rg.visible) {
      ref.update(time, on, shellA);
      rg.scale.setScalar(lerp(0.4, 1, refIn));
      rg.position.copy(refOff).add(v(-2.5 * (1 - refIn), 0, 0));
    }
    // labels
    labels.forEach((s) => {
      const [a, b] = s.userData.show;
      const al = (a <= 0 ? 1 : smoothstep(a, a + 0.04, p)) * (1 - smoothstep(b - 0.03, b, p)) * (s.parent === rg ? refIn : 1);
      s.material.opacity = al;
      s.visible = al > 0.01 && !(small && s.userData.minor);
    });
    bracket.visible = p < 0.47;
    brMat.opacity = 0.9 * (1 - smoothstep(0.44, 0.47, p));
    // panel
    const aA = smoothstep(0.25, 0.3, p) * (1 - smoothstep(0.45, 0.49, p));
    const aB = smoothstep(0.52, 0.57, p) * (1 - smoothstep(0.68, 0.72, p));
    panelA = Math.max(aA, aB);
    layoutPanel(panelA);
    if (panel.visible) { panelMat.opacity = panelA; drawPanel(aA / panelA, aB / panelA, smoothstep(0.53, 0.63, p), time); }
    // camera
    const vw = viewAt(p);
    const turn = reducedMotion ? 0 : 0.22 * Math.sin(time * 0.22) * (1 - smoothstep(0.14, 0.26, p)) + 0.04 * Math.sin(time * 0.15);
    tgt.copy(vw.t);
    // make room for the panel: shift the chip left (landscape) or up (portrait)
    const aShift = smoothstep(0.24, 0.3, p) * (1 - smoothstep(0.69, 0.73, p));
    if (!portrait) { const yaw = vw.yaw + turn; tgt.x += Math.cos(yaw) * aShift * vw.r * 0.15; tgt.z -= Math.sin(yaw) * aShift * vw.r * 0.15; }
    // portrait: the text beat sits above and the panel below, so keep the chip centred and pull back a little
    else tgt.y -= aShift * vw.r * 0.02;
    orbit(camera, tgt, vw.r * rMult * (portrait ? 1 + 0.3 * aShift : 1), vw.yaw + turn, vw.pitch);
    renderer.render(scene, camera);
  }
  function renderMicro(p) {
    const u = smoothstep(0.79, 1.0, p);
    updatePackets(time);
    updateAtoms(time);
    const sway = reducedMotion ? 0 : 0.08 * Math.sin(time * 0.2);
    orbit(mcam, v(0.1, lerp(0.3, 0.4, u), 0), lerp(9.8, 8.4, u) * rMult, lerp(0.5, 0.3, u) + sway, lerp(0.2, 0.1, u));
    mLabels.forEach((s) => { s.material.opacity = smoothstep(0.8, 0.86, p); });
    renderer.render(micro, mcam);
  }
  function render(_t, dt) {
    if (!reducedMotion) time += dt;
    prog = reducedMotion || !dt ? progT : prog + (progT - prog) * damp(6, dt);
    const p = prog;
    if (p < 0.787) renderMain(p, dt); else renderMicro(p);
    const veil = smoothstep(0.745, 0.785, p) * (1 - smoothstep(0.79, 0.83, p));
    if (veil > 0.002) {
      veilMat.opacity = veil;
      renderer.autoClear = false; renderer.render(veilScene, veilCam); renderer.autoClear = true;
    }
  }
  const loop = createLoop(render);
  const renderOnce = () => render(0, 0);

  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    aspect = w / h;
    renderer.setSize(w, h, false);
    fitCameraToAspect(camera, aspect, { refAspect: 1.6, maxFov: 72 });
    fitCameraToAspect(mcam, aspect, { refAspect: 1.5, maxFov: 75 });
    const wasPortrait = portrait;
    portrait = aspect < 0.9;
    rMult = aspect < 0.7 ? 1.12 : aspect < 1.2 ? 1.05 : 1;
    refOff.set(-4.9, 0, 0); // side by side in every orientation: stacked chips run into the text beat on phones
    if (wasPortrait !== portrait || !KEYS.length) buildKeys();
    small = w < 640;
    const ls = small ? 1.35 : 1;
    labels.forEach((s) => s.scale.copy(s.userData.base).multiplyScalar(ls));
    mLabels.forEach((s) => s.scale.copy(s.userData.base).multiplyScalar(ls));
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
      disposeObject(scene); disposeObject(micro); disposeObject(veilScene);
      textures.forEach((t) => t.dispose()); envTex.dispose(); pmrem.dispose();
      renderer.dispose();
    },
  };
}
