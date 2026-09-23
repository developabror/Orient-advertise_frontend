const en = {
  title: 'Priority upload',
  warning:
    'A priority upload goes to the <strong>front of the processing queue</strong>, so this file is ready before anything already waiting. It does <strong>not</strong> put the video on screen — add it to a playlist as usual once it is ready.',
  dropHint: 'Drop one video here, or',
  chooseVideo: 'Choose video',
  uploadProgress: 'Upload progress',
  successHeadline: 'Sent to the front of the queue',
  successNote:
    '<strong>{{filename}}</strong> is being processed first. Add it to a playlist to put it on screen.',
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
    title: 'Приоритетная загрузка',
    warning:
      'Приоритетная загрузка ставит файл <strong>в начало очереди обработки</strong>, поэтому он будет готов раньше остальных. Это <strong>не</strong> выводит видео на экран — как обычно, добавьте его в плейлист, когда оно будет готово.',
    dropHint: 'Перетащите сюда одно видео или',
    chooseVideo: 'Выбрать видео',
    uploadProgress: 'Ход загрузки',
    successHeadline: 'Отправлено в начало очереди',
    successNote:
      'Файл <strong>{{filename}}</strong> обрабатывается первым. Добавьте его в плейлист, чтобы вывести на экран.',
    close: 'Закрыть',
    errorOnlyVideo: 'Принимаются только видеофайлы.',
    errorTooLargeClient: 'Файлы должны быть не больше 50 MB.',
    errorTooLargeServer: 'Файл слишком большой (лимит сервера — 50 MB).',
    errorUnexpectedResponse: 'Сервер вернул непредвиденный ответ.',
    errorUploadFailed: 'Не удалось загрузить.',
  } satisfies typeof en,
  uz: {
    title: 'Ustuvor yuklash',
    warning:
      'Ustuvor yuklash faylni <strong>qayta ishlash navbatining boshiga</strong> qoʻyadi, shuning uchun u kutayotgan boshqa fayllardan oldin tayyor boʻladi. Bu videoni ekranga <strong>chiqarmaydi</strong> — tayyor boʻlgach, odatdagidek pleylistga qoʻshing.',
    dropHint: 'Bitta videoni shu yerga tashlang yoki',
    chooseVideo: 'Video tanlash',
    uploadProgress: 'Yuklash jarayoni',
    successHeadline: 'Navbat boshiga yuborildi',
    successNote:
      '<strong>{{filename}}</strong> birinchi boʻlib qayta ishlanmoqda. Ekranga chiqarish uchun uni pleylistga qoʻshing.',
    close: 'Yopish',
    errorOnlyVideo: 'Faqat video fayllar qabul qilinadi.',
    errorTooLargeClient: 'Fayllar 50 MB dan katta boʻlmasligi kerak.',
    errorTooLargeServer: 'Fayl juda katta (server cheklovi — 50 MB).',
    errorUnexpectedResponse: 'Server kutilmagan javob qaytardi.',
    errorUploadFailed: 'Yuklab boʻlmadi.',
  } satisfies typeof en,
};
