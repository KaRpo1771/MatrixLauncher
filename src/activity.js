'use strict';
/* ============================================================
   Текст статуса Discord по состоянию игры: режим (меню, одиночная, сервер),
   где находится игрок (измерение, пещеры, биом), мир, АФК и события. Тексты на русском и английском.
   ============================================================ */
const BIOMES = {
  plains: 'Равнины', sunflower_plains: 'Подсолнечные равнины', forest: 'Лес', flower_forest: 'Цветочный лес', birch_forest: 'Берёзовый лес',
  old_growth_birch_forest: 'Старый берёзовый лес', dark_forest: 'Тёмный лес', pale_garden: 'Бледный сад', taiga: 'Тайга', snowy_taiga: 'Снежная тайга',
  old_growth_pine_taiga: 'Старая сосновая тайга', old_growth_spruce_taiga: 'Старая еловая тайга', desert: 'Пустыня', savanna: 'Саванна',
  savanna_plateau: 'Плато саванны', windswept_savanna: 'Ветреная саванна', jungle: 'Джунгли', sparse_jungle: 'Редкие джунгли', bamboo_jungle: 'Бамбуковые джунгли',
  swamp: 'Болото', mangrove_swamp: 'Мангровые заросли', badlands: 'Бесплодные земли', eroded_badlands: 'Эродированные бесплодные земли',
  wooded_badlands: 'Лесистые бесплодные земли', meadow: 'Луг', cherry_grove: 'Вишнёвая роща', grove: 'Роща', snowy_slopes: 'Снежные склоны',
  frozen_peaks: 'Ледяные пики', jagged_peaks: 'Зубчатые пики', stony_peaks: 'Каменистые пики', windswept_hills: 'Ветреные холмы',
  windswept_forest: 'Ветреный лес', windswept_gravelly_hills: 'Ветреные гравийные холмы', snowy_plains: 'Снежные равнины', ice_spikes: 'Ледяные шипы',
  river: 'Река', frozen_river: 'Замёрзшая река', beach: 'Пляж', snowy_beach: 'Снежный пляж', stony_shore: 'Каменистый берег', ocean: 'Океан',
  deep_ocean: 'Глубокий океан', cold_ocean: 'Холодный океан', deep_cold_ocean: 'Глубокий холодный океан', frozen_ocean: 'Ледяной океан',
  deep_frozen_ocean: 'Глубокий ледяной океан', lukewarm_ocean: 'Тёплый океан', deep_lukewarm_ocean: 'Глубокий тёплый океан', warm_ocean: 'Тёплый океан',
  mushroom_fields: 'Грибные поля', dripstone_caves: 'Карстовые пещеры', lush_caves: 'Пышные пещеры', deep_dark: 'Глубокая тьма',
  nether_wastes: 'Адские пустоши', crimson_forest: 'Багровый лес', warped_forest: 'Искажённый лес', soul_sand_valley: 'Долина песка душ',
  basalt_deltas: 'Базальтовые дельты', the_end: 'Край', end_highlands: 'Верхний Край', end_midlands: 'Средний Край', small_end_islands: 'Малые острова Края',
  end_barrens: 'Бесплодный Край', the_void: 'Пустота'
};

function biomeName(id, lang) {
  if (!id) return '';
  const short = String(id).replace(/^[^:]*:/, '');
  if (lang === 'en') return short.split('_').map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(' ');   // английские названия совпадают с идентификатором
  if (BIOMES[short]) return BIOMES[short];
  const t = short.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);   // биом из мода или datapack, показываем как есть
}

/* ---------- Тексты статуса на двух языках (язык берётся из настройки интерфейса лаунчера) ---------- */
const TXT = {
  ru: {
    playing: v => `Играет в Minecraft ${v}`.trim(), mainMenu: 'Главное меню', afkMenu: 'Отсутствует (АФК) · главное меню',
    single: 'Одиночная игра', singleIn: n => `Одиночная игра · ${n}`, loading: 'Загрузка мира…',
    multi: 'Мультиплеер', onServer: 'Играет на сервере', onServerHost: h => `Сервер: ${h}`, inGame: 'В игре',
    mods: n => { const m = n % 100, d = n % 10; return `${n} ${(m > 10 && m < 15) ? 'модов' : d === 1 ? 'мод' : (d >= 2 && d <= 4) ? 'мода' : 'модов'}`; },
    afk: 'Отсутствует (АФК)', death: 'Персонаж погиб', advancement: n => `Достижение получено: «${n}»`,
    critical: 'Критическое состояние', spectator: 'Режим наблюдателя',
    day: 'день', night: 'ночь', rain: 'дождь', thunder: 'гроза',
    place: { nether: 'Нижний мир', end: 'Край', caves: 'Пещеры', deep_dark: 'Глубокая тьма', ocean: 'Океан', depths: 'Глубины', mountains: 'Горы', overworld: 'Верхний мир' }
  },
  en: {
    playing: v => `Playing Minecraft ${v}`.trim(), mainMenu: 'Main menu', afkMenu: 'Away (AFK) · main menu',
    single: 'Singleplayer', singleIn: n => `Singleplayer · ${n}`, loading: 'Loading world…',
    multi: 'Multiplayer', onServer: 'Playing on a server', onServerHost: h => `Server: ${h}`, inGame: 'In game',
    mods: n => `${n} ${n === 1 ? 'mod' : 'mods'}`,
    afk: 'Away (AFK)', death: 'Character died', advancement: n => `Advancement made: "${n}"`,
    critical: 'Critical condition', spectator: 'Spectator mode',
    day: 'daytime', night: 'night', rain: 'rain', thunder: 'thunderstorm',
    place: { nether: 'The Nether', end: 'The End', caves: 'Caves', deep_dark: 'Deep Dark', ocean: 'Ocean', depths: 'Depths', mountains: 'Mountains', overworld: 'Overworld' }
  }
};
const langOf = l => (l === 'en' ? 'en' : 'ru');

const MODES = { 0: 'survival', 1: 'creative', 2: 'adventure', 3: 'spectator' };

/* Что можно включать и выключать в расширенных настройках (по умолчанию включено всё, кроме координат) */
const DEFAULT_OPTS = {
  showHost: true,      // адрес и название сервера
  showPlayers: true,   // сколько игроков сейчас на сервере (запрос к серверу, как в списке серверов игры)
  showWorld: true,     // название мира
  showBiome: true,     // биом
  showPlace: true,     // где игрок: Верхний мир, Нижний мир, Край, пещеры, глубины, горы
  showWeather: true,   // погода и время суток
  showHealth: true,    // «Критическое состояние»
  showEvents: true,    // «Персонаж погиб», «Достижение получено»
  showAfk: true,       // АФК
  showCoords: false,   // координаты X Y Z
  showTimer: true,     // сколько времени идёт игра
  showLauncher: true   // что делаете в самом лаунчере (каталоги, настройки)
};
function resolveOpts(settings) {
  const st = settings || {};
  const o = { ...DEFAULT_OPTS };
  if (st.discordHideServer) o.showHost = false;   // старая настройка «скрывать адрес сервера»
  const saved = st.discordOpts && typeof st.discordOpts === 'object' ? st.discordOpts : {};
  for (const k of Object.keys(DEFAULT_OPTS)) if (typeof saved[k] === 'boolean') o[k] = saved[k];
  return o;
}

/* Где игрок: пещеры определяем по высоте и названию биома. Возвращает ключ места */
function placeKey(w) {
  if (!w) return '';
  if (w.dim === 'nether') return 'nether';
  if (w.dim === 'end') return 'end';
  const b = String(w.biome || '');
  if (/dripstone_caves|lush_caves/.test(b)) return 'caves';
  if (/deep_dark/.test(b)) return 'deep_dark';
  if (/ocean/.test(b)) return 'ocean';
  const y = w.pos ? w.pos[1] : null;
  if (y != null && y < -8) return 'depths';
  if (y != null && y < 48) return 'caves';
  if (y != null && y > 140) return 'mountains';
  return 'overworld';
}
const place = (w, lang) => { const k = placeKey(w); return k ? TXT[langOf(lang)].place[k] : ''; };

/* Погода и время суток (DayTime: 0 — рассвет, 13000–23000 — ночь) */
function sky(w, lang) {
  if (!w || w.dim !== 'overworld') return '';
  const T = TXT[langOf(lang)];
  const parts = [];
  if (w.dayTime != null) { const t = ((w.dayTime % 24000) + 24000) % 24000; parts.push(t >= 13000 && t < 23000 ? T.night : T.day); }
  if (w.thundering) parts.push(T.thunder); else if (w.raining) parts.push(T.rain);
  return parts.join(', ');
}

/* Событие (смерть, достижение) в тексте нужного языка */
function eventText(ev, lang) {
  const T = TXT[langOf(lang)];
  if (!ev) return '';
  if (ev.type === 'advancement') return T.advancement(ev.name || '');
  if (ev.type === 'death') return T.death;
  return '';
}

/* Статусная метка игрока (не место): АФК важнее всего, дальше событие, наблюдатель, критическое здоровье */
function statusLabel(w, live, o, now, lang) {
  const T = TXT[langOf(lang)];
  if (o.showAfk && live.afk) return T.afk;
  if (o.showEvents && live.event && live.event.until > now) return eventText(live.event, lang);
  if (w) {
    const m = MODES[w.gamemode];
    if (m === 'spectator') return T.spectator;
    if (o.showHealth && m !== 'creative' && w.health != null && w.health <= 6) return T.critical;
  }
  return '';
}

/* live: { mode:'menu'|'single'|'server', host, srv, world, afk, event }; o: опции из resolveOpts; lang: 'ru' | 'en' */
function describe(live, inst, opts, now = Date.now(), lang = 'ru') {
  const o = opts || DEFAULT_OPTS;
  const T = TXT[langOf(lang)];
  const mc = inst && inst.mc ? inst.mc : '';
  // плашка на иконке всегда: «Forge 1.12.2 (89 модов)», для чистой игры «Minecraft 1.12.2»
  const LOADERS = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
  const largeText = inst && mc
    ? `${LOADERS[inst.loader] || 'Minecraft'} ${mc}${inst.modCount > 0 ? ` (${T.mods(inst.modCount)})` : ''}` : 'MatrixL';
  if (!live || live.mode === 'menu' || !live.mode) {
    return { details: T.playing(mc), state: o.showAfk && live && live.afk ? T.afkMenu : T.mainMenu, largeText };
  }
  if (live.mode === 'server') {
    const srv = live.srv || {};
    // «Сервер» включён: показываем только адрес; выключен: только название сервера из списка игры (если оно есть)
    const name = o.showHost ? live.host : (srv.name || '');
    const details = name ? T.onServerHost(name) : T.onServer;
    const st = statusLabel(null, live, o, now, lang);
    const out = { details, state: st || T.multi, largeText };
    // «(12 из 100)» рядом со строкой состояния: Discord рисует это сам из party.size
    if (o.showHost && o.showPlayers && Number.isFinite(srv.online) && Number.isFinite(srv.max) && srv.max > 0) out.party = [Math.max(0, srv.online), Math.max(srv.max, srv.online)];
    return out;
  }
  // одиночная игра
  const w = live.world;
  const details = o.showWorld && w && w.name ? T.singleIn(w.name) : T.single;
  if (!w) return { details, state: o.showAfk && live.afk ? T.afk : T.loading, largeText };
  const parts = [];
  const st = statusLabel(w, live, o, now, lang);
  if (st) parts.push(st);
  const bn = o.showBiome ? biomeName(w.biome, lang) : '';
  // для пещер, Глубокой тьмы и океана место уже названо биомом, второй раз его не повторяем
  const byBiome = /dripstone_caves|lush_caves|deep_dark|ocean/.test(String(w.biome || '')) && w.dim === 'overworld' && !!bn;
  const pl = o.showPlace && !byBiome ? place(w, lang) : '';
  if (pl) parts.push(pl);
  if (bn) parts.push(bn);
  const sk = o.showWeather ? sky(w, lang) : '';
  if (sk) parts.push(sk);
  if (o.showCoords && w.pos) parts.push(`${Math.round(w.pos[0])} ${Math.round(w.pos[1])} ${Math.round(w.pos[2])}`);
  return { details, state: parts.length ? parts.join(' · ') : T.inGame, largeText };
}

/* Из заголовка окна Minecraft: в каком режиме игра */
function modeFromTitle(title) {
  const t = String(title || '');
  if (/Singleplayer|Одиночная/i.test(t)) return 'single';
  if (/Multiplayer|Сетевая/i.test(t)) return 'server';
  return null;
}
const DEATH = /(was (slain|shot|killed|blown|fireballed|pummeled|squashed|impaled|pricked|stung|skewered|obliterated|struck|doomed|burnt)|fell |drowned|burned|blew up|hit the ground|starved|suffocated|tried to|died|withered away|walked into|went up in flames|experienced kinetic|discovered the floor|froze to death|got finished|didn't want to live|left the confines|was lit on fire|fell out of the world)/;
/* Строка журнала → обновляет live; true, если статус изменился. name: ник игрока (для смерти и достижений) */
function parseLogLine(line, live, name) {
  const l = String(line);
  let m;
  if ((m = /Connecting to ([^,\s]+), (\d+)/.exec(l))) { live.mode = 'server'; live.host = m[2] === '25565' ? m[1] : `${m[1]}:${m[2]}`; return true; }
  if (/Starting integrated minecraft server/i.test(l)) { live.mode = 'single'; live.host = ''; live.world = null; return true; }
  if (/\[Server thread\/INFO\].*Stopping server|Stopping singleplayer server|\[Render thread\/INFO\].*Disconnected from/i.test(l)) { if (live.mode !== 'menu') { live.mode = 'menu'; live.host = ''; live.world = null; return true; } }
  if (name && l.includes(name)) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if ((m = new RegExp(esc + ' has (?:made the advancement|completed the challenge|reached the goal) \\[(.+?)\\]').exec(l))) {
      live.event = { type: 'advancement', name: m[1].slice(0, 60), until: Date.now() + 120000 }; return true;
    }
    if (new RegExp('(?:\\]: |\\] )(?:\\[CHAT\\] )?' + esc + ' ' + DEATH.source).test(l) && !/<[^>]*>/.test(l.split(esc)[0] || '')) {
      live.event = { type: 'death', until: Date.now() + 90000 }; return true;
    }
  }
  return false;
}

module.exports = { describe, modeFromTitle, parseLogLine, biomeName, resolveOpts, langOf, TXT, DEFAULT_OPTS, _t: { place, sky, eventText } };
