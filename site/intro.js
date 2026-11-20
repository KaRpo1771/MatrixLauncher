/* ============================================================
   MatrixL, интро при запуске (около 2,7 секунды): стрела пробивает слово «MatrixL», слово
   рассыпается на квадраты, и они разлетаются по всему экрану. Затем квадраты собираются в мозаику
   на весь экран и, рассыпаясь от центра к краям, раскрывают главное меню. Рисуется на canvas.
   Пропускается кликом или любой клавишей, отключается в «Настройках» (ключ modmatrix:intro).
   При «уменьшении движения» в системе слово просто показывается на долю секунды.
   ============================================================ */
(function () {
  'use strict';
  const root = document.getElementById('intro');
  if (!root) return;
  if (!document.documentElement.classList.contains('intro-on')) { root.remove(); return; }
  const cv = document.getElementById('introCv');
  const ctx = cv.getContext('2d');
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cs = getComputedStyle(document.documentElement);
  const COL = { text: cs.getPropertyValue('--text').trim() || '#f3ece0', a: cs.getPropertyValue('--accent').trim() || '#f5a742' };

  let done = false, raf = 0;
  const finish = () => {
    if (done) return; done = true; cancelAnimationFrame(raf);
    document.removeEventListener('keydown', finish, true);
    root.removeEventListener('pointerdown', finish);
    root.classList.add('intro-out');
    setTimeout(() => { root.remove(); document.documentElement.classList.remove('intro-on'); }, 260);
    setTimeout(() => document.documentElement.classList.remove('intro-reveal'), 900);
  };
  root.addEventListener('pointerdown', finish);
  document.addEventListener('keydown', finish, true);
  const safety = setTimeout(finish, 4500);   // на случай, если анимация не запустилась

  /* мс от начала: стрела, разлёт квадратов, сборка мозаики, раскрытие меню */
  const TIMING = { arrowAt: 120, arrowMs: 430, flyMin: 700, flyMax: 900, buildAt: 1100, buildJit: 200, buildMs: 500, revealAt: 1850, revealMs: 350, revealSpread: 420, end: 2750 };
  const ease = k => 1 - Math.pow(1 - k, 3);                                  // замедление к концу
  const easeIO = k => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;   // плавный старт и финиш
  const clamp01 = k => Math.max(0, Math.min(1, k));

  async function run() {
    try { await Promise.race([document.fonts.load('700 100px "Space Grotesk"'), new Promise(r => setTimeout(r, 180))]); } catch (e) { /* шрифт по умолчанию */ }
    if (done) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = root.clientWidth, H = root.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);

    /* слово: «Matrix» цветом текста и «L» цветом темы */
    const fs = Math.max(48, Math.min(124, W * 0.12));
    const font = `700 ${fs}px "Space Grotesk","IBM Plex Sans",sans-serif`;
    ctx.font = font; ctx.textBaseline = 'middle';
    const wA = ctx.measureText('Matrix').width, wB = ctx.measureText('L').width, ww = wA + wB;
    const x0 = (W - ww) / 2, cy = H / 2;
    const drawWord = c => { c.font = font; c.textBaseline = 'middle'; c.fillStyle = COL.text; c.fillText('Matrix', 0, 0); c.fillStyle = COL.a; c.fillText('L', wA, 0); };

    if (reduce) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.translate(x0, cy); drawWord(ctx);
      setTimeout(finish, 700); return;
    }

    /* цвета темы как rgb: фон и акцент (из них красится мозаика) */
    const toRgb = css => {
      const c = document.createElement('canvas').getContext('2d'); c.fillStyle = '#000'; c.fillStyle = css;
      const v = String(c.fillStyle); let m;
      if ((m = /^#([0-9a-f]{6})$/i.exec(v))) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
      if ((m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(v))) return [+m[1], +m[2], +m[3]];
      return [15, 13, 11];
    };
    const BG = toRgb(cs.getPropertyValue('--bg-0').trim() || '#0f0d0b'), AC = toRgb(COL.a);
    const rnd = (a, b) => a + Math.random() * (b - a);
    const lerp = (a, b, k) => a + (b - a) * k;

    /* слово → частицы: берём пиксели с шагом step, у каждой цвет её пикселя */
    const pad = 6, ow = Math.ceil(ww) + pad * 2, oh = Math.ceil(fs * 1.4);
    const off = document.createElement('canvas'); off.width = ow; off.height = oh;
    const oc = off.getContext('2d', { willReadFrequently: true });
    oc.translate(pad, oh / 2); drawWord(oc);
    const img = oc.getImageData(0, 0, ow, oh).data;
    const step = Math.max(3, Math.round(fs / 26)), size = step - 1;
    let parts = [];
    for (let y = 0; y < oh; y += step) for (let x = 0; x < ow; x += step) {
      const i = (y * ow + x) * 4;
      if (img[i + 3] < 140) continue;
      parts.push({ x: x0 - pad + x, y: cy - oh / 2 + y, r: img[i], g: img[i + 1], b: img[i + 2] });
    }

    /* мозаика на весь экран: сетка клеток, у каждой клетки свой квадрат */
    const cell = Math.max(34, Math.min(64, Math.round(W / 26)));
    const cols = Math.ceil(W / cell), rows = Math.ceil(H / cell), N = cols * rows;
    const base = parts.slice();
    while (parts.length < N) { const o = base[(Math.random() * base.length) | 0]; parts.push({ x: o.x, y: o.y, r: o.r, g: o.g, b: o.b }); }   // не хватает квадратов, добавляем копии
    for (let i = parts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [parts[i], parts[j]] = [parts[j], parts[i]]; }
    const maxD = Math.hypot(W / 2, H / 2);
    parts.forEach((q, i) => {
      const c = i < N ? i : (Math.random() * N) | 0;
      q.cx = ((c % cols) + .5) * cell; q.cy = (((c / cols) | 0) + .5) * cell;
      q.tx = rnd(W * .02, W * .98); q.ty = rnd(H * .03, H * .97);      // куда разлетится по экрану
      q.s = size * rnd(.9, 1.7); q.rot = rnd(0, 6.28); q.rv = rnd(-5, 5);
      const m = rnd(0, .1);                                              // цвет клетки: фон с лёгкой примесью акцента
      q.tr = lerp(BG[0], AC[0], m) + rnd(-3, 9); q.tg = lerp(BG[1], AC[1], m) + rnd(-3, 9); q.tb = lerp(BG[2], AC[2], m) + rnd(-3, 9);
      q.rd = TIMING.revealAt + Math.hypot(q.cx - W / 2, q.cy - H / 2) / maxD * TIMING.revealSpread + rnd(0, 90);   // раскрываются от центра к краям
      q.dir = Math.random() < .5 ? -1 : 1; q.t0 = -1;
    });
    const sparks = [];
    const ay = cy - fs * 0.04;   // линия полёта стрелы
    const startX = -260, endX = W + 260;
    let revealed = false;
    let ring = null;   // ударная волна: возникает, когда стрела проходит середину слова
    const VER = ((document.getElementById('tbVer') || {}).textContent || '').trim();

    const t00 = performance.now();
    const frame = now => {
      if (done) return;
      const t = now - t00;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      /* положение острия: разгоняется к концу */
      const p = Math.min(1, Math.max(0, (t - TIMING.arrowAt) / TIMING.arrowMs));
      const tipX = startX + Math.pow(p, 1.5) * (endX - startX);
      const arrowOn = t >= TIMING.arrowAt && p < 1;
      if (!ring && arrowOn && tipX >= W / 2) ring = { t0: t };

      /* целая часть слова (правее острия) */
      if (t < TIMING.arrowAt + TIMING.arrowMs) {
        const fade = Math.min(1, t / 110);
        ctx.save(); ctx.globalAlpha = fade;
        ctx.beginPath(); ctx.rect(Math.max(0, tipX), 0, W, H); ctx.clip();
        ctx.translate(x0, cy); drawWord(ctx);
        ctx.restore();
      }

      /* подпись: тонкая линия растёт от центра, под ней номер версии; гаснет, когда стрела проходит */
      const lineK = easeIO(clamp01((t - 40) / 420));
      if (lineK > 0 && t < TIMING.arrowAt + TIMING.arrowMs + 160) {
        const fo = 1 - clamp01((t - (TIMING.arrowAt + TIMING.arrowMs - 80)) / 240);
        const ly = cy + fs * 0.62, half = ww * 0.5 * lineK;
        const lg = ctx.createLinearGradient(W / 2 - half, 0, W / 2 + half, 0);
        lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(.5, COL.a); lg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = .8 * fo; ctx.fillStyle = lg; ctx.fillRect(W / 2 - half, ly, half * 2, 2);
        if (VER) {
          ctx.globalAlpha = .6 * fo * clamp01((t - 220) / 200); ctx.fillStyle = COL.text;
          ctx.font = `500 ${Math.max(12, fs * .13)}px "IBM Plex Sans",system-ui,sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'top';
          ctx.fillText(VER, W / 2, ly + 12);
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        }
        ctx.globalAlpha = 1;
      }
      /* вспышка и кольцо в точке, где стрела пробила слово */
      if (ring && t - ring.t0 < 560) {
        const k = (t - ring.t0) / 560, e = ease(k);
        const R = Math.max(W, H) * .34 * e;
        const fg = ctx.createRadialGradient(W / 2, cy, 0, W / 2, cy, fs * 2.2);
        fg.addColorStop(0, COL.a); fg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = Math.pow(1 - k, 2) * .35; ctx.fillStyle = fg;
        ctx.fillRect(W / 2 - fs * 2.2, cy - fs * 2.2, fs * 4.4, fs * 4.4);
        ctx.globalAlpha = (1 - k) * .75; ctx.strokeStyle = COL.a; ctx.lineWidth = 0.6 + 2.6 * (1 - k);
        ctx.beginPath(); ctx.arc(W / 2, cy, R, 0, 6.2832); ctx.stroke();
        ctx.globalAlpha = 1;
      }

      /* квадраты, которых достало острие, разлетаются по экрану */
      if (t >= TIMING.arrowAt) {
        for (const q of parts) {
          if (q.t0 < 0 && q.x <= tipX) {
            q.t0 = t; q.fly = rnd(TIMING.flyMin, TIMING.flyMax);
            q.ta = TIMING.buildAt + rnd(0, TIMING.buildJit);              // когда начнёт собираться в мозаику
            const e = ease(clamp01((q.ta - t) / q.fly));                  // где будет к началу сборки
            q.mx = lerp(q.x, q.tx, e); q.my = lerp(q.y, q.ty, e);
            q.ra = (q.rot + q.rv * (q.ta - t) / 1000) % 6.2832;
            if (Math.random() < 0.08) sparks.push({ x: q.x, y: q.y, vx: rnd(150, 700), vy: rnd(-380, 380), t0: t, life: rnd(260, 480) });
          }
        }
      }
      if (!revealed && t >= TIMING.revealAt) {   // мозаика готова: фон убираем, интерфейс проявляется под квадратами
        revealed = true;
        root.classList.add('intro-clear');
        document.documentElement.classList.add('intro-reveal');
      }
      for (const q of parts) {
        if (q.t0 < 0) continue;
        let x, y, a, sz, r, g, b;
        if (t < q.ta) {                       // разлёт
          const e = ease(clamp01((t - q.t0) / q.fly));
          x = lerp(q.x, q.tx, e); y = lerp(q.y, q.ty, e);
          a = q.rot + q.rv * (t - q.t0) / 1000; sz = q.s; r = q.r; g = q.g; b = q.b;
        } else {                              // сборка в клетку
          const e = easeIO(clamp01((t - q.ta) / TIMING.buildMs));
          x = lerp(q.mx, q.cx, e); y = lerp(q.my, q.cy, e);
          a = q.ra * (1 - e); sz = lerp(q.s, cell + 1.5, e);
          r = lerp(q.r, q.tr, e); g = lerp(q.g, q.tg, e); b = lerp(q.b, q.tb, e);
          if (t >= q.rd) {                    // раскрытие: клетка сжимается и крутится
            const k = clamp01((t - q.rd) / TIMING.revealMs);
            if (k >= 1) continue;
            sz *= 1 - k * k; a += q.dir * k * 1.3;
            const wv = Math.sin(k * Math.PI) * .38;   // тёплая волна: клетки на миг теплеют, пока сжимаются
            r = lerp(r, AC[0], wv); g = lerp(g, AC[1], wv); b = lerp(b, AC[2], wv);
          }
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        const c = Math.cos(a) * dpr, sn = Math.sin(a) * dpr;
        ctx.setTransform(c, sn, -sn, c, x * dpr, y * dpr);
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const sp of sparks) {
        const age = t - sp.t0; if (age >= sp.life) continue;
        const k = age / sp.life, s = age / 1000;
        ctx.globalAlpha = 1 - k; ctx.fillStyle = COL.a;
        ctx.fillRect(sp.x + sp.vx * s, sp.y + sp.vy * s + 300 * s * s, 2.4, 2.4);
      }
      ctx.globalAlpha = 1;

      /* тонкий индикатор по нижнему краю, исчезает при раскрытии меню */
      const pg = clamp01(t / TIMING.revealAt), pa = 1 - clamp01((t - TIMING.revealAt) / 300);
      if (pa > 0) { ctx.globalAlpha = .55 * pa; ctx.fillStyle = COL.a; ctx.fillRect(0, H - 2, W * easeIO(pg), 2); ctx.globalAlpha = 1; }

      /* стрела: светящийся след, древко, наконечник и оперение */
      if (arrowOn) {
        const len = 150, tail = tipX - len;
        const g = ctx.createLinearGradient(tail - 130, 0, tipX, 0);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, COL.a);
        ctx.globalAlpha = .55; ctx.fillStyle = g; ctx.fillRect(tail - 130, ay - 1.5, len + 130, 3);
        ctx.globalAlpha = 1;
        ctx.shadowColor = COL.a; ctx.shadowBlur = 16;
        ctx.fillStyle = COL.text; ctx.fillRect(tail, ay - 1.6, len - 12, 3.2);
        ctx.fillStyle = COL.a;
        ctx.beginPath(); ctx.moveTo(tipX + 6, ay); ctx.lineTo(tipX - 16, ay - 8); ctx.lineTo(tipX - 11, ay); ctx.lineTo(tipX - 16, ay + 8); ctx.closePath(); ctx.fill();
        for (const d of [-1, 1]) {   // оперение
          ctx.beginPath(); ctx.moveTo(tail + 2, ay); ctx.lineTo(tail - 12, ay + d * 9); ctx.lineTo(tail + 10, ay + d * 9); ctx.lineTo(tail + 22, ay); ctx.closePath(); ctx.fill();
        }
        ctx.shadowBlur = 0;
      }

      if (t >= TIMING.end) { clearTimeout(safety); finish(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }
  run();
})();
