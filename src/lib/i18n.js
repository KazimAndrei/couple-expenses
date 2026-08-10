// ---- i18n: словари ru/en + t()/getLang()/setLang() ----
// Язык хранится в localStorage (ce_lang), смена языка перерисовывает всё через reload.
// ВАЖНО: канонические имена (Андрей/Полина), значения из БД и diagStep/console-сообщения
// здесь не участвуют — переводится только пользовательский UI.

const LANG_KEY = 'ce_lang';

export const LANG_LABELS = { ru: 'Русский', en: 'English' };

const ru = {
  // Boot / offline (main.js)
  'boot.slowTitle': 'Долго загружается',
  'boot.slowText': 'Проверьте интернет и перезапустите приложение',
  'boot.restart': 'Перезапустить приложение',
  'boot.offline': 'Нет подключения к интернету',

  // Router
  'router.loadFailed': 'Не удалось загрузить экран',
  'router.retry': 'Повторить',

  // Tab bar
  'tabs.home': 'Главная',
  'tabs.analytics': 'Аналитика',
  'tabs.goals': 'Цели',
  'tabs.profile': 'Профиль',

  // Errors (services/errors.js)
  'errors.unknown': 'Неизвестная ошибка',
  'errors.network': 'Проблема с сетью. Проверь интернет и попробуй снова.',
  'errors.auth': 'Ошибка авторизации. Выйдите и войдите снова.',
  'errors.permission': 'Недостаточно прав для этой операции.',
  'errors.duplicate': 'Такая запись уже существует.',

  // Common
  'common.error': 'Ошибка: {msg}',
  'common.save': 'Сохранить',
  'common.add': 'Добавить',
  'common.create': 'Создать',
  'common.cancel': 'Отмена',
  'common.delete': 'Удалить',
  'common.undo': 'Отменить',
  'common.shared': 'Общее',
  'common.member': 'Участник',
  'common.copy': 'Копировать',
  'common.copied': 'Скопировано',
  'common.apply': 'Применить',
  'common.reset': 'Сбросить',
  'common.name': 'Название',
  'common.category': 'Категория',
  'common.amount': 'Сумма',
  'common.date': 'Дата',
  'common.other': 'Другое',
  'common.edit': 'Изменить',
  'common.linkCopied': 'Ссылка скопирована',
  'common.enterTitle': 'Введите название',
  'common.enterName': 'Введите имя',
  'common.enterAmount': 'Введите сумму',

  // Dates
  'date.today': 'Сегодня',
  'date.yesterday': 'Вчера',

  // Theme labels (модалка темы в профиле)
  'theme.system': 'Как в системе',
  'theme.light': 'Светлая',
  'theme.dark': 'Тёмная',

  // Auth
  'auth.tapToSignIn': 'Нажмите, чтобы войти',
  'auth.subtitle': 'Совместный учёт расходов<br>для вас двоих',
  'auth.signInApple': 'Войти через Apple',
  'auth.signInGuest': 'Войти как гость (dev)',
  'auth.signInError': 'Ошибка входа: {msg}',

  // Setup
  'setup.title': 'Настройка пары',
  'setup.subtitle': 'Создайте общее пространство или присоединитесь к партнёру',
  'setup.yourName': 'Ваше имя',
  'setup.namePlaceholder': 'Андрей',
  'setup.createTitle': 'Создать пару',
  'setup.createText': 'Получите ссылку-приглашение для партнёра',
  'setup.joinTitle': 'Присоединиться',
  'setup.joinInvitedText': 'Вас пригласили в пару',
  'setup.joinText': 'Введите код от партнёра',
  'setup.createOwnTitle': 'Создать свою пару',
  'setup.createOwnText': 'Не хочу присоединяться по приглашению',
  'setup.sendPartnerLink': 'Отправьте партнёру ссылку:',
  'setup.share': 'Поделиться',
  'setup.start': 'Начать',
  'setup.inviteCode': 'Код приглашения',
  'setup.enterCode': 'Введите код',
  'setup.joining': 'Входим...',
  'setup.joined': 'Вы присоединились!',
  'setup.shareText': 'Присоединяйся к нашей паре в CoupleExpenses',

  // Invite (profile share)
  'invite.shareText': 'Присоединяйся к нашей паре',

  // Home
  'home.title': 'Расходы',
  'home.searchPlaceholder': 'Поиск по описанию',
  'home.filters': 'Фильтры',
  'home.all': 'Все',
  'home.monthIncome': 'Доход за месяц',
  'home.remaining': 'Остаток: {amount} ({pct}%)',
  'home.setIncomeHint': 'Нажмите ⚙ чтобы указать доход',
  'home.expensesOf': '{name} расходы',
  'home.totalLabel': 'Общие',
  'home.txCount': '{count} транзакций',
  'home.emptyMonth': 'Нет расходов за этот месяц',
  'home.addExpense': 'Добавить расход',
  'home.newExpense': 'Новый расход',
  'home.descPlaceholder': 'Что купили?',
  'home.description': 'Описание',
  'home.whoPays': 'Кто платит',
  'home.makeRecurring': 'Сделать ежемесячным шаблоном',
  'home.newCategory': 'Новая категория',
  'home.catNamePlaceholder': 'Например: Кофе',
  'home.icon': 'Иконка',
  'home.color': 'Цвет',
  'home.categoryAdded': 'Категория добавлена',
  'home.enterDescription': 'Введите описание',
  'home.expenseAdded': 'Расход добавлен',
  'home.recurringNotCreated': 'Расход добавлен, но шаблон повторения не создан: {msg}',
  'home.addUndone': 'Добавление отменено',
  'home.undoFailed': 'Не удалось отменить: {msg}',
  'home.memberNotJoined': '{name} еще не присоединился(ась) к паре',
  'home.allCategories': 'Все категории',
  'home.amountFrom': 'Сумма от',
  'home.amountTo': 'Сумма до',
  'home.dateFrom': 'Дата от',
  'home.dateTo': 'Дата до',
  'home.duplicate': 'Дублировать',
  'home.editExpense': 'Изменить расход',
  'home.expenseUpdated': 'Расход обновлен',
  'home.duplicateSuffix': ' (копия)',
  'home.expenseDuplicated': 'Расход продублирован',
  'home.deleted': 'Удалено',
  'home.restored': 'Восстановлено',
  'home.restoreFailed': 'Не удалось восстановить',
  'home.incomeEmptyHint': 'Добавляйте поступления по одному — для каждой записи сохраняются дата и кто внёс данные (видно в аналитике).',
  'home.addIncomeLabel': 'Добавить поступление ({currency})',
  'home.incomeAdded': 'Доход добавлен',
  'home.enterAmountPositive': 'Введите сумму больше 0',

  // Analytics
  'analytics.title': 'Аналитика',
  'analytics.totalOf': 'Всего у {name}',
  'analytics.total': 'Всего',
  'analytics.avgPerDay': 'Среднее/день',
  'analytics.vsPrevMonth': 'К прошлому месяцу',
  'analytics.topCategory': 'Топ категория',
  'analytics.paid': '{name} оплатил(а)',
  'analytics.incomeSection': 'Поступления (доход)',
  'analytics.noIncome': 'Нет записей о доходах за этот месяц',
  'analytics.deleteEntryAria': 'Удалить запись',
  'analytics.byCategory': 'По категориям',
  'analytics.noData': 'Нет данных',
  'analytics.budgets': 'Бюджеты',
  'analytics.addAction': '+ Добавить',
  'analytics.noBudgets': 'Бюджеты не настроены',
  'analytics.addBudget': 'Добавить бюджет',
  'analytics.newBudget': 'Новый бюджет',
  'analytics.limit': 'Лимит ({currency})',
  'analytics.enterLimit': 'Введите лимит',
  'analytics.budgetAdded': 'Бюджет добавлен',
  'analytics.pctUsed': '{pct}% использовано',
  'analytics.categoryFallback': 'Категория',
  'analytics.manageBudget': 'Управление бюджетом',
  'analytics.deleteBudget': 'Удалить бюджет',
  'analytics.budgetDeleted': 'Бюджет удалён',
  'analytics.confirmDeleteIncome': 'Удалить запись о доходе {amount}?',
  'analytics.incomeDeleted': 'Запись удалена',

  // Goals
  'goals.title': 'Общие цели',
  'goals.empty': 'Создайте первую общую цель',
  'goals.createGoal': 'Создать цель',
  'goals.newGoal': 'Новая цель',
  'goals.namePlaceholder': 'Отпуск в Японию',
  'goals.targetAmount': 'Целевая сумма ({currency})',
  'goals.targetAmountShort': 'Целевая сумма',
  'goals.deadlineOptional': 'Дедлайн (опционально)',
  'goals.deadline': 'Дедлайн',
  'goals.created': 'Цель создана',
  'goals.progress': 'Прогресс: {current} из {target}',
  'goals.amounts': '{current} из {target}',
  'goals.until': ' — до {date}',
  'goals.topUp': 'Пополнить',
  'goals.editGoal': 'Изменить цель',
  'goals.deleteGoal': 'Удалить цель',
  'goals.toppedUp': 'Пополнено',
  'goals.updated': 'Цель обновлена',
  'goals.deletedToast': 'Цель удалена',

  // Profile
  'profile.title': 'Профиль',
  'profile.changePhotoAria': 'Изменить фото',
  'profile.keyLabel': 'Ключ: {code}',
  'profile.editName': 'Изменить имя',
  'profile.removePhoto': 'Удалить фото',
  'profile.sendInvite': 'Отправить приглашение партнёру',
  'profile.inviteCodeLabel': 'Код приглашения:',
  'profile.coupleSettings': 'Настройки пары',
  'profile.themeLabel': 'Тема:',
  'profile.languageLabel': 'Язык:',
  'profile.logout': 'Выйти',
  'profile.chooseImage': 'Выбери изображение',
  'profile.fileTooBig': 'Файл слишком большой. Максимум 5MB',
  'profile.photoUpdated': 'Фото профиля обновлено',
  'profile.photoRemoved': 'Фото удалено',
  'profile.mainCurrency': 'Основная валюта',
  'profile.partnerInviteCode': 'Код приглашения для партнёра',
  'profile.settingsSaved': 'Настройки сохранены',
  'profile.nameUpdated': 'Имя обновлено',
  'profile.codeCopied': 'Код скопирован',
  'profile.themeTitle': 'Тема оформления',
  'profile.languageTitle': 'Язык',
  'profile.currencyLabel': 'Валюта:',
  'profile.currencyTitle': 'Валюта пары',
  'profile.currencySaved': 'Валюта обновлена',
  'home.goalLabel': 'Отложить в цель',
  'home.goalNone': 'Без цели',
  'home.savedToGoal': 'Отложено на «{name}»',
  'home.savingLabel': 'Накопление',
};

const en = {
  // Boot / offline (main.js)
  'boot.slowTitle': 'Taking too long',
  'boot.slowText': 'Check your internet connection and restart the app',
  'boot.restart': 'Restart the app',
  'boot.offline': 'No internet connection',

  // Router
  'router.loadFailed': 'Failed to load this screen',
  'router.retry': 'Retry',

  // Tab bar
  'tabs.home': 'Home',
  'tabs.analytics': 'Analytics',
  'tabs.goals': 'Goals',
  'tabs.profile': 'Profile',

  // Errors (services/errors.js)
  'errors.unknown': 'Unknown error',
  'errors.network': 'Network problem. Check your connection and try again.',
  'errors.auth': 'Authorization error. Sign out and sign in again.',
  'errors.permission': 'You do not have permission for this action.',
  'errors.duplicate': 'This record already exists.',

  // Common
  'common.error': 'Error: {msg}',
  'common.save': 'Save',
  'common.add': 'Add',
  'common.create': 'Create',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.undo': 'Undo',
  'common.shared': 'Shared',
  'common.member': 'Member',
  'common.copy': 'Copy',
  'common.copied': 'Copied',
  'common.apply': 'Apply',
  'common.reset': 'Reset',
  'common.name': 'Name',
  'common.category': 'Category',
  'common.amount': 'Amount',
  'common.date': 'Date',
  'common.other': 'Other',
  'common.edit': 'Edit',
  'common.linkCopied': 'Link copied',
  'common.enterTitle': 'Enter a name',
  'common.enterName': 'Enter your name',
  'common.enterAmount': 'Enter an amount',

  // Dates
  'date.today': 'Today',
  'date.yesterday': 'Yesterday',

  // Theme labels
  'theme.system': 'System',
  'theme.light': 'Light',
  'theme.dark': 'Dark',

  // Auth
  'auth.tapToSignIn': 'Tap to sign in',
  'auth.subtitle': 'Shared expense tracking<br>for the two of you',
  'auth.signInApple': 'Sign in with Apple',
  'auth.signInGuest': 'Sign in as guest (dev)',
  'auth.signInError': 'Sign-in error: {msg}',

  // Setup
  'setup.title': 'Couple setup',
  'setup.subtitle': 'Create a shared space or join your partner',
  'setup.yourName': 'Your name',
  'setup.namePlaceholder': 'Andrei',
  'setup.createTitle': 'Create a couple',
  'setup.createText': 'Get an invite link for your partner',
  'setup.joinTitle': 'Join',
  'setup.joinInvitedText': 'You have been invited to a couple',
  'setup.joinText': 'Enter your partner’s code',
  'setup.createOwnTitle': 'Create my own couple',
  'setup.createOwnText': 'I don’t want to join via invite',
  'setup.sendPartnerLink': 'Send this link to your partner:',
  'setup.share': 'Share',
  'setup.start': 'Get started',
  'setup.inviteCode': 'Invite code',
  'setup.enterCode': 'Enter the code',
  'setup.joining': 'Joining...',
  'setup.joined': 'You have joined!',
  'setup.shareText': 'Join our couple in CoupleExpenses',

  // Invite (profile share)
  'invite.shareText': 'Join our couple',

  // Home
  'home.title': 'Expenses',
  'home.searchPlaceholder': 'Search descriptions',
  'home.filters': 'Filters',
  'home.all': 'All',
  'home.monthIncome': 'Income this month',
  'home.remaining': 'Left: {amount} ({pct}%)',
  'home.setIncomeHint': 'Tap ⚙ to set your income',
  'home.expensesOf': '{name} expenses',
  'home.totalLabel': 'Total',
  'home.txCount': '{count} transactions',
  'home.emptyMonth': 'No expenses this month',
  'home.addExpense': 'Add expense',
  'home.newExpense': 'New expense',
  'home.descPlaceholder': 'What did you buy?',
  'home.description': 'Description',
  'home.whoPays': 'Who pays',
  'home.makeRecurring': 'Repeat monthly',
  'home.newCategory': 'New category',
  'home.catNamePlaceholder': 'e.g. Coffee',
  'home.icon': 'Icon',
  'home.color': 'Color',
  'home.categoryAdded': 'Category added',
  'home.enterDescription': 'Enter a description',
  'home.expenseAdded': 'Expense added',
  'home.recurringNotCreated': 'Expense added, but the recurring template was not created: {msg}',
  'home.addUndone': 'Expense removed',
  'home.undoFailed': 'Could not undo: {msg}',
  'home.memberNotJoined': '{name} has not joined the couple yet',
  'home.allCategories': 'All categories',
  'home.amountFrom': 'Amount from',
  'home.amountTo': 'Amount to',
  'home.dateFrom': 'Date from',
  'home.dateTo': 'Date to',
  'home.duplicate': 'Duplicate',
  'home.editExpense': 'Edit expense',
  'home.expenseUpdated': 'Expense updated',
  'home.duplicateSuffix': ' (copy)',
  'home.expenseDuplicated': 'Expense duplicated',
  'home.deleted': 'Deleted',
  'home.restored': 'Restored',
  'home.restoreFailed': 'Could not restore',
  'home.incomeEmptyHint': 'Add income entries one at a time — each entry keeps its date and author (visible in Analytics).',
  'home.addIncomeLabel': 'Add income ({currency})',
  'home.incomeAdded': 'Income added',
  'home.enterAmountPositive': 'Enter an amount greater than 0',

  // Analytics
  'analytics.title': 'Analytics',
  'analytics.totalOf': '{name} total',
  'analytics.total': 'Total',
  'analytics.avgPerDay': 'Avg/day',
  'analytics.vsPrevMonth': 'vs last month',
  'analytics.topCategory': 'Top category',
  'analytics.paid': '{name} paid',
  'analytics.incomeSection': 'Income entries',
  'analytics.noIncome': 'No income entries this month',
  'analytics.deleteEntryAria': 'Delete entry',
  'analytics.byCategory': 'By category',
  'analytics.noData': 'No data',
  'analytics.budgets': 'Budgets',
  'analytics.addAction': '+ Add',
  'analytics.noBudgets': 'No budgets yet',
  'analytics.addBudget': 'Add budget',
  'analytics.newBudget': 'New budget',
  'analytics.limit': 'Limit ({currency})',
  'analytics.enterLimit': 'Enter a limit',
  'analytics.budgetAdded': 'Budget added',
  'analytics.pctUsed': '{pct}% used',
  'analytics.categoryFallback': 'Category',
  'analytics.manageBudget': 'Manage budget',
  'analytics.deleteBudget': 'Delete budget',
  'analytics.budgetDeleted': 'Budget deleted',
  'analytics.confirmDeleteIncome': 'Delete income entry {amount}?',
  'analytics.incomeDeleted': 'Entry deleted',

  // Goals
  'goals.title': 'Shared goals',
  'goals.empty': 'Create your first shared goal',
  'goals.createGoal': 'Create goal',
  'goals.newGoal': 'New goal',
  'goals.namePlaceholder': 'Trip to Japan',
  'goals.targetAmount': 'Target amount ({currency})',
  'goals.targetAmountShort': 'Target amount',
  'goals.deadlineOptional': 'Deadline (optional)',
  'goals.deadline': 'Deadline',
  'goals.created': 'Goal created',
  'goals.progress': 'Progress: {current} of {target}',
  'goals.amounts': '{current} of {target}',
  'goals.until': ' — by {date}',
  'goals.topUp': 'Top up',
  'goals.editGoal': 'Edit goal',
  'goals.deleteGoal': 'Delete goal',
  'goals.toppedUp': 'Topped up',
  'goals.updated': 'Goal updated',
  'goals.deletedToast': 'Goal deleted',

  // Profile
  'profile.title': 'Profile',
  'profile.changePhotoAria': 'Change photo',
  'profile.keyLabel': 'Key: {code}',
  'profile.editName': 'Edit name',
  'profile.removePhoto': 'Remove photo',
  'profile.sendInvite': 'Send invite to partner',
  'profile.inviteCodeLabel': 'Invite code:',
  'profile.coupleSettings': 'Couple settings',
  'profile.themeLabel': 'Theme:',
  'profile.languageLabel': 'Language:',
  'profile.logout': 'Sign out',
  'profile.chooseImage': 'Choose an image',
  'profile.fileTooBig': 'File is too large. Max 5MB',
  'profile.photoUpdated': 'Profile photo updated',
  'profile.photoRemoved': 'Photo removed',
  'profile.mainCurrency': 'Main currency',
  'profile.partnerInviteCode': 'Invite code for your partner',
  'profile.settingsSaved': 'Settings saved',
  'profile.nameUpdated': 'Name updated',
  'profile.codeCopied': 'Code copied',
  'profile.themeTitle': 'Appearance',
  'profile.languageTitle': 'Language',
  'profile.currencyLabel': 'Currency:',
  'profile.currencyTitle': 'Couple currency',
  'profile.currencySaved': 'Currency updated',
  'home.goalLabel': 'Put into a goal',
  'home.goalNone': 'No goal',
  'home.savedToGoal': 'Saved to “{name}”',
  'home.savingLabel': 'Saving',
};

const dictionaries = { ru, en };

// Месяцы/дни недели — переключаются вместе с языком (используются в utils.js)
const MONTHS = {
  ru: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
};
const DAYS_SHORT = {
  ru: ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

export function getLang() {
  try {
    const value = localStorage.getItem(LANG_KEY);
    return value === 'en' ? 'en' : 'ru';
  } catch {
    // localStorage недоступен (node/тесты/приватный режим) — дефолт ru
    return 'ru';
  }
}

export function setLang(lang) {
  const next = lang === 'en' ? 'en' : 'ru';
  try {
    localStorage.setItem(LANG_KEY, next);
  } catch {
    // ignore
  }
  window.location.reload();
}

/**
 * Перевод по плоскому ключу с подстановкой {name}-переменных.
 * Fallback: текущий язык → ru → сам ключ.
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 */
export function t(key, vars) {
  const lang = getLang();
  let str = dictionaries[lang]?.[key] ?? ru[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      str = str.replaceAll(`{${name}}`, String(value));
    }
  }
  return str;
}

/** Полное имя месяца (0-11) на текущем языке. */
export function monthName(index) {
  return (MONTHS[getLang()] || MONTHS.ru)[index];
}

/** Короткое имя месяца (0-11): ru — «янв», en — «Jan». */
export function monthShort(index) {
  const name = monthName(index) || '';
  return getLang() === 'ru' ? name.toLowerCase().slice(0, 3) : name.slice(0, 3);
}

/** Короткое имя дня недели (0=Вс..6=Сб) на текущем языке. */
export function dayShort(index) {
  return (DAYS_SHORT[getLang()] || DAYS_SHORT.ru)[index];
}

/** Локаль для Intl-форматирования дат/чисел. */
export function dateLocale() {
  return getLang() === 'en' ? 'en-US' : 'ru-RU';
}
