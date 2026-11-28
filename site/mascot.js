/* Маскот в углу «Настроек»: клик = звук и сплющивание, частые клики = взрыв.
   После взрыва маскот не возвращается до следующего запуска лаунчера (флаг живёт в sessionStorage). */
(function () {
  'use strict';
  const KEY = 'matrixl:mascot-gone';
  const BURST_CLICKS = 12;     // столько быстрых кликов подряд взрывают маскота
  const BURST_GAP = 450;       // «быстрый» клик: не позже чем через столько мс после предыдущего
  let gone = false;
  try { gone = sessionStorage.getItem(KEY) === '1'; } catch (e) { /* без хранилища: до перезагрузки окна */ }

  let onSettings = false;
  let el = null, slot = null, watcher = null, rapid = 0, lastClick = 0, squashAnim = null, exploding = false;
  const nyaa = new Audio('mascot/nyaa.mp3'); nyaa.preload = 'auto'; nyaa.volume = 0.7;
  const boom = new Audio('mascot/explosion.mp3'); boom.preload = 'auto'; boom.volume = 0.8;
  const play = (a) => { try { const c = a.cloneNode(); c.volume = a.volume; c.play().catch(() => {}); } catch (e) { /* звук необязателен */ } };

  function make() {
    el = document.createElement('img');
    el.id = 'mascot'; el.src = 'mascot/mascot.png'; el.alt = ''; el.draggable = false;
    el.setAttribute('aria-hidden', 'true');
    el.style.cssText = 'position:absolute;right:6px;bottom:-40px;width:104px;height:104px;z-index:20;cursor:pointer;user-select:none;-webkit-user-drag:none;transform-origin:50% 100%;filter:drop-shadow(0 4px 10px rgba(0,0,0,.45))';
    el.addEventListener('pointerdown', onClick);
    slot = document.createElement('div');       // точка в самом конце страницы: маскот прокручивается вместе с настройками
    slot.style.cssText = 'position:relative;height:0;pointer-events:none';
    slot.appendChild(el); el.style.pointerEvents = 'auto';
  }

  /* страницу настроек перерисовывают целиком (смена языка, темы), поэтому следим, чтобы точка осталась последним элементом */
  function attach() {
    const c = document.getElementById('content');
    if (!c || !slot) return;
    if (slot.parentNode !== c || c.lastElementChild !== slot) c.appendChild(slot);
    fit();
  }
  /* картинка должна стоять вплотную к нижнему краю страницы: сдвигаем её на реальный нижний отступ области контента (он зависит от ширины окна) */
  function fit() {
    const main = slot && slot.closest('.content');
    if (!main || !el) return;
    const pad = parseFloat(getComputedStyle(main).paddingBottom) || 0;
    el.style.bottom = (-pad) + 'px';
  }
  window.addEventListener('resize', () => { if (onSettings) fit(); });
  function detach() { if (slot && slot.parentNode) slot.remove(); }

  function squash() {
    if (squashAnim) squashAnim.cancel();
    squashAnim = el.animate([
      { transform: 'scale(1,1)' },
      { transform: 'scale(1.16,0.7)', offset: 0.3 },
      { transform: 'scale(0.95,1.07)', offset: 0.65 },
      { transform: 'scale(1,1)' }
    ], { duration: 320, easing: 'ease-out' });
  }

  function onClick(ev) {
    if (exploding || ev.button > 0) return;
    ev.preventDefault();
    const now = performance.now();
    rapid = now - lastClick < BURST_GAP ? rapid + 1 : 1;
    lastClick = now;
    if (rapid >= BURST_CLICKS) return explode();
    play(nyaa);
    squash();
  }

  function explode() {
    exploding = true;
    play(boom);
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    // взрыв: анимированная картинка на месте маскота (адрес с меткой, чтобы gif каждый раз шёл с первого кадра)
    const fx = document.createElement('img');
    const size = 240;
    fx.src = 'mascot/explosion.gif?t=' + Date.now(); fx.alt = ''; fx.draggable = false;
    fx.style.cssText = `position:fixed;left:${cx - size / 2}px;top:${cy - size / 2}px;width:${size}px;height:${size}px;pointer-events:none;z-index:30;image-rendering:pixelated`;
    document.body.appendChild(fx);
    // в gif огненный шар виден первые 7 кадров (0,7 с): он сразу на полную и гаснет, дальше кадры «отрастают» заново, их не показываем
    const FIRE = 700;
    fx.animate([{ opacity: 1, offset: 0 }, { opacity: 1, offset: .8 }, { opacity: 0 }], { duration: FIRE, fill: 'forwards' });
    setTimeout(() => fx.remove(), FIRE + 30);
    // маскот просто исчезает в огне взрыва (огненный шар полностью закрывает его с первого кадра)
    if (squashAnim) squashAnim.cancel();
    el.style.pointerEvents = 'none';
    const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: 'ease-out', fill: 'forwards' });
    fade.onfinish = () => { el.remove(); el = null; if (slot) slot.remove(); slot = null; if (watcher) watcher.disconnect(); watcher = null; onSettings = false; };
    gone = true;
    try { sessionStorage.setItem(KEY, '1'); } catch (e) { /* хватит и переменной */ }
  }

  /* вызывается при смене страницы: маскот виден только в настройках */
  function sync(page) {
    if (gone) return;
    if (!el) make();
    if (!el || exploding) return;
    onSettings = page === 'settings';
    if (onSettings) {
      attach();
      if (!watcher) {
        const c = document.getElementById('content');
        if (c) { watcher = new MutationObserver(() => { if (onSettings) attach(); }); watcher.observe(c, { childList: true }); }
      }
    } else detach();

  }
  window.Mascot = { sync };
})();
