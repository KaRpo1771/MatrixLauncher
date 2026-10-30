'use strict';
/* ============================================================
   Игровые аккаунты Minecraft. Регистрации в самом лаунчере нет -
   только вход в нужный игровой аккаунт:
     • Ely.by   , скины и серверы Ely.by (через authlib-injector);
     • Microsoft, лицензионный аккаунт (вход через браузер, код + PKCE);
     • обычный  , «оффлайн», по нику.
   Токены хранятся зашифрованными (DPAPI/Keychain через Electron safeStorage).
   ============================================================ */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'ModMatrix-Launcher/1.0';
let FILE = null;
let SETTINGS = null;

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

/* ---------- хранилище ---------- */
function init(dir) {
  FILE = path.join(dir, 'accounts.json');
  SETTINGS = path.join(dir, 'settings.json');
  migrate(dir);
}

/* Переносим игровые аккаунты из прежней версии (там они лежали внутри «аккаунтов лаунчера») */
function migrate(dir) {
  const old = path.join(dir, 'users.json');
  if (!fs.existsSync(FILE) && fs.existsSync(old)) {
    const users = readJson(old, []);
    const accounts = [];
    let selected = null;
    for (const u of users) {
      for (const a of u.mc || []) if (!accounts.some(x => x.id === a.id)) accounts.push(a);
      if (!selected && u.selectedMc && accounts.some(x => x.id === u.selectedMc)) selected = u.selectedMc;
    }
    writeJson(FILE, { accounts, selected: selected || (accounts[0] && accounts[0].id) || null });
  }
  const st = readJson(SETTINGS, null);
  if (st && 'session' in st) { delete st.session; writeJson(SETTINGS, st); }
}

const load = () => { const d = readJson(FILE, null) || {}; return { accounts: Array.isArray(d.accounts) ? d.accounts : [], selected: d.selected || null }; };
const save = d => writeJson(FILE, d);
function mutate(fn) { const d = load(); const r = fn(d); save(d); return r; }
const pub = (a, sel) => ({ id: a.id, type: a.type, name: a.name, uuid: a.uuid, selected: a.id === sel });
const view = d => d.accounts.map(a => pub(a, d.selected));

function getSettings() { return readJson(SETTINGS, {}); }
function setSettings(patch) {
  const cur = getSettings();
  for (const k of ['msClientId']) if (patch && k in patch) cur[k] = String(patch[k] || '').trim();
  if (patch && 'discordEnabled' in patch) cur.discordEnabled = !!patch.discordEnabled;
  // ключ CurseForge хранится зашифрованным и в интерфейс не отдаётся
  if (patch && 'curseforgeKey' in patch) {
    const key = String(patch.curseforgeKey || '').trim();
    if (key && !/^[\x21-\x7e]{20,200}$/.test(key)) throw new Error('Ключ CurseForge выглядит неверно: это одна строка без пробелов');
    if (key) cur.curseforgeKey = seal(key); else delete cur.curseforgeKey;
  }
  writeJson(SETTINGS, cur);
  return publicSettings();
}
function publicSettings() {
  const { curseforgeKey, ...rest } = getSettings();
  return { ...rest, curseforgeKeySet: !!curseforgeKey, msBuiltIn: !!MS_BUILTIN };
}
function getCurseKey() { const k = getSettings().curseforgeKey; try { return k ? unseal(k) : null; } catch { return null; } }

/* ---------- шифрование токенов ---------- */
function seal(text) {
  try {
    const { safeStorage } = require('electron');
    if (safeStorage && safeStorage.isEncryptionAvailable()) return 'e:' + safeStorage.encryptString(text).toString('base64');
  } catch { /* вне Electron, храним как есть */ }
  return 'p:' + Buffer.from(text, 'utf8').toString('base64');
}
function unseal(s) {
  if (!s) return null;
  const kind = s.slice(0, 2), data = s.slice(2);
  if (kind === 'e:') { const { safeStorage } = require('electron'); return safeStorage.decryptString(Buffer.from(data, 'base64')); }
  return Buffer.from(data, 'base64').toString('utf8');
}

/* ---------- список и выбор ---------- */
const list = () => view(load());
function select(id) {
  return mutate(d => { if (!d.accounts.some(a => a.id === id)) throw new Error('Аккаунт не найден'); d.selected = id; return view(d); });
}
function remove(id) {
  return mutate(d => {
    d.accounts = d.accounts.filter(a => a.id !== id);
    if (d.selected === id) d.selected = d.accounts[0] ? d.accounts[0].id : null;
    return view(d);
  });
}

/* ---------- обычный (оффлайн) аккаунт ---------- */
function offlineUuid(name) {
  const h = crypto.createHash('md5').update('OfflinePlayer:' + name).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
function addOffline(name) {
  name = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Ник Minecraft: 3–16 символов, латиница, цифры, _');
  return mutate(d => {
    if (d.accounts.some(a => a.type === 'offline' && a.name.toLowerCase() === name.toLowerCase())) throw new Error('Такой аккаунт уже добавлен');
    const acc = { id: crypto.randomUUID(), type: 'offline', name, uuid: offlineUuid(name) };
    d.accounts.push(acc); d.selected = acc.id;
    return view(d);
  });
}

/* ---------- Ely.by (Yggdrasil-совместимый сервер) ---------- */
const ELY = 'https://authserver.ely.by/auth';
async function elyPost(endpoint, body) {
  const r = await fetch(ELY + endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA }, body: JSON.stringify(body)
  });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}
function elyError(r) {
  const m = String(r.json.errorMessage || '');
  if (/two factor/i.test(m)) return new Error('На аккаунте включена двухфакторная защита: введите пароль в виде «пароль:код» (код из приложения-аутентификатора).');
  if (/invalid credentials/i.test(m)) return new Error('Неверный email/ник или пароль Ely.by');
  if (/too many|rate/i.test(m) || r.status === 429) return new Error('Слишком много попыток входа, подождите минуту');
  return new Error('Ely.by: ' + (m || `ошибка ${r.status}`));
}

async function elyLogin({ login, password }) {
  login = String(login || '').trim();
  password = String(password || '');
  if (!login || !password) throw new Error('Введите email или ник и пароль от Ely.by');
  const clientToken = crypto.randomUUID().replace(/-/g, '');
  const r = await elyPost('/authenticate', { username: login, password, clientToken, requestUser: false });
  if (!r.ok) throw elyError(r);
  const prof = r.json.selectedProfile || (r.json.availableProfiles || [])[0];
  if (!prof) throw new Error('На этом аккаунте Ely.by нет игрового профиля');
  return mutate(d => {
    let acc = d.accounts.find(a => a.type === 'ely' && a.uuid === prof.id);
    if (!acc) { acc = { id: crypto.randomUUID(), type: 'ely', uuid: prof.id }; d.accounts.push(acc); }
    acc.name = prof.name;
    acc.access = seal(r.json.accessToken);
    acc.clientToken = r.json.clientToken || clientToken;
    d.selected = acc.id;
    return view(d);
  });
}

/* ---------- Microsoft ---------- */
const MS = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPE = 'XboxLive.signin offline_access';

async function postForm(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data) });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}
async function postJson(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  return { ok: r.ok, status: r.status, json: await r.json().catch(() => ({})) };
}
const XSTS_ERRORS = {
  2148916233: 'У этой учётной записи Microsoft нет профиля Xbox. Создайте его на xbox.com и повторите.',
  2148916235: 'Xbox Live недоступен в вашей стране.',
  2148916236: 'Для аккаунта требуется подтверждение возраста на сайте Xbox.',
  2148916237: 'Для аккаунта требуется подтверждение возраста на сайте Xbox.',
  2148916238: 'Детский аккаунт Microsoft: добавьте его в семейную группу и разрешите онлайн-игру.'
};
async function xboxChain(msAccessToken) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: 'd=' + msAccessToken },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
  });
  if (!xbl.ok) throw new Error('Не удалось войти в Xbox Live (' + xbl.status + ')');
  const xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.json.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT'
  });
  if (!xsts.ok) throw new Error(XSTS_ERRORS[xsts.json.XErr] || 'Xbox отклонил вход (' + (xsts.json.XErr || xsts.status) + ')');
  const uhs = xsts.json.DisplayClaims.xui[0].uhs;
  const mc = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${uhs};${xsts.json.Token}` });
  if (!mc.ok) throw new Error('Minecraft Services отклонил вход (' + mc.status + '). Скорее всего, приложение Azure ещё не одобрено Mojang (форма aka.ms/AppRegInfo).');
  const pr = await fetch('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: 'Bearer ' + mc.json.access_token } });
  if (pr.status === 404) throw new Error('На этом аккаунте Microsoft нет Minecraft: Java Edition.');
  if (!pr.ok) throw new Error('Не удалось получить профиль Minecraft (' + pr.status + ')');
  return { mcToken: mc.json.access_token, profile: await pr.json() };
}
async function msRefresh(clientId, refreshToken) {
  if (!clientId) throw new Error('Не указан Client ID приложения Microsoft (Аккаунты → настройка входа через Microsoft)');
  if (!refreshToken) throw new Error('Нет сохранённого входа Microsoft, войдите заново');
  const t = await postForm(MS + '/token', { client_id: clientId, grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPE });
  if (!t.ok) throw new Error('Сессия Microsoft истекла, войдите заново');
  const x = await xboxChain(t.json.access_token);
  return { ...x, refresh: t.json.refresh_token || refreshToken };
}
const MS_BUILTIN = (() => { try { return require('./ms-app'); } catch { return ''; } })();
function msClientId() { return String(getSettings().msClientId || MS_BUILTIN || '').trim(); }

const esc = x => String(x).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const PAGE = (ok, text) => `<!doctype html><html lang="ru"><meta charset="utf-8"><title>MatrixL</title><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#0b0b0b;color:#f2f2f2;font:16px system-ui,sans-serif"><div style="text-align:center;max-width:420px;padding:24px"><div style="font-size:42px">${ok ? '✓' : '✕'}</div><h1 style="font-size:22px;margin:8px 0">${ok ? 'Вход выполнен' : 'Не удалось войти'}</h1><p style="color:#aaa;margin:0">${esc(text)}</p></div></body></html>`;
let msPending = null;   // { close }
function msCancel() { if (msPending) { msPending.close(new Error('Вход отменён')); msPending = null; } }

/* Вход как в обычных лаунчерах: открывается страница Microsoft в браузере, пользователь вводит логин и пароль,
   Microsoft возвращает код на локальный адрес лаунчера, дальше лаунчер входит сам. */
async function msStart() {
  const clientId = msClientId();
  if (!clientId) throw new Error('Не задан ID приложения Microsoft. Укажите его в настройках входа или впишите в src/ms-app.js');
  msCancel();
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  const http = require('http');

  let settle;
  const result = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const servers = [];
  let held = null;
  const respond = (ok, text) => { if (held && !held.writableEnded) held.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE(ok, text)); held = null; };
  const handler = (req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname !== '/') { res.writeHead(404).end(); return; }
    const err = u.searchParams.get('error');
    if (err) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE(false, 'Можно закрыть эту вкладку и попробовать снова в лаунчере.'));
      settle.reject(new Error(err === 'access_denied' ? 'Вход отклонён' : (u.searchParams.get('error_description') || err))); return;
    }
    if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) { res.writeHead(400).end(); return; }
    held = res;   // ответ браузеру отправим, когда лаунчер закончит вход (иначе ошибка останется незамеченной)
    settle.resolve(u.searchParams.get('code'));
  };
  const first = http.createServer(handler);
  await new Promise((ok, no) => { first.once('error', no); first.listen(0, '127.0.0.1', ok); });
  servers.push(first);
  const port = first.address().port;
  try {   // localhost может указывать на ::1, поэтому слушаем и его (только локальный адрес)
    const v6 = http.createServer(handler);
    await new Promise((ok, no) => { v6.once('error', no); v6.listen(port, '::1', ok); });
    servers.push(v6);
  } catch { /* IPv6 недоступен, это нормально */ }

  const redirect = `http://localhost:${port}`;
  const url = `${MS}/authorize?` + new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: redirect, scope: SCOPE, state,
    code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account'
  });
  const timer = setTimeout(() => settle.reject(new Error('Время ожидания входа истекло')), 5 * 60 * 1000);
  const close = err => { clearTimeout(timer); for (const sv of servers) { try { sv.close(); setTimeout(() => { try { sv.closeAllConnections?.(); } catch {} }, 2000); } catch {} } if (err) settle.reject(err); };
  msPending = { close };

  const wait = async () => {
    try {
      const code = await result;
      const t = await postForm(MS + '/token', { client_id: clientId, grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: verifier, scope: SCOPE });
      if (!t.ok) throw new Error('Microsoft: ' + String(t.json.error_description || t.json.error || t.status).split('\r')[0].slice(0, 300));
      const x = await xboxChain(t.json.access_token);
      const out = mutate(d => {
        let acc = d.accounts.find(m => m.type === 'microsoft' && m.uuid === x.profile.id);
        if (!acc) { acc = { id: crypto.randomUUID(), type: 'microsoft', uuid: x.profile.id }; d.accounts.push(acc); }
        acc.name = x.profile.name;
        acc.refresh = seal(t.json.refresh_token);
        d.selected = acc.id;
        return view(d);
      });
      respond(true, `Аккаунт ${x.profile.name} добавлен. Можно закрыть эту вкладку и вернуться в лаунчер.`);
      return out;
    } catch (e) {
      respond(false, e.message);
      throw e;
    } finally { close(); if (msPending && msPending.close === close) msPending = null; }
  };
  return { info: { url }, wait };
}

/* ---------- данные выбранного аккаунта для запуска ---------- */
async function accountForLaunch() {
  const d = load();
  const acc = d.accounts.find(a => a.id === d.selected);
  if (!acc) throw new Error('Выберите или добавьте игровой аккаунт Minecraft');
  if (acc.type === 'offline') return { type: 'offline', name: acc.name, uuid: acc.uuid, token: '0' };

  if (acc.type === 'ely') {
    const r = await elyPost('/refresh', { accessToken: unseal(acc.access), clientToken: acc.clientToken, requestUser: false });
    if (!r.ok) throw new Error('Сессия Ely.by истекла, войдите заново (Аккаунты → Ely.by)');
    const prof = r.json.selectedProfile || { id: acc.uuid, name: acc.name };
    mutate(x => {
      const a = x.accounts.find(m => m.id === acc.id);
      if (a) { a.access = seal(r.json.accessToken); a.clientToken = r.json.clientToken || a.clientToken; a.name = prof.name; }
    });
    return { type: 'ely', name: prof.name, uuid: prof.id, token: r.json.accessToken };
  }

  const r = await msRefresh(msClientId(), unseal(acc.refresh));
  mutate(x => { const a = x.accounts.find(m => m.id === acc.id); if (a) { a.refresh = seal(r.refresh); a.name = r.profile.name; } });
  return { type: 'microsoft', name: r.profile.name, uuid: r.profile.id, token: r.mcToken };
}

module.exports = {
  init, getSettings, setSettings, publicSettings, getCurseKey,
  list, select, remove, addOffline, elyLogin, msStart, msCancel, accountForLaunch,
  _t: { offlineUuid, seal, unseal, elyError, migrate }
};
