const en = {
  title: 'Urgent content upload',
  warning:
    'Urgent content notifies <strong>all assigned devices immediately</strong> and may interrupt the active playlist. Use this only for time-sensitive announcements — for routine content, use the upload zone on the page.',
  dropHint: 'Drop one urgent video here, or',
  chooseVideo: 'Choose video',
  uploadProgress: 'Upload progress',
  successHeadline_one: '{{count}} device notified',
  successHeadline_other: '{{count}} devices notified',
  successNote:
    '<strong>{{filename}}</strong> has been queued for immediate playback. Devices will switch to it as soon as they receive the push.',
  close: 'Close',
  errorOnlyVideo: 'Only video files are accepted.',
  errorTooLargeClient: 'Files must be 50 MB or smaller.',
  errorTooLargeServer: 'File is too large (server limit is 50 MB).',
  errorUnexpectedResponse: 'Server returned an unexpected response.',
  errorUploadFailed: 'Upload failed.',
};

export const dict = {
  en,
  ru: {
    title: 'Загрузка срочного контента',
    warning:
      'Срочный контент <strong>немедленно уведомляет все назначенные устройства</strong> и может прервать активный плейлист. Используйте это только для срочных объявлений — для обычного контента используйте зону загрузки на странице.',
    dropHint: 'Перетащите сюда одно срочное видео или',
    chooseVideo: 'Выбрать видео',
    uploadProgress: 'Ход загрузки',
    successHeadline_one: 'Уведомлено {{count}} устройство',
    successHeadline_other: 'Уведомлено устройств: {{count}}',
    successNote:
      'Файл <strong>{{filename}}</strong> поставлен в очередь на немедленное воспроизведение. Устройства переключатся на него, как только получат push-уведомление.',
    close: 'Закрыть',
    errorOnlyVideo: 'Принимаются только видеофайлы.',
    errorTooLargeClient: 'Файлы должны быть не больше 50 MB.',
    errorTooLargeServer: 'Файл слишком большой (лимит сервера — 50 MB).',
    errorUnexpectedResponse: 'Сервер вернул непредвиденный ответ.',
    errorUploadFailed: 'Не удалось загрузить.',
  } satisfies typeof en,
  uz: {
    title: 'Shoshilinch kontent yuklash',
    warning:
      'Shoshilinch kontent <strong>barcha biriktirilgan qurilmalarni darhol xabardor qiladi</strong> va faol pleylistni uzishi mumkin. Bundan faqat vaqtga bogʻliq eʼlonlar uchun foydalaning — oddiy kontent uchun sahifadagi yuklash zonasidan foydalaning.',
    dropHint: 'Bitta shoshilinch videoni shu yerga tashlang yoki',
    chooseVideo: 'Video tanlash',
    uploadProgress: 'Yuklash jarayoni',
    successHeadline_one: '{{count}} ta qurilma xabardor qilindi',
    successHeadline_other: '{{count}} ta qurilma xabardor qilindi',
    successNote:
      '<strong>{{filename}}</strong> darhol ijro etish uchun navbatga qoʻyildi. Qurilmalar push-xabarni olishi bilanoq unga oʻtadi.',
    close: 'Yopish',
    errorOnlyVideo: 'Faqat video fayllar qabul qilinadi.',
    errorTooLargeClient: 'Fayllar 50 MB dan katta boʻlmasligi kerak.',
    errorTooLargeServer: 'Fayl juda katta (server cheklovi — 50 MB).',
    errorUnexpectedResponse: 'Server kutilmagan javob qaytardi.',
    errorUploadFailed: 'Yuklab boʻlmadi.',
  } satisfies typeof en,
};
