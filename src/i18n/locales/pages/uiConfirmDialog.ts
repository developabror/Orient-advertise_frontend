const en = {
  confirm: 'Confirm',
  cancel: 'Cancel',
};

export const dict = {
  en,
  ru: {
    confirm: 'Подтвердить',
    cancel: 'Отмена',
  } satisfies typeof en,
  uz: {
    confirm: 'Tasdiqlash',
    cancel: 'Bekor qilish',
  } satisfies typeof en,
};
