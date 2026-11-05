'use strict';
/* ============================================================
   Сведения об одиночном мире для статуса в Discord: название, режим игры, измерение,
   координаты игрока и биом под ним. Всё читается из файлов сохранения (saves/<мир>):
   level.dat (NBT, gzip) и файлов регионов .mca (Anvil). Игра пишет их при автосохранении
   (примерно раз в 5 минут) и при выходе, поэтому данные могут отставать от реальности.
   Ничего не изменяет и не блокирует файлы мира.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- чтение NBT ---------- */
function readNbt(buf) {
  let o = 0;
  const u8 = () => buf[o++];
  const i16 = () => { const v = buf.readInt16BE(o); o += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(o); o += 4; return v; };
  const i64 = () => { const v = buf.readBigInt64BE(o); o += 8; return v; };
  const str = () => { const n = buf.readUInt16BE(o); o += 2; const s = buf.toString('utf8', o, o + n); o += n; return s; };
  function payload(t) {
    switch (t) {
      case 1: { const v = buf.readInt8(o); o += 1; return v; }
      case 2: return i16();
      case 3: return i32();
      case 4: return i64();
      case 5: { const v = buf.readFloatBE(o); o += 4; return v; }
      case 6: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case 7: { const n = i32(); const v = buf.subarray(o, o + n); o += n; return v; }
      case 8: return str();
      case 9: { const it = u8(), n = i32(); const a = []; for (let k = 0; k < n; k++) a.push(payload(it)); return a; }
      case 10: { const c = {}; for (;;) { const tt = u8(); if (tt === 0) break; const name = str(); c[name] = payload(tt); } return c; }
      case 11: { const n = i32(); const a = []; for (let k = 0; k < n; k++) a.push(i32()); return a; }
      case 12: { const n = i32(); const a = []; for (let k = 0; k < n; k++) a.push(i64()); return a; }
      default: throw new Error('NBT: неизвестный тег ' + t);
    }
  }
  const t = u8();
  if (t !== 10) throw new Error('NBT: ожидался составной тег');
  str();
  return payload(10);
}
const unzipAny = buf => (buf[0] === 0x1f && buf[1] === 0x8b) ? zlib.gunzipSync(buf) : buf;

/* ---------- измерение и биом ---------- */
function dimKind(d) {
  const s = String(d == null ? 'overworld' : d).toLowerCase();
  if (s === '-1' || s.includes('nether')) return 'nether';
  if (s === '1' || s.endsWith('end') || s.includes('the_end')) return 'end';
  return 'overworld';
}
function regionDirs(world, kind) {
  const name = kind === 'nether' ? 'the_nether' : kind === 'end' ? 'the_end' : 'overworld';
  const legacy = kind === 'nether' ? 'DIM-1' : kind === 'end' ? 'DIM1' : '';
  return [path.join(world, legacy, 'region'), path.join(world, 'dimensions', 'minecraft', name, 'region')];
}
function readChunk(file, cx, cz) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4);
    fs.readSync(fd, head, 0, 4, 4 * ((cx & 31) + (cz & 31) * 32));
    const sector = (head[0] << 16) | (head[1] << 8) | head[2];
    if (!sector) return null;
    const lenBuf = Buffer.alloc(5);
    fs.readSync(fd, lenBuf, 0, 5, sector * 4096);
    const len = lenBuf.readInt32BE(0), comp = lenBuf[4];
    if (len < 2 || len > 8 * 1024 * 1024) return null;
    const data = Buffer.alloc(len - 1);
    fs.readSync(fd, data, 0, len - 1, sector * 4096 + 5);
    if (comp === 2) return readNbt(zlib.inflateSync(data));
    if (comp === 3) return readNbt(data);
    if (comp === 1) return readNbt(zlib.gunzipSync(data));
    return null;     // lz4 и прочее не поддерживаем
  } catch { return null; }
  finally { if (fd != null) { try { fs.closeSync(fd); } catch { /* уже закрыт */ } } }
}
/* Биом в точке (формат чанков 1.18 и новее): палитра 4×4×4 ячеек на секцию */
function biomeAt(world, kind, x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  const cx = bx >> 4, cz = bz >> 4;
  for (const dir of regionDirs(world, kind)) {
    const file = path.join(dir, `r.${cx >> 5}.${cz >> 5}.mca`);
    if (!fs.existsSync(file)) continue;
    const chunk = readChunk(file, cx, cz);
    const sections = chunk && (chunk.sections || (chunk.Level && chunk.Level.Sections));
    if (!Array.isArray(sections)) return null;
    const sy = by >> 4;
    const sec = sections.find(s => s.Y === sy) || sections.reduce((a, s) => (!a || Math.abs(s.Y - sy) < Math.abs(a.Y - sy)) ? s : a, null);
    const b = sec && sec.biomes;
    if (!b || !Array.isArray(b.palette) || !b.palette.length) return null;
    if (b.palette.length === 1 || !b.data) return String(b.palette[0]);
    const bits = Math.max(1, Math.ceil(Math.log2(b.palette.length)));
    const per = Math.floor(64 / bits);
    const idx = (((by & 15) >> 2) << 4) | (((bz & 15) >> 2) << 2) | ((bx & 15) >> 2);
    const word = BigInt.asUintN(64, b.data[Math.floor(idx / per)] || 0n);
    const v = Number((word >> BigInt((idx % per) * bits)) & ((1n << BigInt(bits)) - 1n));
    return String(b.palette[v] != null ? b.palette[v] : b.palette[0]);
  }
  return null;
}

/* ---------- активный мир ---------- */
const mtime = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
/* Мир, который открывали после запуска игры: у открытого мира обновляется session.lock */
function activeWorld(gameDir, since) {
  const saves = path.join(gameDir, 'saves');
  let best = null;
  try {
    for (const n of fs.readdirSync(saves)) {
      const dir = path.join(saves, n);
      const t = Math.max(mtime(path.join(dir, 'session.lock')), mtime(path.join(dir, 'level.dat')));
      if (t >= since && (!best || t > best.t) && fs.existsSync(path.join(dir, 'level.dat'))) best = { dir, folder: n, t };
    }
  } catch { /* папки saves нет */ }
  return best;
}

/* Что известно о мире сейчас, или null, если мир ещё не открывали */
function read(gameDir, since) {
  const w = activeWorld(gameDir, since - 10000);
  if (!w) return null;
  const out = { name: w.folder, gamemode: null, hardcore: false, dim: 'overworld', pos: null, biome: null, health: null, food: null, level: null, held: null, elytra: false, riding: false, raining: false, thundering: false, dayTime: null, savedAt: mtime(path.join(w.dir, 'level.dat')) };
  try {
    const root = readNbt(unzipAny(fs.readFileSync(path.join(w.dir, 'level.dat'))));
    const data = root.Data || root;
    if (data.LevelName) out.name = String(data.LevelName);
    out.hardcore = !!data.hardcore;
    out.raining = !!data.raining; out.thundering = !!data.thundering;
    if (data.DayTime != null) out.dayTime = Number(data.DayTime);
    let player = data.Player;
    if (!player) {   // в новых версиях игрок лежит в playerdata/<uuid>.dat
      const pd = path.join(w.dir, 'playerdata');
      const f = fs.readdirSync(pd).filter(n => /\.dat$/.test(n)).map(n => ({ f: path.join(pd, n), t: mtime(path.join(pd, n)) })).sort((a, b) => b.t - a.t)[0];
      if (f) player = readNbt(unzipAny(fs.readFileSync(f.f)));
    }
    if (player) {
      out.gamemode = typeof player.playerGameType === 'number' ? player.playerGameType : (typeof data.GameType === 'number' ? data.GameType : null);
      out.dim = dimKind(player.Dimension);
      if (Array.isArray(player.Pos) && player.Pos.length === 3) out.pos = player.Pos.map(Number);
      if (typeof player.Health === 'number') out.health = Math.round(player.Health * 10) / 10;
      if (typeof player.foodLevel === 'number') out.food = player.foodLevel;
      if (typeof player.XpLevel === 'number') out.level = player.XpLevel;
      out.riding = !!player.RootVehicle;
      if (Array.isArray(player.Inventory)) {
        const slot = typeof player.SelectedItemSlot === 'number' ? player.SelectedItemSlot : 0;
        const held = player.Inventory.find(i => i.Slot === slot);
        if (held && held.id) out.held = String(held.id).replace(/^minecraft:/, '');
        const chest = player.Inventory.find(i => i.Slot === 102);      // слот нагрудника
        out.elytra = !!(chest && /elytra$/.test(String(chest.id)));
      }
    } else if (typeof data.GameType === 'number') out.gamemode = data.GameType;
    if (out.pos) out.biome = biomeAt(w.dir, out.dim, out.pos[0], out.pos[1], out.pos[2]);
  } catch { /* файл мог быть записан прямо сейчас, в следующий раз получится */ }
  return out;
}

module.exports = { read, _t: { readNbt, biomeAt, dimKind } };
