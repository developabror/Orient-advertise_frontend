const en = {
  title: 'This page ran into a problem',
  body: 'The rest of the app is fine. Reloading usually clears it; if it keeps happening, tell your administrator what you were doing.',
  staleTitle: 'A new version was released',
  staleBody: 'This tab is running an old version and could not load part of the app. Reload to pick up the new one.',
  reload: 'Reload',
};

export const dict = {
  en,
  ru: {
    title: 'На этой странице произошла ошибка',
    body: 'Остальная часть приложения работает. Обычно помогает перезагрузка; если ошибка повторяется, расскажите администратору, что вы делали.',
    staleTitle: 'Вышла новая версия',
    staleBody: 'В этой вкладке открыта старая версия, часть приложения не загрузилась. Перезагрузите страницу, чтобы получить новую.',
    reload: 'Перезагрузить',
  } satisfies typeof en,
  uz: {
    title: 'Bu sahifada xatolik yuz berdi',
    body: 'Ilovaning qolgan qismi ishlayapti. Odatda sahifani qayta yuklash yetarli; xato takrorlansa, administratorga nima qilganingizni ayting.',
    staleTitle: 'Yangi versiya chiqdi',
    staleBody: 'Bu oynada eski versiya ochiq va ilovaning bir qismi yuklanmadi. Yangisini olish uchun sahifani qayta yuklang.',
    reload: 'Qayta yuklash',
  } satisfies typeof en,
};
