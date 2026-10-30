/* ============================================================
   MatrixL, общие элементы интерфейса:
   1) собственные окна подтверждения вместо системного confirm();
   2) собственный выпадающий список вместо родного окна <select>
      (у родного нельзя сменить ни вид, ни ползунок прокрутки).
   Подключается первым: window.UI.confirm(...) доступен всем скриптам.
   ============================================================ */
(function () {
  'use strict';

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- окно подтверждения ----------------
     UI.confirm({ title, text, ok, cancel, danger }) → Promise<boolean>
     Текст может содержать переносы строк; HTML экранируется. */
  let confirmQueue = Promise.resolve();
  function confirmOnce(o) {
    return new Promise(resolve => {
      const d = document.createElement('dialog');
      d.className = 'ui-confirm' + (o.danger ? ' danger' : '');
      d.setAttribute('aria-labelledby', 'uiCfT');
      const lines = String(o.text || '').split('\n').filter(l => l.trim() !== '');
      d.innerHTML = `
        <div class="uc-body">
          <div class="uc-ico" aria-hidden="true">${o.danger ? '!' : '?'}</div>
          <div class="uc-txt">
            <h3 id="uiCfT">${esc(o.title || 'Подтвердите действие')}</h3>
            ${lines.map(l => `<p>${esc(l)}</p>`).join('')}
          </div>
        </div>
        <div class="uc-foot">
          <button type="button" class="btn" data-v="0">${esc(o.cancel || 'Отмена')}</button>
          <button type="button" class="btn ${o.danger ? 'danger-fill' : 'primary'}" data-v="1">${esc(o.ok || 'Подтвердить')}</button>
        </div>`;
      document.body.appendChild(d);
      let done = false;
      const finish = v => {
        if (done) return; done = true;
        d.classList.add('closing');
        setTimeout(() => { try { d.close(); } catch (e) { /* уже закрыт */ } d.remove(); }, 140);
        resolve(v);
      };
      d.addEventListener('click', e => {
        const b = e.target.closest('button[data-v]');
        if (b) { finish(b.dataset.v === '1'); return; }
        if (e.target === d) finish(false);                       // клик по затемнению
      });
      d.addEventListener('cancel', e => { e.preventDefault(); finish(false); });   // Esc
      d.showModal();
      // опасные действия: фокус на «Отмена», чтобы случайный Enter ничего не удалил
      const first = d.querySelector(o.danger ? 'button[data-v="0"]' : 'button[data-v="1"]');
      if (first) first.focus();
    });
  }
  function confirmDialog(o) {
    const run = confirmQueue.then(() => confirmOnce(o || {}));
    confirmQueue = run.catch(() => {});
    return run;
  }

  /* ---------------- выпадающий список ----------------
     Родной <select> остаётся на месте (вид, ширина, значение, события, всё прежнее),
     но вместо системного окна по нажатию открывается наш список. */
  let pop = null;          // { sel, el, items, active, closeFns }

  function closePop(focusBack) {
    if (!pop) return;
    const p = pop; pop = null;
    p.cleanup.forEach(fn => fn());
    p.el.classList.add('out');
    setTimeout(() => p.el.remove(), 110);
    p.sel.classList.remove('ui-open');
    if (focusBack) { try { p.sel.focus({ preventScroll: true }); } catch (e) { /* без фокуса */ } }
  }

  function place(p) {
    const r = p.sel.getBoundingClientRect(), el = p.el;
    el.style.minWidth = Math.max(r.width, 120) + 'px';
    el.style.maxWidth = Math.min(Math.max(r.width, 320), window.innerWidth - 16) + 'px';
    el.style.left = '0px'; el.style.top = '0px'; el.style.maxHeight = '';
    // у родителя с transform «fixed» считается от него, а не от окна, вычисляем смещение
    const origin = el.getBoundingClientRect();
    const ox = origin.left, oy = origin.top;
    const below = window.innerHeight - r.bottom - 10, above = r.top - 10;
    const want = Math.min(el.scrollHeight + 2, 320);
    const up = below < Math.min(want, 180) && above > below;
    const maxH = Math.max(100, Math.min(320, up ? above : below));
    el.style.maxHeight = maxH + 'px';
    const h = Math.min(el.offsetHeight, maxH), w = el.offsetWidth;
    let left = Math.min(r.left, window.innerWidth - w - 8); left = Math.max(8, left);
    const top = up ? r.top - h - 4 : r.bottom + 4;
    el.style.left = (left - ox) + 'px';
    el.style.top = (top - oy) + 'px';
    el.classList.toggle('up', up);
  }

  function setActive(p, i, scroll) {
    if (!p.items.length) return;
    i = Math.max(0, Math.min(p.items.length - 1, i));
    if (p.items[i].classList.contains('dis')) {
      // пропускаем недоступные пункты
      const dir = i >= p.active ? 1 : -1;
      let k = i; while (k >= 0 && k < p.items.length && p.items[k].classList.contains('dis')) k += dir;
      if (k < 0 || k >= p.items.length) return;
      i = k;
    }
    p.items[p.active] && p.items[p.active].classList.remove('act');
    p.active = i; p.items[i].classList.add('act');
    if (scroll) p.items[i].scrollIntoView({ block: 'nearest' });
  }

  function choose(p, i) {
    const o = p.opts[i];
    if (!o || o.disabled) return;
    const sel = p.sel, changed = sel.selectedIndex !== o.index;
    closePop(true);
    if (!changed) return;
    sel.selectedIndex = o.index;
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function openPop(sel) {
    if (pop && pop.sel === sel) { closePop(true); return; }
    closePop();
    const opts = []; let html = '';
    const add = (o, grouped) => {
      if (o.hidden) return;
      const idx = opts.push({ index: o.index, disabled: o.disabled, value: o.value }) - 1;
      html += `<div class="ui-opt${o.selected ? ' sel' : ''}${o.disabled ? ' dis' : ''}${grouped ? ' grp' : ''}" role="option" aria-selected="${o.selected}" data-i="${idx}">${esc(o.textContent)}</div>`;
    };
    for (const ch of sel.children) {
      if (ch.tagName === 'OPTGROUP') { html += `<div class="ui-grp">${esc(ch.label)}</div>`; for (const o of ch.children) add(o, true); }
      else if (ch.tagName === 'OPTION') add(ch, false);
    }
    if (!opts.length) return;
    const el = document.createElement('div');
    el.className = 'ui-sel-pop'; el.setAttribute('role', 'listbox'); el.tabIndex = -1;
    el.innerHTML = html;
    (sel.closest('dialog[open]') || document.body).appendChild(el);
    const p = { sel, el, opts, items: [...el.querySelectorAll('.ui-opt')], active: 0, cleanup: [], typed: '', typedAt: 0 };
    pop = p;
    sel.classList.add('ui-open');
    place(p);
    const cur = p.items.findIndex(x => x.classList.contains('sel'));
    setActive(p, cur < 0 ? 0 : cur, true);

    el.addEventListener('mousedown', e => e.preventDefault());           // фокус остаётся на select
    el.addEventListener('click', e => { const it = e.target.closest('.ui-opt'); if (it) choose(p, +it.dataset.i); });
    el.addEventListener('mousemove', e => { const it = e.target.closest('.ui-opt'); if (it && !it.classList.contains('dis')) setActive(p, p.items.indexOf(it), false); });

    const onDown = e => { if (!el.contains(e.target) && e.target !== sel) closePop(); };
    const onKey = e => {
      if (!pop || pop !== p) return;
      const k = e.key;
      if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closePop(true); }
      else if (k === 'ArrowDown') { e.preventDefault(); setActive(p, p.active + 1, true); }
      else if (k === 'ArrowUp') { e.preventDefault(); setActive(p, p.active - 1, true); }
      else if (k === 'Home') { e.preventDefault(); setActive(p, 0, true); }
      else if (k === 'End') { e.preventDefault(); setActive(p, p.items.length - 1, true); }
      else if (k === 'PageDown') { e.preventDefault(); setActive(p, p.active + 8, true); }
      else if (k === 'PageUp') { e.preventDefault(); setActive(p, p.active - 8, true); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); choose(p, p.active); }
      else if (k === 'Tab') closePop();
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // быстрый поиск по первым буквам
        const now = Date.now(); p.typed = (now - p.typedAt > 800 ? '' : p.typed) + k.toLowerCase(); p.typedAt = now;
        const hit = p.items.findIndex(x => !x.classList.contains('dis') && x.textContent.trim().toLowerCase().startsWith(p.typed));
        if (hit >= 0) setActive(p, hit, true);
      }
    };
    const onScroll = e => { if (!el.contains(e.target)) closePop(); };
    const onResize = () => closePop();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    sel.addEventListener('blur', onResize);
    p.cleanup.push(
      () => document.removeEventListener('mousedown', onDown, true),
      () => document.removeEventListener('keydown', onKey, true),
      () => window.removeEventListener('scroll', onScroll, true),
      () => window.removeEventListener('resize', onResize),
      () => sel.removeEventListener('blur', onResize)
    );
  }

  const usable = s => s && s.tagName === 'SELECT' && !s.multiple && !(s.size > 1) && !s.disabled;

  // мышь: перехватываем до открытия системного окна
  document.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    const s = e.target.closest && e.target.closest('select');
    if (!usable(s)) return;
    e.preventDefault();
    s.focus({ preventScroll: true });
    openPop(s);
  }, true);

  // клавиатура: Пробел / Enter / Alt+↓ открывают список
  document.addEventListener('keydown', e => {
    const s = e.target;
    if (!usable(s) || pop) return;
    if (e.key === ' ' || e.key === 'Enter' || (e.altKey && e.key === 'ArrowDown') || e.key === 'F4') {
      if (e.key === 'Enter' && s.form) return;       // Enter в форме, отправка, как и раньше
      e.preventDefault(); e.stopPropagation(); openPop(s);
    }
  }, true);

  // список не должен «зависнуть», если select убрали со страницы
  new MutationObserver(() => { if (pop && !document.contains(pop.sel)) closePop(); }).observe(document.documentElement, { childList: true, subtree: true });

  window.UI = { confirm: confirmDialog, esc };
})();
