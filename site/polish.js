/* ============================================================
   MatrixL 1.3.5: редизайн, часть 2.
   Только добавляет классы и один декоративный слой. Логику
   лаунчера не трогает; если что-то не нашлось, тихо пропускает.
   ============================================================ */
(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);

  /* 1. зерно поверх окна (картинка задаётся в polish.css) */
  function initGrain() {
    if (!$('.pl-grain')) {
      const g = document.createElement('div');
      g.className = 'pl-grain';
      g.setAttribute('aria-hidden', 'true');
      document.body.appendChild(g);
    }
  }

  /* 2. состояние кнопки «Играть» -> классы на сцене: is-starting / is-running.
        Смотрим только на текст кнопки, поэтому работает с любым языком интерфейса. */
  let rafSync = 0;
  function sync() {
    rafSync = 0;
    const stage = $('.lc-stage'), btn = $('.lc-play');
    if (!stage || !btn) return;
    const dis = btn.disabled;
    const txt = (btn.textContent || '').trim();
    const starting = dis && /…|\.\.\./.test(txt);
    const running = dis && !starting && stage.dataset.plTxt !== undefined && txt !== stage.dataset.plIdle;
    if (!dis) stage.dataset.plIdle = txt;
    stage.dataset.plTxt = txt;
    stage.classList.toggle('is-starting', starting);
    stage.classList.toggle('is-running', running);
  }
  function watchPlay() {
    const content = $('#content');
    if (!content) return;
    new MutationObserver(() => { if (!rafSync) rafSync = requestAnimationFrame(sync); })
      .observe(content, { childList: true, subtree: true, characterData: true });
    sync();
  }

  /* 3. тень у верхней панели, когда страница прокручена */
  function watchScroll() {
    const bar = $('.topbar');
    if (!bar) return;
    let on = false;
    document.addEventListener('scroll', e => {
      const t = e.target === document ? document.scrollingElement : e.target;
      if (!(t instanceof Element) || t.closest('dialog')) return;
      const now = t.scrollTop > 6;
      if (now !== on) { on = now; bar.classList.toggle('is-scrolled', on); }
    }, { capture: true, passive: true });
  }

  function boot() { initGrain(); watchPlay(); watchScroll(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
