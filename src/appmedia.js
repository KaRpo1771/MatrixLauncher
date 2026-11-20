'use strict';
/* ============================================================
   Свой фон лаунчера (картинка, GIF или видео).
   Файлы копируются в папку данных лаунчера (appmedia), поэтому не пропадут, если исходный файл
   переместят. Окно лаунчера получает только безопасное описание: адрес фона;
   пути выбираются системным окном в главном процессе, из окна их передать нельзя.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const { spawn, spawnSync } = require('child_process');

const MB = 1024 * 1024;
const IMAGE = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.apng', '.avif', '.bmp'];
const VIDEO = ['.mp4', '.webm', '.m4v', '.ogv'];
const LIMIT = { image: 40 * MB, video: 250 * MB };
const DEFAULTS = { dim: 55, blur: 0, videoVolume: 50 };

let DIR = null, FILE = null;

function init(userData) {
  DIR = path.join(userData, 'appmedia');
  FILE = path.join(DIR, 'state.json');
  try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* папка создастся при первой записи */ }
  dropOldMusic();
}
/* в прошлых версиях здесь жили треки музыки: убираем их файлы и записи, чтобы не занимали место */
function dropOldMusic() {
  try {
    for (const f of fs.readdirSync(DIR)) if (/^track-[0-9a-f]{12}\.[a-z0-9]{2,5}$/.test(f)) rm(f);
    if (!fs.existsSync(FILE)) return;
    const d = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
    const o = d.opts && typeof d.opts === 'object' ? d.opts : null;
    if (!('tracks' in d) && !(o && ('volume' in o || 'shuffle' in o || 'autoplay' in o))) return;
    delete d.tracks;
    if (o) { delete o.volume; delete o.shuffle; delete o.autoplay; }
    save(d);
  } catch { /* не вышло почистить: старые записи просто игнорируются */ }
}

const exts = list => list.map(e => e.slice(1));
const filters = {
  background: [{ name: 'Картинки, GIF и видео', extensions: exts([...IMAGE, ...VIDEO]) }]
};

function load() {
  let d = {};
  try { d = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {}; } catch { /* файла ещё нет */ }
  const bg = d.bg && /^bg-[0-9a-f]{12}\.[a-z0-9]{2,5}$/.test(d.bg.file || '') && (d.bg.kind === 'image' || d.bg.kind === 'video') ? d.bg : null;
  const o = d.opts && typeof d.opts === 'object' ? d.opts : {};
  return { bg, opts: { dim: o.dim ?? DEFAULTS.dim, blur: o.blur ?? DEFAULTS.blur, videoVolume: o.videoVolume ?? DEFAULTS.videoVolume } };
}
function save(st) {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(st, null, 2));
  fs.renameSync(tmp, FILE);
}
const clamp = (v, lo, hi, def) => { v = Math.round(Number(v)); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
const rm = f => { try { fs.rmSync(path.join(DIR, f), { force: true }); } catch { /* уже удалён */ } };

/* что видит окно лаунчера. Файлы, которых уже нет на диске, из описания убираются */
function view() {
  const st = load();
  let bg = null;
  if (st.bg) {
    const f = path.join(DIR, st.bg.file);
    try { bg = { kind: st.bg.kind, name: st.bg.name, url: pathToFileURL(f).href + '?v=' + Math.floor(fs.statSync(f).mtimeMs) }; } catch { bg = null; }
  }
  const o = st.opts;
  return {
    bg,
    dim: clamp(o.dim, 0, 90, DEFAULTS.dim), blur: clamp(o.blur, 0, 24, DEFAULTS.blur), videoVolume: clamp(o.videoVolume, 0, 100, DEFAULTS.videoVolume)
  };
}

function checkFile(src, allowed, kindOf) {
  const ext = path.extname(String(src || '')).toLowerCase();
  if (!allowed.includes(ext)) return { error: 'формат не поддерживается' };
  let st;
  try { st = fs.statSync(src); } catch { return { error: 'файл недоступен' }; }
  if (!st.isFile()) return { error: 'это не файл' };
  const kind = kindOf(ext);
  if (st.size > LIMIT[kind]) return { error: `файл больше ${Math.round(LIMIT[kind] / MB)} МБ` };
  if (st.size === 0) return { error: 'файл пустой' };
  return { ext, kind };
}

/* фон из файла: картинка, GIF или видео */
function setBackground(src) {
  const c = checkFile(src, [...IMAGE, ...VIDEO], e => (VIDEO.includes(e) ? 'video' : 'image'));
  if (c.error) throw new Error(`Не удалось поставить фон: ${c.error}. Подходят PNG, JPG, WEBP, GIF (до 40 МБ) и MP4, WEBM (до 250 МБ)`);
  const st = load();
  const file = `bg-${crypto.randomBytes(6).toString('hex')}${c.ext}`;
  fs.mkdirSync(DIR, { recursive: true });
  fs.copyFileSync(src, path.join(DIR, file));
  if (st.bg) rm(st.bg.file);
  st.bg = { file, kind: c.kind, name: path.basename(src).slice(0, 80) };
  save(st);
  return view();
}
/* ---------- видео, которое окно проиграть не может (H.265, 10 бит и т.п.) ----------
   Такой файл один раз перекодируется в обычный MP4 (H.264 + AAC) через ffmpeg, исходник заменяется копией. */
function findFfmpeg() {
  try {
    let p = require('ffmpeg-static');
    if (p) {
      p = String(p).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);   // в собранном приложении бинарник лежит вне архива
      if (fs.existsSync(p)) return p;
    }
  } catch { /* пакета нет */ }
  try { if (spawnSync('ffmpeg', ['-version'], { windowsHide: true, timeout: 5000 }).status === 0) return 'ffmpeg'; } catch { /* ffmpeg нет в PATH */ }
  return null;
}
let converting = false;
async function convertBackground() {
  const st = load();
  if (!st.bg || st.bg.kind !== 'video') throw new Error('Сейчас фон не видео');
  if (converting) throw new Error('Видео уже конвертируется');
  const bin = findFfmpeg();
  if (!bin) throw new Error('Не удалось подготовить видео: в лаунчере нет ffmpeg. Выполните npm install в папке лаунчера или выберите MP4 в H.264');
  const src = path.join(DIR, st.bg.file);
  const file = `bg-${crypto.randomBytes(6).toString('hex')}.mp4`;
  const out = path.join(DIR, file);
  const args = ['-nostdin', '-y', '-i', src, '-map', '0:v:0', '-map', '0:a:0?', '-sn',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-vf', 'scale=min(1920\\,iw):-2',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out];
  converting = true;
  try {
    await new Promise((ok, no) => {
      const p = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
      let tail = '';
      p.stderr.on('data', d => { tail = (tail + d).slice(-600); });
      p.on('error', e => no(new Error('ffmpeg не запустился: ' + e.message)));
      p.on('close', code => (code === 0 ? ok() : no(new Error('не удалось перекодировать видео' + (tail ? ' (' + tail.trim().split('\n').pop().slice(0, 120) + ')' : '')))));
    });
    if (!fs.existsSync(out) || fs.statSync(out).size === 0) throw new Error('получился пустой файл');
  } catch (e) {
    rm(file);
    throw new Error('Фон: ' + (e && e.message ? e.message : e));
  } finally { converting = false; }
  const cur = load();
  if (!cur.bg || cur.bg.file !== st.bg.file) { rm(file); return view(); }   // пока шла конвертация, фон сменили или сбросили
  rm(cur.bg.file);
  cur.bg = { ...cur.bg, file };
  save(cur);
  return view();
}

function clearBackground() {
  const st = load();
  if (st.bg) rm(st.bg.file);
  st.bg = null;
  save(st);
  return view();
}

/* настройки: затемнение и размытие фона, громкость видео */
function setOptions(patch) {
  const st = load(), p = patch && typeof patch === 'object' ? patch : {};
  const o = st.opts;
  if ('dim' in p) o.dim = clamp(p.dim, 0, 90, DEFAULTS.dim);
  if ('blur' in p) o.blur = clamp(p.blur, 0, 24, DEFAULTS.blur);
  if ('videoVolume' in p) o.videoVolume = clamp(p.videoVolume, 0, 100, DEFAULTS.videoVolume);
  save(st);
  return view();
}

module.exports = { init, view, filters, setBackground, convertBackground, clearBackground, setOptions, _t: { clamp, IMAGE, VIDEO } };
