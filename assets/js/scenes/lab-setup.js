// lab-setup.js — the lab and the instrument, told as a scroll story.
// Optics (top): 532 nm laser, λ/2, beam splitter, AOM (pulses the beam), fibre to the microscope table:
//   dichroic, galvo, 4f relay, periscope. Red fluorescence returns through the dichroic to the SPCM (+ CCD branch).
// The AFM shares the microscope table: the periscope lifts the beam over to the far end of the table and
//   drops it into a 50× objective on a gantry. NV probe on a tuning fork hanging from the gantry, sample on a
//   compact nano-positioning stack (stick-slip coarse XYZ + piezo flexure scanner that rasters), waveguide probe.
// Storyboard (progress p). The lab around the instrument comes first (lab-room.js):
//   0.00–0.10  the Faraday-cage room: outside noise stops at the walls, ±1 °C
//   0.10–0.20  instruments suspended from the ceiling, above the optical tables
//   0.20–0.30  black curtain + second cage around the two optical tables (airflow stops there)
//   0.30–0.40  the curtain lifts; control software drives every subsystem
// then the instrument itself, in the last 60% (old storyboard o, mapped through O(o) = 0.4 + 0.6·o):
//   table one (laser + AOM), table two (confocal: galvo, single-photon counter),
//   o 0.22–0.50  the camera follows the beam along the table to the AFM module
//   o 0.50–0.76  move in on the NV probe tip
//   o 0.72–0.87  dive into the tip (fade through black)
//   o 0.80–1.00  close-up: diamond tip with its NV over the YIG film, σ+ / σ− spin waves either side of the stripline
// Drag to rotate (offsets the scripted view).
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  COLORS, clamp, damp, lerp, smoothstep, easeInOut, createRenderer, makeLabelSprite, makeGlowSprite, makeTube,
  observeResize, fitCameraToAspect, createLoop, disposeObject,
} from './common.js';
import { createLabRoom } from './lab-room.js';

const H = 0.14;                     // beam height above the table
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const UP = new THREE.Vector3(0, 1, 0);
const ZAX = new THREE.Vector3(0, 0, 1);
const v = (x, y, z) => new THREE.Vector3(x, y, z);
const SPEED = 0.9;                  // pulse speed, world units per second
const GAP = 0.55;                   // spacing between pulses
const P0 = 0.4;                     // where the instrument story starts (the lab room comes before it)
const O = (o) => P0 + (1 - P0) * o; // old storyboard progress → scene progress

/** Polyline with arc-length lookup. */
function polyline(points) {
  const pts = points.filter((p, i) => i === 0 || p.distanceToSquared(points[i - 1]) > 1e-8);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = cum[cum.length - 1];
  return {
    total,
    at(s, out) {
      s = clamp(s, 0, total);
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      const t = (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      return out.lerpVectors(pts[i - 1], pts[i], t);
    },
  };
}

export function createScene(canvas, options = {}) {
  const reducedMotion = !!options.reducedMotion;
  const renderer = createRenderer(canvas);
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 30, 45);   // pulled in to (8, 14) once the camera is inside the optics
  const camera = new THREE.PerspectiveCamera(30, 2, 0.01, 60);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x05060a, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(2, 6, 5); scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fb0ff, 0.8); rim.position.set(-4, 2, -5); scene.add(rim);

  const root = new THREE.Group();
  scene.add(root);
  const textures = [];

  const M = {
    metal: new THREE.MeshStandardMaterial({ color: 0xb8bcc4, metalness: 1, roughness: 0.28 }),
    mirror: new THREE.MeshStandardMaterial({ color: 0xe6edf5, metalness: 1, roughness: 0.06 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2c2f35, metalness: 0.4, roughness: 0.55 }),
    black: new THREE.MeshStandardMaterial({ color: 0x111215, metalness: 0.3, roughness: 0.6 }),
    post: new THREE.MeshStandardMaterial({ color: 0x9a9fa8, metalness: 0.9, roughness: 0.35 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xa8dcff, roughness: 0.05, transparent: true, opacity: 0.32, depthWrite: false }),
    dichroic: new THREE.MeshStandardMaterial({ color: 0xffb3a0, roughness: 0.05, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }),
    redFilter: new THREE.MeshStandardMaterial({ color: 0xff6a5a, roughness: 0.1, transparent: true, opacity: 0.5, depthWrite: false }),
    frame: new THREE.MeshStandardMaterial({ color: 0x46536b, metalness: 0.4, roughness: 0.5 }),
    sample: new THREE.MeshStandardMaterial({ color: 0x3d4f8a, metalness: 0.1, roughness: 0.35 }),
    gold: new THREE.MeshStandardMaterial({ color: COLORS.gold, metalness: 1, roughness: 0.3 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xe0823d, metalness: 0.2, roughness: 0.5 }),
    quartz: new THREE.MeshStandardMaterial({ color: 0xd8dde4, metalness: 0.6, roughness: 0.3 }),
  };

  // ---------------------------------------------------------------- helpers
  let into = root;                                    // where new parts go (the AFM module builds into its own group)
  const add = (m, parent = into) => { parent.add(m); return m; };
  function box(pos, size, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    m.position.copy(pos);
    return add(m);
  }
  function along(mesh, axis, ref = UP) { mesh.quaternion.setFromUnitVectors(ref, axis.clone().normalize()); return mesh; }
  function rod(a, b, r, mat) {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 12), mat);
    m.position.copy(a).addScaledVector(d, 0.5);
    return add(along(m, d));
  }
  function post(x, z, yTop) {
    if (yTop <= 0.01) return;
    rod(v(x, 0, z), v(x, yTop, z), 0.016, M.post);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.02, 20), M.dark);
    b.position.set(x, 0.01, z);
    add(b);
  }
  function mirror(p, dIn, dOut, withPost = true, r = 0.06) {
    const n = dOut.clone().normalize().sub(dIn.clone().normalize()).normalize();
    const face = along(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.014, 32), M.mirror), n);
    face.position.copy(p);
    const mount = along(new THREE.Mesh(new THREE.CylinderGeometry(r + 0.014, r + 0.014, 0.03, 32), M.black), n);
    mount.position.copy(p).addScaledVector(n, -0.024);
    add(face); add(mount);
    if (withPost) post(p.x - n.x * 0.04, p.z - n.z * 0.04, p.y - r);
  }
  function lens(p, axis, mat = M.glass, r = 0.06) {
    add(along(new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.018, 32), mat), axis)).position.copy(p);
    add(along(new THREE.Mesh(new THREE.TorusGeometry(r, 0.009, 8, 32), M.black), axis, ZAX)).position.copy(p);
    post(p.x, p.z, p.y - r);
  }
  function plate(p, normal, mat, size = 0.13) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, 0.01), mat);
    m.position.copy(p);
    along(m, normal, ZAX);
    add(m);
    post(p.x, p.z, p.y - size / 2);
  }
  function fibreCoupler(p, axis) {
    add(along(new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.13, 24), M.metal), axis)).position.copy(p);
    for (const o of [-0.045, 0.03]) {
      add(along(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.016, 24), M.black), axis)).position.copy(p).addScaledVector(axis, o);
    }
    post(p.x, p.z, p.y - 0.045);
  }

  // ---------------------------------------------------------------- tables
  function table(x0, x1, z0, z1, tint) {
    const w = x1 - x0, d = z1 - z0;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#3a3a3a'; g.beginPath(); g.arc(32, 32, 7, 0, Math.PI * 2); g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(w / 0.1, d / 0.1);
    tex.anisotropy = 4;
    textures.push(tex);
    const top = new THREE.MeshStandardMaterial({ map: tex, color: tint, metalness: 0.5, roughness: 0.75 });
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, d), [M.black, M.black, top, M.black, M.black, M.black]);
    slab.position.set((x0 + x1) / 2, -0.06, (z0 + z1) / 2);
    add(slab);
    for (const [x, z] of [[x0 + 0.2, z0 + 0.2], [x1 - 0.2, z0 + 0.2], [x0 + 0.2, z1 - 0.2], [x1 - 0.2, z1 - 0.2]]) {
      box(v(x, -0.42, z), [0.16, 0.6, 0.16], M.black);
    }
  }
  table(-2.046, -0.124, -0.527, 0.713, 0x2a2228);    // excitation table
  table(0.124, 3.4, -0.744, 0.868, 0x1f262c);         // microscope + AFM table

  // ---------------------------------------------------------------- excitation table
  const px = v(1, 0, 0), nx = v(-1, 0, 0), pz = v(0, 0, 1), nz = v(0, 0, -1), py = v(0, 1, 0), ny = v(0, -1, 0);
  // laser head with heat-sink fins
  box(v(-1.798, 0.11, 0.186), [0.5, 0.2, 0.24], M.dark);
  for (let i = 0; i < 6; i++) box(v(-1.948 + i * 0.06, 0.225, 0.186), [0.02, 0.03, 0.22], M.black);
  add(along(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.05, 16), M.black), px)).position.set(-1.523, H, 0.186);
  mirror(v(-1.364, H, 0.186), px, nz);
  mirror(v(-1.364, H, -0.341), nz, px);
  lens(v(-1.209, H, -0.341), px, M.black, 0.045);               // λ/2 plate
  box(v(-0.992, H, -0.341), [0.1, 0.1, 0.1], M.glass);           // beam splitter cube
  add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.1, 0.1, 0.1)),
    new THREE.LineBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.6 }))).position.set(-0.992, H, -0.341);
  box(v(-0.992, 0.045, -0.341), [0.12, 0.09, 0.12], M.dark);
  box(v(-0.639, H, -0.341), [0.06, 0.12, 0.12], M.black);       // beam dump
  post(-0.639, -0.341, H - 0.06);
  lens(v(-0.992, H, -0.186), pz);
  box(v(-0.992, H, 0), [0.14, 0.11, 0.2], M.dark);              // AOM
  box(v(-0.992, H, 0), [0.145, 0.03, 0.205], M.black);
  box(v(-0.992, 0.04, 0), [0.16, 0.08, 0.22], M.black);
  box(v(-0.992, H, 0.186), [0.16, 0.16, 0.012], M.black);         // iris: passes the first order only
  post(-0.992, 0.186, H - 0.08);
  lens(v(-0.992, H, 0.341), pz);
  mirror(v(-0.992, H, 0.527), pz, px);
  mirror(v(-0.434, H, 0.527), px, nz);
  fibreCoupler(v(-0.434, H, 0.124), pz);

  // ---------------------------------------------------------------- microscope table
  fibreCoupler(v(0.384, H, -0.372), px);
  mirror(v(0.806, H, -0.372), px, pz);
  mirror(v(0.806, H, -0.124), pz, px);
  plate(v(1.24, H, -0.124), v(-1, 0, 1).normalize(), M.dichroic);  // dichroic: green reflects, red passes
  mirror(v(1.24, H, 0.155), pz, nx);
  mirror(v(0.558, H, 0.155), nx, pz);
  // galvo: two-axis scan mirror in a housing
  mirror(v(0.558, H, 0.403), pz, px, false);
  box(v(0.515, H, 0.446), [0.14, 0.16, 0.14], M.dark);
  box(v(0.515, 0.03, 0.446), [0.2, 0.06, 0.2], M.black);
  lens(v(0.93, H, 0.403), px);
  lens(v(1.364, H, 0.403), px);
  plate(v(1.705, H, 0.403), v(1, 0, -1).normalize(), M.dichroic, 0.11);   // pick-off to the camera
  box(v(1.705, H, 0.105), [0.14, 0.14, 0.14], M.frame);           // CCD
  add(along(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.08, 20), M.black), pz)).position.set(1.705, H, 0.174);
  box(v(1.705, 0.03, 0.105), [0.16, 0.06, 0.16], M.black);
  lens(v(1.24, H, -0.341), pz, M.redFilter);                      // 650 nm long-pass
  fibreCoupler(v(1.24, H, -0.496), pz);
  box(v(1.798, 0.105, -0.527), [0.55, 0.19, 0.28], M.dark);        // SPCM
  box(v(1.798, 0.205, -0.527), [0.5, 0.012, 0.24], M.black);
  // periscope: up, along above the table, and straight down into the AFM objective at the table's far end
  const BZ = 0.403;
  const AFM_AT = v(2.8, 0.04, BZ), AFM_S = 0.5;      // the AFM module stands on this table, at half scale
  const Y_TOP = 1.03;                                 // periscope height, above the AFM gantry
  mirror(v(1.953, H, BZ), px, py, false);
  mirror(v(1.953, Y_TOP, BZ), py, px, false);
  mirror(v(AFM_AT.x, Y_TOP, BZ), px, ny, false);
  rod(v(1.953, 0, 0.347), v(1.953, Y_TOP + 0.06, 0.347), 0.012, M.post);
  rod(v(1.953, 0, 0.459), v(1.953, Y_TOP + 0.06, 0.459), 0.012, M.post);
  box(v((1.92 + AFM_AT.x + 0.06) / 2, Y_TOP + 0.075, BZ), [AFM_AT.x + 0.06 - 1.92, 0.03, 0.05], M.dark);   // top arm
  rod(v(2.3, 0, BZ - 0.1), v(2.3, Y_TOP + 0.09, BZ - 0.1), 0.02, M.post);
  box(v(2.3, Y_TOP + 0.075, BZ - 0.05), [0.05, 0.03, 0.12], M.dark);

  // ---------------------------------------------------------------- AFM module (far end of the microscope table)
  // built in its own frame (origin on the platform top, under the objective), then placed on the table at AFM_S
  const afm = new THREE.Group();
  afm.position.copy(AFM_AT); afm.scale.setScalar(AFM_S);
  root.add(afm);
  into = afm;
  const A = v(0, 0, 0);
  const a = (x, y, z) => v(A.x + x, A.y + y, A.z + z);
  const aw = (x, y, z) => v(AFM_AT.x + AFM_S * x, AFM_AT.y + AFM_S * y, AFM_AT.z + AFM_S * z);   // module → world
  const flexure = new THREE.MeshStandardMaterial({ color: 0x27324a, metalness: 0.5, roughness: 0.4 });
  const titan = new THREE.MeshStandardMaterial({ color: 0xa9adb3, metalness: 0.85, roughness: 0.32 });
  const glowLine = new THREE.MeshBasicMaterial({ color: 0x64d2ff, toneMapped: false, transparent: true, opacity: 0.55 });
  const rimMat = new THREE.MeshBasicMaterial({ color: 0x64d2ff, toneMapped: false, transparent: true, opacity: 0.9 });
  function coarseStack(x, z, w, y0, n, hgt) {
    let y = y0;
    for (let i = 0; i < n; i++) {
      box(v(x, y + hgt / 2, z), [w, hgt, w], titan);
      box(v(x, y + hgt + 0.003, z), [w * 0.92, 0.006, w * 0.92], M.black);   // drive gap
      y += hgt + 0.006;
    }
    return y;
  }
  function rimAround(cx, y, cz, w, d, t, mat) {
    for (const [dx, dz, bw, bd] of [[0, -d / 2, w + t, t], [0, d / 2, w + t, t], [-w / 2, 0, t, d + t], [w / 2, 0, t, d + t]]) {
      box(v(cx + dx, y, cz + dz), [bw, t * 0.6, bd], mat);
    }
  }
  // platform
  box(a(0, -0.04, 0), [1.7, 0.08, 1.5], M.dark);
  rimAround(A.x, A.y + 0.002, A.z, 1.7, 1.5, 0.01, glowLine);
  // coarse stick-slip XYZ, with status LEDs that step in turn
  box(a(0, 0.02, 0), [0.62, 0.04, 0.62], M.black);
  const yc = coarseStack(A.x, A.z, 0.34, A.y + 0.04, 3, 0.1);
  const leds = [0, 1, 2].map((i) => box(v(A.x + 0.11, A.y + 0.09 + i * 0.106, A.z + 0.172), [0.03, 0.014, 0.004],
    new THREE.MeshBasicMaterial({ color: 0x30d158, toneMapped: false })));
  // piezo XYZ flexure scanner with a glowing rim
  box(v(A.x, yc + 0.06, A.z), [0.52, 0.12, 0.52], flexure);
  rimAround(A.x, yc + 0.121, A.z, 0.52, 0.52, 0.008, rimMat);
  const rimGlow = add(makeGlowSprite(0x64d2ff, { opacity: 0.3, size: 1.1 }));
  rimGlow.position.set(A.x, yc + 0.12, A.z);
  add(along(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.07, 12), M.black), px)).position.set(A.x + 0.29, yc + 0.06, A.z - 0.1);
  // the scanning part: inner frame, puck and sample move together in a raster under the fixed tip
  const S_TOP = A.y + 0.66;
  const FOCUS = v(A.x, S_TOP + 0.012, A.z);              // NV at the probe apex
  const scanner = new THREE.Group(); afm.add(scanner);
  const sc = (m) => { scanner.add(m); return m; };
  sc(box(v(A.x, yc + 0.124, A.z), [0.36, 0.006, 0.36], M.frame));
  for (const [dx, dz] of [[-0.15, -0.15], [0.15, -0.15], [-0.15, 0.15], [0.15, 0.15]]) {
    const scr = sc(add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.008, 12), titan)));
    scr.position.set(A.x + dx, yc + 0.128, A.z + dz);
  }
  const puckBot = yc + 0.127, puckTop = S_TOP - 0.02;
  sc(add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, puckTop - puckBot, 32), titan))).position.set(A.x, (puckTop + puckBot) / 2, A.z);
  sc(box(v(A.x, S_TOP - 0.01, A.z), [0.24, 0.02, 0.2], M.sample));     // YIG film on GGG
  sc(box(v(A.x, S_TOP + 0.002, A.z + 0.06), [0.22, 0.004, 0.016], M.gold));   // stripline
  // the image building up: spin-wave fringes, painted row by row as the raster runs
  const IMG = 48;
  const imgCanvas = document.createElement('canvas'); imgCanvas.width = imgCanvas.height = IMG;
  const ig = imgCanvas.getContext('2d');
  const imgTex = new THREE.CanvasTexture(imgCanvas);
  imgTex.colorSpace = THREE.SRGBColorSpace; imgTex.magFilter = THREE.NearestFilter;
  textures.push(imgTex);
  const imgPlane = sc(add(new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.11), new THREE.MeshBasicMaterial({ map: imgTex, toneMapped: false }))));
  imgPlane.rotation.x = -Math.PI / 2; imgPlane.position.set(A.x, S_TOP + 0.0008, A.z - 0.025);
  let imgRow = -1;
  function paintRow(r) {
    if (r === 0) { ig.fillStyle = '#0d1424'; ig.fillRect(0, 0, IMG, IMG); }
    for (let c = 0; c < IMG; c++) {
      const xx = c - IMG / 2;                                  // stripline in the middle
      const w = Math.cos(Math.abs(xx) * 0.7 - r * 0.15) * Math.exp(-Math.abs(xx) / 30) * clamp(Math.abs(xx) / 2);
      const al = Math.abs(w);
      ig.fillStyle = xx < 0 ? `rgba(255,55,95,${0.15 + 0.85 * al * (w > 0)})` : `rgba(100,210,255,${0.15 + 0.85 * al * (w > 0)})`;
      ig.fillRect(c, r, 1, 1);
    }
    imgTex.needsUpdate = true;
  }
  paintRow(0);
  function scan(t) {
    const rowF = (t * 2) % IMG;
    const row = Math.floor(rowF);
    const fx = rowF - row;                                     // fast axis within a row
    const tri = fx < 0.8 ? fx / 0.8 : 1 - (fx - 0.8) / 0.2;      // trace, quick retrace
    scanner.position.set((0.5 - tri) * 0.05, 0, (0.5 - row / IMG) * 0.012);
    if (row !== imgRow) {
      if (row < imgRow) { paintRow(0); imgRow = 0; }
      for (let r = Math.max(0, imgRow + 1); r <= row; r++) paintRow(r);
      imgRow = row;
    }
    leds.forEach((l, i) => l.material.color.setHex(Math.floor(t * 3) % 3 === i ? 0x30d158 : 0x0f3d1c));
    rimMat.opacity = 0.7 + 0.3 * Math.sin(t * 2.2);
    rimGlow.material.opacity = 0.2 + 0.12 * Math.sin(t * 2.2);
  }
  // gantry: objective on top, NV probe hanging from the cross-beam below it
  for (const sx of [-0.62, 0.62]) box(a(sx, 0.86, -0.3), [0.08, 1.72, 0.08], M.frame);
  box(a(0, 1.7, -0.3), [1.32, 0.08, 0.1], M.frame);
  box(a(0, 1.7, -0.13), [0.14, 0.05, 0.34], M.dark);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 32), M.dark)).position.copy(a(0, 1.665, 0));
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.24, 32), M.metal)).position.copy(a(0, 1.53, 0));
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.087, 0.087, 0.02, 32), M.orange)).position.copy(a(0, 1.47, 0));
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.03, 0.1, 32), M.metal)).position.copy(a(0, 1.36, 0));
  box(a(0, 1.06, -0.3), [1.32, 0.07, 0.1], M.frame);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.12, 20), flexure)).position.copy(a(0, 0.965, -0.3));  // probe Z piezo
  rimAround(A.x, A.y + 0.9, A.z - 0.3, 0.08, 0.08, 0.006, rimMat);
  box(a(0, 0.885, -0.17), [0.05, 0.04, 0.28], M.frame);
  box(a(0, 0.82, -0.045), [0.08, 0.06, 0.05], M.dark);
  // the probe: hexagonal diamond tip on a plate, on a quartz tuning fork running back to the holder
  const tipMat = new THREE.MeshStandardMaterial({ color: 0xcfefff, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.6, flatShading: true });
  const sTip = add(new THREE.Mesh(new THREE.ConeGeometry(0.0068, 0.022, 6), tipMat));
  sTip.rotation.x = Math.PI; sTip.position.copy(FOCUS).add(v(0, 0.011, 0));
  box(v(FOCUS.x, FOCUS.y + 0.0246, FOCUS.z), [0.019, 0.0052, 0.019], tipMat);
  for (const fx of [0, 0.021]) box(v(FOCUS.x + fx, FOCUS.y + 0.0296, FOCUS.z - 0.04), [0.011, 0.0048, 0.085], M.quartz);
  box(v(FOCUS.x + 0.0105, FOCUS.y + 0.032, FOCUS.z - 0.088), [0.042, 0.01, 0.024], M.quartz);
  rod(v(FOCUS.x + 0.0105, FOCUS.y + 0.036, FOCUS.z - 0.088), a(0.0105, 0.79, -0.06), 0.004, M.quartz);
  // waveguide probe: on its own coarse stack beside the sample, its arm reaches in from above and the
  // gold tip lands on the stripline
  box(a(0, 0.02, 0.52), [0.2, 0.04, 0.2], M.black);
  const yw = coarseStack(A.x, A.z + 0.52, 0.15, A.y + 0.04, 2, 0.08);
  const WG_Y = S_TOP + 0.11;
  box(v(A.x, (yw + WG_Y) / 2, A.z + 0.52), [0.08, WG_Y - yw, 0.08], M.dark);
  box(v(A.x, WG_Y, A.z + 0.41), [0.05, 0.04, 0.26], M.dark);
  add(along(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.05, 12), M.orange), px)).position.set(A.x + 0.065, WG_Y - 0.06, A.z + 0.52);
  const wgRod = add(new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 1, 10), M.gold));
  const wgFrom = v(A.x, WG_Y - 0.01, A.z + 0.29), wgTo = v(), wgD = v();
  function aimWaveguide() {
    wgTo.set(A.x + 0.07, S_TOP + 0.009, A.z + 0.06);                           // contact point on the stripline
    wgD.subVectors(wgTo, wgFrom);
    wgRod.scale.set(1, wgD.length(), 1);
    wgRod.position.copy(wgFrom).addScaledVector(wgD, 0.5);
    wgRod.quaternion.setFromUnitVectors(UP, wgD.normalize());
  }
  aimWaveguide();
  into = root;
  const FOCUS_W = aw(FOCUS.x, FOCUS.y, FOCUS.z);

  // ---------------------------------------------------------------- beams
  const cwPts = [v(-1.5, H, 0.186), v(-1.364, H, 0.186), v(-1.364, H, -0.341), v(-0.992, H, -0.341), v(-0.992, H, 0)];
  const dumpPts = [v(-0.992, H, -0.341), v(-0.657, H, -0.341)];
  const g2Pts = [v(-0.992, H, 0), v(-0.992, H, 0.527), v(-0.434, H, 0.527), v(-0.434, H, 0.167)];
  const fibre1 = new THREE.CatmullRomCurve3([v(-0.434, H, 0.081), v(-0.434, 0.22, -0.074), v(-0.248, 0.44, -0.31), v(0.062, 0.46, -0.484), v(0.26, H + 0.05, -0.397), v(0.341, H, -0.372)]);
  const g3Pts = [v(0.428, H, -0.372), v(0.806, H, -0.372), v(0.806, H, -0.124), v(1.24, H, -0.124), v(1.24, H, 0.155), v(0.558, H, 0.155),
    v(0.558, H, BZ), v(1.953, H, BZ), v(1.953, Y_TOP, BZ), v(AFM_AT.x, Y_TOP, BZ), aw(0, 1.68, 0), FOCUS_W.clone()];
  const redTail = [v(1.24, H, -0.124), v(1.24, H, -0.453)];
  const fibre2 = new THREE.CatmullRomCurve3([v(1.24, H, -0.539), v(1.265, 0.26, -0.645), v(1.488, 0.3, -0.682), v(1.593, H + 0.03, -0.546), v(1.627, H, -0.527)]);
  const ccdPts = [v(1.705, H, 0.403), v(1.705, H, 0.198)];

  const tubes = (pts, color, opts) => { for (let i = 1; i < pts.length; i++) add(makeTube(pts[i - 1], pts[i], color, opts)); };
  tubes(cwPts, COLORS.laser, { radius: 0.008, opacity: 0.85, additive: true });
  tubes(dumpPts, COLORS.laser, { radius: 0.006, opacity: 0.35, additive: true });
  tubes(g2Pts, COLORS.laser, { radius: 0.006, opacity: 0.22, additive: true });
  tubes(g3Pts, COLORS.laser, { radius: 0.006, opacity: 0.22, additive: true });
  tubes([v(AFM_AT.x, Y_TOP, BZ), aw(0, 1.68, 0)], COLORS.laser, { radius: 0.01, opacity: 0.35, additive: true });   // the drop to the AFM
  tubes(redTail, COLORS.nvRed, { radius: 0.006, opacity: 0.25, additive: true });
  tubes(ccdPts, COLORS.nvRed, { radius: 0.005, opacity: 0.2, additive: true });
  const fibreMat = new THREE.MeshStandardMaterial({ color: 0x2f6fd6, emissive: 0x16408a, emissiveIntensity: 0.6, roughness: 0.4 });
  add(new THREE.Mesh(new THREE.TubeGeometry(fibre1, 80, 0.012, 8, false), fibreMat));
  add(new THREE.Mesh(new THREE.TubeGeometry(fibre2, 40, 0.012, 8, false), fibreMat));

  // pulses: green after the AOM (out to the NV), red back from the NV to the SPCM
  const greenPath = polyline([...g2Pts, ...fibre1.getPoints(60), ...g3Pts]);
  const g3Rev = g3Pts.slice(3).reverse();                        // focus … dichroic
  const redPath = polyline([...g3Rev, ...redTail.slice(1), ...fibre2.getPoints(30)]);
  function makePulses(path, color, size, outbound) {
    const n = Math.ceil(path.total / GAP);
    const list = [];
    for (let i = 0; i < n; i++) list.push(add(makeGlowSprite(color, { size, opacity: 0.95 })));
    return { path, list, size, outbound };
  }
  const greenPulses = makePulses(greenPath, COLORS.laser, 0.11, true);    // ends at the NV
  const redPulses = makePulses(redPath, COLORS.nvRed, 0.1, false);        // starts at the NV
  const nvGlow = add(makeGlowSprite(COLORS.nvRed, { size: 0.05 }), afm);
  nvGlow.position.copy(FOCUS);
  const nvBloom = add(makeGlowSprite(COLORS.nvRedSoft, { size: 0.16, opacity: 0.4 }), afm);
  nvBloom.position.copy(FOCUS);

  function placePulses(group, time, shrink) {
    const { path, list, size, outbound } = group;
    const off = (time * SPEED) % GAP;
    list.forEach((s, i) => {
      const d = off + i * GAP;
      s.visible = d <= path.total;
      if (!s.visible) return;
      path.at(d, s.position);
      // smaller on the drop into the (half-scale) AFM, so the pulses keep their size against it at close range;
      // measured along the beam, so the size only changes one way
      const toFocus = outbound ? path.total - d : d;
      s.scale.setScalar(size * lerp(1 - shrink, 1, smoothstep(0.15, 0.7, toFocus)));
      s.material.opacity = 0.95 * clamp(d / 0.15) * clamp((path.total - d) / 0.15);
    });
  }

  // ---------------------------------------------------------------- labels
  const labels = [];
  // phoneAnchor: horizontal anchor on small screens (0 = label grows right of its point, 1 = left), for labels near a portrait frame's edge
  function label(text, pos, { minor = false, color = '#c7c7cc', group = 'optics', scale = 0.12, parent = root, phoneAnchor = 0.5 } = {}) {
    const s = makeLabelSprite(text, {
      color, fontSize: 42, fontFamily: MONO, fontWeight: 500, scale, glow: false,
      background: 'rgba(0,0,0,0.6)', padding: 12,
    });
    s.position.copy(pos);
    Object.assign(s.userData, { base: s.scale.clone(), minor, group, phoneAnchor });
    labels.push(s);
    return add(s, parent);
  }
  label('532 nm laser', v(-1.798, 0.36, 0.186));
  label('λ/2', v(-1.26, 0.2, -0.47), { minor: true });
  label('Beam splitter', v(-0.95, 0.34, -0.42), { minor: true });
  label('AOM', v(-0.992, 0.33, 0));
  label('Fibre', v(-0.124, 0.6, -0.372));
  label('Dichroic', v(1.24, 0.33, -0.124), { minor: true });
  label('Galvo', v(0.515, 0.36, 0.446));
  label('4f relay', v(1.147, 0.3, 0.403), { minor: true });
  label('CCD', v(1.705, 0.33, 0.105), { minor: true });
  label('Photon counter', v(1.798, 0.38, -0.527));
  label('Periscope', v(2.12, 0.85, BZ), { group: 'peri' });
  label('AFM', v(AFM_AT.x + 0.45, 0.62, BZ), { minor: true });   // off the right edge in portrait; the table sign names it there
  label('EXCITATION', v(-1.085, 0.06, 0.775), { color: '#8e8e93' });
  label('CONFOCAL + AFM TABLE', v(1.762, 0.06, 0.93), { color: '#8e8e93' });
  const al = { group: 'afm', scale: 0.07, parent: afm };          // in the module's frame, so they scale with it
  label('50× objective', a(0.36, 1.53, 0), al);
  label('NV probe · tuning fork', a(-0.42, 0.8, 0), al);
  label('Piezo XYZ scanner', a(0.5, 0.48, 0.32), al);
  label('Coarse XYZ · stick-slip', a(0.66, 0.34, 0.2), { ...al, phoneAnchor: 0.85 });
  label('Waveguide', a(-0.2, 0.5, 0.62), { ...al, phoneAnchor: 0.3 });
  label('AFM + NANO-POSITIONING', a(0, 1.84, -0.3), { ...al, color: '#8e8e93' });   // a sign on the gantry's top beam

  // ---------------------------------------------------------------- close-up: the tip above the YIG film
  const micro = new THREE.Scene();
  micro.environment = envTex;
  micro.add(new THREE.HemisphereLight(0xcfe8ff, 0x05060a, 0.5));
  const mKey = new THREE.DirectionalLight(0xffffff, 1.3); mKey.position.set(3, 6, 4); micro.add(mKey);
  const mcam = new THREE.PerspectiveCamera(34, 2, 0.05, 60);
  const waveU = { uTime: { value: 0 } };
  const filmMat = new THREE.ShaderMaterial({
    uniforms: waveU,
    vertexShader: `
      uniform float uTime; varying vec3 vP; varying float vW;
      void main() {
        vec3 p = position;
        float ax = abs(p.x);
        float env = exp(-ax / 5.0) * smoothstep(0.2, 0.7, ax);
        float w = cos(ax * 3.2 - uTime * 2.4) * env;
        p.z += 0.07 * w;                       // plane is rotated: local z is up
        vP = p; vW = w;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vP; varying float vW;
      void main() {
        vec3 base = vec3(0.05, 0.08, 0.16);
        vec3 col = vP.x < 0.0 ? vec3(1.0, 0.22, 0.37) : vec3(0.39, 0.82, 1.0);
        float crest = max(vW, 0.0);
        vec3 c = base + col * (0.12 * abs(vW) + 0.75 * crest * crest);
        float edge = smoothstep(4.8, 6.0, abs(vP.x)) + smoothstep(2.4, 3.0, abs(vP.y));
        gl_FragColor = vec4(mix(c, base * 0.5, clamp(edge, 0.0, 1.0)), 1.0);
      }`,
  });
  const film = new THREE.Mesh(new THREE.PlaneGeometry(12, 6, 360, 2), filmMat);
  film.rotation.x = -Math.PI / 2;
  micro.add(film);
  const ggg = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 6), M.dark); ggg.position.y = -0.22; micro.add(ggg);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 6), M.gold); strip.position.y = 0.05; micro.add(strip);
  const mProbe = new THREE.Group(); micro.add(mProbe);
  const diaMat = new THREE.MeshPhysicalMaterial({ color: 0xcfefff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false });
  // same probe as the scanning scene above: hexagonal diamond tip on a plate, glued to a quartz tuning fork
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xeaf6ff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.32,
    clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.5, iridescenceIOR: 1.6,
    envMapIntensity: 2.6, flatShading: true, specularIntensity: 1, depthWrite: false,
  });
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xcfe8ff, transparent: true, opacity: 0.45 });
  const tipGeo = new THREE.ConeGeometry(0.34, 1.1, 6, 1); tipGeo.rotateX(Math.PI); tipGeo.translate(0, 0.55, 0);
  const plateGeo = new THREE.BoxGeometry(0.95, 0.26, 0.95); plateGeo.translate(0, 1.23, 0);
  for (const g of [tipGeo, plateGeo]) {
    const m = new THREE.Mesh(g, glassMat); m.renderOrder = 5;
    mProbe.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(g), edgeMat));
  }
  const fork = new THREE.Group(); fork.position.set(0, 1.36, 0); fork.rotation.x = 0.09; mProbe.add(fork);
  const quartzMat = new THREE.MeshPhysicalMaterial({
    color: 0xf2f6fb, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.22, emissive: 0x2a3038,
    clearcoat: 1, envMapIntensity: 2.0, depthWrite: false,
  });
  const qEdge = new THREE.LineBasicMaterial({ color: 0xdfe8f5, transparent: true, opacity: 0.22 });
  for (const fx of [0, 1.05]) {
    const g = new THREE.BoxGeometry(0.55, 0.24, 6.6); g.translate(fx, 0.12, -3.0);
    const m = new THREE.Mesh(g, quartzMat); m.renderOrder = 4;
    fork.add(m, new THREE.LineSegments(new THREE.EdgesGeometry(g), qEdge));
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.012, 6.2), M.gold); e.position.set(fx, 0.248, -3.1); fork.add(e);
  }
  const forkBase = new THREE.BoxGeometry(2.1, 0.5, 1.2); forkBase.translate(0.525, 0.25, -6.9);
  fork.add(new THREE.Mesh(forkBase, quartzMat), new THREE.LineSegments(new THREE.EdgesGeometry(forkBase), qEdge));
  // green laser, focused from above onto the NV
  const laserMat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(COLORS.laser) } },
    vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ vY = position.y/7.0 + 0.5; vec4 mv = modelViewMatrix*vec4(position,1.0);
      vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; varying float vY; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
      float a = 0.26*pow(1.0 - vY, 1.4)*f + 0.16*exp(-vY*12.0);
      gl_FragColor = vec4(uColor, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mLaser = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.02, 7, 40, 1, true), laserMat);
  mLaser.position.y = 3.58; mLaser.renderOrder = 6; mProbe.add(mLaser);
  const mCore = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshBasicMaterial({ color: 0xff5040, toneMapped: false }));
  mCore.position.y = 0.09; mProbe.add(mCore);
  const mNv = makeGlowSprite(COLORS.nvRed, { size: 0.75 }); mNv.position.y = 0.09; mProbe.add(mNv);
  const mNvBloom = makeGlowSprite(COLORS.nvRedSoft, { size: 2.4, opacity: 0.45 }); mNvBloom.position.y = 0.09; mProbe.add(mNvBloom);
  const mLabels = [];
  const mLabel = (text, pos, color = '#c7c7cc', parent = micro) => {
    const s = makeLabelSprite(text, { color, fontSize: 42, fontFamily: MONO, fontWeight: 500, scale: 0.3, glow: false, background: 'rgba(0,0,0,0.6)', padding: 12 });
    s.position.copy(pos); parent.add(s); mLabels.push(s); return s;
  };
  mLabel('NV centre', v(0.95, 0.3, 0), '#ff8a80', mProbe);
  mLabel('Diamond tip', v(-1.05, 0.8, 0), '#c7c7cc', mProbe);
  mLabel('Tuning fork', v(-1.4, 1.9, -2.6), '#8e8e93', mProbe);
  mLabel('σ+ wave', v(-3.2, 0.7, 1.2), '#ff375f');
  mLabel('σ− wave', v(3.2, 0.7, 1.2), '#64d2ff');
  mLabel('Stripline', v(0, 0.35, 2.2));
  mLabel('YIG film', v(4.2, 0.3, -2.2), '#8e8e93');

  // ---------------------------------------------------------------- the lab around it (opening act)
  const room = createLabRoom({ parent: root, textures });

  // ---------------------------------------------------------------- storyboard camera
  const roomView = { t: v(0.6, 1.15, -0.2), r: 18, yaw: 0.62, pitch: 0.36 };
  const rackView = { t: v(0.55, 1.95, 0.05), r: 8.6, yaw: 0.14, pitch: 0.16 };
  const encView = { t: v(0.65, 0.5, 0.05), r: 10, yaw: -0.42, pitch: 0.3 };
  const ctrlView = { t: v(0.6, 0.75, 0.05), r: 11, yaw: 0.2, pitch: 0.32 };
  const table1 = { t: v(-1.05, 0.06, 0.05), r: 3.7, yaw: 0.18, pitch: 0.62 };
  const table2 = { t: v(1.76, -0.05, 0.06), r: 4.6, yaw: -0.2, pitch: 0.62 };
  const KEYS = [
    { p: 0.00, ...roomView, r: 21, yaw: 0.8 },
    { p: 0.045, ...roomView },
    { p: 0.08, ...roomView, r: 17.5, yaw: 0.5 },
    { p: 0.14, ...rackView },
    { p: 0.185, ...rackView, yaw: 0.06 },
    { p: 0.24, ...encView },
    { p: 0.28, ...encView, yaw: -0.3 },
    { p: 0.345, ...ctrlView },
    { p: 0.385, ...ctrlView, yaw: 0.14 },
    { p: 0.445, ...table1 },
    { p: 0.47, ...table1, yaw: 0.1 },
    { p: 0.525, ...table2 },
    { p: 0.55, ...table2, yaw: -0.04 },
    { p: O(0.34), t: v(2.45, 0.5, BZ), r: 2.7, yaw: 0.5, pitch: 0.3 },
    { p: O(0.50), t: aw(0, 0.34, 0), r: 1.8, yaw: 0.4, pitch: 0.26 },
    { p: O(0.62), t: aw(0, 0.4, 0), r: 1.15, yaw: 0.65, pitch: 0.2 },
    { p: O(0.76), t: FOCUS_W.clone().add(v(0, 0.01, 0)), r: 0.1, yaw: 0.75, pitch: 0.12 },
    { p: 1.00, t: FOCUS_W.clone().add(v(0, 0.01, 0)), r: 0.1, yaw: 0.75, pitch: 0.12 },
  ];
  const view = { t: v(0, 0, 0), r: 8, yaw: 0, pitch: 0.6 };
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

  let dragYaw = 0, dragPitch = 0, rMult = 1;
  let dragging = false, lastX = 0, lastY = 0, idleSince = 0, time = 3.2;
  let progT = 0, prog = 0;
  // 'card': a fixed preview inside a link (home page): no labels, no drag-to-orbit
  let card = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (card) return;
    dragging = true; lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
    canvas.classList.add('is-grabbing');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    dragYaw = clamp(dragYaw - (e.clientX - lastX) * 0.006, -1.1, 1.1);
    dragPitch = clamp(dragPitch + (e.clientY - lastY) * 0.004, -0.35, 0.5);
    lastX = e.clientX; lastY = e.clientY;
    idleSince = time;
    if (!loop.running) renderOnce();
  });
  const endDrag = () => { dragging = false; idleSince = time; canvas.classList.remove('is-grabbing'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  const yawCur = { v: 0 }, pitchCur = { v: 0 };
  function orbit(cam, t, r, yaw, pitch) {
    cam.position.set(t.x + r * Math.sin(yaw) * Math.cos(pitch), t.y + r * Math.sin(pitch), t.z + r * Math.cos(yaw) * Math.cos(pitch));
    cam.lookAt(t);
  }
  function placeCamera(dt) {
    const sway = reducedMotion ? 0 : 0.1 * Math.sin((time - idleSince) * 0.12) * clamp((time - idleSince - 1.5) / 3);
    const k = dt ? damp(8, dt) : 1;
    yawCur.v += (dragYaw + (dragging ? 0 : sway) - yawCur.v) * k;
    pitchCur.v += (dragPitch - pitchCur.v) * k;
    const vw = viewAt(prog);
    orbit(camera, vw.t, vw.r * rMult, vw.yaw + yawCur.v, clamp(vw.pitch + pitchCur.v, 0.05, 1.3));
  }

  // fade-through-black between the instrument and the close-up
  const veil = document.createElement('div');
  veil.className = 'setup__veil';
  veil.setAttribute('aria-hidden', 'true');
  canvas.insertAdjacentElement('afterend', veil);

  // ---------------------------------------------------------------- render
  let width = 1, height = 1, small = false;
  function render(_t, dt) {
    if (!reducedMotion) time += dt;
    prog = reducedMotion || !dt ? progT : prog + (progT - prog) * damp(6, dt);
    const p = prog;
    // the lab room first; then labels: optics, then the AFM module
    const roomFade = 1 - smoothstep(0.39, 0.435, p);
    const fogT = smoothstep(0.39, 0.45, p);
    scene.fog.near = lerp(30, 8, fogT);
    scene.fog.far = lerp(45, 14, fogT);
    const aOptics = smoothstep(0.4, 0.44, p) * (1 - smoothstep(O(0.22), O(0.32), p));
    const aAfm = smoothstep(O(0.3), O(0.38), p) * (1 - smoothstep(O(0.66), O(0.72), p));
    const aPeri = smoothstep(0.4, 0.44, p) * (1 - smoothstep(O(0.46), O(0.52), p));   // stays for "down to the sample"
    // on phones the AFM labels start large (the module is small in the frame) and ease back as the camera closes in
    const afmPhone = lerp(1.9, 1.5, smoothstep(O(0.42), O(0.62), p));
    labels.forEach((s) => {
      const g = s.userData.group;
      s.scale.copy(s.userData.base).multiplyScalar(small ? (g === 'afm' ? afmPhone : 1.45) : 1);
      const al2 = g === 'afm' ? aAfm : g === 'peri' ? aPeri : aOptics;
      s.material.opacity = al2;
      s.visible = !card && al2 > 0.01 && !(small && s.userData.minor);
    });
    const black = smoothstep(O(0.72), O(0.79), p) * (1 - smoothstep(O(0.8), O(0.87), p));
    veil.style.opacity = black.toFixed(3);
    const pulseFlash = () => Math.exp(-(((time * SPEED - greenPath.total) % GAP + GAP) % GAP / SPEED) * 5);
    if (p < O(0.795)) {
      room.update(time, p, roomFade, small, reducedMotion, !card);
      placePulses(greenPulses, time, 0.75);
      placePulses(redPulses, time, 0.75);
      scan(time);
      const flash = pulseFlash();
      nvGlow.material.opacity = 0.45 + 0.55 * flash;
      nvGlow.scale.setScalar(0.05 + 0.03 * flash);
      nvBloom.material.opacity = 0.2 + 0.3 * flash;
      placeCamera(dt);
      renderer.render(scene, camera);
    } else {
      // close-up: scrolling sweeps the tip across the stripline; with the microwave on the σ+ line
      // the NV dims over the σ+ (left) wave and stays bright over the σ− (right) one
      const u = smoothstep(O(0.82), O(0.98), p);
      const tx = lerp(2.4, -2.4, u);
      waveU.uTime.value = time;
      mProbe.position.set(tx, reducedMotion ? 0 : Math.sin(time * 1.1) * 0.03, 0);
      const local = Math.exp(-Math.abs(tx) / 5) * smoothstep(0.2, 0.7, Math.abs(tx));
      const dim = tx < 0 ? 0.75 * local : 0;
      const flash = pulseFlash();
      mNv.material.opacity = (1 - dim) * (0.6 + 0.4 * flash);
      mNv.scale.setScalar(0.75 * (1 - 0.5 * dim) + 0.2 * flash);
      mNvBloom.material.opacity = (1 - dim) * 0.45;
      mCore.material.color.setRGB(1, 0.32, 0.25).multiplyScalar(1 - 0.6 * dim);
      const k = dt ? damp(8, dt) : 1;
      yawCur.v += (dragYaw - yawCur.v) * k;
      pitchCur.v += (dragPitch - pitchCur.v) * k;
      orbit(mcam, v(tx * 0.5, 0.6, 0), lerp(7.2, 8.2, u) * rMult, 0.3 + yawCur.v, clamp(0.36 + pitchCur.v, 0.08, 1.3));
      renderer.render(micro, mcam);
    }
  }
  const loop = createLoop(render);
  const renderOnce = () => render(0, 0);

  function resize() {
    width = canvas.clientWidth || 1; height = canvas.clientHeight || 1;
    // wide screens: frame the picture to the right of the section rail (its titles are always shown there)
    const inset = width >= 1024 && document.querySelector('.gnav__rail') ? 150 : 0;
    const aspect = (width - inset) / height;
    renderer.setSize(width, height, false);
    fitCameraToAspect(camera, aspect, { refAspect: 2.0, maxFov: 60 });
    fitCameraToAspect(mcam, aspect, { refAspect: 1.8, maxFov: 62 });
    [camera, mcam].forEach((c) => {
      if (inset) c.setViewOffset(width - inset, height, -inset, 0, width, height);
      else c.clearViewOffset();
    });
    rMult = aspect < 0.8 ? 1.35 : aspect < 1.5 ? 1.12 : 1;
    small = width < 640;
    labels.forEach((s) => { s.center.x = small ? s.userData.phoneAnchor : 0.5; });
    if (!loop.running) renderOnce();
  }
  const unobserve = observeResize(canvas, resize);
  resize();

  return {
    setProgress(pv) { progT = clamp(pv); if (!loop.running) renderOnce(); },
    setParam(name, value) {
      if (name === 'layout') {
        card = value === 'card';
        for (const s of mLabels) s.visible = !card;
        if (!loop.running) renderOnce();
      }
    },
    resize,
    start() { if (reducedMotion) { renderOnce(); return; } loop.start(); },
    stop() { loop.stop(); },
    dispose() {
      loop.stop(); unobserve(); veil.remove();
      disposeObject(scene); disposeObject(micro); textures.forEach((t) => t.dispose()); envTex.dispose(); pmrem.dispose();
      renderer.dispose();
    },
  };
}
