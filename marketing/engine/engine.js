// Mottle film engine — deterministic, frame-accurate HTML animation.
// A film calls Film({...}) and describes every frame as a pure function of time.
// render.mjs drives FILM.render(t) frame by frame and records the page.
(() => {
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const range = (t, a, b) => clamp((t - a) / (b - a));

  const ease = {
    linear: p => p,
    inOut: p => p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2,
    out: p => 1 - Math.pow(1 - p, 3),
    in: p => p * p * p,
    outExpo: p => p === 1 ? 1 : 1 - Math.pow(2, -10 * p),
    inExpo: p => p === 0 ? 0 : Math.pow(2, 10 * p - 10),
    inOutExpo: p => p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2,
    outQuint: p => 1 - Math.pow(1 - p, 5),
    inOutQuint: p => p < 0.5 ? 16 * p ** 5 : 1 - Math.pow(-2 * p + 2, 5) / 2,
    outBack: p => { const c = 1.4; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); },
    // Apple-style apple-ish spring (critically under-damped), p in 0..1 of a ~1s window
    spring: (p, bounce = 0.18) => {
      if (p <= 0) return 0; if (p >= 1) return 1;
      const zeta = 1 - bounce, w = 9;
      const wd = w * Math.sqrt(Math.max(1e-4, 1 - zeta * zeta));
      return 1 - Math.exp(-zeta * w * p) * (Math.cos(wd * p) + (zeta * w / wd) * Math.sin(wd * p));
    },
  };

  // Tween between t0..t1 from a→b with easing.
  const tw = (t, t0, t1, a, b, e = ease.inOut) => lerp(a, b, (typeof e === 'function' ? e : ease[e])(range(t, t0, t1)));
  // Keyframes: [[time, value, easeIntoThisKey?], ...]
  const kf = (t, keys) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1, e] = keys[i];
      const [t0, v0] = keys[i - 1];
      if (t <= t1) return lerp(v0, v1, (typeof e === 'function' ? e : ease[e || 'inOut'])(range(t, t0, t1)));
    }
    return keys[keys.length - 1][1];
  };
  // 0→1 over [a, a+d] then 1→0 over [b-d2, b]
  const window_ = (t, a, b, inD = 0.6, outD = 0.5, eIn = ease.outQuint, eOut = ease.in) =>
    t < a || t > b ? 0 : Math.min(eIn(range(t, a, a + inD)), 1 - eOut(range(t, b - outD, b)));

  const css = (el, s) => {
    if (!el) return;
    if (s.o !== undefined) el.style.opacity = clamp(s.o).toFixed(4);
    const tf = [];
    if (s.x !== undefined || s.y !== undefined || s.z !== undefined) tf.push(`translate3d(${(s.x || 0).toFixed(2)}px,${(s.y || 0).toFixed(2)}px,${(s.z || 0).toFixed(2)}px)`);
    if (s.rx) tf.push(`rotateX(${s.rx.toFixed(3)}deg)`);
    if (s.ry) tf.push(`rotateY(${s.ry.toFixed(3)}deg)`);
    if (s.r) tf.push(`rotate(${s.r.toFixed(3)}deg)`);
    if (s.s !== undefined) tf.push(`scale(${s.s.toFixed(4)})`);
    if (tf.length) el.style.transform = tf.join(' ');
    if (s.blur !== undefined) el.style.filter = s.blur > 0.05 ? `blur(${s.blur.toFixed(2)}px)` : 'none';
    if (s.clip !== undefined) el.style.clipPath = s.clip;
    if (s.vis !== undefined) el.style.visibility = s.vis ? 'visible' : 'hidden';
    if (s.vars) for (const k in s.vars) el.style.setProperty(k, s.vars[k]);
  };
  const $ = (q, root = document) => root.querySelector(q);
  const $$ = (q, root = document) => [...root.querySelectorAll(q)];

  // Image sequence bound to an <img>. Footage lives in ../.cache/footage/<name>/0001.jpg
  const seqs = [];
  class Seq {
    constructor(img, name, count, fps = 30) { Object.assign(this, { img, name, count, fps, cur: -1 }); seqs.push(this); }
    frame(i) { return `../.cache/footage/${this.name}/${String(i).padStart(4, '0')}.jpg`; }
    // local time in seconds; holds first/last frame outside range. rate < 1 slows playback.
    at(local, rate = 1) {
      const i = clamp(Math.floor(local * this.fps * rate) + 1, 1, this.count);
      if (i === this.cur) return null;
      this.cur = i; this.img.src = this.frame(i);
      return this.img.decode().catch(() => {});
    }
  }

  // Split text into word spans for kinetic type. Each word gets --i.
  // Styling classes on wrappers (gold, grad, dim) move onto each word so gradients survive transforms.
  const words = el => {
    const out = [];
    const walk = (node, cls) => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const w = document.createElement('span'); w.className = 'w';
            const s = document.createElement('span'); s.textContent = part; if (cls) s.className = cls;
            w.appendChild(s); frag.appendChild(w); out.push(s);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') {
          const c = [cls, n.className].filter(Boolean).join(' ');
          walk(n, c);
          n.replaceWith(...n.childNodes);
        }
      });
    };
    const own = ['grad', 'gold', 'dim'].filter(c => el.classList.contains(c));
    el.classList.remove(...own);
    walk(el, own.join(' '));
    return out;
  };

  // Count-up number formatting
  const money = v => '$' + Math.round(v).toLocaleString('en-US');

  function Film(def) {
    const film = {
      fps: 60, width: 1920, height: 1080, cues: [], music: 'launch', ...def,
      async ready() {
        await document.fonts.ready;
        const imgs = $$('img');
        await Promise.all(imgs.map(i => i.complete ? i.decode().catch(() => {}) : new Promise(r => { i.onload = i.onerror = r; })));
        await film.render(0);
        return true;
      },
      async render(t) {
        const pending = [];
        const p = def.frame(t, pending);
        if (p && p.then) pending.push(p);
        await Promise.all(pending.filter(Boolean));
      },
    };
    window.FILM = film;
    return film;
  }

  window.M = { clamp, lerp, range, ease, tw, kf, win: window_, css, $, $$, Seq, words, money, Film };
})();
