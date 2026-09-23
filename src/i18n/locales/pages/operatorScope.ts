const en = {
  noProjectsTitle: 'No projects assigned',
  noProjectsDesc: 'Ask an administrator to assign you to a project.',
  loading: 'Loading…',
  loadFailed: 'Could not load your project access, so this page cannot be filtered to your projects yet.',
  retry: 'Try again',
};

export const dict = {
  en,
  ru: {
    noProjectsTitle: 'Проекты не назначены',
    noProjectsDesc: 'Попросите администратора назначить вас на проект.',
    loading: 'Загрузка…',
    loadFailed: 'Не удалось загрузить доступ к вашим проектам, поэтому страницу пока нельзя отфильтровать по ним.',
    retry: 'Повторить',
  } satisfies typeof en,
  uz: {
    noProjectsTitle: 'Loyihalar tayinlanmagan',
    noProjectsDesc: 'Administratordan sizni loyihaga biriktirishni soʻrang.',
    loading: 'Yuklanmoqda…',
    loadFailed: 'Loyihalaringizga ruxsatni yuklab boʻlmadi, shuning uchun bu sahifani hozircha ular boʻyicha filtrlab boʻlmaydi.',
    retry: 'Qayta urinish',
  } satisfies typeof en,
};
