const en = {
  // Header
  backToDevice: 'Back to device',
  chipLive: 'Live',
  chipWaiting: 'Waiting',
  viewOnly: 'View only',
  viewOnlyExplain: 'This device streams its screen but does not accept remote input.',
  expiresIn: 'Ends in {{time}}',
  disconnect: 'Disconnect',

  // Stage
  stageLabel: 'Remote screen — arrow keys, Enter and Backspace are sent to the device',
  canvasLabel: 'Live screen of the device',

  // Idle
  idleLead: 'Open a live view of this screen.',
  offlineHint: 'This device has no open connection right now, so it may take longer to respond.',
  capabilityUnknown: 'This device has not reported whether it supports remote control.',
  connect: 'Connect',

  // In flight
  starting: 'Starting session',
  waitingTitle: 'Waiting for device…',
  waitingHeartbeat: 'It may take up to {{minutes}} minutes — the device is not connected and will pick this up on its next check-in.',
  waitingWs: 'The device has been notified and should appear shortly.',
  waitingElapsed: 'Waiting {{seconds}}s',

  // Recovery actions
  takeOver: 'Take over',
  reconnect: 'Try again',

  // Errors
  errStart: 'Could not start the remote session.',
  errBusy: 'Another remote session is already open for this device.',
  errUnsupportedDevice: 'This device reported that it does not support remote control.',
  errForbidden: 'You do not have access to remote control for this device.',
  errNoDevice: 'This device does not exist, or is outside your scope.',
  errDisabled: 'Remote control is turned off on this server.',
  errExpired: 'The session reached its time limit and was ended.',
  errStream: 'The video stream could not be decoded.',
  errCanvas: 'The viewer could not be prepared. Please reload the page.',
  errInsecure: 'Remote control needs a secure (HTTPS) connection. Open this page over HTTPS.',
  errNoWebCodecs: 'This browser cannot decode the video. Use a recent Chrome, Edge or Opera.',
  errRelayUntrusted: 'The server returned an unusable relay address, so the connection was refused. Contact your administrator.',

  // Socket close reasons
  closeNormal: 'The session was closed.',
  closeRejected: 'Session rejected or expired.',
  closeLost: 'Connection lost.',

  // D-pad
  dpadLabel: 'Device controls',
  dpadUp: 'Up',
  dpadDown: 'Down',
  dpadLeft: 'Left',
  dpadRight: 'Right',
  dpadOk: 'OK',
  dpadBack: 'Back',
  dpadHome: 'Home',
};

export const dict = {
  en,
  ru: {
    backToDevice: 'К устройству',
    chipLive: 'В эфире',
    chipWaiting: 'Ожидание',
    viewOnly: 'Только просмотр',
    viewOnlyExplain: 'Это устройство передаёт экран, но не принимает удалённый ввод.',
    expiresIn: 'Завершится через {{time}}',
    disconnect: 'Отключить',

    stageLabel: 'Удалённый экран — стрелки, Enter и Backspace отправляются на устройство',
    canvasLabel: 'Экран устройства в реальном времени',

    idleLead: 'Открыть просмотр этого экрана в реальном времени.',
    offlineHint: 'У устройства сейчас нет открытого соединения, поэтому ответ может занять больше времени.',
    capabilityUnknown: 'Устройство не сообщило, поддерживает ли оно удалённое управление.',
    connect: 'Подключиться',

    starting: 'Запуск сеанса',
    waitingTitle: 'Ожидание устройства…',
    waitingHeartbeat: 'Это может занять до {{minutes}} мин — устройство не подключено и получит запрос при следующей регистрации.',
    waitingWs: 'Устройство уведомлено, изображение появится в ближайшее время.',
    waitingElapsed: 'Ожидание {{seconds}} с',

    takeOver: 'Перехватить',
    reconnect: 'Повторить',

    errStart: 'Не удалось запустить удалённый сеанс.',
    errBusy: 'Для этого устройства уже открыт другой удалённый сеанс.',
    errUnsupportedDevice: 'Устройство сообщило, что не поддерживает удалённое управление.',
    errForbidden: 'У вас нет доступа к удалённому управлению этим устройством.',
    errNoDevice: 'Такого устройства нет или оно вне вашей зоны доступа.',
    errDisabled: 'Удалённое управление отключено на этом сервере.',
    errExpired: 'Сеанс достиг ограничения по времени и был завершён.',
    errStream: 'Не удалось декодировать видеопоток.',
    errCanvas: 'Не удалось подготовить просмотрщик. Обновите страницу.',
    errInsecure: 'Для удалённого управления нужно защищённое соединение (HTTPS). Откройте страницу по HTTPS.',
    errNoWebCodecs: 'Этот браузер не может декодировать видео. Используйте современный Chrome, Edge или Opera.',
    errRelayUntrusted: 'Сервер вернул недопустимый адрес ретранслятора, подключение отклонено. Обратитесь к администратору.',

    closeNormal: 'Сеанс закрыт.',
    closeRejected: 'Сеанс отклонён или истёк.',
    closeLost: 'Соединение потеряно.',

    dpadLabel: 'Управление устройством',
    dpadUp: 'Вверх',
    dpadDown: 'Вниз',
    dpadLeft: 'Влево',
    dpadRight: 'Вправо',
    dpadOk: 'ОК',
    dpadBack: 'Назад',
    dpadHome: 'Домой',
  } satisfies typeof en,
  uz: {
    backToDevice: 'Qurilmaga qaytish',
    chipLive: 'Jonli',
    chipWaiting: 'Kutilmoqda',
    viewOnly: 'Faqat koʻrish',
    viewOnlyExplain: 'Bu qurilma ekranini uzatadi, lekin masofaviy boshqaruvni qabul qilmaydi.',
    expiresIn: '{{time}} dan soʻng tugaydi',
    disconnect: 'Uzish',

    stageLabel: 'Masofaviy ekran — strelkalar, Enter va Backspace qurilmaga yuboriladi',
    canvasLabel: 'Qurilmaning jonli ekrani',

    idleLead: 'Bu ekranni jonli rejimda koʻrishni oching.',
    offlineHint: 'Hozir qurilmada ochiq ulanish yoʻq, shuning uchun javob kechikishi mumkin.',
    capabilityUnknown: 'Qurilma masofaviy boshqaruvni qoʻllab-quvvatlashi haqida xabar bermagan.',
    connect: 'Ulanish',

    starting: 'Seans ishga tushirilmoqda',
    waitingTitle: 'Qurilma kutilmoqda…',
    waitingHeartbeat: 'Bu {{minutes}} daqiqagacha vaqt olishi mumkin — qurilma ulanmagan va buni keyingi ulanishida oladi.',
    waitingWs: 'Qurilmaga xabar berildi, tasvir tez orada paydo boʻladi.',
    waitingElapsed: 'Kutilmoqda: {{seconds}} s',

    takeOver: 'Boshqaruvni olish',
    reconnect: 'Qayta urinish',

    errStart: 'Masofaviy seansni boshlab boʻlmadi.',
    errBusy: 'Bu qurilma uchun allaqachon boshqa masofaviy seans ochiq.',
    errUnsupportedDevice: 'Qurilma masofaviy boshqaruvni qoʻllab-quvvatlamasligini bildirdi.',
    errForbidden: 'Sizda bu qurilmani masofadan boshqarish huquqi yoʻq.',
    errNoDevice: 'Bunday qurilma mavjud emas yoki sizning doirangizdan tashqarida.',
    errDisabled: 'Bu serverda masofaviy boshqaruv oʻchirilgan.',
    errExpired: 'Seans vaqt chegarasiga yetdi va tugatildi.',
    errStream: 'Video oqimini dekodlab boʻlmadi.',
    errCanvas: 'Koʻruvchini tayyorlab boʻlmadi. Sahifani yangilang.',
    errInsecure: 'Masofaviy boshqaruv uchun himoyalangan (HTTPS) ulanish kerak. Sahifani HTTPS orqali oching.',
    errNoWebCodecs: 'Bu brauzer videoni dekodlay olmaydi. Zamonaviy Chrome, Edge yoki Opera ishlating.',
    errRelayUntrusted: 'Server yaroqsiz relay manzilini qaytardi, ulanish rad etildi. Administratorga murojaat qiling.',

    closeNormal: 'Seans yopildi.',
    closeRejected: 'Seans rad etildi yoki muddati tugadi.',
    closeLost: 'Ulanish uzildi.',

    dpadLabel: 'Qurilma boshqaruvi',
    dpadUp: 'Yuqoriga',
    dpadDown: 'Pastga',
    dpadLeft: 'Chapga',
    dpadRight: 'Oʻngga',
    dpadOk: 'OK',
    dpadBack: 'Orqaga',
    dpadHome: 'Bosh sahifa',
  } satisfies typeof en,
};
