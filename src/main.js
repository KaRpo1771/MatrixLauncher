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
const serverping = require('./serverping');

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
/* Первая строка: что делает пользователь. Вторая: полезная подробность или ничего (пустую строку Discord не показывает).
   Тексты на языке интерфейса лаунчера (RU / ENG), язык приходит из окна вместе со страницей. */
const PRES = {
  ru: {
    pages: { home: 'Главная страница', mods: 'Просмотр модов', plugins: 'Просмотр плагинов', modpacks: 'Просмотр сборок', resourcepacks: 'Просмотр ресурспаков', shaders: 'Просмотр шейдеров', favorites: 'Просмотр избранного', settings: 'Настройка лаунчера' },
    viewing: { mod: 'Просмотр мода', plugin: 'Просмотр плагина', modpack: 'Просмотр сборки', resourcepack: 'Просмотр ресурспака', shader: 'Просмотр шейдера' }, author: a => `Автор: ${a}`,
    tasks: { java: 'Обновление Java', mc: 'Установка Minecraft', pack: 'Установка сборки', mods: 'Установка модов', optifine: 'Установка OptiFine', resourcepack: 'Установка ресурспака', shader: 'Установка шейдера', copy: 'Копирование экземпляра' },
    inLauncher: 'В лаунчере MatrixL', playing: v => `Играет в Minecraft ${v}`.trim(),
    favs: n => `${n} ${plural(n, 'карточка', 'карточки', 'карточек')} в избранном`,
    mods: n => `${n} ${plural(n, 'мод', 'мода', 'модов')}`
  },
  en: {
    pages: { home: 'Home', mods: 'Browsing mods', plugins: 'Browsing plugins', modpacks: 'Browsing modpacks', resourcepacks: 'Browsing resource packs', shaders: 'Browsing shaders', favorites: 'Browsing favorites', settings: 'Configuring the launcher' },
    viewing: { mod: 'Viewing mod', plugin: 'Viewing plugin', modpack: 'Viewing modpack', resourcepack: 'Viewing resource pack', shader: 'Viewing shader' }, author: a => `By ${a}`,
    tasks: { java: 'Updating Java', mc: 'Installing Minecraft', pack: 'Installing a modpack', mods: 'Installing mods', optifine: 'Installing OptiFine', resourcepack: 'Installing a resource pack', shader: 'Installing a shader', copy: 'Copying an instance' },
    inLauncher: 'In MatrixL launcher', playing: v => `Playing Minecraft ${v}`.trim(),
    favs: n => `${n} saved ${n === 1 ? 'card' : 'cards'}`,
    mods: n => `${n} ${n === 1 ? 'mod' : 'mods'}`
  }
};
const PAGE_IDS = new Set(['home', 'mods', 'plugins', 'modpacks', 'resourcepacks', 'shaders', 'favorites', 'settings']);
const presence = { page: 'home', item: null, inst: null, favs: 0, gv: '', lang: 'ru', tasks: new Map(), playing: new Map() };
const CATALOG_PAGES = new Set(['mods', 'plugins', 'modpacks', 'resourcepacks', 'shaders']);
const ITEM_KINDS = ['mod', 'plugin', 'modpack', 'resourcepack', 'shader'];
function plural(n, one, few, many) { const m = n % 100, d = n % 10; return (m > 10 && m < 15) ? many : d === 1 ? one : (d >= 2 && d <= 4) ? few : many; }
function instLine(i) {
  if (!i) return undefined;
  return `${i.name} · ${i.mc}${i.loader && i.loader !== 'vanilla' ? ' ' + (LD_NAME[i.loader] || i.loader) : ''}`;
}
function applyPresence() {
  const o = activity.resolveOpts(accounts.getSettings());
  const lang = activity.langOf(presence.lang), P = PRES[lang];
  const start = o.showTimer ? startedAt : 0;
  if (presence.playing.size) {
    const g = [...presence.playing.values()].pop();
    const d = g.live ? activity.describe(g.live, g.inst, o, Date.now(), lang) : { details: P.playing(g.mc), state: g.stateFor(lang) };
    rpc.set({ details: d.details, state: d.state || g.stateFor(lang), start: o.showTimer ? g.start : 0, largeText: d.largeText, party: d.party });
  } else if (presence.tasks.size) {
    rpc.set({ details: P.tasks[[...presence.tasks.values()].pop()] || P.tasks.mods, state: instLine(presence.inst), start });
  } else if (!o.showLauncher) {
    rpc.set({ details: P.inLauncher, start });
  } else {
    let details = P.pages[presence.page] || P.pages.home;
    let state;
    if (presence.item) {
      // открыта карточка мода, плагина, сборки, ресурспака или шейдера: «Просмотр мода: Sodium», ниже автор
      const it = presence.item;
      details = `${P.viewing[it.kind] || P.viewing.mod}: ${it.title}`;
      state = it.author ? P.author(it.author) : undefined;
    }
    // каталоги: одна строка «Просмотр модов | 1.12.2», версия видна только если выбрана в фильтре
    else if (CATALOG_PAGES.has(presence.page)) { if (presence.gv) details += ` | ${presence.gv}`; }
    else if (presence.page === 'home') state = instLine(presence.inst);
    else if (presence.page === 'favorites' && presence.favs) state = P.favs(presence.favs);
    rpc.set({ details, state, start });
  }
}
let taskSeq = 0;
/* kind: java | mc | pack | mods | optifine (название задачи подбирается по языку при каждой отрисовке статуса) */
function withTask(kind, fn) {
  const k = ++taskSeq; presence.tasks.set(k, kind); applyPresence();
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
    const lang = activity.langOf(presence.lang);
    const ru = lang === 'ru';
    const inst = { name: ru ? 'Мой экземпляр' : 'My instance', mc: '1.20.1', loader: 'fabric' };
    const world = { name: ru ? 'Новый мир' : 'New World', gamemode: 0, hardcore: false, dim: 'overworld', pos: [120, 70, -64], biome: 'minecraft:forest', health: 20, dayTime: 3000, raining: false, thundering: false };
    const nether = { ...world, dim: 'nether', biome: 'minecraft:crimson_forest' };
    const ev = { type: 'advancement', name: ru ? 'Каменный век' : 'Stone Age', until: Date.now() + 1e5 };
    const now = Date.now();
    return {
      single: activity.describe({ mode: 'single', world, afk: false }, inst, o, now, lang),
      nether: activity.describe({ mode: 'single', world: nether, afk: false }, inst, o, now, lang),
      afk: activity.describe({ mode: 'single', world, afk: true }, inst, o, now, lang),
      event: activity.describe({ mode: 'single', world, afk: false, event: ev }, inst, o, now, lang),
      server: activity.describe({ mode: 'server', host: 'mc.example.net', srv: { name: 'Example Network', online: 128, max: 500 }, afk: false }, inst, o, now, lang),
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
  handle('discord:page', ({ page, inst, favs, gv, lang, item } = {}) => {
    presence.item = item && item.title ? { title: String(item.title).slice(0, 80), kind: ITEM_KINDS.includes(item.kind) ? item.kind : 'mod', author: item.author ? String(item.author).slice(0, 40) : '' } : null;
    presence.gv = gv ? String(gv).slice(0, 20) : '';
    presence.lang = activity.langOf(lang);
    presence.page = PAGE_IDS.has(page) ? page : 'home';
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
      return await withTask('java', () => core.startJob(() => core.javaUpdate(
        (text, pct) => send('progress', { key: 'java', text, pct }))));
    } finally { release(); }
  });
  handle('java:catalog', () => core.javaCatalog());
  handle('java:remove', async comp => {
    const release = lock('java');
    try { return await core.javaRemove(comp); } finally { release(); }
  });
  handle('java:install', async comps => {
    const release = lock('java');
    try {
      return await withTask('java', () => core.startJob(() => core.javaInstall(comps,
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
      return await withTask('mc', () => core.startJob(() => core.createInstance(opts || {},
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
      // сведения о сервере (название из списка серверов игры, число игроков онлайн): обновляются раз в минуту
      const pingServer = () => {
        if (live.mode !== 'server' || !live.host) { live.srv = null; return; }
        if (live.srvHost !== live.host) { live.srvHost = live.host; live.srvAt = 0; live.srv = { name: serverping.savedName(core.instDir(id), live.host) }; }
        if (Date.now() - (live.srvAt || 0) < 60000) return;
        const o = activity.resolveOpts(accounts.getSettings());
        if (!o.showHost || !o.showPlayers) return;
        live.srvAt = Date.now();
        const { host, port } = serverping.splitHost(live.host), asked = live.host;
        serverping.ping(host, port).then(r => { if (live.host === asked) { live.srv = { ...(live.srv || {}), online: r.online, max: r.max }; refresh(); } }).catch(() => { /* сервер не отвечает на запрос статуса: показываем только название */ });
      };
      const refresh = () => { const e = presence.playing.get(id); if (e) applyPresence(); if (live.mode === 'server') pingServer(); };
      // название, режим, измерение и биом читаются из файлов мира, пока игрок в одиночной игре
      const poll = setInterval(() => {
        if (live.mode === 'server') { pingServer(); return; }
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
        stateFor: lang => `${inst.name} · ${LD_NAME[inst.loader] || inst.loader}${liveInst.modCount ? ` · ${PRES[lang].mods(liveInst.modCount)}` : ''}` });
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
      return await withTask('pack', () => core.startJob(() => core.installPackAny(opts,
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
      return await withTask('mods', () => core.startJob(() => source === 'curseforge' ? core.installCfMod({ instanceId, cfId: cfId || slug }, rp) : core.installMod({ instanceId, slug }, rp), 'mod'));
    } finally { release(); }
  });
  handle('mod:installFile', async ({ instanceId, url, filename, title, slug, version }) => {
    const rp = (text, pct, extra) => extra ? send('progress', { key: 'mod', ...extra }) : send('progress', { key: 'mod', text, pct });
    return await withTask('mods', () => core.startJob(() => core.installModFile({ instanceId, url, filename, title, slug, version }, rp), 'mod'));
  });
  handle('mod:installMany', async ({ instanceId, slugs }) => {
    const release = lock(instanceId);
    try {
      return await withTask('mods', () => core.startJob(() => core.installMods({ instanceId, slugs }, (text, pct, extra) =>
        extra ? send('progress', { key: 'mod', ...extra }) : send('progress', { key: 'many', text, pct })), 'mod'));
    } finally { release(); }
  });
  /* --- ресурспаки и шейдеры: в resourcepacks / shaderpacks выбранного экземпляра (любой загрузчик, в том числе Vanilla) --- */
  const resTask = kind => (kind === 'shader' ? 'shader' : 'resourcepack');
  handle('res:install', async ({ instanceId, kind, slug, source, cfId }) => {
    const release = lock(instanceId);
    try {
      const rp = (text, pct, extra) => send('progress', { key: 'mod', text, pct, ...(extra || {}) });
      return await withTask(resTask(kind), () => core.startJob(() => core.installResource({ instanceId, kind, source, slug, cfId }, rp), 'mod'));
    } finally { release(); }
  });
  handle('res:installFile', async ({ instanceId, kind, url, filename, title, slug, version }) => {
    const rp = (text, pct, extra) => extra ? send('progress', { key: 'mod', ...extra }) : send('progress', { key: 'mod', text, pct });
    return await withTask(resTask(kind), () => core.startJob(() => core.installResourceFile({ instanceId, kind, url, filename, title, slug, version }, rp), 'mod'));
  });
  handle('res:list', ({ instanceId, kind }) => core.listResources(instanceId, kind));
  /* --- OptiFine: список версий для Minecraft экземпляра и установка в папку mods --- */
  handle('optifine:list', id => core.optifineInfo(id));
  handle('optifine:versions', mc => core.optifineList(String(mc || '')));   // для окна создания экземпляра: версия игры ещё не установлена
  handle('optifine:install', async ({ id, file }) => {
    const release = lock(id);
    try {
      return await withTask('optifine', () => core.installOptifine({ instanceId: id, file },
        (text, pct, extra) => { if (extra) send('progress', { key: 'mod', ...extra }); }));
    } finally { release(); }
  });
  /* --- обновления модов и сборок, копия экземпляра --- */
  handle('mod:updates', id => core.checkModUpdates(id));
  handle('mod:update', async ({ instanceId, files }) => {
    const release = lock(instanceId);
    try {
      const rp = (text, pct, extra) => extra ? send('progress', { key: 'mod', ...extra }) : send('progress', { key: 'mod', text, pct });
      return await withTask('mods', () => core.startJob(() => core.updateMods({ instanceId, files }, rp), 'mod'));
    } finally { release(); }
  });
  handle('pack:check', id => core.checkPackUpdate(id));
  handle('pack:update', async ({ instanceId, versionId, backup, backupSuffix }) => {
    const key = 'create';
    const releaseKey = lock(key), release = lock(instanceId);
    try {
      return await withTask('pack', () => core.startJob(() => core.updatePack({ instanceId, versionId, backup: !!backup, backupSuffix },
        (text, pct) => send('progress', { key, text, pct }),
        line => send('progress', { key, text: line, pct: null, log: true }),
        f => send('progress', { key: 'mod', ...f }))));
    } finally { release(); releaseKey(); }
  });
  handle('inst:copy', async (id, o) => {
    const key = 'create';
    const releaseKey = lock(key), release = lock(id);
    try {
      return await withTask('copy', () => core.startJob(() => core.copyInstance(id,
        (text, pct) => send('progress', { key, text, pct }), { suffix: o && o.suffix })));
    } finally { release(); releaseKey(); }
  });
  handle('mod:list', id => core.listMods(id));
  handle('mod:all', id => core.listMods(id, { all: true }));
  handle('mod:toggle', ({ instanceId, file, enabled }) => core.toggleMod(instanceId, file, !!enabled));
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
    dataDir: userData,
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
