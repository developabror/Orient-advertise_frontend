const en = {
  // Drawer chrome
  title: 'Schedules',
  titleWithFile: 'Schedules — {{filename}}',
  allTimesShownTashkent: 'All times shown in Tashkent (UTC+5).',
  newSchedule: '+ New schedule',

  // Form
  allTimesTashkent: 'All times in Tashkent (UTC+5).',
  start: 'Start',
  end: 'End',
  endAfterStart: 'End time must be after start time.',
  overlapWarning:
    '⚠ This range overlaps with another schedule. Both will run; the device will play whichever has higher priority.',
  cancel: 'Cancel',
  saveChanges: 'Save changes',
  createSchedule: 'Create schedule',

  // List states
  loading: 'Loading schedules',
  retry: 'Retry',
  emptyTitle: 'No schedules yet',
  emptyDescription: 'Create one to start playing this content on a target.',

  // Status badges
  status_active: 'Active',
  status_upcoming: 'Upcoming',
  status_open: 'Open',
  status_expired: 'Expired',

  // Row actions
  edit: 'Edit',
  delete: 'Delete',

  // Toasts
  toastCreated: 'Schedule created.',
  toastUpdated: 'Schedule updated.',
  toastDeleted: 'Schedule deleted.',

  // Delete confirm
  confirmDeleteTitle: 'Delete schedule?',
  confirmDeleteMessage:
    'This stops the schedule and removes it from the list. This cannot be undone.',
  keep: 'Keep',
};

export const dict = {
  en,
  ru: {
    title: 'Расписания',
    titleWithFile: 'Расписания — {{filename}}',
    allTimesShownTashkent: 'Всё время показано по Ташкенту (UTC+5).',
    newSchedule: '+ Новое расписание',

    allTimesTashkent: 'Всё время по Ташкенту (UTC+5).',
    start: 'Начало',
    end: 'Окончание',
    endAfterStart: 'Время окончания должно быть позже времени начала.',
    overlapWarning:
      '⚠ Этот диапазон пересекается с другим расписанием. Оба будут выполняться; устройство воспроизведёт то, у которого выше приоритет.',
    cancel: 'Отмена',
    saveChanges: 'Сохранить изменения',
    createSchedule: 'Создать расписание',

    loading: 'Загрузка расписаний',
    retry: 'Повторить',
    emptyTitle: 'Пока нет расписаний',
    emptyDescription: 'Создайте расписание, чтобы начать показ этого контента на цели.',

    status_active: 'Активно',
    status_upcoming: 'Предстоит',
    status_open: 'Открыто',
    status_expired: 'Истекло',

    edit: 'Изменить',
    delete: 'Удалить',

    toastCreated: 'Расписание создано.',
    toastUpdated: 'Расписание обновлено.',
    toastDeleted: 'Расписание удалено.',

    confirmDeleteTitle: 'Удалить расписание?',
    confirmDeleteMessage:
      'Это остановит расписание и удалит его из списка. Это действие нельзя отменить.',
    keep: 'Оставить',
  } satisfies typeof en,
  uz: {
    title: 'Jadvallar',
    titleWithFile: 'Jadvallar — {{filename}}',
    allTimesShownTashkent: 'Barcha vaqtlar Toshkent boʻyicha koʻrsatilgan (UTC+5).',
    newSchedule: '+ Yangi jadval',

    allTimesTashkent: 'Barcha vaqtlar Toshkent boʻyicha (UTC+5).',
    start: 'Boshlanish',
    end: 'Tugash',
    endAfterStart: 'Tugash vaqti boshlanish vaqtidan keyin boʻlishi kerak.',
    overlapWarning:
      '⚠ Bu oraliq boshqa jadval bilan kesishadi. Ikkalasi ham ishlaydi; qurilma ustuvorligi yuqori boʻlganini ijro etadi.',
    cancel: 'Bekor qilish',
    saveChanges: 'Oʻzgarishlarni saqlash',
    createSchedule: 'Jadval yaratish',

    loading: 'Jadvallar yuklanmoqda',
    retry: 'Qayta urinish',
    emptyTitle: 'Hozircha jadvallar yoʻq',
    emptyDescription: 'Bu kontentni maqsadda ijro etishni boshlash uchun jadval yarating.',

    status_active: 'Faol',
    status_upcoming: 'Kutilmoqda',
    status_open: 'Ochiq',
    status_expired: 'Muddati tugagan',

    edit: 'Tahrirlash',
    delete: 'Oʻchirish',

    toastCreated: 'Jadval yaratildi.',
    toastUpdated: 'Jadval yangilandi.',
    toastDeleted: 'Jadval oʻchirildi.',

    confirmDeleteTitle: 'Jadval oʻchirilsinmi?',
    confirmDeleteMessage:
      'Bu jadvalni toʻxtatadi va roʻyxatdan oʻchiradi. Buni qaytarib boʻlmaydi.',
    keep: 'Qoldirish',
  } satisfies typeof en,
};
