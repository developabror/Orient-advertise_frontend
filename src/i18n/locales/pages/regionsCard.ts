const en = {
  title: 'Regions',
  regionCount: '{{count}} regions',
  empty: 'No regions configured.',
  devicesOnline: '{{online}} of {{total}} devices online',
};

export const dict = {
  en,
  ru: {
    title: 'Регионы',
    regionCount: 'Регионов: {{count}}',
    empty: 'Регионы не настроены.',
    devicesOnline: '{{online}} из {{total}} устройств онлайн',
  } satisfies typeof en,
  uz: {
    title: 'Hududlar',
    regionCount: '{{count}} ta hudud',
    empty: 'Hududlar sozlanmagan.',
    devicesOnline: '{{total}} tadan {{online}} ta qurilma onlayn',
  } satisfies typeof en,
};
