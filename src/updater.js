'use strict';
/* ============================================================
   Обновление лаунчера через GitHub Releases.
   • проверка: последний релиз репозитория из package.json (поле repository, по умолчанию KaRpo1771/MatrixLauncher);
   • установка: скачивается MatrixL-Setup-*.exe, проверяется размер и SHA-256 (если GitHub его отдал).
     Лаунчер закрывается, а установщик (запущенный как у electron-updater: --updated /S --force-run /D=папка)
     сам дожидается его выхода, тихо ставит обновление и открывает уже новую версию;
   • если после перезапуска версия не поменялась, лаунчер сообщает об этом (подробности в update.log);
   • портативная версия (MatrixL-portable.exe) сама себя заменить не может,
     для неё открывается страница релиза.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');

const UA = 'MatrixL-Updater';
const MB = 1024 * 1024;

function repoFromPackage() {
  try {
    const pkg = require('../package.json');
    let r = pkg.repository;
    if (r && typeof r === 'object') r = r.url;
    const m = String(r || '').match(/(?:github(?:\.com)?[:/])?([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
    return m ? { owner: m[1], name: m[2] } : null;
  } catch { return null; }
}
/* Если в package.json поля repository нет, обновления всё равно берутся из основного репозитория проекта */
const REPO = repoFromPackage() || { owner: 'KaRpo1771', name: 'MatrixLauncher' };

const parseVer = v => { const m = String(v || '').match(/(\d+)\.(\d+)\.(\d+)/); return m ? [+m[1], +m[2], +m[3]] : null; };
function isNewer(a, b) {   // a новее b?
  const x = parseVer(a), y = parseVer(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

let hooks = { current: () => '0.0.0', emit: () => {}, canRestart: () => null, quit: () => {}, dataDir: '' };
const st = { phase: 'idle', current: '', latest: '', notes: '', url: '', canInstall: false, pct: 0, error: '' };
let asset = null, busy = false, abortCtl = null, failedFor = '', failedWhy = '';

function set(patch) { Object.assign(st, patch); hooks.emit({ ...st }); }
const view = () => ({ ...st });

async function api(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' } });
  if (r.status === 404) throw new Error('На GitHub пока нет ни одного релиза');
  if (r.status === 403 || r.status === 429) throw new Error('GitHub временно ограничил запросы, попробуйте через несколько минут');
  if (!r.ok) throw new Error('GitHub вернул ошибку ' + r.status);
  return r.json();
}

/* Проверка: тихая (при запуске) ничего не показывает об ошибках сети */
async function check({ silent = false } = {}) {
  if (busy || st.phase === 'downloading' || st.phase === 'installing') return view();
  const current = hooks.current();
  if (!REPO) {
    set({ phase: 'error', current, error: 'Не указан репозиторий обновлений (поле repository в package.json)' });
    return view();
  }
  busy = true;
  set({ phase: 'checking', current, error: '' });
  try {
    const rel = await api(`https://api.github.com/repos/${REPO.owner}/${REPO.name}/releases/latest`);
    const latest = String(rel.tag_name || '').replace(/^v/i, '');
    if (!parseVer(latest)) throw new Error('Не удалось разобрать версию релиза «' + rel.tag_name + '»');
    const portable = !!process.env.PORTABLE_EXECUTABLE_FILE;
    asset = (rel.assets || []).find(a => /^MatrixL-Setup-.*\.exe$/i.test(a.name)) || null;
    if (!isNewer(latest, current)) { set({ phase: 'uptodate', latest, notes: '', url: rel.html_url || '', canInstall: false }); return view(); }
    // прошлая попытка поставить эту версию не удалась: тихую установку не повторяем, предлагаем скачать вручную
    const failed = failedFor && failedFor === latest;
    set({
      phase: 'available', latest, url: rel.html_url || '', notes: String(rel.body || '').slice(0, 2000),
      canInstall: process.platform === 'win32' && !portable && !!asset && !failed,
      error: failed ? 'Установка не удалась, скачайте новую версию вручную.' + (failedWhy ? ' Журнал: ' + failedWhy : '') + ' (файл update.log)' : ''
    });
  } catch (e) {
    if (silent) set({ phase: 'idle', error: '' }); else set({ phase: 'error', error: e.message });
  } finally { busy = false; }
  return view();
}

async function download(a, dest, signal) {
  const base = `https://github.com/${REPO.owner}/${REPO.name}/releases/download/`;
  if (!String(a.browser_download_url).startsWith(base)) throw new Error('Файл обновления размещён на неизвестном сервере');
  const r = await fetch(a.browser_download_url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal });
  if (!r.ok || !r.body) throw new Error('Не удалось скачать обновление (' + r.status + ')');
  const total = Number(r.headers.get('content-length')) || a.size || 0;
  if (total > 400 * MB) throw new Error('Файл обновления слишком большой');
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(dest);
  let got = 0, last = Date.now(), lastPct = -1;
  const src = Readable.fromWeb(r.body);
  const onAbort = () => { const e = new Error('Загрузка отменена'); e.cancelled = true; src.destroy(e); out.destroy(); };
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  const stall = setInterval(() => { if (Date.now() - last > 30000) src.destroy(new Error('Загрузка зависла: 30 секунд нет данных')); }, 5000);
  try {
    await new Promise((ok, no) => {
      src.on('data', c => {
        got += c.length; last = Date.now(); hash.update(c);
        if (got > 400 * MB) src.destroy(new Error('Файл обновления слишком большой'));
        const pct = total ? Math.min(99, Math.floor(got / total * 100)) : 0;
        if (pct !== lastPct) { lastPct = pct; set({ pct }); }
      });
      src.on('error', no); out.on('error', no); out.on('finish', ok);
      src.pipe(out);
    });
  } finally { clearInterval(stall); if (signal) signal.removeEventListener('abort', onAbort); }
  if (a.size && got !== a.size) throw new Error('Файл скачан не полностью, попробуйте ещё раз');
  const want = String(a.digest || '').replace(/^sha256:/i, '').toLowerCase();
  if (want && hash.digest('hex') !== want) throw new Error('Контрольная сумма обновления не совпала');
}

const TMP_DIR = path.join(os.tmpdir(), 'matrixl-update');

const pendingFile = () => hooks.dataDir ? path.join(hooks.dataDir, 'update-pending.json') : '';
const logFile = () => hooks.dataDir ? path.join(hooks.dataDir, 'update.log') : path.join(TMP_DIR, 'update.log');

/* Запуск установщика отдельным процессом без PowerShell и скриптов (скрытый powershell -ExecutionPolicy Bypass часто
   блокируют антивирусы и политики, и тогда установщик не запускался вовсе, а лаунчер не открывался).
   Как и у electron-updater, установщик получает «--updated /S --force-run /D=папка»: он сам дожидается выхода лаунчера,
   тихо заменяет файлы и запускает новую версию. Короткая цепочка cmd.exe только пишет код завершения в update.log
   и открывает лаунчер ещё раз (второй экземпляр сразу закроется, если новая версия уже запущена установщиком),
   так что при любом исходе лаунчер не остаётся закрытым. */
function launchInstaller(dir, file, target) {
  const log = logFile();
  const note = m => { try { fs.appendFileSync(log, `${new Date().toISOString()} ${m}\n`, 'utf8'); } catch { /* не критично */ } };
  fs.writeFileSync(log, `${new Date().toISOString()} update ${hooks.current()} -> ${target}\n`, 'utf8');
  if (pendingFile()) fs.writeFileSync(pendingFile(), JSON.stringify({ from: hooks.current(), target }), 'utf8');
  const exe = process.execPath, installDir = path.dirname(exe);
  let size = -1; try { size = fs.statSync(file).size; } catch { /* нет файла */ }
  note(`exe ${exe}, installer ${file} (${size} bytes), install dir ${installDir}`);
  const q = x => `"${x}"`;
  const iargs = ['--updated', '/S', '--force-run', `/D=${installDir}`].join(' ');
  // «!» и «%» в путях ломают отложенное раскрытие переменных cmd, тогда код завершения не пишем
  const canLog = ![file, exe, log].some(x => /[!%^]/.test(x));
  const chain = [
    `start "" /wait ${q(file)} ${iargs}`,
    canLog ? `echo %date% %time% installer exit code: !errorlevel!>>${q(log)}` : '',
    `start "" ${q(exe)}`
  ].filter(Boolean).join(' & ');
  const direct = () => {
    try { const c = spawn(file, ['--updated', '--force-run'], { detached: true, stdio: 'ignore' }); c.on('error', () => {}); c.unref(); } catch (e2) { note('installer failed: ' + e2.message); }
  };
  return new Promise(resolve => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    let child;
    try {
      child = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/v:on', '/s', '/c', `"${chain}"`],
        { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, cwd: dir });
    } catch (e) { note('cmd failed: ' + e.message + '; opening the installer window'); direct(); fin(); return; }
    child.once('spawn', () => { child.unref(); note('installer chain started, pid ' + child.pid); fin(); });
    child.once('error', e => { note('cmd failed: ' + e.message + '; opening the installer window'); direct(); fin(); });
    setTimeout(fin, 3000);
  });
}

/* После запуска: если обновление было заказано, а версия не выросла, установка не удалась; если выросла, чистим следы */
function checkPending() {
  const pf = pendingFile(); if (!pf) return;
  let p = null;
  try { p = JSON.parse(fs.readFileSync(pf, 'utf8')); } catch { /* обновления не было */ }
  try { fs.rmSync(pf, { force: true }); } catch { /* не критично */ }
  if (!p) return;
  const cur = hooks.current();
  if (isNewer(p.target, cur)) {   // версия не поменялась
    failedFor = String(p.target);
    try {
      const lines = fs.readFileSync(logFile(), 'utf8').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
      failedWhy = (lines[lines.length - 1] || '').replace(/^\d{4}-\d\d-\d\dT[\d:.Z-]+\s*/, '').slice(0, 160);
    } catch { failedWhy = ''; }
  }
  else { try { fs.rmSync(logFile(), { force: true }); } catch { /* не критично */ } }
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* не критично */ }
}

/* Скачать, запустить установщик и закрыть лаунчер */
async function install() {
  if (busy || st.phase === 'downloading' || st.phase === 'installing') return view();
  const block = hooks.canRestart();
  if (block) throw new Error(block);
  if (st.phase !== 'available' || !st.canInstall || !asset) throw new Error('Обновление недоступно для установки из лаунчера');
  busy = true;
  const dir = TMP_DIR;
  const file = path.join(dir, path.basename(asset.name));
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    abortCtl = new AbortController();
    set({ phase: 'downloading', pct: 0, error: '' });
    await download(asset, file, abortCtl.signal);
    if (abortCtl.signal.aborted) { const e = new Error('Загрузка отменена'); e.cancelled = true; throw e; }
    set({ phase: 'installing', pct: 100 });
    await launchInstaller(dir, file, st.latest);
    setTimeout(() => hooks.quit(), 800);
  } catch (e) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* не критично */ }
    const cancelled = !!(e && e.cancelled) || (abortCtl && abortCtl.signal.aborted) || e.name === 'AbortError';
    // отмена — это не ошибка: баннер возвращается к «Доступна версия…» и обновление можно запустить заново
    set({ phase: 'available', pct: 0, error: cancelled ? '' : e.message });
    if (!cancelled) throw e;
  } finally { busy = false; abortCtl = null; }
  return view();
}

/* Отменить скачивание обновления (после запуска установщика отменить уже нельзя) */
function cancel() {
  if (st.phase === 'downloading' && abortCtl) abortCtl.abort();
  return view();
}

function init(h) { hooks = { ...hooks, ...h }; st.current = hooks.current(); checkPending(); }

module.exports = { init, check, install, cancel, state: view, _t: { isNewer, parseVer, repoFromPackage } };
