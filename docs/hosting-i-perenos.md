# Хостинг: настройки и переезд на другой хостинг

Здесь только **названия** настроек. Сами значения (пароли, ключи, адрес базы)
лежат в настройках хостинга. В git, в чат и в файлы их не пишем.

## 1. Из чего состоит сайт

| Часть | Где в проекте | Что получается после сборки |
|---|---|---|
| Сайт (то, что видят люди) | `artifacts/eduverse-uz` | папка `artifacts/eduverse-uz/dist` (обычные файлы) |
| Сервер (логины, журнал, уроки) | `artifacts/api-server` | `dist/index.mjs` (обычный сервер) и `dist/vercel.mjs` (для Vercel) |
| База данных | Neon, проект `floral-math-69766457`, ветка `production` | никуда не переезжает, меняется только адрес в настройке |

Все адреса `/api/...` должны идти на сервер, всё остальное на сайт
(для страниц вроде `/schedule` отдаётся `index.html`).

## 2. Настройки (переменные окружения)

### Обязательно

| Название | Для чего |
|---|---|
| `DATABASE_URL` | адрес базы Neon (ветка `production`) |
| `NODE_ENV` | всегда `production` |
| `TWO_FACTOR_ENCRYPTION_KEY` | шифрует коды двухэтапного входа (64 символа, `openssl rand -hex 32`); **переносить то же значение**, иначе у всех сломается двухэтапный вход |
| `TRUST_PROXY` | `1`. На Vercel не нужно (там это включено само), на любом другом хостинге **обязательно**, иначе ограничение попыток входа будет считать всех одним человеком |

### Вход через Google (привязка и восстановление)

| Название | Для чего |
|---|---|
| `GOOGLE_CLIENT_ID` | ключ Google |
| `GOOGLE_CLIENT_SECRET` | секрет Google |
| `GOOGLE_REDIRECT_URI` | необязательно: `https://<новый-адрес>/api/auth/google/callback`. Если адрес меняется, этот же адрес нужно добавить в Google Cloud Console → Credentials → OAuth client → Authorized redirect URIs |

### Telegram (уведомления, замены, коды)

| Название | Для чего |
|---|---|
| `TELEGRAM_BOT_TOKEN` | токен бота от @BotFather |
| `BREVO_API_KEY` | ключ brevo.com (бесплатно 300 писем в день) — код «Забыли пароль» на почту |
| `MAIL_FROM` | адрес отправителя, подтверждённый в Brevo |
| `TELEGRAM_BOT_USERNAME` | имя бота без @ |
| `TELEGRAM_WEBHOOK_SECRET` | любая длинная случайная строка; бот присылает её с каждым сообщением |
| (без настройки) | адрес бота: `https://<адрес>/api/auth/2fa/telegram/webhook`. После переезда этот адрес нужно заново указать боту (setWebhook) |

### Видео-урок (когда подключим)

| Название | Для чего |
|---|---|
| `CLOUDFLARE_TURN_KEY_ID`, `CLOUDFLARE_TURN_API_TOKEN` | видеосвязь через Cloudflare (вариант 1) |
| `TURN_URLS`, `TURN_USERNAME`, `TURN_CREDENTIAL` | свой сервер видеосвязи (вариант 2) |
| `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` | то же для сайта; задаются **до сборки** |

### Проверка домашки «сам ли написал» и материалы

| Название | Для чего |
|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_BASE_URL` | проверка домашних работ |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_TIMEOUT_MS`, `AI_ENABLED` | другой поставщик вместо Gemini (необязательно) |
| `YOUTUBE_API_KEY` | подбор видео по теме |
| `SKETCHFAB_API_KEY` | 3D-модели из интернета |

### Тонкая настройка (можно не задавать)

| Название | По умолчанию |
|---|---|
| `CORS_ORIGINS` | пусто: сайт и сервер на одном адресе. Задать, только если сайт и сервер на разных адресах (точный адрес сайта, не `*`) |
| `JSON_BODY_LIMIT` | `4mb` |
| `LOG_LEVEL` | `info` |
| `PORT`, `HOST` | `5000`; только для обычного сервера |
| `EDUVERSE_CURATOR_LOGINS` | логины кураторов через запятую |
| `EDUVERSE_ALLOW_PUBLIC_REGISTRATION` | выключено (`1` включает, нам не нужно) |
| `EDUVERSE_ALLOW_AUTO_GRADING` | включено (`0` выключает оценку победителю игры) |
| `EDUVERSE_LOGIN_RATE_LIMIT`, `EDUVERSE_LOGIN_IP_RATE_LIMIT`, `EDUVERSE_2FA_RATE_LIMIT`, `EDUVERSE_2FA_SETUP_RATE_LIMIT`, `EDUVERSE_REGISTRATION_RATE_LIMIT`, `EDUVERSE_QR_START_RATE_LIMIT`, `EDUVERSE_QR_POLL_RATE_LIMIT`, `EDUVERSE_QR_APPROVE_RATE_LIMIT`, `EDUVERSE_QR_CONSUME_RATE_LIMIT` | лимиты попыток; значения по умолчанию подходят |

**Никогда не включать на рабочем сайте:** `EDUVERSE_DEV_2FA_ECHO`.

Хостинг сам задаёт: `VERCEL`, `VERCEL_GIT_COMMIT_SHA`, `REPL_ID`. Только для
разработки на компьютере: `API_SERVER_URL`, `BASE_PATH`.

## 3. Переезд: общий порядок

1. В Neon сделать запасную ветку (`backup-ГГГГ-ММ-ДД`). База остаётся та же.
2. Выписать из Vercel **названия** всех настроек: `vercel env ls production`.
   Значения перенести вручную из Vercel → Settings → Environment Variables
   в настройки нового хостинга (копировать, не пересылать в чат).
3. Добавить `TRUST_PROXY=1`.
4. Собрать и запустить на новом адресе, проверить вход, журнал, расписание.
5. Обновить адрес в Google (redirect URI) и у Telegram-бота (webhook).
6. Перенести домен (если есть) и только потом отключить Vercel.

Пока новый сайт проверяется, старый на Vercel продолжает работать: оба
смотрят в одну базу.

## 4. Вариант A: Render или Railway (проще всего, без изменений в коде)

Сервер здесь обычный (`dist/index.mjs`), поэтому подходит любой хостинг для
Node.js.

1. Новый сервис **Web Service** из репозитория GitHub.
2. Сборка:
   `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @workspace/api-server build && pnpm --filter @workspace/eduverse-uz build`
3. Запуск: `pnpm --filter @workspace/api-server start`
4. Настройки из раздела 2 плюс `TRUST_PROXY=1`, `HOST=0.0.0.0`
   (`PORT` хостинг задаёт сам).
5. Сайт: отдельный **Static Site** из той же сборки, папка
   `artifacts/eduverse-uz/dist`, правило «всё, кроме `/api/*`, → `/index.html`»
   и `/api/*` → адрес сервиса из шага 1. Если сайт и сервер на разных
   адресах, задать `CORS_ORIGINS=https://<адрес сайта>`.

Плюс: нет ограничения по времени на запрос (проверка фото домашки до 60 секунд
работает). Минус на бесплатном тарифе: сервер засыпает, первый вход после
паузы медленный.

## 5. Вариант B: Netlify

Netlify отдаёт сайт, а сервер запускает как «функцию». Нужен небольшой
переходник (один раз, делаю я по команде):

- пакет `serverless-http` в `artifacts/api-server`;
- файл `netlify/functions/api.mjs`, который оборачивает `app` из
  `artifacts/api-server/src/app.ts`;
- файл `netlify.toml`:
  - build command: `pnpm --filter @workspace/api-server build && pnpm --filter @workspace/eduverse-uz build`
  - publish: `artifacts/eduverse-uz/dist`
  - redirect `/api/*` → `/.netlify/functions/api/:splat` (200)
  - redirect `/*` → `/index.html` (200)
  - заголовки безопасности и кэша из `vercel.json` (раздел `headers`).

Ограничения Netlify, которые надо знать заранее:

- функция работает максимум 10 секунд (на платном до 26). Проверка фото
  домашки может не успеть;
- размер запроса до 6 МБ (у нас 4 МБ, хватает).

Перед переездом всё проверяется на тестовом адресе Netlify, рабочий сайт
не трогаем.

## 6. Что проверить после переезда

- Вход по логину и паролю, выход, смена пароля.
- Привязка Google и вход через Google в «Забыли пароль».
- Журнал, расписание, замены, аналитика у директора.
- Уведомление в Telegram (если бот подключён).
- Обновление страницы на `/schedule` не даёт 404.
