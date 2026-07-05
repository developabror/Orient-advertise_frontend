const en = {
  dismiss: 'Dismiss',
  errorStatus: 'Error {{status}}',
  ref: ' · Ref: {{correlationId}}',
};

export const dict = {
  en,
  ru: {
    dismiss: 'Закрыть',
    errorStatus: 'Ошибка {{status}}',
    ref: ' · Идентификатор: {{correlationId}}',
  } satisfies typeof en,
  uz: {
    dismiss: 'Yopish',
    errorStatus: 'Xato {{status}}',
    ref: ' · Identifikator: {{correlationId}}',
  } satisfies typeof en,
};
