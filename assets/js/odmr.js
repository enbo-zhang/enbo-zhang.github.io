// odmr.js — playground ODMR plot: red-glow brightness vs microwave frequency for the NV centre.
// Two lines at f± = D ± γB. A σ+ field can only drive |0⟩→|+1⟩ (upper dip), σ− only |0⟩→|−1⟩ (lower dip).
// Driven by the handedness segmented control (via the 'pg:param' event), the bias-field and MW-frequency range inputs.
// The MW marker is the 3D view's drive frequency; the NV dims when it sits on the line its handedness can drive.

const D_GHZ = 2.87;          // zero-field splitting
const GAMMA = 0.028;         // GHz per mT
const HWHM = 0.03;           // GHz (drawn a little broad so the dips read at this scale)
const CONTRAST = 0.12;
const F_MIN = 2.0, F_MAX = 3.75;
const Y_MIN = 0.85, Y_MAX = 1.04;
const COL = { plus: '#ff375f', minus: '#64d2ff', off: '#8e8e93', axis: '#86868b', grid: 'rgba(255,255,255,0.07)', ghost: 'rgba(255,255,255,0.22)', text: '#a1a1a6' };
const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const lorentz = (df) => 1 / (1 + (df / HWHM) ** 2);
const fmt = (x) => x.toFixed(2);

export function initOdmr() {
  const fig = document.getElementById('pg-odmr');
  if (!fig) return;
  const canvas = fig.querySelector('canvas');
  const caption = fig.querySelector('.odmr__caption');
  const group = document.querySelector(fig.dataset.driveGroup);
  const input = document.querySelector(fig.dataset.biasInput);
  const mwInput = document.querySelector(fig.dataset.mwInput);
  const stageCap = document.querySelector(fig.dataset.stageCaption);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  const checked = group?.querySelector('[role="radio"][aria-checked="true"]');
  let drive = checked?.dataset.value || 'plus';
  let bias = input ? +input.value : 10;
  let mw = mwInput ? +mwInput.value : D_GHZ + GAMMA * bias;
  // drawn (smoothed) state
  const cur = { b: bias, f: mw, ap: drive === 'plus' ? 1 : 0, am: drive === 'minus' ? 1 : 0 };
  let raf = 0;

  function target() { return { b: bias, f: mw, ap: drive === 'plus' ? 1 : 0, am: drive === 'minus' ? 1 : 0 }; }

  // what the NV does at the current MW frequency (same Lorentzian as the plot)
  function stageText() {
    const fp = D_GHZ + GAMMA * bias, fm = D_GHZ - GAMMA * bias;
    const onP = lorentz(mw - fp) > 0.5, onM = lorentz(mw - fm) > 0.5;
    if (drive === 'off') return 'No drive. The NV glows at full brightness.';
    if (drive === 'plus') {
      if (onP) return 'σ+ matches the |0⟩ → |+1⟩ line. The NV dims.';
      if (onM) return 'σ+ can\'t drive the |0⟩ → |−1⟩ line. The NV stays bright.';
    } else {
      if (onM) return 'σ− matches the |0⟩ → |−1⟩ line. The NV dims.';
      if (onP) return 'σ− can\'t drive the |0⟩ → |+1⟩ line. The NV stays bright.';
    }
    return 'The microwave is off resonance. The NV stays bright.';
  }

  function updateCaption() {
    const fp = D_GHZ + GAMMA * bias, fm = D_GHZ - GAMMA * bias;
    let t;
    if (drive === 'off') t = 'No microwaves, no dips: the glow is flat across the sweep.';
    else if (bias < 1) t = `At B ≈ 0 both lines sit at ${fmt(D_GHZ)} GHz. Raise B to pull them apart.`;
    else if (drive === 'plus') t = `Sweep: σ+ dips only at |0⟩→|+1⟩, ${fmt(fp)} GHz. Nothing at |0⟩→|−1⟩, ${fmt(fm)} GHz.`;
    else t = `Sweep: σ− dips only at |0⟩→|−1⟩, ${fmt(fm)} GHz. Nothing at |0⟩→|+1⟩, ${fmt(fp)} GHz.`;
    if (caption) caption.textContent = t;
    if (stageCap) stageCap.textContent = stageText();
  }

  function draw() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const L = 46, R = 14, T = 22, B = 38;
    const pw = w - L - R, ph = h - T - B;
    const X = (f) => L + (f - F_MIN) / (F_MAX - F_MIN) * pw;
    const Y = (v) => T + (Y_MAX - v) / (Y_MAX - Y_MIN) * ph;
    const fp = D_GHZ + GAMMA * cur.b, fm = D_GHZ - GAMMA * cur.b;

    // grid + ticks
    ctx.font = `11px ${MONO}`;
    ctx.lineWidth = 1;
    ctx.fillStyle = COL.axis;
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let f = 2.0; f <= F_MAX + 1e-6; f += 0.5) {
      ctx.strokeStyle = COL.grid;
      ctx.beginPath(); ctx.moveTo(X(f) + 0.5, T); ctx.lineTo(X(f) + 0.5, T + ph); ctx.stroke();
      ctx.fillText(f.toFixed(1), X(f), T + ph + 6);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const v of [0.9, 1.0]) {
      ctx.strokeStyle = COL.grid;
      ctx.beginPath(); ctx.moveTo(L, Y(v) + 0.5); ctx.lineTo(L + pw, Y(v) + 0.5); ctx.stroke();
      ctx.fillText(v.toFixed(2), L - 6, Y(v));
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(L + 0.5, T + 0.5, pw - 1, ph - 1);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('MICROWAVE FREQUENCY (GHz)', L + pw / 2, h - 4);
    ctx.textAlign = 'left';
    ctx.fillText('RED GLOW (norm.)', L, T - 8);

    // ghost: both lines, as a reference for what a linearly polarised drive would show
    const curve = (ap, am) => (f) => 1 - CONTRAST * (ap * lorentz(f - fp) + am * lorentz(f - fm));
    const plot = (fn) => {
      ctx.beginPath();
      for (let i = 0; i <= pw; i++) {
        const f = F_MIN + i / pw * (F_MAX - F_MIN);
        const y = Y(fn(f));
        if (i === 0) ctx.moveTo(L + i, y); else ctx.lineTo(L + i, y);
      }
      ctx.stroke();
    };
    ctx.save();
    ctx.beginPath(); ctx.rect(L, T, pw, ph); ctx.clip();
    ctx.setLineDash([3, 4]); ctx.strokeStyle = COL.ghost; ctx.lineWidth = 1;
    plot(curve(1, 1));
    ctx.setLineDash([]);

    // MW marker: the 3D view's drive frequency; a dot shows the glow it produces
    const mwA = Math.max(cur.ap, cur.am);
    if (mwA > 0.02) {
      const xm = X(cur.f);
      ctx.globalAlpha = 0.35 + 0.4 * mwA; ctx.setLineDash([2, 3]); ctx.strokeStyle = COL.text; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xm + 0.5, T); ctx.lineTo(xm + 0.5, T + ph); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = mwA;
      ctx.fillStyle = COL.text; ctx.textAlign = xm > L + pw - 20 ? 'right' : xm < L + 20 ? 'left' : 'center'; ctx.textBaseline = 'top';
      ctx.fillText('MW', xm, T + 4);
      ctx.globalAlpha = 1;
    }

    const col = cur.ap >= cur.am ? (cur.ap > 0.02 ? COL.plus : COL.off) : COL.minus;
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.shadowColor = col; ctx.shadowBlur = 8;
    plot(curve(cur.ap, cur.am));
    if (mwA > 0.02) {
      const v = curve(cur.ap, cur.am)(cur.f);
      ctx.shadowBlur = 0; ctx.globalAlpha = mwA; ctx.fillStyle = '#f5f5f7';
      ctx.beginPath(); ctx.arc(X(cur.f), Y(v), 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // line labels under each dip
    ctx.font = `11px ${MONO}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    const yl = Y(1 - CONTRAST) + 6;
    if (X(fp) - X(fm) > 56) {
      ctx.fillStyle = cur.am > 0.5 ? COL.minus : COL.text; ctx.fillText('|−1⟩', X(fm), yl);
      ctx.fillStyle = cur.ap > 0.5 ? COL.plus : COL.text; ctx.fillText('|+1⟩', X(fp), yl);
    } else {
      ctx.fillStyle = COL.text; ctx.fillText('|±1⟩', (X(fp) + X(fm)) / 2, yl);
    }
  }

  function tick() {
    raf = 0;
    const t = target();
    let moving = false;
    for (const k of ['b', 'f', 'ap', 'am']) {
      const d = t[k] - cur[k];
      if (reduced.matches || Math.abs(d) < (k === 'b' ? 0.01 : k === 'f' ? 0.0005 : 0.002)) cur[k] = t[k];
      else { cur[k] += d * 0.18; moving = true; }
    }
    draw();
    if (moving) raf = requestAnimationFrame(tick);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };

  input?.addEventListener('input', () => { bias = +input.value; updateCaption(); kick(); });
  mwInput?.addEventListener('input', () => { mw = +mwInput.value; updateCaption(); kick(); });
  // put the MW exactly on one line at the current B
  const tuneTo = (line) => {
    if (!mwInput) return;
    mwInput.value = String(D_GHZ + (line === 'minus' ? -1 : 1) * GAMMA * bias);
    mwInput.dispatchEvent(new Event('input', { bubbles: true }));
  };
  // nodes on the MW slider mark the two lines at the current B (and tune to them on click)
  const nodes = mwInput ? [...mwInput.parentElement.querySelectorAll('.mw-node')] : [];
  const placeNodes = () => {
    const lo = +mwInput.min, hi = +mwInput.max;
    nodes.forEach((n) => {
      const f = D_GHZ + (n.dataset.line === 'minus' ? -1 : 1) * GAMMA * bias;
      n.style.setProperty('--f', String(Math.min(1, Math.max(0, (f - lo) / (hi - lo)))));
    });
  };
  nodes.forEach((n) => n.addEventListener('click', () => tuneTo(n.dataset.line)));
  if (nodes.length) { input?.addEventListener('input', placeNodes); placeNodes(); }
  document.addEventListener('pg:param', (e) => {
    if (e.detail?.param !== 'drive' || e.detail.target !== group?.dataset.target) return;
    drive = e.detail.value;
    if (drive === 'plus' || drive === 'minus') tuneTo(drive);   // handedness click retunes the MW to its own line
    updateCaption(); kick();
  });
  if ('ResizeObserver' in window) new ResizeObserver(() => draw()).observe(canvas);
  window.addEventListener('resize', draw, { passive: true });
  updateCaption();
  draw();
}
