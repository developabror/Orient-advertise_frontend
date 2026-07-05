const en = {
  more: 'More',
  less: 'Less',
};

export const dict = {
  en,
  ru: {
    more: 'Ещё',
    less: 'Свернуть',
  } satisfies typeof en,
  uz: {
    more: 'Yana',
    less: 'Yigʻish',
  } satisfies typeof en,
};
