/* ============================================================
   MatrixL 1.3.5: эффекты редизайна.
   Ничего не меняет в логике лаунчера: только добавляет классы и
   CSS-переменные. Если что-то не нашлось, тихо пропускает.
   «Уменьшить движение» в системе отключает частицы и анимации.
   ============================================================ */
(function () {
  'use strict';
  const reduce = matchMedia('(prefers-reduced-motion:reduce)');
  const $ = (s, r = document) => r.querySelector(s);

  /* ---------- 1. бегунок под активной вкладкой ---------- */
  function initNavInk() {
    const nav = $('#nav');
    if (!nav) return;
    const ink = document.createElement('span');
    ink.className = 'nav-ink';
    nav.appendChild(ink);
    let first = true;
    const show = on => { if (ink.classList.contains('on') !== on) ink.classList.toggle('on', on); };
    function place() {
      const a = $('.nav-item.active', nav);
      if (!a || a.hidden || !a.offsetWidth) { show(false); return; }
      if (first) { ink.style.transition = 'none'; }
      ink.style.width = a.offsetWidth + 'px';
      ink.style.transform = `translateX(${a.offsetLeft}px)`;
      show(true);
      if (first) { void ink.offsetWidth; ink.style.transition = ''; first = false; }
    }
    /* следим только за кнопками меню, сам бегунок в наблюдение не попадает (иначе бесконечный цикл) */
    const mo = new MutationObserver(list => { if (list.some(m => m.target !== ink)) place(); });
    mo.observe(nav, { attributes: true, subtree: true, attributeFilter: ['class', 'hidden'] });
    addEventListener('resize', place);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(place);
    place(); setTimeout(place, 300);
  }

  /* ---------- 2. курсор: только лёгкий параллакс сцены и баннеров ---------- */
  const PARA = '.lc-stage,.section-cover';
  let raf = 0, lastEv = null, lastPara = null;

  function frame() {
    raf = 0;
    const e = lastEv; if (!e || reduce.matches) return;
    const t = e.target instanceof Element ? e.target : null;
    const para = t && t.closest(PARA);
    if (lastPara && lastPara !== para) resetPara(lastPara);
    if (para) {
      const r = para.getBoundingClientRect();
      para.style.setProperty('--px', (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
      para.style.setProperty('--py', (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
    }
    lastPara = para;
  }
  function resetPara(el) { el.style.setProperty('--px', '0'); el.style.setProperty('--py', '0'); }
  function initPointer() {
    addEventListener('pointermove', e => { lastEv = e; if (!raf) raf = requestAnimationFrame(frame); }, { passive: true });
    document.addEventListener('pointerleave', () => { if (lastPara) { resetPara(lastPara); lastPara = null; } });
  }

  /* ---------- 3. рябь на основных кнопках ---------- */
  function initRipple() {
    document.addEventListener('pointerdown', e => {
      if (reduce.matches) return;
      const b = e.target instanceof Element && e.target.closest('.btn.primary');
      if (!b || b.disabled) return;
      const r = b.getBoundingClientRect(), d = Math.max(r.width, r.height) * 2;
      const s = document.createElement('span');
      s.className = 'rip';
      s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
      b.appendChild(s);
      s.addEventListener('animationend', () => s.remove(), { once: true });
    }, { passive: true });
  }

  /* ---------- 4. появление страницы и карточек ---------- */
  const REVEAL = '.card,.quick-card,.news-card,.srv-card,.setting-card';
  function initReveal() {
    const content = $('#content');
    if (!content) return;
    let tick = 0;
    function replay() {
      content.classList.remove('page-in'); void content.offsetWidth; content.classList.add('page-in');
    }
    new MutationObserver(list => {
      let n = 0, top = false;
      for (const m of list) {
        if (m.target === content) top = true;
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const items = node.matches(REVEAL) ? [node] : node.querySelectorAll(REVEAL);
          for (const el of items) {
            if (el.classList.contains('rv') || n > 18) continue;
            el.style.setProperty('--i', n++);
            el.classList.add('rv');
            el.addEventListener('animationend', () => el.classList.remove('rv'), { once: true });
          }
        }
      }
      if (top && !reduce.matches) { clearTimeout(tick); tick = setTimeout(replay, 0); }
    }).observe(content, { childList: true, subtree: true });
  }

  /* ---------- 5. искры над сценой на главной ---------- */
  const embers = { cv: null, ctx: null, list: [], run: false, last: 0, w: 0, h: 0, color: '245,167,66' };
  function cssAccentRGB() {
    const c = document.createElement('i');
    c.style.color = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#f5a742';
    document.body.appendChild(c);
    const m = getComputedStyle(c).color.match(/\d+(\.\d+)?/g);
    c.remove();
    return m ? m.slice(0, 3).map(n => Math.round(+n)).join(',') : embers.color;
  }
  function spawn(init) {
    const e = embers;
    return {
      x: Math.random() * e.w, y: init ? Math.random() * e.h : e.h + 10,
      r: .6 + Math.random() * 1.9, vy: 10 + Math.random() * 26, sway: 6 + Math.random() * 16,
      ph: Math.random() * 6.28, fr: .4 + Math.random() * .9, life: init ? Math.random() : 0, a: .25 + Math.random() * .55
    };
  }
  function sizeEmbers() {
    const e = embers, p = e.cv.parentElement, dpr = Math.min(devicePixelRatio || 1, 2);
    e.w = p.clientWidth; e.h = p.clientHeight;
    e.cv.width = e.w * dpr; e.cv.height = e.h * dpr;
    e.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function loop(ts) {
    const e = embers;
    if (!e.cv || !e.cv.isConnected) { e.run = false; e.cv = null; return; }
    requestAnimationFrame(loop);
    if (document.hidden || reduce.matches) { e.last = ts; return; }
    const dt = Math.min((ts - e.last) / 1000 || 0, .05); e.last = ts;
    const c = e.ctx; c.clearRect(0, 0, e.w, e.h);
    for (let i = 0; i < e.list.length; i++) {
      const p = e.list[i];
      p.y -= p.vy * dt; p.ph += p.fr * dt; p.life += dt * .08;
      const x = p.x + Math.sin(p.ph) * p.sway;
      if (p.y < -12 || p.life > 1) { e.list[i] = spawn(false); continue; }
      const fade = Math.sin(Math.min(1, p.life) * Math.PI);
      const al = p.a * (.55 + .45 * Math.sin(p.ph * 3)) * Math.max(fade, .15);
      const g = c.createRadialGradient(x, p.y, 0, x, p.y, p.r * 5);
      g.addColorStop(0, `rgba(${e.color},${al})`); g.addColorStop(1, `rgba(${e.color},0)`);
      c.fillStyle = g; c.beginPath(); c.arc(x, p.y, p.r * 5, 0, 6.283); c.fill();
      c.fillStyle = `rgba(255,236,200,${Math.min(1, al * 1.4)})`; c.fillRect(x - p.r / 2, p.y - p.r / 2, p.r, p.r);
    }
  }
  function initEmbers() {
    const cv = $('.lc-fx canvas');
    if (!cv || reduce.matches) return;
    const e = embers;
    e.cv = cv; e.ctx = cv.getContext('2d'); e.color = cssAccentRGB();
    sizeEmbers();
    const n = Math.max(18, Math.min(40, Math.round(e.w / 42)));
    e.list = Array.from({ length: n }, () => spawn(true));
    if (!e.run) { e.run = true; e.last = performance.now(); requestAnimationFrame(loop); }
  }
  function watchStage() {
    const content = $('#content');
    if (!content) return;
    new MutationObserver(() => { const cv = $('.lc-fx canvas'); if (cv && cv !== embers.cv) initEmbers(); })
      .observe(content, { childList: true });
    addEventListener('resize', () => { if (embers.cv) sizeEmbers(); });
    new MutationObserver(() => { if (embers.cv) embers.color = cssAccentRGB(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    initEmbers();
  }

  function boot() { initNavInk(); initPointer(); initRipple(); initReveal(); watchStage(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
