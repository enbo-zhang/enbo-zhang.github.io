// nv-diamond.js — Scene 1: "A quantum sensor in diamond"
// Storyboard (progress p):
//   0.00–0.25  orbit a diamond lattice, zoom to the NV site (N + vacancy, NV axis)
//   0.25–0.45  green laser → red fluorescence; energy-level diagram fades in, |±1⟩ Zeeman-split
//   0.45–0.55  the view splits into two side-by-side copies of the same NV: same B, same microwave frequency
//              (tuned to |0⟩→|+1⟩). Stacked top/bottom when the canvas is portrait.
//   0.52–0.60  both fields switch on at once: LEFT view σ− (cyan) → no transition, stays bright (✕);
//              RIGHT view σ+ (magenta) → |0⟩→|+1⟩ driven, glow DIMS
//   0.60–0.74  hold the comparison
//   0.74–0.80  retune the (shared) microwave frequency to |0⟩→|−1⟩: roles swap — σ− now dims, σ+ gets the ✕
//   0.80–1.00  hold the second pair
// setParam('drive', 'auto'|'plus'|'minus'|'off') — forced modes show a single view (playground)
// setParam('bias', mT) — playground bias field: sets the Zeeman splitting and the B arrow length (forced modes only)
// setParam('mw', GHz)  — playground microwave frequency: resonance needs f ≈ D ± γB and the matching handedness
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  COLORS, createRenderer, makeLabelSprite, makeGlowSprite, makeArrow, smoothstep, clamp, lerp, remap,
  easeInOut, band, damp, observeResize, fitCameraToAspect, createLoop, disposeObject, getGlowTexture,
} from './common.js';

const TAU = Math.PI * 2;

export function createScene(canvas, options = {}) {
  const reducedMotion = !!options.reducedMotion;

  const renderer = createRenderer(canvas);
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 4, 12);
  const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 100);

  // Environment for glossy atoms
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x05060a, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(3, 6, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fb0ff, 1.4); rim.position.set(-5, 1, -5); scene.add(rim);

  // ---------------------------------------------------------------- lattice
  const A = 1.35;                      // cubic lattice constant (world units)
  const bondLen = A * Math.sqrt(3) / 4;
  const axisCrystal = new THREE.Vector3(1, 1, 1).normalize();
  const vacCrystal = new THREE.Vector3(1, 1, 1).multiplyScalar(A / 4); // vacancy = nearest neighbour along [111]
  // rotate the crystal so [111] (NV axis) points world +Y
  const crystalQ = new THREE.Quaternion().setFromUnitVectors(axisCrystal, new THREE.Vector3(0, 1, 0));
  // world NV centre = midpoint of N–V; put it at origin
  const nvMidCrystal = vacCrystal.clone().multiplyScalar(0.5);

  const fcc = [[0, 0, 0], [0, .5, .5], [.5, 0, .5], [.5, .5, 0]];
  const basis = [[0, 0, 0], [.25, .25, .25]];
  const R = 3.4;
  const sites = [];
  const N = 4;
  for (let i = -N; i <= N; i++) for (let j = -N; j <= N; j++) for (let k = -N; k <= N; k++) {
    for (const f of fcc) for (const b of basis) {
      const v = new THREE.Vector3(i + f[0] + b[0], j + f[1] + b[1], k + f[2] + b[2]).multiplyScalar(A);
      if (v.distanceTo(nvMidCrystal) <= R) sites.push(v);
    }
  }
  const isN = (v) => v.lengthSq() < 1e-6;
  const isV = (v) => v.distanceToSquared(vacCrystal) < 1e-6;
  const toWorld = (v) => v.clone().sub(nvMidCrystal).applyQuaternion(crystalQ);

  const lattice = new THREE.Group();
  scene.add(lattice);

  // shared fade uniforms: fade atoms that are very close to the camera (so they don't block the NV)
  // and atoms far from the NV focus (soft spherical vignette of the crystal)
  const fadeU = { uCamPos: { value: new THREE.Vector3() }, uNear: { value: new THREE.Vector2(0.6, 1.6) }, uRad: { value: new THREE.Vector2(2.0, 3.4) }, uAxisClear: { value: 0 } };
  function addFade(mat) {
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, fadeU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvec4 wp4 = vec4(transformed,1.0);\n#ifdef USE_INSTANCING\nwp4 = instanceMatrix*wp4;\n#endif\nvWP = (modelMatrix*wp4).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP; uniform vec3 uCamPos; uniform vec2 uNear; uniform vec2 uRad; uniform float uAxisClear;')
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
          float dc = distance(vWP, uCamPos);
          float fa = smoothstep(uNear.x, uNear.y, dc) * (1.0 - smoothstep(uRad.x, uRad.y, length(vWP)));
          fa *= mix(1.0, 0.5 - 0.32*smoothstep(0.5, 1.4, length(vWP)), uAxisClear);
          gl_FragColor.a *= fa;
          if (gl_FragColor.a < 0.004) discard;`);
    };
    mat.transparent = true;
  }

  const carbonSites = sites.filter((v) => !isN(v) && !isV(v));
  const atomGeo = new THREE.IcosahedronGeometry(0.052, 3);
  const atomMat = new THREE.MeshPhysicalMaterial({
    color: 0x9fc4ea, roughness: 0.18, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.1,
    emissive: 0x15263d, emissiveIntensity: 0.6, envMapIntensity: 0.9, transparent: true, opacity: 0.9, depthWrite: true,
  });
  addFade(atomMat);
  const atoms = new THREE.InstancedMesh(atomGeo, atomMat, carbonSites.length);
  const m4 = new THREE.Matrix4();
  carbonSites.forEach((v, i) => { m4.makeTranslation(toWorld(v)); atoms.setMatrixAt(i, m4); });
  lattice.add(atoms);

  // bonds
  const bonds = [];
  for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
    const d = sites[i].distanceTo(sites[j]);
    if (Math.abs(d - bondLen) < 1e-3) {
      const vac = isV(sites[i]) || isV(sites[j]);
      if (vac) continue; // vacancy has no bonds
      bonds.push([toWorld(sites[i]), toWorld(sites[j]), isN(sites[i]) || isN(sites[j])]);
    }
  }
  const bondGeo = new THREE.CylinderGeometry(0.012, 0.012, 1, 6, 1, true);
  bondGeo.translate(0, 0.5, 0);
  const bondMat = new THREE.MeshStandardMaterial({
    color: COLORS.lattice, emissive: COLORS.lattice, emissiveIntensity: 0.25, roughness: 0.4,
    transparent: true, opacity: 0.38, depthWrite: false,
  });
  addFade(bondMat);
  const bondMesh = new THREE.InstancedMesh(bondGeo, bondMat, bonds.length);
  const UP = new THREE.Vector3(0, 1, 0);
  const tq = new THREE.Quaternion(), ts = new THREE.Vector3(), dir = new THREE.Vector3();
  bonds.forEach(([a, b], i) => {
    dir.subVectors(b, a); const L = dir.length(); dir.normalize();
    tq.setFromUnitVectors(UP, dir); ts.set(1, L, 1);
    m4.compose(a, tq, ts); bondMesh.setMatrixAt(i, m4);
  });
  lattice.add(bondMesh);

  // ---------------------------------------------------------------- NV centre
  const nPos = toWorld(new THREE.Vector3());
  const vPos = toWorld(vacCrystal);
  const nv = new THREE.Group();
  scene.add(nv);

  const nMat = new THREE.MeshPhysicalMaterial({
    color: COLORS.nitrogen, emissive: COLORS.nitrogen, emissiveIntensity: 0.5, roughness: 0.15,
    clearcoat: 1, envMapIntensity: 1.2,
  });
  const nAtom = new THREE.Mesh(new THREE.IcosahedronGeometry(0.11, 4), nMat);
  nAtom.position.copy(nPos);
  nv.add(nAtom);
  const nGlow = makeGlowSprite(COLORS.nitrogen, { size: 0.55, opacity: 0.0 });
  nGlow.position.copy(nPos); nv.add(nGlow);

  // vacancy: fresnel ghost sphere
  const ghostMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0xcfe8ff) }, uOpacity: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
      void main(){ float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = pow(f, 2.2); gl_FragColor = vec4(uColor*(0.15+1.4*f), (0.05+0.9*f)*uOpacity); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const ghost = new THREE.Mesh(new THREE.SphereGeometry(0.115, 32, 24), ghostMat);
  ghost.position.copy(vPos);
  nv.add(ghost);
  // dashed ring around vacancy
  const vRingGeo = new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: 65 }, (_, i) => new THREE.Vector3(Math.cos(i / 64 * TAU) * 0.16, Math.sin(i / 64 * TAU) * 0.16, 0)));
  const vRingMat = new THREE.LineDashedMaterial({ color: 0xcfe8ff, dashSize: 0.025, gapSize: 0.02, transparent: true, opacity: 0, depthWrite: false });
  const vRing = new THREE.Line(vRingGeo, vRingMat); vRing.computeLineDistances();
  vRing.position.copy(vPos); nv.add(vRing);

  // NV axis
  const axisGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -1.6, 0), new THREE.Vector3(0, 1.6, 0)]);
  axisGeo.setAttribute('color', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const axisMat = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: `varying float vY; void main(){ vY = position.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform float uOpacity; varying float vY; void main(){ float a = 1.0 - smoothstep(0.3, 1.6, abs(vY)); float d = step(0.5, fract(vY*14.0)); gl_FragColor = vec4(vec3(0.85,0.92,1.0), a*uOpacity*(0.35+0.65*d)); }`,
    transparent: true, depthWrite: false,
  });
  const axisLine = new THREE.Line(axisGeo, axisMat);
  nv.add(axisLine);

  const lblN = makeLabelSprite('N', { color: COLORS.nitrogen, fontSize: 72, fontWeight: 600, scale: 0.13 });
  const lblV = makeLabelSprite('V', { color: '#cfe8ff', fontSize: 72, fontWeight: 600, scale: 0.13 });
  nv.add(lblN, lblV);

  // B bias arrow along axis
  const bArrow = makeArrow(0xd8dde6, 0.45, { shaftRadius: 0.009, headRadius: 0.03, headLength: 0.12, emissive: 0.5, opacity: 0.999 });
  bArrow.position.set(0, 0.5, 0);
  nv.add(bArrow);
  const lblB = makeLabelSprite('B', { color: '#e5e5ea', fontSize: 72, fontWeight: 600, scale: 0.13 });
  lblB.position.set(0.12, 1.02, 0); nv.add(lblB);

  // fluorescence glow
  const glowCore = makeGlowSprite(0xffd0c0, { size: 0.35, opacity: 0, depthTest: false });
  const glowMid = makeGlowSprite(COLORS.nvRed, { size: 1.1, opacity: 0, depthTest: false });
  const glowBloom = makeGlowSprite(COLORS.nvRedSoft, { size: 3.2, opacity: 0, depthTest: false });
  const glowStreak = makeGlowSprite(COLORS.nvRed, { size: 1, opacity: 0, depthTest: false });
  [glowBloom, glowMid, glowStreak, glowCore].forEach((s) => { s.renderOrder = 5; nv.add(s); });
  const nvLight = new THREE.PointLight(COLORS.nvRed, 0, 4, 1.6);
  nv.add(nvLight);

  // ---------------------------------------------------------------- laser
  const laserSrc = new THREE.Vector3(-2.6, 5.5, 2.2);
  const laserDir = laserSrc.clone().normalize();
  const laserLen = laserSrc.length();
  const beamMat = (radiusScale, strength) => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uGrow: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(COLORS.laser) }, uStrength: { value: strength } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime, uGrow, uOpacity, uStrength; uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float s = vUv.y;                     // 0 at NV end, 1 at source (CylinderGeometry uv.y = 1 at top)
        float front = 1.0 - uGrow;           // beam travels from the source (s=1) into the NV (s=0)
        if (s < front) discard;
        float f = abs(dot(normalize(vN), normalize(vV)));
        float core = pow(f, 2.0);
        float flow = 0.7 + 0.3*sin(s*45.0 + uTime*12.0);   // pulses move toward the NV
        float ends = smoothstep(1.0, 0.9, s) * smoothstep(0.0, 0.02, s+0.001);
        float tip = smoothstep(front, front+0.06, s);
        vec3 c = mix(uColor, vec3(0.85,1.0,0.88), core*0.6);
        gl_FragColor = vec4(c*core*flow*uStrength, 1.0) * ends * tip * uOpacity;
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const laser = new THREE.Group();
  const beamCoreGeo = new THREE.CylinderGeometry(0.035, 0.045, laserLen, 24, 1, true); beamCoreGeo.translate(0, laserLen / 2, 0);
  const beamHaloGeo = new THREE.CylinderGeometry(0.12, 0.16, laserLen, 24, 1, true); beamHaloGeo.translate(0, laserLen / 2, 0);
  const beamCore = new THREE.Mesh(beamCoreGeo, beamMat(1, 3.6));
  const beamHalo = new THREE.Mesh(beamHaloGeo, beamMat(1, 1.0));
  laser.add(beamHalo, beamCore);
  laser.quaternion.setFromUnitVectors(UP, laserDir);
  scene.add(laser);
  const laserSpot = makeGlowSprite(COLORS.laser, { size: 0.7, opacity: 0, depthTest: false });
  laserSpot.renderOrder = 4; scene.add(laserSpot);

  // ---------------------------------------------------------------- microwave field rigs
  const RING_R = 0.78;
  function makeFieldRig(color, sense /* +1 right-handed about +Y, -1 left */, label) {
    const rig = new THREE.Group();
    const pivot = new THREE.Group(); rig.add(pivot);
    // circulating arrow: an arc that sweeps around the ring with its head leading (no radial "clock hand",
    // so the field reads as rotating around the NV rather than the NV itself spinning)
    const ARC = Math.PI * 1.25;
    const arcMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
      vertexShader: `varying float vT; void main(){ vT = uv.x; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying float vT;
        void main(){ float a = pow(1.0 - vT, 1.4); gl_FragColor = vec4(uColor*(0.6+0.8*a), a*uOpacity); }`,
      transparent: true, depthWrite: false, fog: false,
    });
    const arcGeo = new THREE.TorusGeometry(RING_R, 0.024, 10, 120, ARC);
    arcGeo.rotateX(sense > 0 ? Math.PI / 2 : -Math.PI / 2); // head at local +X, tail trailing behind the motion
    const arc = new THREE.Mesh(arcGeo, arcMat); pivot.add(arc);
    const headMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, fog: false });
    const headGeo = new THREE.ConeGeometry(0.075, 0.24, 20);
    headGeo.rotateX(sense > 0 ? -Math.PI / 2 : Math.PI / 2); // point along the direction of rotation
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.set(RING_R, 0, sense > 0 ? -0.1 : 0.1);
    pivot.add(head);
    const tip = makeGlowSprite(color, { size: 0.35, opacity: 0.8 });
    tip.position.set(RING_R, 0, 0); pivot.add(tip);
    const trailMat = new THREE.ShaderMaterial({
      uniforms: { uAngle: { value: 0 }, uSense: { value: sense }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: 0 } },
      vertexShader: `varying float vA; void main(){ vA = atan(-position.z, position.x); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uAngle, uSense, uOpacity; uniform vec3 uColor; varying float vA;
        void main(){ float d = mod(uSense*(uAngle - vA), 6.2831853) / 6.2831853; float a = pow(1.0 - d, 2.5); gl_FragColor = vec4(uColor*(0.4+1.6*a), (0.08 + 0.92*a)*uOpacity); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const trailGeo = new THREE.TorusGeometry(RING_R, 0.014, 8, 160); trailGeo.rotateX(Math.PI / 2);
    const trail = new THREE.Mesh(trailGeo, trailMat); rig.add(trail);
    // faint disc
    const discMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const disc = new THREE.Mesh(new THREE.RingGeometry(RING_R * 0.25, RING_R, 64), discMat); disc.rotation.x = -Math.PI / 2; rig.add(disc);
    const lbl = makeLabelSprite(label, { color, fontSize: 80, fontWeight: 600, scale: 0.2 });
    rig.add(lbl);
    rig.visible = false;
    nv.add(rig);
    return { rig, pivot, arcMat, headMat, tip, trailMat, discMat, lbl, sense, amp: 0, angle: sense > 0 ? 0.6 : 2.4 };
  }
  const rigPlus = makeFieldRig(COLORS.sigmaPlus, +1, 'σ⁺');
  const rigMinus = makeFieldRig(COLORS.sigmaMinus, -1, 'σ⁻');

  // captions naming each half of the split view
  const capMinus = makeLabelSprite('LEFT-HANDED FIELD  σ⁻', { color: COLORS.sigmaMinus, fontSize: 56, fontWeight: 500, scale: 0.11, glow: false, fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' });
  const capPlus = makeLabelSprite('RIGHT-HANDED FIELD  σ⁺', { color: COLORS.sigmaPlus, fontSize: 56, fontWeight: 500, scale: 0.11, glow: false, fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' });
  [capMinus, capPlus].forEach((c) => { c.renderOrder = 30; c.material.fog = false; c.visible = false; scene.add(c); });

  // ---------------------------------------------------------------- energy-level diagram (billboard)
  const diag = new THREE.Group();
  scene.add(diag);
  const diagInner = new THREE.Group(); diag.add(diagInner);

  function barTexture() {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.42, 'rgba(255,255,255,0.25)');
    grd.addColorStop(0.5, 'rgba(255,255,255,1)'); grd.addColorStop(0.58, 'rgba(255,255,255,0.25)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 64);
    const fade = g.createLinearGradient(0, 0, 256, 0);
    fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(0.06, 'rgba(0,0,0,0)'); fade.addColorStop(0.94, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
    g.globalCompositeOperation = 'destination-out'; g.fillStyle = fade; g.fillRect(0, 0, 256, 64);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const barTex = barTexture();
  const BAR_W = 1.0, BAR_H = 0.1;
  function makeBar(color = 0xffffff) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(BAR_W, BAR_H),
      new THREE.MeshBasicMaterial({ map: barTex, color, transparent: true, opacity: 1, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false }));
    m.renderOrder = 20; diagInner.add(m); return m;
  }
  // soft dark scrim so the diagram reads over the lattice
  const scrimTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.85)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); return t;
  })();
  const scrim = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.6), new THREE.MeshBasicMaterial({ map: scrimTex, transparent: true, depthTest: false, depthWrite: false, fog: false, opacity: 0 }));
  scrim.position.set(0.15, 0.45, 0); scrim.renderOrder = 15; diagInner.add(scrim);
  const bar0 = makeBar(0xffffff), barP = makeBar(0xffffff), barM = makeBar(0xffffff);

  function makeTransition(color) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uLen: { value: 1 }, uActive: { value: 0 }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(color) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      fragmentShader: `uniform float uTime, uLen, uActive, uOpacity; uniform vec3 uColor; varying vec2 vUv;
        void main(){
          float y = vUv.y*uLen;
          float amp = 0.18*smoothstep(0.0,0.08,vUv.y)*smoothstep(1.0,0.86,vUv.y);
          float w = sin(y*34.0 - uTime*9.0*uActive);
          float x = (vUv.x-0.5) - amp*w*(0.35+0.65*uActive);
          float line = exp(-pow(x/0.035, 2.0));
          float glow = exp(-pow(x/0.16, 2.0))*0.35;
          // arrowhead at top
          float head = 0.0;
          float hy = (1.0 - vUv.y)*uLen;
          if (hy < 0.09) { float hw = hy*1.6; head = smoothstep(hw+0.03, hw, abs(vUv.x-0.5)*0.2*5.0*0.5) ; }
          float a = (line + glow*uActive + head*0.9) * (0.28 + 0.72*uActive);
          vec3 c = mix(uColor, vec3(1.0), line*0.35*uActive);
          gl_FragColor = vec4(c*a*1.4, 1.0) * uOpacity;
        }`,
      transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    const geo = new THREE.PlaneGeometry(0.34, 1); geo.translate(0, 0.5, 0);
    const m = new THREE.Mesh(geo, mat); m.renderOrder = 21; diagInner.add(m);
    return m;
  }
  const trP = makeTransition(COLORS.sigmaPlus);
  const trM = makeTransition(COLORS.sigmaMinus);

  const lbl = (t, c, s = 0.2, w = 500) => { const sp = makeLabelSprite(t, { color: c, fontSize: 72, fontWeight: w, scale: s, glow: false }); sp.renderOrder = 22; sp.material.fog = false; diagInner.add(sp); return sp; };
  const L0 = lbl('|0⟩', '#f5f5f7');
  const LPM = lbl('|±1⟩', '#f5f5f7');
  const LP = lbl('|+1⟩', '#f5f5f7');
  const LM = lbl('|−1⟩', '#f5f5f7');
  const LsP = lbl('σ⁺', COLORS.sigmaPlus, 0.24, 600);
  const LsM = lbl('σ⁻', COLORS.sigmaMinus, 0.24, 600);
  const Lx = lbl('✕', '#ffffff', 0.3, 300);
  // marks which line the microwave frequency is tuned to
  const LMW = makeLabelSprite('MW →', { color: '#f5f5f7', fontSize: 56, fontWeight: 500, scale: 0.15, glow: false, fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' });
  LMW.renderOrder = 22; LMW.material.fog = false; diagInner.add(LMW);

  // brightness meter
  const meter = new THREE.Group(); diagInner.add(meter);
  const METER_W = 1.0;
  const track = new THREE.Mesh(new THREE.PlaneGeometry(METER_W, 0.022), new THREE.MeshBasicMaterial({ color: 0x3a3a3c, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  const fillGeo = new THREE.PlaneGeometry(1, 0.022); fillGeo.translate(0.5, 0, 0);
  const fill = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: COLORS.nvRed, transparent: true, depthTest: false, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  fill.position.x = -METER_W / 2;
  const fillGlow = new THREE.Mesh(fillGeo, new THREE.MeshBasicMaterial({ color: COLORS.nvRed, map: barTex, transparent: true, depthTest: false, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
  fillGlow.position.x = -METER_W / 2; fillGlow.scale.y = 5;
  [track, fillGlow, fill].forEach((m, i) => { m.renderOrder = 20 + i; meter.add(m); });
  const LGlow = makeLabelSprite('red glow', { color: '#ff6a4d', fontSize: 60, fontWeight: 500, scale: 0.15, glow: false });
  LGlow.renderOrder = 23; LGlow.material.fog = false; meter.add(LGlow);
  LGlow.position.set(-METER_W / 2 + 0.22, 0.12, 0);

  // layout of diagram (local units)
  const Y0 = 0, Y1 = 1.15;
  bar0.position.set(0, Y0, 0);
  L0.position.set(BAR_W / 2 + 0.2, Y0, 0);
  meter.position.set(0, -0.42, 0);
  trM.position.set(-0.17, Y0, 0);
  trP.position.set(0.17, Y0, 0);

  // ---------------------------------------------------------------- state
  let pTarget = 0, p = 0;
  let drive = 'auto';
  let biasMT = 10, biasShown = 10;    // playground bias field (mT), and its smoothed value
  const BIAS_MAX = 30;
  let mwGHz = 3.15, mwShown = 3.15;   // playground microwave frequency (GHz)
  const ZFS = 2.87, GAMMA_GHZ = 0.028, HWHM_GHZ = 0.03;
  const UNITS_PER_GHZ = 0.3 * (1.7 / BIAS_MAX) / GAMMA_GHZ;   // diagram height per GHz (matches the drawn split, 0.3·s.split)
  const lorentz = (df) => 1 / (1 + (df / HWHM_GHZ) ** 2);
  let fieldPlus = 0, fieldMinus = 0;  // smoothed rig amplitudes
  let width = 1, height = 1, aspect = 16 / 9;
  const SPLIT_IN = [0.45, 0.55], FIELD_IN = [0.52, 0.6], RETUNE = [0.74, 0.8];
  const dividerColor = new THREE.Color(0x48484a), prevClear = new THREE.Color();
  let time = 0;
  const tmpV = new THREE.Vector3(), camRight = new THREE.Vector3(), camUp = new THREE.Vector3();

  function targets(pp) {
    // returns storyboard intensities for progress pp
    const s = {};
    s.nvReveal = smoothstep(0.1, 0.22, pp);
    s.nvLabels = band(pp, 0.13, 0.2, 0.36, 0.42);
    s.axis = smoothstep(0.15, 0.26, pp);
    s.laser = smoothstep(0.25, 0.32, pp);
    s.glowOn = smoothstep(0.29, 0.36, pp);
    s.diagram = smoothstep(0.33, 0.41, pp);
    s.split = smoothstep(0.36, 0.46, pp);
    // auto sequence: split into two views, then both fields on together
    s.pair = easeInOut(remap(pp, SPLIT_IN[0], SPLIT_IN[1]));
    s.field = smoothstep(FIELD_IN[0], FIELD_IN[1], pp);
    s.tune = easeInOut(remap(pp, RETUNE[0], RETUNE[1]));   // 0: tuned to |0⟩→|+1⟩, 1: tuned to |0⟩→|−1⟩
    return s;
  }

  // view = { aspect, fieldPlus, fieldMinus, cap: null | capMinus | capPlus, forced }
  function update(dt, view) {
    const s = targets(p);
    const { fieldPlus, fieldMinus, forced } = view;
    const aspect = view.aspect;
    if (forced) {
      s.nvReveal = 1; s.axis = 1; s.laser = 1; s.glowOn = 1; s.diagram = 1; s.nvLabels = 0;
      s.split = 1.7 * biasShown / BIAS_MAX;   // Zeeman splitting ∝ B
    }
    const bLen = forced ? lerp(0.35, 1.7, biasShown / BIAS_MAX) : 1;
    bArrow.userData.setLength(0.45 * bLen);
    lblB.position.set(0.12, 0.5 + 0.45 * bLen + 0.07, 0);

    // resonance: drive tuned to the σ+ line → only matching (σ+) field drives the transition
    // resonance: only the field whose handedness matches the tuned line drives it
    const tune = view.tune || 0;
    let resP = fieldPlus * (1 - tune), resM = fieldMinus * tune;
    let lineP = 1 - tune, lineM = tune;   // how close the MW is to each line (0..1)
    if (forced) {
      lineP = lorentz(mwShown - (ZFS + GAMMA_GHZ * biasShown));
      lineM = lorentz(mwShown - (ZFS - GAMMA_GHZ * biasShown));
      resP = fieldPlus * lineP; resM = fieldMinus * lineM;
    }
    const dip = 0.72 * smoothstep(0.15, 0.95, resP + resM);
    const pulse = reducedMotion ? 1 : 1 + 0.06 * Math.sin(time * 2.2) + 0.03 * Math.sin(time * 5.3);
    const bright = s.glowOn * (1 - dip);

    // ---- camera
    const portrait = aspect < 0.85;
    const zoom = easeInOut(remap(p, 0, 0.28));
    let radius = lerp(10.5, 4.5, zoom) - 0.35 * smoothstep(0.3, 0.6, p) - 0.1 * smoothstep(0.6, 1, p);
    // framing: NV centre + level diagram. Split views blend from the single-view framing into a compact
    // pair framing (diagram tucked beside the NV, everything lifted above the caption text)
    const fs = smoothstep(0.3, 0.42, Math.max(p, forced ? 1 : 0));
    const single = (portrait && !view.cap)
      ? { fx: 0, fy: -0.75 * fs, dx: 0, dy: -1.75, sc: 0.72, rad: 1.12 }
      : { fx: 0.62 * fs, fy: 0, dx: 1.75, dy: -0.38, sc: 0.66, rad: 1 };
    const pairLay = view.wide
      ? { fx: 0.4, fy: -0.1, dx: 1.25, dy: -0.22, sc: 0.6, rad: 1 }
      : { fx: 0.55, fy: -0.25, dx: 1.5, dy: -0.3, sc: 0.55, rad: 1.05 };
    const pa = view.cap ? view.pairAmt : 0;
    const lay = {};
    for (const k in single) lay[k] = lerp(single[k], pairLay[k], pa);
    radius *= lay.rad;
    const idle = reducedMotion ? 0 : time * lerp(0.07, 0.015, zoom);
    const az = 0.55 + p * 1.1 + idle + (forced ? 0 : 0);
    const el = lerp(0.42, 0.5, smoothstep(0.2, 0.5, p)) + (reducedMotion ? 0 : 0.02 * Math.sin(time * 0.3));
    camRight.set(Math.cos(az), 0, -Math.sin(az));
    const focus = new THREE.Vector3();
    focus.addScaledVector(camRight, lay.fx);
    focus.y += lay.fy;
    camera.position.set(
      focus.x + radius * Math.sin(az) * Math.cos(el),
      focus.y + radius * Math.sin(el),
      focus.z + radius * Math.cos(az) * Math.cos(el));
    camera.lookAt(focus);
    camera.updateMatrixWorld();
    camRight.setFromMatrixColumn(camera.matrixWorld, 0);
    camUp.setFromMatrixColumn(camera.matrixWorld, 1);
    capMinus.visible = view.cap === capMinus; capPlus.visible = view.cap === capPlus;
    if (view.cap) {
      // pin near the top of this view, in screen space
      tmpV.set(0, view.wide ? 0.74 : 0.78, 0.5).unproject(camera).sub(camera.position).normalize();
      view.cap.position.copy(camera.position).addScaledVector(tmpV, 4);
      view.cap.material.opacity = view.capOpacity;
    }
    const camDist = camera.position.length();
    scene.fog.near = Math.max(0.5, camDist - 1.2);
    scene.fog.far = camDist + lerp(9, 3.6, zoom);

    // ---- lattice
    fadeU.uCamPos.value.copy(camera.position);
    fadeU.uRad.value.set(lerp(2.6, 1.3, zoom), lerp(3.4, 2.9, zoom));
    fadeU.uNear.value.set(lerp(0.3, 1.5, zoom), lerp(0.8, 2.6, zoom));
    fadeU.uAxisClear.value = s.glowOn;
    atomMat.emissiveIntensity = 0.5 + 0.3 * (1 - zoom);
    bondMat.opacity = lerp(0.42, 0.2, zoom);

    // ---- NV
    nMat.emissiveIntensity = lerp(0.05, 0.7, s.nvReveal) * (1 - 0.6 * s.glowOn);
    nAtom.scale.setScalar(lerp(0.78, 1, s.nvReveal));
    nGlow.material.opacity = 0.55 * s.nvReveal * (1 - 0.5 * s.glowOn);
    ghostMat.uniforms.uOpacity.value = s.nvReveal;
    vRingMat.opacity = 0.6 * s.nvReveal * (1 - 0.6 * s.glowOn);
    vRing.quaternion.copy(camera.quaternion);
    axisMat.uniforms.uOpacity.value = 0.55 * s.axis;
    lblN.position.copy(nPos).addScaledVector(camRight, -0.2).addScaledVector(camUp, -0.04);
    lblV.position.copy(vPos).addScaledVector(camRight, -0.24).addScaledVector(camUp, 0.05);
    lblN.material.opacity = lblV.material.opacity = s.nvLabels;
    const bAmt = forced ? 1 : s.split;
    bArrow.visible = lblB.visible = bAmt > 0.01;
    bArrow.userData.material.opacity = bAmt * 0.85;
    bArrow.userData.material.transparent = true;
    lblB.material.opacity = bAmt * 0.85;

    // glow
    const g = bright * pulse;
    glowCore.material.opacity = clamp(g * 1.0);
    glowCore.scale.setScalar(0.22 + 0.22 * g);
    glowMid.material.opacity = 0.9 * g;
    glowMid.scale.setScalar(0.5 + 1.1 * g);
    glowBloom.material.opacity = 0.5 * g;
    glowBloom.scale.setScalar(1.4 + 3.2 * g);
    glowStreak.material.opacity = 0.35 * g;
    glowStreak.scale.set(3.6 * g + 0.2, 0.07, 1);
    glowStreak.material.rotation = 0;
    nvLight.intensity = 3.5 * g;
    // dim glow (when driven) gets cooler tint
    glowMid.material.color.setHex(COLORS.nvRed);

    // laser
    beamCore.material.uniforms.uGrow.value = beamHalo.material.uniforms.uGrow.value = s.laser;
    beamCore.material.uniforms.uOpacity.value = beamHalo.material.uniforms.uOpacity.value = smoothstep(0, 0.2, s.laser);
    beamCore.material.uniforms.uTime.value = beamHalo.material.uniforms.uTime.value = time;
    laserSpot.material.opacity = 0.9 * smoothstep(0.85, 1, s.laser);

    // field rigs
    for (const [rig, amp] of [[rigPlus, fieldPlus], [rigMinus, fieldMinus]]) {
      rig.amp = amp;
      rig.rig.visible = amp > 0.005;
      if (!rig.rig.visible) continue;
      if (!reducedMotion) rig.angle += rig.sense * dt * 2.6;
      rig.pivot.rotation.y = rig.angle;
      rig.trailMat.uniforms.uAngle.value = rig.angle;
      rig.trailMat.uniforms.uOpacity.value = amp;
      rig.discMat.opacity = 0.05 * amp;
      rig.arcMat.uniforms.uOpacity.value = amp;
      rig.headMat.opacity = amp;
      rig.tip.material.opacity = 0.8 * amp;
      rig.rig.scale.setScalar(lerp(0.6, 1, easeInOut(amp)));
      rig.lbl.material.opacity = amp;
      rig.lbl.position.copy(camRight).multiplyScalar(-(RING_R + 0.22)).addScaledVector(camUp, 0.12);
    }

    // ---- diagram
    diag.quaternion.copy(camera.quaternion);
    diag.position.set(0, 0, 0).addScaledVector(camRight, lay.dx).addScaledVector(camUp, lay.dy);
    diag.scale.setScalar(lay.sc);
    diag.visible = s.diagram > 0.005;
    const D = s.diagram;
    const split = 0.3 * s.split;
    barP.position.set(0, Y1 + split, 0);
    barM.position.set(0, Y1 - split, 0);
    LPM.position.set(BAR_W / 2 + 0.24, Y1, 0);
    LP.position.set(BAR_W / 2 + 0.24, Y1 + split, 0);
    LM.position.set(BAR_W / 2 + 0.24, Y1 - split, 0);
    scrim.material.opacity = 0.8 * D;
    bar0.material.opacity = D * 0.95;
    barP.material.opacity = barM.material.opacity = D * 0.95;
    barP.material.color.setHex(0xffffff).lerp(new THREE.Color(COLORS.sigmaPlus), 0.6 * resP);
    barM.material.color.setHex(0xffffff).lerp(new THREE.Color(COLORS.sigmaMinus), 0.6 * resM);
    L0.material.opacity = D;
    LPM.material.opacity = D * (1 - smoothstep(0.0, 0.4, s.split));
    LP.material.opacity = LM.material.opacity = D * smoothstep(0.3, 0.8, s.split);
    // transitions
    const lenP = Y1 + split - Y0, lenM = Y1 - split - Y0;
    trP.scale.y = lenP; trP.material.uniforms.uLen.value = lenP;
    trM.scale.y = lenM; trM.material.uniforms.uLen.value = lenM;
    const trOn = D * smoothstep(0.2, 0.9, s.split);
    trP.material.uniforms.uOpacity.value = trOn;
    trM.material.uniforms.uOpacity.value = trOn * 0.8;
    trP.material.uniforms.uActive.value = smoothstep(0.1, 0.9, resP);
    trM.material.uniforms.uActive.value = smoothstep(0.1, 0.9, resM);
    trP.material.uniforms.uTime.value = trM.material.uniforms.uTime.value = time;
    LsP.position.set(0.42, Y0 + lenP * 0.5, 0);
    LsM.position.set(-0.42, Y0 + lenM * 0.5, 0);
    LsP.material.opacity = trOn * (0.55 + 0.45 * resP);
    LsM.material.opacity = trOn * (0.6 + 0.4 * resM);
    // ✕ on the tuned line when only the wrong-handed field is present
    const onMinusLine = lineM > lineP;
    const wrong = onMinusLine ? fieldPlus * (1 - fieldMinus) : fieldMinus * (1 - fieldPlus);
    const lineSel = forced ? smoothstep(0.3, 0.8, Math.abs(lineP - lineM)) : smoothstep(0.6, 1, Math.abs(2 * tune - 1));
    Lx.position.set(onMinusLine ? -0.17 : 0.17, Y0 + (onMinusLine ? lenM : lenP) * 0.5, 0);
    Lx.material.opacity = D * smoothstep(0.5, 0.95, wrong) * lineSel;
    Lx.material.color.setHex(onMinusLine ? COLORS.sigmaPlus : COLORS.sigmaMinus);
    // MW tuning marker beside the tuned upper level
    const mwY = forced ? Y1 + clamp((mwShown - ZFS) * UNITS_PER_GHZ, -0.75, 0.75) : lerp(Y1 + split, Y1 - split, tune);
    LMW.position.set(-BAR_W / 2 - 0.22, mwY, 0);
    LMW.material.opacity = D * Math.max(fieldPlus, fieldMinus);
    // meter
    // portrait: the diagram sits just above the bottom beat, so drop the meter (the glow itself shows brightness)
    meter.visible = D > 0.01 && !(portrait && !view.cap);
    track.material.opacity = 0.7 * D;
    const fillAmt = Math.max(0.001, clamp(bright * (reducedMotion ? 1 : (1 + 0.03 * Math.sin(time * 2.2)))));
    fill.scale.x = fillGlow.scale.x = fillAmt * METER_W;
    fill.material.opacity = D;
    fillGlow.material.opacity = 0.6 * D;
    LGlow.material.opacity = 0.9 * D;
  }

  // inset: CSS px on the left kept clear of overlays (the page rail); the picture is framed for the rest
  // of the viewport but the background still runs full-bleed underneath
  function renderView(dt, view, x, y, w, h, inset = 0) {
    renderer.setViewport(x, y, w, h);
    renderer.setScissor(x, y, w, h);
    view.aspect = (w - inset) / h;
    if (inset > 0.5) camera.setViewOffset(w - inset, h, -inset, 0, w, h);
    fitCameraToAspect(camera, view.aspect, { portraitFovBoost: 0.85, refAspect: 1.3, maxFov: 75 });
    update(dt, view);
    renderer.render(scene, camera);
    if (inset > 0.5) { camera.clearViewOffset(); camera.updateProjectionMatrix(); }
  }

  function render(t, dt) {
    if (!reducedMotion) {
      time = t;
      p = lerp(p, pTarget, damp(10, dt));
      if (Math.abs(p - pTarget) < 1e-4) p = pTarget;
    } else { p = pTarget; time = 0; dt = 0; }

    const forced = drive !== 'auto';
    renderer.setScissorTest(true);
    if (forced) {
      // playground: one NV, one field at a time
      const tgtPlus = drive === 'plus' ? 1 : 0, tgtMinus = drive === 'minus' ? 1 : 0;
      biasShown = (reducedMotion || dt === 0) ? biasMT : lerp(biasShown, biasMT, damp(8, dt));
      mwShown = (reducedMotion || dt === 0) ? mwGHz : lerp(mwShown, mwGHz, damp(8, dt));
      if (reducedMotion || dt === 0) { fieldPlus = tgtPlus; fieldMinus = tgtMinus; }
      else { const k = damp(5, dt); fieldPlus = lerp(fieldPlus, tgtPlus, k); fieldMinus = lerp(fieldMinus, tgtMinus, k); }
      renderView(dt, { fieldPlus, fieldMinus, forced, cap: null }, 0, 0, width, height);
    } else {
      const s = targets(p);
      if (s.pair < 0.002) {
        renderView(dt, { fieldPlus: 0, fieldMinus: 0, forced, cap: null }, 0, 0, width, height);
      } else {
        // two copies of the same NV, same B and microwave frequency; only the field's handedness differs
        const capOpacity = smoothstep(0.6, 1, s.pair);
        const side = width >= height;
        const left = { fieldPlus: 0, fieldMinus: s.field, tune: s.tune, forced, cap: capMinus, capOpacity, pairAmt: s.pair, wide: side };
        const right = { fieldPlus: s.field, fieldMinus: 0, tune: s.tune, forced, cap: capPlus, capOpacity, pairAmt: s.pair, wide: side };
        if (side) {
          // keep the left copy clear of the section rail (titles always shown on wide screens)
          const inset = (width >= 1024 && document.querySelector('.gnav__rail')) ? 150 * s.pair : 0;
          const xd = Math.round(inset + (width - inset) * (1 - 0.5 * s.pair));
          renderView(dt, left, 0, 0, xd, height, inset);
          renderView(dt, right, xd, 0, width - xd, height);
          renderer.setScissor(xd - 0.5, 0, 1, height);
        } else {
          // portrait: stack the pair between the nav bar and the caption text (bottom ~40% of the screen)
          const top = Math.round(lerp(height, height - 48, s.pair));
          const bottom = Math.round(height * 0.4 * s.pair);
          const mid = Math.round(lerp(bottom, (top + bottom) / 2, s.pair));
          renderView(dt, left, 0, mid, width, top - mid);
          renderView(dt, right, 0, bottom, width, Math.max(1, mid - bottom));
          renderer.setScissor(0, mid - 0.5, width, 1);
        }
        renderer.getClearColor(prevClear); const prevAlpha = renderer.getClearAlpha();
        renderer.setClearColor(dividerColor, capOpacity);
        renderer.clear(true, false, false);
        renderer.setClearColor(prevClear, prevAlpha);
      }
    }
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, width, height);
  }

  const loop = createLoop(render);
  let lastT = 0;
  const renderOnce = () => { render(lastT, 0); };

  function resize() {
    width = canvas.clientWidth || 1; height = canvas.clientHeight || 1;
    aspect = width / height;
    renderer.setSize(width, height, false);
    fitCameraToAspect(camera, aspect, { portraitFovBoost: 0.85, refAspect: 1.3, maxFov: 75 });
    if (!loop.running || reducedMotion) renderOnce();
  }
  const unobserve = observeResize(canvas, resize);
  resize();

  return {
    get progress() { return p; },
    setProgress(v) {
      pTarget = clamp(+v || 0);
      if (reducedMotion || !loop.running) { if (!loop.running) p = pTarget; renderOnce(); }
    },
    setParam(name, value) {
      if (name === 'drive' && ['plus', 'minus', 'off', 'auto'].includes(value)) {
        drive = value;
        if (reducedMotion || !loop.running) renderOnce();
      } else if (name === 'bias' && Number.isFinite(+value)) {
        biasMT = clamp(+value, 0, BIAS_MAX);
        if (reducedMotion || !loop.running) renderOnce();
      } else if (name === 'mw' && Number.isFinite(+value)) {
        mwGHz = clamp(+value, 1.5, 4.5);
        if (reducedMotion || !loop.running) renderOnce();
      }
    },
    resize,
    start() { if (reducedMotion) { renderOnce(); return; } loop.start(); },
    stop() { loop.stop(); },
    dispose() {
      loop.stop(); unobserve();
      disposeObject(scene); barTex.dispose(); envTex.dispose(); pmrem.dispose();
      renderer.dispose();
    },
  };
}
