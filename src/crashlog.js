'use strict';
/* ============================================================
   Журнал запуска и разбор падений игры.
   • каждый запуск пишется в <папка экземпляра>/logs/matrixl-<дата>.log (хранятся последние 10);
   • в память берутся последние строки вывода игры (хватает для отчёта о падении);
   • когда игра завершилась с ненулевым кодом, собирается отчёт: заголовок с описанием системы,
     файл из crash-reports (если игра его создала), hs_err_pid*.log (падение самой Java)
     и хвост вывода. Этот отчёт показывается пользователю в окне краша.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEEP_FILES = 10;          // сколько файлов журнала хранить
const KEEP_LINES = 600;         // сколько последних строк вывода держать в памяти
const REPORT_TAIL = 160;        // сколько строк вывода класть в отчёт, если нет crash-report
const MAX_REPORT = 120 * 1024;  // предел размера отчёта, чтобы окно не зависало

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

function newestSince(dir, re, since) {
  try {
    return fs.readdirSync(dir).filter(n => re.test(n))
      .map(n => { const f = path.join(dir, n); return { f, t: fs.statSync(f).mtimeMs }; })
      .filter(x => x.t >= since).sort((a, b) => b.t - a.t)[0] || null;
  } catch { return null; }
}
function readCapped(file) {
  try {
    const buf = fs.readFileSync(file);
    const txt = buf.toString('utf8');
    return txt.length > MAX_REPORT ? txt.slice(0, MAX_REPORT) + '\n… (отчёт обрезан)' : txt;
  } catch { return ''; }
}

class LaunchLog {
  constructor({ gameDir, info }) {
    this.gameDir = gameDir;
    this.info = info;                       // { launcher, name, mc, loader, loaderVersion }
    this.startedAt = Date.now();
    this.lines = [];
    this.file = null; this.stream = null;
    try {
      const dir = path.join(gameDir, 'logs');
      fs.mkdirSync(dir, { recursive: true });
      this.file = path.join(dir, `matrixl-${stamp()}.log`);
      this.stream = fs.createWriteStream(this.file, { flags: 'a' });
      this.stream.on('error', () => { this.stream = null; });
      this.stream.write(this.header() + '\n\n');
      this.prune(dir);
    } catch { this.file = null; this.stream = null; }
  }
  header() {
    const i = this.info;
    return [
      `MatrixL ${i.launcher || ''}`.trim(),
      `Экземпляр: ${i.name}`,
      `Minecraft: ${i.mc}, загрузчик: ${i.loader}${i.loaderVersion ? ' ' + i.loaderVersion : ''}`,
      `Система: ${os.type()} ${os.release()} (${os.arch()}), ОЗУ: ${Math.round(os.totalmem() / 1048576)} МБ`,
      `Время запуска: ${new Date(this.startedAt).toLocaleString('ru-RU')}`
    ].join('\n');
  }
  prune(dir) {
    try {
      const all = fs.readdirSync(dir).filter(n => /^matrixl-.*\.log$/.test(n)).sort();
      for (const n of all.slice(0, Math.max(0, all.length - KEEP_FILES))) fs.rmSync(path.join(dir, n), { force: true });
    } catch { /* не критично */ }
  }
  push(line) {
    const l = String(line);
    this.lines.push(l);
    if (this.lines.length > KEEP_LINES) this.lines.shift();
    if (this.stream) this.stream.write(l + '\n');
  }
  /* Закрыть журнал и, если игра упала, собрать отчёт. Для нормального выхода вернёт null. */
  finish(code) {
    if (this.stream) { this.stream.end(`\n[Игра завершена с кодом ${code}]\n`); this.stream = null; }
    if (code === 0) return null;
    const since = this.startedAt - 2000;
    const crash = newestSince(path.join(this.gameDir, 'crash-reports'), /^crash-.*\.txt$/i, since);
    const hs = newestSince(this.gameDir, /^hs_err_pid\d+\.log$/i, since);
    const parts = [this.header(), `Код выхода: ${code}`];
    let crashFile = null;
    if (crash) { crashFile = crash.f; parts.push(`----- Отчёт игры (${path.basename(crash.f)}) -----\n${readCapped(crash.f)}`); }
    if (hs) { crashFile = crashFile || hs.f; parts.push(`----- Падение Java (${path.basename(hs.f)}) -----\n${readCapped(hs.f).slice(0, 20000)}`); }
    if (!crash) parts.push(`----- Последние строки вывода игры -----\n${this.lines.slice(-REPORT_TAIL).join('\n') || '(игра ничего не вывела)'}`);
    return {
      code, text: parts.join('\n\n'), crashFile, logFile: this.file,
      summary: this.summary(crash ? readCapped(crash.f) : '')
    };
  }
  /* Короткая причина для заголовка окна: строка «Description:» из отчёта или первое исключение в выводе */
  summary(report) {
    const d = /^Description:\s*(.+)$/m.exec(report);
    if (d) return d[1].trim().slice(0, 200);
    const ex = this.lines.slice().reverse().find(l => /(Exception|Error)\b.*:|OutOfMemoryError|UnsupportedClassVersionError/.test(l));
    return ex ? ex.trim().slice(0, 200) : '';
  }
}

module.exports = { LaunchLog };
