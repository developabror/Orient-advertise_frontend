const en = {
  label: 'Volume',
  apply: 'Apply',
};

export const dict = {
  en,
  ru: {
    label: 'Громкость',
    apply: 'Применить',
  } satisfies typeof en,
  uz: {
    label: 'Ovoz balandligi',
    apply: 'Qoʻllash',
  } satisfies typeof en,
};
