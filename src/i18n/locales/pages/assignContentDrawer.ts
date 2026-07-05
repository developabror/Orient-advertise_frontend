const en = {
  // Target types
  targetTypeRegion: 'Region',
  targetTypeFacility: 'Facility',
  targetTypeGroup: 'Group',

  // Step labels
  stepPlaylist: 'Playlist',
  stepTarget: 'Target',
  stepDevices: 'Devices',
  stepSchedule: 'Schedule',

  // Overlap / conflict copy
  genericOverlap:
    'This {{noun}} already has overlapping content scheduled. Pick a different time, or remove the existing assignment first.',
  noEndDate: 'No end date',
  existingAssignment: 'Existing assignment',

  // Playlist meta
  itemsOne: '{{count}} item',
  itemsOther: '{{count}} items',
  metaDurationUnderMin: '{{items}} · <1 min',
  metaDuration: '{{items}} · {{minutes}} min',

  // Drawer chrome
  drawerTitle: 'Assign content',
  steps: 'Steps',

  // Footer buttons
  cancel: 'Cancel',
  continue: 'Continue',
  back: 'Back',
  confirm: 'Confirm',

  // Step 1 — playlist
  choosePlaylist: 'Choose playlist',
  searchPlaylists: 'Search playlists…',
  noPlaylists: 'No playlists available.',
  emptyPlaylistWarning:
    'This playlist has 0 items. Add content in Playlists before assigning, or the screens will show nothing.',

  // Step 2 — target
  targetType: 'Target type',
  chooseTarget: 'Choose {{type}}',
  searchTargets: 'Search {{type}}s…',
  noMatchingTargets: 'No matching {{type}}s.',
  devicesOne: '{{count}} device',
  devicesOther: '{{count}} devices',
  zeroDevicesInTarget:
    'in this {{type}}. You can still continue — the assignment will apply to any devices added later.',
  zeroDevicesStrong: '0 devices',
  willReceiveContent: 'will receive this content.',

  // Step 3 — devices
  selectionActions: 'Selection actions',
  selectedOfTotal: 'of {{total}} selected',
  allMatching: 'all matching',
  selectAll: 'Select all {{total}}',
  uncheckAll: 'Uncheck all',
  quickSelectOnline: 'Quick-select online',
  offlineNote:
    'Offline devices are included — they apply this content automatically when they reconnect.',
  truncationNote:
    'Per-device selection is disabled at this scale — assign to the whole scope, or narrow the target.',
  showingFirst: 'Showing the first',
  ofConnector: 'of',
  ofDevices: 'devices in this target.',
  selectAllWholeScope: 'Select all {{total}} (assign to the whole scope)',
  retry: 'Retry',
  noMatchingDevices: 'No matching devices',
  noDevicesToPreview: 'This target has no devices to preview.',

  // Table headers
  columnDevice: 'Device',
  columnStatus: 'Status',
  deviceFallbackName: 'Device #{{id}}',

  // Step 4 — schedule
  scheduleHeading: 'Schedule',
  scheduleHint: 'Set when this assignment runs. All times are in Tashkent (UTC+5).',
  start: 'Start',
  end: 'End',
  startNow: 'Start now',
  noEndDateToggle: 'No end date (run indefinitely)',
  setStartTime: 'Set a start time, or turn on “Start now”.',
  setEndTime: 'Set an end time, or turn on “No end date”.',
  startInPast: 'Start time can’t be in the past.',
  endAfterStart: 'End time must be after start time.',

  // Overlap panel
  bookedOverlap: 'This {{noun}} is already booked for an overlapping time:',
  clashWithDenominatorOne:
    '{{count}} of your {{denominator}} selected device already has content scheduled for this time:',
  clashWithDenominatorOtherHas:
    '{{count}} of your {{denominator}} selected devices already has content scheduled for this time:',
  clashWithDenominatorOther:
    '{{count}} of your {{denominator}} selected devices already have content scheduled for this time:',
  clashNoDenominatorOne:
    '{{count}} of your selected device already has content scheduled for this time:',
  clashNoDenominatorOther:
    '{{count}} of your selected devices already have content scheduled for this time:',
  chooseDifferentTime: 'Choose a different time',
  replaceAndAssign: 'Replace existing & assign',

  // Schedule summary
  summaryDevicesReceive: 'from {{name}} will receive this content.',
  summaryFineprint:
    'Any of those devices that are currently offline will apply this content the next time they reconnect.',
  noTargetDash: '—',

  // Toasts
  assignedSuccess: 'Assigned to {{label}}.',
  replacedSuccess: 'Replaced existing content — assigned to {{label}}.',
  couldNotConfirm: 'Could not confirm assignment.',
  couldNotReplace: 'Could not replace the existing assignment. Please try again.',

  // Discard dialog
  discardTitle: 'Discard assignment?',
  discardMessage: "You'll lose the target, selection, and any schedule changes.",
  discard: 'Discard',
  keepEditing: 'Keep editing',

  // Replace dialog
  replaceTitle: 'Replace existing content?',
  replaceRemoveOne: 'This will remove the existing booking:',
  replaceRemoveOther: 'This will remove the existing bookings:',
  replaceRunInstead: 'and run <0>{{name}}</0> instead.',
  newPlaylistFallback: 'the new playlist',
  replaceConfirmLabel: 'Replace & assign',
};

export const dict = {
  en,
  ru: {
    targetTypeRegion: 'Регион',
    targetTypeFacility: 'Объект',
    targetTypeGroup: 'Группа',

    stepPlaylist: 'Плейлист',
    stepTarget: 'Цель',
    stepDevices: 'Устройства',
    stepSchedule: 'Расписание',

    genericOverlap:
      'Для этой цели ({{noun}}) уже запланирован пересекающийся контент. Выберите другое время или сначала удалите существующее назначение.',
    noEndDate: 'Без даты окончания',
    existingAssignment: 'Существующее назначение',

    itemsOne: '{{count}} элемент',
    itemsOther: '{{count}} элементов',
    metaDurationUnderMin: '{{items}} · <1 мин',
    metaDuration: '{{items}} · {{minutes}} мин',

    drawerTitle: 'Назначить контент',
    steps: 'Шаги',

    cancel: 'Отмена',
    continue: 'Продолжить',
    back: 'Назад',
    confirm: 'Подтвердить',

    choosePlaylist: 'Выберите плейлист',
    searchPlaylists: 'Поиск плейлистов…',
    noPlaylists: 'Нет доступных плейлистов.',
    emptyPlaylistWarning:
      'В этом плейлисте 0 элементов. Добавьте контент в разделе «Плейлисты» перед назначением, иначе экраны будут пустыми.',

    targetType: 'Тип цели',
    chooseTarget: 'Выберите: {{type}}',
    searchTargets: 'Поиск: {{type}}…',
    noMatchingTargets: 'Совпадений не найдено: {{type}}.',
    devicesOne: '{{count}} устройство',
    devicesOther: '{{count}} устройств',
    zeroDevicesInTarget:
      'в этой цели ({{type}}). Вы всё равно можете продолжить — назначение применится к любым устройствам, добавленным позже.',
    zeroDevicesStrong: '0 устройств',
    willReceiveContent: 'получат этот контент.',

    selectionActions: 'Действия выбора',
    selectedOfTotal: 'из {{total}} выбрано',
    allMatching: 'все подходящие',
    selectAll: 'Выбрать все {{total}}',
    uncheckAll: 'Снять выбор',
    quickSelectOnline: 'Быстрый выбор онлайн',
    offlineNote:
      'Офлайн-устройства включены — они применят этот контент автоматически при повторном подключении.',
    truncationNote:
      'Выбор отдельных устройств отключён при таком масштабе — назначьте на весь охват или сузьте цель.',
    showingFirst: 'Показаны первые',
    ofConnector: 'из',
    ofDevices: 'устройств в этой цели.',
    selectAllWholeScope: 'Выбрать все {{total}} (назначить на весь охват)',
    retry: 'Повторить',
    noMatchingDevices: 'Нет подходящих устройств',
    noDevicesToPreview: 'В этой цели нет устройств для предпросмотра.',

    columnDevice: 'Устройство',
    columnStatus: 'Статус',
    deviceFallbackName: 'Устройство №{{id}}',

    scheduleHeading: 'Расписание',
    scheduleHint: 'Укажите, когда выполняется это назначение. Всё время указано по Ташкенту (UTC+5).',
    start: 'Начало',
    end: 'Окончание',
    startNow: 'Начать сейчас',
    noEndDateToggle: 'Без даты окончания (бессрочно)',
    setStartTime: 'Укажите время начала или включите «Начать сейчас».',
    setEndTime: 'Укажите время окончания или включите «Без даты окончания».',
    startInPast: 'Время начала не может быть в прошлом.',
    endAfterStart: 'Время окончания должно быть позже времени начала.',

    bookedOverlap: 'Для этой цели ({{noun}}) уже забронировано пересекающееся время:',
    clashWithDenominatorOne:
      'Для {{count}} из ваших {{denominator}} выбранных устройств уже запланирован контент на это время:',
    clashWithDenominatorOtherHas:
      'Для {{count}} из ваших {{denominator}} выбранных устройств уже запланирован контент на это время:',
    clashWithDenominatorOther:
      'Для {{count}} из ваших {{denominator}} выбранных устройств уже запланирован контент на это время:',
    clashNoDenominatorOne:
      'Для {{count}} из ваших выбранных устройств уже запланирован контент на это время:',
    clashNoDenominatorOther:
      'Для {{count}} из ваших выбранных устройств уже запланирован контент на это время:',
    chooseDifferentTime: 'Выбрать другое время',
    replaceAndAssign: 'Заменить существующее и назначить',

    summaryDevicesReceive: 'из «{{name}}» получат этот контент.',
    summaryFineprint:
      'Любые из этих устройств, которые сейчас офлайн, применят этот контент при следующем подключении.',
    noTargetDash: '—',

    assignedSuccess: 'Назначено: {{label}}.',
    replacedSuccess: 'Существующий контент заменён — назначено: {{label}}.',
    couldNotConfirm: 'Не удалось подтвердить назначение.',
    couldNotReplace: 'Не удалось заменить существующее назначение. Попробуйте ещё раз.',

    discardTitle: 'Отменить назначение?',
    discardMessage: 'Вы потеряете цель, выбор и все изменения расписания.',
    discard: 'Отменить',
    keepEditing: 'Продолжить редактирование',

    replaceTitle: 'Заменить существующий контент?',
    replaceRemoveOne: 'Это удалит существующее бронирование:',
    replaceRemoveOther: 'Это удалит существующие бронирования:',
    replaceRunInstead: 'и вместо этого запустит <0>«{{name}}»</0>.',
    newPlaylistFallback: 'новый плейлист',
    replaceConfirmLabel: 'Заменить и назначить',
  } satisfies typeof en,
  uz: {
    targetTypeRegion: 'Hudud',
    targetTypeFacility: 'Obyekt',
    targetTypeGroup: 'Guruh',

    stepPlaylist: 'Pleylist',
    stepTarget: 'Maqsad',
    stepDevices: 'Qurilmalar',
    stepSchedule: 'Jadval',

    genericOverlap:
      'Bu maqsad ({{noun}}) uchun allaqachon bir-biriga toʻgʻri keladigan kontent rejalashtirilgan. Boshqa vaqtni tanlang yoki avval mavjud tayinlovni oʻchiring.',
    noEndDate: 'Tugash sanasiz',
    existingAssignment: 'Mavjud tayinlov',

    itemsOne: '{{count}} ta element',
    itemsOther: '{{count}} ta element',
    metaDurationUnderMin: '{{items}} · <1 daqiqa',
    metaDuration: '{{items}} · {{minutes}} daqiqa',

    drawerTitle: 'Kontent tayinlash',
    steps: 'Bosqichlar',

    cancel: 'Bekor qilish',
    continue: 'Davom etish',
    back: 'Orqaga',
    confirm: 'Tasdiqlash',

    choosePlaylist: 'Pleylistni tanlang',
    searchPlaylists: 'Pleylistlarni qidirish…',
    noPlaylists: 'Mavjud pleylistlar yoʻq.',
    emptyPlaylistWarning:
      'Bu pleylistda 0 ta element bor. Tayinlashdan oldin «Pleylistlar» boʻlimida kontent qoʻshing, aks holda ekranlarda hech narsa koʻrinmaydi.',

    targetType: 'Maqsad turi',
    chooseTarget: 'Tanlang: {{type}}',
    searchTargets: 'Qidirish: {{type}}…',
    noMatchingTargets: 'Mos keladigani yoʻq: {{type}}.',
    devicesOne: '{{count}} ta qurilma',
    devicesOther: '{{count}} ta qurilma',
    zeroDevicesInTarget:
      'bu maqsadda ({{type}}). Baribir davom etishingiz mumkin — tayinlov keyinroq qoʻshilgan har qanday qurilmaga qoʻllaniladi.',
    zeroDevicesStrong: '0 ta qurilma',
    willReceiveContent: 'bu kontentni oladi.',

    selectionActions: 'Tanlash amallari',
    selectedOfTotal: '/ {{total}} tanlangan',
    allMatching: 'barcha mos keluvchi',
    selectAll: 'Barchasini tanlash {{total}}',
    uncheckAll: 'Belgilashni olib tashlash',
    quickSelectOnline: 'Onlaynlarni tez tanlash',
    offlineNote:
      'Oflayn qurilmalar ham kiritilgan — ular qayta ulanganda bu kontentni avtomatik qoʻllaydi.',
    truncationNote:
      'Bunday masshtabda alohida qurilmani tanlash oʻchirilgan — butun qamrovga tayinlang yoki maqsadni toraytiring.',
    showingFirst: 'Birinchi koʻrsatilmoqda',
    ofConnector: '/',
    ofDevices: 'qurilma bu maqsadda.',
    selectAllWholeScope: 'Barchasini tanlash {{total}} (butun qamrovga tayinlash)',
    retry: 'Qayta urinish',
    noMatchingDevices: 'Mos keladigan qurilmalar yoʻq',
    noDevicesToPreview: 'Bu maqsadda koʻrib chiqish uchun qurilmalar yoʻq.',

    columnDevice: 'Qurilma',
    columnStatus: 'Holat',
    deviceFallbackName: 'Qurilma №{{id}}',

    scheduleHeading: 'Jadval',
    scheduleHint:
      'Bu tayinlov qachon ishlashini belgilang. Barcha vaqtlar Toshkent boʻyicha (UTC+5).',
    start: 'Boshlanish',
    end: 'Tugash',
    startNow: 'Hozir boshlash',
    noEndDateToggle: 'Tugash sanasiz (cheksiz ishlaydi)',
    setStartTime: 'Boshlanish vaqtini belgilang yoki «Hozir boshlash»ni yoqing.',
    setEndTime: 'Tugash vaqtini belgilang yoki «Tugash sanasiz»ni yoqing.',
    startInPast: 'Boshlanish vaqti oʻtmishda boʻlishi mumkin emas.',
    endAfterStart: 'Tugash vaqti boshlanish vaqtidan keyin boʻlishi kerak.',

    bookedOverlap: 'Bu maqsad ({{noun}}) uchun bir-biriga toʻgʻri keladigan vaqt allaqachon band qilingan:',
    clashWithDenominatorOne:
      'Tanlagan {{denominator}} ta qurilmangizdan {{count}} tasi uchun bu vaqtga allaqachon kontent rejalashtirilgan:',
    clashWithDenominatorOtherHas:
      'Tanlagan {{denominator}} ta qurilmangizdan {{count}} tasi uchun bu vaqtga allaqachon kontent rejalashtirilgan:',
    clashWithDenominatorOther:
      'Tanlagan {{denominator}} ta qurilmangizdan {{count}} tasi uchun bu vaqtga allaqachon kontent rejalashtirilgan:',
    clashNoDenominatorOne:
      'Tanlagan qurilmalaringizdan {{count}} tasi uchun bu vaqtga allaqachon kontent rejalashtirilgan:',
    clashNoDenominatorOther:
      'Tanlagan qurilmalaringizdan {{count}} tasi uchun bu vaqtga allaqachon kontent rejalashtirilgan:',
    chooseDifferentTime: 'Boshqa vaqtni tanlash',
    replaceAndAssign: 'Mavjudni almashtirib tayinlash',

    summaryDevicesReceive: '«{{name}}»dan bu kontentni oladi.',
    summaryFineprint:
      'Hozirda oflayn boʻlgan har qanday qurilma keyingi safar ulanganda bu kontentni qoʻllaydi.',
    noTargetDash: '—',

    assignedSuccess: 'Tayinlandi: {{label}}.',
    replacedSuccess: 'Mavjud kontent almashtirildi — tayinlandi: {{label}}.',
    couldNotConfirm: 'Tayinlovni tasdiqlab boʻlmadi.',
    couldNotReplace: 'Mavjud tayinlovni almashtirib boʻlmadi. Qayta urinib koʻring.',

    discardTitle: 'Tayinlov bekor qilinsinmi?',
    discardMessage: 'Maqsad, tanlov va jadvaldagi barcha oʻzgarishlar yoʻqoladi.',
    discard: 'Bekor qilish',
    keepEditing: 'Tahrirni davom ettirish',

    replaceTitle: 'Mavjud kontent almashtirilsinmi?',
    replaceRemoveOne: 'Bu mavjud bandlovni oʻchiradi:',
    replaceRemoveOther: 'Bu mavjud bandlovlarni oʻchiradi:',
    replaceRunInstead: 'va oʻrniga <0>«{{name}}»</0>ni ishga tushiradi.',
    newPlaylistFallback: 'yangi pleylist',
    replaceConfirmLabel: 'Almashtirib tayinlash',
  } satisfies typeof en,
};
