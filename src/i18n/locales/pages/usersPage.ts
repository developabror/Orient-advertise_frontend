const en = {
  title: 'Users',
  subtitle:
    'Manage admins, operators, viewers, and advertisers. Deletion is irreversible — for advertisers, all linked content access is removed in the same transaction.',
  createUser: 'Create user',

  searchLabel: 'Search',
  searchPlaceholder: 'Name or email…',
  allRoles: 'All roles',
  allStatuses: 'All',

  colUsername: 'Username',
  colRole: 'Role',
  colStatus: 'Status',

  role_admin: 'Admin',
  role_operator: 'Operator',
  role_viewer: 'Viewer',
  role_advertiser: 'Advertiser',

  statusActive: 'Active',
  statusInactive: 'Inactive',

  contentLinked_one: '{{count}} content linked',
  contentLinked_other: '{{count}} contents linked',
  manageAccess: 'Manage access →',

  delete: 'Delete',
  deleteAria: 'Delete {{email}}',
  deleteSelfTitle: 'You cannot delete your own account.',
  deleteUserTitle: 'Delete this user',

  retry: 'Retry',
  emptyTitle: 'No users match',
  emptyDescription: 'No users match the current filters. Adjust the search or create one.',

  userCount_one: '{{count}} user',
  userCount_other: '{{count}} users',

  confirmTitle: 'Delete user?',
  confirmMessage:
    'Permanently delete <strong>{{email}}</strong>? This is irreversible. For advertisers, all linked content access is removed in the same transaction.',
  confirmDelete: 'Delete user',
  cancel: 'Cancel',

  toastCreated: 'Created {{email}}.',
  toastDeleted: 'Deleted {{email}}.',
  toastDeleteFailed: 'Could not delete {{email}}.',
};

export const dict = {
  en,
  ru: {
    title: 'Пользователи',
    subtitle:
      'Управляйте администраторами, операторами, наблюдателями и рекламодателями. Удаление необратимо — для рекламодателей весь доступ к связанному контенту удаляется в той же транзакции.',
    createUser: 'Создать пользователя',

    searchLabel: 'Поиск',
    searchPlaceholder: 'Имя или email…',
    allRoles: 'Все роли',
    allStatuses: 'Все',

    colUsername: 'Имя пользователя',
    colRole: 'Роль',
    colStatus: 'Статус',

    role_admin: 'Администратор',
    role_operator: 'Оператор',
    role_viewer: 'Наблюдатель',
    role_advertiser: 'Рекламодатель',

    statusActive: 'Активен',
    statusInactive: 'Неактивен',

    contentLinked_one: 'Связан {{count}} контент',
    contentLinked_other: 'Связано контента: {{count}}',
    manageAccess: 'Управление доступом →',

    delete: 'Удалить',
    deleteAria: 'Удалить {{email}}',
    deleteSelfTitle: 'Вы не можете удалить собственную учётную запись.',
    deleteUserTitle: 'Удалить этого пользователя',

    retry: 'Повторить',
    emptyTitle: 'Нет совпадений',
    emptyDescription:
      'Нет пользователей, соответствующих текущим фильтрам. Измените поиск или создайте нового.',

    userCount_one: '{{count}} пользователь',
    userCount_other: 'Пользователей: {{count}}',

    confirmTitle: 'Удалить пользователя?',
    confirmMessage:
      'Безвозвратно удалить <strong>{{email}}</strong>? Это действие необратимо. Для рекламодателей весь доступ к связанному контенту удаляется в той же транзакции.',
    confirmDelete: 'Удалить пользователя',
    cancel: 'Отмена',

    toastCreated: 'Создан {{email}}.',
    toastDeleted: 'Удалён {{email}}.',
    toastDeleteFailed: 'Не удалось удалить {{email}}.',
  } satisfies typeof en,
  uz: {
    title: 'Foydalanuvchilar',
    subtitle:
      'Administratorlar, operatorlar, kuzatuvchilar va reklama beruvchilarni boshqaring. Oʻchirish qaytarib boʻlmaydi — reklama beruvchilar uchun bogʻlangan barcha kontentga kirish ayni tranzaksiyada olib tashlanadi.',
    createUser: 'Foydalanuvchi yaratish',

    searchLabel: 'Qidirish',
    searchPlaceholder: 'Ism yoki email…',
    allRoles: 'Barcha rollar',
    allStatuses: 'Barchasi',

    colUsername: 'Foydalanuvchi nomi',
    colRole: 'Rol',
    colStatus: 'Holat',

    role_admin: 'Administrator',
    role_operator: 'Operator',
    role_viewer: 'Kuzatuvchi',
    role_advertiser: 'Reklama beruvchi',

    statusActive: 'Faol',
    statusInactive: 'Nofaol',

    contentLinked_one: '{{count}} ta kontent bogʻlangan',
    contentLinked_other: '{{count}} ta kontent bogʻlangan',
    manageAccess: 'Kirishni boshqarish →',

    delete: 'Oʻchirish',
    deleteAria: '{{email}} ni oʻchirish',
    deleteSelfTitle: 'Oʻz hisobingizni oʻchira olmaysiz.',
    deleteUserTitle: 'Bu foydalanuvchini oʻchirish',

    retry: 'Qayta urinish',
    emptyTitle: 'Mos foydalanuvchi yoʻq',
    emptyDescription:
      'Joriy filtrlarga mos foydalanuvchi yoʻq. Qidiruvni oʻzgartiring yoki yangisini yarating.',

    userCount_one: '{{count}} ta foydalanuvchi',
    userCount_other: '{{count}} ta foydalanuvchi',

    confirmTitle: 'Foydalanuvchi oʻchirilsinmi?',
    confirmMessage:
      '<strong>{{email}}</strong> butunlay oʻchirilsinmi? Bu qaytarib boʻlmaydi. Reklama beruvchilar uchun bogʻlangan barcha kontentga kirish ayni tranzaksiyada olib tashlanadi.',
    confirmDelete: 'Foydalanuvchini oʻchirish',
    cancel: 'Bekor qilish',

    toastCreated: '{{email}} yaratildi.',
    toastDeleted: '{{email}} oʻchirildi.',
    toastDeleteFailed: '{{email}} ni oʻchirib boʻlmadi.',
  } satisfies typeof en,
};
