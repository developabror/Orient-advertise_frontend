const en = {
  // Page header / filters
  title: 'Playlists',
  newPlaylist: '+ New playlist',
  project: 'Project',
  name: 'Name',
  allProjects: 'All projects',
  searchByName: 'Search by name…',
  unassigned: 'Unassigned',

  // Table
  colName: 'Name',
  colProject: 'Project',
  colItems: 'Items',
  colDuration: 'Duration',
  emptyTitle: 'No playlists yet',
  emptyTitleFiltered: 'No matching playlists',
  emptyDescMutate: 'Create one to get started.',
  emptyDescReadonly: 'Playlists will appear here once created.',

  // Drawer
  playlist: 'Playlist',
  close: 'Close',
  rename: 'Rename',
  delete: 'Delete',
  cancel: 'Cancel',
  save: 'Save',
  loading: 'Loading…',
  totalDuration: 'Total duration',
  lastUpdated: 'Last updated',
  itemsHeading: 'Items ({{count}})',
  addItem: '+ Add item',
  noItems: 'No items yet.',
  remove: 'Remove',

  // Reorder / accessibility
  listAriaLabel: 'Playlist items — use arrow keys to reorder',
  reorderableItem: 'Reorderable item',
  itemPosition: '{{name}} — position {{position}} of {{total}}',
  moveUp: 'Move {{name}} up',
  moveUpTitle: 'Move up',
  moveDown: 'Move {{name}} down',
  moveDownTitle: 'Move down',
  movedAnnouncement: 'Moved {{name}} to position {{position}} of {{total}}.',
  orderSaved: 'Order saved — devices apply the new order on their next sync.',

  // Delete confirm
  deleteConfirmTitle: 'Delete playlist?',
  deleteConfirmMessage: 'Playlist "{{name}}" will be removed. This cannot be undone.',

  // Create modal
  newPlaylistTitle: 'New playlist',
  create: 'Create',
  selectProject: 'Select a project…',

  // Content picker
  addPlaylistItem: 'Add playlist item',
  pickerNotice: 'Showing the first {{count}} READY content files.',
  pickerNoticeProject: 'Showing the first {{count}} READY content files in {{project}}.',
  noReadyContent: 'No READY content available.',
  add: 'Add',

  // Errors / toasts
  errLoadList: 'Failed to load playlists.',
  errLoadPlaylist: 'Failed to load playlist.',
  errSaveChanges: 'Failed to save changes.',
  errDeletePlaylist: 'Failed to delete playlist.',
  errProjectNameRequired: 'Project and name are required.',
  errCreatePlaylist: 'Failed to create playlist.',
  errLoadContent: 'Failed to load content.',
  errAddItem: 'Failed to add item.',
  errRemoveItem: 'Failed to remove item.',
  errReorder: 'Failed to reorder items.',

  // Dwell / duration editor
  dwellInputLabel: 'Dwell time in seconds for {{name}}',
  dwellPlaceholder: 'sec',
  dwellWarning: 'No dwell time set — this image will not display until you set one.',
  dwellRequired: 'Images need a positive dwell time (in seconds).',
  dwellRange: 'Enter a whole number of seconds between {{min}} and {{max}}.',
  imageDwellHint: 'Images need a dwell time (seconds). Videos play for their own length.',
  errSetDuration: 'Failed to set duration.',
};

export const dict = {
  en,
  ru: {
    // Page header / filters
    title: 'Плейлисты',
    newPlaylist: '+ Новый плейлист',
    project: 'Проект',
    name: 'Название',
    allProjects: 'Все проекты',
    searchByName: 'Поиск по названию…',
    unassigned: 'Не назначен',

    // Table
    colName: 'Название',
    colProject: 'Проект',
    colItems: 'Элементы',
    colDuration: 'Длительность',
    emptyTitle: 'Плейлистов пока нет',
    emptyTitleFiltered: 'Подходящих плейлистов нет',
    emptyDescMutate: 'Создайте плейлист, чтобы начать.',
    emptyDescReadonly: 'Плейлисты появятся здесь после создания.',

    // Drawer
    playlist: 'Плейлист',
    close: 'Закрыть',
    rename: 'Переименовать',
    delete: 'Удалить',
    cancel: 'Отмена',
    save: 'Сохранить',
    loading: 'Загрузка…',
    totalDuration: 'Общая длительность',
    lastUpdated: 'Последнее изменение',
    itemsHeading: 'Элементы ({{count}})',
    addItem: '+ Добавить элемент',
    noItems: 'Элементов пока нет.',
    remove: 'Удалить',

    // Reorder / accessibility
    listAriaLabel: 'Элементы плейлиста — используйте стрелки для изменения порядка',
    reorderableItem: 'Перемещаемый элемент',
    itemPosition: '{{name}} — позиция {{position}} из {{total}}',
    moveUp: 'Переместить {{name}} вверх',
    moveUpTitle: 'Вверх',
    moveDown: 'Переместить {{name}} вниз',
    moveDownTitle: 'Вниз',
    movedAnnouncement: '{{name}} перемещён на позицию {{position}} из {{total}}.',
    orderSaved: 'Порядок сохранён — устройства применят новый порядок при следующей синхронизации.',

    // Delete confirm
    deleteConfirmTitle: 'Удалить плейлист?',
    deleteConfirmMessage: 'Плейлист «{{name}}» будет удалён. Это действие необратимо.',

    // Create modal
    newPlaylistTitle: 'Новый плейлист',
    create: 'Создать',
    selectProject: 'Выберите проект…',

    // Content picker
    addPlaylistItem: 'Добавить элемент плейлиста',
    pickerNotice: 'Показаны первые {{count}} файлов контента со статусом READY.',
    pickerNoticeProject: 'Показаны первые {{count}} файлов контента со статусом READY в проекте {{project}}.',
    noReadyContent: 'Нет доступного контента со статусом READY.',
    add: 'Добавить',

    // Errors / toasts
    errLoadList: 'Не удалось загрузить плейлисты.',
    errLoadPlaylist: 'Не удалось загрузить плейлист.',
    errSaveChanges: 'Не удалось сохранить изменения.',
    errDeletePlaylist: 'Не удалось удалить плейлист.',
    errProjectNameRequired: 'Проект и название обязательны.',
    errCreatePlaylist: 'Не удалось создать плейлист.',
    errLoadContent: 'Не удалось загрузить контент.',
    errAddItem: 'Не удалось добавить элемент.',
    errRemoveItem: 'Не удалось удалить элемент.',
    errReorder: 'Не удалось изменить порядок элементов.',

    // Dwell / duration editor
    dwellInputLabel: 'Время показа в секундах для {{name}}',
    dwellPlaceholder: 'сек',
    dwellWarning: 'Время показа не задано — это изображение не будет отображаться, пока вы его не зададите.',
    dwellRequired: 'Для изображений нужно задать положительное время показа (в секундах).',
    dwellRange: 'Введите целое число секунд от {{min}} до {{max}}.',
    imageDwellHint: 'Для изображений нужно время показа (в секундах). Видео воспроизводится по своей длительности.',
    errSetDuration: 'Не удалось задать длительность.',
  } satisfies typeof en,
  uz: {
    // Page header / filters
    title: 'Pleylistlar',
    newPlaylist: '+ Yangi pleylist',
    project: 'Loyiha',
    name: 'Nomi',
    allProjects: 'Barcha loyihalar',
    searchByName: 'Nomi boʻyicha qidirish…',
    unassigned: 'Tayinlanmagan',

    // Table
    colName: 'Nomi',
    colProject: 'Loyiha',
    colItems: 'Elementlar',
    colDuration: 'Davomiyligi',
    emptyTitle: 'Hozircha pleylistlar yoʻq',
    emptyTitleFiltered: 'Mos pleylistlar yoʻq',
    emptyDescMutate: 'Boshlash uchun bittasini yarating.',
    emptyDescReadonly: 'Pleylistlar yaratilgach shu yerda koʻrinadi.',

    // Drawer
    playlist: 'Pleylist',
    close: 'Yopish',
    rename: 'Nomini oʻzgartirish',
    delete: 'Oʻchirish',
    cancel: 'Bekor qilish',
    save: 'Saqlash',
    loading: 'Yuklanmoqda…',
    totalDuration: 'Umumiy davomiyligi',
    lastUpdated: 'Oxirgi yangilanish',
    itemsHeading: 'Elementlar ({{count}})',
    addItem: '+ Element qoʻshish',
    noItems: 'Hozircha elementlar yoʻq.',
    remove: 'Olib tashlash',

    // Reorder / accessibility
    listAriaLabel: 'Pleylist elementlari — tartibni oʻzgartirish uchun strelkalardan foydalaning',
    reorderableItem: 'Koʻchiriladigan element',
    itemPosition: '{{name}} — {{total}} dan {{position}}-oʻrin',
    moveUp: '{{name}} ni yuqoriga koʻchirish',
    moveUpTitle: 'Yuqoriga',
    moveDown: '{{name}} ni pastga koʻchirish',
    moveDownTitle: 'Pastga',
    movedAnnouncement: '{{name}} {{total}} dan {{position}}-oʻringa koʻchirildi.',
    orderSaved: 'Tartib saqlandi — qurilmalar yangi tartibni keyingi sinxronlashda qoʻllaydi.',

    // Delete confirm
    deleteConfirmTitle: 'Pleylist oʻchirilsinmi?',
    deleteConfirmMessage: '«{{name}}» pleylisti oʻchiriladi. Buni qaytarib boʻlmaydi.',

    // Create modal
    newPlaylistTitle: 'Yangi pleylist',
    create: 'Yaratish',
    selectProject: 'Loyihani tanlang…',

    // Content picker
    addPlaylistItem: 'Pleylist elementini qoʻshish',
    pickerNotice: 'READY holatidagi dastlabki {{count}} ta kontent fayli koʻrsatilmoqda.',
    pickerNoticeProject: '{{project}} loyihasidagi READY holatidagi dastlabki {{count}} ta kontent fayli koʻrsatilmoqda.',
    noReadyContent: 'READY holatidagi kontent mavjud emas.',
    add: 'Qoʻshish',

    // Errors / toasts
    errLoadList: 'Pleylistlarni yuklab boʻlmadi.',
    errLoadPlaylist: 'Pleylistni yuklab boʻlmadi.',
    errSaveChanges: 'Oʻzgarishlarni saqlab boʻlmadi.',
    errDeletePlaylist: 'Pleylistni oʻchirib boʻlmadi.',
    errProjectNameRequired: 'Loyiha va nom kiritilishi shart.',
    errCreatePlaylist: 'Pleylistni yaratib boʻlmadi.',
    errLoadContent: 'Kontentni yuklab boʻlmadi.',
    errAddItem: 'Elementni qoʻshib boʻlmadi.',
    errRemoveItem: 'Elementni olib tashlab boʻlmadi.',
    errReorder: 'Elementlar tartibini oʻzgartirib boʻlmadi.',

    // Dwell / duration editor
    dwellInputLabel: '{{name}} uchun koʻrsatish vaqti (soniyada)',
    dwellPlaceholder: 'son',
    dwellWarning: 'Koʻrsatish vaqti belgilanmagan — siz belgilamaguningizcha bu rasm koʻrsatilmaydi.',
    dwellRequired: 'Rasmlar uchun musbat koʻrsatish vaqti (soniyada) kerak.',
    dwellRange: '{{min}} dan {{max}} gacha butun sonli soniyalar kiriting.',
    imageDwellHint: 'Rasmlar uchun koʻrsatish vaqti (soniyada) kerak. Videolar oʻz davomiyligi boʻyicha ijro etiladi.',
    errSetDuration: 'Davomiylikni belgilab boʻlmadi.',
  } satisfies typeof en,
};
