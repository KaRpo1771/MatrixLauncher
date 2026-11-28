/* ============================================================
   ModMatrix, источники данных
   Единый формат карточки:
   {id, slug, title, author, desc, icon, downloads, follows,
    categories[], loaders[], versions[], updated, url, source}
   ============================================================ */

const LOADER_IDS = ["fabric","forge","neoforge","quilt"];
const LOADER_LABEL = {fabric:"Fabric",forge:"Forge",neoforge:"NeoForge",quilt:"Quilt", iris:"Iris",oculus:"Oculus",optifine:"OptiFine",canvas:"Canvas",vanilla:"Vanilla"};
/* у шейдеров вместо загрузчика модов, движок, который их запускает */
const SHADER_ENGINES = ["iris","oculus","optifine","canvas","vanilla"];
const RES_KINDS = ["resourcepack","shader","datapack"];
/* значок загрузчика (файлы лежат в site/loaders/<id>.png); если файла нет, просто пропадает */
/* Oculus (порт Iris для Forge) запускает те же шейдеры, что и Iris, но у Modrinth такого движка в метках нет: добавляем его к шейдерам с Iris */
const withOculus = (list, isShader)=> isShader && list.includes("iris") && !list.includes("oculus") ? [...list, "oculus"] : list;
const ICON_IDS = [...LOADER_IDS, "iris","oculus","optifine","canvas"];
const ldIcon = l => ICON_IDS.includes(l) ? `<img class="ld-ico" src="loaders/${l}.png" alt="" width="14" height="14" onerror="this.remove()">` : "";
const CAT_LABEL = {
  adventure:"Приключения", decoration:"Декор", economy:"Экономика", equipment:"Снаряжение",
  food:"Еда", "game-mechanics":"Механики", library:"Библиотеки", magic:"Магия",
  management:"Управление", minigame:"Мини-игры", mobs:"Мобы", optimization:"Оптимизация",
  social:"Социальное", storage:"Хранение", technology:"Техника",
  transportation:"Транспорт", utility:"Утилиты", worldgen:"Генерация мира", cursed:"Странные"
};
const MODPACK_CAT_LABEL = {
  adventure:"Приключения", challenging:"Хардкор", combat:"Сражения", "kitchen-sink":"Всего понемногу",
  lightweight:"Лёгкие", magic:"Магия", multiplayer:"Мультиплеер", optimization:"Оптимизация",
  quests:"Квесты", technology:"Техника", "vanilla-like":"Ванильный стиль"
};
const PLUGIN_CAT_LABEL = {
  admin_tools:"Администрирование", chat:"Чат", dev_tools:"Для разработчиков", economy:"Экономика",
  gameplay:"Геймплей", games:"Мини-игры", protection:"Защита", role_playing:"Ролевые",
  world_management:"Управление миром", misc:"Разное"
};
const RESPACK_CAT_LABEL = {
  "8x":"8x","16x":"16x","32x":"32x","64x":"64x","128x":"128x","256x":"256x","512x+":"512x+",
  audio:"Звуки", blocks:"Блоки", combat:"Бой", "core-shaders":"Core-шейдеры", cursed:"Странные", decoration:"Декор",
  entities:"Сущности", environment:"Окружение", equipment:"Снаряжение", fonts:"Шрифты", gui:"Интерфейс", items:"Предметы",
  locale:"Локализация", modded:"Для модов", models:"Модели", realistic:"Реалистичные", simplistic:"Простые",
  themed:"Тематические", tweaks:"Твики", utility:"Утилиты", "vanilla-like":"Ванильный стиль"
};
const SHADER_CAT_LABEL = {
  cartoon:"Мультяшные", cursed:"Странные", fantasy:"Фэнтези", foliage:"Растительность", realistic:"Реалистичные",
  "semi-realistic":"Полуреалистичные", "vanilla-like":"Ванильный стиль", atmosphere:"Атмосфера", bloom:"Свечение",
  "colored-lighting":"Цветное освещение", "path-tracing":"Трассировка путей", pbr:"PBR", reflections:"Отражения",
  potato:"Для слабых ПК", low:"Низкая нагрузка", medium:"Средняя нагрузка", high:"Высокая нагрузка", screenshot:"Для скриншотов"
};
/* название категории по слагу из любого каталога; неизвестный слаг показываем читаемо */
const CAT_LABEL_ALL = {...PLUGIN_CAT_LABEL, ...MODPACK_CAT_LABEL, ...RESPACK_CAT_LABEL, ...SHADER_CAT_LABEL, ...CAT_LABEL};
const catLabel = c => CAT_LABEL_ALL[c] || CF_RU[String(c).toLowerCase().replace(/[^a-z0-9]+/g,"")] || (/^[a-z0-9\-_+]+$/.test(String(c)) ? String(c).replace(/[-_]+/g," ").replace(/^./,x=>x.toUpperCase()) : String(c));
const SOURCE_META = {
  modrinth: {label:"Modrinth"}, hangar: {label:"Hangar"},
  spiget: {label:"SpigotMC"}, curseforge: {label:"CurseForge"}, snapshot: {label:"Снимок"}
};

/* ---------- Modrinth: моды и сборки, открытый API без ключа ---------- */
const Modrinth = {
  name:"Modrinth",
  api:"https://api.modrinth.com/v2",

  async search({query, category, loader, gameVersion, sort, offset, limit, projectType, signal}){
    const ptype = projectType || "mod";
    const facets = [[`project_type:${ptype}`]];
    if(category) facets.push([`categories:${category}`]);
    if(loader)   facets.push([`categories:${loader}`]);
    if(gameVersion) facets.push([`versions:${gameVersion}`]);

    const p = new URLSearchParams({
      facets: JSON.stringify(facets),
      index: sort || "downloads",
      offset: String(offset || 0),
      limit: String(limit || 24)
    });
    if(query) p.set("query", query);

    const r = await fetch(`${this.api}/search?${p}`, {signal, headers:{Accept:"application/json"}});
    if(!r.ok) throw new Error(`Modrinth ответил ${r.status}`);
    const data = await r.json();
    return {
      total: data.total_hits,
      items: data.hits.map(h=>({
        id:`modrinth:${h.project_id}`, slug:h.slug, title:h.title, author:h.author,
        desc:h.description, icon:h.icon_url, cover:h.featured_gallery || (h.gallery||[])[0] || null, downloads:h.downloads, follows:h.follows,
        categories:(h.display_categories||h.categories||[]).filter(c=>!LOADER_IDS.includes(c) && !SHADER_ENGINES.includes(c) && c !== "minecraft" && c !== "datapack"),
        // у шейдеров в «загрузчиках» показываем движок (Iris, OptiFine…); у ресурспаков загрузчика нет
        loaders:withOculus((h.categories||[]).filter(c=> ptype==="shader" ? SHADER_ENGINES.includes(c) : LOADER_IDS.includes(c)), ptype==="shader"),
        versions:h.versions||[], updated:h.date_modified,
        url:`https://modrinth.com/${["modpack","resourcepack","shader","datapack"].includes(ptype) ? ptype : "mod"}/${h.slug}`,
        source:"modrinth"
      }))
    };
  },

  async details(mod, signal){
    // версии идут отдельным запросом и без changelog (у популярных модов это мегабайты текста);
    // окно открывается, как только пришёл сам проект
    const vp = fetch(`${this.api}/project/${mod.slug}/version?include_changelog=false`, {signal})
      .then(r=> r.ok ? r.json() : [])
      .then(list=> list.map(v=>({
        name:v.version_number, date:v.date_published,
        game:(v.game_versions||[]).join(", "),
        gameList:v.game_versions||[], loaderList:(v.loaders||[]).filter(l=> l!=="minecraft" && l!=="datapack"),
        file:(v.files||[]).find(f=>f.primary)?.url || (v.files||[])[0]?.url
      })));
    vp.catch(()=>{});
    const pr = await fetch(`${this.api}/project/${mod.slug}`, {signal});
    if(!pr.ok) throw new Error(`Modrinth ответил ${pr.status}`);
    const p = await pr.json();
    return {
      license:p.license && (p.license.name||p.license.id),
      gallery:(p.gallery||[]).slice()
        .sort((a,b)=> (b.featured?1:0)-(a.featured?1:0) || (a.ordering||0)-(b.ordering||0))
        .map(g=>({url:g.url, title:g.title||"", desc:g.description||""})),
      body:typeof p.body === "string" ? p.body.slice(0, 400000) : "",
      followers:p.followers, downloads:p.downloads,
      gameVersions:p.game_versions||[], loaders:withOculus((p.loaders||[]).filter(l=> l!=="minecraft" && l!=="datapack"), p.project_type==="shader"),
      links:{source:p.source_url, issues:p.issues_url, wiki:p.wiki_url},
      versions:[], versionsPromise: vp
    };
  },

  /* Категории проекта этого типа прямо из Modrinth (ресурспаки и шейдеры), чтобы не гадать со списком */
  async categoryList(projectType, signal){
    if(!this._cats){
      const r = await fetch(`${this.api}/tag/category`, {signal});
      if(!r.ok) throw new Error(`Modrinth ответил ${r.status}`);
      this._cats = await r.json();
    }
    const names = this._cats.filter(c=> c.project_type === projectType).map(c=> c.name);
    // разрешения (16x, 32x…) идут первыми и по возрастанию
    const px = n=> /^\d+x\+?$/.test(n) ? parseInt(n,10) : null;
    return names.sort((a,b)=>{ const x=px(a), y=px(b); return x!=null && y!=null ? x-y : x!=null ? -1 : y!=null ? 1 : 0; });
  },

  async gameVersions(signal){
    const r = await fetch(`${this.api}/tag/game_version`, {signal});
    if(!r.ok) return [];
    const all = await r.json();
    const releases = all.filter(v=>v.version_type === "release");
    // сортируем от новых к старым; если поля даты нет, порядок API сохраняется как есть
    releases.sort((a,b)=> String(b.date||"").localeCompare(String(a.date||"")));
    return releases.map(v=>v.version);
  }
};

/* ---------- Hangar: плагины Paper, открытый API без ключа ---------- */
const Hangar = {
  name:"Hangar",
  api:"https://hangar.papermc.io/api/v1",

  async search({query, sort, offset, limit, signal}){
    const sortField = sort === "updated" ? "-updated"
      : sort === "follows" ? "-stars"
      : sort === "newest" ? "-newest"
      : "-downloads";
    const p = new URLSearchParams({limit:String(limit||24), offset:String(offset||0), sort:sortField});
    if(query) p.set("q", query);

    const r = await fetch(`${this.api}/projects?${p}`, {signal, headers:{Accept:"application/json"}});
    if(!r.ok) throw new Error(`Hangar ответил ${r.status}`);
    const data = await r.json();
    const list = data.result || [];
    return {
      total: data.pagination?.count ?? list.length,
      items: list.map(pr=>({
        id:`hangar:${pr.namespace.owner}/${pr.namespace.slug}`,
        slug:pr.namespace.slug, title:pr.name, author:pr.namespace.owner,
        desc:pr.description || "",
        icon:pr.avatarUrl || null,
        downloads:pr.stats?.downloads || 0, follows:pr.stats?.stars || 0,
        categories:[pr.category].filter(Boolean),
        loaders:[], versions:[],
        updated:pr.lastUpdated,
        url:`https://hangar.papermc.io/${pr.namespace.owner}/${pr.namespace.slug}`,
        source:"hangar"
      }))
    };
  },

  async details(mod, signal){
    let list = [];
    try{
      const r = await fetch(`${this.api}/projects/${mod.author}/${mod.slug}/versions?limit=30`, {signal, headers:{Accept:"application/json"}});
      if(r.ok){ const data = await r.json(); list = data.result || []; }
    }catch(e){}
    const gameVersions = [...new Set(list.flatMap(v=> Object.values(v.platformDependencies||{}).flat()))];
    return {
      license:"-", followers:mod.follows, downloads:mod.downloads,
      gameVersions, loaders:[], links:{source:null, issues:null, wiki:null},
      versions: list.map(v=>{
        const downloads = v.downloads || {};
        const plat = Object.keys(downloads)[0];
        const d = plat ? downloads[plat] : null;
        const game = v.platformDependenciesFormatted
          ? Object.entries(v.platformDependenciesFormatted).map(([p,rng])=>`${p} ${rng}`).join(", ")
          : Object.entries(v.platformDependencies||{}).map(([p,vs])=>`${p} ${(vs||[]).join(", ")}`).join(" · ");
        return {
          name: v.name || "-",
          gameList: Object.values(v.platformDependencies||{}).flat(), loaderList: [],
          date: v.createdAt,
          game: game || "-",
          file: d?.downloadUrl || d?.externalUrl || null
        };
      })
    };
  },
  async gameVersions(){ return []; }
};

/* ---------- SpigotMC через Spiget: открытое зеркало без ключа ---------- */
const Spiget = {
  name:"SpigotMC",
  api:"https://api.spiget.org/v2",
  fields:"name,tag,downloads,likes,updateDate,releaseDate,testedVersions,author,contributors",

  async search({query, sort, offset, limit, signal}){
    const size = limit || 24;
    const page = Math.floor((offset||0) / size) + 1;
    const sortParam = sort === "updated" ? "-updateDate"
      : sort === "follows" ? "-likes"
      : sort === "newest" ? "-releaseDate"
      : "-downloads";
    const p = new URLSearchParams({size:String(size), page:String(page), sort:sortParam, fields:this.fields});
    const url = query
      ? `${this.api}/search/resources/${encodeURIComponent(query)}?${p}`
      : `${this.api}/resources?${p}`;

    const r = await fetch(url, {signal, headers:{Accept:"application/json"}});
    if(!r.ok) throw new Error(`SpigotMC ответил ${r.status}`);
    const list = await r.json();
    return {
      total: null,
      items: (list||[]).map(m=>({
        id:`spiget:${m.id}`, slug:String(m.id), title:m.name,
        author: m.author?.name || (Array.isArray(m.contributors) && m.contributors[0]) || "SpigotMC",
        desc:String(m.tag||"").replace(/<[^>]+>/g,""),
        icon:`https://api.spiget.org/v2/resources/${m.id}/icon`,
        downloads:m.downloads||0, follows:m.likes||0,
        categories:[], loaders:[],
        versions:m.testedVersions||[],
        updated: m.updateDate ? new Date(m.updateDate*1000).toISOString() : "",
        url:`https://www.spigotmc.org/resources/${m.id}/`,
        source:"spiget"
      }))
    };
  },

  async details(mod, signal){
    let list = [];
    try{
      const r = await fetch(`${this.api}/resources/${mod.slug}/versions?size=30&sort=-releaseDate`, {signal, headers:{Accept:"application/json"}});
      if(r.ok) list = await r.json();
    }catch(e){}
    return {
      license:"-", followers:mod.follows, downloads:mod.downloads,
      gameVersions:mod.versions, loaders:[], links:{source:null, issues:null, wiki:null},
      versions:(list||[]).map(v=>({
        name:v.name || String(v.id),
        date: v.releaseDate ? new Date(v.releaseDate*1000).toISOString() : "",
        game:(mod.versions||[]).join(", ") || "-",
        file:`https://api.spiget.org/v2/resources/${mod.slug}/versions/${v.id}/download`
      }))
    };
  },
  async gameVersions(){ return []; }
};

/* ---------- CurseForge: работает только в приложении (запросы идут из главного процесса, ключ встроен) ---------- */
async function mmCall(channel, ...args){
  const r = await window.mm.invoke(channel, ...args);
  if(!r.ok) throw new Error(r.error);
  return r.data;
}
/* Категории Modrinth (слаги) -> возможные названия категорий CurseForge.
   Названия ищем среди категорий CurseForge без учёта регистра и знаков; если соответствия нет, CurseForge в этой категории пропускается. */
const CF_CAT_ALIAS = {
  adventure:["adventureandrpg","adventure"], decoration:["cosmetic","decoration"],
  equipment:["armortoolsandweapons","equipment"], food:["food"], library:["libraryapi","apiandlibrary","library"],
  magic:["magic"], mobs:["mobs"], optimization:["performance","optimization"], storage:["storage"],
  technology:["technology"], transportation:["playertransport","transport"], utility:["utilityqol","utility"],
  worldgen:["worldgen","worldgeneration"], "game-mechanics":["gamemechanics"], social:["social"],
  economy:["economy"], management:["management"], minigame:["minigame","minigames"],
  // ресурспаки и шейдеры: слаги Modrinth -> названия категорий CurseForge
  "8x-":["8x"], "8x":["8x"], "512x+":["512xandhigher","512x"],
  realistic:["photorealistic","realistic"], "vanilla-like":["traditional","vanillalike","vanilla"],
  simplistic:["modern","simplistic"], themed:["themed","medieval","steampunk"], modded:["modsupport","modded"],
  fonts:["fontpacks","fonts"], cartoon:["cartoon","animated"], "semi-realistic":["semirealistic","realistic"],
  fantasy:["fantasy"], cursed:["cursed"], tweaks:["tweaks","miscellaneous"]
};
/* Русские названия категорий CurseForge (ключ: название без регистра и знаков). Неизвестные остаются как есть. */
const CF_RU = {
  adventureandrpg:"Приключения и RPG", apiandlibrary:"Библиотеки и API", libraryapi:"Библиотеки и API", armortoolsandweapons:"Броня, инструменты, оружие",
  cosmetic:"Косметика", education:"Обучение", food:"Еда", magic:"Магия", mapandinformation:"Карты и информация", miscellaneous:"Разное",
  mobs:"Мобы", performance:"Производительность", redstone:"Редстоун", serverutility:"Серверные утилиты", storage:"Хранение", technology:"Техника",
  utilityqol:"Утилиты", worldgen:"Генерация мира", playertransport:"Транспорт игрока", automation:"Автоматизация", energy:"Энергия",
  energyfluidanditemtransport:"Энергия, жидкости, предметы", farming:"Фермерство", genetics:"Генетика", processing:"Обработка",
  biomes:"Биомы", dimensions:"Измерения", oresandresources:"Руды и ресурсы", structures:"Структуры", minimap:"Миникарты", information:"Информация",
  addons:"Дополнения", bugfixes:"Исправление ошибок", twitchintegration:"Интеграция с Twitch", cartography:"Картография", buildingandcrafting:"Строительство и крафт"
};
const cfNorm = t=> String(t||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
const cfRuName = n=> CF_RU[cfNorm(n)] || n;
const cfCatCache = {};
async function cfCategoryId(slug, kind){
  const normName = t=> String(t||"").toLowerCase().replace(/[^a-z0-9]+/g,"");
  const list = await (cfCatCache[kind] ??= mmCall("cf:categories", kind).catch(()=>{ delete cfCatCache[kind]; return []; }));
  const want = CF_CAT_ALIAS[slug] || [normName(slug)];
  const hit = list.find(c=> want.includes(normName(c.name)));
  return hit ? String(hit.id) : null;
}
const CurseForge = {
  name:"CurseForge",
  async search({query, category, loader, gameVersion, sort, offset, limit, projectType}){
    const kind = ["modpack","resourcepack","shader","datapack"].includes(projectType) ? projectType : "mod";
    // из «Общего каталога» приходит слаг категории Modrinth; на странице CurseForge, уже числовой id
    if(category && !/^\d+$/.test(category)){
      category = await cfCategoryId(category, kind);
      if(!category) return {total:0, items:[]};
    }
    return mmCall("cf:search", {query, category, loader, gameVersion, sort, offset, limit, kind});
  },
  async details(mod){
    const id = mod.cfId || String(mod.id).split(":")[1];
    const d = await mmCall("cf:details", id);
    // первые 50 файлов уже есть, остальные страницы догружаются в фоне
    if(d.moreFiles) d.versionsPromise = mmCall("cf:files", {id, total:d.totalFiles}).then(rest=> d.versions.concat(rest)).catch(()=>d.versions);
    return d;
  },
  async gameVersions(){ return Modrinth.gameVersions(); }
};

const SOURCES = {modrinth:Modrinth, hangar:Hangar, spiget:Spiget, curseforge:CurseForge};

const SNAPSHOT = [
  {id:"snap:sodium",slug:"sodium",title:"Sodium",author:"jellysquid3",desc:"Современный движок рендеринга, который заметно поднимает FPS и убирает подтормаживания.",downloads:0,follows:0,categories:["optimization"],loaders:["fabric","neoforge"],versions:["1.21.4"],updated:"",url:"https://modrinth.com/mod/sodium",source:"snapshot"},
  {id:"snap:fabric-api",slug:"fabric-api",title:"Fabric API",author:"modmuss50",desc:"Базовые хуки и интерфейсы, на которых держится большинство модов для Fabric.",downloads:0,follows:0,categories:["library"],loaders:["fabric"],versions:["1.21.4"],updated:"",url:"https://modrinth.com/mod/fabric-api",source:"snapshot"},
  {id:"snap:create",slug:"create",title:"Create",author:"simibubi",desc:"Механизмы на вращении: валы, конвейеры, поезда и полностью собираемые машины.",downloads:0,follows:0,categories:["technology"],loaders:["forge","neoforge","fabric"],versions:["1.21.1"],updated:"",url:"https://modrinth.com/mod/create",source:"snapshot"},
  {id:"snap:jei",slug:"jei",title:"Just Enough Items",author:"mezz",desc:"Просмотр рецептов и применений любого предмета прямо в инвентаре.",downloads:0,follows:0,categories:["utility"],loaders:["forge","neoforge","fabric"],versions:["1.21.4"],updated:"",url:"https://modrinth.com/mod/jei",source:"snapshot"},
  {id:"snap:lithium",slug:"lithium",title:"Lithium",author:"jellysquid3",desc:"Оптимизация серверной логики: ИИ мобов, физика и тики блоков считаются быстрее.",downloads:0,follows:0,categories:["optimization"],loaders:["fabric"],versions:["1.21.4"],updated:"",url:"https://modrinth.com/mod/lithium",source:"snapshot"},
  {id:"snap:appleskin",slug:"appleskin",title:"AppleSkin",author:"squeek502",desc:"Показывает насыщение, восстановление голода и точные значения еды в подсказках.",downloads:0,follows:0,categories:["utility"],loaders:["fabric","forge","neoforge"],versions:["1.21.4"],updated:"",url:"https://modrinth.com/mod/appleskin",source:"snapshot"}
];

/* ============================================================
   Общие утилиты
   ============================================================ */
const $ = id => document.getElementById(id);
const nf = new Intl.NumberFormat("ru-RU");
function shortNum(n){
  if(!n) return "-";
  if(n >= 1e6) return (n/1e6).toFixed(1).replace(".",",")+" млн";
  if(n >= 1e3) return Math.round(n/1e3)+" тыс.";
  return String(n);
}
function dateRu(s){ return s ? new Date(s).toLocaleDateString("ru-RU") : "-"; }
let toastTimer, toastFadeTimer;
const TOAST_FADE = 700;   // сколько уведомление растворяется, мс (совпадает с transition в style.css)
function toast(msg, ms){
  const el = $("toast"); el.textContent = msg;
  clearTimeout(toastTimer); clearTimeout(toastFadeTimer);
  el.classList.remove("fading"); el.hidden = false;
  toastTimer = setTimeout(()=>{
    el.classList.add("fading");   // плавно гасим, потом прячем
    toastFadeTimer = setTimeout(()=>{ el.hidden = true; el.classList.remove("fading"); }, TOAST_FADE);
  }, Math.round((ms || 2400) * 1.6));
}

function normTitle(t){ return String(t||"").toLowerCase().replace(/[^a-z0-9а-яё]+/gi,""); }
function ensureShape(item){
  if(!item.sources) item.sources = [item.source];
  if(!item.variants) item.variants = [item];
  return item;
}
function mergeAll(rawItems){
  const map = new Map();
  for(const raw of rawItems){
    const key = normTitle(raw.title);
    if(!key) continue;
    if(map.has(key)){
      const ex = map.get(key);
      if(!ex.sources.includes(raw.source)) ex.sources.push(raw.source);
      ex.variants.push(raw);
      const rank = Math.min(ex._rank ?? 0, raw._rank ?? 0);
      if(raw.downloads > ex.downloads){
        const {sources, variants} = ex;
        Object.assign(ex, raw, {sources, variants});
      }
      ex._rank = rank;
    } else {
      map.set(key, {...raw, sources:[raw.source], variants:[raw]});
    }
  }
  return [...map.values()];
}
function sortItems(list, sortKey){
  const cmp = {
    follows:(a,b)=>(b.follows||0)-(a.follows||0),
    updated:(a,b)=>String(b.updated||"").localeCompare(String(a.updated||"")),
    newest:(a,b)=>String(b.updated||"").localeCompare(String(a.updated||"")),
    downloads:(a,b)=>(b.downloads||0)-(a.downloads||0),
    relevance:(a,b)=>(a._rank ?? 0)-(b._rank ?? 0)   // порядок выдачи площадок (по рангу в своём списке), иначе поиск по слову тонет в самых скачиваемых
  }[sortKey] || ((a,b)=>(b.downloads||0)-(a.downloads||0));
  return [...list].sort(cmp);
}
function passesLoader(item, loader){
  if(!loader) return true;
  if(!item.loaders || !item.loaders.length) return true;
  return item.loaders.includes(loader);
}
function passesCategory(item, cat){
  if(!cat) return true;
  const own = item.categories||[];
  if(own.includes(cat)) return true;
  if(item.variants?.some(v=>(v.categories||[]).includes(cat))) return true;
  // если источник вообще не сообщает категории (например SpigotMC), не отфильтровываем
  const anyCatData = own.length || item.variants?.some(v=>(v.categories||[]).length);
  return !anyCatData;
}
function passesVersion(item, gv){
  if(!gv) return true;
  if(item.versions && item.versions.includes(gv)) return true;
  // источник не сообщает версии (Hangar): карточку не прячем, как и в passesCategory
  const anyVerData = (item.versions||[]).length || item.variants?.some(v=>(v.versions||[]).length);
  if(!anyVerData) return true;
  // если у карточки объединены варианты из нескольких источников, проверяем версии в каждом из них
  if(item.variants?.some(v=>(v.versions||[]).includes(gv))) return true;
  return false;
}

async function fetchSources(keys, params){
  const results = await Promise.allSettled(keys.map(k=>SOURCES[k].search({...params})));
  // если выбран только «ModMatrix», он единственный основной источник и сам отдаёт страницы
  const only = keys.every(k=> k === "modmatrix");
  const isMain = k => only || k !== "modmatrix";
  const main = results.filter((r,i)=> isMain(keys[i]) && r.status==="fulfilled");
  const raw = results.filter(r=>r.status==="fulfilled").flatMap(r=>r.value.items.map((it,i)=>{ it._rank = i; return it; }));
  const exhausted = main.every(r=> r.value.items.length < (params.limit||24));
  // все ответившие источники сообщили общее число, тогда известно и число страниц (по самому большому из них)
  const tots = main.map(r=>r.value.total);
  const known = tots.length > 0 && tots.every(t=> typeof t === "number");
  const total = known ? tots.reduce((a,b)=>a+b, 0) : null;
  const pageBase = known ? Math.max(...tots) : null;
  const failed = keys.map((k,i)=> results[i].status === "rejected" && results[i].reason?.name !== "AbortError"
    ? {key:k, msg:String(results[i].reason?.message || results[i].reason)} : null).filter(Boolean);
  return {raw, exhausted, total, pageBase, anyOk: main.length>0, failed};
}

/* ---------- Singleton: список версий игры (загружается один раз) ---------- */
class GameVersionsCache {
  static #instance = null;
  static getInstance(){
    return (GameVersionsCache.#instance ??= new GameVersionsCache());
  }

  #list = null;

  constructor(){
    if(GameVersionsCache.#instance) throw new Error("GameVersionsCache, синглтон, используйте GameVersionsCache.getInstance()");
  }

  async get(){
    if(this.#list) return this.#list;
    try{ this.#list = await Modrinth.gameVersions(); }catch(e){ this.#list = []; }
    return this.#list;
  }
}
const getGameVersions = ()=> GameVersionsCache.getInstance().get();

/* ============================================================
   Избранное и тема, постоянное хранилище
   ============================================================ */
const state = { page:null };

/* ---------- Singleton: хранилище избранного ----------
   Один экземпляр на всё приложение. Прямой `new FavoritesStore()` запрещён -
   только FavoritesStore.getInstance(). */
class FavoritesStore {
  static #instance = null;
  static getInstance(){
    return (FavoritesStore.#instance ??= new FavoritesStore());
  }

  #items = new Map();
  #key = "modmatrix:favorites";

  constructor(){
    if(FavoritesStore.#instance) throw new Error("FavoritesStore, синглтон, используйте FavoritesStore.getInstance()");
    this.#load();
  }

  #load(){
    try{
      const raw = localStorage.getItem(this.#key);
      if(!raw) return;
      const parsed = JSON.parse(raw);
      if(parsed && typeof parsed === "object" && !Array.isArray(parsed)){
        Object.entries(parsed).forEach(([id,item])=> this.#items.set(id,item));
      }
    }catch(e){}
  }
  #save(){
    try{
      const obj = {};
      this.#items.forEach((v,k)=> obj[k]=v);
      localStorage.setItem(this.#key, JSON.stringify(obj));
    }catch(e){}
  }

  has(id){ return this.#items.has(id); }
  get size(){ return this.#items.size; }
  values(){ return this.#items.values(); }

  /** Возвращает true, если карточка добавлена, и false, если убрана. */
  toggle(m){
    const added = !this.#items.has(m.id);
    if(added) this.#items.set(m.id, FavoritesStore.toPlain(m));
    else this.#items.delete(m.id);
    this.#save();
    return added;
  }
  clear(){ this.#items.clear(); this.#save(); }

  static toPlain(m){
    return {
      id:m.id, slug:m.slug, title:m.title, author:m.author, desc:m.desc, icon:m.icon, cover:m.cover||null,
      downloads:m.downloads, follows:m.follows, categories:m.categories||[], loaders:m.loaders||[],
      versions:m.versions||[], updated:m.updated, url:m.url, source:m.source, kind:m.kind||"mod",
      sources:m.sources||[m.source],
      variants:(m.variants||[m]).map(v=>({id:v.id,title:v.title,url:v.url,source:v.source}))
    };
  }
}
const favorites = FavoritesStore.getInstance();

/* Свои сборки в избранном: именованные списки id избранных карточек. Хранятся рядом с избранным. */
const collections = (()=>{
  const KEY = "modmatrix:collections";
  let list = [];
  try{ const p = JSON.parse(localStorage.getItem(KEY)||"[]"); if(Array.isArray(p)) list = p.filter(c=> c && c.id && typeof c.name==="string" && Array.isArray(c.ids)); }catch(e){}
  const save = ()=>{ try{ localStorage.setItem(KEY, JSON.stringify(list)); }catch(e){} };
  const clean = n=> String(n||"").trim().slice(0,40);
  return {
    all: ()=> list,
    get: id=> list.find(c=> c.id===id),
    // убрали карточку из избранного, она исчезает и из сборок
    prune(){ let ch=false; list.forEach(c=>{ const n = c.ids.filter(i=> favorites.has(i)); if(n.length!==c.ids.length){ c.ids=n; ch=true; } }); if(ch) save(); },
    create(name){ name = clean(name); if(!name) return null;
      const ex = list.find(c=> c.name.toLowerCase()===name.toLowerCase()); if(ex) return ex;
      const c = {id:"c"+Date.now().toString(36)+Math.random().toString(36).slice(2,5), name, ids:[]}; list.push(c); save(); return c; },
    rename(id, name){ const c = this.get(id); name = clean(name); if(c && name){ c.name = name; save(); } },
    remove(id){ list = list.filter(c=> c.id!==id); save(); },
    has(id, favId){ const c = this.get(id); return !!c && c.ids.includes(favId); },
    toggle(id, favId){ const c = this.get(id); if(!c) return false;
      const i = c.ids.indexOf(favId); if(i>=0) c.ids.splice(i,1); else c.ids.push(favId); save(); return i<0; }
  };
})();

/* Окно «Куда добавить»: показывается, когда у пользователя есть сборки.
   Выбор: основное избранное или одна из сборок (карточка попадёт и в избранное, и в сборку). Отмена, ничего не меняется. */
function pickFavTarget(m){
  return new Promise(resolve=>{
    const safe = t=> String(t).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    const dlg = document.createElement("dialog");
    dlg.className = "fav-pick";
    dlg.setAttribute("aria-label", "Куда добавить в избранное");
    dlg.innerHTML = `
      <div class="m-head"><div><h2>Куда добавить?</h2><div class="by">${safe(m.title)}</div></div></div>
      <div class="fp-body">
        <button type="button" class="fp-opt" data-t="main"><b>Основное избранное</b><span>Без сборки</span></button>
        ${collections.all().map(c=>`<button type="button" class="fp-opt" data-t="${safe(c.id)}"><b>${safe(c.name)}</b><span>Сборка · ${c.ids.length}</span></button>`).join("")}
        <form class="coll-new"><input type="text" maxlength="40" placeholder="Новая сборка" aria-label="Название новой сборки"><button class="btn" type="submit">＋ Создать и добавить</button></form>
      </div>
      <div class="m-foot"><button type="button" class="btn" data-t="cancel">Отмена</button></div>`;
    let done = false;
    const finish = (colId, colName)=>{
      done = true;
      if(!favorites.has(m.id)) favorites.toggle(m);
      if(colId && !collections.has(colId, m.id)) collections.toggle(colId, m.id);
      toast(colName ? `${m.title} добавлен в «${colName}»` : `${m.title} в избранном`);
      updateFavCount();
      dlg.close();
    };
    dlg.addEventListener("click", e=>{
      if(e.target === dlg){ dlg.close(); return; }
      const b = e.target.closest("[data-t]"); if(!b) return;
      const t = b.dataset.t;
      if(t === "cancel") dlg.close();
      else if(t === "main") finish(null);
      else { const c = collections.get(t); if(c) finish(c.id, c.name); }
    });
    dlg.addEventListener("submit", e=>{
      e.preventDefault();
      const c = collections.create(dlg.querySelector("input").value);
      if(c) finish(c.id, c.name);
    });
    dlg.addEventListener("close", ()=>{ dlg.remove(); resolve(done); });
    document.body.appendChild(dlg);
    dlg.showModal();
  });
}

/* Возвращает промис: true, состояние избранного изменилось. Если сборки есть, при добавлении спрашиваем, куда именно. */
async function toggleFav(m){
  if(!favorites.has(m.id) && collections.all().length){
    return pickFavTarget(m);
  }
  const added = favorites.toggle(m);
  toast(added ? `${m.title} в избранном` : `${m.title} убран из избранного`);
  updateFavCount();
  return true;
}
function updateFavCount(){
  const n = favorites.size;
  $("favCount").textContent = n ? String(n) : "";
}

const THEMES = [
  {id:"amber",  label:"Янтарная",   c1:"#f5a742", c2:"#c97a1e"},
  {id:"green",  label:"Зелёная", c1:"#04f063", c2:"#01ce50"},
  {id:"mono",   label:"Чёрно-белая", c1:"#f2f2f2", c2:"#b5b5b5"},
  {id:"blue",   label:"Синяя",      c1:"#4d8dff", c2:"#2e63d6"},
  {id:"purple", label:"Фиолетовая", c1:"#a875f5", c2:"#7c4fd1"},
  {id:"rose",   label:"Розовая",    c1:"#f5679a", c2:"#d63d76"}
];
/* ---------- Singleton: пользовательские настройки (тема, сортировка, язык) ---------- */
class SettingsStore {
  static #instance = null;
  static getInstance(){
    return (SettingsStore.#instance ??= new SettingsStore());
  }

  #prefix = "modmatrix:";

  constructor(){
    if(SettingsStore.#instance) throw new Error("SettingsStore, синглтон, используйте SettingsStore.getInstance()");
  }

  #read(key){ try{ return localStorage.getItem(this.#prefix + key); }catch(e){ return null; } }
  #write(key, value){ try{ localStorage.setItem(this.#prefix + key, value); }catch(e){} }

  get theme(){ return this.#read("theme") || "amber"; }
  set theme(v){
    const t = v || "amber";
    document.documentElement.dataset.theme = t;
    this.#write("theme", t);
  }

  get defaultSort(){ return this.#read("defaultSort") || "downloads"; }
  set defaultSort(v){ this.#write("defaultSort", v); }

  get view(){ return this.#read("view") === "compact" ? "compact" : "cards"; }   // по умолчанию, раскрытые карточки
  set view(v){ this.#write("view", v === "compact" ? "compact" : "cards"); }

  get lang(){ return this.#read("lang") ?? "ru"; }
  set lang(v){ this.#write("lang", v || ""); }
}
const settings = SettingsStore.getInstance();

function getTheme(){ return settings.theme; }
function setTheme(v){ settings.theme = v; }
function getDefaultSort(){ return settings.defaultSort; }
function setDefaultSort(v){ settings.defaultSort = v; }

/* ============================================================
   Автоперевод описаний (бесплатный переводчик без ключа)
   ============================================================ */
const LANGS = [
  {id:"",   label:"Не переводить, оставить оригинал"},
  {id:"ru", label:"Русский"},
  {id:"en", label:"English"},
  {id:"uk", label:"Українська"},
  {id:"de", label:"Deutsch"},
  {id:"es", label:"Español"},
  {id:"fr", label:"Français"},
  {id:"pl", label:"Polski"},
  {id:"tr", label:"Türkçe"}
];
function getLang(){ return settings.lang; }
function setLang(v){ settings.lang = v; }

function isMostlyCyrillic(s){
  const letters = String(s||"").match(/[a-zа-яё]/gi) || [];
  if(letters.length < 8) return false;
  const cyr = letters.filter(c=>/[а-яё]/i.test(c)).length;
  return cyr / letters.length > 0.5;
}

/* ---------- Singleton: переводчик с общим кэшем ----------
   Как это работает:
   • Кэш хранится не только в памяти, но и в localStorage: переведённое один раз больше не запрашивается
     (после перезапуска лаунчера описания сразу русские, без сотен новых запросов).
   • Описания с экрана переводятся пачками: до 8 коротких текстов в одном запросе, вместо одного запроса на карточку.
     Так бесплатный сервис не отвечает 429, как раньше при листании страниц.
   • Если первый сервис отказал, пробуются запасные (Google Translate из расширения Chrome, затем MyMemory).
   • Карточки, которые видны на экране, переводятся первыми; ушедшие со страницы пропускаются.
   • Неудача не запоминается как «перевод не нужен»: для карточки на экране запрос повторяется с нарастающей паузой. */
function hash53(str){
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for(let i = 0, ch; i < str.length; i++){
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
class Translator {
  static #instance = null;
  static getInstance(){
    return (Translator.#instance ??= new Translator());
  }

  static #STORE = "modmatrix:trcache1";
  static #MAX_ENTRIES = 3000;
  static #MAX_CHARS = 1500000;
  static #BATCH_ITEMS = 8;
  static #BATCH_CHARS = 1500;
  static #SINGLE_MAX = 4500;           // текст длиннее режем на части по предложениям

  #cache = new Map();          // ключ -> перевод (удачные, сохраняются на диск)
  #failedAt = new Map();       // ключ -> время последней неудачи
  #waiting = new Map();        // ключ -> общий промис, чтобы одинаковый текст не уходил дважды
  #queue = [];
  #active = 0;
  #max = 3;                    // одновременных запросов (каждый несёт до 8 текстов); вся страница переводится сразу, видимые карточки первыми
  #cooldownUntil = 0;
  #timer = null;
  #saveTimer = null;
  #soon = null;

  constructor(){
    if(Translator.#instance) throw new Error("Translator, синглтон, используйте Translator.getInstance()");
    this.#load();
  }

  #key(text, lang){ return lang + ":" + hash53(text).toString(36) + ":" + text.length; }

  #load(){
    try{
      const raw = localStorage.getItem(Translator.#STORE);
      if(!raw) return;
      const obj = JSON.parse(raw);
      for(const [k, v] of Object.entries(obj)) if(typeof v === "string" && v) this.#cache.set(k, v);
    }catch(e){ /* повреждённый кэш просто не используется */ }
  }
  #scheduleSave(){
    if(this.#saveTimer) return;
    this.#saveTimer = setTimeout(()=>{
      this.#saveTimer = null;
      try{
        while(this.#cache.size > Translator.#MAX_ENTRIES) this.#cache.delete(this.#cache.keys().next().value);
        let chars = 0; for(const v of this.#cache.values()) chars += v.length;
        while(chars > Translator.#MAX_CHARS && this.#cache.size){
          const k = this.#cache.keys().next().value; chars -= this.#cache.get(k).length; this.#cache.delete(k);
        }
        localStorage.setItem(Translator.#STORE, JSON.stringify(Object.fromEntries(this.#cache)));
      }catch(e){ /* хранилище недоступно или переполнено: работаем только с памятью */ }
    }, 2000);
  }

  /* Прямой перевод одного текста в обход очереди и пачек: им добивают карточки, которые остались английскими.
     Возвращает перевод или null; удачный результат попадает в общий кэш. */
  #direct = new Map();
  forceOne(text, lang){
    const src = this.#norm(text);
    const key = this.#key(src, lang);
    if(this.#cache.has(key) && !this.#same(src, this.#cache.get(key))) return Promise.resolve(this.#cache.get(key));
    if(this.#direct.has(key)) return this.#direct.get(key);
    const pr = this.#translateLong(lang, src).then(t => {
      if(t && !this.#same(src, t)){ this.#cache.set(key, t); this.#failedAt.delete(key); this.#scheduleSave(); return t; }
      return null;
    }).catch(() => null).finally(() => this.#direct.delete(key));
    this.#direct.set(key, pr);
    return pr;
  }

  /* перевод уже есть (или нужно ли пробовать ещё раз): для повторных попыток карточек на экране */
  failed(text, lang){
    const key = this.#key(this.#norm(text), lang);
    return !this.#cache.has(key) && this.#failedAt.has(key);
  }
  #norm(text){ return String(text).replace(/\s+/g, " ").trim(); }
  /* сервис вернул тот же английский текст: для длинной фразы это отказ (или неверно определённый язык), а не перевод */
  #same(src, t){
    const a = this.#norm(src), b = this.#norm(t);
    return a.length >= 25 && a.split(" ").length >= 4 && a.toLowerCase() === b.toLowerCase();
  }

  /* stale: функция «результат уже не нужен» (карточка исчезла), тогда запрос не отправляется;
     node: элемент, куда пойдёт перевод (видимые на экране переводятся первыми) */
  translate(text, lang, stale, node){
    if(!text || !lang) return Promise.resolve(text);
    const src = this.#norm(text);
    if(!src) return Promise.resolve(text);
    const key = this.#key(src, lang);
    if(this.#cache.has(key)){
      if(!this.#same(src, this.#cache.get(key))) return Promise.resolve(this.#cache.get(key));
      this.#cache.delete(key);      // в кэш раньше попал непереведённый оригинал: переводим заново
    }
    const failed = this.#failedAt.get(key);
    if(failed && Date.now() - failed < 3000) return Promise.resolve(text);
    return new Promise(resolve => {
      this.#queue.push({ key, text: src, original: text, lang, stale, node, resolve });
      // карточки страницы создаются подряд: даём им набраться в очередь, чтобы уйти одной пачкой
      if(!this.#soon) this.#soon = setTimeout(() => { this.#soon = null; this.#pump(); }, 40);
    });
  }

  #onScreen(node){
    if(!node) return true;                 // без привязки к элементу (не карточка) переводим сразу
    if(!node.isConnected) return false;
    const r = node.getBoundingClientRect();
    return r.bottom > -150 && r.top < innerHeight + 450;
  }

  #pump(){
    clearTimeout(this.#timer); this.#timer = null;
    const wait = this.#cooldownUntil - Date.now();
    if(wait > 0){ this.#timer = setTimeout(() => this.#pump(), wait + 20); return; }
    while(this.#active < this.#max && this.#queue.length){
      const batch = this.#takeBatch();
      if(!batch.length) break;
      this.#active++;
      this.#translateBatch(batch).catch(()=>{}).finally(() => {
        for(const j of batch){ if(this.#waiting.get(j.key)){ this.#failedAt.set(j.key, Date.now()); this.#waiting.delete(j.key); j.settle(j.original); } }
        this.#active--; this.#pump();
      });
    }
  }

  #takeBatch(){
    // те, что на экране, идут первыми
    const vis = new Map();
    for(const j of this.#queue) vis.set(j, this.#onScreen(j.node) ? 1 : 0);
    this.#queue.sort((a, b) => vis.get(b) - vis.get(a));
    const batch = [];
    let size = 0, lang = null;
    while(this.#queue.length && batch.length < Translator.#BATCH_ITEMS){
      const job = this.#queue[0];
      if(job.stale && job.stale()){ this.#queue.shift(); job.resolve(job.original); continue; }   // страницу уже сменили
      if(this.#cache.has(job.key)){ this.#queue.shift(); job.resolve(this.#cache.get(job.key)); continue; }
      if(this.#waiting.has(job.key)){ this.#queue.shift(); this.#waiting.get(job.key).then(job.resolve); continue; }
      if(lang && job.lang !== lang) break;                       // в одном запросе один язык
      if(job.text.length > 600 && batch.length) break;            // длинные тексты идут отдельным запросом
      if(batch.length && size + job.text.length > Translator.#BATCH_CHARS) break;
      this.#queue.shift();
      lang = job.lang; size += job.text.length;
      const d = new Promise(r => { job.settle = r; });
      this.#waiting.set(job.key, d);
      d.then(job.resolve);
      batch.push(job);
      if(job.text.length > 600) break;
    }
    return batch;
  }

  async #translateBatch(batch){
    const lang = batch[0].lang;
    let out = null;
    if(batch.length > 1){
      const lines = await this.#remote(lang, batch.map(j => j.text).join("\n"));
      const parts = lines == null ? null : lines.split("\n").map(s => s.trim());
      // строки должны совпасть по числу и не быть пустыми, иначе пачка могла «съехать»: тогда переводим по одной
      if(parts && parts.length === batch.length && parts.every(Boolean)) out = parts;
      else if(lines != null && parts && parts.length === batch.length){
        // часть строк пустая: берём хорошие, остальные переведём отдельно ниже
        out = parts.map(x => x || null);
      }
    }
    if(!out){
      out = [];
      for(const j of batch){
        out.push(j.stale && j.stale() ? false : await this.#translateLong(lang, j.text));   // false: карточка ушла, ничего не запоминаем
      }
    }else{
      // строки пачки, которые пришли пустыми или совпали с оригиналом, переводим отдельно
      for(let i = 0; i < batch.length; i++){
        const j = batch[i];
        if(out[i] && !this.#same(j.text, out[i])) continue;
        out[i] = j.stale && j.stale() ? false : await this.#translateLong(lang, j.text);
      }
    }
    batch.forEach((job, i) => {
      const t = out[i];
      if(t === false){
        // пропущено: запрос не отправлялся
      }else if(t && !this.#same(job.text, t)){
        this.#cache.set(job.key, t);
        this.#failedAt.delete(job.key);
      }else{
        this.#failedAt.set(job.key, Date.now());              // не кэшируем оригинал как перевод
      }
      this.#waiting.delete(job.key);
      job.settle(t || job.original);
    });
    this.#scheduleSave();
  }

  /* длинный текст режется по предложениям на куски, чтобы каждый ушёл целиком */
  async #translateLong(lang, text){
    if(text.length <= Translator.#SINGLE_MAX){
      const r = await this.#remote(lang, text);
      return r ? r.replace(/\s*\n\s*/g, " ").trim() : null;
    }
    const chunks = []; let cur = "";
    for(const s of text.split(/(?<=[.!?。])\s+/)){
      if(cur && (cur + " " + s).length > Translator.#SINGLE_MAX){ chunks.push(cur); cur = s; }
      else cur = cur ? cur + " " + s : s;
    }
    if(cur) chunks.push(cur);
    const done = [];
    for(const c of chunks.flatMap(c => c.length > Translator.#SINGLE_MAX ? c.match(new RegExp(".{1," + Translator.#SINGLE_MAX + "}", "gs")) : [c])){
      const r = await this.#remote(lang, c);
      if(!r) return null;
      done.push(r.replace(/\s*\n\s*/g, " ").trim());
    }
    return done.join(" ");
  }

  /* перебор сервисов: у каждого свои лимиты, поэтому отказ одного не ломает перевод.
     Сервис, который ответил 429 или не отвечает, откладывается на растущее время (до 15 минут), чтобы не долбить
     заблокированный адрес (от этого блокировка только затягивается) и сразу идти к рабочему. */
  #bad = new Map(); #badN = new Map(); #lastNote = new Map();
  static #NAMES = ["bing", "google", "googleWeb", "chromeExt", "lingva", "myMemory"];
  /* все сервисы сейчас в «отдыхе»: безнадёжно спрашивать ещё раз прямо сейчас */
  resting(){
    const now = Date.now();
    return Translator.#NAMES.every(n => (this.#bad.get(n) || 0) > now);
  }
  #note(key, msg){
    // в translate.log (папка данных лаунчера) и в консоль; не чаще раза в 20 секунд на ключ
    const now = Date.now();
    if(now - (this.#lastNote.get(key) || 0) < 20000) return;
    this.#lastNote.set(key, now);
    try{ console.warn("[translate] " + msg); if(window.mm && window.mm.invoke) window.mm.invoke("tr:log", msg).catch(()=>{}); }catch(e){ /* лог не критичен */ }
  }
  async #remote(lang, q){
    // [имя, сервис, сколько ждать мс]: в лаунчере первым идёт Microsoft (через основной процесс, без CORS и с точной пачкой),
    // затем Google-варианты, затем запасные Lingva и MyMemory, которые принимают короткие куски и потому идут построчно
    const providers = [
      ["bing", Translator.#bing, 20000],
      ["google", Translator.#google, 12000], ["googleWeb", Translator.#googleWeb, 12000], ["chromeExt", Translator.#chromeExt, 12000],
      ["lingva", Translator.#perPiece(Translator.#lingva, 700), 40000],
      ["myMemory", Translator.#perPiece(Translator.#myMemory, 450), 40000]
    ];
    const errs = [];
    for(let round = 1; round <= 2; round++){
      for(const [name, p, ms] of providers){
        if((this.#bad.get(name) || 0) > Date.now()) continue;
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), ms);
        try{
          const r = await p(lang, q, ctrl.signal);
          if(r){
            this.#bad.delete(name); this.#badN.delete(name);
            this.#note("ok:" + name, "работает: " + name);
            return r;
          }
          // пусто: сервис не вернул перевод (или недоступен вне лаунчера), без штрафа
          if(name !== "bing" || (window.mm && window.mm.invoke)) errs.push(name + ": пустой ответ");
        }catch(e){
          const busy = !!(e && e.busy);
          const n = (this.#badN.get(name) || 0) + 1; this.#badN.set(name, n);
          this.#bad.set(name, Date.now() + (busy ? Math.min(900000, 60000 * 2 ** (n - 1)) : Math.min(120000, 15000 * n)));
          errs.push(name + ": " + ((e && e.message) || e));
          if(busy) this.#cooldownUntil = Math.max(this.#cooldownUntil, Date.now() + 2500 * round);   // просят притормозить: пауза для всей очереди
        }finally{
          clearTimeout(t);
        }
      }
      await new Promise(res => setTimeout(res, 500 * round));
    }
    if(errs.length) this.#note("fail", "перевод не удался. " + errs.slice(-8).join("; "));
    // один раз за пять минут: основной процесс проверяет каждый сервис отдельно и пишет итог в translate.log
    try{ if(window.mm && window.mm.invoke) window.mm.invoke("tr:diag").catch(()=>{}); }catch(e){ /* диагностика не критична */ }
    return null;
  }

  static async #google(lang, q, signal){
    const p = new URLSearchParams({client:"gtx", sl:"auto", tl:lang, dt:"t", q});
    // длинный текст не помещается в адрес запроса, отправляем телом
    const r = q.length > 900
      ? await fetch("https://translate.googleapis.com/translate_a/single", { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:p, signal })
      : await fetch(`https://translate.googleapis.com/translate_a/single?${p}`, { signal });
    if(r.status === 429 || r.status >= 500){ const e = new Error("busy " + r.status); e.busy = true; throw e; }
    if(!r.ok) throw new Error("translate failed " + r.status);
    const data = await r.json();
    const out = (data[0] || []).map(chunk => (chunk && chunk[0]) || "").join("");
    return out || null;
  }
  /* Microsoft Edge Translate через основной процесс лаунчера: работает, когда Google отвечает 429 или недоступен.
     Строки приходят и уходят массивом, поэтому пачка не «съезжает». В браузере без лаунчера не используется. */
  static async #bing(lang, q, signal){
    const mm = window.mm;
    if(!mm || !mm.invoke) return null;
    const lines = q.split("\n");
    const r = await Promise.race([
      mm.invoke("tr:bing", { lang, texts: lines }),
      new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted")), { once:true }))
    ]);
    if(!r) throw new Error("нет ответа от лаунчера");
    if(!r.ok) throw new Error(r.error || "ошибка основного процесса");   // настоящая причина (сеть, 401 и т.д.) попадёт в translate.log
    if(!Array.isArray(r.data) || r.data.length !== lines.length) throw new Error("ответ Microsoft не совпал по числу строк");
    if(r.data.some((t, i) => lines[i].trim() && !t)) throw new Error("Microsoft вернул пустые строки");
    return r.data.join("\n");
  }
  /* тот же сервис Google на другом адресе: у адресов отдельные счётчики запросов */
  static async #googleWeb(lang, q, signal){
    const p = new URLSearchParams({client:"gtx", sl:"auto", tl:lang, dt:"t"});
    const r = await fetch(`https://translate.google.com/translate_a/single?${p}`, { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:new URLSearchParams({q}), signal });
    if(r.status === 429 || r.status >= 500){ const e = new Error("busy " + r.status); e.busy = true; throw e; }
    if(!r.ok) throw new Error("translate failed " + r.status);
    const data = await r.json();
    return (data[0] || []).map(chunk => (chunk && chunk[0]) || "").join("") || null;
  }
  /* Lingva: открытый переводчик без ключа, несколько зеркал; принимает короткий текст в адресе */
  static async #lingva(lang, q, signal){
    let lastErr = null;
    for(const host of ["https://lingva.ml", "https://lingva.lunar.icu", "https://translate.plausibility.cloud"]){
      try{
        const r = await fetch(`${host}/api/v1/auto/${lang}/${encodeURIComponent(q)}`, { signal });
        if(r.status === 429){ const e = new Error("busy"); e.busy = true; throw e; }
        if(!r.ok) throw new Error("translate failed " + r.status);
        const data = await r.json();
        if(data && typeof data.translation === "string" && data.translation.trim()) return data.translation;
      }catch(e){ if(signal.aborted) throw e; lastErr = e; }
    }
    if(lastErr && lastErr.busy) throw lastErr;
    return null;
  }
  /* обёртка: режет текст по строкам и предложениям на куски не длиннее max, переводит каждый и собирает обратно */
  static #perPiece(fn, max){
    const cut = line => {
      if(line.length <= max) return [line];
      const out = []; let cur = "";
      for(const sent of line.split(/(?<=[.!?。])\s+/)){
        for(const piece of (sent.length > max ? sent.match(new RegExp(".{1," + max + "}", "gs")) : [sent])){
          if(cur && (cur + " " + piece).length > max){ out.push(cur); cur = piece; }
          else cur = cur ? cur + " " + piece : piece;
        }
      }
      if(cur) out.push(cur);
      return out;
    };
    return async (lang, q, signal) => {
      const lines = [];
      for(const line of q.split("\n")){
        if(!line.trim()){ lines.push(line); continue; }
        const done = [];
        for(const piece of cut(line)){
          const r = await fn(lang, piece, signal);
          if(!r) return null;
          done.push(r.trim());
        }
        lines.push(done.join(" "));
      }
      return lines.join("\n");
    };
  }
  static async #chromeExt(lang, q, signal){
    const p = new URLSearchParams({client:"dict-chrome-ex", sl:"auto", tl:lang, q});
    const r = await fetch(`https://clients5.google.com/translate_a/t?${p}`, { signal });
    if(r.status === 429 || r.status >= 500){ const e = new Error("busy " + r.status); e.busy = true; throw e; }
    if(!r.ok) throw new Error("translate failed " + r.status);
    const data = await r.json();
    if(data && Array.isArray(data.sentences)) return data.sentences.map(s => s.trans || "").join("") || null;
    if(Array.isArray(data)) return data.map(x => Array.isArray(x) ? x[0] : x).filter(x => typeof x === "string").join("\n") || null;
    return null;
  }
  static async #myMemory(lang, q, signal){
    const p = new URLSearchParams({q, langpair:"Autodetect|" + lang});
    const r = await fetch(`https://api.mymemory.translated.net/get?${p}`, { signal });
    if(r.status === 429){ const e = new Error("busy"); e.busy = true; throw e; }
    if(!r.ok) throw new Error("translate failed " + r.status);
    const data = await r.json();
    const t = data && data.responseData && data.responseData.translatedText;
    if(!t || Number(data.responseStatus) !== 200 || /MYMEMORY WARNING|INVALID/i.test(t)) return null;
    return t;
  }
}
const translateText = (text, lang, stale, node)=> Translator.getInstance().translate(text, lang, stale, node);
let translateEpoch = 0;   // растёт при каждой новой отрисовке страницы: карточки прошлой отрисовки уже не нужны
const RETRY_DELAYS = [3000, 6000, 10000, 15000, 30000, 45000, 60000, 60000, 60000, 60000];   // паузы между повторами для карточки на экране
function maybeTranslate(node, text){
  const lang = getLang();
  if(!lang || !text || !node) return;
  if(lang === "ru" && isMostlyCyrillic(text)) return;
  // Карточку создают заранее и вставляют в страницу чуть позже, поэтому «не нужна» она только когда
  // уже не на экране после новой отрисовки страницы или так и не появилась за 15 секунд
  const born = Date.now(), epoch = translateEpoch;
  node.__trSrc = text; node.__trLang = lang; node.__trBorn = born;
  trPending.add(node);
  const stale = () => {
    if(node.isConnected) return false;
    return epoch !== translateEpoch || Date.now() - born > 15000;   // ушла со страницы (началась новая отрисовка) или так и не появилась
  };
  const run = attempt => {
    translateText(text, lang, stale, node).then(t=>{
      if(stale()) return;
      if(t && t !== text){
        node.textContent = t;
        node.classList.add("translated");
        trPending.delete(node);
      }else if(Translator.getInstance().failed(text, lang) && attempt < RETRY_DELAYS.length){
        // сервис не ответил: пока карточка на экране, пробуем снова, с нарастающей паузой
        setTimeout(()=>{ if(node.isConnected && epoch === translateEpoch) run(attempt + 1); }, RETRY_DELAYS[attempt]);
      }
    });
  };
  setTimeout(()=> run(0), 0);
}

/* Подстраховка: всё, что на экране осталось английским (очередь, пачка или повторы не справились),
   каждые несколько секунд переводится напрямую, по одному тексту, всеми сервисами по очереди. */
const trPending = new Set();
const trOnScreen = n => { const r = n.getBoundingClientRect(); return r.bottom > -100 && r.top < innerHeight + 300; };
setInterval(()=>{
  let started = 0;
  const pend = [...trPending].sort((a, b) => (b.isConnected && trOnScreen(b)) - (a.isConnected && trOnScreen(a)));
  for(const node of pend){
    if(!node.isConnected){ if(Date.now() - node.__trBorn > 20000) trPending.delete(node); continue; }
    if(node.classList.contains("translated") || getLang() !== node.__trLang){ trPending.delete(node); continue; }
    if(Translator.getInstance().resting()) break;   // все сервисы отдыхают после отказов: не добиваем их запросами
    if(node.__trBusy || Date.now() - node.__trBorn < 8000 || Date.now() - (node.__trLast || 0) < 12000) continue;
    if(started >= 2) break;
    started++;
    node.__trBusy = true; node.__trLast = Date.now();
    Translator.getInstance().forceOne(node.__trSrc, node.__trLang).then(t=>{
      node.__trBusy = false;
      if(t && node.isConnected && !node.classList.contains("translated")){
        node.textContent = t; node.classList.add("translated"); trPending.delete(node);
      }
    });
  }
}, 4000);

/* ============================================================
   Карточка мода, общий рендер для всех страниц
   ============================================================ */
function tileHTML(m){
  return m.icon
    ? `<img src="${m.icon}" alt="" loading="lazy" onerror="this.remove()">`
    : `<span aria-hidden="true">▦</span>`;
}
function badgesHTML(m){
  return (m.sources||[m.source]).map(s=>{
    const meta = SOURCE_META[s] || {label:s};
    return `<span class="src-badge src-badge--${s}">${meta.label}</span>`;
  }).join("");
}
function buildCard(m, onChange){
  const f = activeFilters();
  const shownLoaders = f.loader && (m.loaders||[]).includes(f.loader) ? [f.loader] : (m.loaders||[]);
  const shownVersion = f.gv && passesVersion(m, f.gv) ? f.gv : (m.versions?.length ? m.versions[m.versions.length-1] : "");
  const el = document.createElement("article");
  el.className = "card"; el.tabIndex = 0; el.setAttribute("role","button");
  el.setAttribute("aria-label", `Открыть карточку ${m.title}`);
  el.innerHTML = `
    ${m.cover && m.kind !== "plugin" ? `<div class="card-cover"><img src="${m.cover}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>` : ""}
    <div class="card-head">
      <div class="tile">${tileHTML(m)}</div>
      <div>
        <h3>${hl(m.title, f.q)}</h3>
        <div class="by">${m.author || "-"}${m.categories[0] ? " · " + catLabel(m.categories[0]) : ""}</div>
      </div>
    </div>
    <div class="badges">${badgesHTML(m)}</div>
    <div class="card-body"><p>${m.desc || ""}</p></div>
    <div class="tags">${shownLoaders.map(l=>`<span class="tag ld">${ldIcon(l)}${LOADER_LABEL[l]||l}</span>`).join("")}
      ${shownVersion ? `<span class="tag">${shownVersion}</span>` : ""}</div>
    <div class="card-foot">
      <span>${shortNum(m.downloads)}</span>
      <span>обн. ${dateRu(m.updated)}</span>
      <button class="fav" aria-pressed="${favorites.has(m.id)}" aria-label="В избранное">★</button>
    </div>`;
  el.querySelector(".fav").addEventListener("click", async e=>{ e.stopPropagation(); if(await toggleFav(m)) onChange?.(); });
  const open = ()=> openModal(m);
  el.addEventListener("click", open);
  el.addEventListener("keydown", e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); open(); }});
  if(m.desc) maybeTranslate(el.querySelector(".card-body p"), m.desc);
  hydrateCover(m, el);
  return el;
}

/* ---------- обложки для карточек без официальной галереи ----------
   У многих проектов нет ни галереи Modrinth, ни скриншотов CurseForge, а картинки лежат только в длинном описании
   (в окне мода они есть, а в списке карточка без обложки). Когда такая карточка попадает на экран, лаунчер достаёт
   описание проекта, берёт первую картинку, похожую на скриншот, и ставит её обложкой. Результат запоминается на диске. */
const CoverFinder = {
  KEY:"modmatrix:cover1", TTL_FOUND:30*864e5, TTL_NONE:3*864e5, MAX:1500,
  cache:null, queue:[], active:0, MAXPAR:2, pending:new Map(), saveTimer:null,
  load(){
    if(this.cache) return;
    this.cache = new Map();
    try{ for(const [k,v] of Object.entries(JSON.parse(localStorage.getItem(this.KEY) || "{}"))) this.cache.set(k, v); }catch(e){}
  },
  save(){
    if(this.saveTimer) return;
    this.saveTimer = setTimeout(()=>{
      this.saveTimer = null;
      try{
        while(this.cache.size > this.MAX) this.cache.delete(this.cache.keys().next().value);
        localStorage.setItem(this.KEY, JSON.stringify(Object.fromEntries(this.cache)));
      }catch(e){}
    }, 1500);
  },
  cached(id){
    this.load();
    const e = this.cache.get(id);
    if(!e) return undefined;
    if(Date.now() - e[1] > (e[0] ? this.TTL_FOUND : this.TTL_NONE)){ this.cache.delete(id); return undefined; }
    return e[0];
  },
  get(m){
    const c = this.cached(m.id);
    if(c !== undefined) return Promise.resolve(c);
    if(this.pending.has(m.id)) return this.pending.get(m.id);
    const pr = new Promise(resolve=>{ this.queue.push({m, resolve}); this.pump(); });
    this.pending.set(m.id, pr);
    return pr;
  },
  pump(){
    while(this.active < this.MAXPAR && this.queue.length){
      const job = this.queue.shift();
      this.active++;
      this.find(job.m).then(url=>{
        if(url !== undefined){ this.cache.set(job.m.id, [url || "", Date.now()]); this.save(); }   // undefined: сбой сети, попробуем позже
        job.resolve(url || "");
      }).catch(()=> job.resolve("")).finally(()=>{ this.pending.delete(job.m.id); this.active--; this.pump(); });
    }
  },
  async find(m){
    let gallery = [], body = "";
    const known = detailsCache.get(m.id);
    if(known){ gallery = known.gallery || []; body = known.body || ""; }
    else if(m.source === "modrinth"){
      const r = await fetch(`${Modrinth.api}/project/${m.slug}`);
      if(!r.ok) return r.status === 404 ? "" : undefined;
      const p = await r.json();
      gallery = (p.gallery || []).map(g=>({url:g.url}));
      body = typeof p.body === "string" ? p.body.slice(0, 200000) : "";
    }else if(m.source === "curseforge"){
      const d = await mmCall("cf:details", m.cfId || String(m.id).split(":")[1]);
      gallery = d.gallery || []; body = d.body || "";
    }else return "";
    if(gallery[0] && gallery[0].url) return gallery[0].url;
    const imgs = mediaFromBody(body, []).images.slice(0, 8);
    let fallback = "";
    for(const g of imgs){
      const sz = await measureImage(g.url);
      if(looksLikeScreenshot(sz)) return g.url;
      if(!fallback && sz && !sz.flat && sz.w >= 300 && sz.h >= 150 && sz.w / sz.h <= 3.2) fallback = g.url;
    }
    return fallback;
  }
};
const coverObserver = typeof IntersectionObserver === "function" ? new IntersectionObserver(entries=>{
  for(const e of entries){
    if(!e.isIntersecting) continue;
    coverObserver.unobserve(e.target);
    const fn = e.target._coverJob; e.target._coverJob = null;
    if(fn) fn();
  }
}, {rootMargin:"300px"}) : null;
function hydrateCover(m, el){
  if(m.cover || m.kind === "plugin" || !["modrinth","curseforge"].includes(m.source) || !m.id) return;
  const job = ()=>{
    CoverFinder.get(m).then(url=>{
      if(!url || !el.isConnected || el.querySelector(".card-cover")) return;
      m.cover = url;
      const box = document.createElement("div");
      box.className = "card-cover";
      const img = document.createElement("img");
      img.alt = ""; img.loading = "lazy"; img.referrerPolicy = "no-referrer";
      img.addEventListener("error", ()=> box.remove());
      img.src = url;
      box.appendChild(img);
      el.insertBefore(box, el.firstChild);
    });
  };
  if(!coverObserver){ job(); return; }
  el._coverJob = job;
  coverObserver.observe(el);
}

/* ---------- фильтры, выбранные в каталоге, применяются внутри карточек ---------- */
const CATALOG_PAGES = ["mods","modpacks","plugins","resourcepacks","shaders","datapacks"];
function activeFilters(){
  if(!catalog || !CATALOG_PAGES.includes(state.page)) return {gv:"", loader:"", q:""};
  return {gv:catalog.gv || "", loader:catalog.loader || "", q:catalog.q || ""};
}
function filterVersionRows(rows, f){
  return rows.filter(v=>{
    // если у источника нет данных о версиях/загрузчиках строки, не отсеиваем её
    if(f.gv && v.gameList?.length && !v.gameList.includes(f.gv)) return false;
    if(f.loader && v.loaderList?.length && !v.loaderList.includes(f.loader)) return false;
    return true;
  });
}

/* ---------- порядок версий игры и загрузчиков в списках ----------
   Площадки отдают версии игры вперемешку (1.17.1, 1.21, 1.16.5, …), а у шейдеров среди них
   встречаются ещё и «OptiFine» с «Iris». Здесь всё раскладывается: загрузчики отдельно и по
   порядку, релизы от новых к старым и по линиям (1.21.x, 1.20.x, …), снапшоты в конце. */
const MC_REL_RE = /^\d+(?:\.\d+){1,3}$/;
const LOADER_ORDER = ["fabric","quilt","forge","neoforge","iris","oculus","optifine","canvas","vanilla"];
function mcCmp(a, b){   // новые версии первыми
  const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
  for(let i = 0; i < Math.max(pa.length, pb.length); i++){ const d = (pb[i] || 0) - (pa[i] || 0); if(d) return d; }
  return 0;
}
const loaderCmp = (a, b)=>{
  const ia = LOADER_ORDER.indexOf(a), ib = LOADER_ORDER.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b));
};
/* → { rel, other, loaders }: релизы (новые первыми), прочее (снапшоты и т.п.), загрузчики */
function splitGameList(list){
  const rel = [], other = [], loaders = [];
  for(const raw of new Set((list || []).map(x=> String(x).trim()).filter(x=> x && x !== "-"))){
    const low = raw.toLowerCase();
    if(LOADER_LABEL[low]) loaders.push(low);
    else if(MC_REL_RE.test(raw)) rel.push(raw);
    else other.push(raw);
  }
  rel.sort(mcCmp);
  other.sort((a, b)=> b.localeCompare(a, "en", {numeric:true}));
  return { rel, other, loaders };
}
/* линия версии: 1.21.4 → «1.21», для новой нумерации (26.1.2) → «26» */
const mcLine = v => { const p = v.split("."); return p[0] === "1" ? p.slice(0, 2).join(".") : p[0]; };
/* группы релизов по линиям: [{line, items}], порядок сохраняется (новые первыми) */
function groupByLine(rel){
  const groups = [];
  for(const v of rel){
    const line = mcLine(v), g = groups[groups.length - 1];
    if(g && g.line === line) g.items.push(v); else groups.push({ line, items: [v] });
  }
  return groups;
}
/* HTML списка версий игры: по строке на линию; limit обрезает самые старые.
   Хвост «+N ещё версий» - кнопка: по клику список раскрывается целиком, повторный клик сворачивает его обратно */
const gvStore = new Map();
let gvSeq = 0;
const gvBtn = (id, open, hidden)=> `<button type="button" class="vg vg-more" data-gv="${id}" aria-expanded="${open}">${open ? "Скрыть версии" : `+${hidden} ещё версий`}</button>`;
/* версия в списке: на страницах каталога это кнопка, по клику она ставится в фильтр «Версия игры» */
function gvItems(items){
  if(!$("gv")) return items.join(", ");
  const cur = $("gv").value;
  return items.map(v=> `<button type="button" class="gv-v${v === cur ? " on" : ""}" data-v="${v}" title="${v === cur ? "Снять фильтр по версии" : "Показать только версию " + v}">${v}</button>`).join(", ");
}
function gameVersionsHTML(list, limit){
  const { rel, other } = splitGameList(list);
  let left = limit || Infinity, hidden = 0;
  const lines = [];
  for(const g of groupByLine(rel)){
    const take = g.items.slice(0, Math.max(0, left)); left -= take.length; hidden += g.items.length - take.length;
    if(take.length) lines.push(`<span class="vg"><b>${g.line}.x</b><span>${gvItems(take)}</span></span>`);
  }
  if(other.length){
    const take = other.slice(0, Math.max(0, left)); left -= take.length; hidden += other.length - take.length;
    if(take.length) lines.push(`<span class="vg"><b>Прочее</b><span>${gvItems(take)}</span></span>`);
  }
  if(hidden > 0){
    const id = ++gvSeq;
    gvStore.set(id, { hidden, short: lines.join(""), full: gameVersionsHTML(list) });
    if(gvStore.size > 300) gvStore.delete(gvStore.keys().next().value);   // старые списки уже не на экране
    lines.push(gvBtn(id, false, hidden));
  }
  return lines.join("");
}
document.addEventListener("click", e=>{
  const vb = e.target.closest && e.target.closest(".gv-v");
  if(vb){
    const sel = $("gv");
    if(!sel) return;
    e.preventDefault(); e.stopPropagation();
    const v = vb.dataset.v, off = sel.value === v;
    if(!off && ![...sel.options].some(o=> o.value === v)){ const o = document.createElement("option"); o.value = v; o.textContent = v; sel.appendChild(o); }
    sel.value = off ? "" : v;
    sel.dispatchEvent(new Event("change"));      // тот же путь, что и при выборе в списке: каталог обновится сам
    if(modal.open && modalDetails){ modalShowAll = false; refreshModalFilter(); }   // карточка остаётся открытой, её списки подстраиваются под фильтр
    toast(off ? "Фильтр по версии снят" : "Фильтр: версия " + v);
    return;
  }
  const b = e.target.closest && e.target.closest(".vg-more[data-gv]");
  if(!b) return;
  const box = b.closest(".vm-gv"), rec = gvStore.get(+b.dataset.gv);
  if(!box || !rec) return;
  e.preventDefault(); e.stopPropagation();
  const open = b.getAttribute("aria-expanded") !== "true";
  box.innerHTML = (open ? rec.full : rec.short) + gvBtn(+b.dataset.gv, open, rec.hidden);
  const nb = box.querySelector(".vg-more"); if(nb) nb.focus({ preventScroll: true });
});
/* один раз приводит строку версии в порядок (её же потом видит окно «Скачать») */
function normalizeVersionRow(v){
  if(v._norm) return v;
  v._norm = true;
  const s = splitGameList(v.gameList && v.gameList.length ? v.gameList : String(v.game || "").split(/,\s*/));
  v._parts = s;
  const lds = [...new Set([...(v.loaderList || []), ...s.loaders])].sort(loaderCmp);
  v.loaderList = lds;
  if(v.gameList && v.gameList.length) v.gameList = [...s.rel, ...s.other];   // без «OptiFine» и «Iris», по порядку
  const joined = [...s.rel, ...s.other].join(", ");
  if(joined) v.game = joined;
  return v;
}

/* ---------- модалка мода (общая для всех страниц) ---------- */
const modal = $("modal");
let current = null;
let modalDetails = null, modalShowAll = false;
const detailsCache = new Map();

/* ---------- галерея изображений мода/плагина и просмотр во весь экран ---------- */
let lightbox = null, lbImages = [], lbIndex = 0, lbToken = 0;
function ensureLightbox(){
  if(lightbox) return lightbox;
  lightbox = document.createElement("dialog");
  lightbox.className = "lightbox";
  lightbox.setAttribute("aria-label", "Просмотр изображения");
  lightbox.innerHTML = `
    <button class="lb-btn lb-close" type="button" aria-label="Закрыть">✕</button>
    <button class="lb-btn lb-prev" type="button" aria-label="Предыдущее">‹</button>
    <figure class="lb-fig"><img class="lb-img" alt=""><video class="lb-img lb-video" controls hidden></video><div class="lb-embed" hidden></div><figcaption class="lb-cap"></figcaption><button class="btn lb-ext" type="button" hidden>Открыть в браузере ↗</button></figure>
    <button class="lb-btn lb-next" type="button" aria-label="Следующее">›</button>`;
  document.body.appendChild(lightbox);
  lightbox.querySelector(".lb-close").addEventListener("click", ()=> lightbox.close());
  lightbox.addEventListener("close", ()=>{ const v = lightbox.querySelector(".lb-video"); v.pause(); v.removeAttribute("src"); v.load(); lbClearEmbed(); });
  lightbox.querySelector(".lb-ext").addEventListener("click", ()=>{ const g = lbImages[lbIndex]; if(g && g.url) window.open(g.url, "_blank", "noopener"); });
  lightbox.querySelector(".lb-prev").addEventListener("click", ()=> lbShow(lbIndex - 1));
  lightbox.querySelector(".lb-next").addEventListener("click", ()=> lbShow(lbIndex + 1));
  lightbox.addEventListener("click", e=>{ if(e.target === lightbox) lightbox.close(); });
  lightbox.addEventListener("keydown", e=>{
    if(e.key === "ArrowLeft") lbShow(lbIndex - 1);
    if(e.key === "ArrowRight") lbShow(lbIndex + 1);
  });
  return lightbox;
}
/* ролик встроен в окно просмотра: iframe убираем при переключении и закрытии, чтобы звук не продолжал играть */
function lbClearEmbed(){
  lbToken++;
  if(!lightbox) return;
  const box = lightbox.querySelector(".lb-embed");
  const f = box.querySelector("iframe");
  if(f){ f.src = "about:blank"; f.remove(); }
  box.hidden = true;
}
async function embedSrc(url){
  try{
    if(window.mm){
      const base = await mmCall("embed:base");
      if(base) return `${base}/player?src=${encodeURIComponent(url)}`;
    }
  }catch(e){}
  return url;
}
function lbShow(i){
  if(!lbImages.length) return;
  lbIndex = (i + lbImages.length) % lbImages.length;
  const g = lbImages[lbIndex];
  const img = lightbox.querySelector("img.lb-img"), vid = lightbox.querySelector(".lb-video");
  const box = lightbox.querySelector(".lb-embed"), ext = lightbox.querySelector(".lb-ext");
  vid.pause();
  lbClearEmbed();
  ext.hidden = true;
  if(g.embed){
    img.hidden = true; img.removeAttribute("src");
    vid.hidden = true; vid.removeAttribute("src");
    const f = document.createElement("iframe");
    f.title = g.title || "Видео";
    f.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write";
    f.allowFullscreen = true;
    f.referrerPolicy = "strict-origin-when-cross-origin";
    box.appendChild(f);
    // Плеер открывается через маленькую локальную страницу (http://localhost): у страницы с file:// нет адреса,
    // и YouTube отвечает чёрным экраном или ошибкой 153. Вне приложения ролик встраивается напрямую.
    const token = lbToken;
    embedSrc(g.embed).then(src=>{ if(token === lbToken && f.isConnected) f.src = src; });
    box.hidden = false;
    ext.hidden = false;      // запасной путь: если площадка не даёт показать ролик внутри лаунчера
  }else if(g.video === "file"){
    img.hidden = true; img.removeAttribute("src");
    vid.hidden = false; vid.src = g.url;
  }else{
    vid.hidden = true; vid.removeAttribute("src");
    img.hidden = false;
    img.referrerPolicy = "no-referrer";
    img.src = g.url;
    img.alt = g.title || "";
  }
  lightbox.querySelector(".lb-cap").textContent =
    [g.title, g.desc].filter(Boolean).join(", ") + (lbImages.length > 1 ? `  (${lbIndex+1}/${lbImages.length})` : "");
  const multi = lbImages.length > 1;
  lightbox.querySelector(".lb-prev").hidden = !multi;
  lightbox.querySelector(".lb-next").hidden = !multi;
}
function openLightbox(images, index){
  ensureLightbox();
  lbImages = images;
  lightbox.showModal();
  lbShow(index);
}
/* ---------- картинки и видео из длинного описания проекта ----------
   Официальная галерея (Modrinth) и скриншоты (CurseForge) есть не у каждого проекта, а авторы часто кладут
   картинки и ролики прямо в описание (Markdown у Modrinth, HTML у CurseForge). Достаём их оттуда и добавляем в галерею. */
const MEDIA_SKIP_HOST = /(^|\.)(ytimg\.com|img\.youtube\.com|shields\.io|badgen\.net|bstats\.org|forthebadge\.com|komarev\.com|visitor-badge\.laobi\.icu|hits\.seeyoufarm\.com|star-history\.com|discordapp\.com|discord\.com|bmc\.link|buymeacoffee\.com|ko-fi\.com|patreon\.com|paypal\.com|paypalobjects\.com)$/i;
const MEDIA_BUTTON_HOST = /(^|\.)(discord\.gg|discord\.com|discordapp\.com|patreon\.com|ko-fi\.com|buymeacoffee\.com|paypal\.com|paypal\.me|boosty\.to|donationalerts\.com|opencollective\.com|liberapay\.com|github\.com|gitlab\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|tiktok\.com|t\.me|telegram\.me|vk\.com|reddit\.com|twitch\.tv|curseforge\.com|modrinth\.com|planetminecraft\.com|bisecthosting\.com|apexminecrafthosting\.com|shockbyte\.com|sparkedhost\.com|nodecraft\.com|ggservers\.com|bloom\.host|crowdin\.com|weblate\.org|curseforge\.overwolf\.com)$/i;
const MEDIA_SKIP_PATH = /badge|shield|sponsor|donat|patreon|ko-?fi|paypal|buymeacoffee|bmc-|emoji|favicon|spacer|pixel\.gif|widget|logo|icon|banner|divider|separator|avatar|button|mascot|header/i;
function cleanMediaUrl(u){
  if(!u) return null;
  u = String(u).trim().replace(/&amp;/g, "&");
  if(u.startsWith("//")) u = "https:" + u;
  if(!/^https?:\/\//i.test(u)) return null;
  try{ return new URL(u); }catch{ return null; }
}
/* ссылки CurseForge вида /linkout?remoteUrl=... (адрес закодирован, иногда дважды) приводим к настоящему адресу */
function unwrapLinkout(u){
  for(let i = 0; i < 3 && u && /remoteUrl=/i.test(u.search || ""); i++){
    let r = u.searchParams.get("remoteUrl");
    if(!r) break;
    for(let k = 0; k < 3 && /%[0-9a-f]{2}/i.test(r); k++){ try{ r = decodeURIComponent(r); }catch{ break; } }
    const n = cleanMediaUrl(r);
    if(!n) break;
    u = n;
  }
  return u;
}
function youtubeId(u){
  const h = u.hostname.replace(/^www\.|^m\./, "");
  let id = null;
  if(h === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if(/^youtube(-nocookie)?\.com$/.test(h)){
    if(u.pathname === "/watch") id = u.searchParams.get("v");
    else { const m = /^\/(?:embed|shorts|live|v)\/([\w-]{11})/.exec(u.pathname); if(m) id = m[1]; }
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}
/* Адрес встроенного плеера для известных площадок (только по проверенным идентификаторам, чужой адрес в iframe не попадёт).
   Twitch и прочие не встраиваем: они открываются в браузере. */
function embedFor(u){
  const yt = youtubeId(u);
  if(yt) return `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&playsinline=1`;
  const h = u.hostname.replace(/^www\./, "").toLowerCase();
  let m;
  if(h === "vimeo.com" || h === "player.vimeo.com"){
    m = /^\/(?:video\/|channels\/[\w-]+\/|groups\/[\w-]+\/videos\/)?(\d{5,})/.exec(u.pathname);
    if(m) return `https://player.vimeo.com/video/${m[1]}?autoplay=1`;
  }
  if(h === "streamable.com"){
    m = /^\/(?:e\/|o\/)?([a-z0-9]{4,10})\/?$/i.exec(u.pathname);
    if(m) return `https://streamable.com/e/${m[1]}?autoplay=1`;
  }
  if(h === "dailymotion.com" || h === "dai.ly"){
    m = h === "dai.ly" ? /^\/([a-z0-9]+)\/?$/i.exec(u.pathname) : /^\/(?:embed\/)?video\/([a-z0-9]+)/i.exec(u.pathname);
    if(m) return `https://www.dailymotion.com/embed/video/${m[1]}?autoplay=1`;
  }
  if(h === "bilibili.com" || h === "m.bilibili.com"){
    m = /^\/video\/(BV[0-9A-Za-z]{8,12})/.exec(u.pathname);
    if(m) return `https://player.bilibili.com/player.html?bvid=${m[1]}&autoplay=1&high_quality=1`;
  }
  return null;
}
function mediaFromBody(body, known){
  const images = [], videos = [];
  if(!body) return {images, videos};
  const seenImg = new Set(known || []), seenVid = new Set();
  const nameOf = u => decodeURIComponent(u.pathname.split("/").pop() || "").toLowerCase();
  const addImage = raw => {
    let u = cleanMediaUrl(raw);
    if(!u || MEDIA_SKIP_HOST.test(u.hostname) || MEDIA_SKIP_PATH.test(u.pathname)) return;
    if(/\.(svg|ico)(\?|$)/i.test(u.pathname)) return;           // значки и векторные украшения
    if(youtubeId(u)) return;
    const key = u.origin + u.pathname;
    if(seenImg.has(key) || seenImg.has(nameOf(u))) return;
    seenImg.add(key); if(nameOf(u)) seenImg.add(nameOf(u));
    images.push({url:u.href, title:"", desc:""});
  };
  const addVideo = raw => {
    let u = cleanMediaUrl(raw);
    if(!u) return;
    u = unwrapLinkout(u);
    const id = youtubeId(u);
    if(id){
      if(seenVid.has(id)) return; seenVid.add(id);
      videos.push({url:"https://www.youtube.com/watch?v=" + id, thumb:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`, title:"YouTube", desc:"", video:"youtube", embed:embedFor(u)});
    }else if(/\.(mp4|webm|mov|m4v)$/i.test(u.pathname)){
      const key = u.origin + u.pathname;
      if(seenVid.has(key)) return; seenVid.add(key);
      videos.push({url:u.href, thumb:null, title:nameOf(u), desc:"", video:"file"});
    }else if(/(^|\.)(vimeo\.com|bilibili\.com|twitch\.tv|streamable\.com|dailymotion\.com)$/i.test(u.hostname) && u.pathname.length > 1){
      const key = u.origin + u.pathname;
      if(seenVid.has(key)) return; seenVid.add(key);
      videos.push({url:u.href, thumb:null, title:u.hostname.replace(/^www\./, ""), desc:"", video:"link", embed:embedFor(u)});
    }
  };
  let m;
  // Картинка-кнопка: обёрнута в ссылку на соцсеть, донаты, хостинг или другой сайт (Discord, Patreon, GitHub…).
  // Такие картинки не скриншоты, пропускаем их.
  const buttons = new Set();
  const markButton = (img, href) => {
    const iu = cleanMediaUrl(img); let hu = cleanMediaUrl(href);
    if(!iu || !hu) return;
    hu = unwrapLinkout(hu);
    if(MEDIA_BUTTON_HOST.test(hu.hostname)) buttons.add(iu.origin + iu.pathname);
  };
  const mdLinked = /\[\s*!\[[^\]]*\]\(\s*<?([^)\s>]+)>?[^)]*\)\s*\]\(\s*<?([^)\s>]+)>?[^)]*\)/g;
  while((m = mdLinked.exec(body))) markButton(m[1], m[2]);
  const htmlLinked = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>\s*(?:<[^>]+>\s*)*?<img\b[^>]*?\b(?:data-src|src)\s*=\s*["']([^"']+)["']/gi;
  while((m = htmlLinked.exec(body))) markButton(m[2], m[1]);
  const origAdd = addImage;
  const addImageChecked = raw => { const u = cleanMediaUrl(raw); if(u && buttons.has(u.origin + u.pathname)) return; origAdd(raw); };
  /* Берём только то, что относится к самому проекту: картинки под заголовками про спонсоров, дополнения, другие проекты,
     ссылки и т.п., а также логотипы, баннеры и значки по подписи (alt) отбрасываем. */
  const headings = [];
  const mh = /^[ \t]{0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/gm;
  while((m = mh.exec(body))) headings.push({pos:m.index, text:m[1]});
  const hh = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  while((m = hh.exec(body))) headings.push({pos:m.index, text:m[1].replace(/<[^>]+>/g, "")});
  headings.sort((x, y)=> x.pos - y.pos);
  const PROMO_HEADING = /sponsor|partner|supporter|patron|donat|support\s+(me|us|the)|hosting|\bhost\b|discord|credits?|thanks|contribut|translat|related|other\s+(mods?|projects?)|(my|our)\s+(other\s+)?(mods?|projects?)|add-?ons?|extensions?|integrations?|compat|dependenc|requirement|changelog|faq|socials?|links|more\s+(mods?|from)|check\s+out|featured|recommended|bisect/i;
  const PROMO_ALT = /logo|icon|banner|sponsor|partner|supporter|patreon|discord|donat|badge|button|avatar|mascot|divider|separator|emoji|download|support|\bads?\b|header/i;
  const headingAt = idx=>{ let t = ""; for(const h of headings){ if(h.pos > idx) break; t = h.text; } return t; };
  const skipCtx = (idx, alt)=> PROMO_ALT.test(alt || "") || PROMO_HEADING.test(headingAt(idx));
  const md = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g;
  while((m = md.exec(body))) if(!skipCtx(m.index, m[1])) addImageChecked(m[2]);
  const img = /<img\b[^>]*>/gi;
  while((m = img.exec(body))){
    const src = /\b(?:data-src|src)\s*=\s*["']([^"']+)["']/i.exec(m[0]);
    const alt = /\balt\s*=\s*["']([^"']*)["']/i.exec(m[0]);
    if(src && !skipCtx(m.index, alt ? alt[1] : "")) addImageChecked(src[1]);
  }
  // все остальные адреса в тексте: ролики (YouTube, файлы, Vimeo…) в ссылках, iframe, video и source
  const any = /(?:https?:)?\/\/[^\s"'<>)\]]+/g;
  while((m = any.exec(body))){
    const u = cleanMediaUrl(m[0]);
    if(u && /linkout/i.test(u.pathname)){ const r = unwrapLinkout(u); if(r !== u) addVideo(r.href); }
    else addVideo(m[0]);
  }
  return {images:images.slice(0, 24), videos:videos.slice(0, 12)};
}

/* Размер картинки из описания: логотипы, баннеры и значки соцсетей отсеиваем, скриншоты оставляем */
/* Логотип, значок или рисунок на однотонном фоне: мало цветов, один цвет занимает полкартинки или однотонная рамка.
   Скриншоты и арты так не выглядят. Нужен CORS (в приложении он включён), иначе оценка по цветам пропускается. */
function isFlatArt(im){
  const N = 48, c = document.createElement("canvas");
  c.width = c.height = N;
  const x = c.getContext("2d", {willReadFrequently:true});
  x.drawImage(im, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data;
  const all = new Map(), edge = new Map();
  let edgeN = 0;
  for(let i = 0; i < N * N; i++){
    const o = i * 4;
    const k = d[o + 3] < 128 ? -1 : ((d[o] >> 4) << 8) | ((d[o + 1] >> 4) << 4) | (d[o + 2] >> 4);
    all.set(k, (all.get(k) || 0) + 1);
    const r = (i / N) | 0, q = i % N;
    if(r === 0 || q === 0 || r === N - 1 || q === N - 1){ edge.set(k, (edge.get(k) || 0) + 1); edgeN++; }
  }
  const total = N * N;
  const top = Math.max(...all.values()) / total;
  const distinct = [...all.values()].filter(v => v / total >= 0.005).length;
  const edgeTop = Math.max(...edge.values()) / edgeN;
  return (top > 0.5 && distinct <= 14) || (edgeTop >= 0.9 && top > 0.3 && distinct <= 24);
}
function measureImage(url){
  return new Promise(res=>{
    let done = false, timer = null;
    const end = v=>{ if(done) return; done = true; clearTimeout(timer); res(v); };
    const load = cors=>{
      const im = new Image();
      im.referrerPolicy = "no-referrer";
      if(cors) im.crossOrigin = "anonymous";
      im.onload = ()=>{
        const sz = {w:im.naturalWidth, h:im.naturalHeight};
        if(cors){ try{ sz.flat = isFlatArt(im); }catch(e){} }
        end(sz);
      };
      im.onerror = ()=>{ if(cors && !done) load(false); else end(null); };   // хост не дал CORS: хотя бы размер
      im.src = url;
    };
    timer = setTimeout(()=> end(null), 12000);
    load(true);
  });
}
function looksLikeScreenshot(sz){
  if(!sz || !sz.w || !sz.h) return false;
  if(sz.flat) return false;                                  // логотипы и рисунки на однотонном фоне
  const {w, h} = sz, r = w / h;
  if(w < 400 || h < 225) return false;                       // мелочь: значки, смайлы, кнопки
  if(r > 2.6 || r < 0.5) return false;                       // широкие баннеры и узкие полосы
  if(r > 0.97 && r < 1.03 && Math.max(w, h) <= 700) return false;   // небольшие квадраты: логотипы и иконки
  return true;
}

function renderModalGallery(images, body){
  const box = $("mGallery");
  if(!box) return;
  images = (images || []).slice();
  const known = images.flatMap(g=>{ const u = cleanMediaUrl(g.url); return u ? [u.origin + u.pathname, decodeURIComponent(u.pathname.split("/").pop() || "").toLowerCase()] : []; });
  const extra = mediaFromBody(body, known);
  if(!images.length && !extra.images.length && !extra.videos.length) return;
  const wrap = document.createElement("div");
  wrap.className = "gallery";
  const h = document.createElement("h4");
  const strip = document.createElement("div");
  strip.className = "gallery-strip";
  wrap.append(h, strip);
  box.appendChild(wrap);

  const shown = [];    // всё, что сейчас в ленте, по порядку
  const refresh = ()=>{
    const nVid = shown.filter(g=>g.video).length, nImg = shown.length - nVid;
    h.textContent = nVid ? `Изображения и видео (${nImg} + ${nVid})` : `Изображения (${nImg})`;
    wrap.hidden = !shown.length;
  };
  const addThumb = g=>{
    const b = document.createElement("button");
    b.type = "button"; b.className = "gallery-thumb" + (g.video ? " is-video" : "");
    b.setAttribute("aria-label", g.title || (g.video ? "Открыть видео" : "Открыть изображение"));
    if(g.thumb || !g.video){
      const img = document.createElement("img");
      img.loading = "lazy"; img.referrerPolicy = "no-referrer"; img.alt = g.title || ""; img.src = g.thumb || g.url;
      // если картинка недоступна (например, хост блокирует показ на чужих сайтах), убираем плашку
      img.addEventListener("error", ()=>{ b.remove(); const i = shown.indexOf(g); if(i >= 0) shown.splice(i, 1); refresh(); });
      b.appendChild(img);
    }else{
      const ph = document.createElement("span"); ph.className = "gallery-vid-name"; ph.textContent = g.title || "Видео";
      b.appendChild(ph);
    }
    if(g.video){ const pl = document.createElement("span"); pl.className = "gallery-play"; pl.setAttribute("aria-hidden", "true"); pl.textContent = "▶"; b.appendChild(pl); }
    b.addEventListener("click", ()=>{
      if(g.video && g.video !== "file" && !g.embed) window.open(g.url, "_blank", "noopener");   // площадка без встроенного плеера: открываем в браузере
      else {
        // в окно просмотра идут картинки, видеофайлы и ролики YouTube, Vimeo и других площадок со встроенным плеером
        const viewable = shown.filter(x=> !x.video || x.video === "file" || x.embed);
        openLightbox(viewable, viewable.indexOf(g));
      }
    });
    strip.appendChild(b);
    shown.push(g);
    refresh();
  };

  images.forEach(addThumb);                 // официальная галерея: показываем сразу и без отбора
  extra.videos.forEach(addThumb);
  refresh();

  // картинки из описания сначала измеряем и добавляем только похожие на скриншоты, в исходном порядке
  const results = new Array(extra.images.length);
  let next = 0;
  const flush = ()=>{
    while(next < results.length && results[next] !== undefined){
      if(results[next] && wrap.isConnected) addThumb(results[next]);
      next++;
    }
  };
  extra.images.forEach((g, i)=>{
    measureImage(g.url).then(sz=>{ results[i] = looksLikeScreenshot(sz) ? g : null; flush(); });
  });
}

function modalGameVersionsHTML(d){
  const gv = activeFilters().gv;
  return gameVersionsHTML(gv ? d.gameVersions.filter(v=>v===gv) : d.gameVersions, 16) || "-";
}
/* фильтр по версии сменился, пока карточка открыта: обновляем её списки, не закрывая окно */
function refreshModalFilter(){
  const top = $("mGameVers");
  if(top && modalDetails) top.innerHTML = modalGameVersionsHTML(modalDetails);
  renderModalVersions();
  // чипы версий в строках списка тоже должны показывать, какая версия сейчас выбрана
  const cur = $("gv") ? $("gv").value : "";
  modal.querySelectorAll(".gv-v").forEach(b=>{
    const on = b.dataset.v === cur;
    b.classList.toggle("on", on);
    b.title = on ? "Снять фильтр по версии" : "Показать только версию " + b.dataset.v;
  });
}
function renderModalVersions(){
  const box = $("mVersions");
  if(!box || !modalDetails) return;
  const all = (modalDetails.versions || []).map(normalizeVersionRow);
  if(!all.length){ box.innerHTML = ""; return; }
  const f = activeFilters();
  const hasFilter = !!(f.gv || f.loader);
  const filtered = hasFilter ? filterVersionRows(all, f) : all;
  const filterOn = hasFilter && !modalShowAll;
  const list = filterOn ? filtered : all;
  const label = [f.gv, f.loader && (LOADER_LABEL[f.loader]||f.loader)].filter(Boolean).join(" · ");
  const title = filterOn ? `Версии для ${label} (${filtered.length} из ${all.length})` : `Все версии (${all.length})`;
  const toggle = hasFilter
    ? `<button class="btn" id="mVerToggle" type="button">${modalShowAll ? "Только по фильтру" : "Показать все версии"}</button>` : "";
  const rows = list.length ? list.map((v,i)=>{
      const gv = gameVersionsHTML([...v._parts.rel, ...v._parts.other]);
      const lds = (v.loaderList || []).map(l=>`<span class="ld-chip">${ldIcon(l)}${LOADER_LABEL[l]||l}</span>`).join("");
      return `
      <div class="vrow vrow-rich">
        <span class="vn">${v.name}</span>
        <span class="vdate">${dateRu(v.date)}</span>
        ${v.file ? (window.LauncherUI?.isDesktop ? `<button type="button" class="vdl" data-vi="${i}">Скачать</button>` : `<a href="${v.file}" target="_blank" rel="noopener">Скачать</a>`) : ""}
        ${(lds || gv) ? `<div class="vm vm-rich">${lds ? `<div class="vm-ld">${lds}</div>` : ""}${gv ? `<div class="vm-gv">${gv}</div>` : ""}</div>` : ""}
      </div>`; }).join("")
    : `<p class="filter-note">Для выбранных фильтров (${label}) файлов не найдено.</p>`;
  box.innerHTML = `<div><h4>${title}</h4>${toggle}<div class="vlist">${rows}</div></div>`;
  $("mVerToggle")?.addEventListener("click", ()=>{ modalShowAll = !modalShowAll; renderModalVersions(); });
  box.querySelectorAll(".vdl").forEach(b=> b.addEventListener("click", ()=>{
    const v = list[+b.dataset.vi]; if(v) window.LauncherUI.downloadChoice({ v, m: current });
  }));
}

async function openModal(m){
  current = m;
  modalDetails = null; modalShowAll = false;
  $("mTile").innerHTML = tileHTML(m);
  $("mName").textContent = m.title;
  $("mBy").textContent = `${m.author || "-"} · обновлён ${dateRu(m.updated)}`;
  $("mOpen").href = m.url || "#";
  $("mOpen").textContent = `Открыть страницу ${KIND_LABEL[m.kind] || "мода"}`;
  $("mFav").textContent = favorites.has(m.id) ? "Убрать из избранного" : "В избранное";
  $("mBody").innerHTML = `<div class="badges">${badgesHTML(m)}</div><p id="mDesc">${m.desc || ""}</p><p style="color:var(--muted)">Загружаю подробности…</p>`;
  modal.showModal();
  window.LauncherUI?.setViewing?.({ title: m.title, kind: m.kind || "mod", author: m.author });   // статус в Discord: какая карточка открыта
  if(m.desc) maybeTranslate($("mDesc"), m.desc);

  if(m.source === "snapshot"){
    $("mBody").innerHTML = `<p id="mDesc">${m.desc}</p><p style="color:var(--muted)">Подробности доступны только при живом подключении к источникам.</p>`;
    if(m.desc) maybeTranslate($("mDesc"), m.desc);
    return;
  }
  try{
    let d = detailsCache.get(m.id);
    if(!d){
      d = await SOURCES[m.source].details(m);
      if(d.versionsPromise){
        const dd = d;
        dd.versionsPromise = dd.versionsPromise.then(v=>{ dd.versions = v; dd.versionsReady = true; return v; });
        dd.versionsPromise.catch(()=>{ dd.versionsReady = true; });
      } else d.versionsReady = true;
      detailsCache.set(m.id, d);
      if(detailsCache.size > 40) detailsCache.delete(detailsCache.keys().next().value);
    }
    if(current !== m) return;
    const otherLinks = (m.variants||[]).filter(v=>v.url && v.url!==m.url)
      .map(v=>`<a href="${v.url}" target="_blank" rel="noopener">${SOURCE_META[v.source]?.label||v.source} ↗</a>`).join("");
    const noDirectDownload = !["modrinth","curseforge"].includes(m.source) && !d.versions.length;
    $("mBody").innerHTML = `
      <div class="badges">${badgesHTML(m)}</div>
      <p id="mDesc">${m.desc || ""}</p>
      <div id="mGallery"></div>
      <div class="specs">
        <div class="spec"><span>Загрузок</span><b>${nf.format(d.downloads || m.downloads || 0)}</b></div>
        <div class="spec"><span>Подписчиков</span><b>${nf.format(d.followers || 0)}</b></div>
        <div class="spec"><span>Лицензия</span><b>${d.license || "-"}</b></div>
        ${m.kind === "resourcepack"
          ? `<div class="spec"><span>Разрешение</span><b>${(m.categories||[]).filter(c=>/^\d+x\+?$/.test(c)).join(", ") || "-"}</b></div>`
          : m.kind === "datapack"
          ? `<div class="spec"><span>Тип</span><b>Датапак</b></div>`
          : `<div class="spec ${(d.loaders||[]).length>1 ? "wide" : ""}"><span>${m.kind === "shader" ? "Движки" : "Загрузчики"}</span><b class="ld-list">${(d.loaders||[]).map(l=>`<span class="ld-chip">${ldIcon(l)}${LOADER_LABEL[l]||l}</span>`).join("") || "-"}</b></div>`}
      </div>
      ${(d.gameVersions||[]).length ? `<div><h4>Версии игры</h4><div class="vm-gv vm-gv-top" id="mGameVers">${modalGameVersionsHTML(d)}</div></div>` : ""}
      <div id="mVersions"></div>
      <div class="links">
        ${d.links.source ? `<a href="${d.links.source}" target="_blank" rel="noopener">Исходный код</a>` : ""}
        ${d.links.issues ? `<a href="${d.links.issues}" target="_blank" rel="noopener">Баг-трекер</a>` : ""}
        ${d.links.wiki ? `<a href="${d.links.wiki}" target="_blank" rel="noopener">Вики</a>` : ""}
        ${otherLinks}
      </div>
      ${noDirectDownload ? `<p class="filter-note">Этот источник не даёт прямую ссылку на файл. Скачайте мод через кнопку «Открыть страницу мода» выше.</p>` : ""}`;
    if(m.desc) maybeTranslate($("mDesc"), m.desc);
    modalDetails = d;
    if(d.versionsReady) renderModalVersions();
    else {
      const vb = $("mVersions"); if(vb) vb.innerHTML = `<p style="color:var(--muted)">Загружаю список версий…</p>`;
      d.versionsPromise.then(()=>{ if(current === m && modalDetails === d) renderModalVersions(); }).catch(()=>{});
    }
    if(m.kind !== "plugin") renderModalGallery(d.gallery, d.body);
    window.LauncherUI?.decorateModal?.(m);
  }catch(err){
    $("mBody").innerHTML = `<div class="badges">${badgesHTML(m)}</div><p id="mDesc">${m.desc || ""}</p>
      <div class="state" style="border-style:solid"><b>Подробности не загрузились</b>Попробуйте открыть источник напрямую.</div>`;
    if(m.desc) maybeTranslate($("mDesc"), m.desc);
    window.LauncherUI?.decorateModal?.(m);   // установка в Minecraft не зависит от подробностей
  }
}
$("mClose").addEventListener("click", ()=> modal.close());
$("mFav").addEventListener("click", async ()=>{
  await toggleFav(current);
  $("mFav").textContent = favorites.has(current.id) ? "Убрать из избранного" : "В избранное";
});
modal.addEventListener("click", e=>{ if(e.target === modal) modal.close(); });
modal.addEventListener("close", ()=> window.LauncherUI?.setViewing?.(null));   // карточку закрыли, статус возвращается к странице

/* ---------- инструкция по установке ---------- */

/* ============================================================
   Подсказки в поиске, как в Chrome: свои прошлые запросы (с часами, крестик убирает из истории)
   и подсказки по названиям с Modrinth / Hangar. Стрелки ↑↓ подставляют вариант в строку, Enter ищет, Esc закрывает.
   ============================================================ */
const SG_KEY = "matrixl:search-history", SG_MAX = 20;
const sgEsc = t=> String(t==null?"":t).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sgHist = {
  get(){ try{ const a = JSON.parse(localStorage.getItem(SG_KEY)||"[]"); return Array.isArray(a) ? a.filter(x=> typeof x==="string" && x) : []; }catch(e){ return []; } },
  set(a){ try{ localStorage.setItem(SG_KEY, JSON.stringify(a.slice(0, SG_MAX))); }catch(e){} },
  add(t){ t = String(t||"").trim().slice(0,80); if(!t) return; this.set([t, ...this.get().filter(x=> x.toLowerCase()!==t.toLowerCase())]); },
  del(t){ this.set(this.get().filter(x=> x!==t)); }
};
const sgCache = new Map();
async function fetchSuggestions(kind, text, signal){
  const key = kind + "|" + text.toLowerCase();
  if(sgCache.has(key)) return sgCache.get(key);
  let titles = [];
  if(kind === "plugin"){
    const r = await fetch(`${Hangar.api}/projects?${new URLSearchParams({limit:"8", q:text, sort:"-downloads"})}`, {signal, headers:{Accept:"application/json"}});
    if(r.ok){ const d = await r.json(); titles = (d.result||[]).map(p=> p.name); }
  } else {
    const p = new URLSearchParams({facets:JSON.stringify([[`project_type:${kind}`]]), index:"relevance", limit:"8", query:text});
    const r = await fetch(`${Modrinth.api}/search?${p}`, {signal, headers:{Accept:"application/json"}});
    if(r.ok){ const d = await r.json(); titles = (d.hits||[]).map(h=> h.title); }
  }
  const q = text.toLowerCase(), seen = new Set();
  titles = titles.filter(t=> t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()));
  // как в Chrome: сначала то, что начинается с набранного
  titles = [...titles.filter(t=> t.toLowerCase().startsWith(q)), ...titles.filter(t=> !t.toLowerCase().startsWith(q))].slice(0, 6);
  sgCache.set(key, titles);
  return titles;
}
const SG_ICON_HIST = '<svg class="sg-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const SG_ICON_FIND = '<svg class="sg-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>';
let sgOpen = null;   // подсказки, открытые сейчас (одни на всё окно)
addEventListener("resize", ()=> sgOpen && sgOpen.place());
addEventListener("scroll", ()=> sgOpen && sgOpen.place(), true);

function attachSuggest(input, getKind){
  if(!input) return;
  document.querySelectorAll(".suggest").forEach(e=> e.remove());   // остатки от прошлой страницы
  const box = document.createElement("div");
  box.className = "suggest"; box.id = "suggestBox"; box.setAttribute("role","listbox"); box.hidden = true;
  document.body.appendChild(box);
  input.setAttribute("role","combobox"); input.setAttribute("aria-expanded","false"); input.setAttribute("aria-controls","suggestBox"); input.setAttribute("autocomplete","off");
  let typed = input.value, items = [], net = [], act = -1, timer = 0, ctl = null;
  const api = { place(){
    if(box.hidden) return;
    if(!input.isConnected){ close(); return; }
    const r = (input.closest(".search") || input).getBoundingClientRect();
    box.style.left = r.left + "px"; box.style.width = r.width + "px"; box.style.top = (r.bottom + 4) + "px";
    box.style.maxHeight = Math.max(120, Math.min(340, innerHeight - r.bottom - 16)) + "px";
  } };
  const build = ()=>{
    const q = typed.trim().toLowerCase();
    const hist = sgHist.get().filter(h=> !q || h.toLowerCase().includes(q) && h.toLowerCase() !== q);
    const histShown = q ? [...hist.filter(h=> h.toLowerCase().startsWith(q)), ...hist.filter(h=> !h.toLowerCase().startsWith(q))].slice(0,3) : hist.slice(0,8);
    const have = new Set(histShown.map(h=> h.toLowerCase()));
    items = [...histShown.map(t=>({t, hist:true})), ...net.filter(t=> !have.has(t.toLowerCase()) && t.toLowerCase() !== q).map(t=>({t, hist:false}))];
  };
  const paint = ()=>{
    build();
    if(!items.length){ box.hidden = true; input.setAttribute("aria-expanded","false"); return; }
    const q = typed.trim();
    box.innerHTML = items.map((it,i)=>{
      const low = it.t.toLowerCase(), ql = q.toLowerCase();
      const txt = !q ? sgEsc(it.t) : low.startsWith(ql) ? sgEsc(it.t.slice(0,q.length)) + "<b>" + sgEsc(it.t.slice(q.length)) + "</b>" : "<b>" + sgEsc(it.t) + "</b>";
      return `<div class="sg-item${i===act?" act":""}" role="option" aria-selected="${i===act}" data-i="${i}">${it.hist ? SG_ICON_HIST : SG_ICON_FIND}<span class="sg-txt">${txt}</span>${it.hist ? `<button type="button" class="sg-x" data-x="${i}" title="Удалить из истории" aria-label="Удалить из истории">✕</button>` : ""}</div>`;
    }).join("");
    box.hidden = false; input.setAttribute("aria-expanded","true");
    sgOpen = api; api.place();
  };
  function close(){ box.hidden = true; act = -1; input.setAttribute("aria-expanded","false"); clearTimeout(timer); if(ctl) ctl.abort(); if(sgOpen === api) sgOpen = null; }
  const ask = ()=>{
    clearTimeout(timer); if(ctl) ctl.abort();
    const text = typed.trim();
    if(text.length < 2){ net = []; return; }
    timer = setTimeout(async ()=>{
      ctl = new AbortController();
      try{ const t = await fetchSuggestions(getKind(), text, ctl.signal); if(text === typed.trim() && document.activeElement === input){ net = t; paint(); } }
      catch(e){ /* нет сети или запрос отменён: остаётся история */ }
    }, 160);
  };
  const move = d=>{
    act += d;
    if(act < -1) act = items.length - 1;
    if(act >= items.length) act = -1;
    input.value = act < 0 ? typed : items[act].t;   // как в Chrome: выбранный вариант виден в строке
    paint();
    const el = box.querySelector(".sg-item.act"); if(el) el.scrollIntoView({block:"nearest"});
  };
  const pick = i=>{
    const it = items[i]; if(!it) return;
    input.value = typed = it.t; close();
    input.dispatchEvent(new Event("input", {bubbles:true}));
    input.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter", bubbles:true, cancelable:true}));   // дальше как обычный Enter
    input.focus();
  };
  input.addEventListener("input", ()=>{ typed = input.value; act = -1; net = []; paint(); ask(); });
  input.addEventListener("focus", ()=>{ typed = input.value; act = -1; net = []; paint(); ask(); });
  input.addEventListener("blur", ()=> setTimeout(()=>{ if(document.activeElement !== input) close(); }, 120));
  input.addEventListener("keydown", e=>{
    if(e.isComposing) return;
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){
      if(box.hidden){ typed = input.value; paint(); if(box.hidden) return; e.preventDefault(); return; }
      e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1);
    } else if(e.key === "Enter"){
      sgHist.add(input.value); close();
    } else if(e.key === "Escape" && !box.hidden){
      e.preventDefault(); e.stopImmediatePropagation(); input.value = typed; close();
    } else if(e.key === "Tab"){ close(); }
  }, true);
  box.addEventListener("mousedown", e=> e.preventDefault());   // фокус остаётся в строке поиска
  box.addEventListener("click", e=>{
    const x = e.target.closest("[data-x]");
    if(x){ const it = items[+x.dataset.x]; if(it){ sgHist.del(it.t); paint(); } return; }
    const row = e.target.closest(".sg-item"); if(row) pick(+row.dataset.i);
  });
  box.addEventListener("mousemove", e=>{
    const row = e.target.closest(".sg-item"); if(!row) return;
    const i = +row.dataset.i; if(i === act) return;
    box.querySelector(".sg-item.act")?.classList.remove("act"); row.classList.add("act"); act = i;
  });
}

/* ============================================================
   Страницы каталога: Моды / Плагины / Сборки
   ============================================================ */
const PAGE_SIZE = 24;
const CATALOG_DEF = {
  mods:     {title:"Моды",   lede:"Моды с Modrinth и CurseForge в одном списке. Есть Fabric, Forge, NeoForge и Quilt. Один и тот же мод с разных площадок показывается одной карточкой.",
    keys:c=> window.mm && c.allSource!=="modrinth" ? (c.allSource==="curseforge" ? ["curseforge"] : ["modrinth","curseforge"]) : ["modrinth"],
    projectType:"mod", kind:"mod", allSources:true,
    categories:CAT_LABEL, showLoaders:true, showSource:false, versionServerSide:true},
  modpacks: {title:"Сборки", lede:"Готовые сборки модов. Устанавливаются в лаунчер одной кнопкой.", keys:c=>[c.src||"modrinth"], projectType:"modpack", kind:"modpack", srcChoice:true,
    categories:MODPACK_CAT_LABEL, showLoaders:true, showSource:false, versionServerSide:true},
  resourcepacks: {title:"Ресурспаки", lede:"Текстуры, звуки и шрифты с Modrinth и CurseForge в одном списке. Ресурспак ставится в папку resourcepacks выбранного экземпляра",
    keys:c=> window.mm && c.allSource!=="modrinth" ? (c.allSource==="curseforge" ? ["curseforge"] : ["modrinth","curseforge"]) : ["modrinth"],
    projectType:"resourcepack", kind:"resourcepack", allSources:true, dynamicCats:true,
    categories:RESPACK_CAT_LABEL, showLoaders:false, showSource:false, versionServerSide:true},
  shaders: {title:"Шейдеры", lede:"Шейдеры с Modrinth и CurseForge в одном списке. Ставятся в папку shaderpacks, а запускает их Iris (Fabric, Quilt, NeoForge), Canvas (Fabric), Oculus (Forge) или OptiFine (Forge)",
    keys:c=> window.mm && c.allSource!=="modrinth" ? (c.allSource==="curseforge" ? ["curseforge"] : ["modrinth","curseforge"]) : ["modrinth"],
    projectType:"shader", kind:"shader", allSources:true, dynamicCats:true,
    categories:SHADER_CAT_LABEL, showLoaders:false, showSource:false, versionServerSide:true},
  datapacks: {title:"Датапаки", lede:"Датапаки с Modrinth и CurseForge в одном списке. Скачиваются в отдельную папку datapacks выбранного экземпляра, кнопка с папкой открывает её",
    keys:c=> window.mm && c.allSource!=="modrinth" ? (c.allSource==="curseforge" ? ["curseforge"] : ["modrinth","curseforge"]) : ["modrinth"],
    projectType:"datapack", kind:"datapack", allSources:true, dynamicCats:true, folderSub:"datapacks",
    categories:CAT_LABEL, showLoaders:false, showSource:false, versionServerSide:true},
  plugins:  {title:"Плагины", lede:"Плагины для серверов Paper и Spigot с Hangar и SpigotMC.", keys:(c)=> c.pluginSource==="both" ? ["hangar","spiget"] : [c.pluginSource], projectType:null, kind:"plugin",
    categories:PLUGIN_CAT_LABEL, showLoaders:false, showSource:true, versionServerSide:false}
};
const KIND_LABEL = {mod:"мода", modpack:"сборки", plugin:"плагина", resourcepack:"ресурспака", shader:"шейдера", datapack:"датапака"};

let catalog = null;   // состояние текущей страницы каталога
let catController = null;

/* Фильтры и номер страницы каждого каталога (моды, сборки, плагины…) запоминаются, пока открыт лаунчер:
   при возврате на страницу остаётся всё, что выбрал пользователь. «Сбросить фильтры» и поиск с главной начинают с чистого листа. */
const CAT_KEEP = ["q","cat","loader","gv","sort","pluginSource","allSource","src","page"];
const catMemory = new Map();
function saveCatalogState(){
  if(!catalog || !catalog.kind) return;
  const o = {}; CAT_KEEP.forEach(k=> o[k] = catalog[k]);
  catMemory.set(catalog.kind, o);
}

function renderCatalogPage(kind, opts){
  const def = CATALOG_DEF[kind];
  const saved = opts && (opts.fresh || opts.q) ? null : catMemory.get(kind);
  if(!saved) catMemory.delete(kind);
  catalog = {
    kind, q:(opts&&opts.q)||"", cat:"", loader:"", gv:"", sort:getDefaultSort(),
    pluginSource:"both", allSource:"both", src:"modrinth", offset:0, page:1, items:[], rawAll:[], total:null, exhausted:false, offline:false,
    ...(saved || {})
  };

  const content = $("content");
  content.innerHTML = `
    ${sectionHead(kind, def.title, def.lede)}
    ${kind==="modpacks" && window.mm ? `<p><button class="btn" id="openMrpack" type="button">Установить из файла (.mrpack или .zip)…</button></p>` : ""}
    <section class="panel">
      <div class="search-row">
        <label class="search">
          <span class="search-icon" aria-hidden="true"></span>
          <input id="q" type="search" placeholder="Поиск по названию" aria-label="Поиск" autocomplete="off">
          <button type="button" class="search-clear" id="qClear" aria-label="Очистить поиск" hidden>✕</button>
          <kbd class="search-kbd" aria-hidden="true">/</kbd>
        </label>
        ${def.folderSub && window.mm ? `<button class="btn lc-folder lc-folder-sm" id="openPackFolder" type="button" title="Открыть папку датапаков экземпляра" aria-label="Открыть папку датапаков экземпляра"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6c.4 0 .8.2 1.1.5L11.7 7H19.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg></button>` : ""}
        <select id="gv" aria-label="Версия игры"><option value="">Любая версия</option></select>
        <select id="sort" aria-label="Сортировка">
          <option value="downloads">По загрузкам</option>
          <option value="relevance">По релевантности</option>
          <option value="follows">По подписчикам</option>
          <option value="updated">По дате обновления</option>
          <option value="newest">Сначала новые</option>
        </select>
      </div>
      ${def.showSource ? `
        <div class="chips" id="pluginSrc">
          <span class="legend">Показывать:</span>
          <button class="chip alt" data-value="both" aria-pressed="true">Оба источника</button>
          <button class="chip alt" data-value="hangar" aria-pressed="false">Только Hangar</button>
          <button class="chip alt" data-value="spiget" aria-pressed="false">Только SpigotMC</button>
        </div>
      ` : ""}
      ${def.allSources && window.mm ? `
        <div class="chips" id="allSrc">
          <span class="legend">Показывать:</span>
          <button class="chip alt" data-value="both" aria-pressed="true">Modrinth + CurseForge</button>
          <button class="chip alt" data-value="modrinth" aria-pressed="false">Только Modrinth</button>
          <button class="chip alt" data-value="curseforge" aria-pressed="false">Только CurseForge</button>
        </div>` : ""}
      ${def.srcChoice && window.mm ? `
        <div class="chips" id="srcChoice"><span class="legend">Источник:</span>
          <button class="chip alt" data-value="modrinth" aria-pressed="true">Modrinth</button>
          <button class="chip alt" data-value="curseforge" aria-pressed="false">CurseForge</button>
        </div>` : ""}
      <div class="chips" id="cats"><span class="legend">Категория:</span></div>
      ${def.showLoaders ? `<div class="chips" id="loaders"><span class="legend">Загрузчик:</span></div>` : ""}
      ${def.showSource ? `<p class="filter-note">Категории работают только для Hangar.</p>` : ""}
    </section>
    <div class="banner" id="banner" hidden></div>
    <div class="meta-row"><h2 style="font-size:19px">Результаты</h2><div class="meta-right"><div class="view-toggle" id="viewToggle" role="group" aria-label="Вид списка">
      <button type="button" data-view="cards" aria-pressed="true" title="Раскрытые карточки"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="2" width="7" height="7" rx="1"/><rect x="11" y="2" width="7" height="7" rx="1"/><rect x="2" y="11" width="7" height="7" rx="1"/><rect x="11" y="11" width="7" height="7" rx="1"/></svg>Карточки</button>
      <button type="button" data-view="compact" aria-pressed="false" title="Суженный список-таблица"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="16" height="3" rx="1"/><rect x="2" y="8.5" width="16" height="3" rx="1"/><rect x="2" y="14" width="16" height="3" rx="1"/></svg>Список</button>
    </div><button class="btn" id="resetFilters" type="button" hidden>Сбросить фильтры</button><div class="count" id="count"></div></div></div>
    <div class="grid" id="grid"></div>
    <nav class="pager" id="pager" aria-label="Страницы"></nav>
  `;

  $("q").value = catalog.q;
  $("sort").value = catalog.sort;
  // кнопки источников в разметке по умолчанию стоят на первом пункте: выставляем те, что были выбраны раньше
  [["pluginSrc","pluginSource"],["allSrc","allSource"],["srcChoice","src"]].forEach(([id,key])=>{
    const box = $(id); if(box) box.querySelectorAll(".chip").forEach(c=> c.setAttribute("aria-pressed", String(c.dataset.value === catalog[key])));
  });
  const paintView = ()=>{
    $("viewToggle").querySelectorAll("button").forEach(b=> b.setAttribute("aria-pressed", String(b.dataset.view === settings.view)));
    $("grid").classList.toggle("compact", settings.view === "compact");
    fixLastRow();
  };
  $("viewToggle").addEventListener("click", e=>{
    const b = e.target.closest("button[data-view]"); if(!b) return;
    settings.view = b.dataset.view; paintView();
  });
  paintView();
  $("openMrpack")?.addEventListener("click", ()=> window.LauncherUI?.installPackFile?.());
  $("openPackFolder")?.addEventListener("click", ()=> window.LauncherUI?.openInstanceFolder?.(def.folderSub));

  const buildCats = async ()=>{
    const box = $("cats"); if(!box) return;
    const tok = buildCats.tok = (buildCats.tok || 0) + 1;     // быстрые переключения источника: нужен только последний вызов
    box.innerHTML = `<span class="legend">Категория:</span>`;
    let list = Object.entries(def.categories).map(([v,label])=>({value:v,label}));
    if(def.dynamicCats){
      try{
        const names = await Modrinth.categoryList(def.projectType);
        if(names.length) list = names.map(v=>({value:v,label:catLabel(v)}));
      }catch(e){ /* остаётся запасной список */ }
      if(!$("cats") || tok !== buildCats.tok) return;
    }
    const cfOnly = catalog.src === "curseforge" || (def.allSources && window.mm && catalog.allSource === "curseforge");
    if(cfOnly){
      try{ list = (await mmCall("cf:categories", def.kind)).map(c=>({value:String(c.id), label:cfRuName(c.name)})); }catch(e){ list = []; }
      if(!$("cats") || tok !== buildCats.tok) return;
      // за время ответа переключили источник: список уже не тот
      if(!(catalog.src === "curseforge" || (def.allSources && catalog.allSource === "curseforge"))) return;
    }
    // «Общий каталог»: к категориям Modrinth добавляем категории CurseForge, которых у Modrinth нет (Редстоун, Биомы, Структуры…). Они ищут только на CurseForge.
    if(!cfOnly && def.allSources && window.mm && catalog.allSource !== "modrinth"){
      try{
        const cf = await (cfCatCache[def.kind] ??= mmCall("cf:categories", def.kind).catch(()=>{ delete cfCatCache[def.kind]; return []; }));
        if(!$("cats") || tok !== buildCats.tok) return;
        const known = new Set(list.flatMap(c=> [cfNorm(c.value), ...(CF_CAT_ALIAS[c.value]||[])]));
        const extra = cf.filter(c=> !known.has(cfNorm(c.name)) && !list.some(x=> cfRuName(c.name) === x.label))
          .map(c=>({value:"cf:"+c.id, label:cfRuName(c.name), title:"Категория CurseForge: показываются только результаты с CurseForge"}));
        list = list.concat(extra);
      }catch(e){ /* без дополнительных категорий */ }
    }
    buildChips(box, [{value:"",label:"Все"}, ...list], "cat", def.showSource);
  };
  buildCats();
  if(def.srcChoice && window.mm){
    $("srcChoice").querySelectorAll(".chip").forEach(b=>{
      b.addEventListener("click", ()=>{
        if(catalog.src === b.dataset.value) return;
        catalog.src = b.dataset.value; catalog.cat = "";
        $("srcChoice").querySelectorAll(".chip").forEach(c=> c.setAttribute("aria-pressed", String(c===b)));
        $("count").textContent = "";
        buildCats();
        loadCatalog();
      });
    });
  }
  if(def.allSources && window.mm){
    $("allSrc").querySelectorAll(".chip").forEach(b=>{
      b.addEventListener("click", ()=>{
        if(catalog.allSource === b.dataset.value) return;
        catalog.allSource = b.dataset.value;
        catalog.cat = "";        // у Modrinth слаги, у CurseForge числовые id: выбранная категория другого источника не подходит
        $("allSrc").querySelectorAll(".chip").forEach(c=> c.setAttribute("aria-pressed", String(c===b)));
        buildCats();
        loadCatalog();
      });
    });
  }
  if(def.showLoaders){
    buildChips($("loaders"), [{value:"",label:"Все"}, ...LOADER_IDS.map(v=>({value:v,label:LOADER_LABEL[v],icon:ldIcon(v)}))], "loader");
  }
  if(def.showSource){
    $("pluginSrc").querySelectorAll(".chip").forEach(b=>{
      b.addEventListener("click", ()=>{
        catalog.pluginSource = b.dataset.value;
        $("pluginSrc").querySelectorAll(".chip").forEach(c=> c.setAttribute("aria-pressed", String(c===b)));
        loadCatalog();
      });
    });
  }

  getGameVersions().then(vs=>{
    const sel = $("gv"); if(!sel) return;
    vs.forEach(v=>{ const o=document.createElement("option"); o.value=v; o.textContent=v; sel.appendChild(o); });
    if(catalog && catalog.gv){
      if(!vs.includes(catalog.gv)){ const o=document.createElement("option"); o.value=catalog.gv; o.textContent=catalog.gv; sel.appendChild(o); }
      sel.value = catalog.gv;
    }
  });

  let debounce;
  const qi = $("q"), qClear = $("qClear");
  const syncClear = ()=>{ qClear.hidden = !qi.value; };
  const runSearch = ()=>{ clearTimeout(debounce); catalog.q = qi.value.trim(); loadCatalog(); };
  syncClear();
  qi.addEventListener("input", ()=>{ syncClear(); clearTimeout(debounce); debounce = setTimeout(runSearch, 300); });
  attachSuggest(qi, ()=> ({mods:"mod", modpacks:"modpack", resourcepacks:"resourcepack", shaders:"shader", datapacks:"datapack", plugins:"plugin"})[kind] || "mod");
  qi.addEventListener("keydown", e=>{
    if(e.key === "Enter"){ e.preventDefault(); runSearch(); }
    if(e.key === "Escape" && qi.value){ e.preventDefault(); qClear.click(); }
  });
  qClear.addEventListener("click", ()=>{ qi.value = ""; syncClear(); runSearch(); qi.focus(); });
  $("resetFilters").addEventListener("click", ()=> renderCatalogPage(catalog.kind, {fresh:true}));
  $("sort").addEventListener("change", e=>{ catalog.sort = e.target.value; loadCatalog(); });
  $("gv").addEventListener("change", e=>{
    catalog.gv = e.target.value;
    window.LauncherUI?.presence?.();     // статус в Discord: версия из фильтра
    if(def.versionServerSide) loadCatalog(); else renderCatalogGrid();
  });
  window.LauncherUI?.presence?.();
  const goPage = n=>{
    n = Math.max(1, Math.floor(+n) || 1);
    if(catalog.pageBase != null) n = Math.min(n, Math.max(1, Math.ceil(Math.min(catalog.pageBase, 10000) / PAGE_SIZE)));
    if(n === catalog.page) return;
    catalog.page = n;
    loadCatalog({keepPage:true});
    window.scrollTo({top:0, behavior:"smooth"});     // после смены страницы, в самый верх
  };
  $("pager").addEventListener("click", e=>{
    const b = e.target.closest("[data-go]");
    if(!b || b.disabled) return;
    goPage(b.dataset.go);
  });
  $("pager").addEventListener("submit", e=>{
    e.preventDefault();
    const v = e.target.querySelector("input")?.value;
    if(v) goPage(v);
  });

  loadCatalog({keepPage: catalog.page > 1});   // вернулись на страницу: открываем ту страницу списка, на которой остановились
}

function buildChips(container, values, key, clientOnly){
  values.forEach(v=>{
    const b = document.createElement("button");
    b.className = "chip"; b.dataset.value = v.value; if(v.title) b.title = v.title;
    if(v.icon){ b.innerHTML = v.icon; b.appendChild(document.createTextNode(v.label)); } else b.textContent = v.label;
    b.setAttribute("aria-pressed", String(catalog[key] === v.value));
    b.addEventListener("click", ()=>{
      catalog[key] = v.value;
      container.querySelectorAll(".chip").forEach(c=> c.setAttribute("aria-pressed", String(c.dataset.value === v.value)));
      if(key === "loader") window.LauncherUI?.presence?.();     // статус в Discord: установщик из фильтра
      // Modrinth (моды/сборки) фильтрует через серверный фасет, нужен новый запрос.
      // Hangar/SpigotMC не поддерживают этот фасет, фильтруем уже загруженный список на клиенте.
      if(clientOnly) renderCatalogGrid(); else loadCatalog();
    });
    container.appendChild(b);
  });
}

async function loadCatalog({keepPage=false} = {}){
  if(catController) catController.abort();
  catController = new AbortController();
  const signal = catController.signal;
  const def = CATALOG_DEF[catalog.kind];
  if(!keepPage) catalog.page = 1;
  catalog.offset = (catalog.page - 1) * PAGE_SIZE;
  $("grid").innerHTML = Array.from({length:6}, ()=>`<div class="skeleton"></div>`).join("");
  $("pager").innerHTML = "";
  updateResetBtn();

  const onlyCf = /^cf:/.test(catalog.cat || "");       // дополнительные категории CurseForge: ищем только там
  const keys = onlyCf ? ["curseforge"] : def.keys(catalog);
  const params = {
    query:catalog.q, category:onlyCf ? catalog.cat.slice(3) : catalog.cat, loader:catalog.loader, gameVersion:catalog.gv,
    sort:catalog.sort, projectType:def.projectType, offset:catalog.offset, limit:PAGE_SIZE, signal
  };
  try{
    const {raw, exhausted, total, pageBase, anyOk, failed} = await fetchSources(keys, params);
    // пока ждали ответ, запрос уже сменился (новое слово, фильтр, страница): CurseForge не отменяется, и его старый ответ затёр бы свежий
    if(signal.aborted) return;
    if(!anyOk) throw new Error(failed.length ? failed.map(f=> `${f.key}: ${f.msg}`).join("; ") : "источники недоступны");
    raw.forEach(r=> r.kind = def.kind);
    catalog.rawAll = raw;
    catalog.exhausted = exhausted;
    catalog.total = total; catalog.pageBase = pageBase;
    catalog.offline = false;
    const srcName = {modrinth:"Modrinth", curseforge:"CurseForge", hangar:"Hangar", spiget:"SpigotMC"};
    if(failed.length) showBanner(`<b>${failed.map(f=> srcName[f.key] || f.key).join(", ")} не ответил</b>Показаны результаты остальных источников.
      <details><summary>Технические детали</summary>${failed.map(f=> `${srcName[f.key] || f.key}: ${f.msg}`.replace(/&/g,"&amp;").replace(/</g,"&lt;")).join("<br>")}</details>`);
    else hideBanner();
    catalog.items = sortItems(mergeAll(raw).map(ensureShape), catalog.sort);
    renderCatalogGrid();
  }catch(err){
    if(err.name === "AbortError") return;
    catalog.offline = true;
    const isRes = RES_KINDS.includes(def.kind);   // офлайн-снимок только про моды, ресурспаки и шейдеры в нём не показываем
    catalog.items = isRes ? [] : SNAPSHOT.map(m=>({...ensureShape(m), kind:def.kind}));
    catalog.exhausted = true;
    renderCatalogGrid();
    showBanner(`<b>Не получилось загрузить актуальные данные</b>${isRes ? "Проверьте подключение к интернету и попробуйте ещё раз." : "Показан ограниченный офлайн-список без счётчиков. Попробуйте обновить страницу позже."}
      <details><summary>Технические детали</summary>${keys.join(", ")}: ${err.message}</details>`);
  }
}

function updateResetBtn(){
  const b = $("resetFilters");
  if(b && catalog) b.hidden = !(catalog.q || catalog.cat || catalog.loader || catalog.gv);
}
function pageList(p, n){
  const arr = [...new Set([1, 2, n-1, n, p-2, p-1, p, p+1, p+2].filter(x=> x>=1 && x<=n))].sort((a,b)=>a-b);
  const out = [];
  arr.forEach((x,i)=>{ if(i && x - arr[i-1] > 1) out.push("…"); out.push(x); });
  return out;
}
function renderPager(){
  const el = $("pager");
  if(!el || !catalog) return;
  const p = catalog.page;
  const n = catalog.pageBase != null ? Math.max(1, Math.ceil(Math.min(catalog.pageBase, 10000) / PAGE_SIZE)) : null;
  const hasPrev = p > 1, hasNext = n ? p < n : !catalog.exhausted;
  if(catalog.offline || (!hasPrev && !hasNext)){ el.innerHTML = ""; return; }
  const nav = (go, label, off, aria)=> `<button class="pg pg-nav" type="button" data-go="${go}" ${off ? "disabled" : ""} aria-label="${aria}">${label}</button>`;
  const mid = n
    ? pageList(p, n).map(x=> x === "…" ? `<span class="pg-gap">…</span>`
        : `<button class="pg${x===p ? " cur" : ""}" type="button" data-go="${x}" ${x===p ? 'aria-current="page"' : ""}>${x}</button>`).join("")
    : `<span class="pg-info">Страница ${p}</span>`;
  // если источник не сообщает общее число (например, SpigotMC), страницу всё равно можно ввести вручную
  const jump = n == null || n > 1 ? `<form class="pg-jump" novalidate><label>Перейти на стр. <input type="number" min="1" ${n ? `max="${n}"` : ""} inputmode="numeric" placeholder="${p}" aria-label="${n ? `Номер страницы из ${n}` : "Номер страницы"}"></label><button class="pg" type="submit">Ок</button></form>` : "";
  el.innerHTML = nav(p-1, "‹ Назад", !hasPrev, "Предыдущая страница") + mid + nav(p+1, "Вперёд ›", !hasNext, "Следующая страница") + jump;
}

/* подсветка найденных слов в названии */
function hl(text, q){
  const esc = t => String(t).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const words = String(q||"").trim().split(/\s+/).filter(w=>w.length>1).map(w=>w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if(!words.length) return esc(text||"");
  return String(text||"").split(new RegExp("(" + words.join("|") + ")", "gi"))
    .map((p,i)=> i % 2 ? `<mark>${esc(p)}</mark>` : esc(p)).join("");
}

/* Последний ряд карточек не должен оставаться с «дырой»: карточки растягиваются на всю строку.
   Если в ряду осталась ровно одна карточка, она занимает обычную ширину колонки, а не весь ряд. */
function fixLastRow(){
  const grid = document.getElementById("grid");
  if(!grid) return;
  const cards = [...grid.querySelectorAll(":scope>.card")];
  cards.forEach(c=> c.style.flex = "");
  if(!cards.length || grid.classList.contains("compact")) return;
  const gap = 18, minW = 280, cols = Math.max(1, Math.floor((grid.clientWidth + gap) / (minW + gap)));
  if(cols > 1 && cards.length % cols === 1){
    cards[cards.length-1].style.flex = `0 0 calc((100% - ${gap*(cols-1)}px) / ${cols})`;
  }
}
window.addEventListener("resize", ()=>{ clearTimeout(fixLastRow._t); fixLastRow._t = setTimeout(fixLastRow, 120); });

function showBanner(html){ const b=$("banner"); if(b){ b.innerHTML = html; b.hidden = false; } }
function hideBanner(){ const b=$("banner"); if(b) b.hidden = true; }

function renderCatalogGrid(){
  translateEpoch++;
  const grid = $("grid");
  if(!grid) return;
  const cfSrc = catalog.src === "curseforge" || !!CATALOG_DEF[catalog.kind].allSources;   // CurseForge и «Общий каталог» фильтруют на сервере
  const list = cfSrc ? catalog.items : catalog.items.filter(m=>
    passesLoader(m, catalog.loader) && passesCategory(m, catalog.cat) && passesVersion(m, catalog.gv)
  );
  grid.innerHTML = "";
  if(!list.length){
    grid.innerHTML = `<div class="state"><b>Ничего не нашлось</b>Попробуйте другое слово или сбросьте фильтры.</div>`;
  } else {
    const frag = document.createDocumentFragment();
    list.forEach((m,i)=>{ const c = buildCard(m, renderCatalogGrid); c.style.setProperty("--i", Math.min(i, 14)); frag.appendChild(c); });
    grid.appendChild(frag);
  }
  grid.classList.toggle("compact", settings.view === "compact");
  fixLastRow();
  if(catalog.offline){
    $("count").textContent = `${list.length} · офлайн-список`;
  } else if(catalog.total != null){
    $("count").textContent = `${nf.format(catalog.total)} найдено · стр. ${catalog.page}`;
  } else {
    $("count").textContent = `${list.length} на странице`;
  }
  renderPager(); updateResetBtn();
}

/* ============================================================
   Главная
   ============================================================ */
const QUICK_ICONS = {
  mods: `<path d="M3 7l9-5 9 5-9 5z M3 7v10l9 5 9-5V7 M12 12v10 M7 5l10 5v4"/>`,
  plugins: `<path d="M5 3l5 3-3 5-5-3z M14 12l6 3-3 6-6-3z M8 9l7 5 M15 3v5h5"/>`,
  modpacks: `<path d="M2 8l10-5 10 5-10 5z M2 12l10 5 10-5 M2 16l10 5 10-5"/>`,
  resourcepacks: `<path d="M3 5l7-2 5 3 6-2v15l-6 2-5-3-7 2z M10 3v15 M15 6v15"/>`,
  shaders: `<path d="M2 18l6-8 4 5 3-4 7 7z M14 5a3 3 0 1 0 6 0 3 3 0 0 0-6 0z M5 21h14"/>`,
  datapacks: `<path d="M6 3h9l4 4v14H6z M15 3v4h4 M10.5 12l-2.5 2.5 2.5 2.5 M13.5 12l2.5 2.5-2.5 2.5"/>`,
  favorites: `<path d="M4 5h5l2 2h9v13H4z M12 10l1.2 2.2 2.5.5-1.8 1.8.3 2.5-2.2-1.1-2.2 1.1.3-2.5-1.8-1.8 2.5-.5z"/>`,
  servers: `<path d="M3 4h18v6H3z M3 14h18v6H3z M6 7h2 M6 17h2 M15 7h3 M15 17h3"/>`,
  settings: `<path d="M3 6h6m5 0h7 M3 12h12m5 0h1 M3 18h2m5 0h11 M9 4h5v4H9z M15 10h5v4h-5z M5 16h5v4H5z"/>`
};
function sectionHead(kind, title, description = "") {
  const icon = (QUICK_ICONS[kind] || "").replace(/<path /g, '<path pathLength="1" ');
  return `<header class="section-cover" data-kind="${kind}">
    <div class="cover-copy"><h1>${title}</h1>${description ? `<p class="page-lede">${description}</p>` : ""}</div>
    <div class="cover-deco" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="section-emblem" aria-hidden="true"><span class="emblem-ring"></span><svg viewBox="0 0 24 24">${icon}</svg></div>
  </header>`;
}
const FEATURES = [
  {ico:"⛏️", title:"Всегда актуально", text:"Карточки берутся прямо с площадок при каждом запросе, так что данные всегда свежие."},
  {ico:"🧭", title:"Четыре источника сразу", text:"Modrinth, CurseForge, Hangar и SpigotMC. Если проект есть на нескольких площадках, он показывается одной карточкой."},
  {ico:"🌐", title:"Автоперевод описаний", text:"Английские описания переводятся прямо на карточке. Язык можно выбрать в настройках."},
  {ico:"⭐", title:"Личное избранное", text:"Нажмите ★ на карточке, чтобы сохранить её и вернуться к ней позже."}
];

function renderHome(){
  translateEpoch++;
  const content = $("content");
  content.innerHTML = `
    <section class="hero-home">
      <div class="hero-flex">
        <div class="hero-content">
          <span class="edition-label">Minecraft Java Edition</span><h1>MatrixL</h1>
          <div class="search-row home-search">
            <label class="search">
              <span class="search-icon" aria-hidden="true"></span>
              <input id="homeSearch" type="search" placeholder="Например: sodium, create, essentialsx">
            </label>
          </div>
        </div>

      </div>
    </section>

    <div class="quick-grid">
      <button class="quick-card" data-page="mods">
        <span class="quick-icon"><svg viewBox="0 0 24 24">${QUICK_ICONS.mods}</svg></span>
        <span><b>Моды</b><span>Клиентские моды: Fabric, Forge, NeoForge, Quilt</span></span>
      </button>
      <button class="quick-card" data-page="plugins">
        <span class="quick-icon"><svg viewBox="0 0 24 24">${QUICK_ICONS.plugins}</svg></span>
        <span><b>Плагины</b><span>Серверные плагины Paper и Spigot</span></span>
      </button>
      <button class="quick-card" data-page="modpacks">
        <span class="quick-icon"><svg viewBox="0 0 24 24">${QUICK_ICONS.modpacks}</svg></span>
        <span><b>Сборки</b><span>Готовые модпаки с Modrinth</span></span>
      </button>
      <button class="quick-card" data-page="resourcepacks">
        <span class="quick-icon"><svg viewBox="0 0 24 24">${QUICK_ICONS.resourcepacks}</svg></span>
        <span><b>Ресурспаки</b><span>Текстуры, звуки и шрифты</span></span>
      </button>
      <button class="quick-card" data-page="shaders">
        <span class="quick-icon"><svg viewBox="0 0 24 24">${QUICK_ICONS.shaders}</svg></span>
        <span><b>Шейдеры</b><span>Освещение, тени и вода как в кино</span></span>
      </button>
      <button class="quick-card" data-page="datapacks">
        <span class="quick-icon"><svg viewBox="0 0 24 24">${QUICK_ICONS.datapacks}</svg></span>
        <span><b>Датапаки</b><span>Новые механики, крафты и структуры без модов</span></span>
      </button>
      <button class="quick-card" data-page="favorites">
        <span class="quick-icon"><svg viewBox="0 0 24 24">${QUICK_ICONS.favorites}</svg></span>
        <span><b>Избранное</b><span>Сохранённые вами карточки</span></span>
      </button>
    </div>

    <section class="home-section" id="newsSection" hidden>
      <div class="section-title"><h2>Новости Minecraft</h2><a href="https://www.minecraft.net/ru-ru/articles" target="_blank" rel="noopener">Все новости ↗</a></div>
      <div class="news-grid" id="newsGrid"></div>
    </section>
  `;

  attachSuggest($("homeSearch"), ()=> "mod");
  $("homeSearch").addEventListener("keydown", e=>{
    if(e.key === "Enter"){ setPage("mods", {q:e.target.value.trim()}); }
  });
  content.querySelectorAll(".quick-card").forEach(b=> b.addEventListener("click", ()=> setPage(b.dataset.page)));

  loadMinecraftNews();
}

/* ---------- новости Minecraft (официальная лента Mojang) ---------- */
async function loadMinecraftNews(){
  const section = $("newsSection"), grid = $("newsGrid");
  if(!section || !grid) return;
  try{
    const r = await fetch("https://launchercontent.mojang.com/v2/news.json");
    if(!r.ok) throw new Error("новости недоступны");
    const data = await r.json();
    const items = (data.entries||[]).slice(0,3);
    if(!items.length) return;
    grid.innerHTML = items.map(n=>`
      <div class="news-card">
        <span class="n-date">${dateRu(n.date)}</span>
        <b class="n-title">${n.title||""}</b>
        <p class="n-desc">${(n.text||"").slice(0,110)}${(n.text||"").length>110?"…":""}</p>
        ${n.readMoreLink ? `<a href="${n.readMoreLink}" target="_blank" rel="noopener">Читать ↗</a>` : ""}
      </div>`).join("");
    section.hidden = false;
    grid.querySelectorAll(".news-card").forEach((card,i)=>{
      const n = items[i];
      const titleEl = card.querySelector(".n-title");
      const descEl = card.querySelector(".n-desc");
      if(n.title) maybeTranslate(titleEl, n.title);
      if(descEl.textContent) maybeTranslate(descEl, descEl.textContent);
    });
  }catch(e){
    // лента недоступна (например, нет сети), просто не показываем раздел
  }
}

/* ============================================================
   Избранное
   ============================================================ */
let favView = "all";          // "all" или id сборки
const cmEsc = t=> String(t==null?"":t).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

/* Панель проверки совместимости: общая для избранного, окна установки и настроек экземпляра.
   issues, результат Compat.checkCards() или проверки папки mods (см. src/core.js). */
function compatHTML(issues, o){
  o = o || {};
  const C = window.Compat; if(!C) return "";
  const list = (issues||[]).filter(i=> o.hideInfo ? i.level!=="info" : true);
  const n = C.count(list);
  const sum = n.error ? `<b class="cm-sum err">Найдено проблем: ${n.error}${n.warn ? ` · предупреждений: ${n.warn}` : ""}</b>`
            : n.warn ? `<b class="cm-sum warn">Предупреждений: ${n.warn}</b>`
            : `<b class="cm-sum ok">Конфликтов не найдено</b>`;
  const ICON = {error:"✕", warn:"!", info:"i"};
  const canIgnore = !!o.instanceId;   // кнопки «Игнорировать» только у проверки установленных модов, у неё есть ключ проблемы
  const items = list.map(i=>{
    const mods = (i.mods||[]);
    const chips = mods.slice(0,8).map(t=>`<span class="cm-chip">${cmEsc(t)}</span>`).join("") + (mods.length>8 ? `<span class="cm-chip">+${mods.length-8}</span>` : "");
    const ign = canIgnore && i.key ? `<button class="btn cm-ignore" type="button" data-key="${cmEsc(i.key)}" title="Больше не показывать эту проблему для этой установки">Игнорировать</button>` : "";
    return `<li class="cm-i ${i.level}"><span class="cm-ico" aria-hidden="true">${ICON[i.level]||"i"}</span>
      <div class="cm-txt"><b>${cmEsc(i.title)}</b><p>${cmEsc(i.text)}</p>${chips ? `<div class="cm-mods">${chips}</div>` : ""}</div>${ign}</li>`;
  }).join("");
  const keyed = list.filter(i=> i.key).length;
  const ignAll = canIgnore && keyed > 1 ? `<button class="btn cm-ignore-all" type="button">Игнорировать все</button>` : "";
  const hidden = canIgnore && o.ignored > 0 ? `<p class="cm-note cm-hidden">Скрыто проблем: ${o.ignored} <button class="btn cm-unignore" type="button">Вернуть скрытые</button></p>` : "";
  return `<section class="cm-box ${n.error ? "has-err" : n.warn ? "has-warn" : "is-ok"}" aria-label="Проверка совместимости"${canIgnore ? ` data-inst="${cmEsc(o.instanceId)}"` : ""}>
    <div class="cm-head"><span class="cm-title">Проверка совместимости</span>${sum}${ignAll}</div>
    ${items ? `<ul class="cm-list">${items}</ul>` : ""}
    ${hidden}
    ${o.note===false ? "" : `<p class="cm-note">${cmEsc(o.note || "Проверка смотрит на загрузчики, версии игры, повторы и список известных конфликтов. Это подсказка, а не гарантия: точно проверить можно только запуском игры.")}</p>`}
  </section>`;
}

function renderFavoritesPage(){
  translateEpoch++;
  collections.prune();
  if(favView !== "all" && !collections.get(favView)) favView = "all";
  const content = $("content");
  const everything = [...favorites.values()];
  const builds = collections.all();
  const col = favView === "all" ? null : collections.get(favView);
  const list = col ? everything.filter(m=> col.ids.includes(m.id)) : everything;
  const installable = list.filter(m=> (m.source==="modrinth" || m.source==="curseforge") && m.kind==="mod").length;
  const dlable = list.filter(m=> (m.source==="modrinth" || m.source==="curseforge") && ["mod","resourcepack","shader","datapack"].includes(m.kind)).length;
  const safe = cmEsc;
  // плашки создания сборки видны всегда, даже когда в избранном ещё ничего нет
  content.innerHTML = `
    ${sectionHead("favorites", "Избранное", "Здесь лежат сохранённые вами карточки. Собирайте из них свои сборки и проверяйте, подходят ли моды друг к другу.")}
    <div class="chips fav-tabs" id="favTabs" role="tablist">
      <button class="chip" role="tab" data-view="all" aria-pressed="${favView==="all"}">Все (${everything.length})</button>
      ${builds.map(c=>`<button class="chip" role="tab" data-view="${safe(c.id)}" aria-pressed="${favView===c.id}">${safe(c.name)} (${c.ids.length})</button>`).join("")}
      <form class="coll-new" id="collNew"><input type="text" maxlength="40" placeholder="Новая сборка" aria-label="Название новой сборки"><button class="btn" type="submit">＋ Создать сборку</button></form>
    </div>
    ${builds.length ? "" : `<p class="coll-hint">Сборка это ваш набор модов. Его можно проверить на совместимость и установить в Minecraft одной кнопкой. Введите название и нажмите «Создать сборку», моды можно добавить позже.</p>`}
    <div class="meta-row"><div class="count">${list.length} ${col ? "в сборке «"+safe(col.name)+"»" : "сохранено"}</div>
      <div class="meta-right">
        ${window.mm && dlable ? `<button class="btn primary" id="favDlAll" type="button">Скачать всё (${dlable})</button>` : ""}
        ${window.mm && installable ? `<button class="btn" id="favInstall" type="button">Установить всё в Minecraft (${installable})</button>` : ""}
        ${col ? `<button class="btn" id="collRename" type="button">Переименовать</button><button class="btn danger" id="collDelete" type="button">Удалить сборку</button>`
              : everything.length ? `<button class="btn danger" id="clearFavs" type="button">Очистить всё</button>` : ""}
      </div></div>
    <div id="compatBox"></div>
    <div class="grid" id="favGrid"></div>
  `;
  const grid = $("favGrid");
  if(!list.length){
    grid.innerHTML = col
      ? `<div class="state"><b>В сборке пока пусто</b>${everything.length ? "Откройте вкладку «Все» и нажмите «В сборку» на нужных карточках." : "Сначала отметьте моды звёздочкой ★ в разделе «Моды», потом их можно будет добавить в сборку."}</div>`
      : `<div class="state"><b>Пока пусто</b>Нажмите ★ на любой карточке в «Модах», «Плагинах» или «Сборках», чтобы добавить сюда.</div>`;
  } else {
    // проверка совместимости, только для сборки: «Все» это просто свалка закладок
    let bad = new Map();
    if(col && window.Compat){
      const issues = Compat.checkCards(list);
      $("compatBox").innerHTML = compatHTML(issues);
      issues.forEach(i=> { if(i.level!=="info") i.mods.forEach(t=>{ if(!bad.has(t) || i.level==="error") bad.set(t, i.level); }); });
    }
    sortItems(list, "downloads").forEach(m=>{
      const card = buildCard(m, renderFavoritesPage);
      const lvl = bad.get(m.title);
      if(lvl){ card.classList.add("cm-"+lvl); card.title = lvl==="error" ? "Есть проблема совместимости, смотрите проверку выше" : "Есть предупреждение, смотрите проверку выше"; }
      const foot = card.querySelector(".card-foot");
      const b = document.createElement("button");
      b.type = "button"; b.className = "coll-btn"; b.textContent = "В сборку";
      b.addEventListener("click", e=>{ e.stopPropagation(); openCollMenu(b, m); });
      foot.insertBefore(b, foot.querySelector(".fav"));
      grid.appendChild(card);
    });
  }
  $("favTabs").addEventListener("click", e=>{
    const t = e.target.closest("[data-view]"); if(!t) return;
    favView = t.dataset.view; renderFavoritesPage();
  });
  $("collNew").addEventListener("submit", e=>{
    e.preventDefault();
    const c = collections.create(e.target.querySelector("input").value);
    if(c){ favView = c.id; toast(`Сборка «${c.name}» создана`); renderFavoritesPage(); }
    else e.target.querySelector("input").focus();
  });
  $("favDlAll")?.addEventListener("click", ()=> window.LauncherUI?.downloadAll?.(list, col ? col.name : "Всё избранное"));
  $("favInstall")?.addEventListener("click", ()=> window.LauncherUI?.installMany?.(list, col ? col.name : "Всё избранное"));
  $("clearFavs")?.addEventListener("click", async ()=>{
    if(!await window.UI.confirm({title:"Очистить избранное?", text:"Все сохранённые карточки будут удалены.", ok:"Удалить всё", danger:true})) return;
    favorites.clear(); collections.prune(); updateFavCount(); renderFavoritesPage();
  });
  $("collDelete")?.addEventListener("click", async ()=>{
    if(!await window.UI.confirm({title:"Удалить сборку?", text:`Сборка «${col.name}» будет удалена. Сами карточки останутся в избранном.`, ok:"Удалить", danger:true})) return;
    collections.remove(col.id); favView = "all"; renderFavoritesPage();
  });
  $("collRename")?.addEventListener("click", ()=>{
    const wrap = $("collRename").parentNode;
    wrap.innerHTML = `<form class="coll-new" id="collRen"><input type="text" maxlength="40" value="${safe(col.name)}" aria-label="Новое название"><button class="btn primary" type="submit">Сохранить</button></form>`;
    const f = $("collRen"); f.querySelector("input").focus(); f.querySelector("input").select();
    f.addEventListener("submit", e=>{ e.preventDefault(); collections.rename(col.id, f.querySelector("input").value); renderFavoritesPage(); });
  });
}

/* меню «В сборку»: галочки по сборкам + быстрое создание новой */
function openCollMenu(anchor, m){
  document.querySelector(".coll-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "coll-menu"; menu.setAttribute("role","menu");
  const safe = t=> String(t).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  const paint = ()=>{
    const cs = collections.all();
    menu.innerHTML = `<div class="coll-h">Сборки</div>
      ${cs.length ? cs.map(c=>`<label class="coll-i"><input type="checkbox" data-c="${c.id}" ${collections.has(c.id, m.id) ? "checked" : ""}> ${safe(c.name)}</label>`).join("") : `<div class="coll-empty">Сборок пока нет</div>`}
      <form class="coll-new"><input type="text" maxlength="40" placeholder="Новая сборка" aria-label="Название"><button class="btn" type="submit">＋</button></form>`;
  };
  paint();
  menu.addEventListener("change", e=>{ const id = e.target.dataset.c; if(id){ collections.toggle(id, m.id); } });
  menu.addEventListener("submit", e=>{
    e.preventDefault();
    const c = collections.create(e.target.querySelector("input").value);
    if(c){ if(!collections.has(c.id, m.id)) collections.toggle(c.id, m.id); paint(); toast(`Добавлено в «${c.name}»`); }
  });
  menu.addEventListener("click", e=> e.stopPropagation());
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - menu.offsetWidth - 8)) + "px";
  menu.style.top = Math.min(r.bottom + 6, Math.max(8, innerHeight - menu.offsetHeight - 8)) + "px";
  const close = e=>{ if(!menu.contains(e.target)){ menu.remove(); document.removeEventListener("mousedown", close, true); document.removeEventListener("keydown", esc, true); renderFavoritesPage(); } };
  const esc = e=>{ if(e.key==="Escape") close({target:document.body}); };
  setTimeout(()=>{ document.addEventListener("mousedown", close, true); document.addEventListener("keydown", esc, true); });
}

/* ============================================================
   Настройки
   ============================================================ */
function renderSettingsPage(){
  const content = $("content");
  const theme = getTheme();
  const defSort = getDefaultSort();
  const lang = getLang();
  content.innerHTML = `
    ${sectionHead("settings", "Настройки", "Настройки хранятся на этом компьютере и на данные модов не влияют.")}
    <section class="set-sec">
      <h2 class="set-sec-h">Внешний вид</h2>
      <div class="settings-grid">
      <div class="setting-card">
        <h3>Язык интерфейса</h3>
        <p>Язык лаунчера: русский или английский.</p>
        <div class="lang-seg" id="uiLangSeg">
          <button type="button" class="btn" data-ui="ru" aria-pressed="${window.I18N.lang()==="ru"}">RU</button>
          <button type="button" class="btn" data-ui="en" aria-pressed="${window.I18N.lang()==="en"}">ENG</button>
        </div>
      </div>
      <div class="setting-card">
        <h3>Цветовая тема</h3>
        <p>Фон всегда тёмный, меняется только цвет акцентов.</p>
        <div class="swatches" id="themeSwatches">
          ${THEMES.map(t=>`
            <button class="swatch" data-value="${t.id}" aria-pressed="${t.id===theme}" style="color:${t.c1}" title="${t.label}">
              <span class="swatch-dot" style="background:linear-gradient(135deg,${t.c1},${t.c2})"></span>
              <span class="swatch-label">${t.label}</span>
            </button>`).join("")}
        </div>
      </div>
      ${window.mm && window.AppBg ? window.AppBg.cardHTML() : ""}
      ${window.mm ? `<div class="setting-card" id="stIntro">
        <h3>Интро при запуске</h3>
        <p>Короткая заставка с логотипом при открытии лаунчера. Её можно пропустить кликом или любой клавишей.</p>
        <button type="button" class="dc-toggle" id="introOn" role="switch" aria-checked="true" aria-describedby="introStat">
          <span class="dc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5v14l11-7z"/></svg></span>
          <span class="dc-txt"><b>Показывать интро при запуске</b><small id="introStat">Загружаю…</small></span>
          <span class="dc-track" aria-hidden="true"><i></i></span>
        </button>
      </div>` : ""}
      </div>
    </section>
    ${window.mm ? `<section class="set-sec">
      <h2 class="set-sec-h">Лаунчер и игра</h2>
      <div class="settings-grid">
      ${window.mm ? `<div class="setting-card" id="stHide">
        <h3>Сворачивание лаунчера</h3>
        <p>После успешного запуска игры лаунчер прячется и пропадает с панели задач. Он остаётся скрытым, пока игра не будет закрыта полностью, и появляется снова после её закрытия.</p>
        <button type="button" class="dc-toggle" id="hideOn" role="switch" aria-checked="false" aria-describedby="hideStat">
          <span class="dc-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8M12 18v3"/></svg></span>
          <span class="dc-txt"><b>Сворачивать лаунчер при запуске игры</b><small id="hideStat">Загружаю…</small></span>
          <span class="dc-track" aria-hidden="true"><i></i></span>
        </button>
      </div>` : ""}
      ${window.mm ? `<div class="setting-card" id="stDiscord">
        <h3>Статус в Discord</h3>
        <p>В профиле Discord видно, что вы делаете в лаунчере. В игре показываются режим (главное меню, одиночная игра, сервер), местоположение, биом, погода, а на серверах ещё и число игроков онлайн.</p>
        <button type="button" class="dc-toggle" id="dcOn" role="switch" aria-checked="true" aria-describedby="dcStat">
          <span class="dc-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M19.3 5.4A17 17 0 0 0 15 4.1l-.2.4a15.6 15.6 0 0 1 3.9 1.9 14.7 14.7 0 0 0-13.4 0 15.6 15.6 0 0 1 3.9-1.9l-.2-.4a17 17 0 0 0-4.3 1.3C2.1 9.5 1.4 13.4 1.7 17.2a17.2 17.2 0 0 0 5.3 2.7l1.1-1.8a11 11 0 0 1-1.7-.8l.4-.3a12.3 12.3 0 0 0 10.4 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.8a17.2 17.2 0 0 0 5.3-2.7c.4-4.4-.7-8.3-3-11.8zM8.7 14.9c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg></span>
          <span class="dc-txt"><b>Показывать статус в Discord</b><small id="dcStat">Загружаю…</small></span>
          <span class="dc-track" aria-hidden="true"><i></i></span>
        </button>
        <div class="upd-actions"><button type="button" class="btn" id="dcAdv">Расширенные настройки</button></div>
      </div>` : ""}
      </div>
    </section>` : ""}
    <section class="set-sec">
      <h2 class="set-sec-h">Каталог</h2>
      <div class="settings-grid">
      <div class="setting-card">
        <h3>Перевод описаний</h3>
        <p>Описания модов и плагинов из Modrinth/CurseForge/Hangar/SpigotMC чаще всего на английском, поэтому мы переводим их автоматически.</p>
        <select id="langSel">
          ${LANGS.map(l=>`<option value="${l.id}" ${l.id===lang?"selected":""}>${l.label}</option>`).join("")}
        </select>
      </div>
      <div class="setting-card">
        <h3>Сортировка по умолчанию</h3>
        <p>Применяется при открытии «Модов», «Плагинов», «Сборок», «Ресурспаков» и «Шейдеров».</p>
        <select id="defSort">
          <option value="downloads">По загрузкам</option>
          <option value="relevance">По релевантности</option>
          <option value="follows">По подписчикам</option>
          <option value="updated">По дате обновления</option>
          <option value="newest">Сначала новые</option>
        </select>
      </div>
      <div class="setting-card">
        <h3>Избранное</h3>
        <p>Сейчас сохранено: ${favorites.size}.</p>
        <button class="btn danger" id="stClearFavs" ${favorites.size?"":"disabled"}>Очистить избранное</button>
      </div>
      </div>
    </section>
    <section class="set-sec">
      <h2 class="set-sec-h">Система</h2>
      <div class="settings-grid">
      ${window.mm ? `<div class="setting-card" id="stUpdate">
        <h3>Обновление лаунчера</h3>
        <p id="upStat" role="status">Загружаю…</p>
        <progress id="upBar" max="100" value="0" hidden style="width:100%"></progress>
        <pre class="upd-notes" id="upNotes" hidden></pre>
        <div class="upd-actions">
          <button type="button" class="btn primary" id="upBtn" disabled>Проверить обновления</button>
          <button type="button" class="btn upd-x" id="upCancel" hidden>Отмена</button>
          <a class="btn" id="upLink" target="_blank" rel="noopener" hidden>Страница релиза ↗</a>
        </div>
      </div>` : ""}
      ${window.mm ? `<div class="setting-card" id="stJava">
        <h3>Java</h3>
        <p id="jvStat" role="status">Загружаю…</p>
        <div class="jv-list" id="jvList"></div>
        <progress id="jvBar" max="100" value="0" hidden style="width:100%"></progress>
        <div class="upd-actions">
          <button type="button" class="btn primary" id="jvBtn" disabled>Обновить Java</button>
        </div>
        <details class="jv-more" id="jvMore">
          <summary>Скачать другие версии Java</summary>
          <p class="filter-note">Лаунчер сам докачивает нужную Java при запуске игры. Здесь можно заранее скачать любые версии, например Java 8 для старых сборок или Java 21 для новых.</p>
          <div class="jv-guide">
            <b>Какую Java выбрать</b>
            <ul>
              <li><b>Java 25</b>: Minecraft 26.1 и новее</li>
              <li><b>Java 21</b>: Minecraft 1.20.5 – 1.21.x</li>
              <li><b>Java 17</b>: Minecraft 1.18 – 1.20.4</li>
              <li><b>Java 16</b>: Minecraft 1.17</li>
              <li><b>Java 8</b>: Minecraft 1.16.5 и старше, а также многие старые сборки</li>
            </ul>
            <p class="filter-note">Если не уверены, ничего не скачивайте: лаунчер сам возьмёт нужную Java при запуске игры.</p>
          </div>
          <div class="jv-pick" id="jvPick">Загружаю список…</div>
          <div class="upd-actions">
            <button type="button" class="btn" id="jvGet" disabled>Скачать выбранные</button>
          </div>
        </details>
      </div>` : ""}
      <div class="setting-card">
        <h3>Об источниках</h3>
        <p>MatrixL не ведёт свой каталог. Все данные приходят напрямую с площадок при каждом запросе.</p>
        <div class="about-links">
          <a href="https://modrinth.com" target="_blank" rel="noopener">Modrinth ↗</a>
          <a href="https://www.curseforge.com/minecraft" target="_blank" rel="noopener">CurseForge ↗</a>
          <a href="https://hangar.papermc.io" target="_blank" rel="noopener">Hangar ↗</a>
          <a href="https://www.spigotmc.org" target="_blank" rel="noopener">SpigotMC ↗</a>
        </div>
      </div>
      </div>
    </section>
  `;

  $("uiLangSeg").querySelectorAll("button").forEach(b=> b.addEventListener("click", ()=>{
    if(b.dataset.ui !== window.I18N.lang()) window.I18N.set(b.dataset.ui);
  }));

  const seg = $("themeSwatches");
  seg.querySelectorAll(".swatch").forEach(b=>{
    b.addEventListener("click", ()=>{
      setTheme(b.dataset.value);
      seg.querySelectorAll(".swatch").forEach(c=> c.setAttribute("aria-pressed", String(c===b)));
    });
  });

  $("langSel").addEventListener("change", e=> setLang(e.target.value));

  $("defSort").value = defSort;
  $("defSort").addEventListener("change", e=> setDefaultSort(e.target.value));

  $("stClearFavs").addEventListener("click", async ()=>{
    if(!await window.UI.confirm({title:"Очистить избранное?", text:"Все сохранённые карточки будут удалены.", ok:"Удалить всё", danger:true})) return;
    favorites.clear(); updateFavCount(); renderSettingsPage();
  });

  if(window.mm && $("stDiscord")){
    const btn = $("dcOn");
    const paint = st=>{
      const on = st.discordEnabled !== false;
      btn.setAttribute("aria-checked", String(on));
      $("dcStat").textContent = !on ? "Выключено, в профиле ничего не показывается."
        : st.discordConnected ? "Включено · подключено к Discord, статус виден в профиле."
        : "Включено · ждём Discord: откройте приложение Discord на этом компьютере, лаунчер подключится сам.";
    };
    const load = ()=> mm.invoke("settings:get").then(r=>{ if(r.ok) paint(r.data); });
    load();
    $("dcAdv").addEventListener("click", openDiscordOptions);
    // ID приложения встроен в лаунчер, пользователю остаётся только включить или выключить статус
    btn.addEventListener("click", async ()=>{
      const want = btn.getAttribute("aria-checked") !== "true";
      btn.disabled = true;
      const r = await mm.invoke("settings:set", { discordEnabled: want });
      btn.disabled = false;
      if(!r.ok){ toast(r.error); return; }
      paint(r.data); toast(want ? "Статус в Discord включён" : "Статус в Discord выключен");
      if(want) setTimeout(load, 2500);   // подключение к Discord занимает мгновение
    });
  }

  if(window.mm && window.AppBg) window.AppBg.bind();

  if(window.mm && $("stIntro")){
    const btn = $("introOn");
    const isOn = ()=>{ try{ return localStorage.getItem("modmatrix:intro") !== "off"; }catch(e){ return true; } };
    const paint = ()=>{
      const on = isOn();
      btn.setAttribute("aria-checked", String(on));
      $("introStat").textContent = on ? "Включено · заставка показывается при каждом запуске." : "Выключено · лаунчер открывается сразу.";
    };
    paint();
    btn.addEventListener("click", ()=>{
      const want = !isOn();
      try{ localStorage.setItem("modmatrix:intro", want ? "on" : "off"); }catch(e){}
      paint(); toast(want ? "Интро включено" : "Интро выключено");
    });
  }

  if(window.mm && $("stHide")){
    const btn = $("hideOn"), win = mm.platform === "win32";
    const paint = st=>{
      const on = win && !!st.hideOnLaunch;
      btn.setAttribute("aria-checked", String(on));
      $("hideStat").textContent = !win ? "Доступно только в Windows."
        : on ? "Включено · лаунчер спрячется после запуска игры." : "Выключено · лаунчер остаётся на экране.";
    };
    if(!win) btn.disabled = true;
    mm.invoke("settings:get").then(r=>{ if(r.ok) paint(r.data); });
    btn.addEventListener("click", async ()=>{
      const want = btn.getAttribute("aria-checked") !== "true";
      btn.disabled = true;
      const r = await mm.invoke("settings:set", { hideOnLaunch: want });
      btn.disabled = false;
      if(!r.ok){ toast(r.error); return; }
      paint(r.data); toast(want ? "Лаунчер будет сворачиваться при запуске игры" : "Сворачивание лаунчера выключено");
    });
  }

  if(window.mm && $("stJava")){
    if(window.__jvOff) window.__jvOff();
    const J = {busy:false};
    const esc = t=> String(t).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    const load = async ()=>{
      const r = await mm.invoke("java:status");
      if(!$("stJava")) return;
      if(!r.ok){ $("jvStat").textContent = r.error; $("jvBtn").disabled = false; return; }
      const {list, offline, running} = r.data;
      const old = list.filter(x=> x.latest && !x.upToDate).length;
      $("jvStat").textContent = !list.length ? "Java ещё не скачана: она установится при первом запуске игры."
        : offline ? "Не удалось связаться с серверами Mojang, показаны установленные версии."
        : old ? `Доступны обновления: ${old}.` : "Установлены последние версии Java.";
      $("jvList").innerHTML = list.map(x=>`<div class="jv-row"><b>Java ${esc(x.major || "?")}</b><span>${esc(x.installed || "версия неизвестна")}${x.latest && !x.upToDate ? ` → сборка ${esc(x.latest)}` : ""}</span><em class="${x.upToDate ? "ok" : x.latest ? "new" : ""}">${x.upToDate ? "актуальна" : x.latest ? "есть обновление" : ""}</em><button type="button" class="btn danger jv-del" data-comp="${esc(x.comp)}" data-major="${esc(x.major || "?")}"${J.busy || running ? " disabled" : ""}${running ? ' title="Закройте игру, чтобы удалить Java"' : ""}>Удалить</button></div>`).join("");
      $("jvBtn").disabled = J.busy || !list.length || running;
      $("jvBtn").title = running ? "Закройте игру, чтобы обновить Java" : "";
    };
    load();
    $("jvList").addEventListener("click", async e=>{
      const b = e.target.closest(".jv-del"); if(!b || b.disabled) return;
      const ok = await UI.confirm({title:`Удалить Java ${b.dataset.major}?`, text:`Папка ${b.dataset.comp} будет удалена с диска.\nЕсли эта версия понадобится для запуска игры, лаунчер скачает её заново.`, ok:"Удалить", cancel:"Отмена", danger:true});
      if(!ok || !$("stJava")) return;
      J.busy = true; $("jvBtn").disabled = true; $("jvList").querySelectorAll(".jv-del").forEach(x=> x.disabled = true);
      const r = await mm.invoke("java:remove", b.dataset.comp);
      J.busy = false; if(!$("stJava")) return;
      toast(r.ok ? `Java ${b.dataset.major} удалена` : r.error, r.ok ? 3000 : 5000);
      load(); if(J.cat) loadCat();
    });
    window.__jvOff = mm.on("progress", p=>{
      if(!$("stJava")){ window.__jvOff(); return; }
      if(p.key !== "java") return;
      $("jvBar").hidden = false; if(p.pct != null) $("jvBar").value = Math.round(p.pct*100);
      if(p.text) $("jvStat").textContent = p.text;
    });
    $("jvBtn").addEventListener("click", async ()=>{
      J.busy = true; $("jvBtn").disabled = true; $("jvBtn").textContent = "Обновляю…"; $("jvBar").hidden = false; $("jvBar").value = 0;
      const r = await mm.invoke("java:update");
      J.busy = false; $("jvBtn").textContent = "Обновить Java"; $("jvBar").hidden = true;
      if(!$("stJava")) return;
      if(!r.ok){ toast(r.error, 5000); } else {
        const changed = r.data.reduce((n,x)=> n + x.changed, 0);
        toast(changed ? `Java обновлена (файлов заменено: ${changed})` : "Файлы Java проверены, все на месте и актуальны", 4000);
      }
      load(); loadCat();
    });

    /* выборочное скачивание: все рантаймы Mojang для этой системы */
    const loadCat = async ()=>{
      const box = $("jvPick"); if(!box) return;
      const r = await mm.invoke("java:catalog");
      if(!$("jvPick")) return;
      if(!r.ok){ box.textContent = "Не удалось получить список версий Java. Проверьте подключение к интернету."; return; }
      const {list, running} = r.data;
      J.cat = list; J.running = running;
      box.innerHTML = list.map(x=>`<label class="jv-opt${x.installed ? " is-on" : ""}"><input type="checkbox" value="${esc(x.comp)}"${x.installed ? " disabled" : ""}><b>Java ${esc(x.major || "?")}</b><span>${esc(x.comp)}${x.latest ? ` · ${esc(x.latest)}` : ""}</span><em class="${x.installed ? "ok" : ""}">${x.installed ? "установлена" : ""}</em></label>`).join("");
      box.querySelectorAll("input").forEach(i=> i.addEventListener("change", syncGet));
      syncGet();
    };
    const syncGet = ()=>{
      const b = $("jvGet"); if(!b) return;
      const n = $("jvPick").querySelectorAll("input:checked").length;
      b.disabled = J.busy || !n;
      b.textContent = n ? `Скачать выбранные (${n})` : "Скачать выбранные";
    };
    $("jvMore").addEventListener("toggle", ()=>{ if($("jvMore").open && !J.cat) loadCat(); });
    $("jvGet").addEventListener("click", async ()=>{
      const comps = [...$("jvPick").querySelectorAll("input:checked")].map(i=> i.value);
      if(!comps.length) return;
      J.busy = true; $("jvBtn").disabled = true; $("jvGet").disabled = true; $("jvBar").hidden = false; $("jvBar").value = 0;
      const r = await mm.invoke("java:install", comps);
      J.busy = false; if(!$("stJava")) return;
      $("jvBar").hidden = true;
      if(!r.ok){ toast(r.error, 5000); }
      else toast(r.data.length ? `Скачано версий Java: ${r.data.length}` : "Выбранные версии уже установлены", 4000);
      load(); loadCat();
    });
  }

  if(window.mm && $("stUpdate")){
    if(window.__updOff) window.__updOff();
    const U = {st:{}};
    const paint = st=>{
      if(!$("stUpdate")){ if(window.__updOff) window.__updOff(); return; }
      U.st = st;
      const btn = $("upBtn"), bar = $("upBar"), notes = $("upNotes"), link = $("upLink");
      const cur = st.current ? "v"+st.current : "";
      let text = "", label = "Проверить обновления", canClick = true, showBar = false;
      switch(st.phase){
        case "checking": text = "Проверяю наличие обновлений…"; canClick = false; label = "Проверяю…"; break;
        case "uptodate": text = `Установлена версия ${cur}. Это последняя версия.`; break;
        case "available":
          text = `Доступна новая версия v${st.latest} (у вас ${cur}).`;
          if(st.canInstall) label = "Обновить и перезапустить";
          else { text += " Эта версия обновляется вручную: скачайте новый файл на странице релиза."; label = "Проверить снова"; }
          break;
        case "downloading": text = `Скачиваю обновление… ${st.pct||0}%`; canClick = false; label = "Скачиваю…"; showBar = true; break;
        case "installing": text = "Устанавливаю обновление, лаунчер сейчас перезапустится…"; canClick = false; label = "Устанавливаю…"; showBar = true; break;
        case "error": text = st.error || "Не удалось проверить обновления"; label = "Повторить"; break;
        default: text = cur ? `Установлена версия ${cur}.` : "Проверьте, нет ли новой версии лаунчера.";
      }
      if(st.phase === "available" && st.error) text += " " + st.error;
      $("upStat").textContent = text;
      btn.textContent = label; btn.disabled = !canClick;
      const cn = $("upCancel"); if(cn){ cn.hidden = st.phase !== "downloading"; cn.disabled = false; }
      bar.hidden = !showBar; bar.value = st.pct || 0;
      const showNotes = st.phase === "available" && st.notes;
      notes.hidden = !showNotes; notes.textContent = showNotes ? st.notes : "";
      link.hidden = !(st.phase === "available" && st.url); if(st.url) link.href = st.url;
    };
    window.__updOff = mm.on("update-state", paint);
    mm.invoke("update:state").then(r=>{ if(r.ok) paint(r.data); });
    $("upCancel").addEventListener("click", async ()=>{
      if(!await window.UI.confirm({title:"Отменить обновление?", text:"Скачивание обновления будет остановлено, лаунчер останется на текущей версии.", ok:"Отменить обновление", cancel:"Продолжить", danger:true})) return;
      if(U.st.phase !== "downloading") return;
      $("upCancel").disabled = true;
      await mm.invoke("update:cancel");
    });
    $("upBtn").addEventListener("click", async ()=>{
      if(U.st.phase === "available" && U.st.canInstall){
        if(!await window.UI.confirm({title:"Обновить лаунчер?", text:`Лаунчер скачает версию v${U.st.latest}, закроется и сам запустится уже на новой версии. Ваши аккаунты и экземпляры останутся на месте.`, ok:"Обновить"})) return;
        const r = await mm.invoke("update:install");
        if(!r.ok) toast(r.error, 5000);
      } else {
        const r = await mm.invoke("update:check");
        if(!r.ok) toast(r.error, 5000);
      }
    });
  }

}

/* ---------- Discord: расширенные настройки статуса ---------- */
const DC_OPTS = [
  {g:"Местоположение в игре", items:[
    {k:"showPlace",  t:"Местоположение",       d:"Верхний мир, Нижний мир, Край, пещеры, глубины, горы"},
    {k:"showBiome",  t:"Биом",                 d:"В каком биоме находится игрок"},
    {k:"showWeather",t:"Погода и время суток", d:"День или ночь, дождь, гроза"},
    {k:"showCoords", t:"Координаты",           d:"Добавить X Y Z к статусу (по умолчанию выключено)"},
    {k:"showWorld",  t:"Название мира",        d:"Название одиночного мира"}
  ]},
  {g:"Многопользовательская игра", items:[
    {k:"showHost",    t:"Сервер",              d:"Адрес сервера. Если выключено, показывается только название сервера из списка игры"},
    {k:"showServerIcon", t:"Иконка сервера",    d:"Вместо логотипа лаунчера показывать иконку сервера, если она у него есть (логотип остаётся маленьким значком). Иконка берётся по адресу сервера через mcstatus.io, поэтому работает только при включённом пункте «Сервер»"},
    {k:"showPlayers", t:"Игроков онлайн",      d:"Сколько игроков сейчас на сервере: «(128 из 500)». Лаунчер запрашивает статус сервера так же, как список серверов игры"}
  ]},
  {g:"Состояние игрока", items:[
    {k:"showAfk",    t:"АФК",                  d:"«Отсутствует (АФК)», если 2 минуты нет нажатий клавиш и мыши"},
    {k:"showHealth", t:"Критическое состояние",d:"Метка, когда у персонажа осталось мало здоровья"},
    {k:"showEvents", t:"События",              d:"«Персонаж погиб» и «Достижение получено» на пару минут"}
  ]},
  {g:"Общее", items:[
    {k:"showTimer",    t:"Таймер",                 d:"Сколько времени вы играете"},
    {k:"showLauncher", t:"Действия в лаунчере",    d:"Что вы делаете вне игры: просмотр каталогов, настройки, установка"}
  ]}
];
async function openDiscordOptions(){
  let d = $("dcDlg");
  if(!d){
    d = document.createElement("dialog");
    d.id = "dcDlg"; d.className = "acc-dlg lc-dlg"; d.dataset.kind = "dcopts";
    document.body.appendChild(d);
    d.addEventListener("click", e=>{ if(e.target.closest("[data-close]")) d.close(); });
  }
  const r = await mm.invoke("settings:get");
  const st = r.ok ? r.data : {};
  const saved = st.discordOpts || {};
  const val = k=> typeof saved[k] === "boolean" ? saved[k] : (k === "showHost" ? !st.discordHideServer : k !== "showCoords");
  const esc = t=> String(t).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
  d.innerHTML = `
    <div class="m-head"><div><h2>Статус в Discord</h2><div class="by">Расширенные настройки</div></div></div>
    <div class="m-body">
      <div class="dc-prev" id="dcPrev" aria-live="polite"></div>
      ${DC_OPTS.map(g=>`<div><h4 class="sk-h">${g.g}</h4><div class="dc-grid">${g.items.map(i=>`
        <label class="dc-row"><input type="checkbox" data-k="${i.k}" ${val(i.k) ? "checked" : ""}><span><b>${esc(i.t)}</b><small>${esc(i.d)}</small></span></label>`).join("")}</div></div>`).join("")}
      <p class="filter-note">Мир, биом и местоположение берутся из файлов сохранения одиночной игры, поэтому могут отставать на несколько минут (игра пишет их при автосохранении). На серверах игра не сообщает лаунчеру, где находится игрок, поэтому показываются название сервера, число игроков онлайн, АФК и события.</p>
    </div>
    <div class="m-foot"><button class="btn" data-close type="button">Закрыть</button></div>`;
  const prev = async ()=>{
    const p = await mm.invoke("discord:preview");
    if(!p.ok || !$("dcPrev")) return;
    const of = window.I18N && window.I18N.lang() === "en" ? "of" : "из";
    const card = (title, x)=>`<div class="dc-card"><small>${title}</small><b>${esc(x.details || "")}</b><span>${esc(x.state || "")}${x.party ? ` (${x.party[0]} ${of} ${x.party[1]})` : ""}</span></div>`;
    $("dcPrev").innerHTML = card("Одиночная игра", p.data.single) + card("Нижний мир", p.data.nether) + card("АФК", p.data.afk) + card("Событие", p.data.event) + card("Сервер", p.data.server);
  };
  d.querySelectorAll("input[data-k]").forEach(c=> c.addEventListener("change", async ()=>{
    const r2 = await mm.invoke("settings:set", { discordOpts: { [c.dataset.k]: c.checked } });
    if(!r2.ok){ toast(r2.error); c.checked = !c.checked; return; }
    prev();
  }));
  prev();
  if(!d.open) d.showModal();
}

/* ============================================================
   Серверы: список адресов с онлайном, числом игроков и задержкой.
   Список хранится на этом компьютере; запросы идут из приложения
   тем же способом, что и список серверов в самой игре.
   ============================================================ */
const SRV_KEY = "matrixl:servers", SRV_AUTO_KEY = "matrixl:servers:auto", SRV_MAX = 30, SRV_EVERY = 30000;
const srvEn = ()=> window.I18N && window.I18N.lang() === "en";
const srvState = { list: [], res: new Map(), busy: new Set(), timer: 0 };

function srvLoad(){
  try{
    const p = JSON.parse(localStorage.getItem(SRV_KEY) || "[]");
    srvState.list = Array.isArray(p) ? p.filter(x=> x && x.id && typeof x.addr === "string").slice(0, SRV_MAX) : [];
  }catch(e){ srvState.list = []; }
}
function srvAutoOn(){ try{ return localStorage.getItem(SRV_AUTO_KEY) !== "0"; }catch(e){ return true; } }
function srvAutoSet(on){ try{ localStorage.setItem(SRV_AUTO_KEY, on ? "1" : "0"); }catch(e){} }
function srvStopTimer(){ clearInterval(srvState.timer); srvState.timer = 0; }
function srvStartTimer(){
  srvStopTimer();
  if(!srvAutoOn()) return;
  srvState.timer = setInterval(()=>{
    if(state.page !== "servers"){ srvStopTimer(); return; }
    if(!document.hidden) srvCheckAll();
  }, SRV_EVERY);
}
function srvSave(){ try{ localStorage.setItem(SRV_KEY, JSON.stringify(srvState.list)); }catch(e){} }
function srvNorm(raw){
  const a = String(raw||"").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "");
  const m = /^([a-z0-9]([a-z0-9._-]{0,251}[a-z0-9])?)(?::(\d{1,5}))?$/.exec(a);
  if(!m) return "";
  const port = m[3] ? Number(m[3]) : 25565;
  if(port < 1 || port > 65535) return "";
  return port === 25565 ? m[1] : `${m[1]}:${port}`;
}
const SRV_REASON = {
  "not-found":"Адрес не найден", "refused":"Соединение отклонено", "timeout":"Сервер не отвечает",
  "no-answer":"Сервер не ответил на запрос", "bad-address":"Неверный адрес", "empty":"Введите адрес сервера"
};

function srvCardHtml(s){
  const r = srvState.res.get(s.id), busy = srvState.busy.has(s.id), safe = cmEsc;
  let cls = "srv-wait", badge = "Проверяю…", body = "";
  if(r && r.online){
    cls = "srv-on"; badge = "Онлайн";
    const ratio = r.max > 0 ? Math.min(100, Math.round(r.players / r.max * 100)) : 0;
    const names = (r.sample||[]).length ? ` title="${safe(r.sample.join(", "))}"` : "";
    body = `
      <div class="srv-stats">
        <div class="srv-stat"${names}><small>Игроки</small><b>${r.players} <i>${srvEn() ? "of" : "из"} ${r.max}</i></b></div>
        <div class="srv-stat"><small>Задержка</small><b>${r.latency} <i>мс</i></b></div>
        <div class="srv-stat srv-stat-ver" title="${safe(r.version || "")}"><small>Версия</small><b class="srv-ver">${safe(r.version || "-")}</b></div>
      </div>
      <div class="srv-bar" role="progressbar" aria-label="Заполненность сервера" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${ratio}"><span style="width:${ratio}%"></span></div>
      ${r.motd ? `<p class="srv-motd">${safe(r.motd)}</p>` : ""}
      ${(r.sample||[]).length ? `<p class="srv-who">${srvEn() ? "Playing now" : "Сейчас в игре"}: ${safe(r.sample.join(", "))}${r.players > r.sample.length ? (srvEn() ? " and others" : " и др.") : ""}</p>` : ""}`;
  }else if(r){
    cls = "srv-off"; badge = "Оффлайн";
    body = `<p class="srv-motd srv-err">${safe(SRV_REASON[r.reason] || "Сервер недоступен")}</p>`;
  }else{
    body = `<p class="srv-motd">Запрашиваю состояние сервера…</p>`;
  }
  const icon = r && r.favicon ? `<img src="${safe(r.favicon)}" alt="" width="56" height="56">` : `<span class="srv-ph" aria-hidden="true"></span>`;
  const at = r && r.at ? new Date(r.at).toLocaleTimeString(srvEn() ? "en-GB" : "ru-RU", {hour:"2-digit", minute:"2-digit", second:"2-digit"}) : "";
  return `
    <article class="srv-card ${cls}" data-id="${safe(s.id)}">
      <div class="srv-head">
        <div class="srv-icon">${icon}</div>
        <div class="srv-title">
          <h3>${safe(s.name || s.addr)}</h3>
          <code>${safe(s.addr)}</code>
        </div>
        <span class="srv-badge"><i></i>${badge}</span>
      </div>
      ${body}
      <div class="srv-foot">
        <span class="srv-at">${at ? (srvEn() ? "Checked at " : "Проверено в ") + at : ""}</span>
        <button type="button" class="btn" data-act="copy">Копировать адрес</button>
        <button type="button" class="btn" data-act="refresh" ${busy ? "disabled" : ""}>${busy ? "Проверяю…" : "Обновить"}</button>
        <button type="button" class="btn danger" data-act="del">Удалить</button>
      </div>
    </article>`;
}

async function srvCheck(id){
  const s = srvState.list.find(x=> x.id === id);
  if(!s || srvState.busy.has(id)) return;
  srvState.busy.add(id); srvPaint(id);
  let r;
  try{
    const resp = await mm.invoke("server:status", s.addr);
    r = resp && resp.ok ? resp.data : { online:false, reason:"no-answer", at:Date.now() };
  }catch(e){ r = { online:false, reason:"no-answer", at:Date.now() }; }
  srvState.busy.delete(id);
  srvState.res.set(id, r);
  srvPaint(id); srvSummary();
}
function srvCheckAll(){ srvState.list.forEach(s=> srvCheck(s.id)); }

function srvPaint(id){
  const el = document.querySelector(`.srv-card[data-id="${CSS.escape(id)}"]`);
  const s = srvState.list.find(x=> x.id === id);
  if(!el || !s) return;
  const tmp = document.createElement("div"); tmp.innerHTML = srvCardHtml(s).trim();
  const next = tmp.firstElementChild;
  el.replaceWith(next);
}
function srvSummary(){
  const el = $("srvCount"); if(!el) return;
  const on = srvState.list.filter(s=> (srvState.res.get(s.id)||{}).online).length;
  el.textContent = !srvState.list.length ? (srvEn() ? "No servers yet" : "Серверов пока нет")
    : srvEn() ? `Online: ${on} of ${srvState.list.length}` : `Онлайн: ${on} из ${srvState.list.length}`;
}

function renderServersPage(){
  clearInterval(srvState.timer); srvState.timer = 0;
  const content = $("content");
  if(!window.mm){
    content.innerHTML = `${sectionHead("servers", "Мониторинг")}<div class="state">Проверка серверов работает только в приложении MatrixL.</div>`;
    return;
  }
  srvLoad();
  content.innerHTML = `
    ${sectionHead("servers", "Мониторинг", "Добавьте адрес сервера Minecraft, и лаунчер покажет, включён ли он, сколько игроков сейчас играет и какая у него задержка. Данные обновляются сами каждые 30 секунд, автообновление можно отключить.")}
    <form class="srv-add" id="srvAdd" autocomplete="off">
      <label class="field"><span>Адрес сервера</span><input type="text" id="srvAddr" maxlength="280" placeholder="play.example.net или 123.45.67.89:25565" spellcheck="false" aria-label="Адрес сервера"></label>
      <label class="field"><span>Название (необязательно)</span><input type="text" id="srvName" maxlength="40" placeholder="Мой сервер" aria-label="Название сервера"></label>
      <button class="btn primary" type="submit">＋ Добавить сервер</button>
    </form>
    <div class="meta-row"><div class="count" id="srvCount"></div>
      <div class="meta-right"><button class="btn" type="button" id="srvAuto" aria-pressed="true"></button><button class="btn" type="button" id="srvRefresh">Обновить все</button></div>
    </div>
    <div class="srv-grid" id="srvGrid"></div>`;
  const grid = $("srvGrid");
  const draw = ()=>{
    grid.innerHTML = srvState.list.length
      ? srvState.list.map(srvCardHtml).join("")
      : `<div class="state">Здесь пока пусто. Введите адрес сервера выше, например <b>play.example.net</b> (порт указывать нужно только если он не 25565).</div>`;
    srvSummary();
  };
  draw();

  $("srvAdd").addEventListener("submit", e=>{
    e.preventDefault();
    const addr = srvNorm($("srvAddr").value);
    if(!addr){ toast($("srvAddr").value.trim() ? SRV_REASON["bad-address"] : SRV_REASON["empty"]); $("srvAddr").focus(); return; }
    if(srvState.list.some(s=> s.addr === addr)){ toast("Этот сервер уже в списке"); return; }
    if(srvState.list.length >= SRV_MAX){ toast(srvEn() ? `The list can hold up to ${SRV_MAX} servers` : `В списке может быть не больше ${SRV_MAX} серверов`); return; }
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    srvState.list.push({ id, addr, name: $("srvName").value.trim().slice(0, 40) });
    srvSave();
    $("srvAddr").value = ""; $("srvName").value = "";
    draw(); srvCheck(id);
  });
  $("srvRefresh").addEventListener("click", srvCheckAll);
  const autoBtn = $("srvAuto");
  const paintAuto = ()=>{ const on = srvAutoOn(); autoBtn.setAttribute("aria-pressed", on ? "true" : "false"); autoBtn.textContent = on ? "Автообновление: вкл" : "Автообновление: выкл"; };
  paintAuto();
  autoBtn.addEventListener("click", ()=>{ srvAutoSet(!srvAutoOn()); paintAuto(); srvStartTimer(); });
  grid.addEventListener("click", e=>{
    const b = e.target.closest("button[data-act]"); if(!b) return;
    const id = b.closest(".srv-card").dataset.id, s = srvState.list.find(x=> x.id === id); if(!s) return;
    if(b.dataset.act === "refresh") srvCheck(id);
    else if(b.dataset.act === "copy"){
      (navigator.clipboard ? navigator.clipboard.writeText(s.addr) : Promise.reject()).then(()=> toast("Адрес скопирован"), ()=> toast("Не удалось скопировать"));
    }else if(b.dataset.act === "del"){
      srvState.list = srvState.list.filter(x=> x.id !== id); srvState.res.delete(id);
      srvSave(); draw();
    }
  });

  srvCheckAll();
  srvStartTimer();
}

/* ============================================================
   Навигация и каркас
   ============================================================ */
const PAGE_TITLES = {home:"Главная", mods:"Моды", plugins:"Плагины", modpacks:"Сборки", resourcepacks:"Ресурспаки", shaders:"Шейдеры", datapacks:"Датапаки", favorites:"Избранное", settings:"Настройки", servers:"Мониторинг"};

function setPage(page, opts){
  if(CATALOG_PAGES.includes(state.page)) saveCatalogState();   // запоминаем фильтры и страницу каталога, с которого уходим
  state.page = page;
  window.LauncherUI?.presence?.(page);
  window.Mascot?.sync(page);
  document.body.classList.remove("lc-home");
  document.querySelectorAll(".nav-item").forEach(b=> b.classList.toggle("active", b.dataset.page===page));
  $("pageTitle").textContent = PAGE_TITLES[page] || "";

  if(page === "home"){
    // в приложении MatrixL.exe главная это лаунчер
    if(window.mm && window.mm.invoke){ if(window.LauncherUI) window.LauncherUI.render(); else $("content").innerHTML = ""; }
    else renderHome();
  }
  else if(page === "favorites") renderFavoritesPage();
  else if(page === "settings") renderSettingsPage();
  else if(page === "servers") renderServersPage();
  else renderCatalogPage(page, opts);
}

document.querySelectorAll(".nav-item").forEach(b=>{
  b.addEventListener("click", ()=> setPage(b.dataset.page));
});

document.addEventListener("keydown", e=>{
  if(e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
  if(/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.querySelector("dialog[open]")) return;
  const q = $("q") || $("homeSearch");
  if(q){ e.preventDefault(); q.focus(); }
});

/* ---------- тонкая шкала прокрутки на нижней кромке верхней панели ---------- */
(function(){
  const bar = $("scrollProgress"); if(!bar) return;
  const fill = bar.firstElementChild;
  let raf = 0;
  const paint = ()=>{
    raf = 0;
    const el = document.scrollingElement || document.documentElement;
    const max = el.scrollHeight - el.clientHeight;
    const p = max > 8 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0;
    fill.style.transform = `scaleX(${p})`;
    bar.classList.toggle("on", max > 8 && el.scrollTop > 2);
    bar.setAttribute("aria-valuenow", String(Math.round(p*100)));
  };
  const queue = ()=>{ if(!raf) raf = requestAnimationFrame(paint); };
  addEventListener("scroll", queue, {passive:true});
  addEventListener("resize", queue);
  // страница выросла или сменилась (подгрузились карточки, другая вкладка), пересчитать
  if("ResizeObserver" in window) new ResizeObserver(queue).observe($("content"));
  window.__scrollBarRefresh = queue;
})();

/* ---------- старт ---------- */
document.documentElement.dataset.theme = getTheme();

updateFavCount();
setPage("home");


/* ---------- собственная шапка окна (в приложении): только «развернуть» и «закрыть» ---------- */
if(window.mm){
  document.documentElement.classList.add("has-tb");
  const max = $("tbMax");
  const paintMax = m=>{ max.classList.toggle("is-max", !!m); max.title = m ? "Свернуть в окно" : "Развернуть"; max.setAttribute("aria-label", max.title); };
  max.addEventListener("click", ()=> mm.invoke("win:toggle").then(r=>{ if(r.ok) paintMax(r.data); }));
  $("tbMin")?.addEventListener("click", ()=> mm.invoke("win:minimize"));
  $("tbClose").addEventListener("click", ()=> mm.invoke("win:close"));
  mm.on("win-state", paintMax);
  mm.invoke("win:state").then(r=>{ if(r.ok) paintMax(r.data); });
}
