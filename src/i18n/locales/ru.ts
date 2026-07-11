import type { Translation } from './en';

// Russian. Shape is enforced against en.ts via the `Translation` annotation —
// a missing or misspelled key is a compile error, not a silent fallback.
export const ru: Translation = {
  language: {
    label: 'Язык',
    en: 'Английский',
    ru: 'Русский',
    uz: 'Узбекский',
  },
  theme: {
    label: 'Цветовая тема',
    light: 'Светлая',
    dark: 'Тёмная',
    system: 'Системная',
  },
  roles: {
    admin: 'Администратор',
    operator: 'Оператор',
    viewer: 'Наблюдатель',
    advertiser: 'Рекламодатель',
  },
  nav: {
    dashboard: 'Панель',
    myContent: 'Мой контент',
    incidents: 'Инциденты',
    events: 'События',
    reports: 'Отчёты',
    playbackReport: 'Отчёт о воспроизведении',
    devices: 'Устройства',
    syncGroups: 'Группы синхронизации',
    content: 'Контент',
    playlists: 'Плейлисты',
    users: 'Пользователи',
    settings: 'Настройки',
  },
  settingsNav: {
    heading: 'Настройки',
    sectionsLabel: 'Разделы настроек',
    projects: 'Проекты',
    regions: 'Регионы',
    facilities: 'Объекты',
    deviceGroups: 'Группы устройств',
    syncGroups: 'Группы синхронизации',
  },
  topbar: {
    primaryNav: 'Основная навигация',
    brand: 'Orient Advertise',
    account: 'Аккаунт',
    logout: 'Выйти',
    openMenu: 'Открыть меню',
    closeMenu: 'Закрыть меню',
  },
  login: {
    title: 'Вход',
    ariaLabel: 'Вход в систему',
    username: 'Имя пользователя',
    password: 'Пароль',
    signIn: 'Войти',
    signingIn: 'Вход…',
    forgotPassword: 'Забыли пароль?',
    errorInvalid: 'Неверное имя пользователя или пароль.',
    errorRateLimited: 'Слишком много попыток входа. Подождите немного и попробуйте снова.',
  },
  dashboard: {
    title: 'Панель управления',
    signedInAs: 'Вы вошли как <0>{{name}}</0> ({{role}})',
    updated: 'Обновлено {{time}}',
    showingStale: 'Показаны данные на {{time}} — обновить не удалось',
    couldNotLoad: 'Не удалось загрузить данные',
    stats: {
      totalDevices: 'Всего устройств',
      onlineNow: 'Сейчас в сети',
      offline: 'Не в сети',
      openIncidents: 'Открытые инциденты',
    },
  },
};
