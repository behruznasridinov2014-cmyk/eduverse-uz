# EDUVERSE UZ — архитектура (ноябрь 2026)

## Что это
Платформа для частных школ Узбекистана: журнал (оценки, посещаемость, расписание), урок в 7 этапов по учебнику 7 класса, свои 3D-сцены, онлайн-урок, тренажёр, домашние задания с фото, кабинеты ученика / учителя / родителя / директора / владельца. Модель продаж: журнал бесплатно, 3D / онлайн-урок / тренажёр — тариф `pro` или `pilot`.

## Стек
| Слой | Где | Технологии |
|---|---|---|
| Фронт | `artifacts/eduverse-uz` | React 18, wouter, Vite, Tailwind + свои CSS (`theme.css`, `app.css`, `glass.css`, `motion.css`), Radix UI, react-query, pdfjs-dist |
| API | `artifacts/api-server` | Express, Drizzle ORM, pino; на Vercel как serverless (`src/vercel.ts`) |
| БД | `lib/db/src/schema/*.ts` | Neon Postgres, ~30 таблиц; миграций нет — `src/lib/schema-sync.ts` дописывает таблицы/колонки при старте |
| Контракт | `lib/api-spec/openapi.yaml` → `lib/api-client-react`, `lib/api-zod` | сгенерированный клиент; часть вызовов идёт мимо него через `customFetch` |
| Деплой | `vercel.json` (services: api + web), `deploy/Dockerfile.api` | CSP, HSTS, кеш `/assets` |

## Сервер: маршруты (`artifacts/api-server/src/routes/`)
- `auth.ts` — логин, сессии в БД (httpOnly cookie, sameSite=lax), Google OAuth (только привязанные), QR-вход, 2FA через Telegram, rate-limit в таблице `rate_limit_buckets`, публичная регистрация закрыта флагом.
- `schools.ts` — школы, участники, классы, задания, сдачи, проверка фото (Gemini).
- `learning.ts` — темы, посещаемость, объявления, журнал, связь родитель↔ребёнок, дашборд школы, CSV-экспорт, поиск YouTube/Sketchfab.
- `lessons.ts` — прогресс по 7 этапам, контент урока, «живая доска» класса (`lesson_live`), помощник урока.
- `lesson-rooms.ts` — онлайн-урок: WebRTC, сигналинг через Postgres + long-poll, тесты в комнате, награды.
- `course.ts` — темп по учебнику, календарь школы, тренажёр (результаты, рейтинг, тесты учителя).
- `requests.ts` — заявки школы → владелец, тарифы (`lib/plans.ts`), аудит.
- `school-tools.ts` — импорт людей, сброс пароля, Telegram, аватары, лаб. отчёты.
- `timetable.ts`, `journal.ts` (оценки), `account.ts` (профиль, сессии, уведомления, поддержка), `ai-tools.ts`, `demo.ts`.

## Доступ
- Роли: `student`, `teacher`, `parent`, `school_director`, `school_admin`, `education_admin`, `ministry_admin`, `platform_superadmin`.
- Изоляция школ: `lib/school-access.ts` (+ тест `test/school-access.test.ts`). Учитель не управляет людьми (`canManagePeople`).
- Фронт дублирует права в `App.tsx` (`protectedRoutes`, `ROLE_NAV`) — это только меню, решает сервер.

## Фронт: ключевые файлы
`App.tsx` (маршруты, меню всех ролей в одном файле, 584 стр.), `school-panels.tsx` (1938 стр., классы/учёт/админка), `lesson-room.tsx` (1479), `lesson-stages.tsx` + `lesson-engine.ts` + `lesson-teacher.tsx` (урок в 7 этапов), `course*.ts` (122 темы), `scene-kit.tsx` + `scenes-*.tsx` (CSS-3D без WebGL), `chem-lab.tsx`, `physics-lab.tsx`, `collision-lab.tsx`, `trainer.tsx`, `homework.tsx`, `cabinets.tsx` (родитель, директор), `pdf-viewer.tsx`.

## Офлайн
`public/sw.js` кеширует только оболочку приложения и уже открытые файлы; `/api` не кешируется. `auth-context.tsx` держит статус `offline` с сохранённым пользователем. Данных офлайн нет.

## Внешние сервисы
Gemini (`lib/ai-content.ts`, с запасной цепочкой моделей), Google OAuth, Telegram (бот, outbox в БД), YouTube/Sketchfab поиск. Не подключены: TURN, токен бота на проде, файловое хранилище, домен.
