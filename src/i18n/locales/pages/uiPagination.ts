const en = {
  pagination: 'Pagination',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  page: 'Page {{page}}',
};

export const dict = {
  en,
  ru: {
    pagination: 'Пагинация',
    previousPage: 'Предыдущая страница',
    nextPage: 'Следующая страница',
    page: 'Страница {{page}}',
  } satisfies typeof en,
  uz: {
    pagination: 'Sahifalash',
    previousPage: 'Oldingi sahifa',
    nextPage: 'Keyingi sahifa',
    page: '{{page}}-sahifa',
  } satisfies typeof en,
};
