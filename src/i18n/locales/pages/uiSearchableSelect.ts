const en = {
  searchPlaceholder: 'Search…',
  noMatches: 'No matches.',
  loading: 'Loading',
  loadingEllipsis: 'Loading…',
  retry: 'Retry',
};

export const dict = {
  en,
  ru: {
    searchPlaceholder: 'Поиск…',
    noMatches: 'Совпадений нет.',
    loading: 'Загрузка',
    loadingEllipsis: 'Загрузка…',
    retry: 'Повторить',
  } satisfies typeof en,
  uz: {
    searchPlaceholder: 'Qidirish…',
    noMatches: 'Mos keladigan natija yoʻq.',
    loading: 'Yuklanmoqda',
    loadingEllipsis: 'Yuklanmoqda…',
    retry: 'Qayta urinish',
  } satisfies typeof en,
};
