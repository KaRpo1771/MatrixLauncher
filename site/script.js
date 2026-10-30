/* ============================================================
   ModMatrix, источники данных
   Единый формат карточки:
   {id, slug, title, author, desc, icon, downloads, follows,
    categories[], loaders[], versions[], updated, url, source}
   ============================================================ */

const LOADER_IDS = ["fabric","forge","neoforge","quilt"];
const LOADER_LABEL = {fabric:"Fabric",forge:"Forge",neoforge:"NeoForge",quilt:"Quilt"};
/* значок загрузчика (файлы лежат в site/loaders/<id>.png); если файла нет, просто пропадает */
const ldIcon = l => LOADER_IDS.includes(l) ? `<img class="ld-ico" src="loaders/${l}.png" alt="" width="14" height="14" onerror="this.remove()">` : "";
const CAT_LABEL = {
  adventure:"Приключения", decoration:"Декор", economy:"Экономика", equipment:"Снаряжение",
  food:"Еда", "game-mechanics":"Механики", library:"Библиотеки", magic:"Магия",
  management:"Управление", minigame:"Мини-игры", mobs:"Мобы", optimization:"Оптимизация",
  social:"Социальное", storage:"Хранение", technology:"Техника",
  transportation:"Транспорт", utility:"Утилиты", worldgen:"Генерация мира"
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
const SOURCE_META = {
  modrinth: {label:"Modrinth"}, hangar: {label:"Hangar"},
  spiget: {label:"SpigotMC"}, curseforge: {label:"CurseForge"}, snapshot: {label:"Снимок"}
};

/* ---------- Modrinth: моды и сборки, открытый API без ключа ---------- */
const Modrinth = {
  name:"Modrinth",
  api:"https://api.modrinth.com/v2",

  async search({query, category, loader, gameVersion, sort, offset, limit, projectType, signal}){
    const facets = [[`project_type:${projectType || "mod"}`]];
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
        categories:(h.display_categories||h.categories||[]).filter(c=>!LOADER_IDS.includes(c)),
        loaders:(h.categories||[]).filter(c=>LOADER_IDS.includes(c)),
        versions:h.versions||[], updated:h.date_modified,
        url:`https://modrinth.com/${(projectType||"mod")==="modpack"?"modpack":"mod"}/${h.slug}`,
        source:"modrinth"
      }))
    };
  },

  async details(mod, signal){
    const [pr, vr] = await Promise.all([
      fetch(`${this.api}/project/${mod.slug}`, {signal}),
      fetch(`${this.api}/project/${mod.slug}/version`, {signal})
    ]);
    if(!pr.ok) throw new Error(`Modrinth ответил ${pr.status}`);
    const p = await pr.json();
    const versions = vr.ok ? await vr.json() : [];
    return {
      license:p.license && (p.license.name||p.license.id),
      gallery:(p.gallery||[]).slice()
        .sort((a,b)=> (b.featured?1:0)-(a.featured?1:0) || (a.ordering||0)-(b.ordering||0))
        .map(g=>({url:g.url, title:g.title||"", desc:g.description||""})),
      followers:p.followers, downloads:p.downloads,
      gameVersions:p.game_versions||[], loaders:p.loaders||[],
      links:{source:p.source_url, issues:p.issues_url, wiki:p.wiki_url},
      // показываем вообще все опубликованные версии, а не только первые несколько
      versions: versions.map(v=>({
        name:v.version_number, date:v.date_published,
        game:(v.game_versions||[]).join(", "),
        gameList:v.game_versions||[], loaderList:v.loaders||[],
        file:(v.files||[]).find(f=>f.primary)?.url || (v.files||[])[0]?.url
      }))
    };
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
      : sort === "newest" ? "-created"
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
  equipment:["armortoolsandweapons","equipment"], food:["food"], library:["libraryapi","library"],
  magic:["magic"], mobs:["mobs"], optimization:["performance","optimization"], storage:["storage"],
  technology:["technology"], transportation:["playertransport","transport"], utility:["utilityqol","utility"],
  worldgen:["worldgen","worldgeneration"], "game-mechanics":["gamemechanics"], social:["social"],
  economy:["economy"], management:["management"], minigame:["minigame","minigames"]
};
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
    const kind = projectType==="modpack" ? "modpack" : "mod";
    // из «Общего каталога» приходит слаг категории Modrinth; на странице CurseForge, уже числовой id
    if(category && !/^\d+$/.test(category)){
      category = await cfCategoryId(category, kind);
      if(!category) return {total:0, items:[]};
    }
    return mmCall("cf:search", {query, category, loader, gameVersion, sort, offset, limit, kind});
  },
  async details(mod){ return mmCall("cf:details", mod.cfId || String(mod.id).split(":")[1]); },
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
let toastTimer;
function toast(msg){
  const el = $("toast"); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(()=> el.hidden = true, 2400);
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
      if(raw.downloads > ex.downloads){
        const {sources, variants} = ex;
        Object.assign(ex, raw, {sources, variants});
      }
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
    relevance:(a,b)=>(b.downloads||0)-(a.downloads||0)
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
  const raw = results.filter(r=>r.status==="fulfilled").flatMap(r=>r.value.items);
  const exhausted = main.every(r=> r.value.items.length < (params.limit||24));
  // все ответившие источники сообщили общее число, тогда известно и число страниц (по самому большому из них)
  const tots = main.map(r=>r.value.total);
  const known = tots.length > 0 && tots.every(t=> typeof t === "number");
  const total = known ? tots.reduce((a,b)=>a+b, 0) : null;
  const pageBase = known ? Math.max(...tots) : null;
  const failed = keys.filter((k,i)=> results[i].status !== "fulfilled");
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

/* ---------- Singleton: переводчик с общим кэшем ---------- */
class Translator {
  static #instance = null;
  static getInstance(){
    return (Translator.#instance ??= new Translator());
  }

  #cache = new Map();

  constructor(){
    if(Translator.#instance) throw new Error("Translator, синглтон, используйте Translator.getInstance()");
  }

  async translate(text, lang){
    if(!text || !lang) return text;
    const key = lang + "::" + text;
    if(this.#cache.has(key)) return this.#cache.get(key);
    try{
      const p = new URLSearchParams({client:"gtx", sl:"auto", tl:lang, dt:"t", q:text});
      const r = await fetch(`https://translate.googleapis.com/translate_a/single?${p}`);
      if(!r.ok) throw new Error("translate failed");
      const data = await r.json();
      const translated = (data[0] || []).map(chunk => chunk[0]).join("");
      const result = translated || text;
      this.#cache.set(key, result);
      return result;
    }catch(e){
      this.#cache.set(key, text);
      return text;
    }
  }
}
const translateText = (text, lang)=> Translator.getInstance().translate(text, lang);
let translateQueueN = 0;
function maybeTranslate(node, text){
  const lang = getLang();
  if(!lang || !text) return;
  if(lang === "ru" && isMostlyCyrillic(text)) return;
  const delay = Math.min(translateQueueN++ * 70, 1400);
  setTimeout(()=>{
    translateText(text, lang).then(t=>{
      if(t && t !== text && node.isConnected){
        node.textContent = t;
        node.classList.add("translated");
      }
    });
  }, delay);
}

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
        <div class="by">${m.author || "-"}${m.categories[0] ? " · " + (CAT_LABEL[m.categories[0]] || m.categories[0]) : ""}</div>
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
  return el;
}

/* ---------- фильтры, выбранные в каталоге, применяются внутри карточек ---------- */
const CATALOG_PAGES = ["mods","modpacks","plugins"];
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

/* ---------- модалка мода (общая для всех страниц) ---------- */
const modal = $("modal");
let current = null;
let modalDetails = null, modalShowAll = false;

/* ---------- галерея изображений мода/плагина и просмотр во весь экран ---------- */
let lightbox = null, lbImages = [], lbIndex = 0;
function ensureLightbox(){
  if(lightbox) return lightbox;
  lightbox = document.createElement("dialog");
  lightbox.className = "lightbox";
  lightbox.setAttribute("aria-label", "Просмотр изображения");
  lightbox.innerHTML = `
    <button class="lb-btn lb-close" type="button" aria-label="Закрыть">✕</button>
    <button class="lb-btn lb-prev" type="button" aria-label="Предыдущее">‹</button>
    <figure class="lb-fig"><img class="lb-img" alt=""><figcaption class="lb-cap"></figcaption></figure>
    <button class="lb-btn lb-next" type="button" aria-label="Следующее">›</button>`;
  document.body.appendChild(lightbox);
  lightbox.querySelector(".lb-close").addEventListener("click", ()=> lightbox.close());
  lightbox.querySelector(".lb-prev").addEventListener("click", ()=> lbShow(lbIndex - 1));
  lightbox.querySelector(".lb-next").addEventListener("click", ()=> lbShow(lbIndex + 1));
  lightbox.addEventListener("click", e=>{ if(e.target === lightbox) lightbox.close(); });
  lightbox.addEventListener("keydown", e=>{
    if(e.key === "ArrowLeft") lbShow(lbIndex - 1);
    if(e.key === "ArrowRight") lbShow(lbIndex + 1);
  });
  return lightbox;
}
function lbShow(i){
  if(!lbImages.length) return;
  lbIndex = (i + lbImages.length) % lbImages.length;
  const g = lbImages[lbIndex];
  const img = lightbox.querySelector(".lb-img");
  img.referrerPolicy = "no-referrer";
  img.src = g.url;
  img.alt = g.title || "";
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
function renderModalGallery(images){
  const box = $("mGallery");
  if(!box || !images || !images.length) return;
  const wrap = document.createElement("div");
  wrap.className = "gallery";
  const h = document.createElement("h4");
  h.textContent = `Изображения (${images.length})`;
  const strip = document.createElement("div");
  strip.className = "gallery-strip";
  images.forEach((g, i)=>{
    const b = document.createElement("button");
    b.type = "button"; b.className = "gallery-thumb";
    b.setAttribute("aria-label", g.title || `Открыть изображение ${i+1}`);
    const img = document.createElement("img");
    img.loading = "lazy"; img.referrerPolicy = "no-referrer"; img.alt = g.title || ""; img.src = g.url;
    // если картинка недоступна (например, хост блокирует показ на чужих сайтах), убираем плашку
    img.addEventListener("error", ()=>{ b.remove(); if(!strip.children.length) wrap.remove(); });
    b.appendChild(img);
    b.addEventListener("click", ()=> openLightbox(images, i));
    strip.appendChild(b);
  });
  wrap.append(h, strip);
  box.appendChild(wrap);
}

function renderModalVersions(){
  const box = $("mVersions");
  if(!box || !modalDetails) return;
  const all = modalDetails.versions || [];
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
  const rows = list.length ? list.map((v,i)=>`
      <div class="vrow">
        <span class="vn">${v.name}</span>
        <span class="vm">${v.loaderList?.length ? v.loaderList.map(l=>LOADER_LABEL[l]||l).join(", ") + " · " : ""}${v.game} · ${dateRu(v.date)}</span>
        ${v.file ? (window.LauncherUI?.isDesktop ? `<button type="button" class="vdl" data-vi="${i}">Скачать</button>` : `<a href="${v.file}" target="_blank" rel="noopener">Скачать</a>`) : ""}
      </div>`).join("")
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
  if(m.desc) maybeTranslate($("mDesc"), m.desc);

  if(m.source === "snapshot"){
    $("mBody").innerHTML = `<p id="mDesc">${m.desc}</p><p style="color:var(--muted)">Подробности доступны только при живом подключении к источникам.</p>`;
    if(m.desc) maybeTranslate($("mDesc"), m.desc);
    return;
  }
  try{
    const d = await SOURCES[m.source].details(m);
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
        <div class="spec ${(d.loaders||[]).length>1 ? "wide" : ""}"><span>Загрузчики</span><b class="ld-list">${(d.loaders||[]).map(l=>`<span class="ld-chip">${ldIcon(l)}${LOADER_LABEL[l]||l}</span>`).join("") || "-"}</b></div>
      </div>
      ${(d.gameVersions||[]).length ? `<div><h4>Версии игры</h4><p style="color:var(--muted);font-size:14.5px">${(activeFilters().gv ? d.gameVersions.filter(v=>v===activeFilters().gv) : d.gameVersions.slice(0,16)).join(", ") || "-"}</p></div>` : ""}
      <div id="mVersions"></div>
      <div class="links">
        ${d.links.source ? `<a href="${d.links.source}" target="_blank" rel="noopener">Исходный код</a>` : ""}
        ${d.links.issues ? `<a href="${d.links.issues}" target="_blank" rel="noopener">Баг-трекер</a>` : ""}
        ${d.links.wiki ? `<a href="${d.links.wiki}" target="_blank" rel="noopener">Вики</a>` : ""}
        ${otherLinks}
      </div>
      ${noDirectDownload ? `<p class="filter-note">Этот источник не даёт прямую ссылку на файл. Скачайте мод через кнопку «Открыть страницу мода» выше.</p>` : ""}`;
    if(m.desc) maybeTranslate($("mDesc"), m.desc);
    modalDetails = d; renderModalVersions(); if(m.kind !== "plugin") renderModalGallery(d.gallery);
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

/* ---------- инструкция по установке ---------- */

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
  plugins:  {title:"Плагины", lede:"Плагины для серверов Paper и Spigot с Hangar и SpigotMC.", keys:(c)=> c.pluginSource==="both" ? ["hangar","spiget"] : [c.pluginSource], projectType:null, kind:"plugin",
    categories:PLUGIN_CAT_LABEL, showLoaders:false, showSource:true, versionServerSide:false}
};
const KIND_LABEL = {mod:"мода", modpack:"сборки", plugin:"плагина"};

let catalog = null;   // состояние текущей страницы каталога
let catController = null;

function renderCatalogPage(kind, opts){
  const def = CATALOG_DEF[kind];
  catalog = {
    kind, q:(opts&&opts.q)||"", cat:"", loader:"", gv:"", sort:getDefaultSort(),
    pluginSource:"both", allSource:"both", src:"modrinth", offset:0, page:1, items:[], rawAll:[], total:null, exhausted:false, offline:false
  };

  const content = $("content");
  content.innerHTML = `
    <h1>${def.title}</h1>
    <p class="page-lede">${def.lede}</p>
    ${kind==="modpacks" && window.mm ? `<p><button class="btn" id="openMrpack" type="button">Установить из файла (.mrpack или .zip)…</button></p>` : ""}
    <section class="panel">
      <div class="search-row">
        <label class="search">
          <span class="search-icon" aria-hidden="true"></span>
          <input id="q" type="search" placeholder="Поиск по названию" aria-label="Поиск" autocomplete="off">
          <button type="button" class="search-clear" id="qClear" aria-label="Очистить поиск" hidden>✕</button>
          <kbd class="search-kbd" aria-hidden="true">/</kbd>
        </label>
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

  const buildCats = async ()=>{
    const box = $("cats"); if(!box) return;
    box.innerHTML = `<span class="legend">Категория:</span>`;
    let list = Object.entries(def.categories).map(([v,label])=>({value:v,label}));
    if(catalog.src === "curseforge"){
      try{ list = (await mmCall("cf:categories", def.kind)).map(c=>({value:String(c.id), label:c.name})); }catch(e){ list = []; }
      if(!$("cats") || catalog.src !== "curseforge") return;
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
        $("allSrc").querySelectorAll(".chip").forEach(c=> c.setAttribute("aria-pressed", String(c===b)));
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
  });

  let debounce;
  const qi = $("q"), qClear = $("qClear");
  const syncClear = ()=>{ qClear.hidden = !qi.value; };
  const runSearch = ()=>{ clearTimeout(debounce); catalog.q = qi.value.trim(); loadCatalog(); };
  syncClear();
  qi.addEventListener("input", ()=>{ syncClear(); clearTimeout(debounce); debounce = setTimeout(runSearch, 300); });
  qi.addEventListener("keydown", e=>{
    if(e.key === "Enter"){ e.preventDefault(); runSearch(); }
    if(e.key === "Escape" && qi.value){ e.preventDefault(); qClear.click(); }
  });
  qClear.addEventListener("click", ()=>{ qi.value = ""; syncClear(); runSearch(); qi.focus(); });
  $("resetFilters").addEventListener("click", ()=> renderCatalogPage(catalog.kind));
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

  loadCatalog();
}

function buildChips(container, values, key, clientOnly){
  values.forEach(v=>{
    const b = document.createElement("button");
    b.className = "chip"; b.dataset.value = v.value;
    if(v.icon){ b.innerHTML = v.icon; b.appendChild(document.createTextNode(v.label)); } else b.textContent = v.label;
    b.setAttribute("aria-pressed", String(catalog[key] === v.value));
    b.addEventListener("click", ()=>{
      catalog[key] = v.value;
      container.querySelectorAll(".chip").forEach(c=> c.setAttribute("aria-pressed", String(c.dataset.value === v.value)));
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

  const keys = def.keys(catalog);
  const params = {
    query:catalog.q, category:catalog.cat, loader:catalog.loader, gameVersion:catalog.gv,
    sort:catalog.sort, projectType:def.projectType, offset:catalog.offset, limit:PAGE_SIZE, signal
  };
  try{
    const {raw, exhausted, total, pageBase, anyOk} = await fetchSources(keys, params);
    if(!anyOk) throw new Error("источники недоступны");
    raw.forEach(r=> r.kind = def.kind);
    catalog.rawAll = raw;
    catalog.exhausted = exhausted;
    catalog.total = total; catalog.pageBase = pageBase;
    catalog.offline = false;
    hideBanner();
    catalog.items = sortItems(mergeAll(raw).map(ensureShape), catalog.sort);
    renderCatalogGrid();
  }catch(err){
    if(err.name === "AbortError") return;
    catalog.offline = true;
    catalog.items = SNAPSHOT.map(m=>({...ensureShape(m), kind:def.kind}));
    catalog.exhausted = true;
    renderCatalogGrid();
    showBanner(`<b>Не получилось загрузить актуальные данные</b>Показан ограниченный офлайн-список без счётчиков. Попробуйте обновить страницу позже.
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
  translateQueueN = 0;
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
  mods:`<path d="M12 2.8 20.5 7.4v9.2L12 21.2 3.5 16.6V7.4z"/><path d="M3.5 7.4 12 12l8.5-4.6"/><path d="M12 12v9.2"/><path d="M7.7 5.1l8.5 4.6"/><path d="M6.6 11.4l2 1.1v2.2l-2-1.1z"/><path d="M15.4 13.6l2-1.1v2.2l-2 1.1z"/>`,
  plugins:`<path d="M10 3.5a2 2 0 0 1 4 0V6h3.5a1 1 0 0 1 1 1v3.5H21a2 2 0 0 1 0 4h-2.5V19a1 1 0 0 1-1 1H14v-2.5a2 2 0 0 0-4 0V20H6.5a1 1 0 0 1-1-1v-4.5H3a2 2 0 0 1 0-4h2.5V7a1 1 0 0 1 1-1H10z"/>`,
  modpacks:`<path d="M12 2.8 21 7.3 12 11.8 3 7.3z"/><path d="M3 11.6l9 4.5 9-4.5"/><path d="M3 15.9l9 4.5 9-4.5"/><path d="M8.2 7.3 12 9.2l3.8-1.9"/><path d="M12 11.8v4.3"/>`,
  favorites:`<path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1L3.2 9.6l6.1-.8z"/><path d="M12 7.5l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z"/><path d="M19 3v3M17.5 4.5h3"/>`
};
const FEATURES = [
  {ico:"⛏️", title:"Всегда актуально", text:"Карточки берутся прямо с площадок при каждом запросе, так что данные всегда свежие."},
  {ico:"🧭", title:"Четыре источника сразу", text:"Modrinth, CurseForge, Hangar и SpigotMC. Если проект есть на нескольких площадках, он показывается одной карточкой."},
  {ico:"🌐", title:"Автоперевод описаний", text:"Английские описания переводятся прямо на карточке. Язык можно выбрать в настройках."},
  {ico:"⭐", title:"Личное избранное", text:"Нажмите ★ на карточке, чтобы сохранить её и вернуться к ней позже."}
];

function renderHome(){
  translateQueueN = 0;
  const content = $("content");
  content.innerHTML = `
    <section class="hero-home">
      <div class="hero-flex">
        <div class="hero-content">
          <h1>MatrixL</h1>
          <div class="search-row home-search">
            <label class="search">
              <span class="search-icon" aria-hidden="true"></span>
              <input id="homeSearch" type="search" placeholder="Например: sodium, create, essentialsx">
            </label>
          </div>
        </div>
        <div class="hero-art-frame">
          <img class="hero-art" src="logo.png" alt="MatrixL">
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
  const items = list.map(i=>{
    const mods = (i.mods||[]);
    const chips = mods.slice(0,8).map(t=>`<span class="cm-chip">${cmEsc(t)}</span>`).join("") + (mods.length>8 ? `<span class="cm-chip">+${mods.length-8}</span>` : "");
    return `<li class="cm-i ${i.level}"><span class="cm-ico" aria-hidden="true">${ICON[i.level]||"i"}</span>
      <div><b>${cmEsc(i.title)}</b><p>${cmEsc(i.text)}</p>${chips ? `<div class="cm-mods">${chips}</div>` : ""}</div></li>`;
  }).join("");
  return `<section class="cm-box ${n.error ? "has-err" : n.warn ? "has-warn" : "is-ok"}" aria-label="Проверка совместимости">
    <div class="cm-head"><span class="cm-title">Проверка совместимости</span>${sum}</div>
    ${items ? `<ul class="cm-list">${items}</ul>` : ""}
    ${o.note===false ? "" : `<p class="cm-note">${cmEsc(o.note || "Проверка смотрит на загрузчики, версии игры, повторы и список известных конфликтов. Это подсказка, а не гарантия: точно проверить можно только запуском игры.")}</p>`}
  </section>`;
}

function renderFavoritesPage(){
  translateQueueN = 0;
  collections.prune();
  if(favView !== "all" && !collections.get(favView)) favView = "all";
  const content = $("content");
  const everything = [...favorites.values()];
  const builds = collections.all();
  const col = favView === "all" ? null : collections.get(favView);
  const list = col ? everything.filter(m=> col.ids.includes(m.id)) : everything;
  const installable = list.filter(m=> (m.source==="modrinth" || m.source==="curseforge") && m.kind==="mod").length;
  const safe = cmEsc;
  // плашки создания сборки видны всегда, даже когда в избранном ещё ничего нет
  content.innerHTML = `
    <h1>Избранное</h1>
    <p class="page-lede">Здесь лежат сохранённые вами карточки. Собирайте из них свои сборки и проверяйте, подходят ли моды друг к другу.</p>
    <div class="chips fav-tabs" id="favTabs" role="tablist">
      <button class="chip" role="tab" data-view="all" aria-pressed="${favView==="all"}">Все (${everything.length})</button>
      ${builds.map(c=>`<button class="chip" role="tab" data-view="${safe(c.id)}" aria-pressed="${favView===c.id}">${safe(c.name)} (${c.ids.length})</button>`).join("")}
      <form class="coll-new" id="collNew"><input type="text" maxlength="40" placeholder="Новая сборка" aria-label="Название новой сборки"><button class="btn" type="submit">＋ Создать сборку</button></form>
    </div>
    ${builds.length ? "" : `<p class="coll-hint">Сборка это ваш набор модов. Его можно проверить на совместимость и установить в Minecraft одной кнопкой. Введите название и нажмите «Создать сборку», моды можно добавить позже.</p>`}
    <div class="meta-row"><div class="count">${list.length} ${col ? "в сборке «"+safe(col.name)+"»" : "сохранено"}</div>
      <div class="meta-right">
        ${window.mm && installable ? `<button class="btn primary" id="favInstall" type="button">Установить всё в Minecraft (${installable})</button>` : ""}
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
    <h1>Настройки</h1>
    <p class="page-lede">Настройки хранятся на этом компьютере и на данные модов не влияют.</p>
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
      <div class="setting-card">
        <h3>Перевод описаний</h3>
        <p>Описания модов и плагинов из Modrinth/CurseForge/Hangar/SpigotMC чаще всего на английском, поэтому мы переводим их автоматически.</p>
        <select id="langSel">
          ${LANGS.map(l=>`<option value="${l.id}" ${l.id===lang?"selected":""}>${l.label}</option>`).join("")}
        </select>
      </div>
      <div class="setting-card">
        <h3>Сортировка по умолчанию</h3>
        <p>Применяется при открытии «Модов», «Плагинов» и «Сборок».</p>
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
      ${window.mm ? `<div class="setting-card" id="stDiscord">
        <h3>Статус в Discord</h3>
        <p>В вашем профиле Discord будет видно, что вы делаете в лаунчере: выбираете моды, устанавливаете сборку или играете.</p>
        <button type="button" class="dc-toggle" id="dcOn" role="switch" aria-checked="true" aria-describedby="dcStat">
          <span class="dc-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M19.3 5.4A17 17 0 0 0 15 4.1l-.2.4a15.6 15.6 0 0 1 3.9 1.9 14.7 14.7 0 0 0-13.4 0 15.6 15.6 0 0 1 3.9-1.9l-.2-.4a17 17 0 0 0-4.3 1.3C2.1 9.5 1.4 13.4 1.7 17.2a17.2 17.2 0 0 0 5.3 2.7l1.1-1.8a11 11 0 0 1-1.7-.8l.4-.3a12.3 12.3 0 0 0 10.4 0l.4.3c-.5.3-1.1.6-1.7.8l1.1 1.8a17.2 17.2 0 0 0 5.3-2.7c.4-4.4-.7-8.3-3-11.8zM8.7 14.9c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z"/></svg></span>
          <span class="dc-txt"><b>Показывать статус в Discord</b><small id="dcStat">Загружаю…</small></span>
          <span class="dc-track" aria-hidden="true"><i></i></span>
        </button>
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

}

/* ============================================================
   Навигация и каркас
   ============================================================ */
const PAGE_TITLES = {home:"Главная", mods:"Моды", plugins:"Плагины", modpacks:"Сборки", favorites:"Избранное", settings:"Настройки"};

function setPage(page, opts){
  state.page = page;
  window.LauncherUI?.presence?.(page);
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
