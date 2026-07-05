const en = {
  backToContent: 'Back to my content',
  notFoundTitle: 'Content not found',
  notFoundDescription: "This content isn't linked to your account, or it may have been removed.",
  contentFallback: 'Content',
  subtitle: 'Play history and per-device counts for this content file.',
  exportPreparing: 'Preparing…',
  exportExcel: 'Export Excel',
  exportSuccess: 'Exported {{filename}}.',
  exportErrorNetwork: 'Could not reach the server. Check your connection and try again.',
  exportErrorForbidden: 'Exporting isn’t available for your account.',
  exportErrorRateLimited:
    'You already have exports running. Please wait for one to finish, then try again.',
  exportErrorTooLarge: 'Export was too large or took too long. Try a smaller date range.',
  exportErrorServer: 'Server error during export. Try a smaller date range or try again later.',
  exportErrorGeneric: 'Could not export. Try a smaller date range.',
  dateRange: 'Date range',
  last7Days: 'Last 7 days',
  last30Days: 'Last 30 days',
  custom: 'Custom',
  from: 'From',
  to: 'To',
  customRangeInvalid: 'Custom range invalid — start date must be on or before end date.',
  apply: 'Apply',
  retry: 'Retry',
  totalPlays: 'Total plays',
  playsPerDevice: 'Plays per device',
  noPlaysTitle: 'No plays recorded',
  noPlaysPerDeviceDescription:
    'No plays have been recorded for this content on any device in the selected date range.',
  noPlaysDescription:
    'No plays have been recorded for this content in the selected date range.',
  playTimestamps: 'Play timestamps',
  playCount: '{{formatted}} {{count, plural, one {play} other {plays}}}',
  aggregateNotice:
    '<strong>Aggregate counts only.</strong> Date range exceeds {{max}} days ({{days}} days selected). Narrow the range to {{max}} days or fewer to see individual play timestamps. Excel export still includes the full range.',
  colDevice: 'Device',
  colPlays: 'Plays',
  colPlayedAt: 'Played at (Tashkent)',
};

export const dict = {
  en,
  ru: {
    backToContent: 'Назад к моему контенту',
    notFoundTitle: 'Контент не найден',
    notFoundDescription: 'Этот контент не привязан к вашей учётной записи или был удалён.',
    contentFallback: 'Контент',
    subtitle: 'История воспроизведений и количество показов по устройствам для этого файла.',
    exportPreparing: 'Подготовка…',
    exportExcel: 'Экспорт в Excel',
    exportSuccess: 'Экспортировано {{filename}}.',
    exportErrorNetwork:
      'Не удалось связаться с сервером. Проверьте подключение и попробуйте снова.',
    exportErrorForbidden: 'Экспорт недоступен для вашей учётной записи.',
    exportErrorRateLimited:
      'У вас уже выполняются экспорты. Дождитесь завершения одного из них и попробуйте снова.',
    exportErrorTooLarge:
      'Экспорт оказался слишком большим или занял слишком много времени. Выберите меньший диапазон дат.',
    exportErrorServer:
      'Ошибка сервера при экспорте. Выберите меньший диапазон дат или повторите попытку позже.',
    exportErrorGeneric: 'Не удалось выполнить экспорт. Выберите меньший диапазон дат.',
    dateRange: 'Диапазон дат',
    last7Days: 'Последние 7 дней',
    last30Days: 'Последние 30 дней',
    custom: 'Произвольный',
    from: 'С',
    to: 'По',
    customRangeInvalid:
      'Недопустимый диапазон — начальная дата должна быть не позже конечной.',
    apply: 'Применить',
    retry: 'Повторить',
    totalPlays: 'Всего воспроизведений',
    playsPerDevice: 'Воспроизведения по устройствам',
    noPlaysTitle: 'Нет записей о воспроизведениях',
    noPlaysPerDeviceDescription:
      'За выбранный диапазон дат для этого контента не зафиксировано воспроизведений ни на одном устройстве.',
    noPlaysDescription:
      'За выбранный диапазон дат для этого контента не зафиксировано воспроизведений.',
    playTimestamps: 'Время воспроизведений',
    playCount:
      '{{formatted}} {{count, plural, one {воспроизведение} few {воспроизведения} many {воспроизведений} other {воспроизведений}}}',
    aggregateNotice:
      '<strong>Только сводные показатели.</strong> Диапазон дат превышает {{max}} дней (выбрано {{days}} дней). Сузьте диапазон до {{max}} дней или меньше, чтобы увидеть отдельные время воспроизведений. Экспорт в Excel по-прежнему включает весь диапазон.',
    colDevice: 'Устройство',
    colPlays: 'Воспроизведения',
    colPlayedAt: 'Воспроизведено (Ташкент)',
  } satisfies typeof en,
  uz: {
    backToContent: 'Mening kontentimga qaytish',
    notFoundTitle: 'Kontent topilmadi',
    notFoundDescription: 'Bu kontent hisobingizga bogʻlanmagan yoki oʻchirilgan boʻlishi mumkin.',
    contentFallback: 'Kontent',
    subtitle: 'Ushbu kontent fayli uchun ijro tarixi va qurilmalar boʻyicha ijrolar soni.',
    exportPreparing: 'Tayyorlanmoqda…',
    exportExcel: 'Excelga eksport',
    exportSuccess: '{{filename}} eksport qilindi.',
    exportErrorNetwork:
      'Serverga ulanib boʻlmadi. Ulanishingizni tekshirib, qayta urinib koʻring.',
    exportErrorForbidden: 'Eksport sizning hisobingiz uchun mavjud emas.',
    exportErrorRateLimited:
      'Sizda allaqachon eksportlar bajarilmoqda. Biri tugashini kutib, keyin qayta urinib koʻring.',
    exportErrorTooLarge:
      'Eksport hajmi juda katta yoki juda uzoq davom etdi. Kichikroq sana oraligʻini tanlang.',
    exportErrorServer:
      'Eksport vaqtida server xatosi. Kichikroq sana oraligʻini tanlang yoki keyinroq urinib koʻring.',
    exportErrorGeneric: 'Eksport qilib boʻlmadi. Kichikroq sana oraligʻini tanlang.',
    dateRange: 'Sana oraligʻi',
    last7Days: 'Soʻnggi 7 kun',
    last30Days: 'Soʻnggi 30 kun',
    custom: 'Maxsus',
    from: 'Dan',
    to: 'Gacha',
    customRangeInvalid:
      'Maxsus oraliq notoʻgʻri — boshlanish sanasi tugash sanasidan keyin boʻlmasligi kerak.',
    apply: 'Qoʻllash',
    retry: 'Qayta urinish',
    totalPlays: 'Jami ijrolar',
    playsPerDevice: 'Qurilmalar boʻyicha ijrolar',
    noPlaysTitle: 'Ijrolar qayd etilmagan',
    noPlaysPerDeviceDescription:
      'Tanlangan sana oraligʻida ushbu kontent uchun hech bir qurilmada ijro qayd etilmagan.',
    noPlaysDescription:
      'Tanlangan sana oraligʻida ushbu kontent uchun ijro qayd etilmagan.',
    playTimestamps: 'Ijro vaqtlari',
    playCount: '{{formatted}} {{count, plural, one {ijro} other {ijro}}}',
    aggregateNotice:
      '<strong>Faqat umumiy hisoblar.</strong> Sana oraligʻi {{max}} kundan oshadi ({{days}} kun tanlangan). Alohida ijro vaqtlarini koʻrish uchun oraliqni {{max}} kun yoki undan kamga toraytiring. Excelga eksport hali ham toʻliq oraliqni oʻz ichiga oladi.',
    colDevice: 'Qurilma',
    colPlays: 'Ijrolar',
    colPlayedAt: 'Ijro etilgan (Toshkent)',
  } satisfies typeof en,
};
