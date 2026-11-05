'use strict';
/* ============================================================
   Разбор падений игры.
   • вывод игры держится в памяти (последние строки), отдельных файлов журнала лаунчер больше не создаёт:
     у самой игры уже есть logs/latest.log и crash-reports;
   • когда игра завершилась с ненулевым кодом, собирается отчёт: заголовок с описанием системы,
     файл из crash-reports (если игра его создала), hs_err_pid*.log (падение самой Java)
     и хвост вывода. Этот отчёт показывается пользователю в окне краша;
   • журналы matrixl-*.log от прежних версий лаунчера при запуске удаляются.
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEEP_LINES = 600;         // сколько последних строк вывода держать в памяти
const REPORT_TAIL = 160;        // сколько строк вывода класть в отчёт, если нет crash-report
const MAX_REPORT = 120 * 1024;  // предел размера отчёта, чтобы окно не зависало

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
    this.file = null;
    this.removeLegacy();
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
  /* старые файлы matrixl-*.log (их писали прежние версии лаунчера) */
  removeLegacy() {
    try {
      const dir = path.join(this.gameDir, 'logs');
      for (const n of fs.readdirSync(dir)) if (/^matrixl-.*\.log$/.test(n)) fs.rmSync(path.join(dir, n), { force: true });
    } catch { /* папки logs ещё нет */ }
  }
  push(line) {
    const l = String(line);
    this.lines.push(l);
    if (this.lines.length > KEEP_LINES) this.lines.shift();
  }
  /* Закрыть журнал и, если игра упала, собрать отчёт. Для нормального выхода вернёт null. */
  finish(code) {
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
      code, text: parts.join('\n\n'), crashFile, logFile: this.gameLog(),
      summary: this.summary(crash ? readCapped(crash.f) : '')
    };
  }
  /* собственный журнал игры (его пишет сам Minecraft), если он есть */
  gameLog() {
    const f = path.join(this.gameDir, 'logs', 'latest.log');
    return fs.existsSync(f) ? f : null;
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
