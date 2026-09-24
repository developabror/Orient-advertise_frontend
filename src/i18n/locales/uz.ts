import type { Translation } from './en';

// Uzbek (Latin script — the official orthography). Shape enforced against en.ts.
export const uz: Translation = {
  language: {
    label: 'Til',
    en: 'Inglizcha',
    ru: 'Ruscha',
    uz: 'Oʻzbekcha',
  },
  theme: {
    label: 'Rang mavzusi',
    light: 'Yorugʻ',
    dark: 'Qorongʻi',
    system: 'Tizim',
  },
  roles: {
    admin: 'Administrator',
    operator: 'Operator',
    viewer: 'Kuzatuvchi',
    advertiser: 'Reklama beruvchi',
  },
  nav: {
    dashboard: 'Boshqaruv paneli',
    myContent: 'Mening kontentim',
    incidents: 'Hodisalar',
    events: 'Voqealar',
    reports: 'Hisobotlar',
    playbackReport: 'Ijro hisoboti',
    devices: 'Qurilmalar',
    syncGroups: 'Sinxronlash guruhlari',
    content: 'Kontent',
    playlists: 'Pleylistlar',
    users: 'Foydalanuvchilar',
    settings: 'Sozlamalar',
  },
  settingsNav: {
    heading: 'Sozlamalar',
    sectionsLabel: 'Sozlamalar boʻlimlari',
    projects: 'Loyihalar',
    regions: 'Hududlar',
    facilities: 'Obyektlar',
    deviceGroups: 'Qurilma guruhlari',
    syncGroups: 'Sinxronlash guruhlari',
  },
  topbar: {
    primaryNav: 'Asosiy navigatsiya',
    brand: 'Orient Advertise',
    account: 'Hisob',
    logout: 'Chiqish',
    openMenu: 'Menyuni ochish',
    closeMenu: 'Menyuni yopish',
  },
  login: {
    title: 'Kirish',
    ariaLabel: 'Tizimga kirish',
    username: 'Foydalanuvchi nomi',
    password: 'Parol',
    signIn: 'Kirish',
    signingIn: 'Kirilmoqda…',
    forgotPassword: 'Parolni unutdingizmi?',
    errorInvalid: 'Foydalanuvchi nomi yoki parol notoʻgʻri.',
    errorRateLimited: 'Kirish urinishlari juda koʻp. Biroz kuting va qayta urinib koʻring.',
    errorSessionRejected:
      'Tizimga kirdingiz, lekin brauzer sessiyani qabul qilmadi. Bu kompyuterdagi sana, vaqt va vaqt mintaqasini tekshirib, qayta urinib koʻring.',
    clockSkewWarning:
      'Bu kompyuter soati serverdan taxminan {{minutes}} daqiqa farq qiladi. Iloji boʻlsa tuzating — ayrim ekranlar shunga tayanadi.',
  },
  dashboard: {
    title: 'Boshqaruv paneli',
    signedInAs: '<0>{{name}}</0> sifatida kirgansiz ({{role}})',
    updated: 'Yangilandi {{time}}',
    showingStale: '{{time}} holatidagi maʼlumotlar koʻrsatilmoqda — yangilab boʻlmadi',
    couldNotLoad: 'Maʼlumotlarni yuklab boʻlmadi',
    stats: {
      totalDevices: 'Jami qurilmalar',
      onlineNow: 'Hozir onlayn',
      offline: 'Oflayn',
      openIncidents: 'Ochiq hodisalar',
    },
  },
};
