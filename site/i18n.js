/* ============================================================
   MatrixL, язык интерфейса (RU / ENG).
   Русский текст остаётся в коде как исходный; при выбранном ENG
   этот модуль переводит его на лету по словарю: и то, что уже на
   странице, и то, что появится позже (окна, уведомления).
   Выбор хранится в localStorage; смена языка перезагружает окно.
   ============================================================ */
(function () {
  'use strict';
  const KEY = 'matrixl:ui-lang';
  let lang = 'ru';
  try { lang = localStorage.getItem(KEY) === 'en' ? 'en' : 'ru'; } catch (e) { /* без хранилища */ }
  document.documentElement.lang = lang;

  /* Короткие слова переводятся только при полном совпадении текста,
     длинные фразы ещё и внутри строки (для строк с подстановками). */
  const D = {
    'Заголовок окна': 'Window title', 'Свернуть': 'Minimize', 'Свернуть окно': 'Minimize window', 'Развернуть': 'Maximize', 'Развернуть окно': 'Maximize window', 'Закрыть': 'Close',
    'Главная': 'Home', 'Моды': 'Mods', 'Плагины': 'Plugins', 'Сборки': 'Modpacks', 'Избранное': 'Favorites', 'Настройки': 'Settings',
    'Настройки экземпляра': 'Instance settings', 'Прокрутка страницы': 'Page scroll',
    'Язык интерфейса': 'Interface language', 'Язык лаунчера: русский или английский.': 'Launcher language: Russian or English.',
    'Цветовая тема': 'Color theme', 'Фон всегда тёмный, меняется только цвет акцентов.': 'The background is always dark; only the accent color changes.',
    'Настройки хранятся на этом компьютере и на данные модов не влияют.': 'Settings are stored on this computer and do not affect mod data.',
    'Перевод описаний': 'Description translation',
    'Не переводить, оставить оригинал': "Don't translate, keep the original",
    'Описания модов и плагинов из Modrinth/CurseForge/Hangar/SpigotMC чаще всего на английском, поэтому мы переводим их автоматически.': 'Mod and plugin descriptions from Modrinth/CurseForge/Hangar/SpigotMC are mostly in English, so we translate them automatically.',
    'Сортировка по умолчанию': 'Default sorting', 'Применяется при открытии «Модов», «Плагинов» и «Сборок».': 'Applied when opening Mods, Plugins and Modpacks.',
    'По загрузкам': 'By downloads', 'По релевантности': 'By relevance', 'По подписчикам': 'By followers', 'По дате обновления': 'By update date', 'Сначала новые': 'Newest first',
    'Очистить избранное': 'Clear favorites', 'Очистить избранное?': 'Clear favorites?', 'Все сохранённые карточки будут удалены.': 'All saved cards will be removed.', 'Удалить всё': 'Delete all', 'Очистить всё': 'Clear all',
    'Статус в Discord': 'Discord status', 'Показывать статус в Discord': 'Show status in Discord',
    'В вашем профиле Discord будет видно, что вы делаете в лаунчере: выбираете моды, устанавливаете сборку или играете.': 'Your Discord profile will show what you do in the launcher: browsing mods, installing a modpack or playing.',
    'Загружаю…': 'Loading…', 'Выключено, в профиле ничего не показывается.': 'Off, nothing is shown in your profile.',
    'Об источниках': 'About sources', 'MatrixL не ведёт свой каталог. Все данные приходят напрямую с площадок при каждом запросе.': 'MatrixL has no catalog of its own. All data comes straight from the platforms on every request.',
    'Статус в Discord включён': 'Discord status enabled', 'Статус в Discord выключен': 'Discord status disabled',
    'Играть': 'Play', 'Запустить': 'Launch', 'Создать экземпляр': 'Create instance', 'Создать установку': 'Create installation', 'Удалить установку': 'Delete installation', 'Переименовать': 'Rename',
    'Установок пока нет': 'No installations yet', 'Новости Minecraft': 'Minecraft news', 'Все новости ↗': 'All news ↗', 'Читать ↗': 'Read ↗',
    'Войти в аккаунт': 'Sign in', 'Добавить аккаунт': 'Add account', 'Добавить обычный аккаунт': 'Add offline account',
    'Войти через Ely.by': 'Sign in with Ely.by', 'Войти через Microsoft': 'Sign in with Microsoft', 'Зарегистрироваться на ely.by': 'Sign up on ely.by',
    'Не удалось войти': 'Sign-in failed', 'Отменить вход': 'Cancel sign-in', 'Пароль': 'Password', 'Email или ник Ely.by': 'Email or Ely.by username',
    'Ник (3–16 символов, латиница, цифры, _)': 'Username (3–16 chars, Latin letters, digits, _)',
    'Аккаунтов пока нет. Войдите через Ely.by, чтобы в игре были скины, либо добавьте другой аккаунт.': 'No accounts yet. Sign in with Ely.by to get skins in game, or add another account.',
    'Войдите на странице Microsoft': 'Sign in on the Microsoft page',
    'Откроется страница Microsoft, где нужно ввести логин и пароль. Нужен лицензионный аккаунт Minecraft: Java Edition.': 'A Microsoft page will open where you enter your login and password. A licensed Minecraft: Java Edition account is required.',
    'Страница входа открыта в браузере. Введите логин и пароль, после этого лаунчер войдёт в аккаунт сам.': 'The sign-in page is open in your browser. Enter your login and password and the launcher will sign in automatically.',
    'Если включена двухфакторная защита, введите пароль в виде «пароль:код» (код из приложения-аутентификатора).': 'If two-factor protection is on, enter the password as "password:code" (code from the authenticator app).',
    '«Оффлайн»: игра запускается с выбранным ником без проверки лицензии и без скинов. Не работает на серверах с онлайн-режимом.': 'Offline: the game starts with the chosen username without license check and without skins. Does not work on online-mode servers.',
    'Войдите через Ely.by, и в игре и на серверах Ely.by будет ваш скин. Нет аккаунта?': 'Sign in with Ely.by to have your skin in game and on Ely.by servers. No account?',
    'Обычный аккаунт': 'Offline account', 'Аватарка': 'Avatar',
    'Название': 'Name', 'Версия Minecraft': 'Minecraft version', 'Версии игры': 'Game versions', 'Версия загрузчика': 'Loader version', 'Загрузчик': 'Loader', 'Загрузчик модов': 'Mod loader', 'Загрузчики': 'Loaders',
    'Любая версия': 'Any version', 'Нет версий': 'No versions', 'Загружаю версии…': 'Loading versions…', 'Загружаю список…': 'Loading list…', 'Загружаю подробности…': 'Loading details…',
    'Выберите версию Minecraft и загрузчик модов, остальное лаунчер скачает сам.': 'Pick a Minecraft version and a mod loader; the launcher downloads the rest.',
    'Скачиваются клиент игры, библиотеки, ресурсы, Java и загрузчик. Forge и NeoForge ставятся официальным установщиком, поэтому это занимает больше времени.': 'The game client, libraries, assets, Java and the loader are downloaded. Forge and NeoForge use the official installer, so it takes longer.',
    'Показывать снапшоты': 'Show snapshots', 'Скачать версию Minecraft': 'Download Minecraft version',
    'Установить OptiFine': 'Install OptiFine', 'Установить OptiFine вместе с экземпляром (нужен Forge)': 'Install OptiFine with the instance (requires Forge)',
    'Выберите версию Minecraft, и здесь появятся доступные сборки OptiFine.': 'Pick a Minecraft version and available OptiFine builds will appear here.',
    'Применить загрузчик': 'Apply loader', 'Папка игры': 'Game folder', 'Папка модов': 'Mods folder', 'Папка скриншотов': 'Screenshots folder',
    'Фон главной страницы': 'Home page background', 'Своё изображение': 'Custom image', 'Добавить изображение…': 'Add image…', 'Убрать изображение': 'Remove image', 'Без изображения (цвет темы)': 'No image (theme color)',
    'Смена скриншотов': 'Screenshot rotation', 'Скриншоты этого экземпляра': 'This instance screenshots',
    'Скриншоты берутся только из папки этого экземпляра. Снимки из других установок на фон не попадут.': 'Screenshots are taken only from this instance folder. Shots from other installations will not be used as background.',
    'Моды в этой установке': 'Mods in this installation', 'Проверить совместимость': 'Check compatibility', 'Проверка совместимости': 'Compatibility check',
    'Конфликтов не найдено': 'No conflicts found', 'Проверяю файлы в папке mods…': 'Checking files in the mods folder…', 'В папке mods пока нет файлов, проверять нечего.': 'The mods folder has no files yet, nothing to check.',
    'Модов пока нет.': 'No mods yet.', 'Технические детали': 'Technical details', 'Журнал': 'Log',
    'Моды в папке mods останутся на месте. Проверьте, что они подходят выбранному загрузчику.': 'Mods in the mods folder will stay. Make sure they suit the selected loader.',
    'Список обновляется сразу, если вы добавляете или удаляете файлы в папке модов. Чтобы поставить мод из каталога, откройте раздел «Моды» и нажмите «Установить в Minecraft».': 'The list updates instantly when you add or remove files in the mods folder. To install a mod from the catalog, open Mods and click "Install to Minecraft".',
    'Установить': 'Install', 'Установить в Minecraft': 'Install to Minecraft', 'Скачать': 'Download', 'Скачать обычно': 'Download normally', 'Скачать и установить': 'Download and install',
    'Скачивание началось': 'Download started', 'Отменить скачивание': 'Cancel download', 'Подготовка…': 'Preparing…', 'Все моды установлены.': 'All mods installed.',
    'Мод и обязательные зависимости скачаются в папку mods выбранной установки.': 'The mod and required dependencies will be downloaded into the mods folder of the selected installation.',
    'Файл скачивается прямо в папку mods этого экземпляра.': 'The file is downloaded straight into the mods folder of this instance.',
    'В какой экземпляр установить': 'Which instance to install into', 'Куда добавить?': 'Add to where?',
    'Нет установок с загрузчиком модов.': 'No installations with a mod loader.', 'Нет установок с загрузчиком модов. Создайте экземпляр с Fabric, Quilt, Forge или NeoForge.': 'No installations with a mod loader. Create an instance with Fabric, Quilt, Forge or NeoForge.',
    'Установить из файла (.mrpack или .zip)…': 'Install from file (.mrpack or .zip)…', 'Установить как экземпляр': 'Install as instance', 'Установить сборку': 'Install modpack',
    'Есть готовая сборка?': 'Have a ready modpack?', 'Готовые модпаки с Modrinth': 'Ready modpacks from Modrinth',
    'Лаунчер скачает нужную версию Minecraft и загрузчик, затем все файлы сборки. Это может занять несколько минут.': 'The launcher downloads the required Minecraft version and loader, then all modpack files. This may take a few minutes.',
    'Окно можно закрыть, установка продолжится в фоне. Прогресс виден в плашке «Загрузки» справа.': 'You can close this window; installation continues in the background. Progress is shown in the Downloads panel on the right.',
    'Будет создан новый экземпляр: нужная версия Minecraft, загрузчик, моды и настройки сборки.': 'A new instance will be created: the right Minecraft version, loader, mods and modpack settings.',
    'Нет доступных файлов сборки': 'No modpack files available', 'Загрузки': 'Downloads', 'Загрузок': 'Downloads',
    'Не скачано модов': 'Mods not downloaded', 'Авторы части модов запрещают скачивание сторонними лаунчерами. Скачайте их вручную с CurseForge и положите в папку mods экземпляра («Настройки экземпляра» → «Папка модов»).': 'Some mod authors forbid downloads by third-party launchers. Download them manually from CurseForge and put them into the instance mods folder (Instance settings → Mods folder).',
    'Здесь лежат сохранённые вами карточки. Собирайте из них свои сборки и проверяйте, подходят ли моды друг к другу.': 'Your saved cards live here. Build your own modpacks from them and check that the mods work together.',
    'Сохранённые вами карточки': 'Your saved cards', 'Основное избранное': 'Main favorites', 'Карточки': 'Cards', 'Список': 'List',
    'Нажмите ★ на любой карточке в «Модах», «Плагинах» или «Сборках», чтобы добавить сюда.': 'Click ★ on any card in Mods, Plugins or Modpacks to add it here.',
    'Пока пусто': 'Nothing here yet', 'В сборке пока пусто': 'This modpack is empty', 'Сборок пока нет': 'No modpacks yet',
    'Сборка это ваш набор модов. Его можно проверить на совместимость и установить в Minecraft одной кнопкой. Введите название и нажмите «Создать сборку», моды можно добавить позже.': 'A modpack is your set of mods. You can check it for compatibility and install it into Minecraft with one button. Enter a name and click "Create modpack"; mods can be added later.',
    '＋ Создать сборку': '＋ Create modpack', '＋ Создать и добавить': '＋ Create and add', 'Удалить сборку': 'Delete modpack', 'Без сборки': 'No modpack',
    'Результаты': 'Results', 'Ничего не нашлось': 'Nothing found', 'Попробуйте другое слово или сбросьте фильтры.': 'Try another word or reset the filters.', 'Сбросить фильтры': 'Reset filters', 'Сбросить': 'Reset',
    'Только Modrinth': 'Modrinth only', 'Только CurseForge': 'CurseForge only', 'Только Hangar': 'Hangar only', 'Только SpigotMC': 'SpigotMC only', 'Оба источника': 'Both sources',
    'Клиентские моды: Fabric, Forge, NeoForge, Quilt': 'Client mods: Fabric, Forge, NeoForge, Quilt', 'Серверные плагины Paper и Spigot': 'Paper and Spigot server plugins',
    'Категории работают только для Hangar.': 'Categories work only for Hangar.', 'Категория:': 'Category:', 'Источник:': 'Source:', 'Загрузчик:': 'Loader:', 'Показывать:': 'Show:',
    'Подписчиков': 'Followers', 'Модов': 'Mods', 'Лицензия': 'License', 'Исходный код': 'Source code', 'Баг-трекер': 'Bug tracker', 'Вики': 'Wiki',
    'Подробности не загрузились': 'Details failed to load', 'Не получилось загрузить актуальные данные': "Couldn't load fresh data", 'Попробуйте открыть источник напрямую.': 'Try opening the source directly.',
    'Подробности доступны только при живом подключении к источникам.': 'Details are available only with a live connection to the sources.',
    'Этот источник не даёт прямую ссылку на файл. Скачайте мод через кнопку «Открыть страницу мода» выше.': 'This source gives no direct file link. Download the mod with the "Open mod page" button above.',
    'Открыть страницу мода': 'Open mod page', 'В избранное': 'Add to favorites', 'Убрать': 'Remove', 'Выбрать': 'Select',
    'Нет связи с серверами Mojang': 'Cannot reach Mojang servers', 'Не получилось:': 'Failed:', 'Аккаунты и лаунчер доступны в приложении': 'Accounts and launcher are available in the app',
    'Новый': 'New', 'Ваш компьютер:': 'Your computer:', '(рекомендуется': '(recommended', 'ГБ)': 'GB)', 'ГБ': 'GB',
    'Сохранить': 'Save', 'Сохранено': 'Saved', 'Отмена': 'Cancel', 'Ок': 'OK', 'Подтвердить': 'Confirm', 'Подтвердите действие': 'Confirm the action', 'Перейти на стр.': 'Go to page',
    'Янтарная': 'Amber', 'Зелёная': 'Green', 'Чёрно-белая': 'Monochrome', 'Синяя': 'Blue', 'Фиолетовая': 'Purple', 'Розовая': 'Pink', 'Снимок': 'Snapshot',
    'Копировать': 'Copy', 'Назад': 'Back', 'Далее': 'Next', 'Удалить': 'Delete'
  };
  const SHORT = 14;   // записи короче этого переводятся только при полном совпадении
  const exact = new Map(Object.entries(D));
  const longList = Object.keys(D).filter(k => k.length > SHORT).sort((a, b) => b.length - a.length);
  const HAS_RU = /[А-Яа-яЁё]/;

  function tr(str) {
    const t = str.trim();
    if (!t || !HAS_RU.test(t)) return str;
    const lead = str.slice(0, str.indexOf(t)), trail = str.slice(str.indexOf(t) + t.length);
    if (exact.has(t)) return lead + exact.get(t) + trail;
    let out = t;
    for (const k of longList) if (out.includes(k)) out = out.split(k).join(D[k]);
    return out === t ? str : lead + out + trail;
  }

  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function fixNode(n) {
    if (n.nodeType === 3) {
      const p = n.parentNode;
      if (p && (p.nodeName === 'SCRIPT' || p.nodeName === 'STYLE' || p.nodeName === 'TEXTAREA')) return;
      const v = tr(n.nodeValue); if (v !== n.nodeValue) n.nodeValue = v;
    } else if (n.nodeType === 1) {
      if (n.nodeName === 'SCRIPT' || n.nodeName === 'STYLE') return;
      for (const a of ATTRS) { if (n.hasAttribute(a)) { const o = n.getAttribute(a), v = tr(o); if (v !== o) n.setAttribute(a, v); } }
      n.childNodes.forEach(fixNode);
    }
  }

  function start() {
    fixNode(document.body);
    new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') fixNode(m.target);
        else if (m.type === 'attributes') fixNode(m.target);
        else m.addedNodes.forEach(fixNode);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  window.I18N = {
    lang: () => lang,
    set(v) { try { localStorage.setItem(KEY, v === 'en' ? 'en' : 'ru'); } catch (e) { /* без хранилища */ } location.reload(); },
    t: tr
  };
  if (lang === 'en') {
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }
})();
