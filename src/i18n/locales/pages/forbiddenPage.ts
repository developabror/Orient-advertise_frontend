const en = {
  title: '403 — Forbidden',
  message: "You don't have access to this page.",
  backToDashboard: 'Back to dashboard',
};

export const dict = {
  en,
  ru: {
    title: '403 — Доступ запрещён',
    message: 'У вас нет доступа к этой странице.',
    backToDashboard: 'Вернуться на панель управления',
  } satisfies typeof en,
  uz: {
    title: '403 — Ruxsat yoʻq',
    message: 'Sizda ushbu sahifaga kirish huquqi yoʻq.',
    backToDashboard: 'Boshqaruv paneliga qaytish',
  } satisfies typeof en,
};
