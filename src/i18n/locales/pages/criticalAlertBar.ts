const en = {
  label: 'CRITICAL',
  more: '+{{count}} more',
  dismiss: 'Dismiss',
};

export const dict = {
  en,
  ru: {
    label: 'КРИТИЧНО',
    more: '+{{count}} ещё',
    dismiss: 'Закрыть',
  } satisfies typeof en,
  uz: {
    label: 'MUHIM',
    more: '+{{count}} ta yana',
    dismiss: 'Yopish',
  } satisfies typeof en,
};
