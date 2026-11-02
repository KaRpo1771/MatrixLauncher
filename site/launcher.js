/* ============================================================
   ModMatrix, интерфейс лаунчера. В приложении (ModMatrix.exe) он
   заменяет главную страницу: фон из скриншотов игры, «Играть»
   справа снизу, «Настройки экземпляра» слева.
   Регистрации в лаунчере нет, только вход в игровой аккаунт
   (Ely.by со скинами, Microsoft или оффлайн). Мост к ядру: window.mm.
   ============================================================ */
(function () {
  'use strict';
  const mm = window.mm;
  const desktop = !!(mm && mm.invoke);

  const S = {
    mcs: [], instances: [], versions: null, settings: {}, sys: null, logs: [], ms: null,
    sel: null, shots: [], shotsLoaded: false, dlg: null, timer: null, accTab: 'ely', lo: {}, heads: {}, sk: null,
    starting: new Set()   // экземпляры, у которых игра запускается, но окно Minecraft ещё не появилось
  };
  try { S.sel = localStorage.getItem('modmatrix:sel'); } catch (e) { /* без хранилища */ }

  const LD = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
  const TYPES = { ely: 'Ely.by', microsoft: 'Microsoft', offline: 'Оффлайн аккаунт' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $id = id => document.getElementById(id);
  const onHome = () => typeof state !== 'undefined' && state.page === 'home';
  const gb = mb => (Math.round(mb / 1024 * 10) / 10).toLocaleString('ru-RU');
  const note = msg => (typeof toast === 'function' ? toast(msg) : console.log(msg));
  const ask = o => window.UI.confirm(o);                       // собственное окно подтверждения
  const CANCEL_RE = /Скачивание отменено/;
  const isCancel = ex => CANCEL_RE.test((ex && ex.message) || '');

  async function call(channel, ...args) {
    const r = await mm.invoke(channel, ...args);
    if (!r.ok) throw new Error(r.error);
    return r.data;
  }

  /* ---------------- состояние ---------------- */
  async function loadState() {
    if (!desktop) return;
    const [settings, mcs, instances, sys] = await Promise.all([
      call('settings:get').catch(() => ({})), call('mc:list').catch(() => []),
      call('inst:list').catch(() => []), call('sys:info').catch(() => null)
    ]);
    S.settings = settings; S.mcs = mcs; S.instances = instances; S.sys = sys;
  }
  async function reloadInstances() { S.instances = await call('inst:list').catch(() => S.instances); }
  async function reloadSys() { S.sys = await call('sys:info').catch(() => S.sys); }
  function cur() {
    let i = S.instances.find(x => x.id === S.sel);
    if (!i) i = S.instances[0] || null;
    S.sel = i ? i.id : null;
    return i;
  }
  /* экземпляр, в который ставятся моды: запоминается при выборе и подставляется в карточках других модов */
  function modTarget(usable) {
    let id = null;
    try { id = localStorage.getItem('modmatrix:modTarget'); } catch (e) { /* без хранилища */ }
    return usable.some(i => i.id === id) ? id : (S.sel || '');
  }
  function saveModTarget(id) { try { localStorage.setItem('modmatrix:modTarget', id || ''); } catch (e) { /* без хранилища */ } }
  function saveSel() { try { localStorage.setItem('modmatrix:sel', S.sel || ''); } catch (e) { /* без хранилища */ } }
  const selectedAcc = () => S.mcs.find(a => a.selected) || null;

  /* ---------------- аватары: голова скина ----------------
     Скин берётся в главном процессе (Mojang, Ely.by), у оффлайн-аккаунта рисуется Стив. */
  const STEVE_PAL = { H: '#4a3020', S: '#b78a68', W: '#ffffff', E: '#3d3a8a', N: '#8d5d41', M: '#6e3f2d' };
  const STEVE = ['HHHHHHHH', 'HHHHHHHH', 'HSSSSSSH', 'SWESSEWS', 'SSSSSSSS', 'SSSNNSSS', 'SSNMMNSS', 'SSSSSSSS'];
  function steveHead() {
    const c = document.createElement('canvas'); c.width = c.height = 8; c.className = 'skin-head';
    const x = c.getContext('2d');
    STEVE.forEach((row, y) => [...row].forEach((ch, i) => { x.fillStyle = STEVE_PAL[ch]; x.fillRect(i, y, 1, 1); }));
    return c;
  }
  const loadImg = src => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });
  function avatar(a, cls) {
    const letter = esc((a ? a.name : '?')[0].toUpperCase());
    return `<span class="acc-ava ${cls || ''}" ${a ? `data-head="${esc(a.id)}"` : ''}>${letter}</span>`;
  }
  async function headCanvas(skin) {
    if (!skin) return steveHead();
    const img = await loadImg(skin);
    const c = document.createElement('canvas'); c.width = c.height = 8; c.className = 'skin-head';
    const x = c.getContext('2d'); x.imageSmoothingEnabled = false;
    const k = img.width / 64;
    x.drawImage(img, 8 * k, 8 * k, 8 * k, 8 * k, 0, 0, 8, 8);            // лицо
    x.drawImage(img, 40 * k, 8 * k, 8 * k, 8 * k, 0, 0, 8, 8);           // второй слой (шапка)
    return c;
  }
  async function paintHead(el, v) {
    try { const c = await headCanvas(v && v.skin); el.textContent = ''; el.appendChild(c); el.dataset.done = '1'; } catch (e) { /* остаётся буква */ }
  }
  function paintSkins(root) {
    (root || document).querySelectorAll('[data-head]').forEach(async el => {
      const id = el.dataset.head, acc = S.mcs.find(m => m.id === id);
      if (!acc) return;
      if (acc.type === 'offline') { paintHead(el, null); return; }
      let h = S.heads[id];
      if (h && h.fail && Date.now() - h.fail > 60000) h = null;      // после ошибки пробуем снова не чаще раза в минуту
      if (!h) {
        h = S.heads[id] = { pending: call('skin:head', id).then(v => { S.heads[id] = v; return v; }, () => { S.heads[id] = { fail: Date.now() }; return null; }) };
      }
      if (h.fail) return;
      const v = h.pending ? await h.pending : h;
      if (v) paintHead(el, v);
    });
  }
  /* скин поменялся: обновляем значки во всех местах */
  function setHead(id, v) { S.heads[id] = { skin: v.skin, slim: !!v.slim }; document.querySelectorAll('[data-head]').forEach(el => { if (el.dataset.head === id) paintHead(el, S.heads[id]); }); }

  /* ---------------- боковая панель: выбранный аккаунт ---------------- */
  function renderAccount() {
    const box = $id('account');
    if (!box) return;
    if (!desktop) { box.innerHTML = '<p class="sidebar-meta">Аккаунты и лаунчер доступны в приложении</p>'; return; }
    const a = selectedAcc();
    box.innerHTML = a
      ? `<button class="acc-chip" data-act="accounts" type="button" title="Сменить аккаунт">${avatar(a)}
           <span class="acc-meta"><b>${esc(a.name)}</b><small>${esc(TYPES[a.type] || a.type)}</small></span></button>
         <button class="acc-gear" data-act="skins" type="button" title="Скин и плащ" aria-label="Скин и плащ"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>`
      : '<button class="side-btn primary" data-act="accounts" type="button">Войти в аккаунт</button>';
    box.onclick = e => {
      if (e.target.closest('[data-act="skins"]')) openDlg('skins');
      else if (e.target.closest('[data-act="accounts"]')) openDlg('accounts');
    };
    paintSkins(box);
  }

  /* ---------------- события ядра ---------------- */
  function pushLog(line) {
    S.logs.push(line);
    if (S.logs.length > 400) S.logs.shift();
    const el = $id('lcLog');
    if (el) {
      // если пользователь сам прокрутил вверх, чтение не сбиваем; иначе следуем за новыми строками
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (el.dataset.empty) { el.textContent = ''; delete el.dataset.empty; }
      el.textContent += line + '\n';
      if (near) el.scrollTop = el.scrollHeight;
    }
  }
  /* журнал открывается сразу внизу, у самых свежих строк */
  function logToEnd() { const el = $id('lcLog'); if (el) el.scrollTop = el.scrollHeight; }
  function setProgress(barId, statId, text, pct) {
    const b = $id(barId), t = $id(statId);
    if (t && text) t.textContent = text;
    if (b && pct != null) { b.hidden = false; b.value = Math.round(pct * 100); }
  }
  /* --- боковая панель загрузок модов: видна на любой странице, пока что-то качается --- */
  const DL = new Map();
  const fmtMb = b => (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' МБ';
  /* крупные задачи (скачивание Minecraft, установка сборки): карточка справа живёт, пока идёт работа, и сообщает итог */
  function taskStart(key, title, sub) {
    const old = DL.get(key); if (old) clearTimeout(old.t);
    DL.set(key, { file: key, task: true, cancelable: true, title, sub, pct: null, status: 'Подготовка…' });
    dlPaint();
  }
  function taskProgress(key, text, pct) {
    const e = DL.get(key);
    if (!e || !e.task || e.done || e.error || e.cancelling) return;
    if (text) e.status = text;
    if (pct != null) e.pct = Math.min(99, Math.round(pct * 100));
    dlPaint();
  }
  function taskEnd(key, ok, text) {
    const e = DL.get(key); if (!e) return;
    clearTimeout(e.t);
    e.done = ok; e.error = !ok; e.status = text; e.pct = 100;
    dlLeave(e, ok ? 9000 : 12000);
    dlPaint();
  }
  /* задача отменена пользователем: карточка плавно уходит, недокачанные файлы в панели помечаются ошибкой */
  function taskCancelled(key) {
    const e = DL.get(key);
    if (e) { clearTimeout(e.t); e.leaving = true; e.t = setTimeout(() => { DL.delete(key); dlPaint(); }, 360); }
    for (const x of DL.values()) if (!x.task && !x.done && !x.error) { x.error = true; dlLeave(x, 1200); }
    dlPaint();
  }
  async function cancelTask(key) {
    const e = DL.get(key);
    if (!e || !e.task || e.done || e.error || e.cancelling) return;
    const yes = await ask({ title: 'Отменить скачивание?', text: `«${e.title}» будет остановлено.\nУже скачанное для этого экземпляра и недоделанная установка удалятся.`,
      ok: 'Да, отменить', cancel: 'Продолжить скачивание', danger: true });
    if (!yes) return;
    const cur = DL.get(key);
    if (!cur || cur.done || cur.error) { note('Скачивание уже завершилось'); return; }
    cur.cancelling = true; cur.status = 'Отменяю…'; dlPaint();
    try {
      const was = await call('task:cancel', key === 'task:mod' ? 'mod' : 'create');
      if (!was) { cur.cancelling = false; note('Сейчас нечего отменять'); dlPaint(); }
    } catch (ex) { cur.cancelling = false; note(ex.message); dlPaint(); }
  }
  function dlLeave(e, ms) {
    e.t = setTimeout(() => { e.leaving = true; dlPaint(); e.t = setTimeout(() => { DL.delete(e.file); dlPaint(); }, 360); }, ms);
  }
  function dlUpdate(p) {
    let e = DL.get(p.file);
    if (!e) DL.set(p.file, e = { file: p.file, dep: p.dependency });
    clearTimeout(e.t);
    e.got = p.received; e.total = p.total; e.done = !!p.done; e.leaving = false;
    e.cached = !!p.cached; e.verifying = !!p.verifying; e.error = !!p.error;
    // готовый (или упавший с ошибкой) файл показывается, потом плавно уходит, панель не должна «застывать»
    if (e.done || e.error) dlLeave(e, 3000);
    dlPaint();
  }
  function dlPaint() {
    let box = $id('lcDl');
    if (!DL.size) {
      if (box && !box.hidden) {
        box.classList.add('out'); clearTimeout(box._h);
        box._h = setTimeout(() => { if (!DL.size) { box.hidden = true; box.classList.remove('out'); box.innerHTML = ''; } }, 300);
      }
      return;
    }
    if (!box) {
      box = document.createElement('aside'); box.id = 'lcDl'; box.setAttribute('aria-live', 'polite'); box.hidden = true; document.body.appendChild(box);
      box.addEventListener('click', ev => { const x = ev.target.closest('.dl-cancel'); if (x) cancelTask(x.closest('.dl-i').dataset.file); });
    }
    clearTimeout(box._h); box.classList.remove('out');
    if (box.hidden) { box.innerHTML = '<div class="dl-h"></div>'; box.hidden = false; }
    const all = [...DL.values()], shown = all.slice(-6);
    box.querySelector('.dl-h').textContent = 'Загрузки' + (all.length > shown.length ? ` · ещё ${all.length - shown.length}` : '');
    const keep = new Set(shown.map(e => e.file));
    const rows = new Map();
    box.querySelectorAll('.dl-i').forEach(r => { if (keep.has(r.dataset.file)) rows.set(r.dataset.file, r); else r.remove(); });
    for (const e of shown) {
      let row = rows.get(e.file);
      if (!row) {
        row = document.createElement('div'); row.className = 'dl-i'; row.dataset.file = e.file;
        row.innerHTML = '<div class="dl-n"><span class="dl-ic" aria-hidden="true"></span><span class="dl-t"></span><small></small></div><div class="dl-bar"><i></i></div><div class="dl-s"></div><button type="button" class="dl-cancel" hidden>Отмена</button>';
        box.appendChild(row);
      }
      const pct = e.task ? (e.done || e.error ? 100 : e.pct) : e.done ? 100 : (e.verifying || e.error) ? 100 : (e.total ? Math.min(99, Math.round(e.got / e.total * 100)) : null);
      row.classList.toggle('done', !!e.done);
      row.classList.toggle('err', !!e.error);
      row.classList.toggle('leaving', !!e.leaving);
      row.querySelector('.dl-n').title = e.task ? e.title : e.file;
      row.querySelector('.dl-t').textContent = e.task ? e.title : e.file;
      row.querySelector('.dl-cancel').hidden = !(e.task && e.cancelable && !e.done && !e.error && !e.cancelling);
      const sm = row.querySelector('small'); sm.textContent = e.task ? (e.sub || '') : e.dep ? 'зависимость' : '';
      const bar = row.querySelector('.dl-bar');
      bar.classList.toggle('ind', pct == null || !!e.verifying);
      row.querySelector('.dl-bar i').style.width = pct == null ? '' : pct + '%';
      row.querySelector('.dl-s').textContent = e.task ? (pct != null && !e.done && !e.error ? `${e.status} · ${pct}%` : e.status) : e.error ? 'Ошибка загрузки' : e.verifying ? 'Проверяю файл…' : e.done ? (e.cached ? 'Уже установлен' : 'Готово') : (e.total ? `${fmtMb(e.got)} из ${fmtMb(e.total)} · ${pct}%` : `${fmtMb(e.got)}…`);
    }
  }
  function wireEvents() {
    document.addEventListener('wheel', ev => {
      const st = ev.target.closest && ev.target.closest('.inst-strip');
      if (st && Math.abs(ev.deltaY) > Math.abs(ev.deltaX) && st.scrollWidth > st.clientWidth) { st.scrollLeft += ev.deltaY; ev.preventDefault(); }
    }, { passive: false });
    // кнопка «Отменить скачивание» в окне мода/сборки (оно не принадлежит лаунчеру, поэтому слушаем документ)
    document.addEventListener('click', ev => { const b = ev.target.closest && ev.target.closest('#modal [data-act="task-cancel"]'); if (b) cancelTask(b.dataset.key || 'task:create'); });
    mm.on('progress', p => {
      if (p.text) pushLog(p.text);
      if (p.log) return;
      if (p.key === 'mod' && p.file) { dlUpdate(p); if (S.ofFile && p.file === S.ofFile) ofProgress(p); }
      if (p.key === 'create') { setProgress('lcBar', 'lcStat', p.text, p.pct); taskProgress('task:create', p.text, p.pct); }
      else if (p.key === 'many') { setProgress('lcManyBar', 'lcManyStat', p.text, p.pct); taskProgress('task:mod', p.text, p.pct); }
      else if (p.key === 'mod') { setProgress('lcModBar', 'lcModStat', p.text, p.pct); if (p.text) taskProgress('task:mod', p.text, p.pct); }
      else if (p.key && p.key.startsWith('launch:')) setProgress('lcPlayBar', 'lcPlayStat', p.text, p.pct);
    });
    mm.on('game-log', g => pushLog(g.line));
    // окно Minecraft появилось: «Запуск…» → «Запущено»
    mm.on('game-window', async g => {
      S.starting.delete(g.id);
      await reloadInstances();
      if (onHome()) { paintPlay(); const t = $id('lcPlayStat'); if (t) t.textContent = gameStatText(g.id); const b = $id('lcPlayBar'); if (b) b.hidden = true; }
    });
    mm.on('game-exit', async g => {
      S.starting.delete(g.id);
      pushLog(`Игра завершена (код ${g.code})`);
      await reloadInstances();
      if (onHome()) render();
      note(g.code === 0 ? 'Игра закрыта' : `Игра завершилась с кодом ${g.code}, подробности в журнале`);
    });
    // новая версия лаунчера: уведомление и точка у «Настроек», обновляется кнопкой в настройках
    mm.on('update-state', onUpdateState);
    const ub = $id('updBtn'); if (ub) ub.onclick = updateClick;
    call('update:state').then(onUpdateState).catch(() => {});
    mm.on('ms-result', r => {
      S.ms = null;
      S.msErr = (!r.ok && r.error !== 'Вход отменён') ? r.error : '';
      if (r.ok) { S.mcs = r.list; note('Аккаунт Microsoft добавлен'); } else if (S.msErr) note(S.msErr);
      afterAccountsChange();
    });
    // файлы экземпляра изменились (моды, скриншоты), показываем сразу, без перезапуска
    mm.on('fs-change', async ev => {
      await reloadInstances();
      if (ev.kind === 'screens' && (!S.sel || ev.id === S.sel)) await loadShots(true);
      if (onHome()) updateMeta();
      if (S.dlg && S.dlg.kind === 'settings' && S.dlg.arg === ev.id) {
        if (ev.kind === 'mods') { await reloadSys(); loadMods(ev.id); if (!S.ofFile) loadOptifine(ev.id); updateRamHint('lcI'); }
      }
    });
  }
  /* Плашка обновления в шапке: видна, только когда на GitHub есть новая версия */
  function onUpdateState(u) {
    const box = $id('updBanner'); if (!box) return;
    S.upd = u || null;
    const ph = u && u.phase;
    const show = ph === 'available' || ph === 'downloading' || ph === 'installing';
    box.hidden = !show;
    if (!show) return;
    const t = $id('updTitle'), sub = $id('updSub'), btn = $id('updBtn'), bar = $id('updBar');
    bar.hidden = true; btn.hidden = false; btn.disabled = false;
    if (ph === 'downloading') {
      t.textContent = 'Скачиваю обновление…'; sub.textContent = `${u.pct || 0}%`;
      bar.hidden = false; bar.value = u.pct || 0; btn.hidden = true;
    } else if (ph === 'installing') {
      t.textContent = 'Устанавливаю обновление'; sub.textContent = 'Лаунчер сейчас перезапустится'; btn.hidden = true;
      bar.hidden = false; bar.value = 100;
    } else if (u.error) {
      t.textContent = 'Не удалось обновить'; sub.textContent = u.error; btn.textContent = 'Повторить';
    } else {
      t.textContent = `Доступна версия v${u.latest}`; sub.textContent = `Сейчас v${u.current}`;
      btn.textContent = u.canInstall ? 'Обновить' : 'Скачать';
    }
    box.title = sub.textContent;
  }
  async function updateClick() {
    const u = S.upd; if (!u) return;
    if (!u.canInstall && u.url) { window.open(u.url, '_blank'); return; }
    try { await call('update:install'); } catch (ex) { note(ex.message); }
  }
  function afterAccountsChange() {
    S.heads = Object.fromEntries(Object.entries(S.heads).filter(([id]) => S.mcs.some(m => m.id === id)));
    renderAccount();
    if (S.dlg && S.dlg.kind === 'skins') { const a = selectedAcc(); if (a) loadSkin(a.id); else $id('lcDlg').close(); }
    if (S.dlg && S.dlg.kind === 'accounts') paintDlg();
    if (onHome()) render();
  }

  /* ---------------- фон: скриншоты игры ---------------- */
  function stopSlides() { if (S.timer) clearInterval(S.timer); S.timer = null; }
  function startSlides() {
    stopSlides();
    const bg = $id('lcBg');
    if (!bg) return;
    const layers = bg.querySelectorAll('.lc-slide');
    if (!S.shots.length) {
      bg.classList.add('empty');
      layers.forEach(l => { l.classList.remove('on'); l.style.backgroundImage = ''; });
      return;
    }
    bg.classList.remove('empty');
    let i = Math.floor(Math.random() * S.shots.length), layer = 0;
    const show = () => {
      if (!$id('lcBg')) { stopSlides(); return; }
      const url = S.shots[i % S.shots.length]; i++;
      const img = new Image();
      img.onload = () => {
        const next = layers[layer], prev = layers[1 - layer];
        next.style.backgroundImage = `url("${url}")`;
        next.classList.remove('on'); void next.offsetWidth; next.classList.add('on');
        prev.classList.remove('on');
        layer = 1 - layer;
      };
      img.src = url;
    };
    show();
    if (S.shots.length > 1) S.timer = setInterval(show, ((cur() && cur().slideSeconds) || 7) * 1000);
  }
  async function loadShots(onlyIfChanged) {
    const inst = cur();
    let shots = [];
    try { shots = await call('inst:screens', inst ? inst.id : null); } catch (e) { shots = []; }
    const same = shots.join('|') === S.shots.join('|');
    S.shots = shots; S.shotsLoaded = true;
    if (onHome() && !(onlyIfChanged && same)) startSlides();
  }

  /* ---------------- главная = лаунчер ---------------- */
  function metaText(inst) {
    if (!inst) return '';
    const ram = inst.ramAuto ? `авто, ${gb(inst.ramEffective)} ГБ` : `${gb(inst.ram)} ГБ`;
    return `Minecraft ${esc(inst.mc)} · ${esc(LD[inst.loader] || inst.loader)}${inst.loaderVersion ? ' ' + esc(inst.loaderVersion) : ''} · ОЗУ: ${ram} · модов: ${inst.modCount != null ? inst.modCount : (inst.mods || []).length}`;
  }
  function updateMeta() { const m = $id('lcMeta'); if (m) m.innerHTML = metaText(cur()); }

  function stageHtml() {
    const inst = cur();
    const acc = selectedAcc();
    const gate = inst ? '' : `<div class="lc-gate"><div class="lc-gate-card"><b>Установок пока нет</b>
        <p>Выберите версию Minecraft и загрузчик модов, остальное лаунчер скачает сам.</p>
        <div class="lc-gate-actions"><button class="btn primary" data-act="new" type="button">Скачать версию Minecraft</button></div></div></div>`;

    return `
      <section class="lc-stage" id="lcStage">
        <div class="lc-bg empty" id="lcBg"><div class="lc-slide"></div><div class="lc-slide"></div></div>
        <div class="lc-shade"></div>
        <header class="lc-top">
          <div class="lc-title"><span class="hero-eyebrow">${inst ? 'Экземпляр' : 'MatrixL'}</span>
            <div class="lc-name">${esc(inst ? inst.name : 'MatrixL')}</div><p id="lcMeta">${metaText(inst)}</p></div>
          <div class="lc-top-right">
            <button class="lc-chip" data-act="accounts" type="button" title="Аккаунты Minecraft">
              ${avatar(acc, 'sm')}
              <span class="lc-chip-t"><b>${esc(acc ? acc.name : 'Войти в аккаунт')}</b><small>${acc ? esc(TYPES[acc.type] || acc.type) : 'Ely.by, Microsoft или оффлайн'}</small></span>
            </button>
            <button class="lc-chip lc-chip-icon" data-act="log" type="button" title="Журнал">Журнал</button>
          </div>
        </header>
        ${gate}
        <footer class="lc-bar">
          <div class="lc-bar-left">
            <div class="inst-strip" role="listbox" aria-label="Экземпляры">${S.instances.map(i =>
              `<button type="button" class="inst-tile" role="option" aria-selected="${inst && i.id === inst.id}" data-act="pick" data-id="${esc(i.id)}" title="${esc(i.name)} · ${esc(i.mc)}">${instIcon(i)}<span class="inst-nm">${esc(i.name)}</span></button>`).join('')}
              <button type="button" class="inst-tile inst-add" data-act="new" title="Новый экземпляр"><span class="inst-ic"><b>+</b></span><span class="inst-nm">Новый</span></button></div>
            <button class="btn" data-act="settings" type="button" ${inst ? '' : 'disabled'}>Настройки экземпляра</button>
          </div>
          <div class="lc-bar-right">
            <div class="lc-stat" id="lcPlayStat" role="status"></div>
            <progress id="lcPlayBar" max="100" value="0" hidden></progress>
            <button class="btn lc-folder" data-act="game-folder" type="button" title="Открыть папку игры" aria-label="Открыть папку игры" ${inst ? '' : 'disabled'}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6c.4 0 .8.2 1.1.5L11.7 7H19.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg></button>
            <button class="btn primary lc-play" data-act="play" type="button" ${inst && !inst.running && !S.starting.has(inst.id) ? '' : 'disabled'}>${playLabel(inst)}</button>
          </div>
        </footer>
      </section>`;
  }

  function render() {
    const c = $id('content');
    if (!c) return;
    document.body.classList.add('lc-home');
    c.innerHTML = stageHtml();
    paintSkins(c);
    if (onHome()) presence('home');

    c.onclick = e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const a = b.dataset.act;
      if (a === 'accounts') openDlg('accounts');
      else if (a === 'log') openDlg('log');
      else if (a === 'new') openDlg('create');
      else if (a === 'pick') { S.sel = b.dataset.id; saveSel(); S.shotsLoaded = false; render(); }
      else if (a === 'settings') { const i = cur(); if (i) openDlg('settings', i.id); }
      else if (a === 'play') play(b);
      else if (a === 'game-folder') { const i = cur(); if (i) call('inst:folder', { id: i.id }).catch(e => note(e.message)); }
    };
    if (S.shotsLoaded) startSlides(); else loadShots();
  }

  /* Надпись на кнопке: «Играть» → «Запуск…» (пока грузится) → «Запущено» (когда появилось окно Minecraft) */
  function playLabel(inst) {
    if (!inst) return 'Играть';
    if (S.starting.has(inst.id)) return 'Запуск…';
    return inst.running ? 'Запущено' : 'Играть';
  }
  function paintPlay() {
    const inst = cur();
    const btn = document.querySelector('.lc-play'); if (!btn || !inst) return;
    btn.textContent = playLabel(inst);
    btn.disabled = !!inst.running || S.starting.has(inst.id);
  }
  function gameStatText(id) {
    if (S.starting.has(id)) return 'Запуск игры…';
    const a = selectedAcc();
    return 'Игра запущена' + (a ? ` · ${a.name}` : '');
  }

  async function play(btn) {
    const inst = cur();
    if (!inst) return;
    if (!S.mcs.length) { note('Сначала войдите в игровой аккаунт'); openDlg('accounts'); return; }
    S.starting.add(inst.id);
    paintPlay();                                   // сразу «Запуск…», пока готовятся файлы
    const stat = $id('lcPlayStat'); if (stat) stat.textContent = 'Подготовка к запуску…';
    try {
      await call('inst:launch', inst.id);
      await reloadInstances();
      render();                                    // кнопка останется «Запуск…» до появления окна игры
      const t = $id('lcPlayStat'); if (t) t.textContent = gameStatText(inst.id);
    } catch (err) {
      S.starting.delete(inst.id);
      await reloadInstances();
      render();
      const t = $id('lcPlayStat'); if (t) t.textContent = err.message;
      note(err.message);
    }
  }

  /* ---------------- диалоги ---------------- */
  function ensureDlg() {
    let d = $id('lcDlg');
    if (d) return d;
    d = document.createElement('dialog');
    d.id = 'lcDlg'; d.className = 'acc-dlg lc-dlg';
    document.body.appendChild(d);
    d.addEventListener('close', () => { S.dlg = null; });
    d.addEventListener('click', onDlgClick);
    d.addEventListener('submit', onDlgSubmit);
    d.addEventListener('input', onDlgInput);
    d.addEventListener('change', onDlgInput);
    return d;
  }
  async function openDlg(kind, arg) {
    S.dlg = { kind, arg };
    if (kind === 'create' && S.bgTask && S.bgTask.phase !== 'run') S.bgTask = null;   // прошлая установка закончена, чистая форма
    if (kind === 'settings' || kind === 'create') await reloadSys();   // актуальные сведения о ПК
    const d = ensureDlg();
    if (kind === 'skins') {
      const a = selectedAcc();
      if (!a) { S.dlg = null; openDlg('accounts'); return; }
      S.sk = { id: a.id, loading: true, data: null, error: '', busy: false };
    }
    paintDlg();
    if (!d.open) d.showModal();
    if (kind === 'skins') loadSkin(S.sk.id);
    // журнал: прокрутка работает только у показанного окна, поэтому, после showModal
    if (kind === 'log') { logToEnd(); requestAnimationFrame(() => { logToEnd(); setTimeout(logToEnd, 80); }); }
  }
  const head = (title, sub) => `<div class="m-head"><div><h2>${esc(title)}</h2>${sub ? `<div class="by">${esc(sub)}</div>` : ''}</div></div>`;
  const foot = '<div class="m-foot"><button class="btn" data-act="dclose" type="button">Закрыть</button></div>';

  /* --- память: зависит от характеристик компьютера --- */
  function ramControl(p, { auto, ram, rec }) {
    const sys = S.sys || { totalMb: 8192, freeMb: 4096, maxRamMb: 4096, threads: 4, cpu: 'неизвестно' };
    const max = Math.max(1024, sys.maxRamMb), val = Math.min(Math.max(ram || rec, 1024), max);
    return `
      <div class="ram-box" id="${p}Box" data-rec="${rec}">
        <div class="ram-sys"><b>Ваш компьютер:</b> ${esc(sys.cpu)}, потоков: ${sys.threads}<br>
          ОЗУ: ${gb(sys.totalMb)} ГБ всего, <span id="${p}Free">${gb(sys.freeMb)}</span> ГБ свободно сейчас · для игры доступно до ${gb(max)} ГБ</div>
        <label class="ram-auto"><input type="checkbox" id="${p}Auto" ${auto ? 'checked' : ''}>
          Подбирать память автоматически <span class="muted">(рекомендуется <b id="${p}Rec">${gb(rec)}</b> ГБ)</span></label>
        <div class="ram-row">
          <input type="range" id="${p}Range" min="1024" max="${max}" step="512" value="${val}" ${auto ? 'disabled' : ''}>
          <output id="${p}Val"></output>
        </div>
        <p class="filter-note" id="${p}Hint"></p>
      </div>`;
  }
  function updateRamHint(p) {
    const box = $id(p + 'Box'); if (!box) return;
    const sys = S.sys; if (!sys) return;
    const auto = $id(p + 'Auto').checked, range = $id(p + 'Range');
    let rec = parseInt(box.dataset.rec, 10);
    if (p === 'lcI') { const live = S.instances.find(x => x.id === (S.dlg && S.dlg.arg)); if (live) { rec = live.ramRecommended; box.dataset.rec = rec; } }
    range.disabled = auto;
    const shown = auto ? rec : parseInt(range.value, 10);
    $id(p + 'Rec').textContent = gb(rec);
    $id(p + 'Free').textContent = gb(sys.freeMb);
    $id(p + 'Val').textContent = (auto ? 'Авто · ' : '') + gb(shown) + ' ГБ';
    const hint = $id(p + 'Hint');
    if (shown > sys.freeMb) hint.textContent = `Сейчас свободно только ${gb(sys.freeMb)} ГБ. Закройте лишние программы, иначе игра может тормозить.`;
    else if (!auto && shown < rec) hint.textContent = `Для этой установки рекомендуется не меньше ${gb(rec)} ГБ, при меньшем значении возможны лаги.`;
    else hint.textContent = auto ? 'Память подбирается при каждом запуске по характеристикам компьютера и числу модов.' : '';
  }
  /* OptiFine в окне создания: версия игры ещё не скачана, поэтому смотрим список по номеру версии */
  async function refreshNewOf(mc) {
    const note0 = $id('lcNOfNote'), sel = $id('lcNOfSel'); if (!note0 || !sel || !mc) return;
    note0.textContent = `Ищу OptiFine для Minecraft ${mc}…`;
    sel.disabled = true; sel.innerHTML = '<option>Загружаю…</option>';
    try {
      const info = await call('optifine:versions', mc);
      const n2 = $id('lcNOfNote'), s2 = $id('lcNOfSel'); if (!n2 || !s2 || $id('lcMc').value !== mc) return;
      S.newOf = info;
      if (!info.versions.length) {
        s2.innerHTML = '<option value="">Нет версий</option>'; s2.disabled = true;
        n2.textContent = `Для Minecraft ${mc} OptiFine не найден, либо его не выпускали для этой версии, либо нет связи с сайтом OptiFine.`;
        return;
      }
      s2.innerHTML = info.versions.map(v => {
        const t = ofTags(v, info);
        return `<option value="${esc(v.file)}">OptiFine ${esc(ofName(v))}${t.length ? ' · ' + t.join(', ') : ''}</option>`;
      }).join('');
      s2.value = info.recommended || info.versions[0].file; s2.disabled = false;
      const rec = info.versions.find(v => v.file === info.recommended);
      n2.textContent = rec ? `Для Minecraft ${mc} рекомендуется OptiFine ${ofName(rec)}.` : `Для Minecraft ${mc} доступно версий OptiFine: ${info.versions.length}.`;
    } catch (e) { const n2 = $id('lcNOfNote'); if (n2) n2.textContent = 'Не удалось получить список OptiFine: ' + e.message; const s2 = $id('lcNOfSel'); if (s2) s2.innerHTML = '<option value="">Нет данных</option>'; }
  }
  function onDlgInput(e) {
    const id = e.target.id || '';
    if (id === 'lcMc') { const lo = S.lo.lcN; loadLoaders('lcN', e.target.value, lo && lo.loader ? { loader: lo.loader } : null); refreshNewOf(e.target.value); }
    else if (id === 'lcNLVer' || id === 'lcILVer') { const lo = S.lo[id.slice(0, 3)]; if (lo) lo.version = e.target.value; updateApplyState(); }
    else if (/^lc[NI](Auto|Range)$/.test(id)) updateRamHint(id.slice(0, 3));
    else if (id === 'lcManySel') { saveModTarget(e.target.value); refreshManyCompat(); }
    else if (id === 'lcOfSel') paintOptifineState();
    else if (e.target.name === 'skVar' && S.skViewer && S.skImgs) S.skViewer.update({ ...S.skImgs, slim: e.target.value === 'slim' });
  }

  /* --- аватарки экземпляров --- */
  const PRESETS = [
    ['grass', '#52a535', '▦'], ['pick', '#7a8793', '⛏'], ['sword', '#c0504d', '⚔'], ['creeper', '#3e9b3a', '☻'],
    ['gem', '#2fb7c9', '◆'], ['fire', '#e2701f', '✹'], ['star', '#d9b132', '★'], ['heart', '#d6457a', '♥'],
    ['moon', '#6f58c9', '☾'], ['bolt', '#3b82e8', '⚡'], ['skull', '#8b8b8b', '☠'], ['crown', '#b8862b', '♛']
  ];
  const hashColor = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return `hsl(${h % 360} 42% 38%)`; };
  function instIcon(i, cls) {
    const c = cls || '';
    if (i.iconUrl) return `<span class="inst-ic ${c}"><img src="${esc(i.iconUrl)}" alt=""></span>`;
    const pr = i.iconPreset && PRESETS.find(x => x[0] === i.iconPreset);
    if (pr) return `<span class="inst-ic ${c}" style="background:${pr[1]}"><b>${pr[2]}</b></span>`;
    const ch = ([...String(i.name || '?').trim()][0] || '?').toUpperCase();
    return `<span class="inst-ic ${c}" style="background:${hashColor(i.name)}"><b>${esc(ch)}</b></span>`;
  }

  /* --- выбор загрузчика: показываются только те, что существуют для версии Minecraft --- */
  const LOADER_ORDER = ['fabric', 'quilt', 'forge', 'neoforge'];
  const LD_FULL = { vanilla: 'Без модов (Vanilla)', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

  /* Логотипы загрузчиков: положите файлы site/loaders/fabric.svg (или .png), forge, neoforge, quilt, они подхватятся сами.
     Пока файла нет, показывается нейтральная буква. */
  function loaderLogo(k) {
    if (k === 'vanilla') return '<span class="lp-logo"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2l7 4v8l-7 4-7-4V6z M3 6l7 4 7-4 M10 10v8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg></span>';
    const letter = (LD[k] || k).charAt(0);
    return `<span class="lp-logo"><img src="loaders/${k}.svg" alt="" data-l="${esc(letter)}" onerror="if(!this.dataset.p){this.dataset.p=1;this.src='loaders/${k}.png'}else{this.outerHTML='<b>'+this.dataset.l+'</b>'}"></span>`;
  }

  function loaderPicker(p) {
    return `
      <div class="field"><span>Загрузчик модов</span><div class="lp-chips" id="${p}Chips" role="group"><span class="filter-note">Проверяю, что доступно для этой версии…</span></div></div>
      <div class="lp-pop" id="${p}Pop" hidden></div>
      <label class="field" id="${p}VerField" hidden><span>Версия загрузчика</span><select id="${p}LVer"></select></label>
      <p class="filter-note" id="${p}LNote"></p>`;
  }

  async function loadLoaders(p, mc, want) {
    const lo = S.lo[p] = { mc, opts: null, loader: null, version: null, installed: want && want.installed || null };
    const chips = $id(p + 'Chips');
    if (!chips) return;
    chips.innerHTML = '<span class="filter-note">Проверяю, что доступно для этой версии…</span>';
    $id(p + 'VerField').hidden = true;
    let opts = null;
    try { opts = await call('loader:options', mc); }
    catch (e) { $id(p + 'LNote') && ($id(p + 'LNote').textContent = 'Не удалось получить список загрузчиков: ' + e.message); opts = {}; }
    if (S.lo[p] !== lo || !$id(p + 'Chips')) return;           // пока ждали, выбрали другую версию или закрыли окно
    lo.opts = opts;
    const avail = ['vanilla', ...LOADER_ORDER.filter(k => opts[k])];
    const prefer = (want && want.loader) || S.lastLoader;
    lo.loader = avail.includes(prefer) ? prefer : (['fabric', 'forge', 'neoforge', 'quilt'].find(k => opts[k]) || 'vanilla');
    lo.version = want && want.version || null;
    paintLoaders(p);
  }

  function paintLoaders(p) {
    const lo = S.lo[p]; if (!lo || !lo.opts) return;
    const avail = ['vanilla', ...LOADER_ORDER.filter(k => lo.opts[k])];
    $id(p + 'Chips').innerHTML = avail.map(k => {
      const on = k === lo.loader;
      const ver = on && k !== 'vanilla' && lo.version ? `<small>${esc(lo.version)}</small>` : '';
      return `<button type="button" class="chip lp-tile" aria-pressed="${on}" data-act="lp-loader" data-p="${p}" data-l="${k}">${loaderLogo(k)}<span class="lp-name">${esc(LD_FULL[k])}${ver}</span></button>`;
    }).join('');
    const missing = LOADER_ORDER.filter(k => !lo.opts[k]).map(k => LD[k]);
    const sel = $id(p + 'LVer'), field = $id(p + 'VerField'), note = $id(p + 'LNote');
    let text = missing.length ? `Для Minecraft ${lo.mc} недоступны: ${missing.join(', ')}.` : '';
    if (lo.loader === 'vanilla') {
      field.hidden = true;
    } else {
      const o = lo.opts[lo.loader];
      const inst = lo.installed && lo.installed.loader === lo.loader ? lo.installed.version : null;
      const list = [o.recommended, ...o.versions.filter(v => v !== o.recommended)];
      if (inst && !list.includes(inst)) list.push(inst);
      sel.innerHTML = list.map(v => {
        const tags = [v === o.recommended ? 'рекомендуется' : '', v === o.latest && v !== o.recommended ? 'последняя' : '', v === inst ? 'установлена' : ''].filter(Boolean);
        return `<option value="${esc(v)}">${esc(v)}${tags.length ? ' · ' + tags.join(', ') : ''}</option>`;
      }).join('');
      lo.version = list.includes(lo.version) ? lo.version : (inst || o.recommended);
      sel.value = lo.version;
      field.hidden = true;     // выбор версии, в плашке под значками; select остаётся источником значения
      text = `Рекомендуется ${LD[lo.loader]} ${o.recommended}. ` + text;
      const pop = $id(p + 'Pop');
      if (pop) {
        pop.hidden = !lo.popOpen;
        if (lo.popOpen) {
          pop.innerHTML = `<div class="lp-pop-h">Версии ${esc(LD[lo.loader])} для Minecraft ${esc(lo.mc)} <button type="button" class="lp-x" data-act="lp-close" data-p="${p}" aria-label="Закрыть">✕</button></div><div class="lp-vlist">` +
            list.map(v => {
              const tags = [v === o.recommended ? 'рекомендуется' : '', v === o.latest && v !== o.recommended ? 'последняя' : '', v === inst ? 'установлена' : ''].filter(Boolean);
              return `<button type="button" class="lp-v" aria-pressed="${v === lo.version && (p !== 'lcI' || !!lo.picked)}" data-act="lp-ver" data-p="${p}" data-v="${esc(v)}"><span>${esc(v)}</span>${tags.length ? `<em>${tags.join(', ')}</em>` : ''}</button>`;
            }).join('') + '</div>';
          const cur = pop.querySelector('.lp-v[aria-pressed="true"]'); if (cur) cur.scrollIntoView({ block: 'nearest' });
        }
      }
    }
    if (lo.loader === 'vanilla') { const pop = $id(p + 'Pop'); if (pop) pop.hidden = true; }
    note.textContent = text.trim();
    if (p === 'lcN' && S.sys) { const box = $id('lcNBox'); if (box) { box.dataset.rec = lo.loader === 'vanilla' ? S.sys.ramVanilla : S.sys.ramModded; updateRamHint('lcN'); } }
    updateApplyState();
  }

  /* кнопка «Применить загрузчик» активна, только если выбор отличается от установленного */
  function updateApplyState() {
    const b = $id('lcLoaderApply'), lo = S.lo.lcI;
    if (!b || !lo || !lo.opts) return;
    const inst = lo.installed || {};
    const ver = lo.loader === 'vanilla' ? null : ($id('lcILVer') ? $id('lcILVer').value : lo.version);
    const same = lo.loader === inst.loader && (ver || null) === (inst.version || null);
    // в настройках экземпляра версию выбирает сам пользователь: до выбора кнопка не горит
    b.disabled = same || (lo.loader !== 'vanilla' && !lo.picked);
    b.classList.toggle('primary', !b.disabled);
  }

  /* --- аккаунты --- */
  function accountsBody() {
    const rows = S.mcs.length ? S.mcs.map(a => `
      <div class="lc-card">
        <div class="lc-acc-id">${avatar(a)}<div><h3>${esc(a.name)}</h3><span class="by">${esc(TYPES[a.type] || a.type)}${a.selected ? ' · выбран для игры' : ''}</span></div></div>
        <div class="lc-install">
          ${a.selected ? '' : `<button class="btn" data-act="mc-select" data-id="${esc(a.id)}" type="button">Выбрать</button>`}
          <button class="btn danger" data-act="mc-remove" data-id="${esc(a.id)}" type="button">Убрать</button>
        </div>
      </div>`).join('') : '<p class="filter-note">Аккаунтов пока нет. Войдите через Ely.by, чтобы в игре были скины, либо добавьте другой аккаунт.</p>';

    const tab = S.accTab;
    const tabs = ['ely', 'microsoft', 'offline'].map(t => `<button class="src-tab" role="tab" aria-selected="${t === tab}" data-act="tab" data-tab="${t}" type="button">${esc(TYPES[t])}</button>`).join('');
    let pane = '';
    if (tab === 'ely') pane = `
      <form class="acc-form" id="lcElyForm" autocomplete="on">
        <p class="filter-note">Войдите через Ely.by, и в игре и на серверах Ely.by будет ваш скин. Нет аккаунта? <a href="https://account.ely.by/register" target="_blank" rel="noopener">Зарегистрироваться на ely.by</a></p>
        <label class="field"><span>Email или ник Ely.by</span><input id="lcElyLogin" type="text" required autocomplete="username"></label>
        <label class="field"><span>Пароль</span><input id="lcElyPass" type="password" required autocomplete="current-password"></label>
        <p class="filter-note">Если включена двухфакторная защита, введите пароль в виде «пароль:код» (код из приложения-аутентификатора).</p>
        <p class="form-err" id="lcElyErr" role="alert"></p>
        <button class="btn primary" id="lcElyBtn" type="submit">Войти через Ely.by</button>
      </form>`;
    else if (tab === 'microsoft') pane = `
      <div class="acc-form">
        ${S.msErr && !S.ms ? `<div class="banner err"><b>Не удалось войти</b>${esc(S.msErr)}</div>` : ''}
        ${S.ms ? `<div class="banner"><b>Войдите на странице Microsoft</b>Страница входа открыта в браузере. Введите логин и пароль, после этого лаунчер войдёт в аккаунт сам.</div>
        <button class="btn danger" data-act="mc-ms-cancel" type="button">Отменить вход</button>` : `<button class="btn primary" data-act="mc-ms" type="button">Войти через Microsoft</button>`}
        <p class="filter-note">Откроется страница Microsoft, где нужно ввести логин и пароль. Нужен лицензионный аккаунт Minecraft: Java Edition.</p>
        ${S.settings.msBuiltIn ? '' : `<p class="filter-note">В этой сборке не задан ID приложения Microsoft. Вставьте его ниже (Application (client) ID из Microsoft Entra).</p>
        <div class="search-row">
          <label class="search" style="max-width:380px"><input id="lcClientId" type="text" placeholder="Application (client) ID" value="${esc(S.settings.msClientId || '')}" autocomplete="off"></label>
          <button class="btn" data-act="cid-save" type="button">Сохранить</button>
        </div>`}
      </div>`;
    else pane = `
      <form class="acc-form" id="lcOffForm">
        <label class="field"><span>Ник (3–16 символов, латиница, цифры, _)</span><input id="lcOffName" type="text" maxlength="16" autocomplete="off" required></label>
        <button class="btn primary" type="submit">Добавить оффлайн-аккаунт</button>
        <p class="filter-note">«Оффлайн»: игра запускается с выбранным ником без проверки лицензии и без скинов. Не работает на серверах с онлайн-режимом.</p>
      </form>`;
    return `<div class="lc-list">${rows}</div>
      <h4 style="margin:6px 0 0">Добавить аккаунт</h4>
      <div class="src-tabs" role="tablist" style="margin:0">${tabs}</div>${pane}`;
  }

  /* --- скин и плащ --- */
  function skinsBody() {
    const k = S.sk;
    if (!k) return '';
    if (k.loading) return '<p class="filter-note" role="status">Загружаю скин…</p>';
    if (!k.data) return `<div class="banner err"><b>Не удалось загрузить скин</b>${esc(k.error || '')}</div>
      <div class="lc-install"><button class="btn" data-act="skin-reload" type="button">Повторить</button></div>`;
    const p = k.data, busy = k.busy ? 'disabled' : '';
    let out = '';
    if (p.warning) out += `<div class="banner err"><b>Изменить скин сейчас нельзя</b>${esc(p.warning)}</div>`;
    out += `<div class="sk-view" id="skBox" aria-label="Предпросмотр скина"><canvas id="skGL" class="sk-gl" title="Потяните, чтобы повернуть. Двойной щелчок сбрасывает вид"></canvas></div>`;
    if (p.canEdit) {
      out += `<h4 class="sk-h">Скин</h4>
        <div class="sk-variant" role="radiogroup" aria-label="Тип рук">
          <label><input type="radio" name="skVar" value="classic" ${p.slim ? '' : 'checked'}><span>Классический</span></label>
          <label><input type="radio" name="skVar" value="slim" ${p.slim ? 'checked' : ''}><span>Тонкий</span></label>
        </div>
        <div class="lc-install">
          <button class="btn primary" data-act="skin-pick" type="button" ${busy}>Выбрать файл скина…</button>
          <button class="btn" data-act="skin-reset" type="button" ${busy}>Вернуть стандартный</button>
        </div>
        <h4 class="sk-h">Плащ</h4>`;
      const none = !p.capes.some(c => c.active);
      out += `<div class="sk-capes" role="radiogroup" aria-label="Плащ">
        <button type="button" class="sk-cape ${none ? 'on' : ''}" data-act="cape-set" data-cape="" aria-pressed="${none}" ${busy}><span class="sk-cape-none">Нет</span><small>Без плаща</small></button>
        ${p.capes.map(c => `<button type="button" class="sk-cape ${c.active ? 'on' : ''}" data-act="cape-set" data-cape="${esc(c.id)}" aria-pressed="${c.active}" ${busy}><canvas class="sk-cape-cv" data-cape-img="${esc(c.id)}" width="10" height="16"></canvas><small>${esc(c.alias || 'Плащ')}</small></button>`).join('')}
      </div>`;
      if (!p.capes.length) out += '<p class="filter-note">На этом аккаунте нет плащей.</p>';
      if (k.busy) out += '<p class="filter-note" role="status">Отправляю в Mojang…</p>';
    } else if (p.type === 'ely') {
      out += `<p class="filter-note">Скин и плащ Ely.by меняются на сайте, а в лаунчере и игре появятся сами.</p>
        <div class="lc-install"><a class="btn primary" href="${esc(p.web || 'https://ely.by/skins')}" target="_blank" rel="noopener">Открыть Ely.by</a>
        <button class="btn" data-act="skin-reload" type="button">Обновить</button></div>`;
    } else if (p.type === 'offline') {
      out += '<p class="filter-note">У оффлайн-аккаунта своего скина нет: в игре будет стандартный. Чтобы менять скин и плащ, войдите через Microsoft.</p>';
    } else {
      out += '<div class="lc-install"><button class="btn" data-act="skin-reload" type="button">Повторить</button></div>';
    }
    return out;
  }

  /* Рисуем игрока по текстуре скина (64×64 или 64×32, в том числе HD) */
  function drawFigure(cv, skin, cape, slim, back, scale) {
    cv.width = 16 * scale; cv.height = 32 * scale;
    const x = cv.getContext('2d'); x.imageSmoothingEnabled = false; x.clearRect(0, 0, cv.width, cv.height);
    const k = skin.width / 64, legacy = skin.height < skin.width;
    const part = (sx, sy, w, h, dx, dy, flip) => {
      x.save();
      if (flip) { x.translate((dx + w) * scale, 0); x.scale(-1, 1); dx = 0; }
      x.drawImage(skin, sx * k, sy * k, w * k, h * k, dx * scale, dy * scale, w * scale, h * scale);
      x.restore();
    };
    const aw = slim ? 3 : 4, ax = 4 - aw;
    // x-координата в текстуре: спереди и сзади
    const rArm = (oy) => [(back ? (slim ? 51 : 52) : 44), oy];
    const lArmBase = [(back ? (slim ? 43 : 44) : 36), 52], lArmOv = [(back ? (slim ? 59 : 60) : 52), 52];
    const arm = (right, overlay, dx) => {
      if (right) { const [sx, sy] = rArm(overlay ? 36 : 20); part(sx, sy, aw, 12, dx, 8); }
      else if (legacy) { const [sx, sy] = rArm(20); part(sx, sy, aw, 12, dx, 8, true); }
      else { const [sx, sy] = overlay ? lArmOv : lArmBase; part(sx, sy, aw, 12, dx, 8); }
    };
    const leg = (right, overlay, dx) => {
      if (right) part(back ? 12 : 4, overlay ? 36 : 20, 4, 12, dx, 20);
      else if (legacy) part(back ? 12 : 4, 20, 4, 12, dx, 20, true);
      else part(back ? (overlay ? 12 : 28) : (overlay ? 4 : 20), 52, 4, 12, dx, 20);
    };
    // спереди слева стоит правая рука/нога персонажа, сзади левая
    const leftSlotRight = !back, rightSlotRight = back;
    leg(leftSlotRight, false, 4); leg(rightSlotRight, false, 8);
    part(back ? 32 : 20, 20, 8, 12, 4, 8);
    if (!legacy) { leg(leftSlotRight, true, 4); leg(rightSlotRight, true, 8); part(back ? 32 : 20, 36, 8, 12, 4, 8); }
    if (back && cape) {
      const kc = cape.width / 64;
      x.drawImage(cape, 1 * kc, 1 * kc, 10 * kc, 16 * kc, 3 * scale, 8 * scale, 10 * scale, 16 * scale);
    }
    arm(leftSlotRight, false, ax); arm(rightSlotRight, false, 12);
    if (!legacy) { arm(leftSlotRight, true, ax); arm(rightSlotRight, true, 12); }
    part(back ? 24 : 8, 8, 8, 8, 4, 0);
    part(back ? 56 : 40, 8, 8, 8, 4, 0);
  }
  async function paintSkinPreview() {
    const k = S.sk;
    if (S.skViewer) { S.skView = S.skViewer.view(); S.skViewer.destroy(); S.skViewer = null; }
    if (!k || !k.data) return;
    const p = k.data, token = k;
    try {
      const activeCape = p.capes.find(c => c.active && c.img);
      const [skinImg, capeImg] = await Promise.all([
        p.skin ? loadImg(p.skin) : steveImage(),
        activeCape ? loadImg(activeCape.img) : null
      ]);
      if (S.sk !== token) return;
      S.skImgs = { skin: skinImg, cape: capeImg };
      const gl = $id('skGL');
      const viewer = gl && window.SkinViewer ? window.SkinViewer.create(gl, S.skView) : null;
      if (viewer) {
        viewer.update({ skin: skinImg, cape: capeImg, slim: p.slim });
        S.skViewer = viewer;
      } else if ($id('skBox')) {      // WebGL недоступен: плоский вид спереди и сзади
        $id('skBox').innerHTML = '<figure><canvas id="skFront" class="sk-cv" aria-label="Спереди"></canvas><figcaption>Спереди</figcaption></figure><figure><canvas id="skBack" class="sk-cv" aria-label="Сзади"></canvas><figcaption>Сзади</figcaption></figure>';
        drawFigure($id('skFront'), skinImg, null, p.slim, false, 6);
        drawFigure($id('skBack'), skinImg, capeImg, p.slim, true, 6);
      }
      await Promise.all([...document.querySelectorAll('[data-cape-img]')].map(async cv => {
        const c = p.capes.find(x => x.id === cv.dataset.capeImg);
        if (!c || !c.img) return;
        const im = await loadImg(c.img); if (S.sk !== token) return;
        const kc = im.width / 64, x = cv.getContext('2d'); x.imageSmoothingEnabled = false;
        x.drawImage(im, 1 * kc, 1 * kc, 10 * kc, 16 * kc, 0, 0, 10, 16);
      }));
    } catch (e) { /* картинка не загрузилась, остаётся пустой предпросмотр */ }
  }
  /* Стив нужен как запасной скин: в нём рисуется только голова, остальное заливается цветом */
  function steveImage() {
    const c = document.createElement('canvas'); c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    const fill = (col, rx, ry, w, h) => { x.fillStyle = col; x.fillRect(rx, ry, w, h); };
    [[8, 8, 8, 8], [24, 8, 8, 8]].forEach(([rx, ry, w, h]) => fill('#b78a68', rx, ry, w, h));
    fill('#4a3020', 8, 8, 8, 2); fill('#4a3020', 24, 8, 8, 8);
    fill('#3b8f8b', 20, 20, 8, 12); fill('#3b8f8b', 32, 20, 8, 12);       // тело
    fill('#b78a68', 44, 20, 4, 12); fill('#b78a68', 52, 20, 4, 12); fill('#b78a68', 36, 52, 4, 12); fill('#b78a68', 44, 52, 4, 12);
    fill('#3b3b8f', 4, 20, 4, 12); fill('#3b3b8f', 12, 20, 4, 12); fill('#3b3b8f', 20, 52, 4, 12); fill('#3b3b8f', 28, 52, 4, 12);
    x.fillStyle = '#fff'; x.fillRect(9, 11, 2, 1); x.fillRect(13, 11, 2, 1);
    x.fillStyle = '#3d3a8a'; x.fillRect(9, 11, 1, 1); x.fillRect(14, 11, 1, 1);
    return loadImg(c.toDataURL());
  }

  async function loadSkin(id) {
    const a = id ? S.mcs.find(m => m.id === id) : selectedAcc();
    if (!a) { S.sk = null; if (S.dlg && S.dlg.kind === 'skins') $id('lcDlg').close(); return; }
    const k = S.sk = { id: a.id, loading: true, data: null, error: '', busy: false };
    // уже загружавшийся профиль показываем сразу, свежие данные подтянутся следом
    const cached = await call('skin:cached', a.id).catch(() => null);
    if (S.sk !== k) return;
    if (cached) { k.data = cached; k.loading = false; }
    if (S.dlg && S.dlg.kind === 'skins') paintDlg();
    try {
      const fresh = await call('skin:profile', a.id);
      if (S.sk !== k) return;
      const same = cached && k.data === cached && sameProfile(cached, fresh);
      k.data = fresh; k.error = '';
      if (fresh && fresh.skin !== undefined) setHead(a.id, fresh);
      k.loading = false;
      if (same) return;      // ничего не изменилось, окно не перерисовываем
    } catch (ex) {
      if (cached && k.data) { k.loading = false; return; }   // сеть недоступна, остаётся то, что показано
      k.error = ex.message;
    }
    k.loading = false;
    if (S.sk === k && S.dlg && S.dlg.kind === 'skins') paintDlg();
  }
  function sameProfile(a, b) {
    if (!a || !b) return false;
    const key = p => JSON.stringify([p.canEdit, p.slim, p.skin, p.warning || '', (p.capes || []).map(c => [c.id, c.active, c.img])]);
    return key(a) === key(b);
  }
  /* изменение скина или плаща: одна общая обёртка */
  async function skinChange(channel, arg, okText) {
    const k = S.sk; if (!k || !k.data || k.busy) return;
    k.busy = true; paintDlg();
    try {
      const r = await call(channel, arg);
      if (r) { k.data = r; setHead(k.id, r); note(okText); }
    } catch (ex) { note(ex.message); }
    k.busy = false;
    if (S.sk === k) paintDlg();
  }

  /* --- новая версия --- */
  function createBody() {
    const s = S.sys || {};
    return `
      <form class="acc-form lc-form" id="lcCreate">
        <label class="field"><span>Название</span><input id="lcName" type="text" maxlength="40" placeholder="Например, Мои моды"></label>
        <label class="field"><span>Версия Minecraft</span><select id="lcMc"><option>Загружаю список…</option></select></label>
        <div class="checks"><label><input type="checkbox" id="lcSnap"> Показывать снапшоты</label></div>
        ${loaderPicker('lcN')}
        <p class="filter-note">Есть готовая сборка? <button type="button" class="link" data-act="pack-file">Установить из файла (.mrpack или .zip)…</button></p>
        <div class="lp-box" id="lcNOf">
          <div class="of-head"><img class="of-logo" src="optifine.webp" alt="" width="48" height="48">
            <div><h4>OptiFine</h4><p class="filter-note" id="lcNOfNote">Выберите версию Minecraft, и здесь появятся доступные сборки OptiFine.</p></div></div>
          <div class="of-row"><select id="lcNOfSel" aria-label="Версия OptiFine" disabled><option>Выберите версию Minecraft</option></select></div>
          <div class="checks"><label><input type="checkbox" id="lcNOfOn"> Установить OptiFine вместе с экземпляром (нужен Forge)</label></div>
        </div>
        ${ramControl('lcN', { auto: true, ram: s.ramModded, rec: s.ramModded || 3072 })}
        <button class="btn primary" id="lcCreateBtn" type="submit">Скачать и установить</button>
      </form>
      <progress id="lcBar" max="100" value="0" hidden style="width:100%"></progress>
      <p class="filter-note" id="lcStat">Скачиваются клиент игры, библиотеки, ресурсы, Java и загрузчик. Forge и NeoForge ставятся официальным установщиком, поэтому это занимает больше времени.</p>`;
  }

  /* --- настройки экземпляра --- */
  function settingsBody(i) {
    return `
      <form class="acc-form" id="lcInstForm" data-id="${esc(i.id)}">
        <label class="field"><span>Название</span><input id="lcInstName" type="text" maxlength="40" value="${esc(i.name)}"></label>
        <div class="specs">
          <div class="spec"><span>Minecraft</span><b>${esc(i.mc)}</b></div>
          <div class="spec"><span>Загрузчик</span><b>${esc(LD[i.loader] || i.loader)}${i.loaderVersion ? ' ' + esc(i.loaderVersion) : ''}</b></div>
          <div class="spec"><span>Модов</span><b id="lcInstModCount">${i.modCount}</b></div>
        </div>
        <div class="lp-box">
          <h4>Аватарка</h4>
          <div class="ic-row">${instIcon(i, 'lg')}
            <div class="lc-install">
              <button class="btn" data-act="icon-pick" data-id="${esc(i.id)}" type="button">Добавить изображение…</button>
              <button class="btn" data-act="icon-clear" data-id="${esc(i.id)}" type="button" ${i.iconUrl || i.iconPreset ? '' : 'disabled'}>Сбросить</button>
            </div></div>
          <div class="ic-presets">${PRESETS.map(x => `<button type="button" class="ic-p" aria-pressed="${i.iconPreset === x[0]}" data-act="icon-preset" data-id="${esc(i.id)}" data-p="${x[0]}" style="background:${x[1]}" title="${x[0]}">${x[2]}</button>`).join('')}</div>
        </div>
        <div class="lp-box">
          <h4>Фон главной страницы</h4>
          <div class="bg-modes" role="radiogroup" aria-label="Фон">
            <label class="seg-opt"><input type="radio" name="lcIBg" value="screens" ${i.bgMode === 'screens' ? 'checked' : ''}><span>Скриншоты этого экземпляра</span></label>
            <label class="seg-opt"><input type="radio" name="lcIBg" value="custom" ${i.bgMode === 'custom' ? 'checked' : ''} ${i.bgFile ? '' : 'disabled'}><span>Своё изображение</span></label>
            <label class="seg-opt"><input type="radio" name="lcIBg" value="none" ${i.bgMode === 'none' ? 'checked' : ''}><span>Без изображения (цвет темы)</span></label>
          </div>
          <div class="lc-install">
            <button class="btn" data-act="bg-pick" data-id="${esc(i.id)}" type="button">${i.bgFile ? 'Заменить изображение…' : 'Добавить изображение…'}</button>
            <button class="btn" data-act="bg-clear" data-id="${esc(i.id)}" type="button" ${i.bgFile ? '' : 'disabled'}>Убрать изображение</button>
          </div>
          <p class="filter-note">Скриншоты берутся только из папки этого экземпляра. Снимки из других установок на фон не попадут.</p>
          <label class="field"><span>Смена скриншотов</span>
            <select id="lcISlide">${[[4, 'каждые 4 секунды'], [7, 'каждые 7 секунд'], [15, 'каждые 15 секунд'], [30, 'каждые 30 секунд']].map(([v, t]) => `<option value="${v}" ${(i.slideSeconds || 7) === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        </div>
        ${ramControl('lcI', { auto: !!i.ramAuto, ram: i.ram, rec: i.ramRecommended })}
        <button class="btn primary" type="submit">Сохранить</button>
      </form>
      <div class="lp-box">
        <h4>Загрузчик модов</h4>
        ${loaderPicker('lcI')}
        <div class="lc-install"><button class="btn" id="lcLoaderApply" data-act="loader-apply" data-id="${esc(i.id)}" type="button" disabled>Применить загрузчик</button></div>
        <progress id="lcBar" max="100" value="0" hidden style="width:100%"></progress>
        <p class="filter-note" id="lcStat">Моды в папке mods останутся на месте. Проверьте, что они подходят выбранному загрузчику.</p>
      </div>
      <div class="lp-box" id="lcOf" data-id="${esc(i.id)}">
        <div class="of-head"><img class="of-logo" src="optifine.webp" alt="" width="48" height="48">
          <div><h4>OptiFine</h4><p class="filter-note" id="lcOfNote">Проверяю версии для Minecraft ${esc(i.mc)}…</p></div></div>
        <div class="of-row">
          <select id="lcOfSel" aria-label="Версия OptiFine" disabled><option>Загружаю…</option></select>
          <button class="btn primary" id="lcOfBtn" data-act="of-install" data-id="${esc(i.id)}" type="button" disabled>Установить OptiFine</button>
        </div>
        <progress id="lcOfBar" max="100" value="0" hidden style="width:100%"></progress>
        <p class="filter-note" id="lcOfStat">Файл скачивается прямо в папку mods этого экземпляра.</p>
      </div>
      <div class="lc-install">
        <button class="btn" data-act="folder" data-id="${esc(i.id)}" type="button">Папка игры</button>
        <button class="btn" data-act="mods-folder" data-id="${esc(i.id)}" type="button">Папка модов</button>
        <button class="btn" data-act="shots-folder" data-id="${esc(i.id)}" type="button">Папка скриншотов</button>
      </div>
      <div><h4>Моды в этой установке</h4>
        <div class="cm-pre" id="lcCompat"></div>
        <div class="lc-install"><button class="btn" data-act="compat-run" data-id="${esc(i.id)}" type="button">Проверить совместимость</button></div>
        <div class="lc-mods" id="lcMods"><p class="filter-note">Загружаю…</p></div>
        <p class="filter-note">Список обновляется сразу, если вы добавляете или удаляете файлы в папке модов. Чтобы поставить мод из каталога, откройте раздел «Моды» и нажмите «Установить в Minecraft».</p></div>
      <div><button class="btn danger" data-act="del" data-id="${esc(i.id)}" type="button">Удалить установку</button></div>`;
  }


  /* ---------------- OptiFine ----------------
     Версии берутся под Minecraft экземпляра; рекомендуемая (последняя стабильная) выбрана заранее.
     Файл ставится в папку mods, так он работает вместе с Forge. */
  const ofName = v => `${v.type.replace(/_/g, ' ')} ${v.patch}`;
  const ofStrip = f => String(f || '').replace(/^preview_/, '');
  function ofTags(v, info) {
    return [v.file === info.recommended ? 'рекомендуется' : '', v.preview ? 'предварительная' : '', info.installed && ofStrip(v.file) === info.installed ? 'установлена' : ''].filter(Boolean);
  }
  async function loadOptifine(id) {
    if (!$id('lcOf')) return;
    let info;
    try { info = await call('optifine:list', id); }
    catch (e) { const n = $id('lcOfNote'); if (n && $id('lcOf').dataset.id === id) n.textContent = 'Не удалось получить список версий: ' + e.message; return; }
    const box = $id('lcOf');
    if (!box || box.dataset.id !== id) return;
    S.of = info;
    const sel = $id('lcOfSel'), note0 = $id('lcOfNote');
    const keep = sel.value;
    if (!info.versions.length) {
      sel.innerHTML = '<option value="">Нет версий</option>'; sel.disabled = true; $id('lcOfBtn').disabled = true;
      note0.textContent = `Для Minecraft ${info.mc} OptiFine не найден, либо его не выпускали для этой версии, либо нет связи с сайтом OptiFine.`;
      return;
    }
    sel.innerHTML = info.versions.map(v => {
      const t = ofTags(v, info);
      return `<option value="${esc(v.file)}">OptiFine ${esc(ofName(v))}${t.length ? ' · ' + t.join(', ') : ''}</option>`;
    }).join('');
    sel.value = info.versions.some(v => v.file === keep) ? keep : (info.recommended || info.versions[0].file);
    const rec = info.versions.find(v => v.file === info.recommended);
    const lines = [];
    if (rec) lines.push(`Для Minecraft ${info.mc} рекомендуется OptiFine ${ofName(rec)}.`);
    if (info.installed) lines.push(`Сейчас в mods: ${info.installed}.`);
    if (info.loader === 'vanilla') lines.push('OptiFine из папки mods работает вместе с Forge. Сначала выберите Forge в разделе «Загрузчик модов».');
    else if (info.loader !== 'forge') lines.push(`Внимание: в этом экземпляре ${LD[info.loader] || info.loader}, а OptiFine из папки mods рассчитан на Forge.`);
    note0.textContent = lines.join(' ');
    paintOptifineState();
  }
  function paintOptifineState() {
    const info = S.of, btn = $id('lcOfBtn'), sel = $id('lcOfSel');
    if (!info || !btn || !sel || !info.versions.length) return;
    const busy = !!S.ofFile;
    sel.disabled = busy;
    const same = !!info.installed && ofStrip(sel.value) === info.installed;
    btn.disabled = busy || info.loader === 'vanilla' || same;
    btn.textContent = same ? 'Уже установлена' : info.installed ? 'Заменить версию' : 'Установить OptiFine';
  }
  function ofProgress(p) {
    const bar = $id('lcOfBar'), st = $id('lcOfStat');
    if (!bar || !st) return;
    bar.hidden = false;
    if (p.done) { bar.value = 100; st.textContent = 'Файл скачан'; return; }
    if (p.verifying) { bar.value = 100; st.textContent = 'Проверяю файл…'; return; }
    const pct = p.total ? Math.min(99, Math.round(p.received / p.total * 100)) : null;
    if (pct != null) { bar.value = pct; st.textContent = `Скачиваю OptiFine: ${fmtMb(p.received)} из ${fmtMb(p.total)} · ${pct}%`; }
    else st.textContent = `Скачиваю OptiFine: ${fmtMb(p.received)}…`;
  }
  async function installOptifine(btn, id) {
    const inst = S.instances.find(x => x.id === id), sel = $id('lcOfSel');
    if (!inst || !sel || !sel.value || S.ofFile) return;
    if (inst.loader === 'vanilla') { note('Сначала выберите загрузчик Forge'); return; }
    if (inst.loader !== 'forge') {
      const yes = await ask({ title: `OptiFine и ${LD[inst.loader] || inst.loader}`,
        text: `OptiFine из папки mods рассчитан на Forge, а в этом экземпляре, ${LD[inst.loader] || inst.loader}.\nФайл будет скачан, но игра с ним может не запуститься.`,
        ok: 'Всё равно установить', danger: true });
      if (!yes) return;
    }
    const file = sel.value;
    S.ofFile = ofStrip(file);
    paintOptifineState();
    const bar = $id('lcOfBar'), st = $id('lcOfStat');
    if (bar) { bar.hidden = false; bar.value = 0; }
    if (st) st.textContent = 'Подключаюсь к серверу OptiFine…';
    try {
      const r = await call('optifine:install', { id, file });
      note(`${r.title} установлен в папку mods`);
      S.ofFile = null;
      await reloadInstances(); if (onHome()) updateMeta();
      loadMods(id); await loadOptifine(id);
      const s2 = $id('lcOfStat'); if (s2) s2.textContent = 'Готово, OptiFine лежит в папке mods.';
    } catch (ex) {
      S.ofFile = null;
      const s2 = $id('lcOfStat'); if (s2) s2.textContent = ex.message;
      const b2 = $id('lcOfBar'); if (b2) b2.hidden = true;
      note(ex.message); paintOptifineState();
    }
  }

  async function loadMods(id) {
    const box = $id('lcMods');
    if (!box) return;
    try {
      const mods = await call('mod:list', id);
      const cnt = $id('lcInstModCount'); if (cnt) cnt.textContent = mods.length;
      box.innerHTML = mods.length
        ? mods.map(m => `<div class="vrow"><span class="vn">${esc(m.title)}</span><span class="vm">${esc(m.file)}${m.dependency ? ' · зависимость' : ''}</span>
            <button class="btn danger" style="margin-left:auto;padding:4px 10px" data-act="mod-del" data-id="${esc(id)}" data-file="${esc(m.file)}" type="button">Убрать</button></div>`).join('')
        : '<p class="filter-note">Модов пока нет.</p>';
    } catch (e) { box.textContent = e.message; }
    runCompat(id);
  }

  /* ---------------- проверка совместимости ---------------- */
  let compatSeq = 0;
  async function runCompat(id) {
    const box = $id('lcCompat');
    if (!box) return;
    const seq = ++compatSeq;
    box.innerHTML = '<p class="filter-note">Проверяю файлы в папке mods…</p>';
    try {
      const r = await call('mod:check', id);
      if (seq !== compatSeq || !$id('lcCompat')) return;
      box.innerHTML = r.scanned ? compatHTML(r.issues, { note: `Проверено файлов: ${r.scanned}. Читаются описания внутри .jar: одинаковые файлы, две версии одного мода, чужой загрузчик, недостающие зависимости и известные конфликты.` })
        : '<p class="filter-note">В папке mods пока нет файлов, проверять нечего.</p>';
    } catch (e) { if (seq === compatSeq && $id('lcCompat')) box.innerHTML = `<p class="filter-note">${esc(e.message)}</p>`; }
  }
  /* после установки: если нашлись ошибки или предупреждения, показываем их сразу */
  async function postInstallCheck(instanceId) {
    try {
      const r = await call('mod:check', instanceId);
      const c = Compat.count(r.issues);
      if (c.error || c.warn) {
        const inst = S.instances.find(x => x.id === instanceId);
        await openDlg('compat', { name: inst ? inst.name : '', id: instanceId, issues: r.issues.filter(i => i.level !== 'info'), scanned: r.scanned });
      }
      return r;
    } catch (e) { return null; }
  }

  async function fillVersions() {
    const sel = $id('lcMc');
    if (!sel) return;
    try {
      if (!S.versions) S.versions = await call('ver:list');
      const snap = $id('lcSnap') && $id('lcSnap').checked;
      const list = snap ? S.versions.snapshots : S.versions.releases;
      const prev = sel.value;
      sel.innerHTML = list.map((v, i) => `<option value="${esc(v)}">${esc(v)}${!snap && i === 0 ? ' (последняя)' : ''}</option>`).join('');
      if (prev && list.includes(prev)) sel.value = prev;
      const lo = S.lo.lcN;
      if (S.dlg && S.dlg.kind === 'create' && sel.value && (!lo || lo.mc !== sel.value)) loadLoaders('lcN', sel.value, lo && lo.loader ? { loader: lo.loader } : null);
      if (S.dlg && S.dlg.kind === 'create' && sel.value) refreshNewOf(sel.value);
    } catch (err) {
      sel.innerHTML = '<option value="">Нет связи с серверами Mojang</option>';
      note(err.message);
    }
  }

  /* ---- окно остаётся открытым, пока идёт скачивание: пользователь сам решает, когда его закрыть ---- */
  function bgStart(title, sub) { S.bgTask = { title, sub, phase: 'run', text: 'Подготовка…' }; if (S.dlg && S.dlg.kind === 'create') paintDlg(); }
  function bgEnd(phase, text) { if (!S.bgTask) return; S.bgTask.phase = phase; S.bgTask.text = text; if (S.dlg && S.dlg.kind === 'create') paintDlg(); }
  function bgClear() { S.bgTask = null; if (S.dlg && S.dlg.kind === 'create') paintDlg(); }
  function bgBody() {
    const t = S.bgTask, run = t.phase === 'run', e = DL.get('task:create');
    const pct = t.phase === 'done' ? 100 : (e && e.pct != null ? e.pct : 0);
    const title = run ? 'Можно закрыть это окно' : t.phase === 'done' ? 'Готово' : t.phase === 'cancel' ? 'Скачивание отменено' : 'Не удалось установить';
    const text = run ? 'Скачивание уже началось и продолжится в фоне. Окно можно закрыть в любой момент. Прогресс виден в плашке «Загрузки» справа, а когда всё будет готово, вы получите уведомление.' : t.text;
    return `<div class="bg-note ${t.phase}"><b>${esc(title)}</b><p>${esc(text)}</p></div>
      <progress id="lcBar" max="100" value="${pct}" ${t.phase === 'run' || t.phase === 'done' ? '' : 'hidden'} style="width:100%"></progress>
      <p class="filter-note" id="lcStat" role="status">${esc(run ? ((e && e.status) || t.sub || '') : (t.sub || ''))}</p>
      ${run ? '<div class="lc-install"><button class="btn danger" data-act="task-cancel" type="button">Отменить скачивание</button></div>' : ''}`;
  }

  function paintDlg() {
    const d = ensureDlg();
    const k = S.dlg && S.dlg.kind;
    if (!k) return;
    d.dataset.kind = k;
    if (k === 'skins') {
      const a = selectedAcc();
      d.innerHTML = head('Скин и плащ', a ? `${a.name} · ${TYPES[a.type] || a.type}` : '') + `<div class="m-body">${skinsBody()}</div>` + foot;
      paintSkinPreview();
    } else if (k === 'accounts') {
      d.innerHTML = head('Аккаунты Minecraft', 'Выберите, под каким аккаунтом играть') + `<div class="m-body">${accountsBody()}</div>` + foot;
      paintSkins(d);
    } else if (k === 'create' && S.bgTask) {
      const t = S.bgTask;
      d.innerHTML = head(t.phase === 'run' ? 'Скачивание началось' : 'Установка', t.title) + `<div class="m-body">${bgBody()}</div>` + foot;
    } else if (k === 'create') {
      S.lo.lcN = null;
      d.innerHTML = head('Скачать версию Minecraft', 'Клиент, библиотеки, ресурсы, Java и загрузчик модов') + `<div class="m-body">${createBody()}</div>` + foot;
      const sn = $id('lcSnap'); if (sn) sn.onchange = fillVersions;
      fillVersions(); updateRamHint('lcN');
    } else if (k === 'settings') {
      const i = S.instances.find(x => x.id === S.dlg.arg);
      if (!i) { d.close(); return; }
      d.innerHTML = head('Настройки экземпляра', i.name) + `<div class="m-body">${settingsBody(i)}</div>` + foot;
      loadMods(i.id); updateRamHint('lcI'); loadOptifine(i.id);
      loadLoaders('lcI', i.mc, { loader: i.loader, version: i.loaderVersion, installed: { loader: i.loader, version: i.loaderVersion || null } });
    } else if (k === 'many') {
      d.innerHTML = head('Установка избранного', S.dlg.arg.title) + `<div class="m-body">${manyBody()}</div>` + foot;
      refreshManyCompat();
    } else if (k === 'pack') {
      d.innerHTML = head('Установка сборки', S.dlg.arg || '') + `<div class="m-body">
        <progress id="lcBar" max="100" value="0" style="width:100%"></progress>
        <p class="filter-note" id="lcStat" role="status">Подготовка…</p>
        <div id="lcPackSkip"></div>
        <p class="filter-note">Лаунчер скачает нужную версию Minecraft и загрузчик, затем все файлы сборки. Это может занять несколько минут.</p></div>` + foot;
    } else if (k === 'compat') {
      const a = S.dlg.arg;
      d.innerHTML = head('Проверка совместимости', a.name ? `Установка «${a.name}»` : '') + `<div class="m-body">${compatHTML(a.issues, { note: `Проверено файлов в папке mods: ${a.scanned}. Исправить можно в «Настройки экземпляра» → «Моды в этой установке».` })}</div>` + foot;
    } else if (k === 'log') {
      d.innerHTML = head('Журнал', 'Сообщения лаунчера и игры') + '<div class="m-body"><pre class="lc-log" id="lcLog"></pre></div>' + foot;
      const el = $id('lcLog'); el.textContent = S.logs.length ? S.logs.join('\n') + '\n' : 'Пока пусто.';
      if (S.logs.length) delete el.dataset.empty; else el.dataset.empty = '1';
      logToEnd();
    }
  }

  async function onDlgClick(e) {
    const b = e.target.closest && e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id, act = b.dataset.act;
    try {
      if (act === 'dclose') $id('lcDlg').close();
      else if (act === 'tab') { S.accTab = b.dataset.tab; paintDlg(); }
      else if (act === 'icon-pick') { const r = await call('inst:pickIcon', id); if (r) { await reloadInstances(); render(); paintDlg(); note('Аватарка обновлена'); } }
      else if (act === 'new') openDlg('create');
      else if (act === 'many-go') await manyGo(b);
      else if (act === 'compat-run') await runCompat(id);
      else if (act === 'pack-file') installPackFile();
      else if (act === 'bg-pick') { const r = await call('inst:pickBg', id); if (r) { await reloadInstances(); S.shotsLoaded = false; render(); paintDlg(); note('Фон установлен'); } }
      else if (act === 'bg-clear') { await call('inst:clearBg', id); await reloadInstances(); S.shotsLoaded = false; render(); paintDlg(); }
      else if (act === 'icon-clear') { await call('inst:clearIcon', id); await reloadInstances(); render(); paintDlg(); }
      else if (act === 'icon-preset') { await call('inst:update', { id, iconPreset: b.dataset.p }); await reloadInstances(); render(); paintDlg(); }
      else if (act === 'lp-loader') {
        const lo = S.lo[b.dataset.p];
        if (lo) {
          if (lo.loader !== b.dataset.l) lo.picked = false;
          if (lo.loader === b.dataset.l) lo.popOpen = lo.loader !== 'vanilla' && !lo.popOpen;       // повторное нажатие, открыть/закрыть плашку версий
          else { lo.loader = b.dataset.l; lo.version = null; lo.popOpen = lo.loader !== 'vanilla'; if (b.dataset.p === 'lcN') S.lastLoader = lo.loader; }
          paintLoaders(b.dataset.p);
        }
      }
      else if (act === 'lp-ver') { const lo = S.lo[b.dataset.p]; if (lo) { lo.version = b.dataset.v; lo.picked = true; lo.popOpen = false; paintLoaders(b.dataset.p); } }
      else if (act === 'lp-close') { const lo = S.lo[b.dataset.p]; if (lo) { lo.popOpen = false; paintLoaders(b.dataset.p); } }
      else if (act === 'loader-apply') {
        const lo = S.lo.lcI, inst = S.instances.find(x => x.id === id);
        if (!lo || !inst) return;
        const name = LD_FULL[lo.loader];
        if (inst.modCount > 0 && !(await ask({ title: `Сменить загрузчик на ${name}?`, text: `Установленные моды (${inst.modCount}) останутся в папке mods, но могут не подойти новому загрузчику.`, ok: 'Сменить загрузчик' }))) return;
        b.disabled = true; $id('lcStat').textContent = 'Устанавливаю загрузчик…';
        try {
          await call('inst:setLoader', { id, loader: lo.loader, loaderVersion: lo.loader === 'vanilla' ? null : $id('lcILVer').value });
          await reloadInstances(); render(); paintDlg(); note('Загрузчик изменён');
        } catch (ex) { const st = $id('lcStat'); if (st) st.textContent = ex.message; note(ex.message); b.disabled = false; }
      }
      else if (act === 'skins') openDlg('skins');
      else if (act === 'skin-reload') loadSkin(S.sk && S.sk.id);
      else if (act === 'skin-pick') {
        const v = document.querySelector('input[name="skVar"]:checked');
        await skinChange('skin:upload', { id: S.sk.id, variant: v ? v.value : 'classic' }, 'Скин изменён');
      }
      else if (act === 'skin-reset') {
        if (!(await ask({ title: 'Вернуть стандартный скин?', text: 'Текущий скин будет заменён стандартным скином Minecraft.', ok: 'Вернуть' }))) return;
        await skinChange('skin:reset', S.sk.id, 'Скин сброшен');
      }
      else if (act === 'cape-set') await skinChange('skin:cape', { id: S.sk.id, capeId: b.dataset.cape || null }, b.dataset.cape ? 'Плащ надет' : 'Плащ снят');
      else if (act === 'mc-select') { S.mcs = await call('mc:select', id); afterAccountsChange(); }
      else if (act === 'mc-remove') {
        const acc = S.mcs.find(x => x.id === id);
        if (!(await ask({ title: 'Убрать аккаунт?', text: `Аккаунт «${acc ? acc.name : ''}» исчезнет из лаунчера. Саму учётную запись это не удалит.`, ok: 'Убрать', danger: true }))) return;
        S.mcs = await call('mc:remove', id); afterAccountsChange();
      }
      else if (act === 'task-cancel') await cancelTask(b.dataset.key || 'task:create');
      else if (act === 'of-install') await installOptifine(b, id);
      else if (act === 'mc-ms') { S.msErr = ''; S.ms = await call('mc:msStart'); paintDlg(); }
      else if (act === 'mc-ms-cancel') { await call('mc:msCancel'); S.ms = null; paintDlg(); }
      else if (act === 'cid-save') { S.settings = await call('settings:set', { msClientId: $id('lcClientId').value.trim() }); note('Сохранено'); }
      else if (act === 'folder') await call('inst:folder', { id });
      else if (act === 'mods-folder') await call('inst:folder', { id, sub: 'mods' });
      else if (act === 'shots-folder') await call('inst:folder', { id, sub: 'screenshots' });
      else if (act === 'mod-del') {
        if (!(await ask({ title: 'Убрать мод?', text: `Файл «${b.dataset.file}» будет удалён из папки mods.`, ok: 'Убрать', danger: true }))) return;
        await call('mod:remove', { instanceId: id, file: b.dataset.file });
        await reloadInstances(); loadMods(id); updateMeta();
      } else if (act === 'del') {
        const di = S.instances.find(x => x.id === id);
        if (!(await ask({ title: 'Удалить экземпляр?', text: `«${di ? di.name : id}» будет удалён вместе с модами, мирами и скриншотами.\nЭто действие нельзя отменить.`, ok: 'Удалить', danger: true }))) return;
        await call('inst:delete', id);
        await reloadInstances(); S.shotsLoaded = false;
        $id('lcDlg').close(); render(); note('Установка удалена');
      }
    } catch (err) { note(err.message); }
  }

  async function onDlgSubmit(e) {
    e.preventDefault();
    const f = e.target;
    if (f.id === 'lcElyForm') {
      const btn = $id('lcElyBtn'), err = $id('lcElyErr');
      btn.disabled = true; err.textContent = ''; btn.textContent = 'Вход…';
      try {
        S.mcs = await call('mc:ely', { login: $id('lcElyLogin').value, password: $id('lcElyPass').value });
        note('Вход через Ely.by выполнен');
        afterAccountsChange();
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; btn.textContent = 'Войти через Ely.by'; }
    } else if (f.id === 'lcOffForm') {
      try { S.mcs = await call('mc:addOffline', $id('lcOffName').value); note('Аккаунт добавлен'); afterAccountsChange(); }
      catch (ex) { note(ex.message); }
    } else if (f.id === 'lcCreate') {
      if (S.creating || S.packBusy) { note('Другой экземпляр ещё скачивается, дождитесь окончания'); return; }
      const mc = $id('lcMc').value;
      const lo = S.lo.lcN;
      if (!mc) { note('Выберите версию Minecraft'); return; }
      if (!lo || !lo.opts) { note('Подождите, пока загрузится список загрузчиков'); return; }
      const opts = {
        name: $id('lcName').value, mc, loader: lo.loader,
        loaderVersion: lo.loader === 'vanilla' ? null : $id('lcNLVer').value,
        ramAuto: $id('lcNAuto').checked, ram: $id('lcNRange').value
      };
      const wantOf = !!($id('lcNOfOn') && $id('lcNOfOn').checked);
      const ofPick = ($id('lcNOfSel') && $id('lcNOfSel').value) || '';
      if (wantOf && !ofPick) { note('Для этой версии Minecraft нет OptiFine: снимите галочку'); return; }
      if (wantOf && lo.loader !== 'forge') { note('OptiFine ставится вместе с Forge: выберите загрузчик Forge или снимите галочку'); return; }
      const label = (opts.name || '').trim() || `Minecraft ${mc}`;
      S.creating = true;
      taskStart('task:create', `Minecraft ${mc}`, `«${label}» · ${LD[lo.loader] || lo.loader}`);
      // окно НЕ закрываем и на главную не уходим: показываем, что скачивание началось и окно можно закрыть самому
      bgStart(`Minecraft ${mc}`, `«${label}» · ${LD[lo.loader] || lo.loader}`);
      note(`Скачивание Minecraft ${mc} началось. Окно установки можно закрыть, загрузка идёт в фоне`);
      call('inst:create', opts).then(async inst => {
        S.sel = inst.id; saveSel(); S.shotsLoaded = false;
        let ofNote = '';
        if (wantOf) {
          taskProgress('task:create', 'Скачиваю OptiFine…', null);
          try {
            const info = await call('optifine:list', inst.id);
            const file = (ofPick && info.versions.some(v => v.file === ofPick)) ? ofPick : (info.recommended || (info.versions[0] && info.versions[0].file));
            if (file) await call('optifine:install', { id: inst.id, file }); else ofNote = ' OptiFine для этой версии не найден.';
          } catch (e) { ofNote = ` OptiFine не установился: ${e.message}`; }
        }
        await reloadInstances();
        if (onHome()) render();
        taskEnd('task:create', true, 'Готово, можно играть' + (ofNote ? '.' + ofNote : ''));
        bgEnd('done', `Экземпляр «${inst.name}» установлен. Окно можно закрыть и нажать «Играть».`);
        note(`Minecraft ${mc} установлен, экземпляр «${inst.name}» готов`);
      }).catch(ex => {
        if (isCancel(ex)) {
          taskCancelled('task:create');
          bgEnd('cancel', 'Скачивание остановлено, недоделанный экземпляр удалён.');
          note('Скачивание отменено');
        } else {
          taskEnd('task:create', false, ex.message);
          bgEnd('err', ex.message);
          note(ex.message);
        }
      }).finally(() => { S.creating = false; });
    } else if (f.id === 'lcInstForm') {
      try {
        await call('inst:update', {
          id: f.dataset.id, name: $id('lcInstName').value, ramAuto: $id('lcIAuto').checked, ram: $id('lcIRange').value,
          bgMode: (document.querySelector('input[name=lcIBg]:checked') || {}).value, slideSeconds: $id('lcISlide').value,
        });
        S.shotsLoaded = false;
        await reloadInstances(); render(); paintDlg(); note('Сохранено');
      } catch (ex) { note(ex.message); }
    }
  }

  /* ---------------- установка набора модов (избранное / сборки) ---------------- */
  const canInstall = m => (m.source === 'modrinth' || m.source === 'curseforge') && m.kind === 'mod' && (m.source === 'curseforge' ? !!cfIdOf(m) : !!m.slug);
  const refOf = m => ({ source: m.source, slug: m.source === 'curseforge' ? cfIdOf(m) : m.slug });
  function manyBody() {
    const { items } = S.dlg.arg;
    const ok = items.filter(canInstall), skip = items.filter(m => !canInstall(m));
    const usable = S.instances.filter(i => i.loader !== 'vanilla');
    const last = modTarget(usable);
    if (!usable.length) return `<p>Нет установок с загрузчиком модов. Создайте экземпляр с Fabric, Quilt, Forge или NeoForge.</p>
      <div><button class="btn primary" data-act="new" type="button">Создать экземпляр</button></div>`;
    return `
      <label class="field"><span>В какой экземпляр установить</span>
        <select id="lcManySel">${usable.map(i => `<option value="${esc(i.id)}" ${i.id === last ? 'selected' : ''}>${esc(i.name)} · ${esc(i.mc)} · ${esc(LD[i.loader])}</option>`).join('')}</select></label>
      <p><b>${ok.length}</b> ${ok.length === 1 ? 'мод будет установлен' : 'модов будет установлено'} вместе с обязательными зависимостями. Версия каждого мода подбирается под игру и загрузчик выбранного экземпляра.</p>
      ${skip.length ? `<p class="filter-note">Не будут установлены (${skip.length}): ${skip.map(m => esc(m.title)).join(', ')} Плагины и сборки так не ставятся, сборки устанавливаются из своей карточки.</p>` : ''}
      <div class="cm-pre" id="lcManyCompat"></div>
      <progress id="lcManyBar" max="100" value="0" hidden style="width:100%"></progress>
      <p class="filter-note" id="lcManyStat" role="status"></p>
      <div id="lcManyRes"></div>
      <button class="btn primary" id="lcManyGo" data-act="many-go" type="button" ${ok.length ? '' : 'disabled'}>Установить всё (${ok.length})</button>
      <button class="btn danger" id="lcManyCancel" data-act="task-cancel" data-key="task:mod" type="button" hidden>Отменить скачивание</button>`;
  }
  /* проверка набора под выбранную установку: загрузчик, версия, уже стоящие моды, известные конфликты */
  async function refreshManyCompat() {
    const sel = $id('lcManySel'), box = $id('lcManyCompat');
    if (!sel || !box || !S.dlg || S.dlg.kind !== 'many') return;
    const inst = S.instances.find(x => x.id === sel.value);
    if (!inst) return;
    let installed = [];
    try { installed = await call('mod:list', inst.id); } catch (e) { /* без списка, проверим только набор */ }
    if (!$id('lcManySel') || $id('lcManySel').value !== inst.id) return;   // пока ждали, выбрали другую установку
    const ok = S.dlg.arg.items.filter(canInstall);
    const issues = Compat.checkCards(ok, { mc: inst.mc, loader: inst.loader, name: inst.name, installed });
    S.dlg.pre = issues;
    box.innerHTML = ok.length ? compatHTML(issues, { hideInfo: true }) : '';
  }
  async function manyGo(btn) {
    const { items } = S.dlg.arg, ok = items.filter(canInstall), slugs = ok.map(refOf);
    const titles = new Map(ok.map(m => { const r = refOf(m); return [r.source + ':' + r.slug, m.title]; }));
    const instanceId = $id('lcManySel').value;
    const errs = (S.dlg.pre || []).filter(i => i.level === 'error');
    if (errs.length && !(await ask({ title: 'Найдены проблемы совместимости', text: `Проблем: ${errs.length}\n${errs.map(i => '• ' + i.title).join('\n')}\nВсё равно установить?`, ok: 'Всё равно установить', danger: true }))) return;
    btn.disabled = true; $id('lcManySel').disabled = true;
    $id('lcManyStat').textContent = 'Начинаю…';
    taskStart('task:mod', `Моды: ${slugs.length}`, 'установка');
    { const c = $id('lcManyCancel'); if (c) c.hidden = false; }
    try {
      const res = await call('mod:installMany', { instanceId, slugs });
      taskEnd('task:mod', true, 'Готово');
      const good = res.filter(r => r.ok), bad = res.filter(r => !r.ok);
      $id('lcManyBar').hidden = false; $id('lcManyBar').value = 100;
      $id('lcManyStat').textContent = `Установлено: ${good.length} из ${res.length}`;
      $id('lcManyRes').innerHTML = bad.length ? `<p class="filter-note">Не получилось:</p>` + bad.map(r => `<div class="vrow"><span class="vn">${esc(titles.get(r.source + ':' + r.slug) || r.slug)}</span><span class="vm">${esc(r.error)}</span></div>`).join('') : '<p class="filter-note">Все моды установлены.</p>';
      await reloadInstances(); if (onHome()) updateMeta();
      note(bad.length ? `Установлено ${good.length}, ошибок: ${bad.length}` : 'Все моды установлены');
      // итоговая проверка папки mods после установки
      try {
        const r = await call('mod:check', instanceId);
        const box = $id('lcManyCompat');
        if (box) box.innerHTML = r.scanned ? compatHTML(r.issues, { hideInfo: true, note: `Проверено файлов в папке mods: ${r.scanned}.` }) : '';
        const c = Compat.count(r.issues);
        if (c.error || c.warn) note(`Проверка совместимости: проблем ${c.error}, предупреждений ${c.warn}`);
      } catch (e) { /* проверка необязательна */ }
    } catch (err) {
      const st = $id('lcManyStat');
      if (isCancel(err)) { taskCancelled('task:mod'); if (st) st.textContent = 'Скачивание отменено'; note('Скачивание модов отменено'); }
      else { taskEnd('task:mod', false, err.message); if (st) st.textContent = err.message; note(err.message); }
    }
    finally { btn.disabled = false; const s2 = $id('lcManySel'); if (s2) s2.disabled = false; const c = $id('lcManyCancel'); if (c) c.hidden = true; }
  }
  async function installMany(items, title) {
    if (!desktop) return;
    await reloadInstances();
    openDlg('many', { items, title });
  }

  /* ---------------- сборки .mrpack ---------------- */
  async function runPack(title, fn) {
    if (S.packBusy || S.creating) { note('Другое скачивание ещё идёт, дождитесь окончания'); return; }
    S.packBusy = true;
    taskStart('task:create', `Сборка «${title}»`, 'Minecraft, загрузчик и моды');
    bgStart(`Сборка «${title}»`, 'Minecraft, загрузчик и моды');
    note(`Сборка «${title}» скачивается, окно можно закрыть, процесс идёт в фоне`);
    try {
      const r = await fn();
      if (!r) { const e = DL.get('task:create'); if (e) { clearTimeout(e.t); DL.delete('task:create'); dlPaint(); } bgClear(); return; }   // выбор файла отменён
      await reloadInstances(); S.sel = r.id; saveSel(); S.shotsLoaded = false;
      if (onHome()) render();
      const skipped = r.skipped && r.skipped.length;
      taskEnd('task:create', true, skipped ? `Готово, но не скачано модов: ${r.skipped.length}` : 'Готово, можно играть');
      bgEnd('done', `Сборка «${r.name}» установлена. Окно можно закрыть и нажать «Играть».`);
      note(`Сборка «${r.name}» установлена`);
      if (skipped) {
        // часть модов авторы запретили качать сторонним лаунчерам, показываем список, чтобы скачать их вручную
        await openDlg('pack', title);
        const st = $id('lcStat'); if (st) st.textContent = `Готово: «${r.name}», файлов: ${r.files}.`;
        const bar = $id('lcBar'); if (bar) bar.value = 100;
        const box = $id('lcPackSkip');
        if (box) box.innerHTML = `<p class="filter-note"><b>Не скачано модов: ${r.skipped.length}.</b> Авторы части модов запрещают скачивание сторонними лаунчерами. Скачайте их вручную с CurseForge и положите в папку mods экземпляра («Настройки экземпляра» → «Папка модов»).</p>` +
          r.skipped.slice(0, 40).map(x => `<div class="vrow"><span class="vn">${esc(x.name || ('проект ' + x.projectId + ', файл ' + x.fileId))}</span><span class="vm">${esc(x.error)}</span></div>`).join('');
      }
    } catch (err) {
      if (isCancel(err)) {
        taskCancelled('task:create');
        bgEnd('cancel', 'Установка сборки остановлена, недоделанный экземпляр удалён.');
        note('Установка сборки отменена');
      } else {
        taskEnd('task:create', false, err.message);
        bgEnd('err', err.message);
        note(err.message);
      }
    } finally { S.packBusy = false; }
  }
  const installPackFile = () => runPack('Файл .mrpack', () => call('pack:installFile'));
  const installPack = (slug, versionId, title, cfId) => runPack(title || slug, () => call('pack:install', cfId ? { source: 'curseforge', cfId, versionId } : { slug, versionId }));

  /* ---------------- кнопка «Установить» в карточке мода ---------------- */
  const cfIdOf = m => String(m.cfId || String(m.id || '').split(':')[1] || '');
  async function decoratePack(m, body) {
    const wrap = document.createElement('div');
    wrap.id = 'lcModInstall';
    body.insertBefore(wrap, body.firstChild);
    wrap.innerHTML = `<h4>Установить сборку (${m.source === 'curseforge' ? 'CurseForge' : 'Modrinth'})</h4>
      <div class="lc-install"><select id="lcPkSel" aria-label="Версия сборки" disabled><option>Загружаю версии…</option></select>
      <button class="btn primary" id="lcPkBtn" type="button" disabled>Установить как экземпляр</button></div>
      <p class="filter-note">Будет создан новый экземпляр: нужная версия Minecraft, загрузчик, моды и настройки сборки.</p>`;
    try {
      const cf = m.source === 'curseforge';
      const vs = await call('pack:versions', cf ? { source: 'curseforge', cfId: cfIdOf(m) } : { slug: m.slug });
      if (!$id('lcPkSel')) return;
      if (!vs.length) { $id('lcPkSel').innerHTML = '<option>Нет доступных файлов сборки</option>'; return; }
      $id('lcPkSel').innerHTML = vs.map(v => `<option value="${esc(v.id)}">${esc(v.number || v.name)} · Minecraft ${esc((v.mc || []).slice(-1)[0] || '?')}${v.loaders && v.loaders.length ? ' · ' + esc(v.loaders.join('/')) : ''}${v.type !== 'release' ? ' · ' + esc(v.type) : ''}</option>`).join('');
      $id('lcPkSel').disabled = false; $id('lcPkBtn').disabled = false;
      $id('lcPkBtn').onclick = () => {
        // окно мода остаётся открытым: пользователь сам решает, когда его закрыть
        const id = $id('lcPkSel').value, btn = $id('lcPkBtn');
        btn.disabled = true; $id('lcPkSel').disabled = true;
        const msg = document.createElement('p'); msg.className = 'bg-note'; msg.id = 'lcPkNote';
        msg.innerHTML = '<b>Скачивание началось</b><span>Окно можно закрыть, установка продолжится в фоне. Прогресс виден в плашке «Загрузки» справа.</span><button class="btn danger" data-act="task-cancel" data-key="task:create" type="button">Отменить скачивание</button>';
        const w = $id('lcModInstall'); if (w && !$id('lcPkNote')) w.appendChild(msg);
        installPack(m.slug, id, m.title, cf ? cfIdOf(m) : null).finally(() => {
          const b2 = $id('lcPkBtn'), s2 = $id('lcPkSel'), n2 = $id('lcPkNote');
          if (b2) b2.disabled = false; if (s2) s2.disabled = false; if (n2) n2.remove();
        });
      };
    } catch (e) { const sel = $id('lcPkSel'); if (sel) sel.innerHTML = `<option>${esc(e.message)}</option>`; }
  }


  /* Нажали «Скачать» в списке версий: скачать как обычно или установить в экземпляр */
  async function downloadChoice({ v, m }) {
    const modal = $id('modal'); if (!modal || !v || !v.file) return;
    const old = $id('lcDlChoice'); if (old) old.remove();
    await reloadInstances();
    const ours = !!m && (m.source === 'modrinth' || m.source === 'curseforge');
    const isMod = ours && m.kind === 'mod', isPack = ours && m.kind === 'modpack';
    const usable = S.instances.filter(i => i.loader !== 'vanilla');
    const fits = i => !(v.gameList && v.gameList.length) || v.gameList.includes(i.mc);
    const ov = document.createElement('div'); ov.id = 'lcDlChoice'; ov.className = 'dlc-ov';
    ov.innerHTML = `<div class="dlc-box" role="dialog" aria-modal="true" aria-label="Способ скачивания">
      <h4>Скачать ${esc(v.name)}</h4>
      <p class="filter-note">${esc(m ? m.title : '')} · ${esc(v.game || '')}</p>
      <div class="dlc-actions">
        <button class="btn" type="button" data-dlc="normal">Скачать обычно</button>
        <button class="btn primary" type="button" data-dlc="inst" ${(isMod || isPack) ? '' : 'disabled'}>${isPack ? 'Установить как экземпляр' : 'Установить в экземпляр'}</button>
      </div>
      <div class="dlc-pick" id="lcDlcPick" hidden>
        <select id="lcDlcSel" aria-label="Экземпляр">${usable.map(i => `<option value="${esc(i.id)}">${esc(i.name)} · ${esc(i.mc)} · ${esc(LD[i.loader])}${fits(i) ? ' ✓' : ''}</option>`).join('')}</select>
        <button class="btn primary" type="button" data-dlc="go">Установить</button>
      </div>
      <p class="filter-note">${isMod ? (usable.length ? 'Файл попадёт в папку mods выбранного экземпляра. Зависимости этого мода нужно добавить самостоятельно.' : 'Нет экземпляров с загрузчиком модов, сначала создайте его на главной.') : isPack ? 'Будет создан новый экземпляр с модами этой сборки.' : 'Этот тип проекта ставится вручную, поэтому доступно только обычное скачивание.'}</p>
      <button class="btn" type="button" data-dlc="close">Отмена</button>
    </div>`;
    modal.appendChild(ov);
    const close = () => ov.remove();
    ov.addEventListener('click', async ev => {
      if (ev.target === ov) return close();
      const b = ev.target.closest('[data-dlc]'); if (!b) return;
      const act = b.dataset.dlc;
      if (act === 'close') close();
      else if (act === 'normal') { window.open(v.file, '_blank', 'noopener'); close(); }
      else if (act === 'inst') {
        if (isPack) {
          const sel = $id('lcPkSel');
          const opt = sel && [...sel.options].find(o => o.textContent.includes(v.name));
          close();
          if (!opt) { note('Эта версия сборки недоступна для установки как экземпляр'); return; }
          sel.value = opt.value; const btn = $id('lcPkBtn'); if (btn && !btn.disabled) btn.click();
        } else if (!usable.length) { close(); modal.close(); setPage('home'); setTimeout(() => openDlg('create'), 60); }
        else { $id('lcDlcPick').hidden = false; b.disabled = true; }
      } else if (act === 'go') {
        const inst = S.instances.find(i => i.id === $id('lcDlcSel').value); if (!inst) return;
        if (!fits(inst)) {
          const yes = await ask({ title: 'Версия может не подходить', text: `Этот файл сделан для Minecraft ${v.game || '?'}, а экземпляр «${inst.name}» на ${inst.mc}. Установить всё равно?`, ok: 'Установить', cancel: 'Назад' });
          if (!yes) return;
        }
        close(); saveModTarget(inst.id);
        let fname = '';
        try { fname = decodeURIComponent(new URL(v.file).pathname.split('/').pop() || ''); } catch (e) { /* имя возьмём из названия */ }
        taskStart('task:mod', `Мод «${m.title}»`, 'установка');
        note(`Скачиваю «${m.title}» ${v.name}…`);
        try {
          await call('mod:installFile', { instanceId: inst.id, url: v.file, filename: fname, title: m.title, slug: m.slug || String(m.id), version: v.name });
          taskEnd('task:mod', true, 'Готово');
          note(`«${m.title}» ${v.name} установлен в «${inst.name}»`);
          await reloadInstances(); if (onHome()) updateMeta();
          postInstallCheck(inst.id);
        } catch (err) {
          if (isCancel(err)) { taskCancelled('task:mod'); note(`Установка «${m.title}» отменена`); }
          else { taskEnd('task:mod', false, err.message); note(err.message); }
        }
      }
    });
  }

  async function decorateModal(m) {
    const body = $id('mBody');
    const old = $id('lcModInstall'); if (old) old.remove();
    const ours = m && (m.source === 'modrinth' || m.source === 'curseforge');
    if (body && desktop && ours && m.kind === 'modpack') return decoratePack(m, body);
    if (!body || !desktop || !ours || m.kind !== 'mod') return;
    const wrap = document.createElement('div');
    wrap.id = 'lcModInstall';
    body.insertBefore(wrap, body.firstChild);

    await reloadInstances();
    const usable = S.instances.filter(i => i.loader !== 'vanilla');
    if (!usable.length) {
      wrap.innerHTML = '<h4>Установить в Minecraft</h4><p class="filter-note">Нет установок с загрузчиком модов. <button type="button" class="link" id="lcMiGo">Создать установку</button></p>';
      $id('lcMiGo').onclick = () => { $id('modal').close(); setPage('home'); setTimeout(() => openDlg('create'), 60); };
      return;
    }
    const last = modTarget(usable);
    const fits = i => (m.versions || []).includes(i.mc) && (!m.loaders.length || m.loaders.includes(i.loader) || (i.loader === 'quilt' && m.loaders.includes('fabric')));
    wrap.innerHTML = `
      <h4>Установить в Minecraft</h4>
      <div class="lc-install">
        <select id="lcMiSel" aria-label="Установка">${usable.map(i =>
          `<option value="${esc(i.id)}" ${i.id === last ? 'selected' : ''}>${esc(i.name)} · ${esc(i.mc)} · ${esc(LD[i.loader])}${fits(i) ? ' ✓' : ''}</option>`).join('')}</select>
        <button class="btn primary" id="lcMiBtn" type="button">Установить</button>
      </div>
      <div class="cm-pre" id="lcModCompat"></div>
      <progress id="lcModBar" max="100" value="0" hidden style="width:100%"></progress>
      <p class="filter-note" id="lcModStat">Мод и обязательные зависимости скачаются в папку mods выбранной установки.</p>`;
    // проверка выбранного мода под выбранную установку
    let pre = [];
    const precheck = async () => {
      const sel = $id('lcMiSel'), box = $id('lcModCompat');
      if (!sel || !box) return;
      const inst = usable.find(i => i.id === sel.value);
      let installed = [];
      try { installed = await call('mod:list', sel.value); } catch (e) { /* без списка */ }
      if (!$id('lcMiSel') || $id('lcMiSel').value !== sel.value) return;
      pre = Compat.checkCards([m], { mc: inst.mc, loader: inst.loader, name: inst.name, installed }).filter(i => i.level !== 'info');
      box.innerHTML = pre.length ? compatHTML(pre, { hideInfo: true, note: false }) : '';
    };
    $id('lcMiSel').onchange = () => { saveModTarget($id('lcMiSel').value); precheck(); };
    precheck();
    $id('lcMiBtn').onclick = async () => {
      const instanceId = $id('lcMiSel').value;
      const errs = pre.filter(i => i.level === 'error');
      if (errs.length && !(await ask({ title: `«${m.title}»: найдена проблема`, text: `${errs.map(i => '• ' + i.text).join('\n')}\nВсё равно установить?`, ok: 'Всё равно установить', danger: true }))) return;
      // окно остаётся открытым: ход загрузки виден в панели справа, а здесь есть кнопка отмены
      if (S.packBusy || S.creating) { note('Другое скачивание ещё идёт, дождитесь окончания'); return; }
      const btn = $id('lcMiBtn'), selEl = $id('lcMiSel'), w = $id('lcModInstall');
      btn.disabled = true; selEl.disabled = true;
      taskStart('task:mod', `Мод «${m.title}»`, 'установка');
      const msg = document.createElement('div'); msg.className = 'bg-note'; msg.id = 'lcModNote';
      msg.innerHTML = '<b>Скачивание началось</b><p>Окно можно закрыть, установка продолжится в фоне. Прогресс виден в плашке «Загрузки» справа.</p><button class="btn danger" data-act="task-cancel" data-key="task:mod" type="button">Отменить скачивание</button>';
      if (w && !$id('lcModNote')) w.appendChild(msg);
      note(`Скачиваю «${m.title}»…`);
      try {
        const done = await call('mod:install', { instanceId, slug: m.slug, source: m.source, cfId: m.source === 'curseforge' ? cfIdOf(m) : undefined });
        taskEnd('task:mod', true, 'Готово');
        const same = done.length === 1 && done[0].cached;
        note(same ? `«${m.title}» уже установлен, файл идентичен, повторно не скачивал`
          : done.length > 1 ? `«${m.title}» установлен, зависимостей: ${done.length - 1}` : `«${m.title}» установлен`);
        await reloadInstances(); if (onHome()) updateMeta();
        postInstallCheck(instanceId);
      } catch (err) {
        if (isCancel(err)) { taskCancelled('task:mod'); note(`Установка «${m.title}» отменена`); }
        else { taskEnd('task:mod', false, err.message); note(err.message); }
      } finally {
        const b2 = $id('lcMiBtn'), s2 = $id('lcMiSel'), n2 = $id('lcModNote');
        if (b2) b2.disabled = false;
        if (s2) s2.disabled = false;
        if (n2) n2.remove();
      }
    };
  }

  /* ---------------- запуск ---------------- */
  /* статус в Discord: сообщаем, на какой странице пользователь (сам статус собирает главный процесс) */
  function presence(page) {
    if (!desktop || typeof state === 'undefined') return;
    const i = cur();
    mm.invoke('discord:page', { gv: (typeof catalog !== 'undefined' && catalog && catalog.kind === (page || state.page)) ? catalog.gv : '', page: page || state.page, inst: i ? { name: i.name, mc: i.mc, loader: i.loader, mods: i.modCount } : null, favs: typeof favorites !== 'undefined' ? favorites.size : 0 }).catch(() => {});
  }
  window.LauncherUI = { presence, _task: { taskStart, taskProgress, taskEnd }, render, decorateModal, downloadChoice, isDesktop: desktop, installPackFile, installMany };

  let started = false;
  async function init() {
    if (started) return; started = true;
    if (desktop) {
      wireEvents(); await loadState();
      call('app:info').then(i => { const v = $id('tbVer'); if (v && i && i.version) v.textContent = 'v' + i.version; }).catch(() => {});   // версия всегда из package.json
    }
    renderAccount();
    if (desktop && onHome()) render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
