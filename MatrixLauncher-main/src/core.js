'use strict';
/* ============================================================
   ModMatrix, ядро лаунчера: загрузка версий Minecraft, загрузчиков
   (Fabric / Quilt / Forge / NeoForge), Java, ассетов, запуск игры
   и установка модов из Modrinth в выбранную установку.
   Без зависимостей от Electron, только Node (adm-zip подгружается лениво).
   ============================================================ */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const { AsyncLocalStorage } = require('async_hooks');

const UA = 'ModMatrix-Launcher/1.0 (+https://modmatrix.app)';
const OS = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const CP_SEP = OS === 'windows' ? ';' : ':';

const URLS = {
  manifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
  javaAll: 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json',
  assets: 'https://resources.download.minecraft.net/',
  libs: 'https://libraries.minecraft.net/',
  modrinth: 'https://api.modrinth.com/v2'
};

/* ---------- отмена долгих задач (скачивание версии, установка сборки) ----------
   Задача запускается через startJob(); всё, что она скачивает и запускает, помнит свою задачу
   (AsyncLocalStorage), поэтому отмена не трогает параллельную установку модов. */
const CANCELLED = 'Скачивание отменено';
const jobs = new AsyncLocalStorage();
const activeJobs = new Map();   // ключ задачи -> задача: сборка/создание ('create') и установка модов ('mod') отменяются независимо
function startJob(fn, key = 'create') {
  const job = { cancelled: false, ctrls: new Set(), procs: new Set() };
  activeJobs.set(key, job);
  return jobs.run(job, async () => { try { return await fn(); } finally { if (activeJobs.get(key) === job) activeJobs.delete(key); } });
}
function cancelJob(key = 'create') {
  const j = activeJobs.get(key);
  if (!j || j.cancelled) return false;
  j.cancelled = true;
  for (const c of j.ctrls) { try { c.abort(new Error(CANCELLED)); } catch { /* уже остановлено */ } }
  for (const p of j.procs) { try { p.kill(); } catch { /* уже завершён */ } }
  return true;
}
function checkCancel() { const j = jobs.getStore(); if (j && j.cancelled) throw new Error(CANCELLED); }

let ROOT = null;
const DIRS = {};
function init(root) {
  ROOT = root;
  for (const d of ['versions', 'libraries', 'assets', 'runtime', 'instances', 'installers']) {
    DIRS[d] = path.join(root, d);
    fs.mkdirSync(DIRS[d], { recursive: true });
  }
  DIRS.root = root;
}

/* ---------- вывод процессов: UTF-8, а если не получается, кодовая страница Windows ---------- */
const FALLBACK_ENC = OS === 'windows' ? 'windows-1251' : 'latin1';
function decodeBytes(buf, enc = FALLBACK_ENC) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { /* не UTF-8 */ }
  try { return new TextDecoder(enc).decode(buf); } catch { return Buffer.from(buf).toString('latin1'); }
}
function lineFeeder(onLine, enc) {
  let pending = Buffer.alloc(0);
  const emit = b => { const t = decodeBytes(b, enc).replace(/\r$/, ''); if (t) onLine(t); };
  return {
    push(chunk) {
      pending = Buffer.concat([pending, chunk]);
      let i;
      while ((i = pending.indexOf(10)) >= 0) { emit(pending.subarray(0, i)); pending = pending.subarray(i + 1); }
    },
    flush() { if (pending.length) emit(pending); pending = Buffer.alloc(0); }
  };
}

/* ---------- сеть и файлы ---------- */
async function fetchJson(url, opts = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, ...opts });
  if (!r.ok) throw new Error(`${r.status} при запросе ${url}`);
  return r.json();
}

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} при запросе ${url}`);
  return r.text();
}

function sha1File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/* файл уже лежит на месте и подходит (по контрольной сумме или, если её нет, по размеру) */
async function isCached(dest, { sha1, size } = {}) {
  let st; try { st = await fsp.stat(dest); } catch { return false; }
  if (sha1) return (await sha1File(dest)) === sha1;
  return !!size && st.size === size;
}

/* Скачивание с докачкой (Range) и сторожем: если 30 секунд нет данных, обрыв и повтор с того же места.
   Возвращает 'cached', если файл уже был, иначе 'downloaded'. */
async function download(url, dest, o = {}) {
  checkCancel();
  if (!url) return 'skipped';
  if (fs.existsSync(dest)) {
    if (o.skipIfExists) return 'cached';
    if (await isCached(dest, o)) return 'cached';
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const tmp = dest + '.part';
  const job = jobs.getStore();
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    let timer, ctrl;
    try {
      let start = 0;
      try { start = (await fsp.stat(tmp)).size; } catch { /* начинаем с нуля */ }
      ctrl = new AbortController();
      if (job) job.ctrls.add(ctrl);
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(new Error('Загрузка зависла: 30 секунд нет данных')), 30000); };
      arm();
      const headers = { 'User-Agent': UA };
      if (start > 0) headers.Range = `bytes=${start}-`;
      const r = await fetch(url, { headers, signal: ctrl.signal });
      if (r.status === 416) { await fsp.rm(tmp, { force: true }); throw new Error('Докачка не удалась, начинаю заново'); }
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      const append = start > 0 && r.status === 206;     // сервер не поддержал докачку, пишем заново
      const len = parseInt(r.headers.get('content-length'), 10) || 0;
      const total = len ? (append ? start + len : len) : (o.size || 0);
      let got = append ? start : 0, last = 0;
      const src = Readable.fromWeb(r.body);
      src.on('data', ch => {
        got += ch.length; arm();
        const now = Date.now();
        if (o.onProgress && now - last > 120) { last = now; o.onProgress(got, total); }
      });
      await pipeline(src, fs.createWriteStream(tmp, { flags: append ? 'a' : 'w' }));
      clearTimeout(timer);
      if (o.onProgress) o.onProgress(got, total || got);
      if (o.onVerify) o.onVerify();
      if (o.sha1 && (await sha1File(tmp)) !== o.sha1) {
        await fsp.rm(tmp, { force: true });
        throw new Error(`Контрольная сумма не совпала: ${url}`);
      }
      await fsp.rename(tmp, dest);
      return 'downloaded';
    } catch (e) {
      clearTimeout(timer);
      if (job && job.cancelled) throw new Error(CANCELLED);
      lastErr = e;
      if (attempt < 5) await new Promise(res => setTimeout(res, 500 * attempt));
    } finally {
      if (job && ctrl) job.ctrls.delete(ctrl);
    }
  }
  throw lastErr;
}

/* скачать файл мода с событиями для панели загрузок: «уже есть», проверка, ошибка */
async function fetchModFile({ url, dest, sha1, size, file, isDep, report }) {
  const base = { file, dependency: !!isDep };
  if (await isCached(dest, { sha1, size })) {
    report(null, null, { ...base, received: 1, total: 1, done: true, cached: true });
    return 'cached';
  }
  report(`Скачиваю ${file}`, null, { ...base, received: 0, total: size || 0 });
  try {
    await download(url, dest, {
      sha1, size,
      onProgress: (got, total) => report(null, null, { ...base, received: got, total: total || size || 0 }),
      onVerify: () => report(null, null, { ...base, received: 1, total: 1, verifying: true })
    });
  } catch (e) {
    report(null, null, { ...base, received: 0, total: 0, error: true });
    throw e;
  }
  report(null, null, { ...base, received: 1, total: 1, done: true });
  return 'downloaded';
}

async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      checkCancel();
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

/* возвращает reporter, отображающий долю [from..to] общего прогресса */
function stage(report, from, to) {
  return (frac, text) => report(text, Math.round((from + (to - from) * Math.max(0, Math.min(1, frac))) * 100) / 100);
}

/* ---------- правила и библиотеки ---------- */
function ruleOk(rules, features = {}) {
  if (!rules || !rules.length) return true;
  let ok = false;
  for (const r of rules) {
    let m = true;
    if (r.os) {
      if (r.os.name && r.os.name !== OS) m = false;
      if (r.os.arch === 'x86') m = false;
      if (r.os.arch === 'arm64' && ARCH !== 'arm64') m = false;
    }
    if (r.features) for (const k in r.features) if (!!features[k] !== r.features[k]) m = false;
    if (m) ok = r.action === 'allow';
  }
  return ok;
}

function mavenPath(name) {
  const [coords, ext = 'jar'] = String(name).split('@');
  const [g, a, v, c] = coords.split(':');
  return `${g.replace(/\./g, '/')}/${a}/${v}/${a}-${v}${c ? '-' + c : ''}.${ext}`;
}

/* Список файлов-библиотек версии: classpath + нативные архивы для распаковки */
function resolveLibs(v) {
  const out = [];
  const seen = new Set();
  for (const lib of v.libraries || []) {
    if (!ruleOk(lib.rules)) continue;
    const name = lib.name || '';
    const parts = name.split('@')[0].split(':');
    const key = parts.slice(0, 2).join(':') + (parts[3] ? ':' + parts[3] : '');

    let art = lib.downloads && lib.downloads.artifact;
    if (!art && !lib.downloads && name) {
      const rel = mavenPath(name);
      art = { path: rel, url: (lib.url || URLS.libs) + rel, sha1: undefined };
    }
    if (art && !seen.has(key)) {
      seen.add(key);
      out.push({ key, file: path.join(DIRS.libraries, art.path || mavenPath(name)), url: art.url, sha1: art.sha1, cp: true });
    }
    if (lib.natives && lib.natives[OS]) {
      const cls = lib.natives[OS].replace('${arch}', ARCH === 'x64' ? '64' : '32');
      const nat = lib.downloads && lib.downloads.classifiers && lib.downloads.classifiers[cls];
      if (nat) out.push({ key: key + ':native', file: path.join(DIRS.libraries, nat.path), url: nat.url, sha1: nat.sha1, native: true, exclude: (lib.extract && lib.extract.exclude) || [] });
    }
  }
  return out;
}

async function extractNatives(libs, nativesDir) {
  const AdmZip = require('adm-zip');
  await fsp.mkdir(nativesDir, { recursive: true });
  for (const l of libs.filter(x => x.native)) {
    const zip = new AdmZip(l.file);
    for (const e of zip.getEntries()) {
      if (e.isDirectory) continue;
      if (e.entryName.startsWith('META-INF')) continue;
      if (l.exclude.some(x => e.entryName.startsWith(x))) continue;
      const dest = path.join(nativesDir, e.entryName);
      if (!dest.startsWith(nativesDir)) continue; // защита от zip-slip
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      try {
        const st = await fsp.stat(dest).catch(() => null);
        if (st && st.size === e.header.size) continue;   // такой файл уже на месте
        await fsp.writeFile(dest, e.getData());
      } catch (err) {
        if (!fs.existsSync(dest)) throw err;             // занятый, но существующий файл не считаем ошибкой
      }
    }
  }
}

/* ---------- версии Minecraft ---------- */
let manifestCache = null;
async function getManifest() {
  if (manifestCache && Date.now() - manifestCache.t < 10 * 60 * 1000) return manifestCache.data;
  const data = await fetchJson(URLS.manifest);
  manifestCache = { t: Date.now(), data };
  return data;
}

async function listVersions() {
  const m = await getManifest();
  return {
    latest: m.latest,
    releases: m.versions.filter(v => v.type === 'release').map(v => v.id),
    snapshots: m.versions.filter(v => v.type === 'snapshot').map(v => v.id)
  };
}

async function installVanillaJson(mc) {
  const file = path.join(DIRS.versions, mc, mc + '.json');
  const m = await getManifest();
  const entry = m.versions.find(v => v.id === mc);
  if (!entry) throw new Error(`Версия ${mc} не найдена в манифесте Mojang`);
  await download(entry.url, file, { sha1: entry.sha1 });
}

async function readVersion(id) {
  const p = path.join(DIRS.versions, id, id + '.json');
  const v = JSON.parse(await fsp.readFile(p, 'utf8'));
  if (!v.inheritsFrom) { v._jarId = id; return v; }
  const parent = await readVersion(v.inheritsFrom);
  const merged = { ...parent, ...v };
  merged.libraries = [...(v.libraries || []), ...(parent.libraries || [])];
  if (parent.arguments || v.arguments) {
    merged.arguments = {
      jvm: [...((parent.arguments && parent.arguments.jvm) || []), ...((v.arguments && v.arguments.jvm) || [])],
      game: [...((parent.arguments && parent.arguments.game) || []), ...((v.arguments && v.arguments.game) || [])]
    };
  }
  merged._jarId = parent._jarId;
  merged.id = v.id;
  return merged;
}

/* ---------- Java (официальный рантайм Mojang) ---------- */
function javaKey() {
  if (OS === 'windows') return ARCH === 'arm64' ? 'windows-arm64' : 'windows-x64';
  if (OS === 'osx') return ARCH === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return 'linux';
}
function javaExePath(comp) {
  return path.join(DIRS.runtime, comp, 'bin', OS === 'windows' ? 'java.exe' : 'java');
}
async function ensureJava(v, rep) {
  const comp = (v.javaVersion && v.javaVersion.component) || 'jre-legacy';
  const exe = javaExePath(comp);
  const ok = path.join(DIRS.runtime, comp, '.ok');
  if (fs.existsSync(exe) && fs.existsSync(ok)) return exe;
  rep(0, `Java: получаю список (${comp})`);
  const all = await fetchJson(URLS.javaAll);
  const arr = all[javaKey()] && all[javaKey()][comp];
  if (!arr || !arr.length) throw new Error(`Java (${comp}) недоступна для ${javaKey()}`);
  const manifest = await fetchJson(arr[0].manifest.url);
  const files = Object.entries(manifest.files).filter(([, f]) => f.type === 'file');
  let done = 0;
  await pool(files, 12, async ([name, f]) => {
    const dest = path.join(DIRS.runtime, comp, name);
    await download(f.downloads.raw.url, dest, { sha1: f.downloads.raw.sha1 });
    if (f.executable && OS !== 'windows') await fsp.chmod(dest, 0o755);
    done++;
    if (done % 20 === 0 || done === files.length) rep(done / files.length, `Java ${comp}: ${done}/${files.length}`);
  });
  await fsp.writeFile(ok, new Date().toISOString());
  return exe;
}

/* ---------- установка всех файлов игры ---------- */
async function ensureGame(versionId, report, { verify = true } = {}) {
  const v = await readVersion(versionId);
  const rJava = stage(report, 0, 0.25), rJar = stage(report, 0.25, 0.3), rLib = stage(report, 0.3, 0.45), rAss = stage(report, 0.45, 1);

  const javaExe = await ensureJava(v, rJava);

  // клиентский jar
  if (!v.downloads || !v.downloads.client) throw new Error('В описании версии нет клиентского jar');
  const jar = path.join(DIRS.versions, v._jarId, v._jarId + '.jar');
  rJar(0, 'Скачиваю клиент Minecraft');
  await download(v.downloads.client.url, jar, { sha1: v.downloads.client.sha1, skipIfExists: !verify });
  rJar(1, 'Клиент Minecraft готов');

  // библиотеки
  const libs = resolveLibs(v);
  let done = 0;
  await pool(libs, 10, async l => {
    if (l.url) await download(l.url, l.file, { sha1: l.sha1, skipIfExists: !verify });
    done++;
    if (done % 5 === 0 || done === libs.length) rLib(done / libs.length, `Библиотеки: ${done}/${libs.length}`);
  });

  // ассеты
  const ai = v.assetIndex;
  const idxFile = path.join(DIRS.assets, 'indexes', ai.id + '.json');
  await download(ai.url, idxFile, { sha1: ai.sha1 });
  const index = JSON.parse(await fsp.readFile(idxFile, 'utf8'));
  const objs = Object.entries(index.objects || {});
  done = 0;
  await pool(objs, 16, async ([, o]) => {
    const h = o.hash, sub = h.slice(0, 2);
    await download(URLS.assets + sub + '/' + h, path.join(DIRS.assets, 'objects', sub, h), { skipIfExists: true });
    done++;
    if (done % 100 === 0 || done === objs.length) rAss(done / objs.length, `Ресурсы: ${done}/${objs.length}`);
  });

  return { v, javaExe, libs, jar, index };
}

/* ---------- загрузчики модов: какие есть под версию игры и какие версии рекомендованы ---------- */
const FABRIC_META = { fabric: 'https://meta.fabricmc.net/v2/versions/loader/', quilt: 'https://meta.quiltmc.org/v3/versions/loader/' };
const LOADER_NAMES = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
const MIN_FORGE_MC = '1.7.10';       // установщики Forge с поддержкой --installClient
const MAX_LISTED = 60;

/* Сравнение версий вида 14.23.5.2860 / 21.1.172 / 1.7.10: по числам, остальное, по строке */
function compareVer(a, b) {
  const pa = String(a).split(/[.\-+_]/), pb = String(b).split(/[.\-+_]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    // у одной версии «кончились» части: продолжение числом (3.0.1), новее, тегом (3.0-beta), старее
    if (x === undefined) return /^\d+$/.test(y) ? -1 : 1;
    if (y === undefined) return /^\d+$/.test(x) ? 1 : -1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { if (+x !== +y) return +x - +y; }
    else if (x !== y) return nx ? 1 : ny ? -1 : (x < y ? -1 : 1);   // «3.0» новее «3.0-beta»
  }
  return 0;
}
const isRelease = v => /^\d+(\.\d+)*$/.test(v);
const isStableTag = v => !/(alpha|beta|rc|pre|snapshot|dev)/i.test(v);

const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v;
  const v = await fn();
  cache.set(key, { t: Date.now(), v });
  return v;
}

async function fabricLikeFor(mc, loader) {
  let list;
  try { list = await fetchJson(FABRIC_META[loader] + encodeURIComponent(mc)); } catch { return null; }
  if (!Array.isArray(list) || !list.length) return null;
  const versions = list.map(x => x.loader.version);
  const stable = list.find(x => x.loader.stable !== false && !/-/.test(x.loader.version));
  return { recommended: (stable || list[0]).loader.version, latest: versions[0], versions: versions.slice(0, MAX_LISTED) };
}

async function forgeMeta() {
  return cached('forge-meta', 10 * 60 * 1000, async () => {
    const [promos, xml] = await Promise.all([
      fetchJson('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json').then(j => j.promos || {}).catch(() => ({})),
      fetchText('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml').catch(() => '')
    ]);
    return { promos, all: [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(m => m[1]) };
  });
}
const forgeShort = v => v.replace(/-\d+(?:\.\d+)*$/, '');
/* полное имя артефакта в maven: может быть с суффиксом ветки */
async function forgeFullName(mc, v) {
  const { all } = await forgeMeta();
  if (all.includes(`${mc}-${v}`)) return `${mc}-${v}`;
  return all.find(x => x.startsWith(`${mc}-${v}-`) && forgeShort(x.slice(mc.length + 1)) === v) || `${mc}-${v}`;
}
async function forgeFor(mc) {
  if (!isRelease(mc) || compareVer(mc, MIN_FORGE_MC) < 0) return null;
  const { promos, all } = await forgeMeta();
  const rec = promos[`${mc}-recommended`] ? forgeShort(promos[`${mc}-recommended`]) : null, latest = promos[`${mc}-latest`] ? forgeShort(promos[`${mc}-latest`]) : null;
  // у старых версий (1.7.10, 1.8, 1.9, 1.10…) в maven к номеру добавлен суффикс ветки: 10.13.4.1614-1.7.10
  const versions = all.filter(v => v.startsWith(mc + '-')).map(v => forgeShort(v.slice(mc.length + 1)));
  for (const x of [rec, latest]) if (x && !versions.includes(x)) versions.push(x);
  if (!versions.length) return null;
  const sorted = [...new Set(versions)].sort(compareVer).reverse();
  return { recommended: rec || latest || sorted[0], latest: latest || sorted[0], versions: sorted.slice(0, MAX_LISTED) };
}

async function neoforgeFor(mc) {
  // Minecraft 1.A.B -> версии вида A.B.x; NeoForge существует с 1.20.2
  const m = /^1\.(\d+)(?:\.(\d+))?$/.exec(mc);
  if (!m || +m[1] < 20 || (+m[1] === 20 && +(m[2] || 0) < 2)) return null;
  const prefix = `${m[1]}.${m[2] || 0}.`;
  const data = await cached('neoforge-meta', 10 * 60 * 1000, () => fetchJson('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'));
  const cands = (data.versions || []).filter(x => x.startsWith(prefix));
  if (!cands.length) return null;
  const sorted = [...cands].sort(compareVer).reverse();
  const stable = sorted.filter(isStableTag);
  return { recommended: (stable[0] || sorted[0]), latest: sorted[0], versions: sorted.slice(0, MAX_LISTED) };
}

/* Что реально существует под эту версию Minecraft: {fabric:{recommended,latest,versions}, ...}. Недоступные загрузчики не попадают в ответ. */
async function loaderOptions(mc) {
  if (!mc) throw new Error('Не указана версия Minecraft');
  return cached('lo:' + mc, 10 * 60 * 1000, async () => {
    const [fabric, quilt, forge, neoforge] = await Promise.all([
      fabricLikeFor(mc, 'fabric'), fabricLikeFor(mc, 'quilt'),
      forgeFor(mc).catch(() => null), neoforgeFor(mc).catch(() => null)
    ]);
    const out = {};
    if (fabric) out.fabric = fabric;
    if (quilt) out.quilt = quilt;
    if (forge) out.forge = forge;
    if (neoforge) out.neoforge = neoforge;
    return out;
  });
}

async function installFabricLike(mc, loader, wanted) {
  const base = FABRIC_META[loader];
  let lv = wanted;
  if (!lv) {
    const o = await fabricLikeFor(mc, loader);
    if (!o) throw new Error(`${LOADER_NAMES[loader]} не поддерживает Minecraft ${mc}`);
    lv = o.recommended;
  }
  const prof = await fetchJson(`${base}${encodeURIComponent(mc)}/${encodeURIComponent(lv)}/profile/json`)
    .catch(() => { throw new Error(`${LOADER_NAMES[loader]} ${lv} недоступен для Minecraft ${mc}`); });
  const dest = path.join(DIRS.versions, prof.id, prof.id + '.json');
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.writeFile(dest, JSON.stringify(prof));
  return { versionId: prof.id, loaderVersion: lv };
}

async function resolveForgeLike(mc, loader, wanted, exact) {
  const o = loader === 'forge' ? await forgeFor(mc) : await neoforgeFor(mc);
  if (!o) throw new Error(`${LOADER_NAMES[loader]} не поддерживает Minecraft ${mc}`);
  const v = wanted || o.recommended;
  if (!exact && !o.versions.includes(v) && v !== o.recommended) throw new Error(`${LOADER_NAMES[loader]} ${v} недоступен для Minecraft ${mc}`);
  if (loader === 'forge') {
    const full = await forgeFullName(mc, v);
    return {
      loaderVersion: v, expectedId: `${mc}-forge-${v}`,
      installer: `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`
    };
  }
  return {
    loaderVersion: v, expectedId: `neoforge-${v}`,
    installer: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`
  };
}

function listVersionDirs() {
  try { return fs.readdirSync(DIRS.versions).filter(d => fs.existsSync(path.join(DIRS.versions, d, d + '.json'))); } catch { return []; }
}

async function installForgeLike(mc, loader, rep, onLog, wanted, exact) {
  const info = await resolveForgeLike(mc, loader, wanted, exact);
  if (fs.existsSync(path.join(DIRS.versions, info.expectedId, info.expectedId + '.json'))) {
    return { versionId: info.expectedId, loaderVersion: info.loaderVersion };
  }
  const vanilla = await readVersion(mc);
  const javaExe = await ensureJava(vanilla, stage(rep, 0, 0.5));
  const installer = path.join(DIRS.installers, path.basename(info.installer));
  rep('Скачиваю установщик загрузчика', 0.5);
  await download(info.installer, installer, {});
  const profiles = path.join(DIRS.root, 'launcher_profiles.json');
  if (!fs.existsSync(profiles)) await fsp.writeFile(profiles, JSON.stringify({ profiles: {}, version: 3 }));
  // установщику нужен клиентский jar ванильной версии
  await download(vanilla.downloads.client.url, path.join(DIRS.versions, mc, mc + '.jar'), { sha1: vanilla.downloads.client.sha1 });

  const before = new Set(listVersionDirs());
  rep('Запускаю установщик (это может занять несколько минут)…', 0.55);
  await new Promise((resolve, reject) => {
    const p = spawn(javaExe, ['-jar', installer, '--installClient', DIRS.root], { cwd: DIRS.root, windowsHide: true });
    const job = jobs.getStore();
    if (job) { job.procs.add(p); if (job.cancelled) p.kill(); }
    let tail = '';
    const f1 = lineFeeder(l => { tail = (tail + l + '\n').slice(-4000); if (onLog) onLog(l); });
    const f2 = lineFeeder(l => { tail = (tail + l + '\n').slice(-4000); if (onLog) onLog(l); });
    p.stdout.on('data', f1.push); p.stderr.on('data', f2.push);
    p.on('error', reject);
    p.on('close', code => { f1.flush(); f2.flush(); if (job) job.procs.delete(p); if (job && job.cancelled) return reject(new Error(CANCELLED)); code === 0 ? resolve() : reject(new Error(`Установщик завершился с кодом ${code}\n${tail.slice(-600)}`)); });
  });
  let id = info.expectedId;
  if (!fs.existsSync(path.join(DIRS.versions, id, id + '.json'))) {
    id = listVersionDirs().find(d => !before.has(d));
    if (!id) throw new Error('Установщик не создал профиль версии');
  }
  rep('Загрузчик установлен', 1);
  return { versionId: id, loaderVersion: info.loaderVersion };
}

/* ---------- установки (instances) ---------- */
function instFile() { return path.join(DIRS.root, 'instances.json'); }
function loadInstances() { try { return JSON.parse(fs.readFileSync(instFile(), 'utf8')); } catch { return []; } }
function saveInstances(list) {
  const tmp = instFile() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, instFile());
}
function instDir(id) { return path.join(DIRS.instances, id); }
function slugify(s) { return String(s || 'minecraft').toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'minecraft'; }

function listInstances() { return loadInstances(); }
function getInstance(id) {
  const i = loadInstances().find(x => x.id === id);
  if (!i) throw new Error('Установка не найдена');
  return i;
}

const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'];

async function installLoader(mc, loader, wanted, report, onLog, exact) {
  if (loader === 'fabric' || loader === 'quilt') {
    report('Устанавливаю загрузчик', 0.03);
    return installFabricLike(mc, loader, wanted);
  }
  if (loader === 'forge' || loader === 'neoforge') {
    return installForgeLike(mc, loader, (t, p) => report(t, 0.03 + 0.02 * p), onLog, wanted, exact);
  }
  return { versionId: mc, loaderVersion: null };
}

/* Папка экземпляра называется ровно так, как её назвали в лаунчере, без суффиксов.
   Убираем только то, что нельзя в именах файлов; если такая папка уже есть, добавляем « (2)». */
function uniqueInstanceId(title) {
  let base = String(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 40).trim();
  if (!base) base = 'minecraft';
  else if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base)) base += '_';
  const taken = new Set(loadInstances().map(i => String(i.id).toLowerCase()));
  let id = base, n = 2;
  while (taken.has(id.toLowerCase()) || fs.existsSync(instDir(id))) id = `${base} (${n++})`;
  return id;
}

async function createInstance({ name, mc, loader, loaderVersion: wantedLoaderVersion, ram, ramAuto, exactLoader }, report, onLog) {
  if (!LOADERS.includes(loader)) throw new Error('Неизвестный загрузчик');
  if (!mc) throw new Error('Выберите версию Minecraft');
  const title = String(name || '').trim() || `Minecraft ${mc}`;
  const id = uniqueInstanceId(title);

  try {
  report('Загружаю описание версии', 0.01);
  await installVanillaJson(mc);

  const { versionId, loaderVersion } = await installLoader(mc, loader, loader === 'vanilla' ? null : wantedLoaderVersion, report, onLog, !!exactLoader);

  await ensureGame(versionId, (t, p) => report(t, 0.05 + 0.95 * p));
  checkCancel();
  await fsp.mkdir(path.join(instDir(id), 'mods'), { recursive: true });

  const inst = {
    id, name: title, mc, loader, loaderVersion, versionId,
    ramAuto: !!ramAuto,
    ram: ramAuto ? recommendRam({ loader, modCount: 0 }) : clampRam(parseInt(ram, 10) || 2048),
    created: new Date().toISOString(), mods: []
  };
  const all = loadInstances(); all.push(inst); saveInstances(all);
  syncWatchers();
  report('Готово', 1);
  return inst;
  } catch (e) {
    // отмена или ошибка: недоделанную папку экземпляра не оставляем
    if (!loadInstances().some(i => i.id === id)) await fsp.rm(instDir(id), { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}

/* Смена загрузчика и его версии у готового экземпляра (версия Minecraft остаётся прежней) */
async function changeLoader(id, { loader, loaderVersion: wanted }, report, onLog) {
  if (!LOADERS.includes(loader)) throw new Error('Неизвестный загрузчик');
  const inst = getInstance(id);
  if (running.has(id)) throw new Error('Сначала закройте игру');
  report('Загружаю описание версии', 0.01);
  await installVanillaJson(inst.mc);
  const { versionId, loaderVersion } = await installLoader(inst.mc, loader, loader === 'vanilla' ? null : wanted, report, onLog);
  await ensureGame(versionId, (t, p) => report(t, 0.05 + 0.95 * p));
  const all = loadInstances();
  const rec = all.find(i => i.id === id);
  Object.assign(rec, { loader, loaderVersion, versionId });
  saveInstances(all);
  report('Готово', 1);
  return rec;
}

async function deleteInstance(id) {
  getInstance(id);
  saveInstances(loadInstances().filter(i => i.id !== id));
  syncWatchers();
  await fsp.rm(instDir(id), { recursive: true, force: true });
}

const running = new Map();

/* ---------- характеристики компьютера и память ---------- */
const MB = 1024 * 1024;
function totalMb() { return Math.floor(os.totalmem() / MB); }
function freeMb() { return Math.floor(os.freemem() / MB); }
/* Верхняя граница, которую разумно отдавать игре: не больше 75% всей памяти и минимум 2 ГБ остаётся системе */
function maxRam(total = totalMb()) {
  const cap = Math.min(Math.floor(total * 0.75), total - 2048);
  return Math.max(1024, Math.floor(cap / 512) * 512);
}
function clampRam(mb, total = totalMb()) { return Math.max(1024, Math.min(Math.max(maxRam(total), 1024), Math.floor(mb))); }
/* Рекомендация: зависит от загрузчика и числа модов, но не выше возможностей компьютера */
function recommendRam({ loader, modCount = 0 }, total = totalMb()) {
  let want = loader === 'vanilla' ? 2048 : 3072;
  if (modCount > 20) want = 4096;
  if (modCount > 60) want = 6144;
  if (modCount > 120) want = 8192;
  return Math.max(1024, Math.min(want, maxRam(total)));
}
function sysInfo() {
  const cpus = os.cpus() || [];
  return {
    totalMb: totalMb(), freeMb: freeMb(), maxRamMb: maxRam(), threads: cpus.length,
    cpu: cpus[0] ? cpus[0].model.replace(/\s+/g, ' ').trim() : 'неизвестно', arch: os.arch(), platform: process.platform,
    ramVanilla: recommendRam({ loader: 'vanilla' }), ramModded: recommendRam({ loader: 'fabric' })
  };
}
function countMods(id) {
  try { return fs.readdirSync(path.join(instDir(id), 'mods')).filter(f => /\.jar$/i.test(f)).length; } catch { return 0; }
}
/* Сколько памяти реально получит игра: авто-режим подбирает по ПК и модам, ручной, ограничивается возможностями ПК */
function effectiveRam(inst) {
  if (inst.ramAuto) return recommendRam({ loader: inst.loader, modCount: countMods(inst.id) });
  return Math.max(1024, Math.min(inst.ram || 2048, Math.floor(totalMb() * 0.9)));
}
/* Экземпляры с данными, которые всегда читаются с диска заново (число модов, рекомендация по памяти) */
function listInstancesLive() {
  return listInstances().map(i => {
    const modCount = countMods(i.id);
    const bgMode = i.bgMode || (i.showScreens === false ? 'none' : 'screens');
    let iconUrl = null;
    if (i.iconFile) {
      try { const f = path.join(instDir(i.id), i.iconFile); iconUrl = pathToFileURL(f).href + '?v=' + Math.floor(fs.statSync(f).mtimeMs); } catch { iconUrl = null; }
    }
    return { ...i, bgMode, iconUrl, modCount, ramRecommended: recommendRam({ loader: i.loader, modCount }), ramEffective: effectiveRam(i), running: running.has(i.id) };
  });
}

/* ---------- слежение за файлами экземпляров (моды, скриншоты) ---------- */
const watchers = new Map();
const watchTimers = new Map();
let watchCb = null;
function watchInstances(cb) { watchCb = cb; syncWatchers(); }
function syncWatchers() {
  if (!watchCb) return;
  const ids = new Set(loadInstances().map(i => i.id));
  for (const [id, w] of watchers) if (!ids.has(id)) { try { w.close(); } catch { /* уже закрыт */ } watchers.delete(id); }
  for (const id of ids) {
    if (watchers.has(id)) continue;
    try {
      fs.mkdirSync(instDir(id), { recursive: true });
      const w = fs.watch(instDir(id), { recursive: true, persistent: false }, (_ev, name) => {
        const n = String(name || '').replace(/\\/g, '/');
        const kinds = n.startsWith('mods') ? ['mods'] : n.startsWith('screenshots') ? ['screens'] : (!n ? ['mods', 'screens'] : []);
        for (const kind of kinds) {
          const key = id + ':' + kind;
          clearTimeout(watchTimers.get(key));
          watchTimers.set(key, setTimeout(() => { watchTimers.delete(key); if (watchCb) watchCb({ id, kind }); }, 250));
        }
      });
      w.on('error', () => { try { w.close(); } catch { /* уже закрыт */ } watchers.delete(id); });
      watchers.set(id, w);
    } catch { /* слежение недоступно, интерфейс обновится при следующем действии */ }
  }
}

/* ---------- скины Ely.by: authlib-injector ---------- */
async function ensureAuthlib() {
  const dir = path.join(DIRS.root, 'authlib-injector');
  await fsp.mkdir(dir, { recursive: true });
  const metaFile = path.join(dir, 'meta.json');
  let jar = null;
  try { const m = JSON.parse(await fsp.readFile(metaFile, 'utf8')); if (fs.existsSync(path.join(dir, m.file))) jar = path.join(dir, m.file); } catch { /* ещё не скачан */ }
  if (!jar) {
    let info;
    try { info = await fetchJson('https://authlib-injector.yushi.moe/artifact/latest.json'); }
    catch (e) { throw new Error('Не удалось получить authlib-injector (нужен для скинов Ely.by): ' + e.message); }
    const file = path.basename(new URL(info.download_url).pathname);
    const dest = path.join(dir, file);
    await download(info.download_url, dest, { skipIfExists: false });
    const want = info.checksums && info.checksums.sha256;
    if (want) {
      const got = await new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(dest).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
      if (got !== want) { await fsp.rm(dest, { force: true }); throw new Error('Контрольная сумма authlib-injector не совпала'); }
    }
    await fsp.writeFile(metaFile, JSON.stringify({ file }));
    jar = dest;
  }
  // Java на Windows надёжнее открывает агент по пути без кириллицы
  if (OS === 'windows' && /[^\x00-\x7F]/.test(jar)) {
    const safe = path.join(process.env.PUBLIC || 'C:\\Users\\Public', 'modmatrix-authlib-injector.jar');
    try { await fsp.copyFile(jar, safe); } catch { if (!fs.existsSync(safe)) return jar; }
    return safe;
  }
  return jar;
}

/* ---------- запуск ---------- */
function sub(s, vars) { return String(s).replace(/\$\{([^}]+)\}/g, (m, k) => (k in vars ? vars[k] : '')); }
function expandArgs(list, vars, features) {
  const out = [];
  for (const a of list || []) {
    if (typeof a === 'string') out.push(sub(a, vars));
    else if (ruleOk(a.rules, features)) (Array.isArray(a.value) ? a.value : [a.value]).forEach(x => out.push(sub(x, vars)));
  }
  return out;
}

function buildCommand({ v, libs, jar, javaExe, inst, account, gameDir, nativesDir, assetsRoot, agent, ramMb }) {
  const classpath = [...libs.filter(l => l.cp).map(l => l.file), jar].join(CP_SEP);
  const vars = {
    auth_player_name: account.name, version_name: v.id, game_directory: gameDir,
    assets_root: assetsRoot, assets_index_name: v.assetIndex.id, auth_uuid: account.uuid,
    auth_access_token: account.token || '0', clientid: '', auth_xuid: '',
    user_type: account.type === 'microsoft' ? 'msa' : account.type === 'ely' ? 'mojang' : 'legacy', version_type: v.type || 'release',
    user_properties: '{}', game_assets: path.join(assetsRoot, 'virtual', 'legacy'),
    natives_directory: nativesDir, launcher_name: 'MatrixL', launcher_version: '1.0',
    classpath, library_directory: DIRS.libraries, classpath_separator: CP_SEP,
    resolution_width: '854', resolution_height: '480'
  };
  let jvm, game;
  if (v.arguments) {
    jvm = expandArgs(v.arguments.jvm, vars, {});
    game = expandArgs(v.arguments.game, vars, {});
    if (!jvm.includes('-cp') && !jvm.includes('-classpath')) jvm.push('-cp', classpath);
    if (!jvm.some(a => a.startsWith('-Djava.library.path'))) jvm.push('-Djava.library.path=' + nativesDir);
  } else {
    jvm = [`-Djava.library.path=${nativesDir}`, '-cp', classpath];
    game = String(v.minecraftArguments || '').split(/\s+/).filter(Boolean).map(a => sub(a, vars));
  }
  // Кодировку JVM не трогаем: LWJGL 2 переводит пути к своим DLL через кодировку по умолчанию,
  // и принудительный UTF-8 ломает загрузку OpenAL при кириллице в пути (нет звука).
  const mem = [`-Xmx${ramMb || effectiveRam(inst)}M`, '-Xms256M'];
  game.push('--fullscreen');   // игра всегда запускается в полноэкранном режиме
  if (agent) mem.push(`-javaagent:${agent}=ely.by`);   // authlib-injector: скины и серверы Ely.by
  return { cmd: javaExe, args: [...mem, ...jvm, v.mainClass, ...game] };
}

async function launch(inst, account, report, onLog, onExit) {
  if (running.has(inst.id)) throw new Error('Эта установка уже запущена');
  const g = await ensureGame(inst.versionId, report, { verify: false });
  const gameDir = instDir(inst.id);
  await fsp.mkdir(path.join(gameDir, 'mods'), { recursive: true });
  const nativesDir = path.join(DIRS.versions, g.v._jarId, 'natives');
  await fsp.rm(nativesDir, { recursive: true, force: true }).catch(() => { /* файлы может держать ещё запущенная игра */ });
  await extractNatives(g.libs, nativesDir);

  // старые версии (до 1.7) читают ресурсы из папки, а не из хэшей
  if (g.index.map_to_resources || g.index.virtual) {
    const target = g.index.map_to_resources ? path.join(gameDir, 'resources') : path.join(DIRS.assets, 'virtual', 'legacy');
    for (const [name, o] of Object.entries(g.index.objects)) {
      const dest = path.join(target, name);
      if (fs.existsSync(dest)) continue;
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.copyFile(path.join(DIRS.assets, 'objects', o.hash.slice(0, 2), o.hash), dest);
    }
  }

  let agent = null;
  if (account.type === 'ely') { report('Подготовка скинов Ely.by', 0.99); agent = await ensureAuthlib(); }
  const ramMb = effectiveRam(inst);
  onLog(`Память для игры: ${ramMb} МБ (${inst.ramAuto ? 'подобрана автоматически' : 'задана вручную'}), всего в ПК: ${totalMb()} МБ`);
  const { cmd, args } = buildCommand({
    v: g.v, libs: g.libs, jar: g.jar, javaExe: g.javaExe, inst, account,
    gameDir, nativesDir, assetsRoot: DIRS.assets, agent, ramMb
  });
  // windowsHide здесь нельзя: Windows прячет и окно самой игры. javaw.exe не открывает консоль.
  let exe = cmd;
  if (OS === 'windows') {
    const w = cmd.replace(/java\.exe$/i, 'javaw.exe');
    if (w !== cmd && fs.existsSync(w)) exe = w;
  }
  const child = spawn(exe, args, { cwd: gameDir });
  running.set(inst.id, child);
  const out = lineFeeder(onLog), err = lineFeeder(onLog);
  child.stdout.on('data', out.push);
  child.stderr.on('data', err.push);
  child.on('error', e => { running.delete(inst.id); onLog('Ошибка запуска: ' + e.message); onExit(-1); });
  child.on('close', code => { out.flush(); err.flush(); running.delete(inst.id); onExit(code); });
  return { pid: child.pid };
}
function isRunning(id) { return running.has(id); }

/* ---------- моды из Modrinth в выбранную установку ---------- */
function loadersFor(loader) {
  if (loader === 'quilt') return ['quilt', 'fabric'];
  if (loader === 'vanilla') return [];
  return [loader];
}

async function pickModrinthVersion(projectRef, mc, loaders) {
  const q = new URLSearchParams({ game_versions: JSON.stringify([mc]), loaders: JSON.stringify(loaders) });
  const vs = await fetchJson(`${URLS.modrinth}/project/${encodeURIComponent(projectRef)}/version?${q}`);
  return vs.find(v => v.version_type === 'release') || vs[0] || null;
}

async function installMod({ instanceId, slug }, report) {
  const inst = getInstance(instanceId);
  const loaders = loadersFor(inst.loader);
  if (!loaders.length) throw new Error('В этой установке нет загрузчика модов. Создайте установку с Fabric, Quilt, Forge или NeoForge.');
  const modsDir = path.join(instDir(inst.id), 'mods');
  await fsp.mkdir(modsDir, { recursive: true });

  const installed = [];
  const visited = new Set();
  const known = (loadInstances().find(i => i.id === inst.id) || {}).mods || [];
  const onDisk = m => fs.existsSync(path.join(modsDir, m.file));

  async function one(ref, depth, isDep) {
    if (visited.has(ref) || depth > 4) return;
    visited.add(ref);
    // зависимость, которая уже стоит в этой установке, повторно не качаем и не обновляем
    if (isDep) { const k = known.find(m => (m.projectId === ref || m.slug === ref) && onDisk(m)); if (k) return; }
    const ver = await pickModrinthVersion(ref, inst.mc, loaders);
    if (!ver) {
      if (isDep) return;
      throw new Error(`Для Minecraft ${inst.mc} (${inst.loader}) у этого мода нет подходящей версии`);
    }
    visited.add(ver.project_id);
    const file = ver.files.find(f => f.primary) || ver.files[0];
    if (!file) throw new Error('У версии нет файлов');
    const how = await fetchModFile({ url: file.url, dest: path.join(modsDir, file.filename), sha1: file.hashes && file.hashes.sha1, size: file.size, file: file.filename, isDep, report });
    // обновили мод до другой версии, старый файл убираем, иначе в папке окажутся две копии
    const prev = known.find(m => m.projectId === ver.project_id && m.file !== file.filename);
    if (prev) await fsp.rm(path.join(modsDir, prev.file), { force: true }).catch(() => {});
    let title = ref;
    try { title = (await fetchJson(`${URLS.modrinth}/project/${ver.project_id}`)).title; } catch { /* название необязательно */ }
    installed.push({ projectId: ver.project_id, slug: isDep ? ver.project_id : ref, title, file: file.filename, version: ver.version_number, dependency: !!isDep, cached: how === 'cached' });
    for (const d of ver.dependencies || []) {
      if (d.dependency_type === 'required' && d.project_id && !visited.has(d.project_id)) await one(d.project_id, depth + 1, true);
    }
  }
  await one(slug, 0, false);

  const all = loadInstances();
  const rec = all.find(i => i.id === inst.id);
  rec.mods = (rec.mods || []).filter(m => !installed.some(n => n.projectId === m.projectId)).concat(installed.map(({ cached, ...r }) => r));
  saveInstances(all);
  return installed;
}

/* Установка конкретного файла (строка из списка версий) в mods выбранного экземпляра. Зависимости не подтягиваются. */
async function installModFile({ instanceId, url, filename, title, slug, version }, report) {
  const inst = getInstance(instanceId);
  if (!loadersFor(inst.loader).length) throw new Error('В этой установке нет загрузчика модов. Создайте установку с Fabric, Quilt, Forge или NeoForge.');
  if (!/^https:\/\//i.test(String(url || ''))) throw new Error('Для этой версии нет прямой ссылки на файл');
  let name = path.basename(String(filename || '').replace(/\\/g, '/')).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  if (!name) name = `${slug || 'mod'}-${version || 'file'}`.replace(/[^\w.\-+]/g, '_');
  if (!/\.jar$/i.test(name)) name += '.jar';
  const modsDir = path.join(instDir(inst.id), 'mods');
  await fsp.mkdir(modsDir, { recursive: true });
  const how = await fetchModFile({ url, dest: path.join(modsDir, name), file: name, isDep: false, report });
  const all = loadInstances();
  const rec = all.find(i => i.id === inst.id);
  const prev = (rec.mods || []).filter(m => m.slug === slug && m.file !== name);
  for (const m of prev) await fsp.rm(path.join(modsDir, m.file), { force: true }).catch(() => {});
  rec.mods = (rec.mods || []).filter(m => m.slug !== slug && m.file !== name)
    .concat([{ projectId: slug || name, slug: slug || name, title: title || name, file: name, version: version || '', dependency: false }]);
  saveInstances(all);
  return [{ projectId: slug || name, slug, title, file: name, version, dependency: false, cached: how === 'cached' }];
}

/* Пакетная установка (избранное): ошибка одного мода не останавливает остальные */
async function installMods({ instanceId, slugs }, report) {
  const seen = new Set();
  const list = (slugs || []).map(x => (typeof x === 'string' ? { source: 'modrinth', slug: x } : { source: x.source === 'curseforge' ? 'curseforge' : 'modrinth', slug: String(x.slug || '') }))
    .filter(x => x.slug && !seen.has(x.source + ':' + x.slug) && seen.add(x.source + ':' + x.slug));
  if (!list.length) throw new Error('Нечего устанавливать');
  getInstance(instanceId);
  const results = [];
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    report(`Мод ${i + 1} из ${list.length}: ${it.slug}`, i / list.length);
    try {
      const rp = (t, p, x) => report(null, null, x);
      const done = it.source === 'curseforge' ? await installCfMod({ instanceId, cfId: it.slug }, rp) : await installMod({ instanceId, slug: it.slug }, rp);
      results.push({ slug: it.slug, source: it.source, ok: true, titles: done.map(d => d.title) });
    } catch (e) {
      if (e && e.message === CANCELLED) throw e;   // отмена пользователем, останавливаем весь набор, а не идём к следующему моду
      checkCancel();
      results.push({ slug: it.slug, source: it.source, ok: false, error: e.message });
    }
  }
  report('Готово', 1);
  return results;
}

function listMods(instanceId) {
  const inst = getInstance(instanceId);
  const dir = path.join(instDir(inst.id), 'mods');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jar')); } catch { /* папки ещё нет */ }
  const known = new Map((inst.mods || []).map(m => [m.file, m]));
  return files.map(f => { const k = known.get(f) || {}; return { file: f, title: k.title || f, dependency: !!k.dependency, slug: k.slug || '', projectId: k.projectId || '', version: k.version || '' }; });
}

async function removeMod(instanceId, file) {
  const inst = getInstance(instanceId);
  if (path.basename(file) !== file) throw new Error('Некорректное имя файла');
  await fsp.rm(path.join(instDir(inst.id), 'mods', file), { force: true });
  const all = loadInstances();
  const rec = all.find(i => i.id === inst.id);
  rec.mods = (rec.mods || []).filter(m => m.file !== file);
  saveInstances(all);
}


/* ---------- OptiFine ----------
   Список версий берём из зеркала BMCLAPI (JSON), запасной путь, страница optifine.net/downloads.
   Файл качаем с официального optifine.net (через страницу adloadx с одноразовой ссылкой), запасной, зеркало.
   Кладём в папку mods: так OptiFine работает вместе с Forge. */
const OF = { mirror: 'https://bmclapi2.bangbang93.com/optifine', site: 'https://optifine.net' };
const OF_FILE = /^(preview_)?OptiFine_[0-9A-Za-z.\-]+?_(HD[A-Z_]*?)_([A-Z]\d+(?:_pre\d+)?)\.jar$/;
const ofRank = p => { const m = /^([A-Z])(\d+)/.exec(String(p || '').toUpperCase()); return m ? m[1].charCodeAt(0) * 1000 + parseInt(m[2], 10) : 0; };

function ofItem(mc, file) {
  const m = OF_FILE.exec(file);
  if (!m) return null;
  return { file, mc, type: m[2], patch: m[3], preview: !!m[1] || /_pre\d+$/.test(m[3]) };
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('сервер не отвечает')), ms))]);

async function optifineList(mc) {
  mc = String(mc || '').trim();
  if (!/^[0-9A-Za-z.\-_ ]{3,30}$/.test(mc)) throw new Error('Неверная версия Minecraft');
  const res = await cached('optifine:' + mc, 10 * 60 * 1000, async () => {
    let items = [];
    try {
      const j = await withTimeout(fetchJson(`${OF.mirror}/${encodeURIComponent(mc)}`), 12000);
      items = (Array.isArray(j) ? j : []).map(x => x && x.filename ? ofItem(mc, String(x.filename)) : null).filter(Boolean);
    } catch { /* зеркало недоступно, пробуем официальный сайт */ }
    if (!items.length) {
      try {
        const html = await withTimeout(fetchText(`${OF.site}/downloads`), 15000);
        const seen = new Set();
        for (const m of html.matchAll(/(?:preview_)?OptiFine_[0-9A-Za-z.\-]+?_HD[A-Z_]*?_[A-Z]\d+(?:_pre\d+)?\.jar/g)) {
          if (seen.has(m[0])) continue; seen.add(m[0]);
          const it = ofItem(mc, m[0]);
          if (it && m[0].replace(/^preview_/, '').startsWith(`OptiFine_${mc}_`)) items.push(it);
        }
      } catch { /* список останется пустым */ }
    }
    // сначала стабильные, новее, выше
    items = items.filter(it => it.type.startsWith('HD')).sort((a, b) => (a.preview - b.preview) || (ofRank(b.patch) - ofRank(a.patch)) || (b.type === 'HD_U') - (a.type === 'HD_U'));
    const rec = items.find(x => !x.preview && x.type === 'HD_U') || items.find(x => !x.preview) || null;
    return { mc, versions: items, recommended: rec ? rec.file : null };
  });
  if (!res.versions.length) cache.delete('optifine:' + mc);     // пустой ответ (нет сети) не запоминаем
  return res;
}

function findOptifineFiles(instanceId) {
  const dir = path.join(instDir(instanceId), 'mods');
  try { return fs.readdirSync(dir).filter(f => /optifine/i.test(f) && f.toLowerCase().endsWith('.jar')); } catch { return []; }
}

async function optifineInfo(instanceId) {
  const inst = getInstance(instanceId);
  const info = await optifineList(inst.mc);
  return { ...info, loader: inst.loader, installed: findOptifineFiles(instanceId)[0] || null };
}

async function isZipFile(file) {
  try {
    const h = await fsp.open(file, 'r');
    try { const b = Buffer.alloc(2); await h.read(b, 0, 2, 0); return b[0] === 0x50 && b[1] === 0x4b; } finally { await h.close(); }
  } catch { return false; }
}

async function installOptifine({ instanceId, file }, report) {
  const inst = getInstance(instanceId);
  if (inst.loader === 'vanilla') throw new Error('OptiFine из папки mods работает только вместе с Forge. Сначала выберите загрузчик Forge в настройках экземпляра.');
  const info = await optifineList(inst.mc);
  const item = info.versions.find(v => v.file === file);
  if (!item) throw new Error(`Такой версии OptiFine для Minecraft ${inst.mc} нет`);
  const modsDir = path.join(instDir(inst.id), 'mods');
  await fsp.mkdir(modsDir, { recursive: true });
  const dest = path.join(modsDir, item.file.replace(/^preview_/, ''));

  const sources = [
    async () => {
      const page = await withTimeout(fetchText(`${OF.site}/adloadx?f=${encodeURIComponent(item.file)}`), 15000);
      const m = /href=['"]?(downloadx\?f=[^'" >]+)/i.exec(page);
      if (!m) throw new Error('официальный сайт не отдал ссылку');
      return `${OF.site}/${m[1].replace(/&amp;/g, '&')}`;
    },
    async () => `${OF.mirror}/${encodeURIComponent(item.mc)}/${encodeURIComponent(item.type)}/${encodeURIComponent(item.patch)}`
  ];
  const base = { file: path.basename(dest), dependency: false };
  let lastErr = null, ok = false;
  for (const getUrl of sources) {
    try {
      const url = await getUrl();
      await fsp.rm(dest, { force: true });
      await fetchModFile({ url, dest, file: base.file, report });
      if (!(await isZipFile(dest))) { await fsp.rm(dest, { force: true }); throw new Error('сервер вернул не jar-файл'); }
      ok = true; break;
    } catch (e) {
      if (String(e.message).includes(CANCELLED)) throw e;
      lastErr = e;
    }
  }
  if (!ok) throw new Error(`Не удалось скачать OptiFine: ${lastErr ? lastErr.message : 'нет источника'}`);

  // прежние файлы OptiFine убираем, две копии в папке mods ломают запуск
  for (const f of findOptifineFiles(inst.id)) if (f !== base.file) await fsp.rm(path.join(modsDir, f), { force: true }).catch(() => {});
  const all = loadInstances();
  const rec = all.find(i => i.id === inst.id);
  rec.mods = (rec.mods || []).filter(m => m.projectId !== 'optifine').concat([{
    projectId: 'optifine', slug: 'optifine', title: `OptiFine ${item.mc} ${item.type} ${item.patch}`,
    file: base.file, version: `${item.type}_${item.patch}`, dependency: false
  }]);
  saveInstances(all);
  return { file: base.file, title: `OptiFine ${item.mc} ${item.type} ${item.patch}`, loader: inst.loader };
}

/* ---------- проверка совместимости файлов в папке mods ----------
   Читаем метаданные из самих .jar (fabric.mod.json, quilt.mod.json, mods.toml, mcmod.info),
   поэтому проверка видит и те моды, что положены в папку вручную. Результат по файлу кэшируется. */
const Compat = require('../site/compat.js');
const jarCache = new Map();   // путь|размер|время → разобранные метаданные
const SYSTEM_IDS = new Set(['minecraft', 'java', 'forge', 'neoforge', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt-loader', 'fabric-language-kotlin-placeholder']);

function parseToml(text) {
  const ids = [], deps = [];
  const blocks = text.split(/^\s*\[\[/m).slice(1);
  for (const b of blocks) {
    const head = b.slice(0, b.indexOf(']]')).trim();
    const get = k => { const m = b.match(new RegExp('^\\s*' + k + '\\s*=\\s*["\']([^"\']*)["\']', 'm')); return m ? m[1] : null; };
    if (head === 'mods') { const id = get('modId'); if (id) ids.push(id); }
    else if (head.startsWith('dependencies')) {
      const id = get('modId'); if (!id) continue;
      const mand = (b.match(/^\s*mandatory\s*=\s*(true|false)/m) || [])[1];
      const type = get('type');   // NeoForge: required | optional | incompatible | discouraged
      deps.push({ id, required: type ? type === 'required' : mand === 'true', incompatible: type === 'incompatible' });
    }
  }
  return { ids, deps };
}
const rangeAny = r => r == null || r === '*' || r === '' || (Array.isArray(r) && r.some(x => x === '*'));

function readJar(file, st) {
  const key = file + '|' + st.size + '|' + st.mtimeMs;
  if (jarCache.has(key)) return jarCache.get(key);
  const meta = { loaders: [], ids: [], title: '', version: '', depends: [], breaks: [], conflicts: [], nested: [] };
  try {
    const AdmZip = require('adm-zip');
    const zip = new AdmZip(file);
    const text = n => { const e = zip.getEntry(n); return e ? zip.readAsText(e).replace(/^\uFEFF/, '') : null; };
    const json = n => { const t = text(n); if (t == null) return null; try { return JSON.parse(t); } catch { return null; } };
    const fab = json('fabric.mod.json');
    if (fab && fab.id) {
      meta.loaders.push('fabric'); meta.ids.push(fab.id, ...(Array.isArray(fab.provides) ? fab.provides : []));
      meta.title = fab.name || fab.id; meta.version = fab.version || '';
      Object.keys(fab.depends || {}).forEach(d => meta.depends.push(d));
      Object.entries(fab.breaks || {}).forEach(([d, r]) => meta.breaks.push({ id: d, any: rangeAny(r) }));
      Object.entries(fab.conflicts || {}).forEach(([d, r]) => meta.conflicts.push({ id: d, any: rangeAny(r) }));
      (fab.jars || []).forEach(j => j && j.file && meta.nested.push(path.basename(j.file)));
    }
    const q = json('quilt.mod.json');
    if (q && q.quilt_loader && q.quilt_loader.id) {
      const ql = q.quilt_loader;
      meta.loaders.push('quilt'); meta.ids.push(ql.id, ...((ql.provides || []).map(p => (typeof p === 'string' ? p : p.id))));
      if (!meta.title) meta.title = (q.quilt_loader.metadata && q.quilt_loader.metadata.name) || ql.id;
      meta.version = meta.version || ql.version || '';
      (ql.depends || []).forEach(d => { const id = typeof d === 'string' ? d : d.id; if (id && !(d && d.optional)) meta.depends.push(id); });
      (ql.jars || []).forEach(j => meta.nested.push(path.basename(String(j))));
    }
    for (const [n, ld] of [['META-INF/neoforge.mods.toml', 'neoforge'], ['META-INF/mods.toml', 'forge']]) {
      const t = text(n); if (!t) continue;
      const tm = parseToml(t);
      if (!tm.ids.length) continue;
      meta.loaders.push(ld); meta.ids.push(...tm.ids);
      tm.deps.forEach(d => { if (d.incompatible) meta.breaks.push({ id: d.id, any: false }); else if (d.required && !SYSTEM_IDS.has(d.id)) meta.depends.push(d.id); });
      if (!meta.title) { const m = t.match(/^\s*displayName\s*=\s*["']([^"']+)["']/m); meta.title = m ? m[1] : tm.ids[0]; }
      if (!meta.version) { const m = t.match(/^\s*version\s*=\s*["']([^"'$][^"']*)["']/m); if (m) meta.version = m[1]; }
    }
    if (!meta.loaders.length) {   // старые Forge-моды
      const mc = json('mcmod.info');
      const arr = Array.isArray(mc) ? mc : mc && Array.isArray(mc.modList) ? mc.modList : [];
      if (arr.length && arr[0].modid) { meta.loaders.push('forge'); meta.ids.push(...arr.map(x => x.modid).filter(Boolean)); meta.title = arr[0].name || arr[0].modid; meta.version = arr[0].version || ''; }
    }
  } catch { meta.broken = true; }
  meta.ids = [...new Set(meta.ids)];
  if (jarCache.size > 3000) jarCache.clear();
  jarCache.set(key, meta);
  return meta;
}

async function checkMods(instanceId) {
  const inst = getInstance(instanceId);
  const dir = path.join(instDir(inst.id), 'mods');
  let names = [];
  try { names = fs.readdirSync(dir).filter(f => f.toLowerCase().endsWith('.jar')); } catch { /* папки ещё нет */ }
  const files = [];
  for (const f of names) {
    const full = path.join(dir, f);
    let st; try { st = fs.statSync(full); } catch { continue; }
    const meta = readJar(full, st);
    let sha1 = null; try { sha1 = await sha1File(full); } catch { /* файл мог исчезнуть */ }
    files.push({ file: f, sha1, ...meta });
  }
  const issues = [];
  const add = i => issues.push(i);
  const nm = f => files.find(x => x.file === f);
  const label = f => (f.title && f.title !== f.file ? `${f.title} (${f.file})` : f.file);

  // 1. побайтово одинаковые файлы под разными именами
  const bySha = new Map();
  files.forEach(f => { if (f.sha1) (bySha.get(f.sha1) || bySha.set(f.sha1, []).get(f.sha1)).push(f); });
  const identical = new Set();
  for (const g of bySha.values()) if (g.length > 1) {
    g.forEach(f => identical.add(f.file));
    add({ level: 'error', code: 'identical', title: 'Одинаковые файлы',
      text: `Это один и тот же файл под разными именами: ${g.map(f => f.file).join(', ')}. Игра увидит два одинаковых мода и не запустится, оставьте один.`, mods: g.map(f => f.file) });
  }

  // 2. один id мода в нескольких разных файлах (две версии одного мода)
  const byId = new Map();
  files.forEach(f => f.ids.forEach(id => (byId.get(id) || byId.set(id, []).get(id)).push(f)));
  const reported = new Set();
  for (const [id, g] of byId) {
    const uniq = g.filter(f => !identical.has(f.file));
    const key = uniq.map(f => f.file).sort().join('|');
    if (uniq.length < 2 || reported.has(key)) continue;
    // «provides» у разных модов может совпадать намеренно, считаем дублем, только если у обоих это основной id
    if (!uniq.every(f => f.ids[0] === id)) continue;
    reported.add(key);
    add({ level: 'error', code: 'dupid', title: 'Две копии одного мода',
      text: `В папке две версии мода «${id}»: ${uniq.map(f => f.file + (f.version ? ' (' + f.version + ')' : '')).join(' и ')}. Загрузчик остановит запуск, удалите лишнюю, обычно старую.`, mods: uniq.map(f => f.file) });
  }

  // 3. загрузчик установки и загрузчик мода
  if (inst.loader && inst.loader !== 'vanilla') {
    const bad = [], maybe = [];
    for (const f of files) {
      if (!f.loaders.length || f.broken) continue;
      if (f.loaders.includes(inst.loader) || (inst.loader === 'quilt' && f.loaders.includes('fabric'))) continue;
      if (inst.loader === 'neoforge' && f.loaders.includes('forge')) maybe.push(f); else bad.push(f);
    }
    if (bad.length) add({ level: 'error', code: 'loader', title: 'Мод для другого загрузчика',
      text: `Установка использует ${Compat.LD_NAME(inst.loader)}, а эти моды сделаны для другого загрузчика и не загрузятся: ${bad.map(f => `${f.file}, ${f.loaders.map(Compat.LD_NAME).join('/')}`).join('; ')}.`, mods: bad.map(f => f.file) });
    if (maybe.length) add({ level: 'warn', code: 'loader', title: 'Мод для Forge в NeoForge',
      text: `Новые версии NeoForge не читают моды старого Forge: ${maybe.map(f => f.file).join(', ')}. На Minecraft 1.20.1 такие моды ещё работают.`, mods: maybe.map(f => f.file) });
  }

  // 4. не хватает обязательных модов
  const provided = new Set(); files.forEach(f => f.ids.forEach(id => provided.add(id)));
  const nestedNorm = files.flatMap(f => f.nested.map(Compat.norm));
  const missing = new Map();
  for (const f of files) for (let d of f.depends) {
    if (d === 'fabric' || /^fabric-.*-v\d+$|^fabric-api-base$/.test(d)) d = 'fabric-api';   // модули Fabric API = сам Fabric API
    if (SYSTEM_IDS.has(d) || provided.has(d)) continue;
    if (/^quilted_fabric_api|^qsl|^quilt_/.test(d) && (provided.has('quilted_fabric_api') || provided.has('qsl'))) continue;
    if (nestedNorm.some(n => n.includes(Compat.norm(d)))) continue;                 // вложенный jar внутри самого мода
    (missing.get(d) || missing.set(d, []).get(d)).push(f.file);
  }
  for (const [d, who] of missing) {
    const name = d === 'fabric-api' ? 'Fabric API' : d;
    add({ level: 'warn', code: 'missing', title: `Не хватает «${name}»`,
      text: `Для работы ${who.length > 1 ? 'модов' : 'мода'} ${who.join(', ')} нужен «${name}», но его нет в папке. Установите его, иначе игра может не запуститься.`, mods: who });
  }

  // 5. моды, сами объявившие несовместимость
  for (const f of files) {
    for (const b of f.breaks) if (provided.has(b.id) && !f.ids.includes(b.id)) {
      const other = files.find(x => x !== f && x.ids.includes(b.id));
      add({ level: b.any ? 'error' : 'warn', code: 'breaks', title: 'Мод объявил несовместимость',
        text: `${f.file} заявляет, что не работает с «${b.id}»${other ? ' (' + other.file + ')' : ''}${b.any ? '' : ' определённых версий, проверьте версию'}.`, mods: [f.file, other && other.file].filter(Boolean) });
    }
    for (const c of f.conflicts) if (provided.has(c.id) && !f.ids.includes(c.id)) {
      const other = files.find(x => x !== f && x.ids.includes(c.id));
      add({ level: 'warn', code: 'conflict', title: 'Возможный конфликт',
        text: `${f.file} предупреждает о возможных проблемах вместе с «${c.id}»${other ? ' (' + other.file + ')' : ''}.`, mods: [f.file, other && other.file].filter(Boolean) });
    }
  }

  // 6. известные конфликты между разными модами
  const entries = files.map(f => ({ title: label(f), tokens: Compat.tokensOf({ ids: f.ids, title: f.title, slug: String(f.file).split(/[-_+0-9]/)[0] }) }));
  Compat.evaluateRules(entries).forEach(add);

  const broken = files.filter(f => f.broken);
  if (broken.length) add({ level: 'warn', code: 'broken', title: 'Файл не читается',
    text: `Не удалось прочитать как архив: ${broken.map(f => f.file).join(', ')}. Возможно, скачивание прервалось, удалите и скачайте заново.`, mods: broken.map(f => f.file) });
  const unknown = files.filter(f => !f.loaders.length && !f.broken);
  if (unknown.length) add({ level: 'info', code: 'unknown', title: 'Не удалось определить загрузчик',
    text: `В этих файлах нет описания мода, проверить их нельзя: ${unknown.map(f => f.file).join(', ')}.`, mods: unknown.map(f => f.file) });

  return { scanned: files.length, issues: Compat.sortIssues(issues), loader: inst.loader, mc: inst.mc };
}

/* ---------- настройки экземпляра и скриншоты ---------- */
const ICON_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
function clearIconFiles(id, rec) {
  try { for (const f of fs.readdirSync(instDir(id))) if (/^icon\.(png|jpe?g|webp|gif)$/i.test(f)) fs.rmSync(path.join(instDir(id), f), { force: true }); } catch { /* нет папки */ }
  if (rec) rec.iconFile = null;
}
/* аватарка из файла: копируется в папку экземпляра */
function setIconFile(id, src) {
  const ext = path.extname(String(src || '')).toLowerCase();
  if (!ICON_EXT.includes(ext)) throw new Error('Нужно изображение PNG, JPG, WEBP или GIF');
  const st = fs.statSync(src);
  if (!st.isFile() || st.size > 3 * MB) throw new Error('Картинка должна быть не больше 3 МБ');
  const all = loadInstances();
  const rec = all.find(i => i.id === id);
  if (!rec) throw new Error('Установка не найдена');
  fs.mkdirSync(instDir(id), { recursive: true });
  clearIconFiles(id, rec);
  const name = 'icon' + ext;
  fs.copyFileSync(src, path.join(instDir(id), name));
  rec.iconFile = name; rec.iconPreset = null;
  saveInstances(all);
  return rec;
}
function clearIcon(id) {
  const all = loadInstances();
  const rec = all.find(i => i.id === id);
  if (!rec) throw new Error('Установка не найдена');
  clearIconFiles(id, rec); rec.iconPreset = null;
  saveInstances(all);
  return rec;
}

const BG_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
function clearBgFiles(id, rec) {
  try { for (const f of fs.readdirSync(instDir(id))) if (/^background\.(png|jpe?g|webp|gif)$/i.test(f)) fs.rmSync(path.join(instDir(id), f), { force: true }); } catch { /* нет папки */ }
  if (rec) rec.bgFile = null;
}
/* свой фон вместо скриншотов: копия картинки в папке экземпляра */
function setBgFile(id, src) {
  const ext = path.extname(String(src || '')).toLowerCase();
  if (!BG_EXT.includes(ext)) throw new Error('Нужно изображение PNG, JPG, WEBP или GIF');
  const st = fs.statSync(src);
  if (!st.isFile() || st.size > 15 * MB) throw new Error('Картинка должна быть не больше 15 МБ');
  const all = loadInstances();
  const rec = all.find(i => i.id === id);
  if (!rec) throw new Error('Установка не найдена');
  fs.mkdirSync(instDir(id), { recursive: true });
  clearBgFiles(id, rec);
  const name = 'background' + ext;
  fs.copyFileSync(src, path.join(instDir(id), name));
  rec.bgFile = name; rec.bgMode = 'custom';
  saveInstances(all);
  return rec;
}
function clearBg(id) {
  const all = loadInstances();
  const rec = all.find(i => i.id === id);
  if (!rec) throw new Error('Установка не найдена');
  clearBgFiles(id, rec); rec.bgMode = 'screens';
  saveInstances(all);
  return rec;
}
/* что показывать на фоне главной: адреса картинок только этого экземпляра */
function backgroundFor(id) {
  const inst = getInstance(id);
  const mode = inst.bgMode || (inst.showScreens === false ? 'none' : 'screens');
  if (mode === 'none') return [];
  if (mode === 'custom' && inst.bgFile) {
    const f = path.join(instDir(id), inst.bgFile);
    try { return [pathToFileURL(f).href + '?v=' + Math.floor(fs.statSync(f).mtimeMs)]; } catch { return []; }
  }
  return listScreenshots(id).map(f => pathToFileURL(f).href);
}

function updateInstance(id, patch) {
  const all = loadInstances();
  const rec = all.find(i => i.id === id);
  if (!rec) throw new Error('Установка не найдена');
  if (patch && typeof patch.name === 'string') {
    const n = patch.name.trim().slice(0, 40);
    if (n) rec.name = n;
  }
  if (patch && patch.ramAuto != null) rec.ramAuto = !!patch.ramAuto;
  if (patch) {
    if (patch.bgMode != null) {
      if (!['screens', 'custom', 'none'].includes(patch.bgMode)) throw new Error('Неизвестный режим фона');
      if (patch.bgMode === 'custom' && !rec.bgFile) throw new Error('Сначала добавьте изображение для фона');
      rec.bgMode = patch.bgMode;
    }
    if (patch.slideSeconds != null) rec.slideSeconds = Math.max(3, Math.min(60, parseInt(patch.slideSeconds, 10) || 7));
    if (typeof patch.iconPreset === 'string') { rec.iconPreset = patch.iconPreset.slice(0, 24) || null; if (rec.iconPreset) clearIconFiles(id, rec); }
  }
  if (patch && patch.ram != null) {
    const r = parseInt(patch.ram, 10);
    if (!Number.isFinite(r)) throw new Error('Некорректный объём памяти');
    rec.ram = clampRam(r);
  }
  saveInstances(all);
  return rec;
}

/* Новейшие скриншоты игры: одного экземпляра (id) или всех экземпляров */
function listScreenshots(id, limit = 14) {
  const insts = id ? [getInstance(id)] : listInstances();
  const found = [];
  for (const inst of insts) {
    const dir = path.join(instDir(inst.id), 'screenshots');
    let names = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (!/\.(png|jpe?g)$/i.test(n)) continue;
      const file = path.join(dir, n);
      try { found.push({ file, t: fs.statSync(file).mtimeMs }); } catch { /* файл исчез */ }
    }
  }
  return found.sort((a, b) => b.t - a.t).slice(0, limit).map(x => x.file);
}

/* ---------- сборки Modrinth (.mrpack) ---------- */
const PACK_HOSTS = ['cdn.modrinth.com', 'github.com', 'raw.githubusercontent.com', 'gitlab.com'];
const PACK_LOADERS = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' };

function readMrpack(file) {
  const AdmZip = require('adm-zip');
  let zip;
  try { zip = new AdmZip(file); } catch { throw new Error('Не удаётся открыть файл: это не .mrpack'); }
  const entry = zip.getEntry('modrinth.index.json');
  if (!entry) throw new Error('В архиве нет modrinth.index.json, это не сборка Modrinth (.mrpack)');
  let index;
  try { index = JSON.parse(entry.getData().toString('utf8')); } catch { throw new Error('Повреждён modrinth.index.json'); }
  if (index.game !== 'minecraft') throw new Error('Сборка не для Minecraft');
  if (index.formatVersion !== 1) throw new Error(`Неподдерживаемая версия формата сборки: ${index.formatVersion}`);
  const deps = index.dependencies || {};
  if (!deps.minecraft) throw new Error('В сборке не указана версия Minecraft');
  const key = Object.keys(PACK_LOADERS).find(k => deps[k]);
  return {
    zip, index, mc: deps.minecraft,
    loader: key ? PACK_LOADERS[key] : 'vanilla', loaderVersion: key ? deps[key] : null,
    name: String(index.name || 'Сборка').slice(0, 40)
  };
}

/* путь внутри папки экземпляра; выход за её пределы запрещён */
function packDest(base, rel) {
  const r = String(rel || '').replace(/\\/g, '/');
  if (!r || r.startsWith('/') || /^[a-zA-Z]:/.test(r) || r.split('/').includes('..')) throw new Error(`Небезопасный путь в сборке: ${rel}`);
  const full = path.resolve(base, r);
  if (!full.startsWith(path.resolve(base) + path.sep)) throw new Error(`Небезопасный путь в сборке: ${rel}`);
  return full;
}

async function packVersions(slug) {
  const proj = await fetchJson(`${URLS.modrinth}/project/${encodeURIComponent(slug)}`);
  if (proj.project_type !== 'modpack') throw new Error('Это не сборка');
  const vs = await fetchJson(`${URLS.modrinth}/project/${encodeURIComponent(slug)}/version`);
  return vs.filter(v => (v.files || []).some(f => /\.mrpack$/i.test(f.filename)))
    .map(v => ({ id: v.id, name: v.name, number: v.version_number, type: v.version_type, mc: v.game_versions || [], loaders: v.loaders || [], date: v.date_published }));
}

async function fetchPackFile({ slug, versionId }, report) {
  const vs = await fetchJson(`${URLS.modrinth}/project/${encodeURIComponent(slug)}/version`);
  const ver = (versionId && vs.find(v => v.id === versionId)) || vs.find(v => v.version_type === 'release') || vs[0];
  if (!ver) throw new Error('У сборки нет версий');
  const f = (ver.files || []).find(x => /\.mrpack$/i.test(x.filename) && x.primary) || (ver.files || []).find(x => /\.mrpack$/i.test(x.filename));
  if (!f) throw new Error('У этой версии нет файла .mrpack');
  const dest = path.join(DIRS.root, 'packs', crypto.randomBytes(3).toString('hex') + '-' + path.basename(f.filename));
  report(`Скачиваю сборку ${f.filename}`, 0.01);
  await download(f.url, dest, { sha1: f.hashes && f.hashes.sha1 });
  return dest;
}

/* Установка сборки: новый экземпляр с нужной версией игры и загрузчиком, затем файлы сборки и overrides.
   opts: { file }, локальный .mrpack, или { slug, versionId }, сборка с Modrinth. */
async function installMrpack(opts, report, onLog, onFile) {
  let file = opts.file, temp = false;
  if (!file) {
    if (!opts.slug) throw new Error('Не указана сборка');
    file = await fetchPackFile(opts, report); temp = true;
  }
  const pack = readMrpack(file);
  const files = (pack.index.files || []).filter(f => !(f.env && f.env.client === 'unsupported'));
  for (const f of files) {
    packDest('/x', f.path);                                  // проверка пути до начала установки
    const urls = (f.downloads || []);
    if (!urls.length) throw new Error(`Нет адреса загрузки для ${f.path}`);
    if (!urls.some(u => { try { const h = new URL(u); return h.protocol === 'https:' && PACK_HOSTS.includes(h.hostname); } catch { return false; } })) {
      throw new Error(`Файл ${f.path} размещён на неразрешённом сервере`);
    }
  }
  report(`Сборка «${pack.name}»: Minecraft ${pack.mc}, ${LOADER_NAMES[pack.loader] || 'Vanilla'}`, 0.02);
  let inst = null;
  try {
    inst = await module.exports.createInstance({ name: pack.name, mc: pack.mc, loader: pack.loader, loaderVersion: pack.loaderVersion, exactLoader: true, ramAuto: true },
      (t, p) => report(t, 0.02 + 0.58 * p), onLog);
    const dir = instDir(inst.id);
    let done = 0;
    await pool(files, 4, async f => {
      const dest = packDest(dir, f.path);
      let lastErr;
      for (const url of f.downloads) {
        let h; try { h = new URL(url); } catch { continue; }
        if (h.protocol !== 'https:' || !PACK_HOSTS.includes(h.hostname)) continue;
        try {
          const name = path.basename(f.path);
          if (onFile) onFile({ file: name, received: 0, total: f.fileSize || 0 });
          await download(url, dest, {
            sha1: f.hashes && f.hashes.sha1,
            onProgress: (g, t) => onFile && onFile({ file: name, received: g, total: t || f.fileSize || 0 })
          });
          if (onFile) onFile({ file: name, received: 1, total: 1, done: true });
          lastErr = null; break;
        } catch (e) { lastErr = e; }
      }
      if (lastErr) throw new Error(`Не удалось скачать ${f.path}: ${lastErr.message}`);
      done++; report(`Скачано файлов: ${done} из ${files.length}`, 0.6 + 0.35 * done / files.length);
    });
    report('Копирую настройки и файлы сборки', 0.96);
    for (const prefix of ['overrides/', 'client-overrides/']) {
      for (const e of pack.zip.getEntries()) {
        if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
        const dest = packDest(dir, e.entryName.slice(prefix.length));
        await fsp.mkdir(path.dirname(dest), { recursive: true });
        await fsp.writeFile(dest, e.getData());
      }
    }
    const all = loadInstances(); const rec = all.find(i => i.id === inst.id);
    rec.pack = { name: pack.name, version: String(pack.index.versionId || ''), files: files.length };
    saveInstances(all);
    report('Сборка установлена', 1);
    return { ...rec, files: files.length };
  } catch (e) {
    if (inst) { try { await deleteInstance(inst.id); } catch { /* уже удалена */ } }
    throw e;
  } finally {
    if (temp) fsp.rm(file, { force: true }).catch(() => {});
  }
}

/* ---------- CurseForge (API-ключ встроен: src/curseforge-key.js) ---------- */
const CF = { base: 'https://api.curseforge.com/v1', game: 432, classMods: 6, classPacks: 4471 };
const CF_LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const CF_LOADER_NAME = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' };
const CF_SORT = { relevance: 2, downloads: 6, follows: 2, updated: 3, newest: 11 };
let cfKeyProvider = () => null;
function setCurseKeyProvider(fn) { cfKeyProvider = fn; }
function hasCurseKey() { return !!cfKeyProvider(); }

async function cfRequest(pathname, { params, body } = {}) {
  const key = cfKeyProvider();
  if (!key) throw new Error('CurseForge недоступен: в приложение не встроен API-ключ');
  const url = CF.base + pathname + (params ? '?' + new URLSearchParams(params) : '');
  const r = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-api-key': key, Accept: 'application/json', 'User-Agent': UA, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401 || r.status === 403) throw new Error('CurseForge отклонил встроенный API-ключ (src/curseforge-key.js)');
  if (r.status === 429) throw new Error('CurseForge: слишком много запросов, подождите минуту');
  if (!r.ok) throw new Error(`CurseForge ответил ${r.status}`);
  return (await r.json());
}

/* карточка в общем формате сайта */
function cfCard(m, kind) {
  const idx = m.latestFilesIndexes || [];
  const loaders = [...new Set(idx.map(x => CF_LOADER_NAME[x.modLoader]).filter(Boolean))];
  const versions = [...new Set(idx.map(x => x.gameVersion).filter(v => /^\d+\.\d+/.test(v)))];
  return {
    id: `curseforge:${m.id}`, slug: m.slug, cfId: m.id, title: m.name,
    author: (m.authors && m.authors[0] && m.authors[0].name) || 'CurseForge',
    desc: m.summary || '', icon: (m.logo && (m.logo.thumbnailUrl || m.logo.url)) || null,
    cover: (m.screenshots && m.screenshots[0] && m.screenshots[0].url) || null,
    downloads: m.downloadCount || 0, follows: m.thumbsUpCount || 0,
    categories: (m.categories || []).map(c => c.name),
    loaders, versions, updated: m.dateModified || m.dateReleased || '',
    url: (m.links && m.links.websiteUrl) || `https://www.curseforge.com/minecraft/${kind === 'modpack' ? 'modpacks' : 'mc-mods'}/${m.slug}`,
    source: 'curseforge', kind, distributable: m.allowModDistribution !== false
  };
}

async function cfSearch({ query, kind, category, loader, gameVersion, sort, offset, limit }) {
  const p = {
    gameId: CF.game, classId: kind === 'modpack' ? CF.classPacks : CF.classMods,
    sortField: CF_SORT[sort] || 6, sortOrder: 'desc', index: Math.max(0, offset | 0), pageSize: Math.min(50, limit || 24)
  };
  if (query) p.searchFilter = query;
  if (category) p.categoryId = category;
  if (gameVersion) p.gameVersion = gameVersion;
  if (CF_LOADER[loader]) p.modLoaderType = CF_LOADER[loader];
  const j = await cfRequest('/mods/search', { params: p });
  const pg = j.pagination || {};
  return { total: Math.min(pg.totalCount != null ? pg.totalCount : (j.data || []).length, 10000), items: (j.data || []).map(m => cfCard(m, kind)) };
}

async function cfCategories(kind) {
  const j = await cfRequest('/categories', { params: { gameId: CF.game, classId: kind === 'modpack' ? CF.classPacks : CF.classMods } });
  return (j.data || []).filter(c => !c.isClass).map(c => ({ id: c.id, name: c.name })).sort((a, b) => a.name.localeCompare(b.name));
}

async function cfDetails(id) {
  const enc = encodeURIComponent(id);
  const [mod, first] = await Promise.all([
    cfRequest(`/mods/${enc}`),
    cfRequest(`/mods/${enc}/files`, { params: { pageSize: 50, index: 0 } })
  ]);
  // файлов может быть сотни (старые версии игры тоже), поэтому забираем все страницы, а не только свежие
  let fileList = first.data || [];
  const totalFiles = Math.min((first.pagination && first.pagination.totalCount) || fileList.length, 1000);
  const rest = [];
  for (let i = 50; i < totalFiles; i += 50) rest.push(i);
  if (rest.length) {
    const pages = await Promise.all(rest.map(i => cfRequest(`/mods/${enc}/files`, { params: { pageSize: 50, index: i } }).catch(() => ({ data: [] }))));
    for (const pg of pages) fileList = fileList.concat(pg.data || []);
  }
  const files = { data: fileList };
  const m = mod.data;
  return {
    license: '-', followers: m.thumbsUpCount || 0, downloads: m.downloadCount || 0,
    gameVersions: [...new Set((m.latestFilesIndexes || []).map(x => x.gameVersion))],
    loaders: [...new Set((m.latestFilesIndexes || []).map(x => CF_LOADER_NAME[x.modLoader]).filter(Boolean))],
    links: { source: m.links && m.links.sourceUrl, issues: m.links && m.links.issuesUrl, wiki: m.links && m.links.wikiUrl },
    gallery: (m.screenshots || []).map(x => ({ url: x.url, title: x.title || '', desc: x.description || '' })),
    distributable: m.allowModDistribution !== false,
    versions: (files.data || []).map(f => ({
      name: f.displayName || f.fileName, date: f.fileDate, game: (f.gameVersions || []).join(', '),
      gameList: (f.gameVersions || []).filter(v => /^\d/.test(v)), loaderList: (f.gameVersions || []).map(v => v.toLowerCase()).filter(v => CF_LOADER[v]),
      file: f.downloadUrl || null
    }))
  };
}

const CF_HOST = h => h === 'forgecdn.net' || h.endsWith('.forgecdn.net') || h === 'curseforge.com' || h.endsWith('.curseforge.com');
/* адрес файла: из API, а если автор его не отдаёт, стандартный адрес CDN (для запрещённых вернётся ошибка) */
function cfFileUrl(f) {
  if (f.downloadUrl) return f.downloadUrl;
  const id = Number(f.id);
  return `https://edge.forgecdn.net/files/${Math.floor(id / 1000)}/${id % 1000}/${encodeURIComponent(f.fileName)}`;
}
function cfSha1(f) { const h = (f.hashes || []).find(x => x.algo === 1); return h ? h.value : undefined; }

/* лучший файл мода под версию игры и загрузчик */
async function cfPickFile(modId, mc, loaders) {
  const wanted = loaders.map(l => CF_LOADER[l]).filter(Boolean);
  let all = [];
  for (const lt of wanted.length ? wanted : [undefined]) {
    const params = { gameVersion: mc, pageSize: 50 }; if (lt) params.modLoaderType = lt;
    const j = await cfRequest(`/mods/${encodeURIComponent(modId)}/files`, { params });
    all = all.concat(j.data || []);
    if (all.length) break;
  }
  const rank = f => (f.releaseType === 1 ? 0 : f.releaseType === 2 ? 1 : 2);
  all.sort((a, b) => rank(a) - rank(b) || String(b.fileDate).localeCompare(String(a.fileDate)));
  return all[0] || null;
}

async function installCfMod({ instanceId, cfId }, report) {
  const inst = getInstance(instanceId);
  const loaders = loadersFor(inst.loader);
  if (!loaders.length) throw new Error('В этой установке нет загрузчика модов. Создайте установку с Fabric, Quilt, Forge или NeoForge.');
  const modsDir = path.join(instDir(inst.id), 'mods');
  await fsp.mkdir(modsDir, { recursive: true });
  const installed = [], visited = new Set();
  const known = (loadInstances().find(i => i.id === inst.id) || {}).mods || [];
  const onDisk = m => fs.existsSync(path.join(modsDir, m.file));

  async function one(id, depth, isDep) {
    id = String(id);
    if (visited.has(id) || depth > 4) return;
    visited.add(id);
    if (isDep && known.some(m => m.projectId === 'cf:' + id && onDisk(m))) return;   // зависимость уже установлена
    const mod = (await cfRequest(`/mods/${encodeURIComponent(id)}`)).data;
    const file = await cfPickFile(id, inst.mc, loaders);
    if (!file) {
      if (isDep) return;
      throw new Error(`Для Minecraft ${inst.mc} (${inst.loader}) у «${mod.name}» нет подходящей версии на CurseForge`);
    }
    if (mod.allowModDistribution === false && !file.downloadUrl) {
      throw new Error(`Автор «${mod.name}» запретил скачивание сторонними программами, скачайте мод вручную: ${(mod.links && mod.links.websiteUrl) || 'страница на CurseForge'}`);
    }
    const url = cfFileUrl(file);
    const host = new URL(url).hostname;
    if (!CF_HOST(host)) throw new Error('Файл размещён на неизвестном сервере');
    const how = await fetchModFile({ url, dest: path.join(modsDir, path.basename(file.fileName)), sha1: cfSha1(file), size: file.fileLength, file: file.fileName, isDep, report });
    const prev = known.find(m => m.projectId === 'cf:' + id && m.file !== path.basename(file.fileName));
    if (prev) await fsp.rm(path.join(modsDir, prev.file), { force: true }).catch(() => {});
    installed.push({ projectId: 'cf:' + id, slug: String(id), title: mod.name, file: path.basename(file.fileName), version: file.displayName || '', dependency: !!isDep, source: 'curseforge', cached: how === 'cached' });
    for (const d of file.dependencies || []) if (d.relationType === 3 && d.modId) await one(d.modId, depth + 1, true);
  }
  await one(cfId, 0, false);

  const all = loadInstances();
  const rec = all.find(i => i.id === inst.id);
  rec.mods = (rec.mods || []).filter(m => !installed.some(n => n.projectId === m.projectId)).concat(installed.map(({ cached, ...r }) => r));
  saveInstances(all);
  return installed;
}

/* версии сборки CurseForge: файлы с manifest.json внутри (zip) */
async function cfPackVersions(modId) {
  const j = await cfRequest(`/mods/${encodeURIComponent(modId)}/files`, { params: { pageSize: 30 } });
  return (j.data || []).filter(f => /\.zip$/i.test(f.fileName)).map(f => ({
    id: String(f.id), name: f.displayName || f.fileName, number: f.displayName || f.fileName,
    type: f.releaseType === 1 ? 'release' : f.releaseType === 2 ? 'beta' : 'alpha',
    mc: (f.gameVersions || []).filter(v => /^\d/.test(v)), loaders: (f.gameVersions || []).map(v => v.toLowerCase()).filter(v => CF_LOADER[v]), date: f.fileDate
  }));
}

function readCfPack(file) {
  const AdmZip = require('adm-zip');
  let zip;
  try { zip = new AdmZip(file); } catch { throw new Error('Не удаётся открыть файл: это не архив сборки'); }
  const entry = zip.getEntry('manifest.json');
  if (!entry) throw new Error('В архиве нет manifest.json, это не сборка CurseForge');
  let man;
  try { man = JSON.parse(entry.getData().toString('utf8')); } catch { throw new Error('Повреждён manifest.json'); }
  if (!man.minecraft || !man.minecraft.version) throw new Error('В сборке не указана версия Minecraft');
  const ml = (man.minecraft.modLoaders || []).find(x => x.primary) || (man.minecraft.modLoaders || [])[0];
  let loader = 'vanilla', loaderVersion = null;
  if (ml) {
    const m = /^(forge|fabric|quilt|neoforge)-(.+)$/i.exec(String(ml.id));
    if (!m) throw new Error(`Неизвестный загрузчик в сборке: ${ml.id}`);
    loader = m[1].toLowerCase(); loaderVersion = m[2];
  }
  return { zip, man, mc: man.minecraft.version, loader, loaderVersion, name: String(man.name || 'Сборка').slice(0, 40), overrides: String(man.overrides || 'overrides') };
}

async function installCfPack(opts, report, onLog, onFile) {
  let file = opts.file, temp = false;
  if (!file) {
    const j = await cfRequest(`/mods/${encodeURIComponent(opts.modId)}/files/${encodeURIComponent(opts.fileId)}`);
    const f = j.data;
    if (!f || !/\.zip$/i.test(f.fileName)) throw new Error('У этой версии нет архива сборки');
    const url = cfFileUrl(f);
    if (!CF_HOST(new URL(url).hostname)) throw new Error('Файл размещён на неизвестном сервере');
    file = path.join(DIRS.root, 'packs', crypto.randomBytes(3).toString('hex') + '-' + path.basename(f.fileName));
    report(`Скачиваю сборку ${f.fileName}`, 0.01);
    await download(url, file, { sha1: cfSha1(f) });
    temp = true;
  }
  const pack = readCfPack(file);
  const refs = (pack.man.files || []).filter(x => x.projectID && x.fileID && x.required !== false);
  report(`Сборка «${pack.name}»: Minecraft ${pack.mc}, ${LOADER_NAMES[pack.loader] || 'Vanilla'}, модов: ${refs.length}`, 0.02);
  let inst = null;
  try {
    inst = await module.exports.createInstance({ name: pack.name, mc: pack.mc, loader: pack.loader, loaderVersion: pack.loaderVersion, exactLoader: true, ramAuto: true },
      (t, p) => report(t, 0.02 + 0.5 * p), onLog);
    const dir = instDir(inst.id), modsDir = path.join(dir, 'mods');
    await fsp.mkdir(modsDir, { recursive: true });
    // сведения о файлах, пачками
    const infos = new Map();
    for (let i = 0; i < refs.length; i += 100) {
      const chunk = refs.slice(i, i + 100);
      const j = await cfRequest('/mods/files', { body: { fileIds: chunk.map(x => x.fileID) } });
      for (const f of j.data || []) infos.set(f.id, f);
    }
    const skipped = [];
    let done = 0;
    await pool(refs, 4, async ref => {
      const f = infos.get(ref.fileID);
      try {
        if (!f) throw new Error('файл не найден на CurseForge');
        const url = cfFileUrl(f);
        if (!CF_HOST(new URL(url).hostname)) throw new Error('неизвестный сервер');
        const name = path.basename(f.fileName);
        if (onFile) onFile({ file: name, received: 0, total: f.fileLength || 0 });
        await download(url, path.join(modsDir, name), { sha1: cfSha1(f), onProgress: (g, t) => onFile && onFile({ file: name, received: g, total: t || f.fileLength || 0 }) });
        if (onFile) onFile({ file: name, received: 1, total: 1, done: true });
      } catch (e) { skipped.push({ projectId: ref.projectID, fileId: ref.fileID, name: f ? f.fileName : null, error: e.message }); }
      done++; report(`Скачано модов: ${done} из ${refs.length}`, 0.52 + 0.43 * done / refs.length);
    });
    report('Копирую настройки и файлы сборки', 0.96);
    const prefix = pack.overrides.replace(/\/+$/, '') + '/';
    for (const e of pack.zip.getEntries()) {
      if (e.isDirectory || !e.entryName.startsWith(prefix)) continue;
      const dest = packDest(dir, e.entryName.slice(prefix.length));
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.writeFile(dest, e.getData());
    }
    const all = loadInstances(); const rec = all.find(i => i.id === inst.id);
    rec.pack = { name: pack.name, version: String(pack.man.version || ''), files: refs.length - skipped.length, source: 'curseforge' };
    saveInstances(all);
    report('Сборка установлена', 1);
    return { ...rec, files: refs.length - skipped.length, skipped };
  } catch (e) {
    if (inst) { try { await deleteInstance(inst.id); } catch { /* уже удалена */ } }
    throw e;
  } finally {
    if (temp) fsp.rm(file, { force: true }).catch(() => {});
  }
}

/* какой формат у файла сборки: .mrpack (Modrinth) или zip с manifest.json (CurseForge) */
async function installPackAny(opts, report, onLog, onFile) {
  if (opts.file) {
    const AdmZip = require('adm-zip');
    let zip; try { zip = new AdmZip(opts.file); } catch { throw new Error('Не удаётся открыть файл: это не сборка'); }
    if (zip.getEntry('modrinth.index.json')) return installMrpack(opts, report, onLog, onFile);
    if (zip.getEntry('manifest.json')) return installCfPack(opts, report, onLog, onFile);
    throw new Error('Неизвестный формат сборки: нет ни modrinth.index.json, ни manifest.json');
  }
  if (opts.source === 'curseforge') return installCfPack(opts, report, onLog, onFile);
  return installMrpack(opts, report, onLog, onFile);
}

module.exports = {
  installModFile,
  init, DIRS, OS, ARCH, LOADERS, startJob, cancelJob, CANCELLED, optifineList, optifineInfo, installOptifine,
  listVersions, listInstances, listInstancesLive, getInstance, createInstance, deleteInstance,
  loaderOptions, changeLoader, sysInfo, recommendRam, effectiveRam, maxRam, watchInstances, ensureAuthlib,
  launch, isRunning, installMod, listMods, removeMod, instDir, updateInstance, listScreenshots, setIconFile, clearIcon, setBgFile, clearBg, backgroundFor, installMrpack, packVersions, installMods, checkMods, setCurseKeyProvider, hasCurseKey, cfSearch, cfCategories, cfDetails, cfPackVersions, installCfMod, installCfPack, installPackAny,
  // для тестов
  _t: { uniqueInstanceId, readCfPack, cfCard, cfFileUrl, cfPickFile, readMrpack, packDest, download, compareVer, forgeFor, neoforgeFor, fabricLikeFor, clampRam, countMods, lineFeeder, decodeBytes, ruleOk, mavenPath, resolveLibs, readVersion, buildCommand, expandArgs, sub, loadersFor, slugify, installFabricLike, resolveForgeLike }
};
