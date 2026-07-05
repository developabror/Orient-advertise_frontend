const en = {
  future: 'in the future',
  justNow: 'just now',
  secondsAgo: '{{count}}s ago',
  minutesAgo: '{{count}}m ago',
  hoursAgo: '{{count}}h ago',
  daysAgo: '{{count}}d ago',
  unknownTime: 'Unknown time',
};

export const dict = {
  en,
  ru: {
    future: 'в будущем',
    justNow: 'только что',
    secondsAgo: '{{count}} с назад',
    minutesAgo: '{{count}} мин назад',
    hoursAgo: '{{count}} ч назад',
    daysAgo: '{{count}} дн назад',
    unknownTime: 'Время неизвестно',
  } satisfies typeof en,
  uz: {
    future: 'kelajakda',
    justNow: 'hozirgina',
    secondsAgo: '{{count}} s oldin',
    minutesAgo: '{{count}} daq oldin',
    hoursAgo: '{{count}} soat oldin',
    daysAgo: '{{count}} kun oldin',
    unknownTime: 'Vaqt nomaʼlum',
  } satisfies typeof en,
};
