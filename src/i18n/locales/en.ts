// English — the source of truth. Every other locale mirrors this shape exactly;
// `Translation` (derived from this object) keeps the others honest at compile
// time. Keys are grouped by surface (nav, login, dashboard, …). When you add a
// string here, add the matching key to ru.ts and uz.ts or the build fails.

export const en = {
  language: {
    label: 'Language',
    en: 'English',
    ru: 'Russian',
    uz: 'Uzbek',
  },
  theme: {
    label: 'Color theme',
    light: 'Light',
    dark: 'Dark',
    system: 'System',
  },
  roles: {
    admin: 'Admin',
    operator: 'Operator',
    viewer: 'Viewer',
    advertiser: 'Advertiser',
  },
  nav: {
    dashboard: 'Dashboard',
    myContent: 'My Content',
    incidents: 'Incidents',
    events: 'Events',
    reports: 'Reports',
    playbackReport: 'Playback report',
    devices: 'Devices',
    content: 'Content',
    playlists: 'Playlists',
    users: 'Users',
    settings: 'Settings',
  },
  settingsNav: {
    heading: 'Settings',
    sectionsLabel: 'Settings sections',
    projects: 'Projects',
    regions: 'Regions',
    facilities: 'Facilities',
    deviceGroups: 'Device groups',
    syncGroups: 'Sync groups',
  },
  topbar: {
    primaryNav: 'Primary navigation',
    brand: 'Orient Advertise',
    account: 'Account',
    logout: 'Log out',
    openMenu: 'Open menu',
    closeMenu: 'Close menu',
  },
  login: {
    title: 'Sign in',
    ariaLabel: 'Sign in',
    username: 'Username',
    password: 'Password',
    signIn: 'Sign in',
    signingIn: 'Signing in…',
    forgotPassword: 'Forgot password?',
    errorInvalid: 'Invalid username or password.',
    errorRateLimited: 'Too many sign-in attempts. Please wait a moment and try again.',
  },
  dashboard: {
    title: 'Dashboard',
    signedInAs: 'Signed in as <0>{{name}}</0> ({{role}})',
    updated: 'Updated {{time}}',
    showingStale: 'Showing data from {{time}} — refresh failed',
    couldNotLoad: 'Could not load data',
    stats: {
      totalDevices: 'Total Devices',
      onlineNow: 'Online Now',
      offline: 'Offline',
      openIncidents: 'Open Incidents',
    },
  },
};

// `Translation` keeps the nested key structure but widens leaf values to
// `string` (no `as const`), so ru.ts / uz.ts must match the *shape* exactly
// while supplying their own text. A missing or misspelled key is a compile
// error in those files.
export type Translation = typeof en;
