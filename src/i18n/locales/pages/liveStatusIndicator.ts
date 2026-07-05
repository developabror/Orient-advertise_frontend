const en = {
  status_connecting: 'Connecting…',
  status_reconnecting: 'Reconnecting…',
  status_paused: 'Live updates paused',
};

export const dict = {
  en,
  ru: {
    status_connecting: 'Подключение…',
    status_reconnecting: 'Переподключение…',
    status_paused: 'Обновления в реальном времени приостановлены',
  } satisfies typeof en,
  uz: {
    status_connecting: 'Ulanmoqda…',
    status_reconnecting: 'Qayta ulanmoqda…',
    status_paused: 'Jonli yangilanishlar toʻxtatildi',
  } satisfies typeof en,
};
