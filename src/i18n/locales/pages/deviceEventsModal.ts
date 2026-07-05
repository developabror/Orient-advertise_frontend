const en = {
  title: 'Event history',
  loading: 'Loading events',
  emptyTitle: 'No events yet',
  emptyDescription: "As the device reports activity, you'll see it here.",
};

export const dict = {
  en,
  ru: {
    title: 'История событий',
    loading: 'Загрузка событий',
    emptyTitle: 'Событий пока нет',
    emptyDescription: 'Как только устройство сообщит об активности, она появится здесь.',
  } satisfies typeof en,
  uz: {
    title: 'Hodisalar tarixi',
    loading: 'Hodisalar yuklanmoqda',
    emptyTitle: 'Hozircha hodisalar yoʻq',
    emptyDescription: 'Qurilma faollik haqida xabar bersa, u shu yerda koʻrinadi.',
  } satisfies typeof en,
};
