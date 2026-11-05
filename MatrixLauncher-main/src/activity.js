'use strict';
/* ============================================================
   Текст статуса Discord по состоянию игры: режим (меню, одиночная, сервер),
   что делает игрок (АФК, строит, исследует пещеры…), мир и биом.
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

function biomeName(id) {
  if (!id) return '';
  const short = String(id).replace(/^[^:]*:/, '');
  if (BIOMES[short]) return BIOMES[short];
  const t = short.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);   // биом из мода или datapack, показываем как есть
}

const MODES = { 0: 'survival', 1: 'creative', 2: 'adventure', 3: 'spectator' };

/* Что можно включать и выключать в расширенных настройках (по умолчанию включено всё, кроме координат) */
const DEFAULT_OPTS = {
  showHost: true,      // адрес сервера
  showWorld: true,     // название мира
  showBiome: true,     // биом
  showPlace: true,     // где игрок: пещеры, Нижний мир, Край, горы, поверхность
  showAction: true,    // что делает: добывает, сражается, рыбачит, летает на элитрах…
  showWeather: true,   // погода и время суток
  showHealth: true,    // «на грани гибели»
  showEvents: true,    // «только что погиб», «получил достижение»
  showAfk: true,       // АФК
  showCoords: false,   // координаты X Y Z
  showInstance: true,  // название экземпляра и загрузчик в подсказке иконки
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

/* Где игрок: пещеры определяем по высоте и названию биома */
function place(w) {
  if (!w) return '';
  if (w.dim === 'nether') return 'в Нижнем мире';
  if (w.dim === 'end') return 'в Крае';
  const b = String(w.biome || '');
  if (/dripstone_caves|lush_caves/.test(b)) return 'в пещерах';
  if (/deep_dark/.test(b)) return 'в Глубокой тьме';
  if (/ocean/.test(b)) return 'в океане';
  const y = w.pos ? w.pos[1] : null;
  if (y != null && y < -8) return 'в глубинах';
  if (y != null && y < 48) return 'в пещерах';
  if (y != null && y > 140) return 'высоко в горах';
  return 'на поверхности';
}
const UNDERGROUND = new Set(['в пещерах', 'в глубинах', 'в Глубокой тьме']);

/* Предмет в руке подсказывает занятие */
const FOOD = /^(bread|apple|golden_apple|enchanted_golden_apple|carrot|baked_potato|beetroot|melon_slice|sweet_berries|glow_berries|cookie|pumpkin_pie|cake|mushroom_stew|rabbit_stew|beetroot_soup|suspicious_stew|dried_kelp|honey_bottle|cooked_.+|steak)$/;
function heldAction(h) {
  if (!h) return '';
  if (/_pickaxe$/.test(h)) return 'Добывает ресурсы';
  if (/_axe$/.test(h)) return 'Рубит деревья';
  if (/_shovel$/.test(h)) return 'Копает';
  if (/_hoe$/.test(h)) return 'Возделывает землю';
  if (/_sword$|^trident$|^mace$/.test(h)) return 'Сражается';
  if (/^(bow|crossbow)$/.test(h)) return 'Стреляет из лука';
  if (h === 'fishing_rod') return 'Рыбачит';
  if (h === 'firework_rocket') return 'Запускает фейерверки';
  if (/^(map|filled_map|compass|recovery_compass|spyglass)$/.test(h)) return 'Ищет путь';
  if (/^(shears)$/.test(h)) return 'Стрижёт овец';
  if (/^(bucket|water_bucket|lava_bucket)$/.test(h)) return 'Работает с ведром';
  if (FOOD.test(h)) return 'Перекусывает';
  if (/^(redstone|repeater|comparator|piston|sticky_piston|observer|hopper|dispenser|dropper)$/.test(h)) return 'Строит механизмы';
  return '';
}

/* Главное занятие игрока (без места): АФК важнее всего, дальше события, транспорт, здоровье, предмет в руке */
function action(w, live, o, now) {
  if (o.showAfk && live.afk) return 'Стоит АФК';
  if (o.showEvents && live.event && live.event.until > now) return live.event.text;
  const m = w ? MODES[w.gamemode] : null;
  if (!w) return '';
  if (m === 'spectator') return 'Наблюдает';
  if (o.showAction) {
    if (w.elytra && w.pos && w.pos[1] > 80 && w.dim !== 'nether') return 'Летает на элитрах';
    if (w.riding) return 'Едет верхом';
  }
  if (o.showHealth && m !== 'creative' && w.health != null && w.health <= 6) return 'Борется за жизнь';
  if (o.showAction) {
    const h = heldAction(w.held);
    if (h) return h;
  }
  if (m === 'creative') return 'Строит';
  if (m === 'adventure') return 'Путешествует';
  if (o.showPlace && UNDERGROUND.has(place(w)) && (!m || m === 'survival')) return 'Исследует';
  return w.hardcore ? 'Выживает в хардкоре' : 'Играет';
}
/* Погода и время суток (DayTime: 0 — рассвет, 13000–23000 — ночь) */
function sky(w) {
  if (!w) return '';
  if (w.dim !== 'overworld') return '';
  const parts = [];
  if (w.dayTime != null) { const t = ((w.dayTime % 24000) + 24000) % 24000; parts.push(t >= 13000 && t < 23000 ? 'ночь' : 'день'); }
  if (w.thundering) parts.push('гроза'); else if (w.raining) parts.push('дождь');
  return parts.join(', ');
}

/* live: { mode:'menu'|'single'|'server', host, world, afk, event }; o: опции из resolveOpts */
function describe(live, inst, opts, now = Date.now()) {
  const o = opts || DEFAULT_OPTS;
  const mc = inst && inst.mc ? inst.mc : '';
  const largeText = o.showInstance && inst
    ? `${inst.name ? inst.name + ' · ' : ''}Minecraft ${mc}${inst.loader && inst.loader !== 'vanilla' ? ' ' + inst.loader : ''}`.trim() : 'MatrixL';
  if (!live || live.mode === 'menu' || !live.mode) {
    return { details: `Играет в Minecraft ${mc}`.trim(), state: o.showAfk && live && live.afk ? 'Стоит АФК в главном меню' : 'В главном меню', largeText };
  }
  if (live.mode === 'server') {
    const where = !o.showHost || !live.host ? 'на сервере' : `на сервере ${live.host}`;
    let state = 'Многопользовательская игра';
    if (o.showAfk && live.afk) state = 'Стоит АФК';
    else if (o.showEvents && live.event && live.event.until > now) state = live.event.text;
    return { details: `Играет ${where}`, state, largeText };
  }
  // одиночная игра
  const w = live.world;
  const details = o.showWorld && w && w.name ? `Одиночная игра · ${w.name}` : 'Одиночная игра';
  if (!w) return { details, state: o.showAfk && live.afk ? 'Стоит АФК' : 'Загружает мир…', largeText };
  const act = action(w, live, o, now);
  let p = o.showPlace ? place(w) : '';
  const eventNow = o.showEvents && live.event && live.event.until > now;
  const afkNow = o.showAfk && live.afk;
  if (act === 'Летает на элитрах' || (p === 'на поверхности' && act !== 'Играет')) p = '';
  const main = (!eventNow && !afkNow && act === 'Исследует' && UNDERGROUND.has(p))
    ? (p === 'в пещерах' ? 'Исследует пещеры' : p === 'в глубинах' ? 'Исследует глубины' : 'Исследует Глубокую тьму')
    : `${act} ${(eventNow ? '' : p)}`.trim();
  const parts = [main];
  const bn = o.showBiome ? biomeName(w.biome) : '';
  if (bn) parts.push(bn);
  const sk = o.showWeather ? sky(w) : '';
  if (sk) parts.push(sk);
  if (o.showCoords && w.pos) parts.push(`${Math.round(w.pos[0])} ${Math.round(w.pos[1])} ${Math.round(w.pos[2])}`);
  return { details, state: parts.join(' · '), largeText };
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
      live.event = { text: `Получил достижение «${m[1].slice(0, 60)}»`, until: Date.now() + 120000 }; return true;
    }
    if (new RegExp('(?:\\]: |\\] )(?:\\[CHAT\\] )?' + esc + ' ' + DEATH.source).test(l) && !/<[^>]*>/.test(l.split(esc)[0] || '')) {
      live.event = { text: 'Только что погиб', until: Date.now() + 90000 }; return true;
    }
  }
  return false;
}

module.exports = { describe, modeFromTitle, parseLogLine, biomeName, resolveOpts, DEFAULT_OPTS, _t: { place, action, heldAction, sky } };
