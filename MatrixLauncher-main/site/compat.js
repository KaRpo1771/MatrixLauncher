/* ============================================================
   ModMatrix, проверка совместимости модов.
   Один движок на всех: подключается в окне (window.Compat) и в ядре
   лаунчера (require). Не зависит ни от DOM, ни от Electron.

   Уровни: error, так игра скорее всего не запустится,
           warn , возможны проблемы, стоит проверить,
           info , просто к сведению.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Compat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LD = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
  const SRC = { modrinth: 'Modrinth', curseforge: 'CurseForge' };
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '');
  const LEVEL_ORDER = { error: 0, warn: 1, info: 2 };

  /* ---------- известные случаи ----------
     Список составлен вручную и не полный: он ловит самые частые проблемы.
     Совпадение идёт по нормализованному slug / названию / id мода.
     conflict, моды нельзя ставить вместе, overlap, делают одно и то же, обычно хватает одного. */
  const RULES = [
    { kind: 'conflict', a: ['optifine', 'optifabric'], b: ['sodium', 'embeddium', 'rubidium', 'iris', 'irisshaders', 'oculus', 'indium'],
      why: 'OptiFine несовместим с Sodium и шейдерными модами (Iris, Oculus), они заменяют одну и ту же часть рендера.' },
    { kind: 'conflict', group: ['sodium', 'rubidium', 'embeddium'],
      why: 'Это один и тот же движок рендера в разных портах, вместе они не работают.' },
    { kind: 'conflict', group: ['iris', 'irisshaders', 'oculus'],
      why: 'Оба мода загружают шейдеры, ставьте только тот, что подходит вашему загрузчику.' },
    { kind: 'conflict', group: ['starlight', 'scalablelux', 'phosphor'],
      why: 'Все три переписывают движок освещения, одновременно они ломают свет в мире.' },
    { kind: 'conflict', group: ['lithium', 'canary', 'radium'],
      why: 'Это порты одного и того же мода оптимизации, нужен только один.' },
    { kind: 'overlap', group: ['xaerosminimap', 'journeymap', 'voxelmap', 'voxelmapupdated'],
      why: 'Несколько мини-карт дублируют друг друга, обычно хватает одной.' },
    { kind: 'overlap', group: ['jei', 'justenoughitems', 'rei', 'roughlyenoughitems', 'emi'],
      why: 'Это просмотрщики рецептов, они дублируют окно предметов друг друга, обычно хватает одного.' }
  ];

  const titleOf = m => (m && (m.title || m.name || m.file || m.slug)) || '?';
  const tokensOf = m => {
    const t = new Set();
    [m.slug, m.title, m.name, String(m.id || '').split(':').pop()].forEach(x => { const n = norm(x); if (n) t.add(n); });
    (m.ids || []).forEach(x => { const n = norm(x); if (n) t.add(n); });
    return [...t];
  };
  const hit = (tokens, list) => tokens.some(t => list.includes(t));

  /* Сверка по списку известных случаев. entries: [{ title, tokens, mark }] */
  function evaluateRules(entries) {
    const out = [];
    for (const r of RULES) {
      if (r.group) {
        const found = entries.filter(e => hit(e.tokens, r.group));
        // один и тот же мод, пришедший из двух источников,, это дубль, а не конфликт разных модов
        const kinds = new Set(found.map(e => r.group.find(g => e.tokens.includes(g))));
        if (found.length > 1 && kinds.size > 1) {
          out.push({ level: r.kind === 'conflict' ? 'error' : 'warn', code: r.kind, title: r.kind === 'conflict' ? 'Конфликт модов' : 'Моды дублируют функции',
            text: r.why, mods: found.map(e => e.title) });
        }
      } else {
        const A = entries.filter(e => hit(e.tokens, r.a)), B = entries.filter(e => hit(e.tokens, r.b));
        if (A.length && B.length) {
          out.push({ level: 'error', code: 'conflict', title: 'Конфликт модов', text: r.why, mods: [...new Set([...A, ...B].map(e => e.title))] });
        }
      }
    }
    return out;
  }

  const loaderOk = (loader, list) => !list || !list.length || list.includes(loader) || (loader === 'quilt' && list.includes('fabric'));
  const expandLoaders = list => { const s = new Set(list); if (s.has('fabric')) s.add('quilt'); return s; };
  function cmpVer(a, b) {
    const x = String(a).split('.').map(n => parseInt(n, 10) || 0), y = String(b).split('.').map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
    return 0;
  }
  const isRelease = v => /^\d+(\.\d+)+$/.test(v);

  /* Проверка набора карточек каталога (избранное / сборка / одиночный мод).
     ctx (необязательно): { mc, loader, name, installed: [{ title, file, slug, projectId }] } -
     установка, в которую собираются ставить. Без неё проверяется только сам набор. */
  function checkCards(items, ctx) {
    ctx = ctx || {};
    const issues = [];
    const add = i => issues.push(i);
    const mods = (items || []).filter(m => m && (m.kind || 'mod') === 'mod');
    const others = (items || []).filter(m => m && (m.kind || 'mod') !== 'mod');
    if (others.length) add({ level: 'info', code: 'skipped', title: 'Не моды', text: 'Плагины и сборки не ставятся в папку модов и в проверке не участвуют.', mods: others.map(titleOf) });

    /* 1. один и тот же мод добавлен дважды (в т.ч. из разных источников) */
    const byName = new Map();
    for (const m of mods) {
      const key = norm(m.title) || m.id;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(m);
    }
    const dupIds = new Set();
    for (const group of byName.values()) {
      const uniq = [...new Map(group.map(m => [m.id, m])).values()];
      if (uniq.length > 1) {
        uniq.forEach(m => dupIds.add(m.id));
        add({ level: 'error', code: 'duplicate', title: 'Один и тот же мод дважды',
          text: `«${titleOf(uniq[0])}» есть в наборе несколько раз (${uniq.map(m => SRC[m.source] || m.source).join(', ')}). Файлы получатся одинаковыми по смыслу, игра не запустится с двумя копиями одного мода. Оставьте одну.`,
          mods: uniq.map(titleOf) });
      }
    }

    /* 2. загрузчик и версия */
    const withLoaders = mods.filter(m => (m.loaders || []).length);
    if (ctx.loader && ctx.loader !== 'vanilla') {
      const bad = withLoaders.filter(m => !loaderOk(ctx.loader, m.loaders));
      if (bad.length) add({ level: 'error', code: 'loader', title: `Не для ${LD[ctx.loader] || ctx.loader}`,
        text: `Эти моды не поддерживают загрузчик установки «${ctx.name || LD[ctx.loader]}» (${LD[ctx.loader] || ctx.loader}): ${bad.map(m => `${titleOf(m)}, ${m.loaders.map(l => LD[l] || l).join('/')}`).join('; ')}.`, mods: bad.map(titleOf) });
    } else if (withLoaders.length > 1) {
      let common = null;
      withLoaders.forEach(m => { const s = expandLoaders(m.loaders); common = common ? new Set([...common].filter(x => s.has(x))) : s; });
      if (common && !common.size) {
        const groups = {};
        withLoaders.forEach(m => m.loaders.forEach(l => { const g = (groups[l] = groups[l] || []); if (!g.includes(titleOf(m))) g.push(titleOf(m)); }));
        add({ level: 'error', code: 'loader', title: 'Нет общего загрузчика',
          text: 'Моды сделаны для разных загрузчиков и вместе не заработают: ' + Object.entries(groups).map(([l, a]) => `${LD[l] || l}, ${a.join(', ')}`).join('; ') + '.',
          mods: withLoaders.map(titleOf) });
      } else if (common) {
        add({ level: 'info', code: 'loader-ok', title: 'Загрузчик', text: 'Подходит для: ' + [...common].map(l => LD[l] || l).join(', ') + '.', mods: [] });
      }
    }
    const withVers = mods.filter(m => (m.versions || []).length);
    if (ctx.mc) {
      const bad = withVers.filter(m => !m.versions.includes(ctx.mc));
      if (bad.length) add({ level: 'warn', code: 'version', title: `Нет версии ${ctx.mc}`,
        text: `У этих модов не заявлена версия Minecraft ${ctx.mc} (установка «${ctx.name || ctx.mc}»): ${bad.map(titleOf).join(', ')}. Лаунчер попробует найти подходящий файл, но он может не найтись.`, mods: bad.map(titleOf) });
    } else if (withVers.length > 1) {
      let common = null;
      withVers.forEach(m => { const s = new Set(m.versions); common = common ? new Set([...common].filter(x => s.has(x))) : s; });
      if (common && !common.size) {
        const cnt = new Map();
        withVers.forEach(m => m.versions.filter(isRelease).forEach(v => cnt.set(v, (cnt.get(v) || 0) + 1)));
        const best = [...cnt.entries()].sort((a, b) => b[1] - a[1] || cmpVer(b[0], a[0]))[0];
        add({ level: 'warn', code: 'version', title: 'Нет общей версии Minecraft',
          text: `Ни одна версия игры не подходит всем модам сразу.${best ? ` Больше всего подходит ${best[0]} (${best[1]} из ${withVers.length}).` : ''} Моды, которым не хватило, придётся заменить или убрать.`, mods: withVers.map(titleOf) });
      } else if (common) {
        const list = [...common].filter(isRelease).sort((a, b) => cmpVer(b, a)).slice(0, 5);
        if (list.length) add({ level: 'info', code: 'version-ok', title: 'Версии игры', text: 'Общие версии Minecraft: ' + list.join(', ') + '.', mods: [] });
      }
    }

    /* 3. известные конфликты внутри набора и с уже установленными модами */
    const entries = mods.map(m => ({ title: titleOf(m), tokens: tokensOf(m), mark: 'new' }));
    const inst = (ctx.installed || []).map(i => ({ title: (i.title && i.title !== i.file ? i.title : i.file) + ' (уже установлен)', tokens: tokensOf({ slug: i.slug, title: i.title, ids: [String(i.projectId || '').replace(/^cf:/, '')].concat(String(i.file || '').split(/[-_+0-9]/)[0]) }), mark: 'old' }));
    evaluateRules(entries.concat(inst)).forEach(add);

    /* 4. уже есть в установке */
    if ((ctx.installed || []).length) {
      const have = mods.filter(m => (ctx.installed || []).some(i => (i.slug && i.slug === m.slug) || (i.projectId && String(i.projectId).replace(/^cf:/, '') === String(m.id || '').split(':').pop()) || (i.title && norm(i.title) === norm(m.title))));
      if (have.length) add({ level: 'warn', code: 'installed', title: 'Уже установлено',
        text: 'Эти моды уже есть в выбранной установке, повторно они не продублируются, файл будет заменён более подходящей версией или оставлен как есть: ' + have.map(titleOf).join(', ') + '.', mods: have.map(titleOf) });
    }
    return sortIssues(issues);
  }

  const sortIssues = list => list.map((x, i) => [x, i]).sort((a, b) => LEVEL_ORDER[a[0].level] - LEVEL_ORDER[b[0].level] || a[1] - b[1]).map(x => x[0]);
  const worst = list => (list || []).reduce((w, i) => (w === null || LEVEL_ORDER[i.level] < LEVEL_ORDER[w] ? i.level : w), null);
  const count = list => ({ error: 0, warn: 0, info: 0, ...(list || []).reduce((c, i) => (c[i.level] = (c[i.level] || 0) + 1, c), {}) });

  return { checkCards, evaluateRules, sortIssues, worst, count, norm, loaderOk, tokensOf, LD_NAME: l => LD[l] || l, RULES };
});
