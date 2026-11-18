'use strict';
/* ============================================================
   Сведения о сервере для статуса в Discord: сколько игроков онлайн и как сервер назван
   в списке серверов игры. Запрос тот же, что отправляет сама игра в списке серверов
   (Server List Ping: рукопожатие + запрос статуса), ничего не меняет на сервере.
   ============================================================ */
const net = require('net');
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
        finish(null, { online: pl.online, max: pl.max, version: j.version && j.version.name ? String(j.version.name) : '' });
      } catch (e) { finish(e); }
    });
  });
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

module.exports = { ping, savedName, splitHost, _t: { varint, pack } };
