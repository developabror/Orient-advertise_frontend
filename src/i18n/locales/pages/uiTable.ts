const en = {
  emptyTitle: 'No results',
  emptyDescription: 'There are no items to show.',
  loading: 'Loading',
  selectAllOnPage: 'Select all on this page',
  deselectAllOnPage: 'Deselect all on this page',
  selectRow: 'Select {{id}}',
};

export const dict = {
  en,
  ru: {
    emptyTitle: 'Нет результатов',
    emptyDescription: 'Нет элементов для отображения.',
    loading: 'Загрузка',
    selectAllOnPage: 'Выбрать все на этой странице',
    deselectAllOnPage: 'Снять выбор со всех на этой странице',
    selectRow: 'Выбрать {{id}}',
  } satisfies typeof en,
  uz: {
    emptyTitle: 'Natijalar yoʻq',
    emptyDescription: 'Koʻrsatadigan elementlar yoʻq.',
    loading: 'Yuklanmoqda',
    selectAllOnPage: 'Bu sahifadagi barchasini tanlash',
    deselectAllOnPage: 'Bu sahifadagi barcha tanlovni bekor qilish',
    selectRow: '{{id}} ni tanlash',
  } satisfies typeof en,
};
