/* ============================================================
   MatrixL: свой фон (картинка, GIF, видео).
   Всё хранится на стороне приложения (src/appmedia.js), здесь только показ и карточка в «Настройках».
   ============================================================ */
(function () {
  'use strict';
  const mm = window.mm;
  if (!mm) return;   // в обычном браузере (сайт) своего фона нет

  const $ = id => document.getElementById(id);
  const say = m => { try { if (typeof toast === 'function') toast(m); } catch (e) { /* уведомление не критично */ } };
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const call = (ch, arg) => mm.invoke(ch, arg).then(r => { if (!r.ok) throw new Error(r.error); return r.data; });

  const S = { view: null, gameOn: false, video: null };

  /* ---------------- фон ---------------- */
  function paintBgOpts() {
    const box = $('appBg');
    if (!box || !S.view) return;
    box.style.setProperty('--bg-dim', String(S.view.dim / 100));
    box.style.setProperty('--bg-blur', S.view.blur + 'px');
  }
  function applyBg() {
    const box = $('appBg');
    if (!box) return;
    const bg = S.view && S.view.bg;
    box.textContent = '';
    S.video = null;
    document.documentElement.classList.toggle('has-bg', !!bg);
    if (bg) {
      let el;
      if (bg.kind === 'video') {
        el = document.createElement('video');
        el.loop = true; el.autoplay = true; el.playsInline = true; el.disablePictureInPicture = true;
        S.video = el;
      } else el = document.createElement('img');
      el.className = 'app-bg-media';
      el.alt = '';
      // файл не открылся (например, видео в неподдерживаемом кодеке): возвращаем обычный фон с квадратами
      el.addEventListener('error', () => {
        document.documentElement.classList.remove('has-bg');
        if (bg.kind === 'video' && !S.converting && bg.url !== S.converted) convertVideo(bg.url);
        else say('Не удалось показать фон. Подойдут PNG, JPG, WEBP, GIF, а для видео MP4 или WEBM');
      }, { once: true });
      el.src = bg.url;
      box.appendChild(el);
      const shade = document.createElement('div');
      shade.className = 'app-bg-shade';
      box.appendChild(shade);
      paintBgOpts();
      videoVolume();
      if (S.video && !S.gameOn && !document.hidden) startVideo();
    }
    paintCard();
  }
  // видео в кодеке, который окно не проигрывает (H.265, 10 бит): один раз перекодируем в H.264 и ставим снова
  async function convertVideo(url) {
    S.converting = true;
    const prev = $('bgPrev'), bar = $('bgPick'), clr = $('bgClear');
    if (bar) bar.disabled = true;
    if (clr) clr.disabled = true;
    if (prev) prev.innerHTML = '<span class="bg-prev-name">Готовлю видео для фона…</span><span class="bg-prev-kind">Это займёт до пары минут</span>';
    say('Видео в формате, который не проигрывается напрямую. Конвертирую в MP4 (H.264), это займёт до пары минут');
    try {
      const r = await call('appmedia:convertBg');
      if (S.view && S.view.bg && S.view.bg.url !== url) return;   // за это время фон уже сменили
      S.view = r; S.converting = false; S.converted = r.bg && r.bg.url; applyBg(); say('Фон готов');
    } catch (e) { S.converting = false; say(e.message); paintCard(); }
    finally { S.converting = false; if (bar) bar.disabled = false; paintCard(); }
  }
  // пока игра запущена или окно спрятано, видео на фоне стоит: зря грузить процессор незачем
  function syncVideo() {
    const v = S.video;
    if (!v) return;
    if (document.hidden || S.gameOn) v.pause(); else startVideo();
  }
  // звук видео: ползунок в настройках (0 = без звука); квадрат, чтобы ползунок ощущался ровнее
  function videoVolume() {
    const v = S.video;
    if (!v || !S.view) return;
    const k = S.view.videoVolume / 100;
    v.volume = k * k; v.muted = k === 0;
  }
  // если звук без нажатия не разрешён, видео идёт без звука, а со звуком включается с первого клика
  function startVideo() {
    const v = S.video;
    if (!v) return;
    v.play().catch(() => {
      v.muted = true;
      v.play().catch(() => { /* останется первый кадр */ });
      const go = () => { removeEventListener('pointerdown', go, true); removeEventListener('keydown', go, true); if (S.video === v) { videoVolume(); v.play().catch(() => {}); } };
      addEventListener('pointerdown', go, true); addEventListener('keydown', go, true);
    });
  }

  // игра запущена: видео на фоне останавливается, после закрытия игры продолжается
  mm.on('game-window', () => { S.gameOn = true; syncVideo(); });
  mm.on('game-exit', () => { S.gameOn = false; syncVideo(); });
  document.addEventListener('visibilitychange', syncVideo);

  /* ---------------- карточки в «Настройках» ---------------- */
  function cardHTML() {
    return `
      <div class="setting-card" id="stBg">
        <h3>Фон лаунчера</h3>
        <p>PNG, JPG, WEBP, GIF до 40 МБ, MP4 и WEBM до 250 МБ.</p>
        <div class="bg-prev" id="bgPrev"></div>
        <div class="upd-actions">
          <button type="button" class="btn" id="bgPick">Выбрать файл…</button>
          <button type="button" class="btn" id="bgClear">Сбросить фон</button>
        </div>
        <div class="mm-sliders" id="bgSliders">
          <label class="mm-row"><span>Затемнение</span><input type="range" id="bgDim" min="0" max="90" step="1"><output id="bgDimV"></output></label>
          <label class="mm-row" id="bgVolRow"><span>Звук видео</span><input type="range" id="bgVol" min="0" max="100" step="1"><output id="bgVolV"></output></label>
          <label class="mm-row"><span>Размытие</span><input type="range" id="bgBlur" min="0" max="24" step="1"><output id="bgBlurV"></output></label>
        </div>
      </div>`;
  }
  function paintCard() {
    const v = S.view;
    if (!v || !$('stBg')) return;
    const bg = v.bg;
    $('bgPrev').innerHTML = S.converting
      ? '<span class="bg-prev-name">Готовлю видео для фона…</span><span class="bg-prev-kind">Это займёт до пары минут</span>'
      : bg
      ? `<span class="bg-prev-name">${esc(bg.name)}</span><span class="bg-prev-kind">${bg.kind === 'video' ? 'Видео' : 'Картинка'}</span>`
      : `<span class="bg-prev-name">Стандартный фон</span>`;
    $('bgClear').disabled = !bg;
    $('bgSliders').hidden = !bg;
    $('bgDim').value = v.dim; $('bgDimV').textContent = v.dim + '%';
    $('bgVolRow').hidden = !(bg && bg.kind === 'video');
    $('bgVol').value = v.videoVolume; $('bgVolV').textContent = v.videoVolume + '%';
    $('bgBlur').value = v.blur; $('bgBlurV').textContent = v.blur + ' px';
  }
  async function save(patch) {
    try { S.view = await call('appmedia:options', patch); } catch (e) { say(e.message); }
    videoVolume(); paintBgOpts(); paintCard();
  }
  function bind() {
    if (!$('stBg')) return;
    paintCard();
    $('bgPick').addEventListener('click', async () => {
      const b = $('bgPick'); b.disabled = true;
      try { const r = await call('appmedia:pickBg'); if (r) { S.view = r; applyBg(); say('Фон поставлен'); } }
      catch (e) { say(e.message); }
      finally { b.disabled = false; }
    });
    $('bgClear').addEventListener('click', async () => {
      try { S.view = await call('appmedia:clearBg'); applyBg(); say('Фон сброшен'); } catch (e) { say(e.message); }
    });
    // ползунки: картинка меняется сразу, сохраняется, когда отпустили
    $('bgDim').addEventListener('input', e => { S.view.dim = +e.target.value; $('bgDimV').textContent = S.view.dim + '%'; paintBgOpts(); });
    $('bgDim').addEventListener('change', e => save({ dim: +e.target.value }));
    $('bgVol').addEventListener('input', e => { S.view.videoVolume = +e.target.value; $('bgVolV').textContent = S.view.videoVolume + '%'; videoVolume(); });
    $('bgVol').addEventListener('change', e => save({ videoVolume: +e.target.value }));
    $('bgBlur').addEventListener('input', e => { S.view.blur = +e.target.value; $('bgBlurV').textContent = S.view.blur + ' px'; paintBgOpts(); });
    $('bgBlur').addEventListener('change', e => save({ blur: +e.target.value }));
  }

  async function init() {
    try { S.view = await call('appmedia:get'); } catch (e) { return; }
    applyBg();
  }
  window.AppBg = { cardHTML, bind, _s: S };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
