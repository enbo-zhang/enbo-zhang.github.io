// xrr.js — Scene D (HAMR page): "Counting layers with X-rays" (X-ray reflectivity of the h-BN/FePt multilayer).
// A 2D canvas scene (no WebGL objects). The first curve is a real Parratt calculation for the nominal stack,
// [h-BN 2.5 nm / FePt 6.5 nm] x 13 on Ru/Ta/Si, so its fringes are physical, but it is NOT the paper's data and the
// page says so. The second plot IS the paper's data (Fig. 4a, traced; see xrr-data.js). Geometry angles are
// exaggerated (real ones are below 2 degrees).
// Storyboard (progress p):
//   0.00–0.20  side view: an X-ray beam hits the stack at a grazing angle, reflects to a detector
//   0.20–0.40  zoom into the layers: every interface reflects a little; two reflected waves add or cancel
//   0.40–0.60  scan the angle: the calculated curve is drawn, peaks and fringes are labelled
//   0.60–0.80  the measured curves of the 4-, 7-, 10- and 13-period samples, with the paper's fringe counts
//   0.80–1.00  the stack is rebuilt period by period beside the cross-section TEM from the paper (Fig. 3a)
import { clamp, lerp, smoothstep, remap, easeInOut, damp, createLoop, observeResize, maxPixelRatio } from './common.js';
import { TT0 as M_TT0, DTT as M_DTT, SAMPLES } from './xrr-data.js';

const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const FEPT = '#8e9bb0', HBN = '#bfe9ff', XRAY = '#b69cff', TXT = '#f5f5f7', TXT2 = '#a1a1a6', TXT3 = '#86868b';
const TEM_URL = new URL('../../img/hamr/tem-13L.jpg', import.meta.url).href;
const TEM_W = 472, TEM_H = 501;
const TEM_STACK = { top: 36, bottom: 441 }; // stack extent in the TEM crop (px), found by eye

// ---------------------------------------------------------------- Parratt reflectivity
const LAMBDA = 0.15406; // Cu K-alpha, nm
const KK = (2 * Math.PI) / LAMBDA;
const N_REP = 13, D_FEPT = 6.5, D_HBN = 2.5, ROUGH = 0.35;
// [thickness nm, delta, beta] (approximate bulk values at 8.05 keV)
const L_FEPT = [D_FEPT, 3.8e-5, 4.5e-6], L_HBN = [D_HBN, 6.3e-6, 5e-8];
const LAYERS = [];
for (let i = 0; i < N_REP; i++) LAYERS.push(L_FEPT, L_HBN); // top -> bottom
LAYERS.push([8, 3.5e-5, 2.8e-6], [2, 4.4e-5, 4e-6]);      // Ru, Ta
const SUB = [0, 7.6e-6, 1.75e-7];                          // Si
const MATS = [[0, 0, 0], ...LAYERS, SUB];

const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
const cexp = (a) => { const e = Math.exp(a[0]); return [e * Math.cos(a[1]), e * Math.sin(a[1])]; };
function csqrt(a) {
  const m = Math.hypot(a[0], a[1]);
  let re = Math.sqrt((m + a[0]) / 2), im = Math.sqrt(Math.max(0, (m - a[0]) / 2));
  if (a[1] < 0) im = -im;
  return im < 0 ? [-re, -im] : [re, im];
}
function reflectivity(theta) {
  const s2 = Math.sin(theta) ** 2;
  const kz = MATS.map((m) => csqrt([s2 - 2 * m[1], 2 * m[2]])); // in units of k
  let r = [0, 0];
  for (let j = MATS.length - 2; j >= 0; j--) {
    const num = [kz[j][0] - kz[j + 1][0], kz[j][1] - kz[j + 1][1]];
    const den = [kz[j][0] + kz[j + 1][0], kz[j][1] + kz[j + 1][1]];
    const nc = cmul(kz[j], kz[j + 1]);
    const damp = cexp([-2 * KK * KK * ROUGH * ROUGH * nc[0], -2 * KK * KK * ROUGH * ROUGH * nc[1]]);
    const rj = cmul(cdiv(num, den), damp);
    const ph = cexp([-2 * KK * kz[j + 1][1] * MATS[j + 1][0], 2 * KK * kz[j + 1][0] * MATS[j + 1][0]]);
    const rp = cmul(r, ph), q = cmul(rj, rp);
    r = cdiv([rj[0] + rp[0], rj[1] + rp[1]], [1 + q[0], q[1]]);
  }
  return r[0] * r[0] + r[1] * r[1];
}

const TT0 = 0.2, TT1 = 3.6, NPT = 720, LMIN = -7, LMAX = 0.25;
const CURVE = [];
for (let i = 0; i < NPT; i++) {
  const tt = lerp(TT0, TT1, i / (NPT - 1));
  CURVE.push({ tt, l: clamp(Math.log10(Math.max(reflectivity((tt / 2) * Math.PI / 180), 1e-12)), LMIN, LMAX) });
}
// superlattice (Bragg-like) peaks: maxima that dominate +-0.35 deg; fringes: small maxima between peaks 1 and 2
const W35 = Math.round((0.35 / (TT1 - TT0)) * NPT);
const PEAKS = [];
for (let i = W35; i < NPT - W35; i++) {
  if (CURVE[i].tt < 1.1) continue;
  let top = true;
  for (let k = -W35; k <= W35; k++) if (CURVE[i + k].l > CURVE[i].l) { top = false; break; }
  if (top && CURVE[i].l > -3.5) PEAKS.push(i);
}
const FRINGES = [];
if (PEAKS.length > 1) {
  for (let i = PEAKS[0] + 2; i < PEAKS[1] - 2; i++) {
    if (CURVE[i].l > CURVE[i - 1].l && CURVE[i].l >= CURVE[i + 1].l && CURVE[i].l > CURVE[i - 2].l) FRINGES.push(i);
  }
}

// measured curves (bottom to top on the plot): colour ramp by N, the paper's fringe counts (text p. 11), and the
// clear superlattice peaks (approximate 2theta, snapped to the traced maximum; the paper calls 4L's less well-defined)
const M_LMIN = -5, M_LMAX = 6.4, M_X0 = 0.8, M_X1 = 3.5;
const M_STYLE = {
  4: { color: '#8a7cc4', fringes: 2, peaks: [] },
  7: { color: '#a08cec', fringes: 5, peaks: [2.06, 2.95] },
  10: { color: XRAY, fringes: 8, peaks: [2.09, 3.03] },
  13: { color: '#ddd3ff', fringes: 10, peaks: [1.98, 2.84] },
};
const MEASURED = SAMPLES.map((smp) => {
  const st = M_STYLE[smp.n];
  const peaks = st.peaks.map((tt) => {
    let best = -1;
    smp.l.forEach((l, i) => { if (Math.abs(M_TT0 + i * M_DTT - tt) < 0.05 && (best < 0 || l > smp.l[best])) best = i; });
    return best;
  });
  return { ...smp, ...st, peaks };
});

// ---------------------------------------------------------------- scene
export function createScene(canvas, options = {}) {
  const reducedMotion = !!options.reducedMotion;
  const ctx = canvas.getContext('2d');
  const tem = new Image();
  let temOK = false;
  tem.onload = () => { temOK = true; if (!loop.running) renderOnce(); };
  tem.src = TEM_URL;

  let W = 1, H = 1, dpr = 1, portrait = false;
  let layout = null;

  // The beat cards sit top-left (desktop) or across the top (mobile); measure them so nothing is drawn underneath.
  function measureCard() {
    const scene = canvas.closest('.scene');
    const cr = canvas.getBoundingClientRect();
    let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
    (scene ? scene.querySelectorAll('.beat') : []).forEach((el) => {
      const q = el.getBoundingClientRect();
      if (!q.width) return;
      l = Math.min(l, q.left - cr.left); t = Math.min(t, q.top - cr.top);
      r = Math.max(r, q.right - cr.left); b = Math.max(b, q.bottom - cr.top);
    });
    return Number.isFinite(l) ? { l, t, r, b } : null;
  }

  function computeLayout() {
    const fs = clamp(W / 105, 10, 13);
    const pad = Math.max(16, W * 0.02);
    portrait = W <= 734 || W / H < 0.95;
    let card = measureCard();
    let G, GC, P, C, WV, M;
    if (!portrait) {
      if (!card) card = { l: W * 0.18, t: H * 0.12, r: W * 0.52, b: H * 0.47 };
      const L = card.r + W * 0.025, R = W - pad;
      const bandTop = card.b + H * 0.04, bandBot = H * 0.95;
      G = { x: card.l, y: bandTop, w: R - card.l, h: bandBot - bandTop };        // side view: band under the card
      GC = { x: card.l, y: bandTop, w: card.r - card.l, h: bandBot - bandTop };  // small side view while scanning
      WV = { x: L, y: H * 0.1, w: R - L, h: card.b - H * 0.1 };                   // wave panel: right of the card
      P = { x: L + W * 0.03, y: H * 0.14, w: R - L - W * 0.03, h: H * 0.62 };
      C = { x: L, y: H * 0.07, w: R - L, h: H * 0.86 };
      const mTop = Math.max(H * 0.06, 72);                                         // clear the 48px site header
      M = { x: L + W * 0.03, y: mTop, w: R - L - W * 0.03, h: H * 0.96 - mTop };
    } else {
      const top = Math.max(card ? card.b + 16 : H * 0.46, H * 0.3);
      const h = H * 0.96 - top;
      G = { x: pad, y: top, w: W - 2 * pad, h };
      GC = { x: pad, y: top + h * 0.08, w: W * 0.3, h: h * 0.88 };
      WV = { x: pad, y: top, w: W - 2 * pad, h: h * 0.36 };                        // above the zoomed stack
      P = { x: W * 0.4, y: top + h * 0.1, w: W * 0.6 - pad, h: h * 0.62 };
      C = G;
      M = { x: pad + 8, y: top, w: W - 2 * pad - 8, h };
    }
    layout = { G, GC, P, C, WV, M, fs };
  }

  // ---------------------------------------------------------------- helpers
  function text(str, x, y, o = {}) {
    ctx.save();
    ctx.globalAlpha *= o.alpha ?? 1;
    ctx.font = `${o.weight || 500} ${o.size || layout.fs}px ${MONO}`;
    ctx.fillStyle = o.color || TXT2;
    ctx.textAlign = o.align || 'left';
    ctx.textBaseline = o.base || 'alphabetic';
    if (o.rot) { ctx.translate(x, y); ctx.rotate(o.rot); ctx.fillText(str, 0, 0); } else ctx.fillText(str, x, y);
    ctx.restore();
  }
  function line(x0, y0, x1, y1, color, w = 1, a = 1, dash) {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.strokeStyle = color; ctx.lineWidth = w;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }
  function beam(pts, a, t, u) {
    // glow + core + travelling dashes along a polyline (u = 1/px-scale so widths stay constant on screen)
    ctx.save();
    const base = ctx.globalAlpha * a;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = XRAY;
    ctx.globalAlpha = base * 0.18; ctx.lineWidth = 7 * u; strokePath(pts);
    ctx.globalAlpha = base * 0.9; ctx.lineWidth = 1.6 * u; strokePath(pts);
    ctx.strokeStyle = '#fff'; ctx.globalAlpha = base * 0.55; ctx.lineWidth = 1.6 * u;
    ctx.setLineDash([2 * u, 22 * u]); ctx.lineDashOffset = -t * 60 * u; strokePath(pts);
    ctx.restore();
  }
  function footNote(parts, x, y) {
    // one line if it fits, else one part per line
    const size = layout.fs - 1.5;
    ctx.font = `500 ${size}px ${MONO}`;
    const lines = ctx.measureText(parts.join(' ')).width <= W - x - 8 ? [parts.join(' ')] : parts;
    lines.forEach((str, k) => text(str, x, y + k * (layout.fs + 2), { size, color: TXT3 }));
  }
  function strokePath(pts) { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke(); }
  function rrect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------------------------------------------------------------- geometry (nominal 1000 x 640 space)
  const Y0 = 400, PP = 10, PF = PP * (D_FEPT / (D_FEPT + D_HBN)), PB = PP - PF; // nominal px per period / FePt / h-BN
  const X_L = 100, X_R = 900;
  function drawStackNominal() {
    // substrate and underlayers
    const yb = Y0 + N_REP * PP;
    ctx.fillStyle = '#17171a'; ctx.fillRect(X_L, yb + 11, X_R - X_L, 640 - yb);
    ctx.fillStyle = '#4a4a50'; ctx.fillRect(X_L, yb, X_R - X_L, 9);         // Ru
    ctx.fillStyle = '#6a6a72'; ctx.fillRect(X_L, yb + 9, X_R - X_L, 2.2);   // Ta
    for (let k = 0; k < N_REP; k++) {
      const y = Y0 + k * PP;
      ctx.fillStyle = FEPT; ctx.fillRect(X_L, y, X_R - X_L, PF);
      ctx.fillStyle = HBN; ctx.fillRect(X_L, y + PF, X_R - X_L, PB);
    }
  }

  const STACK_LABELS = [`h-BN / FePt`, `× ${N_REP}`, 'Ru / Ta', 'Si substrate'];
  function drawGeo(rect, o) {
    // o: zoom 0..1, th (visual angle, rad), t, alpha, labels (0..1), rays (0..1)
    // Unzoomed, the drawing spans nominal x -60..1050 (tube to detector) and y 150..600; the stack labels need
    // lw px to the right of the stack (x = 914), so fit both.
    ctx.save(); ctx.font = `500 ${layout.fs}px ${MONO}`;
    const lw = Math.max(...STACK_LABELS.map((sl) => ctx.measureText(sl).width)) * o.labels;
    ctx.restore();
    const f = Math.min(rect.w / 1110, (rect.w - lw) / 974, rect.h / 450);
    const cw = Math.max(1110 * f, 974 * f + lw), ox = rect.x + (rect.w - cw) / 2 + 60 * f;
    const ez = easeInOut(o.zoom);
    const zoomK = lerp(1, 3.1, ez);
    const s = f * zoomK, u = 1 / s;
    const fx = 500, fy = lerp(375, 405, ez);
    const cx = lerp(ox + 500 * f, rect.x + rect.w / 2, ez), cy = rect.y + rect.h / 2;
    ctx.save();
    ctx.globalAlpha *= o.alpha;
    ctx.beginPath(); ctx.rect(rect.x - 4, rect.y - 4, rect.w + 8, rect.h + 8); ctx.clip();
    ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-fx, -fy);
    drawStackNominal();
    // beam(s)
    const th = o.th, c = Math.cos(th), sn = Math.sin(th), L = 520;
    const rays = o.rays;
    const mainA = 1 - 0.55 * smoothstep(0.15, 0.6, o.zoom);
    beam([[500 - L * c, Y0 - L * sn], [500, Y0], [500 + L * c, Y0 - L * sn]], mainA, o.t, u);
    // extra reflections from buried interfaces
    if (rays > 0.01) {
      for (let j = 1; j <= 3; j++) {
        const z = j * PP * 1.0, tn = Math.tan(th), xe = 500 - z / tn, xo = 500 + z / tn;
        beam([[xe - L * c, Y0 - L * sn], [xe, Y0], [500, Y0 + z], [xo, Y0], [xo + L * c, Y0 - L * sn]], rays * [0.8, 0.55, 0.38][j - 1], o.t, u);
        ctx.save(); ctx.globalAlpha *= rays; ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(500, Y0 + z, 2.4 * u, 0, 7); ctx.fill(); ctx.restore();
      }
    }
    // angle arc
    const arcA = 1 - smoothstep(0.4, 0.8, o.zoom);
    ctx.save();
    ctx.globalAlpha *= arcA; ctx.strokeStyle = TXT2; ctx.lineWidth = 1 * u;
    ctx.beginPath(); ctx.arc(500, Y0, 80, -th, 0); ctx.stroke(); ctx.restore();
    // tube and detector
    const ta = 1 - smoothstep(0.1, 0.5, o.zoom);
    if (ta > 0.01) {
      ctx.save(); ctx.globalAlpha *= ta;
      const sx = 500 - L * c, sy = Y0 - L * sn, dx = 500 + L * c;
      ctx.fillStyle = '#26262a'; ctx.strokeStyle = TXT3; ctx.lineWidth = 1 * u;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(th); rrect(-52, -16, 52, 32, 6); ctx.fill(); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.translate(dx, sy); ctx.rotate(-th); rrect(0, -16, 52, 32, 6); ctx.fill(); ctx.stroke(); ctx.restore();
      ctx.restore();
    }
    ctx.restore();
    // labels in screen space (constant px size)
    const toScreen = (x, y) => [cx + (x - fx) * s, cy + (y - fy) * s];
    const la = o.labels;
    if (la > 0.01) {
      ctx.save(); ctx.globalAlpha *= o.alpha;
      const [sx0, sy0] = toScreen(500 - 520 * c, Y0 - 520 * sn), [dx0, dy0] = toScreen(500 + 520 * c, Y0 - 520 * sn);
      const ta2 = (1 - smoothstep(0.1, 0.5, o.zoom)) * la;
      text('X-RAY SOURCE', sx0 + 6, sy0 - 24, { alpha: ta2 });
      text('Cu Kα', sx0 + 6, sy0 - 10, { alpha: ta2, color: XRAY });
      text('DETECTOR', dx0 - 6, dy0 - 24, { alpha: ta2, align: 'right' });
      const [hx, hy] = toScreen(500, Y0);
      text('θ', hx + 94 * s * Math.cos(th / 2) + 6, hy - 94 * s * Math.sin(th / 2) * 0.8, { alpha: la * (1 - smoothstep(0.4, 0.8, o.zoom)), color: TXT, size: layout.fs + 3 });
      const [rx] = toScreen(X_R + 14, Y0);
      const lab = (txt, y, col) => text(txt, rx, toScreen(0, y)[1] + layout.fs * 0.35, { alpha: la * (1 - smoothstep(0.55, 0.9, o.zoom)), color: col });
      const lh = (layout.fs + 3) / s;
      lab(STACK_LABELS[0], Y0 + N_REP * PP * 0.5 - lh * 0.5, TXT);
      lab(STACK_LABELS[1], Y0 + N_REP * PP * 0.5 + lh * 0.5, TXT);
      lab(STACK_LABELS[2], Y0 + N_REP * PP + 6 + lh * 0.5, TXT2);
      lab(STACK_LABELS[3], Y0 + N_REP * PP + 6 + lh * 2.2, TXT2);
      // zoomed-in thickness tags
      const za = smoothstep(0.55, 0.9, o.zoom) * la;
      if (za > 0.01) {
        const [bx, by] = toScreen(X_R + 10, Y0 + PF * 0.5), [bx2, by2] = toScreen(X_R + 10, Y0 + PF + PB * 0.5);
        const inside = bx + 100 > rect.x + rect.w;
        const tag = (str, x, y, color) => {
          // dark backing so the tag reads on top of the light stripes
          ctx.font = `500 ${layout.fs}px ${MONO}`;
          const tw = ctx.measureText(str).width, tx = inside ? x - tw : x;
          ctx.save(); ctx.globalAlpha *= za * 0.72; ctx.fillStyle = '#000';
          rrect(tx - 5, y - layout.fs - 1, tw + 10, layout.fs + 7, 3); ctx.fill(); ctx.restore();
          text(str, x, y, { alpha: za, color, align: inside ? 'right' : 'left' });
        };
        tag('FePt 6.5 nm', Math.min(bx + 6, rect.x + rect.w - 8), by + 4, TXT);
        tag('h-BN 2.5 nm', Math.min(bx2 + 6, rect.x + rect.w - 8), by2 + 10 + layout.fs, HBN);
      }
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- wave panel (beat 2)
  function drawWaves(rect, t, a) {
    if (a < 0.01) return;
    ctx.save(); ctx.globalAlpha *= a;
    ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
    rrect(rect.x, rect.y, rect.w, rect.h, 8); ctx.fill(); ctx.stroke();
    const pad = 12, x0 = rect.x + pad, x1 = rect.x + rect.w - pad;
    text('TWO REFLECTED WAVES', x0, rect.y + pad + layout.fs * 0.8, { color: TXT2 });
    const u = 1 + 0.75 * Math.sin(t * 0.5 - 0.6);               // 1 = Bragg condition (extra path = one wavelength)
    const dphi = 2 * Math.PI * u;
    const ch = (rect.h - 2 * pad - layout.fs * 3.4) / 3;
    const yc = [rect.y + pad + layout.fs * 1.6 + ch * 0.5, rect.y + pad + layout.fs * 1.6 + ch * 1.5, rect.y + pad + layout.fs * 1.6 + ch * 2.5];
    const wave = (yy, ph, amp, col, lw) => {
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath();
      for (let i = 0; i <= 80; i++) {
        const x = lerp(x0, x1, i / 80), v = Math.sin((i / 80) * 6 * Math.PI - t * 3 + ph);
        const y = yy - v * amp; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    const amp = ch * 0.34;
    wave(yc[0], 0, amp, XRAY, 1.5);
    wave(yc[1], dphi, amp * 0.8, 'rgba(182,156,255,0.75)', 1.5);
    // sum
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const x = lerp(x0, x1, i / 80), ph = (i / 80) * 6 * Math.PI - t * 3;
      const v = (Math.sin(ph) + 0.8 * Math.sin(ph + dphi)) / 1.8;
      const y = yc[2] - v * amp * 1.15; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    const cosv = Math.cos(dphi), state = cosv > 0.8 ? 'in phase: they add' : cosv < -0.8 ? 'opposite: they cancel' : 'partly adding';
    text('top surface', x0, yc[0] - amp - 2, { size: layout.fs - 1, color: TXT3 });
    text('one period down', x0, yc[1] - amp - 2, { size: layout.fs - 1, color: TXT3 });
    text(`sum · ${state}`, x0, yc[2] - amp * 1.15 - 4, { size: layout.fs - 1, color: TXT });
    // detector brightness
    const bw = (x1 - x0) * 0.28, bx = x1 - bw, by = rect.y + pad + layout.fs * 0.2;
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(bx, by, bw, 5);
    ctx.fillStyle = XRAY; ctx.fillRect(bx, by, bw * (0.5 + 0.5 * cosv), 5);
    ctx.restore();
  }

  // ---------------------------------------------------------------- plot (beat 3)
  function plotXY(P, i) { return [P.x + ((CURVE[i].tt - TT0) / (TT1 - TT0)) * P.w, P.y + (1 - (CURVE[i].l - LMIN) / (LMAX - LMIN)) * P.h]; }
  function drawPlot(P, s, ann, t, a) {
    if (a < 0.01) return;
    ctx.save(); ctx.globalAlpha *= a;
    // axes
    line(P.x, P.y, P.x, P.y + P.h, 'rgba(255,255,255,0.35)', 1);
    line(P.x, P.y + P.h, P.x + P.w, P.y + P.h, 'rgba(255,255,255,0.35)', 1);
    for (const tt of [1, 2, 3]) {
      const x = P.x + ((tt - TT0) / (TT1 - TT0)) * P.w;
      line(x, P.y + P.h, x, P.y + P.h + 5, 'rgba(255,255,255,0.35)', 1);
      text(String(tt), x, P.y + P.h + 6 + layout.fs, { align: 'center', color: TXT3 });
    }
    text('2θ (degrees)', P.x + P.w, P.y + P.h + 8 + layout.fs * 2.2, { align: 'right', color: TXT2 });
    text('REFLECTED INTENSITY · LOG', P.x, P.y - 10, { color: TXT2 });
    // curve up to s
    const n = Math.max(1, Math.floor(s * (NPT - 1)));
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i <= n; i++) { const [x, y] = plotXY(P, i); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.lineJoin = 'round';
    ctx.strokeStyle = XRAY; ctx.globalAlpha *= 0.22; ctx.lineWidth = 5; ctx.stroke();
    ctx.globalAlpha = a; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.restore();
    // head
    if (s > 0 && s < 0.999) {
      const [hx, hy] = plotXY(P, n);
      const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 14);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(182,156,255,0.5)'); g.addColorStop(1, 'rgba(182,156,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 14, 0, 7); ctx.fill();
      text(`2θ = ${CURVE[n].tt.toFixed(2)}°`, hx + 10, hy - 12, { color: TXT, alpha: 1 - ann });
    }
    // annotations
    if (ann > 0.01 && PEAKS.length >= 2) {
      ctx.save(); ctx.globalAlpha *= ann;
      PEAKS.slice(0, 3).forEach((i, k) => {
        const [x, y] = plotXY(P, i);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.stroke();
        if (k === 0) {
          const lx = Math.min(x + 18, P.x + P.w - 4);
          text('superlattice peaks', lx, y - 14, { color: TXT, align: lx > x + 17 ? 'left' : 'right' });
          text('spacing → layer period', lx, y - 14 + layout.fs + 3, { color: TXT3, size: layout.fs - 1, align: lx > x + 17 ? 'left' : 'right' });
        }
      });
      if (FRINGES.length >= 3) {
        const a1 = FRINGES[Math.min(2, FRINGES.length - 3) + 0], a2 = FRINGES[Math.min(2, FRINGES.length - 3) + 1];
        const [x1, y1] = plotXY(P, a1), [x2, y2] = plotXY(P, a2);
        // bracket goes below the lowest point of the curve between (and just around) the two fringes
        let low = 0;
        for (let i = a1 - 4; i <= a2 + 4; i++) low = Math.max(low, plotXY(P, i)[1]);
        const by = Math.min(low + 16, P.y + P.h - layout.fs * 2.6 - 10);
        line(x1, by, x2, by, HBN, 1.4); line(x1, by - 4, x1, by + 4, HBN, 1.4); line(x2, by - 4, x2, by + 4, HBN, 1.4);
        line(x1, y1 + 4, x1, by - 5, HBN, 1, 0.45, [2, 3]); line(x2, y2 + 4, x2, by - 5, HBN, 1, 0.45, [2, 3]);
        text('fringe spacing', x2 + 4, by + layout.fs + 6, { color: HBN, align: 'right' });
        text('→ total thickness', x2 + 4, by + 2 * layout.fs + 9, { color: TXT3, align: 'right', size: layout.fs - 1 });
      }
      ctx.restore();
    }
    // honesty note
    footNote(['Calculated for the nominal multilayer (no cap).', 'Illustrative, not the measured data.'],P.x, P.y + P.h + 12 + layout.fs * 3.6);
    ctx.restore();
  }

  // ---------------------------------------------------------------- measured data (beat 4)
  function drawMeasured(rect, reveal, lab, a) {
    if (a < 0.01) return;
    ctx.save(); ctx.globalAlpha *= a;
    const fs = layout.fs;
    ctx.font = `500 ${fs - 1}px ${MONO}`;
    const lw = ctx.measureText('10 fringes').width + 14;            // curve labels sit right of the plot
    const P = { x: rect.x, y: rect.y + fs * 2, w: rect.w - lw, h: rect.h - fs * 8 - 18 };
    const X = (tt) => P.x + ((tt - M_X0) / (M_X1 - M_X0)) * P.w;
    const Y = (l) => P.y + (1 - (l - M_LMIN) / (M_LMAX - M_LMIN)) * P.h;
    const pt = (c, i) => [X(M_TT0 + i * M_DTT), Y(c.l[i])];
    // axes
    line(P.x, P.y, P.x, P.y + P.h, 'rgba(255,255,255,0.35)', 1);
    line(P.x, P.y + P.h, P.x + P.w, P.y + P.h, 'rgba(255,255,255,0.35)', 1);
    for (const tt of [1, 2, 3]) {
      line(X(tt), P.y + P.h, X(tt), P.y + P.h + 5, 'rgba(255,255,255,0.35)', 1);
      text(String(tt), X(tt), P.y + P.h + 6 + fs, { align: 'center', color: TXT3 });
    }
    text('2θ (degrees)', P.x + P.w, P.y + P.h + 8 + fs * 2.2, { align: 'right', color: TXT2 });
    text('MEASURED · LOG · CURVES OFFSET', P.x, P.y - 10, { color: TXT2 });
    // curves, drawn left to right from the thinnest stack up
    MEASURED.forEach((c, k) => {
      const s = remap(reveal, k * 0.12, 0.64 + k * 0.12);
      if (s <= 0) return;
      const n = Math.max(1, Math.floor(s * (c.l.length - 1)));
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i <= n; i++) { const [x, y] = pt(c, i); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.lineJoin = 'round'; ctx.strokeStyle = c.color;
      ctx.globalAlpha *= 0.2; ctx.lineWidth = 5; ctx.stroke();
      ctx.globalAlpha = a; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.restore();
      if (s < 0.999) {
        const [hx, hy] = pt(c, n);
        const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 12);
        g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.3, 'rgba(182,156,255,0.5)'); g.addColorStop(1, 'rgba(182,156,255,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 12, 0, 7); ctx.fill();
      }
      // label at the curve's right end: periods, and the fringe count reported in the paper
      const la = lab * smoothstep(0.9, 1, s);
      if (la > 0.01) {
        const ly = clamp(pt(c, c.l.length - 1)[1], P.y + fs, P.y + P.h - fs - 4);
        text(`N = ${c.n}`, P.x + P.w + 10, ly, { color: c.color, weight: 600, alpha: la });
        text(`${c.fringes} fringes`, P.x + P.w + 10, ly + fs + 3, { color: TXT3, size: fs - 1, alpha: la });
      }
    });
    // superlattice peaks
    if (lab > 0.01) {
      ctx.save(); ctx.globalAlpha *= lab;
      MEASURED.forEach((c) => c.peaks.forEach((i) => {
        const [x, y] = pt(c, i);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.stroke();
      }));
      const top = MEASURED[MEASURED.length - 1];
      if (top.peaks.length) {
        const [x, y] = pt(top, top.peaks[0]);
        text('superlattice peaks', x - 4, y - 14, { color: TXT });
      }
      ctx.restore();
    }
    footNote(['Measured: traced from Fig. 4(a) of the paper.', 'Fringe counts as reported there.'], P.x, P.y + P.h + 12 + fs * 3.6);
    ctx.restore();
  }

  // ---------------------------------------------------------------- final comparison (beat 4)
  function drawCompare(rect, build, imgA, tieA, t, a) {
    if (a < 0.01) return;
    ctx.save(); ctx.globalAlpha *= a;
    // captions stack in four lines when the two columns of them would collide
    ctx.font = `500 ${layout.fs - 1.5}px ${MONO}`;
    const narrow = ctx.measureText('period ≈ 9 nm: h-BN 2.5 + FePt 6.5').width + ctx.measureText('13-period sample · period ≈ 9.3 nm').width + 24 > rect.w;
    const schW = clamp(rect.w * 0.15, 44, 130), gap = clamp(rect.w * 0.12, 32, 110), foot = layout.fs * (narrow ? 6.2 : 3.4);
    const Hi = Math.min(rect.h - foot, (rect.w - schW - gap) / (TEM_W / TEM_H));
    const Wi = Hi * (TEM_W / TEM_H), k = Hi / TEM_H;
    const x0 = rect.x + (rect.w - (schW + gap + Wi)) / 2, y0 = rect.y + (rect.h - foot - Hi) / 2;
    const xs = x0, xi = x0 + schW + gap;
    // schematic stack, aligned to the stack in the TEM crop
    const yTop = y0 + TEM_STACK.top * k, yBot = y0 + TEM_STACK.bottom * k, PPx = (yBot - yTop) / N_REP;
    // underlayer
    const ub = smoothstep(0, 0.08, build);
    ctx.fillStyle = '#4a4a50'; ctx.globalAlpha = a * ub; ctx.fillRect(xs, yBot, schW, (TEM_H - TEM_STACK.bottom) * k);
    ctx.fillStyle = '#6a6a72'; ctx.fillRect(xs, yBot, schW, 3);
    text('Ru / Ta', xs + schW / 2, yBot + (TEM_H - TEM_STACK.bottom) * k * 0.55 + 4, { align: 'center', color: TXT, size: layout.fs - 1 });
    ctx.globalAlpha = a;
    let shown = 0;
    for (let i = 0; i < N_REP; i++) {          // i = 0 is the bottom period
      const b = smoothstep(0.08 + i * 0.068, 0.08 + i * 0.068 + 0.07, build);
      if (b < 0.01) continue;
      shown++;
      const yb = yBot - i * PPx, hB = PPx * (D_HBN / (D_FEPT + D_HBN)), hF = PPx - hB;
      ctx.globalAlpha = a * b;
      const dy = (1 - b) * -8;
      ctx.fillStyle = HBN; ctx.fillRect(xs, yb - hB + dy, schW, hB);
      ctx.fillStyle = FEPT; ctx.fillRect(xs, yb - PPx + dy, schW, hF);
    }
    ctx.globalAlpha = a;
    text(`N = ${shown}`, xs + schW / 2, yTop - 12, { align: 'center', color: TXT, weight: 600 });
    // image
    if (temOK) {
      ctx.save(); ctx.globalAlpha = a * imgA;
      ctx.drawImage(tem, xi, y0, Wi, Hi);
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1; ctx.strokeRect(xi + 0.5, y0 + 0.5, Wi - 1, Hi - 1);
      ctx.restore();
    }
    // tie lines: top and bottom of the stack, schematic -> TEM
    ctx.globalAlpha = a * tieA;
    for (const y of [yTop, yBot]) line(xs + schW, y, xi, y, XRAY, 1, 0.9, [4, 4]);
    // period bracket
    const bx = xs + schW + gap * 0.45;
    line(bx, yBot - PPx, bx, yBot, '#fff', 1.2); line(bx - 4, yBot - PPx, bx + 4, yBot - PPx, '#fff', 1.2); line(bx - 4, yBot, bx + 4, yBot, '#fff', 1.2);
    ctx.globalAlpha = a;
    // captions
    const cy = y0 + Hi + layout.fs * 1.5;
    text('STACK FROM XRR', xs, cy, { color: TXT2, size: layout.fs - 1 });
    text('period ≈ 9 nm: h-BN 2.5 + FePt 6.5', xs, cy + layout.fs + 4, { color: TXT3, size: layout.fs - 1.5 });
    const cy2 = narrow ? cy + 2 * (layout.fs + 4) + 4 : cy;
    text('CROSS-SECTION TEM · PAPER FIG. 3(a)', xi + Wi, cy2, { color: TXT2, size: layout.fs - 1, align: 'right' });
    text('13-period sample · period ≈ 9.3 nm', xi + Wi, cy2 + layout.fs + 4, { color: TXT3, size: layout.fs - 1.5, align: 'right' });
    ctx.restore();
  }

  // ---------------------------------------------------------------- render
  let time = 2.2, progT = 0, prog = 0;
  function renderMain(p) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { G, GC, P, C, WV, M } = layout;
    const tA = 1 - smoothstep(0.58, 0.608, p);         // geometry + calculated plot give way to the measured data
    const zoom = smoothstep(0.195, 0.242, p) * (1 - smoothstep(0.382, 0.429, p));
    const cStage = smoothstep(0.382, 0.429, p);          // geometry moves to the left column
    const s = remap(p, 0.417, 0.546);
    // geometry rect: interpolate between full and column
    const gr = { x: lerp(G.x, GC.x, cStage), y: lerp(G.y, GC.y, cStage), w: lerp(G.w, GC.w, cStage), h: lerp(G.h, GC.h, cStage) };
    const sweep = 0.36 + 0.05 * Math.sin(time * 0.6);
    const th = lerp(sweep, lerp(0.14, 0.52, s), cStage);
    drawGeo(gr, {
      zoom, th, t: time, alpha: tA,
      labels: 1 - smoothstep(0.382, 0.413, p),
      rays: smoothstep(0.234, 0.296, p) * (1 - smoothstep(0.367, 0.413, p)),
    });
    drawWaves(WV, time, smoothstep(0.265, 0.312, p) * (1 - smoothstep(0.359, 0.39, p)) * tA);
    drawPlot(P, s, smoothstep(0.53, 0.562, p), time, smoothstep(0.406, 0.437, p) * tA);
    drawMeasured(M, remap(p, 0.62, 0.73), smoothstep(0.72, 0.75, p), smoothstep(0.608, 0.635, p) * (1 - smoothstep(0.78, 0.81, p)));
    const cmpA = smoothstep(0.8, 0.85, p);
    drawCompare(C, remap(p, 0.82, 0.92), smoothstep(0.88, 0.94, p), smoothstep(0.92, 0.96, p), time, cmpA);
  }
  function render(_t, dt) {
    if (!reducedMotion) time += dt;
    prog = reducedMotion || !dt ? progT : prog + (progT - prog) * damp(6, dt);
    renderMain(prog);
  }
  const loop = createLoop(render);
  const renderOnce = () => render(0, 0);

  function resize() {
    W = canvas.clientWidth || 1; H = canvas.clientHeight || 1;
    dpr = maxPixelRatio();
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    computeLayout();
    if (!loop.running) renderOnce();
  }
  const unobserve = observeResize(canvas, resize);
  resize();
  document.fonts?.ready.then(resize); // beat cards change size once the web font is in

  return {
    setProgress(pv) { progT = clamp(pv); if (!loop.running) renderOnce(); },
    setParam() {},
    resize,
    start() { if (reducedMotion) { renderOnce(); return; } loop.start(); },
    stop() { loop.stop(); },
    dispose() { loop.stop(); unobserve(); },
  };
}
