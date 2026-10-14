// lab-room.js — the lab around the instrument, the opening act of the lab-setup story.
//   a Faraday-cage room (electronic noise stops at the walls, temperature tag),
//   instruments suspended from the ceiling, right above the optical system (computer, microwave generator, amplifier),
//   a black curtain + second cage around the two optical tables (airflow stops at the curtain),
//   and the control software: a live screen on the computer with signal lines to every subsystem.
// Everything here is in absolute scroll progress p of the parent scene (0 … ~0.4); the parent fades it out.
import * as THREE from 'three';
import { COLORS, clamp, lerp, smoothstep, band, makeLabelSprite, makeGlowSprite, makeTube } from './common.js';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const v = (x, y, z) => new THREE.Vector3(x, y, z);

// room, floor level (table legs end at -0.72) and ceiling
const ROOM = { x0: -3.4, x1: 4.6, z0: -2.5, z1: 2.1, floor: -0.72, ceil: 3.2 };
// the enclosure around both optical tables (the second table carries the confocal optics and the AFM)
const ENC = { x0: -2.35, x1: 3.65, z0: -1.12, z1: 1.2, top: 1.25 };
const HANG_Z = 0.05;                                 // the hanging instruments line up over the tables

/** polyline with arc-length lookup (pulses along a control line) */
function polyline(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + points[i].distanceTo(points[i - 1]));
  const total = cum[cum.length - 1];
  return {
    total,
    at(s, out) {
      s = clamp(s, 0, total);
      let i = 1;
      while (i < cum.length - 1 && cum[i] < s) i++;
      return out.lerpVectors(points[i - 1], points[i], (s - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1));
    },
  };
}

export function createLabRoom({ parent, textures }) {
  const group = new THREE.Group();
  parent.add(group);
  const mats = [];                                   // [{ material, base }] — faded together with the room
  const track = (m, base = m.opacity) => { m.transparent = true; mats.push({ m, base }); return m; };
  const labels = [];

  const dark = new THREE.MeshStandardMaterial({ color: 0x20242b, metalness: 0.5, roughness: 0.5 });
  const black = new THREE.MeshStandardMaterial({ color: 0x0e0f12, metalness: 0.3, roughness: 0.65 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xaab0b9, metalness: 0.95, roughness: 0.3 });
  const body = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.6, roughness: 0.4 });
  const box = (pos, size, mat, p = group) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), mat);
    m.position.copy(pos); p.add(m); return m;
  };
  // phone: size multiplier on small screens (the wide room shot needs more than the close-ups, where labels sit side by side);
  // phonePos: where the label goes on small screens, when its usual spot falls outside a portrait frame
  const label = (text, pos, { color = '#c7c7cc', scale = 0.2, fade = null, phone = 1.5, phonePos = null } = {}) => {
    const s = makeLabelSprite(text, { color, fontSize: 42, fontFamily: MONO, fontWeight: 500, scale, glow: false, background: 'rgba(0,0,0,0.62)', padding: 12 });
    s.position.copy(pos);
    Object.assign(s.userData, { base: s.scale.clone(), fade, phone, pos: pos.clone(), phonePos });
    labels.push(s); group.add(s); return s;
  };

  // ------------------------------------------------------------ floor + Faraday cage
  const W = ROOM.x1 - ROOM.x0, D = ROOM.z1 - ROOM.z0, Hh = ROOM.ceil - ROOM.floor;
  const cx = (ROOM.x0 + ROOM.x1) / 2, cz = (ROOM.z0 + ROOM.z1) / 2, cy = (ROOM.floor + ROOM.ceil) / 2;

  function gridTexture(w, h, cell, line, bg, rep = true) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, 64, 64); }
    g.strokeStyle = line; g.lineWidth = 3;
    g.strokeRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(w / cell, h / cell);
    t.anisotropy = 4;
    textures.push(t);
    return t;
  }
  const floorMat = track(new THREE.MeshStandardMaterial({
    map: gridTexture(W, D, 0.5, 'rgba(120,170,230,0.30)', '#05070b'), metalness: 0.4, roughness: 0.7, transparent: true, opacity: 1,
  }));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.set(cx, ROOM.floor - 0.002, cz);
  group.add(floor);

  // wire-mesh walls: a fine grid in an alpha texture, so the cage reads as mesh and stays see-through
  function wall(w, h, pos, rotY, rotX = 0, alpha = 0.55, cell = 0.16) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(190,225,255,1)'; g.lineWidth = 2; g.strokeRect(0, 0, 32, 32);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / cell, h / cell);
    t.colorSpace = THREE.SRGBColorSpace; textures.push(t);
    const m = track(new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: alpha, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
    mesh.position.copy(pos); mesh.rotation.set(rotX, rotY, 0);
    group.add(mesh); return mesh;
  }
  const wallAlpha = 0.16;
  wall(W, Hh, v(cx, cy, ROOM.z0), 0, 0, wallAlpha);
  wall(W, Hh, v(cx, cy, ROOM.z1), 0, 0, wallAlpha * 0.6);
  wall(D, Hh, v(ROOM.x0, cy, cz), Math.PI / 2, 0, wallAlpha);
  wall(D, Hh, v(ROOM.x1, cy, cz), Math.PI / 2, 0, wallAlpha);
  wall(W, D, v(cx, ROOM.ceil, cz), 0, Math.PI / 2, wallAlpha * 0.5);
  const roomEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(W, Hh, D)),
    track(new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.85 })));
  roomEdges.position.set(cx, cy, cz); group.add(roomEdges);
  // a door in the front wall, so it reads as a room
  const doorMat = track(new THREE.LineBasicMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.55 }));
  const door = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.0, 1.9, 0.05)), doorMat);
  door.position.set(ROOM.x0 + 1.0, ROOM.floor + 0.95, ROOM.z1); group.add(door);

  label('Faraday cage', v(ROOM.x1 - 0.1, ROOM.ceil + 0.2, ROOM.z1), { color: '#cfe8ff', scale: 0.33, fade: [0, 0.07, 0.1, 0.14], phone: 1.9 });
  // the opening camera looks in from the front right, so the far-left side is ~20 units away: keep these toward the camera
  label('±1 °C', v(ROOM.x0 + 1.2, ROOM.ceil + 0.2, ROOM.z1), { color: '#ffd9a0', scale: 0.4, fade: [0, 0.07, 0.1, 0.14], phone: 1.9 });
  label('Outside electronic noise', v(ROOM.x1 + 1.7, 1.4, 0.9), { color: '#ff9f0a', scale: 0.36, fade: [0.01, 0.04, 0.08, 0.12], phone: 1.9, phonePos: v(cx, ROOM.ceil + 1.1, cz) });

  // thermometer mark beside the temperature tag
  const thermo = new THREE.Group(); thermo.position.set(ROOM.x0 + 1.2, ROOM.ceil + 0.55, ROOM.z1); group.add(thermo);
  const tubeM = track(new THREE.MeshStandardMaterial({ color: 0xdfe8f5, metalness: 0, roughness: 0.2, transparent: true, opacity: 0.4 }));
  const liqM = track(new THREE.MeshBasicMaterial({ color: 0xff6a4d, toneMapped: false }), 1);
  thermo.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.36, 12), tubeM));
  const liq = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 10), liqM); liq.position.y = -0.08; thermo.add(liq);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.06, 14, 10), liqM); bulb.position.y = -0.2; thermo.add(bulb);
  thermo.userData.fade = [0, 0.07, 0.1, 0.14];

  // ------------------------------------------------------------ particle streams (noise, airflow)
  // sprites fly in from outside a rectangle and die at its edge, with a small flash where they hit
  function stream({ color, count, rect, faces, from = 4, speed = 1.0, size = 0.12, ySpan, window: win }) {
    const items = [];
    const pts = [];
    for (let i = 0; i < count; i++) {
      const s = makeGlowSprite(color, { size, opacity: 0 });
      const f = faces[i % faces.length];
      const lane = (i * 0.6180339) % 1;
      const yy = lerp(ySpan[0], ySpan[1], (i * 0.381966 + 0.1) % 1);
      items.push({ s, f, lane, yy, phase: (i * 0.7548) % 1 });
      group.add(s); pts.push(s);
    }
    return {
      update(time, p, vis) {
        const win_ = vis * band(p, ...win);
        for (const it of items) {
          const u = (time * speed / from + it.phase) % 1;           // 0 at spawn → 1 at the wall
          const d = from * (1 - u);
          const [nx, nz] = it.f;
          const x = nx ? (nx < 0 ? rect.x0 : rect.x1) + nx * d : lerp(rect.x0, rect.x1, it.lane);
          const z = nz ? (nz < 0 ? rect.z0 : rect.z1) + nz * d : lerp(rect.z0, rect.z1, it.lane);
          it.s.position.set(x, it.yy, z);
          const hit = smoothstep(0.9, 1, u);
          it.s.material.opacity = win_ * smoothstep(0, 0.12, u) * (1 - hit) * 0.9;
          it.s.scale.setScalar(size * (1 + 1.6 * hit));
        }
      },
    };
  }
  const noise = stream({
    color: 0xff9f0a, count: 64, rect: ROOM, from: 4.2, speed: 1.1, size: 0.22, ySpan: [ROOM.floor + 0.2, ROOM.ceil - 0.1],
    faces: [[-1, 0], [0, -1], [1, 0], [0, 1]], window: [0, 0.01, 0.08, 0.12],
  });

  // ------------------------------------------------------------ hanging instruments (above the enclosure)
  const beamY = ROOM.ceil - 0.04;
  box(v(cx, beamY, HANG_Z), [W - 0.2, 0.08, 0.1], metal);
  const hangs = [];                                              // swing groups
  function unit({ x, w, h, d, y, ledColor = 0x30d158, front = null, fins = false }) {
    const g = new THREE.Group(); g.position.set(x, y, HANG_Z); group.add(g);
    // body
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), body); g.add(b);
    box(v(0, h / 2 + 0.004, 0), [w * 0.98, 0.008, d * 0.98], black, g);
    if (fins) for (let i = -3; i <= 3; i++) box(v(i * (w / 8), h / 2 + 0.03, 0), [0.014, 0.05, d * 0.9], dark, g);
    // front panel details
    if (!front) {
      for (let i = 0; i < 4; i++) {
        const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.004), new THREE.MeshBasicMaterial({ color: ledColor, toneMapped: false }));
        led.position.set(-w / 2 + 0.1 + i * 0.07, h * 0.15, d / 2 + 0.003); Object.assign(led.userData, { led: i, color: ledColor }); g.add(led);
      }
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.02, 20), metal);
      dial.rotation.x = Math.PI / 2; dial.position.set(w / 2 - 0.12, 0, d / 2 + 0.01); g.add(dial);
      box(v(0.05, -h * 0.15, d / 2 + 0.003), [w * 0.5, 0.012, 0.004], black, g);
    }
    // suspension cables from the ceiling beam, with a small hanger at the top of each
    for (const sx of [-1, 1]) {
      const px = sx * (w / 2 - 0.08);
      const yTop = beamY - 0.04 - y;                              // local to the unit group
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, yTop - h / 2, 6), metal);
      cab.position.set(px, (yTop + h / 2) / 2, 0); g.add(cab);
      box(v(px, yTop - 0.03, 0), [0.05, 0.06, 0.05], dark, g);
    }
    hangs.push(g);
    return g;
  }
  const comp = unit({ x: -1.2, w: 1.2, h: 0.78, d: 0.16, y: 2.15, front: true });
  box(v(0, -0.5, 0), [0.7, 0.2, 0.42], body, comp);
  for (let i = 0; i < 3; i++) {
    const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.012, 0.004), new THREE.MeshBasicMaterial({ color: 0x64d2ff, toneMapped: false }));
    led.position.set(-0.22 + i * 0.07, -0.5, 0.212); comp.add(led);
  }
  // cable from the monitor body to the tower so it reads as one suspended assembly
  box(v(0, -0.33, 0), [0.05, 0.12, 0.05], dark, comp);
  const mw = unit({ x: 0.75, w: 0.95, h: 0.22, d: 0.5, y: 2.4, ledColor: 0xffb340 });
  const amp = unit({ x: 2.3, w: 0.95, h: 0.3, d: 0.5, y: 2.3, ledColor: 0xff6a4d, fins: true });
  const leds = [];
  [mw, amp].forEach((g) => g.children.forEach((c) => { if (c.userData.led != null) leds.push(c); }));

  label('Computer', v(-1.2, 2.76, HANG_Z + 0.3), { color: '#e6edf5', scale: 0.2, fade: [0.09, 0.125, 0.185, 0.215] });
  label('Microwave generator', v(0.75, 2.68, HANG_Z + 0.3), { color: '#e6edf5', scale: 0.2, fade: [0.09, 0.125, 0.185, 0.215] });
  label('Amplifier', v(2.3, 2.68, HANG_Z + 0.3), { color: '#e6edf5', scale: 0.2, fade: [0.09, 0.125, 0.185, 0.215] });
  label('Suspended from the ceiling', v(0.6, ROOM.ceil + 0.15, HANG_Z), { color: '#cfe8ff', scale: 0.22, fade: [0.09, 0.125, 0.185, 0.215] });

  // the computer screen (live): scan image building row by row, pulse sequence, stage position
  const SW = 320, SH = 200;
  const sc = document.createElement('canvas'); sc.width = SW; sc.height = SH;
  const sg = sc.getContext('2d');
  const screenTex = new THREE.CanvasTexture(sc);
  screenTex.colorSpace = THREE.SRGBColorSpace; textures.push(screenTex);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 0.7), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  screen.position.set(0, 0, 0.084); comp.add(screen);
  let lastDraw = -1;
  function drawScreen(time) {
    if (time - lastDraw < 0.08) return;
    lastDraw = time;
    sg.fillStyle = '#05080d'; sg.fillRect(0, 0, SW, SH);
    sg.strokeStyle = 'rgba(120,170,230,0.45)'; sg.lineWidth = 1;
    sg.font = '9px ui-monospace, Menlo, monospace'; sg.fillStyle = '#7fb0e8';
    // header
    sg.fillRect(0, 0, SW, 14); sg.fillStyle = '#05080d'; sg.fillText('AUTO · RUNNING', 6, 10);
    // scan image panel
    sg.fillStyle = '#7fb0e8'; sg.fillText('SCAN', 8, 28);
    sg.strokeRect(8, 33, 140, 140);
    const rows = Math.floor(((time * 5) % 28));
    for (let r = 0; r < rows; r++) for (let c = 0; c < 28; c++) {
      const w = Math.cos(Math.abs(c - 14) * 0.9 - r * 0.2) * Math.exp(-Math.abs(c - 14) / 12);
      const a = 0.15 + 0.8 * Math.max(0, w);
      sg.fillStyle = c < 14 ? `rgba(255,55,95,${a})` : `rgba(100,210,255,${a})`;
      sg.fillRect(8 + c * 5, 33 + r * 5, 5, 5);
    }
    sg.fillStyle = 'rgba(48,209,88,0.9)'; sg.fillRect(8, 33 + rows * 5, 140, 1.5);
    // pulse sequence panel
    sg.fillStyle = '#7fb0e8'; sg.fillText('SEQUENCE', 164, 28);
    for (let ch = 0; ch < 3; ch++) {
      const y0 = 50 + ch * 34;
      sg.strokeStyle = ch === 0 ? '#30d158' : ch === 1 ? '#ffb340' : '#ff6a4d'; sg.lineWidth = 1.4;
      sg.beginPath();
      const off = (time * 40) % 24;
      for (let x = 0; x <= 148; x++) {
        const t = x + off;
        const on = ch === 0 ? (t % 24) < 12 : ch === 1 ? (t % 48) > 20 && (t % 48) < 38 : (t % 24) > 14 && (t % 24) < 22;
        const y = y0 + (on ? -10 : 0);
        if (x === 0) sg.moveTo(164 + x, y); else sg.lineTo(164 + x, y);
      }
      sg.stroke();
    }
    // stage position panel
    sg.fillStyle = '#7fb0e8'; sg.fillText('STAGE', 164, 158);
    sg.strokeStyle = 'rgba(120,170,230,0.45)'; sg.strokeRect(164, 164, 148, 26);
    sg.fillStyle = '#64d2ff'; sg.fillRect(164 + 6 + (Math.sin(time * 1.3) * 0.5 + 0.5) * 130, 170, 6, 14);
    screenTex.needsUpdate = true;
  }

  // ------------------------------------------------------------ enclosure: curtain + second cage
  const encW = ENC.x1 - ENC.x0, encD = ENC.z1 - ENC.z0, encH = ENC.top - ROOM.floor;
  const frameMat = track(new THREE.MeshStandardMaterial({ color: 0xc4ccd6, metalness: 0.9, roughness: 0.3, emissive: 0x1d2a3a }), 1);
  const frame = new THREE.Group(); group.add(frame);
  const bar = (a, b) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.035, d.length(), 0.035), frameMat);
    m.position.copy(a).addScaledVector(d, 0.5);
    m.quaternion.setFromUnitVectors(v(0, 1, 0), d.clone().normalize());
    frame.add(m);
  };
  // the second cage sits just outside the curtain: a metal frame with its own fine mesh
  const OC = { x0: ENC.x0 - 0.12, x1: ENC.x1 + 0.12, z0: ENC.z0 - 0.12, z1: ENC.z1 + 0.12, top: ENC.top + 0.1 };
  const cs = [[OC.x0, OC.z0], [OC.x1, OC.z0], [OC.x1, OC.z1], [OC.x0, OC.z1]];
  cs.forEach(([x, z], i) => {
    const [nx, nz] = cs[(i + 1) % 4];
    bar(v(x, ROOM.floor, z), v(x, OC.top, z));
    bar(v(x, OC.top, z), v(nx, OC.top, nz));
    bar(v(x, ROOM.floor + 0.02, z), v(nx, ROOM.floor + 0.02, nz));
  });
  const ow = OC.x1 - OC.x0, od = OC.z1 - OC.z0, oh = OC.top - ROOM.floor, ocy = (OC.top + ROOM.floor) / 2;
  const cageMesh = [
    wall(ow, oh, v((OC.x0 + OC.x1) / 2, ocy, OC.z0), 0, 0, 0.22, 0.09),
    wall(ow, oh, v((OC.x0 + OC.x1) / 2, ocy, OC.z1), 0, 0, 0.22, 0.09),
    wall(od, oh, v(OC.x0, ocy, (OC.z0 + OC.z1) / 2), Math.PI / 2, 0, 0.22, 0.09),
    wall(od, oh, v(OC.x1, ocy, (OC.z0 + OC.z1) / 2), Math.PI / 2, 0, 0.22, 0.09),
    wall(ow, od, v((OC.x0 + OC.x1) / 2, OC.top, (OC.z0 + OC.z1) / 2), 0, Math.PI / 2, 0.22, 0.09),
  ].map((m) => ({ m: m.material, base: m.material.opacity }));
  // black curtain: pleated panels hanging from the top rail
  const pleat = document.createElement('canvas'); pleat.width = 128; pleat.height = 8;
  const pg = pleat.getContext('2d');
  const grd = pg.createLinearGradient(0, 0, 128, 0);
  for (let i = 0; i <= 8; i++) grd.addColorStop(i / 8, i % 2 ? '#030304' : '#0c0d10');
  pg.fillStyle = grd; pg.fillRect(0, 0, 128, 8);
  const pleatTex = new THREE.CanvasTexture(pleat);
  pleatTex.wrapS = THREE.RepeatWrapping; pleatTex.colorSpace = THREE.SRGBColorSpace; textures.push(pleatTex);
  const curtainMat = new THREE.MeshStandardMaterial({ map: pleatTex, roughness: 1, metalness: 0, envMapIntensity: 0.15, side: THREE.DoubleSide, transparent: true, opacity: 1 });
  mats.push({ m: curtainMat, base: 1, curtain: true });
  const curtains = [];
  function curtain(w, pos, rotY) {
    const g = new THREE.Group(); g.position.copy(pos); g.rotation.y = rotY; group.add(g);
    const geo = new THREE.PlaneGeometry(w, encH); geo.translate(0, -encH / 2, 0);
    const m = new THREE.Mesh(geo, curtainMat);
    const t = pleatTex.clone(); t.needsUpdate = true; t.repeat.set(w / 0.35, 1); textures.push(t);
    m.material = curtainMat.clone(); m.material.map = t; mats.push({ m: m.material, base: 1, curtain: true });
    g.add(m); curtains.push(g);
  }
  const ex = (ENC.x0 + ENC.x1) / 2, ez = (ENC.z0 + ENC.z1) / 2;
  curtain(encW, v(ex, ENC.top - 0.03, ENC.z0), 0);
  curtain(encW, v(ex, ENC.top - 0.03, ENC.z1), 0);
  curtain(encD, v(ENC.x0, ENC.top - 0.03, ez), Math.PI / 2);
  curtain(encD, v(ENC.x1, ENC.top - 0.03, ez), Math.PI / 2);
  const lid = new THREE.Mesh(new THREE.PlaneGeometry(encW, encD), curtainMat.clone());
  lid.rotation.x = -Math.PI / 2; lid.position.set(ex, ENC.top, ez); group.add(lid);
  mats.push({ m: lid.material, base: 1, curtain: true });
  label('Black curtain + second cage', v(ex, ENC.top + 0.28, ENC.z1), { color: '#e6edf5', scale: 0.24, fade: [0.17, 0.205, 0.275, 0.31] });

  const air = stream({
    // starts no more than 0.7 out from the cage, so every particle is born inside the room (front gap is 0.78)
    color: 0xaed6ff, count: 44, rect: OC, from: 0.7, speed: 0.4, size: 0.15,
    ySpan: [ROOM.floor + 0.2, ENC.top - 0.1], faces: [[-1, 0], [0, -1], [1, 0], [0, 1]], window: [0.18, 0.205, 0.275, 0.31],
  });
  label('Airflow', v(ENC.x0 - 0.62, 0.7, ez), { color: '#aed6ff', scale: 0.22, fade: [0.18, 0.205, 0.275, 0.31] });

  // ------------------------------------------------------------ control lines
  const BUS = 1.45;                                  // just over the second cage, under the hanging instruments
  const lines = [];
  const MW = 0xffb340;                               // microwave signal path, same amber as the generator LEDs
  function control(from, to, via = BUS, lane = 0, color = 0xe8f1ff) {
    const pts = [from, v(from.x, via + lane, from.z), v(to.x, via + lane, from.z), v(to.x, via + lane, to.z), to];
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].distanceToSquared(pts[i - 1]) < 1e-6) continue;
      const t = makeTube(pts[i - 1], pts[i], color, { radius: 0.007, opacity: 0, additive: true });
      group.add(t); lines.push(t);
    }
    const path = polyline(pts.filter((q, i) => i === 0 || q.distanceToSquared(pts[i - 1]) > 1e-6));
    const sprites = [0, 1, 2].map(() => { const s = makeGlowSprite(color, { size: 0.16, opacity: 0 }); group.add(s); return s; });
    lines.push({ path, sprites });
  }
  // from the hanging computer: across to the other instruments, and down to every subsystem on the tables
  const cTop = v(-1.2, 2.15 + 0.39, HANG_Z + 0.05), cBot = v(-1.2, 2.15 - 0.6, HANG_Z + 0.05);
  control(cTop, v(0.75 - 0.3, 2.4 + 0.11, HANG_Z), 2.85, 0);        // → microwave generator
  control(cTop, v(2.3 - 0.3, 2.3 + 0.15, HANG_Z), 2.92, 0);         // → amplifier
  control(cBot, v(-0.992, 0.27, 0), BUS, 0);                        // → AOM (laser pulses)
  control(cBot, v(0.515, 0.27, 0.446), BUS, -0.03);                 // → galvo
  control(cBot, v(1.798, 0.3, -0.527), BUS, -0.06);                 // → single-photon counter
  control(cBot, v(2.95, 0.21, 0.35), BUS, -0.09);                   // → nano-positioning (AFM, far end of table two)
  // the microwave chain itself: generator → amplifier → waveguide probe
  control(v(0.75 + 0.48, 2.4, HANG_Z), v(2.3 - 0.48, 2.3, HANG_Z), 2.35, 0, MW);
  control(v(2.3 + 0.3, 2.3 - 0.15, HANG_Z), v(2.84, 0.36, 0.663), BUS + 0.06, 0, MW);
  label('Laser pulses', v(-0.992, 0.46, 0), { color: '#e8f1ff', scale: 0.19, fade: [0.3, 0.33, 0.38, 0.41] });
  label('Galvo scan', v(0.515, 0.46, 0.446), { color: '#e8f1ff', scale: 0.19, fade: [0.3, 0.33, 0.38, 0.41] });
  label('Photon counter', v(1.798, 0.46, -0.527), { color: '#e8f1ff', scale: 0.19, fade: [0.3, 0.33, 0.38, 0.41] });
  label('Nano-positioning', v(3.4, 0.95, 0.35),{ color: '#e8f1ff', scale: 0.19, fade: [0.3, 0.33, 0.38, 0.41] });
  label('Microwave chain', v(1.55, 2.62, HANG_Z + 0.3), { color: '#ffc46b', scale: 0.19, fade: [0.3, 0.33, 0.38, 0.41] });
  label('Control software', v(-1.2, 2.76, HANG_Z + 0.3), { color: '#e8f1ff', scale: 0.22, fade: [0.3, 0.33, 0.38, 0.41] });

  // ------------------------------------------------------------ per-frame
  const tmp = v(0, 0, 0);
  const winAt = (p, w) => (w ? band(p, w[0], w[1], w[2], w[3]) : 1);
  function update(time, p, roomFade, small, reduced, showLabels = true) {
    // roomFade: 1 while the room is shown, → 0 when the camera goes inside the optics
    group.visible = roomFade > 0.002;
    if (!group.visible) return;
    mats.forEach(({ m, base, curtain: isCurtain }) => {
      if (isCurtain) return;
      m.opacity = base * roomFade;
    });
    // curtain lifts to reveal the tables
    const lift = smoothstep(0.285, 0.335, p);
    curtains.forEach((g) => { g.scale.y = lerp(1, 0.02, lift); });
    mats.forEach(({ m, base, curtain: isCurtain }) => { if (isCurtain) m.opacity = base * (1 - smoothstep(0.31, 0.34, p)) * roomFade; });
    frame.visible = lift < 0.999;
    const cageA = (1 - smoothstep(0.31, 0.345, p)) * roomFade;
    frameMat.opacity = cageA;
    cageMesh.forEach(({ m, base }) => { m.opacity = base * cageA; });
    lid.visible = lift < 0.5;
    // labels and thermometer
    labels.forEach((s) => {
      s.material.opacity = winAt(p, s.userData.fade) * roomFade;
      s.visible = showLabels && s.material.opacity > 0.01;
      s.scale.copy(s.userData.base).multiplyScalar(small ? s.userData.phone : 1);
      s.position.copy(small && s.userData.phonePos ? s.userData.phonePos : s.userData.pos);
    });
    thermo.visible = winAt(p, thermo.userData.fade) * roomFade > 0.01;
    liq.scale.y = 1 + (reduced ? 0 : 0.06 * Math.sin(time * 1.7));
    liq.position.y = -0.08 + (liq.scale.y - 1) * 0.1;
    // streams
    noise.update(time, p, roomFade);
    air.update(time, p, roomFade);
    // hanging units: tiny, slow sway (calm, not shaking) + LEDs
    hangs.forEach((g, i) => { g.rotation.z = reduced ? 0 : 0.004 * Math.sin(time * 0.7 + i); });
    leds.forEach((l, i) => l.material.color.setHex(Math.floor(time * 2 + i) % 3 === 0 ? 0x1a1a1a : l.userData.color));
    drawScreen(time);
    // control lines
    const on = band(p, 0.3, 0.33, 0.385, 0.415) * roomFade;
    for (const l of lines) {
      if (l.isMesh) { l.material.opacity = 0.8 * on; continue; }
      l.sprites.forEach((s, k) => {
        const d = ((time * 0.8 + k / 3) % 1) * l.path.total;
        l.path.at(d, tmp); s.position.copy(tmp);
        s.material.opacity = on * 0.95;
      });
    }
  }

  return { group, update };
}
