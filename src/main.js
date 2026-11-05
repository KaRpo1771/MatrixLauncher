'use strict';
const { app, BrowserWindow, ipcMain, shell, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const core = require('./core');
const accounts = require('./accounts');
const updater = require('./updater');
const { LaunchLog } = require('./crashlog');
const activity = require('./activity');
const worldinfo = require('./worldinfo');
let CURSEFORGE_KEY = process.env.CURSEFORGE_API_KEY || '';
try { CURSEFORGE_KEY = require('./curseforge-key') || CURSEFORGE_KEY; } catch { /* файла нет (чистый клон репозитория): CurseForge будет отключён */ }
let DISCORD_APP_ID = process.env.DISCORD_APP_ID || '';
try { DISCORD_APP_ID = require('./discord-app') || DISCORD_APP_ID; } catch {}
const { DiscordPresence } = require('./discord');

// название продукта сменилось на MatrixL, данные (аккаунты, экземпляры) остаются в прежней папке
app.setPath('userData', path.join(app.getPath('appData'), 'ModMatrix'));

if (!app.requestSingleInstanceLock()) { app.quit(); }

let win = null;
const busy = new Set(); // установки, с которыми сейчас идёт работа

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; }
    catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
  });
}

/* ---------- статус в Discord ----------
   Приоритет: игра запущена → идёт долгая задача (установка) → страница, на которой пользователь. */
const rpc = new DiscordPresence();
const startedAt = Date.now();
const LD_NAME = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
/* Первая строка: что делает пользователь. Вторая: полезная подробность или ничего (пустую строку Discord не показывает). */
const PAGE_TITLE = {
  home: 'Главная', mods: 'Каталог модов', plugins: 'Каталог плагинов',
  modpacks: 'Каталог сборок', favorites: 'Избранное', settings: 'Настройки'
};
const presence = { page: 'home', inst: null, favs: 0, gv: '', tasks: new Map(), playing: new Map() };
const CATALOG_PAGES = new Set(['mods', 'plugins', 'modpacks']);
const plural = (n, one, few, many) => { const m = n % 100, d = n % 10; return (m > 10 && m < 15) ? many : d === 1 ? one : (d >= 2 && d <= 4) ? few : many; };
function instLine(i) {
  if (!i) return undefined;
  return `${i.name} · ${i.mc}${i.loader && i.loader !== 'vanilla' ? ' ' + (LD_NAME[i.loader] || i.loader) : ''}`;
}
function applyPresence() {
  if (presence.playing.size) {
    const g = [...presence.playing.values()].pop();
    const o = activity.resolveOpts(accounts.getSettings());
    const d = g.live ? activity.describe(g.live, g.inst, o) : { details: `Играет в Minecraft ${g.mc}`, state: g.state };
    rpc.set({ details: d.details, state: d.state || g.state, start: o.showTimer ? g.start : 0, largeText: d.largeText });
  } else if (presence.tasks.size) {
    rpc.set({ details: [...presence.tasks.values()].pop(), state: instLine(presence.inst), start: activity.resolveOpts(accounts.getSettings()).showTimer ? startedAt : 0 });
  } else if (!activity.resolveOpts(accounts.getSettings()).showLauncher) {
    rpc.set({ details: 'В лаунчере MatrixL', start: activity.resolveOpts(accounts.getSettings()).showTimer ? startedAt : 0 });
  } else {
    let details = PAGE_TITLE[presence.page] || PAGE_TITLE.home;
    let state;
    // каталоги: одна строка «Каталог модов | 1.12.2», версия видна только если выбрана в фильтре
    if (CATALOG_PAGES.has(presence.page)) { if (presence.gv) details += ` | ${presence.gv}`; }
    else if (presence.page === 'home') state = instLine(presence.inst);
    else if (presence.page === 'favorites' && presence.favs) state = `${presence.favs} ${plural(presence.favs, 'карточка', 'карточки', 'карточек')} в избранном`;
    rpc.set({ details, state, start: activity.resolveOpts(accounts.getSettings()).showTimer ? startedAt : 0 });
  }
}
let taskSeq = 0;
function withTask(text, fn) {
  const k = ++taskSeq; presence.tasks.set(k, text); applyPresence();
  const done = () => { presence.tasks.delete(k); applyPresence(); };
  return Promise.resolve().then(fn).finally(done);
}
function configureDiscord() {
  const st = accounts.getSettings();
  rpc.configure({ clientId: DISCORD_APP_ID, enabled: st.discordEnabled !== false });
  applyPresence();
}

/* ---------- сворачивание лаунчера на время игры ----------
   После появления окна Minecraft лаунчер прячется (и пропадает с панели задач) и остаётся скрытым,
   пока игра не закроется полностью (сворачивание окна игры его не возвращает). Работает только на Windows: там есть слежение за окном игры. */
const gameMin = new Map();   // id установки → окно игры свёрнуто
let hiddenByGame = false;
let lastCrash = null;   // последний отчёт о падении игры (для кнопки «Показать файл»)
function hideOnLaunchOn() { return process.platform === 'win32' && !!accounts.getSettings().hideOnLaunch; }
function hideLauncher() {
  if (!win || win.isDestroyed() || hiddenByGame) return;
  hiddenByGame = true; win.setSkipTaskbar(true); win.hide();
}
function showLauncher(focus) {
  if (!win || win.isDestroyed()) return;
  hiddenByGame = false;
  win.setSkipTaskbar(false);
  if (win.isMinimized()) win.restore();
  win.show();
  if (focus) win.focus();
}

function lock(id) {
  if (busy.has(id)) throw new Error('С этой установкой уже идёт операция, дождитесь окончания');
  busy.add(id);
  return () => busy.delete(id);
}

function registerIpc() {
  /* --- игровые аккаунты Minecraft (регистрации в лаунчере нет) --- */
  handle('mc:list', () => accounts.list());
  handle('mc:addOffline', name => accounts.addOffline(name));
  handle('mc:ely', a => accounts.elyLogin(a));
  handle('mc:select', id => { const r = accounts.select(id); accounts.prewarmSkin(); return r; });
  handle('mc:remove', id => accounts.remove(id));
  handle('mc:msStart', async () => {
    const { info, wait } = await accounts.msStart();
    shell.openExternal(info.url);
    wait().then(list => send('ms-result', { ok: true, list }))
          .catch(err => send('ms-result', { ok: false, error: err.message }));
    return { started: true };
  });
  handle('mc:msCancel', () => { accounts.msCancel(); return true; });

  /* --- скин и плащ выбранного аккаунта --- */
  handle('skin:head', id => accounts.skinHead(String(id || '')));
  handle('skin:profile', id => accounts.skinProfile(String(id || '')));
  handle('skin:cached', id => accounts.skinCached(String(id || '')));
  handle('skin:upload', async ({ id, variant } = {}) => {
    const r = await dialog.showOpenDialog(win, { title: 'Скин Minecraft', properties: ['openFile'], filters: [{ name: 'Картинки', extensions: ['png'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    const file = r.filePaths[0];
    if (fs.statSync(file).size > 256 * 1024) throw new Error('Файл скина слишком большой');
    return accounts.skinUpload(String(id || ''), fs.readFileSync(file), variant === 'slim' ? 'slim' : 'classic');
  });
  handle('skin:reset', id => accounts.skinReset(String(id || '')));
  handle('skin:cape', ({ id, capeId } = {}) => accounts.capeSet(String(id || ''), capeId ? String(capeId) : null));

  /* --- своя шапка окна: «свернуть», «развернуть» и «закрыть» --- */
  handle('win:toggle', () => { if (!win) return false; if (win.isMaximized()) win.unmaximize(); else win.maximize(); return win.isMaximized(); });
  handle('win:state', () => !!win && win.isMaximized());
  handle('win:close', () => { if (win) win.close(); });
  handle('win:minimize', () => { if (win) win.minimize(); });

  /* --- настройки и сведения о компьютере --- */
  /* предпросмотр статуса для окна расширенных настроек: два примера (одиночная игра и сервер) с текущими опциями */
  handle('discord:preview', () => {
    const o = activity.resolveOpts(accounts.getSettings());
    const inst = { name: 'Мой экземпляр', mc: '1.20.1', loader: 'fabric' };
    const world = { name: 'Новый мир', gamemode: 0, hardcore: false, dim: 'overworld', pos: [120, 28, -64], biome: 'minecraft:dripstone_caves', held: 'iron_pickaxe', health: 20, dayTime: 15000, raining: false, thundering: false, elytra: false, riding: false };
    const ev = { text: 'Получил достижение «Каменный век»', until: Date.now() + 1e5 };
    return {
      single: activity.describe({ mode: 'single', world, afk: false }, inst, o),
      afk: activity.describe({ mode: 'single', world, afk: true }, inst, o),
      event: activity.describe({ mode: 'single', world, afk: false, event: ev }, inst, o),
      server: activity.describe({ mode: 'server', host: 'mc.example.net', afk: false }, inst, o),
      timer: o.showTimer
    };
  });
  handle('settings:get', () => ({ ...accounts.publicSettings(), discordBuiltIn: !!DISCORD_APP_ID, discordConnected: rpc.active }));
  handle('settings:set', patch => {
    const r = accounts.setSettings(patch || {});
    if (patch && ('discordEnabled' in patch || 'discordHideServer' in patch || 'discordOpts' in patch)) configureDiscord();
    return { ...r, discordBuiltIn: !!DISCORD_APP_ID, discordConnected: rpc.active };
  });
  // интерфейс сообщает, на какой странице пользователь
  handle('discord:page', ({ page, inst, favs, gv } = {}) => {
    presence.gv = gv ? String(gv).slice(0, 20) : '';
    presence.page = PAGE_TITLE[page] ? page : 'home';
    presence.inst = inst && inst.name ? { name: String(inst.name).slice(0, 40), mc: String(inst.mc || ''), loader: String(inst.loader || '') } : null;
    presence.favs = Number(favs) || 0;
    applyPresence();
  });
  /* --- обновление лаунчера через GitHub --- */
  handle('update:state', () => updater.state());
  handle('update:check', () => updater.check());
  handle('update:install', () => updater.install());
  handle('update:cancel', () => updater.cancel());
  /* --- Java --- */
  handle('java:status', () => core.javaStatus());
  handle('java:update', async () => {
    const release = lock('java');
    try {
      return await withTask('Обновляет Java', () => core.startJob(() => core.javaUpdate(
        (text, pct) => send('progress', { key: 'java', text, pct }))));
    } finally { release(); }
  });
  handle('sys:info', () => core.sysInfo());
  handle('app:info', () => ({ version: app.getVersion(), dataDir: core.DIRS.root, platform: process.platform }));

  /* --- версии и установки --- */
  handle('ver:list', () => core.listVersions());
  handle('inst:list', () => core.listInstancesLive());
  handle('inst:create', async opts => {
    const key = 'create';
    const release = lock(key);
    try {
      return await withTask('Устанавливает Minecraft', () => core.startJob(() => core.createInstance(opts || {},
        (text, pct) => send('progress', { key, text, pct }),
        line => send('progress', { key, text: line, pct: null, log: true }))));
    } finally { release(); }
  });
  handle('inst:delete', async id => {
    const release = lock(id);
    try { await core.deleteInstance(id); } finally { release(); }
  });
  // отмена текущего скачивания версии или установки сборки (мод-установки не затрагивает)
  handle('task:cancel', key => core.cancelJob(key === 'mod' ? 'mod' : 'create'));
  handle('loader:options', mc => core.loaderOptions(mc));
  handle('inst:setLoader', async ({ id, loader, loaderVersion }) => {
    const release = lock(id);
    try {
      return await core.changeLoader(id, { loader, loaderVersion },
        (text, pct) => send('progress', { key: 'create', text, pct }),
        line => send('progress', { key: 'create', text: line, pct: null, log: true }));
    } finally { release(); }
  });
  handle('inst:update', ({ id, ...patch }) => core.updateInstance(id, patch));
  handle('inst:pickIcon', async id => {
    core.getInstance(id);
    const r = await dialog.showOpenDialog(win, { title: 'Аватарка экземпляра', properties: ['openFile'],
      filters: [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    return core.setIconFile(id, r.filePaths[0]);
  });
  handle('inst:clearIcon', id => core.clearIcon(id));
  handle('inst:launch', async id => {
    const inst = core.getInstance(id);
    if (busy.has('java')) throw new Error('Идёт обновление Java, дождитесь окончания');
    const release = lock(id);
    try {
      const account = await accounts.accountForLaunch();
      const llog = new LaunchLog({ gameDir: core.instDir(id), info: { launcher: 'v' + app.getVersion(), name: inst.name, mc: inst.mc, loader: inst.loader, loaderVersion: inst.loaderVersion } });
      let exited = false;
      const live = { mode: 'menu', host: '', world: null, afk: false, titleMode: null };
      const startedAtMs = Date.now();
      const refresh = () => { const e = presence.playing.get(id); if (e) applyPresence(); };
      // название, режим, измерение и биом читаются из файлов мира, пока игрок в одиночной игре
      const poll = setInterval(() => {
        if (live.mode !== 'single') return;
        const w = worldinfo.read(core.instDir(id), startedAtMs);
        if (w && JSON.stringify(w) !== JSON.stringify(live.world)) { live.world = w; refresh(); }
      }, 15000);
      if (poll.unref) poll.unref();
      const res = await core.launch(inst, account,
        (text, pct) => send('progress', { key: 'launch:' + id, text, pct }),
        line => { llog.push(line); send('game-log', { id, line }); if (activity.parseLogLine(line, live, account.name)) { refresh(); if (live.event) { const t = setTimeout(refresh, live.event.until - Date.now() + 500); if (t.unref) t.unref(); } } },
        code => {
          if (exited) return; exited = true; clearInterval(poll);
          presence.playing.delete(id); gameMin.delete(id); applyPresence();
          let crash = null;
          try { crash = llog.finish(code); } catch { /* журнал не должен мешать закрытию */ }
          if (crash) lastCrash = { ...crash, id };
          send('game-exit', { id, code });
          // игра упала: лаунчер возвращается из скрытого режима, и сразу показывается окно с отчётом
          if (hiddenByGame && !presence.playing.size) showLauncher(true);
          if (crash) {
            if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
            send('game-crash', { id, name: inst.name, mc: inst.mc, loader: inst.loader, code, text: crash.text, summary: crash.summary, hasFile: !!(crash.crashFile || crash.logFile) });
          }
        },
        () => { send('game-window', { id }); if (hideOnLaunchOn()) { gameMin.set(id, false); hideLauncher(); } },   // окно Minecraft появилось
        null,
        w => {   // заголовок окна и бездействие игрока (только Windows)
          if ('afk' in w) live.afk = !!w.afk;
          if ('title' in w) {
            const m = activity.modeFromTitle(w.title);
            if (m) live.titleMode = true;   // эта версия показывает режим в заголовке окна, ему можно верить
            if (m && m !== live.mode) { live.mode = m; if (m === 'single') live.host = ''; else live.world = null; }
            else if (!m && live.titleMode && live.mode !== 'menu' && /^Minecraft/i.test(w.title)) { live.mode = 'menu'; live.host = ''; live.world = null; }
          }
          refresh();
        }).catch(e => { clearInterval(poll); try { llog.finish(0); } catch { /* не критично */ } throw e; });   // при включённом «скрывать при запуске» лаунчер остаётся скрытым, пока игра не закроется полностью
      // в профиле Discord: во что играет и сколько
      const liveInst = core.listInstancesLive().find(x => x.id === id) || inst;
      presence.playing.set(id, { name: inst.name, mc: inst.mc, start: Date.now(), live, inst: { name: inst.name, mc: inst.mc, loader: inst.loader },
        state: `${inst.name} · ${LD_NAME[inst.loader] || inst.loader}${liveInst.modCount ? ` · ${liveInst.modCount} ${plural(liveInst.modCount, 'мод', 'мода', 'модов')}` : ''}` });
      applyPresence();
      send('progress', { key: 'launch:' + id, text: 'Запуск игры…', pct: 1 });
      return res;
    } finally { release(); }
  });
  /* показать в проводнике файл отчёта (или журнала) последнего падения: путь берётся только из памяти, не из окна */
  handle('crash:reveal', () => {
    const f = lastCrash && (lastCrash.crashFile || lastCrash.logFile);
    if (!f || !fs.existsSync(f)) throw new Error('Файл отчёта не найден');
    shell.showItemInFolder(f);
  });
  handle('inst:folder', async arg => {
    const { id, sub } = typeof arg === 'string' ? { id: arg } : (arg || {});
    core.getInstance(id);
    const dir = sub === 'screenshots' || sub === 'mods' ? path.join(core.instDir(id), sub) : core.instDir(id);
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
  });
  // фон главной: только скриншоты (или своя картинка) этого экземпляра; без экземпляра, пусто
  handle('inst:screens', id => (id ? core.backgroundFor(id) : []));
  handle('inst:pickBg', async id => {
    core.getInstance(id);
    const r = await dialog.showOpenDialog(win, { title: 'Свой фон для экземпляра', properties: ['openFile'],
      filters: [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    return core.setBgFile(id, r.filePaths[0]);
  });
  handle('inst:clearBg', id => core.clearBg(id));

  /* --- CurseForge: запросы идут только из главного процесса (ключ встроен, в интерфейс не попадает) --- */
  handle('cf:search', p => core.cfSearch(p || {}));
  handle('cf:categories', kind => core.cfCategories(kind));
  handle('cf:details', id => core.cfDetails(id));
  handle('cf:files', ({ id, total }) => core.cfFiles(id, total));

  /* --- сборки .mrpack и CurseForge --- */
  handle('pack:versions', arg => (arg && typeof arg === 'object' && arg.source === 'curseforge' ? core.cfPackVersions(arg.cfId) : core.packVersions(typeof arg === 'object' ? arg.slug : arg)));
  async function runPack(opts) {
    const key = 'create';
    const release = lock(key);
    try {
      return await withTask('Устанавливает сборку', () => core.startJob(() => core.installPackAny(opts,
        (text, pct) => send('progress', { key, text, pct }),
        line => send('progress', { key, text: line, pct: null, log: true }),
        f => send('progress', { key: 'mod', ...f }))));
    } finally { release(); }
  }
  handle('pack:install', ({ slug, versionId, source, cfId }) => runPack(source === 'curseforge' ? { source, modId: cfId, fileId: versionId } : { slug, versionId }));
  handle('pack:installFile', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Сборка Modrinth', properties: ['openFile'], filters: [{ name: 'Сборки (.mrpack, .zip)', extensions: ['mrpack', 'zip'] }] });
    if (r.canceled || !r.filePaths.length) return null;
    return runPack({ file: r.filePaths[0] });
  });

  /* --- моды --- */
  handle('mod:install', async ({ instanceId, slug, source, cfId }) => {
    const release = lock(instanceId);
    try {
      const rp = (text, pct, extra) => send('progress', { key: 'mod', text, pct, ...(extra || {}) });
      return await withTask('Устанавливает моды', () => core.startJob(() => source === 'curseforge' ? core.installCfMod({ instanceId, cfId: cfId || slug }, rp) : core.installMod({ instanceId, slug }, rp), 'mod'));
    } finally { release(); }
  });
  handle('mod:installFile', async ({ instanceId, url, filename, title, slug, version }) => {
    const rp = (text, pct, extra) => extra ? send('progress', { key: 'mod', ...extra }) : send('progress', { key: 'mod', text, pct });
    return await withTask('Устанавливает моды', () => core.startJob(() => core.installModFile({ instanceId, url, filename, title, slug, version }, rp), 'mod'));
  });
  handle('mod:installMany', async ({ instanceId, slugs }) => {
    const release = lock(instanceId);
    try {
      return await withTask('Устанавливает моды', () => core.startJob(() => core.installMods({ instanceId, slugs }, (text, pct, extra) =>
        extra ? send('progress', { key: 'mod', ...extra }) : send('progress', { key: 'many', text, pct })), 'mod'));
    } finally { release(); }
  });
  /* --- OptiFine: список версий для Minecraft экземпляра и установка в папку mods --- */
  handle('optifine:list', id => core.optifineInfo(id));
  handle('optifine:versions', mc => core.optifineList(String(mc || '')));   // для окна создания экземпляра: версия игры ещё не установлена
  handle('optifine:install', async ({ id, file }) => {
    const release = lock(id);
    try {
      return await withTask('Устанавливает OptiFine', () => core.installOptifine({ instanceId: id, file },
        (text, pct, extra) => { if (extra) send('progress', { key: 'mod', ...extra }); }));
    } finally { release(); }
  });
  handle('mod:list', id => core.listMods(id));
  handle('mod:check', id => core.checkMods(id));
  handle('mod:remove', ({ instanceId, file }) => core.removeMod(instanceId, file));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 860, minWidth: 900, minHeight: 600,
    backgroundColor: '#050706', title: 'MatrixL', frame: false, icon: path.join(__dirname, '..', 'site', 'logo.png'), autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'site', 'index.html'));

  // внешние ссылки открываются снаружи, внутри окна только сам лаунчер
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.on('maximize', () => send('win-state', true));
  win.on('unmaximize', () => send('win-state', false));
  win.on('closed', () => { win = null; });
}

app.setAppUserModelId('app.modmatrix.launcher');   // значок и группировка окон на панели задач Windows
app.whenReady().then(() => {
  const userData = app.getPath('userData');
  accounts.init(userData);
  core.init(path.join(userData, 'minecraft'));
  core.setCurseKeyProvider(() => CURSEFORGE_KEY);   // ключ CurseForge встроен в приложение
  registerIpc();
  configureDiscord();

  updater.init({
    current: () => app.getVersion(),
    emit: st => send('update-state', st),
    canRestart: () => presence.playing.size ? 'Сначала закройте игру, потом обновляйте лаунчер'
      : (busy.size || presence.tasks.size) ? 'Дождитесь окончания скачивания, потом обновляйте лаунчер' : null,
    quit: () => { rpc.destroy(); app.exit(0); }
  });
  // тихая проверка при запуске и дальше раз в 6 часов; о новой версии лаунчер сообщит сам
  setTimeout(() => updater.check({ silent: true }), 6000);
  setInterval(() => updater.check({ silent: true }), 6 * 3600 * 1000);

  // изменения в папках экземпляров (моды, скриншоты) сразу попадают в интерфейс
  core.watchInstances(ev => send('fs-change', ev));

  // страница открыта с file://, поэтому разрешаем ей читать открытые API (Modrinth, Hangar, Spiget и др.)
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    const h = { ...details.responseHeaders };
    for (const k of Object.keys(h)) if (k.toLowerCase() === 'access-control-allow-origin') delete h[k];
    h['Access-Control-Allow-Origin'] = ['*'];
    cb({ responseHeaders: h });
  });

  createWindow();
  setTimeout(() => accounts.prewarmSkin(), 1500);   // скин и плащ выбранного аккаунта готовятся заранее
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('before-quit', () => rpc.destroy());
app.on('second-instance', () => { if (win) { showLauncher(true); } });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
