const en = {
  title: 'Recent open incidents',
  viewAll: 'View all',
  emptyTitle: 'All clear',
  emptyDescription: 'No open incidents right now.',
};

export const dict = {
  en,
  ru: {
    title: 'Недавние открытые инциденты',
    viewAll: 'Показать все',
    emptyTitle: 'Всё в порядке',
    emptyDescription: 'Сейчас нет открытых инцидентов.',
  } satisfies typeof en,
  uz: {
    title: 'Soʻnggi ochiq hodisalar',
    viewAll: 'Barchasini koʻrish',
    emptyTitle: 'Hammasi joyida',
    emptyDescription: 'Hozircha ochiq hodisalar yoʻq.',
  } satisfies typeof en,
};
