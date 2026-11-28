# Аудит функций (24.11.2026)

Метод: чтение кода маршрутов, схемы и компонентов. Сборка и тесты в этом аудите не запускались (нет node_modules в облачной копии). Статусы: ✅ работает · 🟡 частично · 🎨 только интерфейс · ❌ сломано/мертво · ⛔ нет.

## Вход и безопасность
- ✅ Логин/пароль, сессии в БД, выход со всех устройств — `routes/auth.ts`, `routes/account.ts`
- ✅ Google-вход только для привязанных — `auth.ts` `/auth/google/*`
- ✅ QR-вход, 2FA через Telegram — `auth.ts`, `lib/two-factor.ts` (2FA зависит от бота: на проде токена нет → 🟡)
- ✅ CSRF (проверка Origin), rate-limit, scrypt — `app.ts`, `lib/auth-crypto.ts`
- ✅ Изоляция школ — `lib/school-access.ts`

## Ученик
- ✅ Урок в 7 этапов, прогресс — `lesson-stages.tsx`, `routes/lessons.ts`
- ✅ 3D-сцены (CSS-3D) — `scene-kit.tsx`, `scenes-*.tsx`; только 7 класс, 4 предмета
- ✅ Тренажёр, рейтинг — `trainer.tsx`, `course.ts`
- ✅ ДЗ с фото, черновик переживает перезагрузку — `homework.tsx`
- ✅ Оценки, расписание — `journal.ts`, `timetable.ts`
- 🟡 Учебники PDF — `public/books` (23 МБ), неполные; заметки/закладки только в localStorage (`App.tsx` `useSavedState`), а аннотации страниц — в БД (`book_annotations`): две системы
- 🟡 Химлаборатория / физлаба — `chem-lab.tsx`, `physics-lab.tsx`; отчёты сохраняются (`labs/reports`)
- ⛔ Личные рекомендации «что повторить», достижения/бейджи (кроме наград в комнате)

## Учитель
- ✅ Посещаемость по предмету, журнал оценок, проверка ДЗ (+ «сам ли писал» Gemini) — `attendance-page.tsx`, `extras.tsx GradeJournal`, `school-panels.tsx SubmissionReviewDialog`
- ✅ Доска класса (`lesson_live`), конструктор урока — `lesson-teacher.tsx`
- 🟡 Онлайн-урок — `lesson-rooms.ts`: работает в одной сети; без TURN видео часто не соединится через мобильный интернет
- 🟡 План урока через Gemini — `school-tools.ts /ai/lesson-plan`
- ⛔ Аналитика по ученику во времени (тренды, западающие темы)

## Родитель
- ✅ Средний балл, посещаемость, задания ребёнка — `cabinets.tsx ParentCabinet`
- 🟡 Уведомления — только в приложении + Telegram (бот не подключён)
- ⛔ Переписка с учителем (есть только чат с поддержкой — `support_messages`)

## Директор / завуч
- ✅ Дашборд школы, классы, люди, импорт, сброс паролей, заявки владельцу, CSV — `cabinets.tsx DirectorDashboard`, `school-tools.ts`, `requests.ts`
- 🟡 Отчёты: только CSV, нет отчёта по учителям/предметам за четверть

## Владелец / центр
- ✅ Создание школ и людей, заявки, тарифы, аудит, демо-школа — `requests.ts`, `demo.ts`, `ServerAdminSchoolsPanel`
- 🎨 Роли `education_admin`, `ministry_admin` — есть в меню (`App.tsx ROLE_NAV`), но собственной аналитики по нескольким школам нет
- ⛔ Сравнение школ, сводная аналитика

## Мёртвый / лишний код
- ❌ `extras.tsx AiTutor` и `POST /ai/tutor` — компонент нигде не используется (ИИ-помощник убран)
- ❌ `GET /models/3d` (Sketchfab) — фронт не вызывает; CSP разрешает sketchfab ради него
- ❌ `@replit/vite-plugin-*` в devDependencies — наследие Replit
- 🟡 Много Radix-компонентов в `components/ui`, большая часть не используется

## Офлайн
- 🟡 Оболочка открывается без сети (`sw.js`), но уроки, тренажёр, ДЗ офлайн не работают
