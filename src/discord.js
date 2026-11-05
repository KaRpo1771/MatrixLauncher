'use strict';
/* ============================================================
   MatrixL, статус в Discord (Rich Presence) без сторонних библиотек.
   Разговор с локальным клиентом Discord идёт по его IPC-каналу:
   Windows, именованный канал \\?\pipe\discord-ipc-N, Linux/macOS, сокет discord-ipc-N.
   Если Discord не запущен, тихо пробуем снова раз в 15 секунд.
   ============================================================ */
const net = require('net');
const path = require('path');
const crypto = require('crypto');

const OP = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };
const RETRY_MS = 15000;
const MIN_GAP_MS = 4000;       // Discord ограничивает частоту обновлений статуса

function pipePaths() {
  const out = [];
  for (let i = 0; i < 10; i++) {
    if (process.platform === 'win32') out.push(`\\\\?\\pipe\\discord-ipc-${i}`);
    else {
      const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP, '/tmp'].filter(Boolean);
      for (const b of bases) {
        out.push(path.join(b, `discord-ipc-${i}`));
        out.push(path.join(b, 'snap.discord', `discord-ipc-${i}`));
        out.push(path.join(b, 'app', 'com.discordapp.Discord', `discord-ipc-${i}`));
      }
    }
  }
  return out;
}

const frame = (op, data) => {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0); head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
};
// Discord требует строки от 2 до 128 символов
const clip = s => { s = String(s == null ? '' : s).trim(); return s.length < 2 ? undefined : s.slice(0, 128); };

let LOGO_URL = '';
try { const u = String(require('./discord-logo') || '').trim(); if (/^https:\/\/\S{1,240}$/.test(u)) LOGO_URL = u; } catch { /* файла нет, берём ключ logo */ }

class DiscordPresence {
  constructor() {
    this.clientId = ''; this.enabled = false;
    this.sock = null; this.ready = false; this.buf = Buffer.alloc(0);
    this.activity = null; this.lastSent = 0; this.sendTimer = null; this.retryTimer = null;
    this.connecting = false;
  }

  /* включить/выключить и сменить ID приложения */
  configure({ clientId, enabled }) {
    const id = /^\d{17,20}$/.test(String(clientId || '').trim()) ? String(clientId).trim() : '';
    const on = !!enabled && !!id;
    const changed = id !== this.clientId || on !== this.enabled;
    this.clientId = id; this.enabled = on;
    if (!changed) return;
    this._drop();
    if (on) this._connect(); else this._clearTimers();
  }

  get active() { return this.enabled && this.ready; }

  /* activity: { details, state, start (мс) } или null, убрать статус */
  set(a) {
    this.activity = a ? {
      details: clip(a.details), state: clip(a.state),
      ...(a.start ? { timestamps: { start: Math.floor(a.start / 1000) } } : {}),
      assets: { large_image: LOGO_URL || 'logo', large_text: clip(a.largeText) || 'MatrixL' }
    } : null;
    this._flush();
  }

  destroy() { this.enabled = false; this._clearTimers(); this._drop(true); }

  _clearTimers() { clearTimeout(this.sendTimer); clearTimeout(this.retryTimer); this.sendTimer = this.retryTimer = null; }

  _drop(clear) {
    const s = this.sock; this.sock = null; this.ready = false; this.buf = Buffer.alloc(0); this.connecting = false;
    if (!s) return;
    s.removeAllListeners();
    s.on('error', () => {});
    try { if (clear && s.writable) s.write(frame(OP.CLOSE, {})); s.destroy(); } catch { /* уже закрыт */ }
  }

  _retry() {
    this._drop();
    if (!this.enabled || this.retryTimer) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = null; if (this.enabled) this._connect(); }, RETRY_MS);
    if (this.retryTimer.unref) this.retryTimer.unref();
  }

  async _connect() {
    if (this.connecting || this.sock || !this.enabled) return;
    this.connecting = true;
    const id = this.clientId;
    for (const p of pipePaths()) {
      if (!this.enabled || id !== this.clientId) break;
      const s = await new Promise(res => {
        const c = net.createConnection(p);
        c.once('connect', () => res(c));
        c.once('error', () => { c.destroy(); res(null); });
      });
      if (!s) continue;
      if (!this.enabled || id !== this.clientId) { s.destroy(); break; }
      this.sock = s; this.connecting = false;
      s.on('data', d => this._onData(d));
      s.on('error', () => this._retry());
      s.on('close', () => this._retry());
      s.write(frame(OP.HANDSHAKE, { v: 1, client_id: id }));
      return;
    }
    this.connecting = false;
    this._retry();
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0), len = this.buf.readInt32LE(4);
      if (len < 0 || len > 1 << 20) { this._retry(); return; }
      if (this.buf.length < 8 + len) return;
      let msg = {};
      try { msg = JSON.parse(this.buf.subarray(8, 8 + len).toString('utf8')); } catch { /* битый кадр пропускаем */ }
      this.buf = this.buf.subarray(8 + len);
      if (op === OP.PING && this.sock) this.sock.write(frame(OP.PONG, msg));
      else if (op === OP.CLOSE) { this._retry(); return; }
      else if (op === OP.FRAME && msg.evt === 'READY') { this.ready = true; this.lastSent = 0; this._flush(); }
    }
  }

  _flush() {
    if (!this.ready || !this.sock) return;
    const wait = this.lastSent + MIN_GAP_MS - Date.now();
    if (wait > 0) {
      if (!this.sendTimer) { this.sendTimer = setTimeout(() => { this.sendTimer = null; this._flush(); }, wait); if (this.sendTimer.unref) this.sendTimer.unref(); }
      return;
    }
    this.lastSent = Date.now();
    try {
      this.sock.write(frame(OP.FRAME, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: this.activity || null }, nonce: crypto.randomUUID() }));
    } catch { this._retry(); }
  }
}

module.exports = { DiscordPresence, _t: { frame, clip } };
