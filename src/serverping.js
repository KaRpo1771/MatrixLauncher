'use strict';
/* ============================================================
   Сведения о сервере для статуса в Discord: сколько игроков онлайн и как сервер назван
   в списке серверов игры. Запрос тот же, что отправляет сама игра в списке серверов
   (Server List Ping: рукопожатие + запрос статуса), ничего не меняет на сервере.
   ============================================================ */
const net = require('net');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const worldinfo = require('./worldinfo');

const varint = n => { const b = []; n >>>= 0; do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; b.push(x); } while (n); return Buffer.from(b); };
const pack = body => Buffer.concat([varint(body.length), body]);
function readVarint(buf, o) {
  let r = 0, shift = 0;
  for (let i = 0; i < 5; i++) {
    if (o + i >= buf.length) return null;
    const b = buf[o + i];
    r |= (b & 0x7f) << shift;
    if (!(b & 0x80)) return { value: r >>> 0, size: i + 1 };
    shift += 7;
  }
  throw new Error('bad varint');
}

/* → { online, max, version } или ошибка. Ждёт не дольше timeout мс. */
function ping(host, port = 25565, timeout = 4000) {
  return new Promise((resolve, reject) => {
    let done = false, buf = Buffer.alloc(0);
    const sock = net.createConnection({ host, port: Number(port) || 25565 });
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); sock.destroy(); err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(new Error('timeout')), timeout);
    if (timer.unref) timer.unref();
    sock.on('error', e => finish(e));
    sock.on('close', () => finish(new Error('closed')));
    sock.on('connect', () => {
      const h = Buffer.from(String(host), 'utf8');
      const p = Buffer.alloc(2); p.writeUInt16BE(Number(port) || 25565);
      sock.write(Buffer.concat([
        pack(Buffer.concat([varint(0), varint(765), varint(h.length), h, p, varint(1)])),
        pack(varint(0))
      ]));
    });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (buf.length > 1 << 20) return finish(new Error('too big'));
      try {
        const len = readVarint(buf, 0); if (!len) return;
        if (buf.length < len.size + len.value) return;
        let o = len.size;
        const id = readVarint(buf, o); o += id.size;
        if (id.value !== 0) return finish(new Error('bad packet'));
        const sl = readVarint(buf, o); o += sl.size;
        const j = JSON.parse(buf.toString('utf8', o, o + sl.value));
        const pl = j && j.players;
        if (!pl || !Number.isFinite(pl.online) || !Number.isFinite(pl.max)) return finish(new Error('no players'));
        // своя иконка у сервера есть, если он прислал favicon (иначе публичный сервис отдал бы картинку по умолчанию)
        const hasIcon = typeof j.favicon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]{100,}$/.test(j.favicon);
        finish(null, { online: pl.online, max: pl.max, hasIcon, version: j.version && j.version.name ? String(j.version.name) : '' });
      } catch (e) { finish(e); }
    });
  });
}


/* ---------- вкладка «Серверы» ----------
   Полный запрос статуса: игроки, версия, описание (MOTD), иконка, задержка (по пакету ping/pong).
   Для доменов без порта сначала ищется SRV-запись _minecraft._tcp, как это делает сама игра. */
const stripCodes = t => String(t || '').replace(/§[0-9a-fk-or]/gi, '');
function flatten(d) {
  if (d == null) return '';
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map(flatten).join('');
  return String(d.text || '') + flatten(d.extra);
}

function query(host, port, timeout, target) {
  return new Promise((resolve, reject) => {
    let done = false, buf = Buffer.alloc(0), result = null, t0 = 0, tPing = 0, pongTimer = null;
    const sock = net.createConnection({ host: target && target.host || host, port: target && target.port || port });
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); clearTimeout(pongTimer); sock.destroy(); err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(result ? null : new Error('timeout'), result), timeout);
    if (timer.unref) timer.unref();
    sock.on('error', e => finish(result ? null : e, result));
    sock.on('close', () => finish(result ? null : new Error('closed'), result));
    sock.on('connect', () => {
      t0 = Date.now();
      const h = Buffer.from(String(host), 'utf8');
      const p = Buffer.alloc(2); p.writeUInt16BE(port);
      sock.write(Buffer.concat([
        pack(Buffer.concat([varint(0), varint(765), varint(h.length), h, p, varint(1)])),
        pack(varint(0))
      ]));
    });
    sock.on('data', d => {
      buf = Buffer.concat([buf, d]);
      if (buf.length > 1 << 20) return finish(result ? null : new Error('too big'), result);
      try {
        for (;;) {
          const len = readVarint(buf, 0);
          if (!len || buf.length < len.size + len.value) return;
          const body = buf.subarray(len.size, len.size + len.value);
          buf = buf.subarray(len.size + len.value);
          const id = readVarint(body, 0);
          if (id.value === 0 && !result) {
            let o = id.size;
            const sl = readVarint(body, o); o += sl.size;
            const j = JSON.parse(body.toString('utf8', o, o + sl.value));
            const pl = j && j.players;
            if (!pl || !Number.isFinite(pl.online) || !Number.isFinite(pl.max)) throw new Error('no players');
            const fav = typeof j.favicon === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(j.favicon) && j.favicon.length < 120000 ? j.favicon : '';
            result = {
              online: true,
              players: pl.online, max: pl.max,
              sample: Array.isArray(pl.sample) ? pl.sample.map(x => stripCodes(x && x.name).slice(0, 24)).filter(Boolean).slice(0, 12) : [],
              version: j.version && j.version.name ? stripCodes(j.version.name).slice(0, 40) : '',
              motd: stripCodes(flatten(j.description)).replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim().slice(0, 200),
              favicon: fav,
              latency: Date.now() - t0
            };
            // замер задержки по пакету ping/pong; если сервер не ответит, остаётся время запроса статуса
            tPing = Date.now();
            sock.write(pack(Buffer.concat([varint(1), Buffer.alloc(8)])));
            pongTimer = setTimeout(() => finish(null, result), 1500);
            if (pongTimer.unref) pongTimer.unref();
          } else if (id.value === 1 && result) {
            result.latency = Math.max(1, Date.now() - tPing);
            return finish(null, result);
          }
        }
      } catch (e) { finish(result ? null : e, result); }
    });
  });
}

function srv(host) {
  return new Promise(resolve => {
    const t = setTimeout(() => resolve(null), 2000);
    if (t.unref) t.unref();
    dns.resolveSrv('_minecraft._tcp.' + host, (err, rec) => {
      clearTimeout(t);
      resolve(!err && rec && rec[0] && rec[0].name ? { host: rec[0].name, port: rec[0].port } : null);
    });
  });
}

/* Проверка адреса из поля ввода → { host, port, explicit } или ошибка */
function parseAddress(raw) {
  let a = String(raw || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  if (!a) throw new Error('empty');
  const m = /^([a-z0-9]([a-z0-9._-]{0,251}[a-z0-9])?)(?::(\d{1,5}))?$/.exec(a);
  if (!m) throw new Error('bad-address');
  const port = m[3] ? Number(m[3]) : 25565;
  if (port < 1 || port > 65535) throw new Error('bad-address');
  return { host: m[1], port, explicit: !!m[3] };
}

/* Состояние сервера для вкладки: никогда не бросает, возвращает { online:false, reason } */
async function status(raw, timeout = 5000) {
  const t = Date.now();
  let a;
  try { a = parseAddress(raw); } catch (e) { return { online: false, reason: e.message === 'empty' ? 'empty' : 'bad-address', at: t }; }
  try {
    const target = !a.explicit && !/^\d{1,3}(\.\d{1,3}){3}$/.test(a.host) ? await srv(a.host) : null;
    const r = await query(a.host, a.port, timeout, target);
    return { ...r, at: Date.now() };
  } catch (e) {
    const c = e && e.code;
    const reason = c === 'ENOTFOUND' || c === 'EAI_AGAIN' ? 'not-found' : c === 'ECONNREFUSED' ? 'refused' : e && e.message === 'timeout' ? 'timeout' : 'no-answer';
    return { online: false, reason, at: Date.now() };
  }
}

/* Название сервера из servers.dat (список серверов игры): ищем запись с тем же адресом */
function savedName(gameDir, host) {
  try {
    const root = worldinfo._t.readNbt(fs.readFileSync(path.join(gameDir, 'servers.dat')));
    const want = String(host).toLowerCase(), bare = want.replace(/:25565$/, '');
    for (const s of root.servers || []) {
      const ip = String(s.ip || '').toLowerCase().replace(/:25565$/, '');
      const name = String(s.name || '').trim();
      if (name && (ip === bare || ip === want)) return name.slice(0, 40);
    }
  } catch { /* списка нет или он не читается */ }
  return '';
}

/* "host" или "host:port" → { host, port } */
function splitHost(h) {
  const m = /^(.*?)(?::(\d{1,5}))?$/.exec(String(h || ''));
  return { host: m[1], port: m[2] ? Number(m[2]) : 25565 };
}

/* Адрес иконки сервера для Discord. Discord принимает только https-ссылку (до 256 символов), а favicon сервера приходит
   как данные внутри ответа, поэтому берём публичный сервис, который отдаёт эту же иконку (PNG 64×64). Пустая строка, если адрес не подходит. */
const ICON_API = 'https://api.mcstatus.io/v2/icon/';
function iconUrl(host) {
  const h = String(host || '').trim().toLowerCase();
  if (!/^[a-z0-9]([a-z0-9._-]{0,251}[a-z0-9])?(:\d{1,5})?$/.test(h)) return '';
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/.test(h) || !/[.]/.test(h.replace(/:\d+$/, ''))) return '';   // локальные адреса из интернета недоступны
  const u = ICON_API + encodeURIComponent(h.replace(/:25565$/, '')).replace(/%3A/g, ':');
  return u.length <= 256 ? u : '';
}

module.exports = { ping, status, parseAddress, savedName, splitHost, iconUrl, _t: { varint, pack } };
