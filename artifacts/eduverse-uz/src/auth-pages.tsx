import { useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'wouter';
import {
  Activity,
  Atom,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Beaker,
  BookOpen,
  Calculator,
  CalendarDays,
  Check,
  ClipboardCheck,
  GraduationCap,
  Library,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Moon,
  MonitorPlay,
  Server,
  ShieldCheck,
  Sparkles,
  Smartphone,
  Sun,
  Target,
  Users,
} from 'lucide-react';
import type { User } from '@workspace/api-client-react';
import type { AppLanguage } from './localization';
import { getAuthErrorMessage, useAuth } from './auth-context';
import { QrApprovePanel, QrSignInPanel, QR_COPY } from './qr-login';
import { QrScannerButton } from './qr-scanner';
import { TwoFactorSettings } from './two-factor-settings';

type AuthCopy = {
  signIn: string;
  signUp: string;
  loginTitle: string;
  registerTitle: string;
  signInSubtitle: string;
  registerSubtitle: string;
  username: string;
  login: string;
  password: string;
  confirmPassword: string;
  displayNamePlaceholder: string;
  loginPlaceholder: string;
  submitLogin: string;
  submitRegister: string;
  noAccount: string;
  hasAccount: string;
  openMaterials: string;
  sideTitle: string;
  sideDescription: string;
  benefitOne: string;
  benefitTwo: string;
  emailNotice: string;
  language: string;
  profile: string;
  accountMode: string;
  accountDetails: string;
  createdAt: string;
  logout: string;
  home: string;
  loading: string;
  checking: string;
  retry: string;
  unavailableTitle: string;
  unavailableText: string;
  signInRequired: string;
  privateRequiredTitle: string;
  privateRequiredText: string;
  passwordMismatch: string;
  logoutError: string;
  independentLearner: string;
  role: string;
  serviceWarning: string;
  qrTitle: string;
  qrUnavailable: string;
  localAccess: string;
  twoFactorTitle: string;
  twoFactorSubtitle: string;
  twoFactorCode: string;
  twoFactorSubmit: string;
  twoFactorResend: string;
  twoFactorBack: string;
  twoFactorSent: string;
  twoFactorDevCode: string;
};

const AUTH_COPY: Record<AppLanguage, AuthCopy> = {
  Uzbek: {
    signIn: 'Kirish',
    signUp: 'Ro‘yxatdan o‘tish',
    loginTitle: 'Hisobingizga kiring',
    registerTitle: 'Hisob yarating',
    signInSubtitle: 'O‘qishni davom ettirish uchun EDUVERSE-UZ hisobingizga kiring.',
    registerSubtitle: 'EDUVERSE-UZ platformasida o‘qish jarayonini davom ettirish uchun hisob yarating.',
    username: 'Ismingiz',
    login: 'Login',
    password: 'Parol',
    confirmPassword: 'Parolni tasdiqlang',
    displayNamePlaceholder: 'Ism va familiya',
    loginPlaceholder: 'Loginni kiriting',
    submitLogin: 'Kirish',
    submitRegister: 'Hisob yaratish',
    noAccount: 'Hisobingiz bo‘lmasa, maktab administratori bilan bog‘laning.',
    hasAccount: 'Hisobingiz bormi?',
    openMaterials: 'Maktab platformasi',
    sideTitle: 'Bilim sari ishonchli qadam.',
    sideDescription: 'Maktab darslari, jadval, topshiriqlar va xavfsiz o‘quv vositalari bitta hisobda.',
    benefitOne: 'Shaxsiy o‘quv profilingiz',
    benefitTwo: 'Bitta xavfsiz, server boshqaradigan sessiya',
    emailNotice: 'Parolni tiklash hozircha mavjud emas: tasdiqlangan elektron pochta xizmati ulanmagan.',
    language: 'Til',
    profile: 'Profil',
    accountMode: 'HISOB',
    accountDetails: 'Hisob ma’lumotlari',
    createdAt: 'Hisob yaratilgan',
    logout: 'Hisobdan chiqish',
    home: 'Bosh sahifa',
    loading: 'Yuklanmoqda…',
    checking: 'Hisob sessiyasi tekshirilmoqda.',
    retry: 'Qayta urinish',
    unavailableTitle: 'Hisob xizmatiga ulanib bo‘lmadi',
    unavailableText: 'Server bilan aloqa vaqtincha mavjud emas. Birozdan so‘ng qayta urinib ko‘ring.',
    signInRequired: 'Profilni ko‘rish uchun tizimga kiring.',
    privateRequiredTitle: 'Bu bo‘lim uchun tizimga kiring.',
    privateRequiredText: 'Shaxsiy bo‘limlarga kirish server tasdiqlagan hisob huquqlariga bog‘liq.',
    passwordMismatch: 'Parollar mos kelmadi.',
    logoutError: 'Hisobdan chiqishda xatolik. Qayta urinib ko‘ring.',
    independentLearner: 'Mustaqil o‘quvchi',
    role: 'Hisob turi',
    serviceWarning: 'Hisob serveri bilan aloqa yo‘q. Ro‘yxatdan o‘tish va kirish vaqtincha ishlamaydi.',
    qrTitle: 'Telefon orqali kirish',
    qrUnavailable: 'QR orqali kirish EDUVERSE mobil ilovasi tayyor bo‘lganda yoqiladi. Hozircha login va parol bilan kiring.',
    localAccess: 'Faqat mahalliy sinov muhiti',
    twoFactorTitle: 'Ikkinchi omil',
    twoFactorSubtitle: 'Телефонингиздан кодни киритинг.',
    twoFactorCode: 'Bir martalik kod',
    twoFactorSubmit: 'Kirishni yakunlash',
    twoFactorResend: 'Kodni qayta yuborish',
    twoFactorBack: 'Orqaga',
    twoFactorSent: 'Kod yubordi.',
    twoFactorDevCode: 'Mahalliy sinov kodi — Telegram xabar yuborilmadi.',
  },
  Русский: {
    signIn: 'Войти',
    signUp: 'Регистрация',
    loginTitle: 'Войдите в аккаунт',
    registerTitle: 'Создайте аккаунт',
    signInSubtitle: 'Войдите в EDUVERSE-UZ, чтобы продолжить обучение.',
    registerSubtitle: 'Создайте аккаунт, чтобы продолжить обучение на EDUVERSE-UZ.',
    username: 'Ваше имя',
    login: 'Логин',
    password: 'Пароль',
    confirmPassword: 'Повторите пароль',
    displayNamePlaceholder: 'Имя и фамилия',
    loginPlaceholder: 'Введите логин',
    submitLogin: 'Войти',
    submitRegister: 'Создать аккаунт',
    noAccount: 'Если аккаунта нет, обратитесь к администратору школы.',
    hasAccount: 'Уже есть аккаунт?',
    openMaterials: 'Школьная платформа',
    sideTitle: 'Уверенный шаг к знаниям.',
    sideDescription: 'Уроки, расписание, задания и безопасные учебные инструменты в одном школьном аккаунте.',
    benefitOne: 'Личный учебный профиль',
    benefitTwo: 'Безопасная серверная сессия',
    emailNotice: 'Восстановление пароля пока недоступно: сервис подтверждённой почты не подключён.',
    language: 'Язык',
    profile: 'Профиль',
    accountMode: 'АККАУНТ',
    accountDetails: 'Данные аккаунта',
    createdAt: 'Аккаунт создан',
    logout: 'Выйти из аккаунта',
    home: 'На главную',
    loading: 'Загрузка…',
    checking: 'Проверяем сессию аккаунта.',
    retry: 'Повторить',
    unavailableTitle: 'Не удалось подключиться к сервису аккаунтов',
    unavailableText: 'Связь с сервером временно недоступна. Попробуйте позже.',
    signInRequired: 'Войдите, чтобы открыть профиль.',
    privateRequiredTitle: 'Войдите, чтобы открыть этот раздел.',
    privateRequiredText: 'Доступ к личным разделам определяется правами аккаунта, подтверждёнными сервером.',
    passwordMismatch: 'Пароли не совпадают.',
    logoutError: 'Не удалось выйти из аккаунта. Попробуйте ещё раз.',
    independentLearner: 'Самостоятельный ученик',
    role: 'Тип аккаунта',
    serviceWarning: 'Нет связи с сервером аккаунтов. Вход и регистрация временно недоступны.',
    qrTitle: 'Вход с телефона',
    qrUnavailable: 'Вход по QR появится после выхода мобильного приложения EDUVERSE. Пока используйте логин и пароль.',
    localAccess: 'Только локальная тестовая среда',
    twoFactorTitle: 'Второй фактор',
    twoFactorSubtitle: 'Введите код из приложения на телефоне.',
    twoFactorCode: 'Одноразовый код',
    twoFactorSubmit: 'Завершить вход',
    twoFactorResend: 'Отправить код ещё раз',
    twoFactorBack: 'Назад',
    twoFactorSent: 'Код отправлен.',
    twoFactorDevCode: 'Локальный тестовый код — сообщение Telegram не отправлялось.',
  },
  English: {
    signIn: 'Sign in',
    signUp: 'Create account',
    loginTitle: 'Welcome back',
    registerTitle: 'Create your account',
    signInSubtitle: 'Sign in to EDUVERSE-UZ to continue your learning.',
    registerSubtitle: 'Create an account to keep your learning profile on EDUVERSE-UZ.',
    username: 'Your name',
    login: 'Login',
    password: 'Password',
    confirmPassword: 'Confirm password',
    displayNamePlaceholder: 'First and last name',
    loginPlaceholder: 'Enter your login',
    submitLogin: 'Sign in',
    submitRegister: 'Create account',
    noAccount: 'If you need an account, contact your school administrator.',
    hasAccount: 'Already have an account?',
    openMaterials: 'School platform',
    sideTitle: 'A confident step toward knowledge.',
    sideDescription: 'Lessons, schedules, assignments, and secure learning tools in one school account.',
    benefitOne: 'A personal learning profile',
    benefitTwo: 'One secure, server-managed session',
    emailNotice: 'Password recovery is not available yet because verified email delivery is not configured.',
    language: 'Language',
    profile: 'Profile',
    accountMode: 'ACCOUNT',
    accountDetails: 'Account details',
    createdAt: 'Account created',
    logout: 'Sign out',
    home: 'Home',
    loading: 'Loading…',
    checking: 'Checking your account session.',
    retry: 'Try again',
    unavailableTitle: 'Account service is unavailable',
    unavailableText: 'The server connection is temporarily unavailable. Please try again shortly.',
    signInRequired: 'Sign in to view your profile.',
    privateRequiredTitle: 'Sign in to access this section.',
    privateRequiredText: 'Private sections are available only with permissions confirmed by the account server.',
    passwordMismatch: 'The passwords do not match.',
    logoutError: 'Could not sign out. Please try again.',
    independentLearner: 'Independent learner',
    role: 'Account type',
    serviceWarning: 'The account server is unreachable. Sign-in and registration are temporarily unavailable.',
    qrTitle: 'Sign in with your phone',
    qrUnavailable: 'QR sign-in will be available when the EDUVERSE mobile app is ready. For now, use your login and password.',
    localAccess: 'Local test environment only',
    twoFactorTitle: 'Second factor',
    twoFactorSubtitle: 'Enter the code from the app on your phone.',
    twoFactorCode: 'One-time code',
    twoFactorSubmit: 'Finish sign-in',
    twoFactorResend: 'Send code again',
    twoFactorBack: 'Back',
    twoFactorSent: 'Code sent.',
    twoFactorDevCode: 'Local test code — no Telegram message was sent.',
  },
};

const ROLE_LABELS: Record<AppLanguage, Record<User['role'], string>> = {
  Uzbek: {
    student: 'O‘quvchi',
    teacher: 'O‘qituvchi',
    parent: 'Ota-ona',
    school_director: 'Maktab direktori',
    school_admin: 'Maktab administratori',
    education_admin: 'Ta’lim boshqaruvi vakili',
    ministry_admin: 'Vazirlik administratori',
    platform_superadmin: 'Platforma superadministratori',
  },
  Русский: {
    student: 'Ученик',
    teacher: 'Учитель',
    parent: 'Родитель',
    school_director: 'Директор школы',
    school_admin: 'Администратор школы',
    education_admin: 'Представитель управления образования',
    ministry_admin: 'Администратор министерства',
    platform_superadmin: 'Суперадминистратор платформы',
  },
  English: {
    student: 'Student',
    teacher: 'Teacher',
    parent: 'Parent',
    school_director: 'School director',
    school_admin: 'School administrator',
    education_admin: 'Education authority representative',
    ministry_admin: 'Ministry administrator',
    platform_superadmin: 'Platform superadministrator',
  },
};

export function getRoleLabel(language: AppLanguage, role: User['role']): string {
  return ROLE_LABELS[language][role];
}

export function authCopy(language: AppLanguage): AuthCopy {
  return AUTH_COPY[language];
}

export function PublicHomePage({
  language,
  onLanguageChange,
  user,
}: {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  user: User | null;
}) {
  const content = {
    Uzbek: {
      navFeatures: 'Imkoniyatlar',
      navLibrary: 'Kutubxona',
      signIn: 'Kirish',
      signUp: 'Ro‘yxatdan o‘tish',
      profile: 'Profil',
      eyebrow: 'O‘ZBEKISTON O‘QUVCHILARI UCHUN RAQAMLI TA’LIM',
      title: 'EDUVERSE-UZ — yangi avlod raqamli ta’lim ekotizimi',
      subtitle: 'O‘zbekiston o‘quvchilari, o‘qituvchilari, ota-onalari va maktablari uchun yagona ta’lim muhiti.',
      start: 'O‘qishni boshlash',
      explore: 'Imkoniyatlarni ko‘rish',
      note: 'Ochiq materiallardan ro‘yxatdan o‘tmasdan foydalaning',
      preview: 'PLATFORMA KO‘RINISHI',
      previewLabel: 'Ta’lim uchun bir makon',
      previewSubject: 'Matematika',
      previewLesson: 'Nisbatlarni tushunish',
      previewUnit: 'Interaktiv mashq · 7-daraja',
      previewProgress: 'Mavzu bo‘yicha jarayon',
      previewSample: 'Interfeys namunasi',
      previewQuestion: '3 : 5 nisbatdagi sonlar nimani anglatadi?',
      previewChoice: 'Javobni tanlang',
      previewHint: 'Bosqichma-bosqich maslahat',
      openLabel: 'Ochiq ta’lim materiallari',
      featuresEyebrow: 'PLATFORMA IMKONIYATLARI',
      featuresTitle: 'O‘rganish uchun kerakli vositalar — bir joyda',
      featuresSubtitle: 'Hozir mavjud ochiq resurslar va ishlab chiqilayotgan maktab funksiyalari aniq ko‘rsatiladi.',
      available: 'Hozir ochiq',
      inDevelopment: 'Ishlab chiqilmoqda',
      features: [
        ['Interaktiv ta’lim', 'Mavzuni ochiq mashqlar va bosqichma-bosqich tushuntirishlar orqali mustahkamlang.', 'available'],
        ['Onlayn darslar', 'Jonli darslar uchun raqamli xona konsepsiyasi. Haqiqiy videoaloqa xizmati hali ulanmagan.', 'inDevelopment'],
        ['Elektron kundalik', 'Baholar, davomat va jadval uchun kelajakdagi yagona ko‘rinish.', 'inDevelopment'],
        ['Uy vazifalari', 'Vazifalarni berish va tekshirish vositalari maktab xizmatlari bilan ulanishi kerak.', 'inDevelopment'],
        ['O‘zlashtirish tahlili', 'O‘quv jarayonini tushunarli ko‘rsatkichlar bilan kuzatish rejalashtirilgan.', 'inDevelopment'],
        ['Raqamli kutubxona', 'Ochiq darslik namunalarini qidiring, ko‘ring va mutolaani davom ettiring.', 'available'],
      ] as const,
      subjectsEyebrow: 'FANLAR UCHUN RAQAMLI VOSITALAR',
      subjectsTitle: 'Murakkab mavzularni ko‘rib, sinab, tushuning',
      subjectsSubtitle: 'Fanlarga oid vizual misollar va interaktiv o‘rganish vositalari ustida ishlanmoqda. Quyidagi ko‘rinishlar mahsulot yo‘nalishini ifodalaydi, tayyor simulyator emas.',
      subjectCards: [
        ['Matematika', 'Geometriya, funksiyalar grafiklari va formulalar bilan ishlash uchun interaktiv mashqlar.', 'Ochiq mashqlar mavjud'],
        ['Fizika', 'Jarayonlarni vizual o‘rganish va tajriba tushunchalarini bosqichma-bosqich o‘rganish.', 'Simulyator ishlab chiqilmoqda'],
        ['Kimyo', 'Davriy jadval, molekula modellari va xavfsiz virtual laboratoriyalar yo‘nalishi.', 'Laboratoriya rejalashtirilgan'],
      ] as const,
      libraryEyebrow: 'FANLAR BO‘YICHA O‘RGANING',
      libraryTitle: 'Asosiy fanlarga chuqurroq nazar',
      librarySubtitle: 'Matematika, fizika va kimyo kabi murakkab mavzularni misollar va mashqlar bilan o‘rganishni boshlang.',
      subjects: ['Matematika', 'Fizika', 'Kimyo', 'Biologiya', 'Informatika', 'Tarix', 'Geografiya', 'Tillar'],
      libraryCta: 'Kutubxonaga o‘tish',
      audienceTitle: 'O‘quvchi, o‘qituvchi va maktablar uchun',
      audienceText: 'EDUVERSE-UZ ta’lim jarayonidagi ishtirokchilarni qo‘llab-quvvatlash uchun yaratilmoqda. Shaxsiy maktab kabinetlari va boshqaruv vositalari bosqichma-bosqich ishlab chiqiladi.',
      audiences: ['O‘quvchilar', 'O‘qituvchilar', 'Ota-onalar', 'Maktablar'],
      audienceDetails: [
        ['O‘quvchilar', 'Ochiq materiallar va mustaqil mashqlar.'],
        ['O‘qituvchilar', 'Darsni tashkil etish vositalari — rejalashtirilmoqda.'],
        ['Direktorlar', 'Maktab boshqaruvi — ishlab chiqish rejasida.'],
        ['Davlat maktablari', 'O‘z serverida o‘rnatish imkoniyati maqsad qilingan.'],
      ] as const,
      ecosystemEyebrow: 'ISHTIROKCHILAR UCHUN YAGONA MUHIT',
      ecosystemTitle: 'Ta’lim jarayonining har bir bosqichi uchun',
      ecosystemSubtitle: 'Elektron kundalik va onlayn sinflar hozircha konsepsiya: real baholar, davomat, videoaloqa yoki maktab ma’lumotlari bilan ulanmagan.',
      securityTitle: 'Xavfsizlik va maktab ma’lumotlari',
      securityText: 'Hisob va sessiya uchun server tomonda parol xeshlash hamda HttpOnly cookie ishlatiladi. Maktab tashkilotlari, rollar bo‘yicha API nazorati va audit jurnali hali ishlab chiqilishi kerak.',
      securityPoints: ['Parol ochiq matnda saqlanmaydi', 'Sessiya brauzer skriptlariga ochiq emas', 'Ma’muriy vakolat ommaviy ro‘yxatdan berilmaydi'],
      hostingTitle: 'Maktabning o‘z serverida ishlatish',
      hostingText: 'O‘z serverida joylashtirish — arxitekturaning maqsadi. Docker Compose, o‘rnatish/yangilash yo‘riqnomalari va zaxira nusxalash jarayoni hali tayyor emas.',
      hostingPoints: ['PostgreSQL — mavjud texnologiya', 'Docker Compose — rejalashtirilgan', 'Zaxiralash va tiklash — rejalashtirilgan'],
      hostingCta: 'O‘rnatish holatini ko‘rish',
      faqEyebrow: 'KO‘P SO‘RALADIGAN SAVOLLAR',
      faqTitle: 'Platforma haqida qisqacha',
      faqs: [
        ['Platformani hozir ishlatish mumkinmi?', 'Ochiq kutubxona va mashq sahifalari mavjud. Maktab kabinetlari, kundalik va onlayn darslar hali real xizmatlarga ulanmagan.'],
        ['Ro‘yxatdan o‘tish shartmi?', 'Ochiq materiallarni ko‘rish va mashqlarni sinash uchun hisob shart emas. Hisob hozircha o‘quvchi profili uchun kerak.'],
        ['Maktab o‘z serveriga o‘rnata oladimi?', 'Bu arxitektura maqsadlaridan biri, ammo o‘rnatish to‘plami va qo‘llanma hali tayyorlanmagan.'],
        ['EDUVERSE-UZ davlat tomonidan tasdiqlanganmi?', 'Platforma mustaqil loyiha. Davlat tomonidan tasdiqlanish yoki rasmiy integratsiya haqida da’vo qilinmaydi.'],
      ] as const,
      contactTitle: 'Loyiha bilan bog‘laning',
      contactText: 'Takliflar, xatolar yoki hamkorlik bo‘yicha savollarni loyiha repozitoriyasida qoldiring.',
      contactCta: 'GitHub loyihasini ochish',
      themeLight: 'Yorug‘ tema',
      themeDark: 'Qorong‘i tema',
      footer: 'Mustaqil ta’lim platformasi. Davlat tomonidan tasdiqlangani yoki davlat tizimlariga ulanganini bildirmaydi.',
      ctaTitle: 'Ochiq ta’lim materiallarini o‘rganishni boshlang',
      ctaText: 'Kutubxona va mashqlarni hoziroq ko‘ring — hisob talab qilinmaydi.',
      ctaButton: 'Kutubxonani ochish',
    },
    Русский: {
      navFeatures: 'Возможности',
      navLibrary: 'Библиотека',
      signIn: 'Войти',
      signUp: 'Регистрация',
      profile: 'Профиль',
      eyebrow: 'ЦИФРОВОЕ ОБРАЗОВАНИЕ ДЛЯ ШКОЛЬНИКОВ УЗБЕКИСТАНА',
      title: 'EDUVERSE-UZ — цифровая образовательная экосистема нового поколения',
      subtitle: 'Единая образовательная среда для учеников, учителей, родителей и школ Узбекистана.',
      start: 'Начать обучение',
      explore: 'Возможности платформы',
      note: 'Открытые материалы доступны без регистрации',
      preview: 'ОБЗОР ПЛАТФОРМЫ',
      previewLabel: 'Пространство для обучения',
      previewSubject: 'Математика',
      previewLesson: 'Понимаем отношения чисел',
      previewUnit: 'Интерактивное упражнение · 7 класс',
      previewProgress: 'Прогресс по теме',
      previewSample: 'Пример интерфейса',
      previewQuestion: 'Что показывают числа в отношении 3 : 5?',
      previewChoice: 'Выберите ответ',
      previewHint: 'Подсказка по шагам',
      openLabel: 'Открытые учебные материалы',
      featuresEyebrow: 'ВОЗМОЖНОСТИ ПЛАТФОРМЫ',
      featuresTitle: 'Инструменты для обучения — в одном месте',
      featuresSubtitle: 'Мы ясно обозначаем, какие открытые ресурсы уже доступны, а какие школьные функции ещё разрабатываются.',
      available: 'Уже доступно',
      inDevelopment: 'В разработке',
      features: [
        ['Интерактивное обучение', 'Закрепляйте темы с помощью открытых упражнений и пошаговых объяснений.', 'available'],
        ['Онлайн-уроки', 'Цифровая комната для будущих занятий. Сервис видеосвязи пока не подключён.', 'inDevelopment'],
        ['Электронный дневник', 'Будущий единый обзор оценок, посещаемости и расписания.', 'inDevelopment'],
        ['Домашние задания', 'Инструменты заданий и проверки предстоит подключить к школьным сервисам.', 'inDevelopment'],
        ['Контроль успеваемости', 'Понятное отслеживание учебного прогресса — в планах развития.', 'inDevelopment'],
        ['Цифровая библиотека', 'Ищите открытые образцы учебников, читайте и продолжайте изучение.', 'available'],
      ] as const,
      subjectsEyebrow: 'ЦИФРОВЫЕ ИНСТРУМЕНТЫ ПО ПРЕДМЕТАМ',
      subjectsTitle: 'Понимайте сложные темы через визуализацию и практику',
      subjectsSubtitle: 'Мы разрабатываем наглядные примеры и интерактивные инструменты для предметов. Эти карточки описывают направление продукта, а не готовые симуляторы.',
      subjectCards: [
        ['Математика', 'Интерактивная геометрия, графики функций, формулы и практические задания.', 'Открытые упражнения доступны'],
        ['Физика', 'Наглядное изучение процессов и последовательные объяснения экспериментов.', 'Симулятор в разработке'],
        ['Химия', 'Периодическая таблица, модели молекул и направление безопасных виртуальных лабораторий.', 'Лаборатория запланирована'],
      ] as const,
      libraryEyebrow: 'ИЗУЧАЙТЕ ПРЕДМЕТЫ',
      libraryTitle: 'Больше внимания ключевым предметам',
      librarySubtitle: 'Начните изучать сложные темы по математике, физике и химии через примеры и практику.',
      subjects: ['Математика', 'Физика', 'Химия', 'Биология', 'Информатика', 'История', 'География', 'Языки'],
      libraryCta: 'Перейти в библиотеку',
      audienceTitle: 'Для учеников, учителей и школ',
      audienceText: 'EDUVERSE-UZ создаётся для поддержки участников образовательного процесса. Личные кабинеты школ и инструменты управления будут разрабатываться поэтапно.',
      audiences: ['Ученики', 'Учителя', 'Родители', 'Школы'],
      audienceDetails: [
        ['Ученики', 'Открытые материалы и самостоятельная практика.'],
        ['Учителя', 'Инструменты организации уроков — в планах.'],
        ['Директора', 'Управление школой — будущий этап разработки.'],
        ['Государственные школы', 'Самостоятельное размещение — цель проекта.'],
      ] as const,
      ecosystemEyebrow: 'ЕДИНОЕ ПРОСТРАНСТВО ДЛЯ ОБРАЗОВАНИЯ',
      ecosystemTitle: 'Для каждого участника учебного процесса',
      ecosystemSubtitle: 'Электронный дневник и онлайн-классы пока являются концепцией: нет интеграции с реальными оценками, посещаемостью, видеосвязью или школьными данными.',
      securityTitle: 'Безопасность и школьные данные',
      securityText: 'Для аккаунтов и сессий используются серверное хеширование паролей и HttpOnly-cookie. Организации школ, серверный контроль прав для их API и аудит действий ещё предстоит реализовать.',
      securityPoints: ['Пароли не хранятся открытым текстом', 'Сессия недоступна скриптам страницы', 'Административная роль не выдаётся открытой регистрацией'],
      hostingTitle: 'Размещение на сервере школы',
      hostingText: 'Самостоятельное размещение — цель архитектуры. Docker Compose, инструкции по установке и обновлению, резервное копирование пока не готовы.',
      hostingPoints: ['PostgreSQL — текущая технология', 'Docker Compose — запланирован', 'Резервирование и восстановление — запланированы'],
      hostingCta: 'Посмотреть статус установки',
      faqEyebrow: 'ЧАСТЫЕ ВОПРОСЫ',
      faqTitle: 'Коротко о платформе',
      faqs: [
        ['Можно ли пользоваться платформой сейчас?', 'Доступны открытая библиотека и упражнения. Кабинеты школ, дневник и онлайн-уроки пока не подключены к реальным сервисам.'],
        ['Нужна ли регистрация?', 'Для открытых материалов и упражнений аккаунт не нужен. Сейчас аккаунт используется для ученического профиля.'],
        ['Можно ли установить платформу на сервер школы?', 'Это одна из целей проекта, но установочный набор и инструкции ещё не подготовлены.'],
        ['Одобрена ли EDUVERSE-UZ государством?', 'Это независимый проект. Мы не заявляем о государственном одобрении или официальной интеграции.'],
      ] as const,
      contactTitle: 'Связаться с проектом',
      contactText: 'Оставьте предложение, сообщение об ошибке или вопрос о сотрудничестве в репозитории проекта.',
      contactCta: 'Открыть проект на GitHub',
      themeLight: 'Светлая тема',
      themeDark: 'Тёмная тема',
      ctaTitle: 'Начните изучать открытые материалы',
      ctaText: 'Библиотека и упражнения доступны без аккаунта.',
      ctaButton: 'Открыть библиотеку',
      footer: 'Независимая образовательная платформа. Не заявляет о государственном одобрении или интеграции с государственными системами.',
    },
    English: {
      navFeatures: 'Features',
      navLibrary: 'Library',
      signIn: 'Sign in',
      signUp: 'Create account',
      profile: 'Profile',
      eyebrow: 'DIGITAL LEARNING FOR SCHOOL STUDENTS IN UZBEKISTAN',
      title: 'EDUVERSE-UZ — a next-generation digital education ecosystem',
      subtitle: 'A unified learning environment for students, teachers, families, and schools across Uzbekistan.',
      start: 'Start learning',
      explore: 'Explore the platform',
      note: 'Open learning materials — no account required',
      preview: 'PLATFORM PREVIEW',
      previewLabel: 'A space to keep learning',
      previewSubject: 'Mathematics',
      previewLesson: 'Understanding ratios',
      previewUnit: 'Interactive practice · Grade 7',
      previewProgress: 'Topic progress',
      previewSample: 'Interface preview',
      previewQuestion: 'What do the numbers in a 3 : 5 ratio represent?',
      previewChoice: 'Choose an answer',
      previewHint: 'Step-by-step hint',
      openLabel: 'Open learning materials',
      featuresEyebrow: 'PLATFORM FEATURES',
      featuresTitle: 'Learning tools, all in one place',
      featuresSubtitle: 'We clearly distinguish open resources available today from school services that are still in development.',
      available: 'Available now',
      inDevelopment: 'In development',
      features: [
        ['Interactive learning', 'Practice concepts with open exercises and step-by-step explanations.', 'available'],
        ['Online lessons', 'A digital room concept for future classes. Video calling is not connected yet.', 'inDevelopment'],
        ['Digital journal', 'A future overview for grades, attendance, and schedules.', 'inDevelopment'],
        ['Homework', 'Assignment and review tools still need integration with school services.', 'inDevelopment'],
        ['Learning progress', 'Clear learning progress insights are planned for future development.', 'inDevelopment'],
        ['Digital library', 'Explore open textbook samples, read, and continue learning.', 'available'],
      ] as const,
      subjectsEyebrow: 'DIGITAL TOOLS BY SUBJECT',
      subjectsTitle: 'Understand challenging topics through visuals and practice',
      subjectsSubtitle: 'Visual examples and interactive subject tools are in development. These cards describe product direction, not finished simulations.',
      subjectCards: [
        ['Mathematics', 'Interactive geometry, function graphs, formulas, and practical exercises.', 'Open exercises available'],
        ['Physics', 'Visual learning for physical processes and step-by-step experiment concepts.', 'Simulation in development'],
        ['Chemistry', 'Periodic table, molecular models, and a direction for safe virtual labs.', 'Lab planned'],
      ] as const,
      libraryEyebrow: 'EXPLORE BY SUBJECT',
      libraryTitle: 'Go deeper in core subjects',
      librarySubtitle: 'Start exploring challenging ideas in mathematics, physics, and chemistry through examples and practice.',
      subjects: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Computer science', 'History', 'Geography', 'Languages'],
      libraryCta: 'Open the library',
      audienceTitle: 'For students, teachers, and schools',
      audienceText: 'EDUVERSE-UZ is being built to support everyone in education. School workspaces and administration tools will be developed in stages.',
      audiences: ['Students', 'Teachers', 'Families', 'Schools'],
      audienceDetails: [
        ['Students', 'Open materials and independent practice.'],
        ['Teachers', 'Lesson organization tools are planned.'],
        ['School leaders', 'School administration is a future development stage.'],
        ['Public schools', 'Self-hosting is a project goal.'],
      ] as const,
      ecosystemEyebrow: 'ONE SPACE FOR LEARNING',
      ecosystemTitle: 'For every part of the learning journey',
      ecosystemSubtitle: 'The digital journal and online classrooms are concepts today: real grades, attendance, video calls, and school records are not connected.',
      securityTitle: 'Security and school data',
      securityText: 'Accounts use server-side password hashing and HttpOnly session cookies. School organizations, server-side authorization for their APIs, and audit history still need to be built.',
      securityPoints: ['Passwords are never stored as plain text', 'Session cookies are inaccessible to page scripts', 'Public registration cannot grant administrative roles'],
      hostingTitle: 'Run on a school-owned server',
      hostingText: 'Self-hosting is an architecture goal. Docker Compose, installation and upgrade guides, and backup procedures are not available yet.',
      hostingPoints: ['PostgreSQL is the current database', 'Docker Compose is planned', 'Backup and restore procedures are planned'],
      hostingCta: 'Check deployment status',
      faqEyebrow: 'FREQUENTLY ASKED QUESTIONS',
      faqTitle: 'A few things to know',
      faqs: [
        ['Can I use the platform today?', 'The open library and practice pages are available. School workspaces, the journal, and online lessons are not connected to real services yet.'],
        ['Do I need an account?', 'No account is needed for open materials or practice. Accounts currently provide a student profile.'],
        ['Can a school install it on its own server?', 'That is a project goal, but installation packages and guides are not ready yet.'],
        ['Is EDUVERSE-UZ government-approved?', 'This is an independent project. No government endorsement or official integration is claimed.'],
      ] as const,
      contactTitle: 'Get in touch with the project',
      contactText: 'Share suggestions, report a problem, or ask about collaboration in the project repository.',
      contactCta: 'Open the GitHub project',
      themeLight: 'Light theme',
      themeDark: 'Dark theme',
      ctaTitle: 'Start exploring open learning materials',
      ctaText: 'The library and practice are available without an account.',
      ctaButton: 'Open the library',
      footer: 'An independent learning platform. No government endorsement or integration with public-sector systems is claimed.',
    },
  }[language];

  const [darkMode, setDarkMode] = useState(false);
  const featureIcons = [Sparkles, MonitorPlay, CalendarDays, ClipboardCheck, Activity, Library];
  const subjectIcons = [Calculator, Atom, Beaker];
  return (
    <div className="public-home" data-theme={darkMode ? 'dark' : 'light'} data-locale-preserve="true">
      <header className="public-home-header">
        <Link href={user ? '/dashboard' : '/login'} className="auth-brand" aria-label="EDUVERSE-UZ home">
          <span className="auth-brand-mark">E</span>
          <span><b>EDUVERSE-UZ</b><small>LEARNING SPACE</small></span>
        </Link>
        <nav className="public-home-nav" aria-label="Main navigation">
          <a href="#features">{content.navFeatures}</a>
          <Link href="/library">{content.navLibrary}</Link>
        </nav>
        <div className="public-home-actions">
          <label className="auth-language">
            <span className="sr-only">{authCopy(language).language}</span>
            <select value={language} onChange={(event) => onLanguageChange(event.target.value as AppLanguage)}>
              <option value="Uzbek">O‘zbekcha</option>
              <option value="Русский">Русский</option>
              <option value="English">English</option>
            </select>
          </label>
          <button
            type="button"
            className="landing-theme-toggle"
            onClick={() => setDarkMode((current) => !current)}
            aria-label={darkMode ? content.themeLight : content.themeDark}
            aria-pressed={darkMode}
            title={darkMode ? content.themeLight : content.themeDark}
          >
            {darkMode ? <Sun size={16}/> : <Moon size={16}/>}
          </button>
          {user
            ? <Link href="/dashboard" className="public-signin" aria-label={user.username} title={user.username}>{user.username}</Link>
            : <>
                <Link href="/login" className="public-signin">{content.signIn}</Link>
                <Link href="/register" className="public-signup">{content.signUp}</Link>
              </>}
        </div>
      </header>
      <main>
        <section className="public-home-hero">
          <div className="public-home-copy">
            <div className="public-home-kicker"><span/>{content.eyebrow}</div>
            <h1>{content.title}</h1>
            <p className="public-home-lead">{content.subtitle}</p>
            <div className="public-home-cta">
              <Link href="/library" className="public-primary-cta">{content.start}<ArrowRight size={17}/></Link>
              <a href="#features" className="public-secondary-cta"><span className="public-play-icon"><ArrowRight size={14}/></span>{content.explore}</a>
            </div>
            <p className="public-home-open-note"><ShieldCheck size={16}/>{content.note}</p>
          </div>
          <div className="public-visual" aria-label={content.previewLabel}>
            <div className="visual-orbit orbit-one"/>
            <div className="visual-orbit orbit-two"/>
            <div className="visual-float visual-float-book"><span className="float-icon"><BookOpen size={18}/></span><span><b>{content.previewSubject}</b><small>{content.previewSample}</small></span></div>
            <div className="visual-float visual-float-check"><span><Check size={14}/></span>{content.available}</div>
            <div className="learning-preview">
              <div className="preview-topbar">
                <span className="preview-brand-mark">E</span>
                <span className="preview-brand-name">EDUVERSE<span>·</span>UZ</span>
                <span className="preview-menu-dots"><i/><i/><i/></span>
              </div>
              <div className="preview-body">
                <div className="preview-meta"><span className="preview-subject-dot"/>{content.previewSubject}<span>·</span>{content.previewUnit}</div>
                <h2>{content.previewLesson}</h2>
                <div className="preview-progress-label"><span>{content.previewProgress}</span><span className="preview-sample-tag">{content.previewSample}</span></div>
                <div className="preview-progress"><span/></div>
                <div className="preview-question-card">
                  <div className="preview-question-top"><span><Target size={14}/></span><small>{content.previewQuestion}</small></div>
                  <div className="preview-answer"><span className="answer-radio"/><span>{content.previewChoice}</span><ArrowRight size={14}/></div>
                </div>
                <div className="preview-hint"><Sparkles size={14}/>{content.previewHint}<ArrowRight size={13}/></div>
              </div>
            </div>
            <div className="visual-caption"><span className="caption-dot"/>{content.preview}</div>
          </div>
        </section>
        <section className="public-home-feature-section" id="features">
          <div className="landing-section-heading">
            <span className="public-home-kicker"><span/>{content.featuresEyebrow}</span>
            <h2>{content.featuresTitle}</h2>
            <p>{content.featuresSubtitle}</p>
          </div>
          <div className="landing-feature-grid">
            {content.features.map(([title, description, status], index) => {
              const Icon = featureIcons[index];
              const card = (
                <>
                  <span className="landing-feature-icon"><Icon size={20}/></span>
                  <span className={`feature-status ${status}`}>{status === 'available' ? content.available : content.inDevelopment}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  {status === 'available' && <span className="feature-arrow"><ArrowRight size={16}/></span>}
                </>
              );
              return status === 'available'
                ? <Link key={title} href={index === 0 ? '/practice' : '/library'} className={`landing-feature-card feature-card-${index + 1}`}>{card}</Link>
                : <article key={title} className={`landing-feature-card feature-card-${index + 1}`}>{card}</article>;
            })}
          </div>
        </section>
        <section className="landing-subjects">
          <div className="landing-subject-copy">
            <span className="public-home-kicker"><span/>{content.libraryEyebrow}</span>
            <h2>{content.libraryTitle}</h2>
            <p>{content.librarySubtitle}</p>
            <Link href="/library" className="landing-text-link">{content.libraryCta}<ArrowRight size={16}/></Link>
          </div>
          <div className="landing-subject-list">
            {content.subjects.map((subject, index) => (
              <Link href="/library" className={`subject-pill subject-pill-${index + 1}`} key={subject}>
                <span>{subject}</span><ArrowRight size={14}/>
              </Link>
            ))}
          </div>
        </section>
        <section className="landing-subject-showcase" id="subjects">
          <div className="landing-section-heading">
            <span className="public-home-kicker"><span/>{content.subjectsEyebrow}</span>
            <h2>{content.subjectsTitle}</h2>
            <p>{content.subjectsSubtitle}</p>
          </div>
          <div className="landing-subject-cards">
            {content.subjectCards.map(([title, description, status], index) => {
              const Icon = subjectIcons[index];
              return (
                <article className={`subject-showcase-card subject-showcase-${index + 1}`} key={title}>
                  <div className="subject-showcase-top">
                    <span className="subject-showcase-icon"><Icon size={20}/></span>
                    <span className="subject-showcase-status">{status}</span>
                  </div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <div className={`subject-visual subject-visual-${index + 1}`} aria-hidden="true">
                    {index === 0
                      ? <><span className="math-visual-axis axis-x"/><span className="math-visual-axis axis-y"/><span className="math-visual-line"/><span className="math-visual-point point-a"/><span className="math-visual-point point-b"/></>
                      : index === 1
                        ? <><span className="physics-orbit"/><span className="physics-orbit orbit-small"/><span className="physics-core"/><span className="physics-particle"/></>
                        : <><span className="chemistry-bond bond-one"/><span className="chemistry-bond bond-two"/><span className="chemistry-atom atom-one"/><span className="chemistry-atom atom-two"/><span className="chemistry-atom atom-three"/></>}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
        <section className="landing-ecosystem" id="ecosystem">
          <div className="landing-section-heading">
            <span className="public-home-kicker"><span/>{content.ecosystemEyebrow}</span>
            <h2>{content.ecosystemTitle}</h2>
            <p>{content.ecosystemSubtitle}</p>
          </div>
          <div className="ecosystem-cards">
            <article className="ecosystem-card">
              <span className="ecosystem-icon"><CalendarDays size={20}/></span>
              <div><h3>{content.features[2][0]}</h3><p>{content.features[2][1]}</p></div>
              <span className="feature-status inDevelopment">{content.inDevelopment}</span>
            </article>
            <article className="ecosystem-card">
              <span className="ecosystem-icon"><MonitorPlay size={20}/></span>
              <div><h3>{content.features[1][0]}</h3><p>{content.features[1][1]}</p></div>
              <span className="feature-status inDevelopment">{content.inDevelopment}</span>
            </article>
          </div>
        </section>
        <section className="landing-audience" id="audience">
          <div className="audience-heading">
            <span className="public-home-kicker"><span/>{content.audienceTitle}</span>
            <p>{content.audienceText}</p>
          </div>
          <div className="audience-grid">
            {content.audienceDetails.map(([title, description], index) => (
              <article className="audience-card" key={title}>
                <span className="audience-card-icon">{index === 0 ? <GraduationCap size={19}/> : index === 1 ? <Users size={19}/> : index === 2 ? <Activity size={19}/> : <Server size={19}/>}</span>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="landing-security" id="security">
          <div className="security-visual">
            <div className="security-glass-card">
              <div className="security-visual-head"><span className="security-shield"><ShieldCheck size={23}/></span><span>{content.securityTitle}</span></div>
              <div className="security-lock-line"><LockKeyhole size={15}/><span>HttpOnly</span><i/><span>Session</span></div>
              <div className="security-meter"><span/><span/><span/></div>
              <span className="security-caption">EDUVERSE-UZ · {content.previewSample}</span>
            </div>
          </div>
          <div className="security-copy">
            <span className="public-home-kicker"><span/>{content.securityTitle}</span>
            <h2>{content.securityTitle}</h2>
            <p>{content.securityText}</p>
            <ul>{content.securityPoints.map((point) => <li key={point}><Check size={15}/>{point}</li>)}</ul>
          </div>
        </section>
        <section className="landing-hosting" id="self-hosting">
          <div className="hosting-icon"><Server size={23}/></div>
          <div className="hosting-copy">
            <span className="public-home-kicker"><span/>{content.audienceDetails[3][0]}</span>
            <h2>{content.hostingTitle}</h2>
            <p>{content.hostingText}</p>
            <ul>{content.hostingPoints.map((point) => <li key={point}><span/>{point}</li>)}</ul>
          </div>
          <a className="hosting-link" href="https://github.com/behruznasridinov2014-cmyk/EDUVERSE-UZ-Education-Platform" target="_blank" rel="noreferrer">
            {content.hostingCta}<ArrowUpRight size={16}/>
          </a>
        </section>
        <section className="landing-faq" id="faq">
          <div className="landing-section-heading">
            <span className="public-home-kicker"><span/>{content.faqEyebrow}</span>
            <h2>{content.faqTitle}</h2>
          </div>
          <div className="faq-list">
            {content.faqs.map(([question, answer]) => (
              <details className="faq-item" key={question}>
                <summary>{question}<span className="faq-chevron"><ArrowRight size={15}/></span></summary>
                <p>{answer}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="landing-contact" id="contact">
          <span className="contact-mark"><Users size={20}/></span>
          <div className="contact-copy"><h2>{content.contactTitle}</h2><p>{content.contactText}</p></div>
          <a className="contact-link" href="https://github.com/behruznasridinov2014-cmyk/EDUVERSE-UZ-Education-Platform/issues" target="_blank" rel="noreferrer">{content.contactCta}<ArrowUpRight size={15}/></a>
        </section>
        <section className="landing-bottom-cta">
          <div className="landing-cta-decoration cta-decoration-one"/>
          <div className="landing-cta-decoration cta-decoration-two"/>
          <div className="landing-cta-content">
            <span className="landing-cta-label"><Sparkles size={14}/>{content.openLabel}</span>
            <h2>{content.ctaTitle}</h2>
            <p>{content.ctaText}</p>
            <Link href="/library" className="landing-cta-button">{content.ctaButton}<ArrowRight size={16}/></Link>
          </div>
        </section>
      </main>
      <footer className="landing-footer">
        <Link href={user ? '/dashboard' : '/login'} className="auth-brand"><span className="auth-brand-mark">E</span><span><b>EDUVERSE-UZ</b><small>LEARNING SPACE</small></span></Link>
        <span>{content.footer}</span>
      </footer>
    </div>
  );
}

type AuthPageProps = {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  onSuccess: () => void;
};

function AuthFrame({
  language,
  onLanguageChange,
  loginMode = false,
  children,
}: {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  loginMode?: boolean;
  children: ReactNode;
}) {
  const copy = authCopy(language);
  return (
    <div className={`auth-page${loginMode ? ' auth-page-login' : ''}`} data-locale-preserve="true">
      <header className="auth-header">
        <Link href="/login" className="auth-brand" aria-label="EDUVERSE-UZ home">
          <span className="auth-brand-mark">E</span>
          <span><b>EDUVERSE-UZ</b><small>LEARNING SPACE</small></span>
        </Link>
        <div className="auth-header-actions">
          <Link href="/login" className="auth-home-link"><ArrowLeft size={15}/>{copy.home}</Link>
          <label className="auth-language">
            <span className="sr-only">{copy.language}</span>
            <select value={language} onChange={(event) => onLanguageChange(event.target.value as AppLanguage)}>
              <option value="Uzbek">O‘zbekcha</option>
              <option value="Русский">Русский</option>
              <option value="English">English</option>
            </select>
          </label>
        </div>
      </header>
      <main className="auth-layout">
        <aside className="auth-aside">
          <span className="auth-aside-icon"><GraduationCap size={24}/></span>
          <div>
            <div className="auth-eyebrow">EDUVERSE · UZBEKISTAN</div>
            <h1>{copy.sideTitle}</h1>
            <p>{copy.sideDescription}</p>
          </div>
          <div className="auth-benefits">
            <span><ShieldCheck size={17}/>{copy.benefitOne}</span>
            <span><LockKeyhole size={17}/>{copy.benefitTwo}</span>
          </div>
          <div className="auth-open-link"><ShieldCheck size={16}/>{copy.benefitOne}</div>
        </aside>
        <section className="auth-panel">{children}</section>
      </main>
      <footer className="auth-footer">EDUVERSE-UZ <span>·</span> {copy.openMaterials}</footer>
    </div>
  );
}

function FormError({ children }: { children: string }) {
  return <div className="auth-error" role="alert">{children}</div>;
}

export function LoginPage({ language, onLanguageChange, onSuccess }: AuthPageProps) {
  const copy = authCopy(language);
  const qrCopy = QR_COPY[language];
  const auth = useAuth();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'code' | 'qr'>(() => {
    const qr = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('qr');
    return qr ? 'qr' : 'code';
  });
  const [code, setCode] = useState('');
  const [resendNotice, setResendNotice] = useState('');
  const qrCode = typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get('qr') ?? '');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await auth.signIn({ login: login.trim(), password });
      if (!auth.twoFactorChallenge) onSuccess();
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, language));
    }
  }

  async function submitTwoFactor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    try {
      await auth.signIn2fa(code);
      onSuccess();
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, language));
    }
  }

  async function resendTwoFactor() {
    setError('');
    setResendNotice('');
    try {
      const response: unknown = await auth.resend2fa();
      const code = typeof response === 'object' && response !== null && 'devCode' in response && typeof response.devCode === 'string'
        ? response.devCode
        : '';
      if (code) setCode(code);
      setResendNotice(code ? copy.twoFactorDevCode : copy.twoFactorSent);
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, language));
    }
  }

  return (
    <AuthFrame language={language} onLanguageChange={onLanguageChange} loginMode>
      <div className="auth-eyebrow">{copy.signIn}</div>
      <h2>{auth.twoFactorChallenge ? copy.twoFactorTitle : copy.loginTitle}</h2>
      <p className="auth-description">{auth.twoFactorChallenge ? copy.twoFactorSubtitle : copy.signInSubtitle}</p>
      {auth.status === 'unavailable' && <div className="auth-error" role="status">{copy.serviceWarning}</div>}
      {auth.twoFactorChallenge ? (
        <form className="auth-form" onSubmit={submitTwoFactor}>
          <label className="auth-field" htmlFor="account-2fa-code">
            <span>{copy.twoFactorCode}</span>
            <input
              id="account-2fa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              minLength={6}
              maxLength={6}
              required
              autoFocus
            />
          </label>
          {error && <FormError>{error}</FormError>}
          {resendNotice && <div className="notice" role="status">{resendNotice}</div>}
          <button className="auth-submit" type="submit" disabled={auth.isSubmitting || code.trim().length !== 6}>
            {auth.isSubmitting ? <LoaderCircle className="auth-spinner" size={17}/> : <ShieldCheck size={17}/>}
            {copy.twoFactorSubmit}
          </button>
          <button className="btn" type="button" onClick={() => void resendTwoFactor()} disabled={auth.isSubmitting}>
            {copy.twoFactorResend}
          </button>
          <button className="btn" type="button" onClick={auth.cancelTwoFactor} disabled={auth.isSubmitting}>
            {copy.twoFactorBack}
          </button>
        </form>
      ) : (
        <>
          <div className="auth-tabs" role="tablist" aria-label={copy.signIn}>
            <button type="button" role="tab" aria-selected={tab === 'code'} className={`auth-tab ${tab === 'code' ? 'active' : ''}`} onClick={() => setTab('code')}>
              <LockKeyhole size={15} /> {qrCopy.tabCode}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'qr'} className={`auth-tab ${tab === 'qr' ? 'active' : ''}`} onClick={() => setTab('qr')}>
              <Smartphone size={15} /> {qrCopy.tabQr}
            </button>
          </div>

          {tab === 'code' ? (
            <form className="auth-form" onSubmit={submit}>
              <label className="auth-field" htmlFor="account-login">
                <span>{copy.login}</span>
                <input id="account-login" type="text" name="username" value={login} onChange={(event) => setLogin(event.target.value)} placeholder={copy.loginPlaceholder} autoComplete="username" minLength={3} maxLength={32} required/>
              </label>
              <label className="auth-field" htmlFor="account-password">
                <span>{copy.password}</span>
                <input id="account-password" type="password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" minLength={8} maxLength={128} required/>
              </label>
              {error && <FormError>{error}</FormError>}
              <button className="auth-submit" type="submit" disabled={auth.isSubmitting}>
                {auth.isSubmitting ? <LoaderCircle className="auth-spinner" size={17}/> : <LockKeyhole size={17}/>}
                {auth.isSubmitting ? copy.loading : copy.submitLogin}
              </button>
            </form>
          ) : qrCode ? (
            <QrApprovePanel language={language} prefillCode={qrCode} onApproved={() => onSuccess()} />
          ) : (
            <QrSignInPanel language={language} onSuccess={() => onSuccess()} />
          )}
          <div className="auth-switch-row">
            <QrScannerButton language={language} className="btn" />
          </div>
          <div className="auth-switch">{copy.noAccount}</div>
        </>
      )}
      <p className="auth-note">{copy.emailNotice}</p>
    </AuthFrame>
  );
}

export function RegisterPage({ language, onLanguageChange, onSuccess }: AuthPageProps) {
  const copy = authCopy(language);
  const auth = useAuth();
  const [username, setUsername] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError(copy.passwordMismatch);
      return;
    }
    try {
      await auth.signUp({ username: username.trim(), login: login.trim(), password, confirmPassword });
      onSuccess();
    } catch (requestError) {
      setError(getAuthErrorMessage(requestError, language));
    }
  }

  return (
    <AuthFrame language={language} onLanguageChange={onLanguageChange} loginMode>
      <div className="auth-eyebrow">{copy.signUp}</div>
      <h2>{copy.registerTitle}</h2>
      <p className="auth-description">{copy.registerSubtitle}</p>
      {auth.status === 'unavailable' && <div className="auth-error" role="status">{copy.serviceWarning}</div>}
      <form className="auth-form" onSubmit={submit}>
        <label className="auth-field" htmlFor="account-name">
          <span>{copy.username}</span>
          <input id="account-name" type="text" name="name" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={copy.displayNamePlaceholder} autoComplete="name" minLength={2} maxLength={40} required/>
        </label>
        <label className="auth-field" htmlFor="new-account-login">
          <span>{copy.login}</span>
          <input id="new-account-login" type="text" name="username" value={login} onChange={(event) => setLogin(event.target.value)} placeholder={copy.loginPlaceholder} autoComplete="username" minLength={3} maxLength={32} required/>
        </label>
        <label className="auth-field" htmlFor="new-account-password">
          <span>{copy.password}</span>
          <input id="new-account-password" type="password" name="new-password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required/>
        </label>
        <label className="auth-field" htmlFor="confirm-account-password">
          <span>{copy.confirmPassword}</span>
          <input id="confirm-account-password" type="password" name="confirm-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} maxLength={128} required/>
        </label>
        {error && <FormError>{error}</FormError>}
        <button className="auth-submit" type="submit" disabled={auth.isSubmitting}>
          {auth.isSubmitting ? <LoaderCircle className="auth-spinner" size={17}/> : <ShieldCheck size={17}/>}
          {auth.isSubmitting ? copy.loading : copy.submitRegister}
        </button>
      </form>
      <div className="auth-switch">{copy.hasAccount} <Link href="/login">{copy.signIn}</Link></div>
      <p className="auth-note">{copy.emailNotice}</p>
    </AuthFrame>
  );
}

export function ProfilePage({
  user,
  language,
  onSignedOut,
}: {
  user: User;
  language: AppLanguage;
  onSignedOut: () => void;
}) {
  const copy = authCopy(language);
  const auth = useAuth();
  const [error, setError] = useState('');

  async function signOut() {
    setError('');
    try {
      await auth.signOut();
      onSignedOut();
    } catch {
      setError(copy.logoutError);
    }
  }

  const locale = language === 'Uzbek' ? 'uz-UZ' : language === 'Русский' ? 'ru-RU' : 'en-US';
  return (
    <section className="profile-page" data-locale-preserve="true">
      <div className="profile-heading">
        <div>
          <div className="auth-eyebrow">EDUVERSE-UZ</div>
          <h1>{copy.profile}</h1>
          <p>{copy.accountDetails}</p>
        </div>
        <div className="profile-avatar">{user.username.slice(0, 1).toLocaleUpperCase(locale)}</div>
      </div>
      <div className="profile-card">
        <div className="profile-identity">
          <div className="profile-avatar large">{user.username.slice(0, 1).toLocaleUpperCase(locale)}</div>
          <div><h2>{user.username}</h2><p>@{user.login}</p></div>
          <span className="profile-status"><span/> {copy.profile}</span>
        </div>
        <div className="profile-details">
          <div><span>{copy.username}</span><b>{user.username}</b></div>
          <div><span>{copy.login}</span><b>{user.login}</b></div>
          <div><span>{copy.createdAt}</span><b>{new Date(user.createdAt).toLocaleDateString(locale, { dateStyle: 'long' })}</b></div>
          <div><span>{copy.role}</span><b>{ROLE_LABELS[language][user.role]}</b></div>
        </div>
        <TwoFactorSettings language={language} />
        <p className="auth-note profile-note">{copy.emailNotice}</p>
        {error && <FormError>{error}</FormError>}
        <div className="profile-actions">
          <QrScannerButton language={language} className="btn" />
          <Link href="/" className="auth-home-link"><ArrowLeft size={15}/>{copy.home}</Link>
          <button className="btn danger" onClick={() => void signOut()} disabled={auth.isSubmitting}>
            {auth.isSubmitting ? <LoaderCircle className="auth-spinner" size={16}/> : <LogOut size={16}/>}
            {copy.logout}
          </button>
        </div>
      </div>
    </section>
  );
}

export function AuthStatusPage({
  language,
  onLanguageChange,
  onRetry,
  required = false,
  onSignIn,
  privateArea = false,
}: {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  onRetry?: () => void;
  required?: boolean;
  onSignIn?: () => void;
  privateArea?: boolean;
}) {
  const copy = authCopy(language);
  return (
    <AuthFrame language={language} onLanguageChange={onLanguageChange}>
      <div className="auth-eyebrow">{copy.profile}</div>
      <h2>{required ? privateArea ? copy.privateRequiredTitle : copy.signInRequired : copy.unavailableTitle}</h2>
      <p className="auth-description">{required ? privateArea ? copy.privateRequiredText : copy.signInSubtitle : copy.unavailableText}</p>
      <div className="profile-actions">
        {required && onSignIn ? <button className="auth-submit" onClick={onSignIn}>{copy.signIn}</button> : null}
        {onRetry ? <button className="btn" onClick={onRetry}>{copy.retry}</button> : null}
        <Link href="/" className="auth-home-link"><ArrowLeft size={15}/>{copy.home}</Link>
      </div>
    </AuthFrame>
  );
}

export function AuthLoadingPage({
  language,
  onLanguageChange,
}: {
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
}) {
  const copy = authCopy(language);
  return (
    <AuthFrame language={language} onLanguageChange={onLanguageChange}>
      <div className="auth-loading"><LoaderCircle className="auth-spinner" size={22}/><h2>{copy.loading}</h2><p>{copy.checking}</p></div>
    </AuthFrame>
  );
}
