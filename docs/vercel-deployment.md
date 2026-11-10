# Vercel deployment — EDUVERSE-UZ

This guide deploys the whole project (web app + Express API as serverless
functions + PostgreSQL) to Vercel, for the school URL already connected to
your GitHub repository.

## 0. What you need

- The GitHub repository already imported in Vercel.
- A PostgreSQL database you control. The simplest option is a free Neon
  project (neon.tech) or Vercel Postgres. You get a `DATABASE_URL` like
  `postgresql://user:password@host/eduverse?sslmode=require`.
- Optional: Google Gemini API key for AI-generated topics, tests and 3D
  (a free one from Google AI Studio: https://aistudio.google.com/app/apikey —
  a free-tier key is enough; you said you will add it later).
- Optional: YouTube Data API v3 key (same Google Cloud project) for embedded
  videos picked by the AI by topic.
- Optional: Sketchfab API key for embedded 3D models from the internet.

## 1. Import / configure the Vercel project

In Vercel → Project → **Settings → Build & Development Settings** keep the
defaults from `vercel.json` in the repository, or set them explicitly:

| Setting          | Value                                                        |
|------------------|--------------------------------------------------------------|
| Install command  | `pnpm install --frozen-lockfile`                              |
| Build command    | `pnpm --filter @workspace/api-server build && pnpm --filter @workspace/eduverse-uz build` |
| Output directory | `artifacts/eduverse-uz/dist/public`                           |

The repository ships `vercel.json` which already pins this, plus a catch-all
serverless function `api/[...path].mjs` that runs the Express API.

## 2. Set environment variables (Settings → Environment Variables)

Required:

| Name              | Value                                          |
|-------------------|------------------------------------------------|
| `NODE_ENV`        | `production`                                   |
| `DATABASE_URL`    | your PostgreSQL connection string              |

Optional (add when you buy/create them):

| Name               | Value                                              |
|--------------------|----------------------------------------------------|
| `GEMINI_API_KEY`   | Google Gemini API key — AI topics, tests, 3D, YouTube |
| `GEMINI_MODEL`     | `gemini-2.5-flash` (default)                       |
| `YOUTUBE_API_KEY`  | YouTube Data API v3 key (or reuse the Gemini key)  |
| `SKETCHFAB_API_KEY`| Sketchfab API key for embedded 3D models           |
| `CORS_ORIGINS`     | leave unset (same origin)                          |
| `TRUST_PROXY`      | `1` (already enabled automatically on Vercel)      |

### Optional Telegram two-factor authentication

To enable Telegram 2FA, add `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_BOT_USERNAME` (without `@`), `TELEGRAM_WEBHOOK_SECRET`, and a
persistent `TWO_FACTOR_ENCRYPTION_KEY` (64 hex characters) to Vercel's secret
store. Also add the same encryption key and bot token to the separate
long-running worker service: Vercel functions do not run that worker.

The webhook endpoint is
`https://<your-deployment-domain>/api/auth/2fa/telegram/webhook`. Determine the
actual domain from Vercel's Domains page; do not use a guessed production URL.
Once the four secrets are present in the operator environment, set the
deployment URL and run:

```powershell
$env:TELEGRAM_WEBHOOK_URL = "https://<your-deployment-domain>/api/auth/2fa/telegram/webhook"
pnpm --filter @workspace/scripts run telegram:webhook
```

The script registers only the `message` update type and does not print the bot
token, webhook secret, or Telegram response body. Create the bot via
@BotFather, set secrets only in the hosting secret manager, and follow the
schema and rotation steps in `production-deployment.md`.

> The API automatically switches to Gemini when `GEMINI_API_KEY` is set.
> Without an AI key the built-in deterministic generator still creates full
> topics (40-minute slides, interesting facts, 3D object, quiz).

## 3. Apply the database schema

Use the project's reviewed schema rollout procedure and the database owner's
approved migration process. Do not run `pnpm --filter @workspace/db run push`
against production as a substitute for reviewed migrations. Test schema
changes on a disposable database and staging first, take a production backup,
and obtain the database owner's approval before applying production changes.
For the Telegram 2FA tables and indexes, follow the **Schema rollout** section
in [production-deployment.md](./production-deployment.md); its SQL migration
has not been applied to any production database.

Then seed a demonstration school, classes and 30 demo students
(this only creates new demo records, it never deletes anything):

```powershell
node scripts/seed-demo-school.mjs
```

Demo accounts (all with password `demo-school-2026`):

| Login           | Role                | What they can do                                |
|-----------------|---------------------|--------------------------------------------------|
| `demo_director` | School director     | Create classes, create student accounts, assign topics |
| `demo_teacher`  | Teacher             | Publish assignments, mark attendance, run online lessons |
| `demo_admin`    | Platform superadmin | Full administration                                |
| `demo_student_b_1` … | Student        | Topics & 3D, online lessons, attendance, practice   |

## 4. Deploy

Push to the branch Vercel tracks (normally `main`). Vercel builds the static
site and the serverless API together. Verify:

- `https://<your-app>.vercel.app/api/healthz` → `{"status":"ok"}`
- `https://<your-app>.vercel.app/` → login screen

Sign in as `demo_director`, open **Maktab boshqaruvi**, create a student
account (look at the generated credentials once), assign a topic to a class,
then open **Topics & 3D** — the AI package (slides, interesting facts, 3D
object, quiz) is ready, with an embedded YouTube lesson video. Open
**Onlayn dars**, create a room, share the code, and join from a second tab or
another device.

### Live lesson media (camera, microphone, screen)

The lesson room is a WebRTC mesh. Camera, microphone and screen share are
published directly between the browsers; only the offer/answer and ICE
candidates travel through the API.

- The site must be served over **HTTPS** — browsers only grant camera and
  microphone access in a secure context.
- For participants behind a strict NAT or a corporate firewall a dedicated
  **TURN** server is required. Set `VITE_TURN_URL`, `VITE_TURN_USERNAME` and
  `VITE_TURN_CREDENTIAL` in the Vercel project (build-time variables) and
  redeploy. Without them the mesh falls back to public STUN/TURN relays, which
  are rate-limited and unsuitable for a full class.
- After every deploy run `pnpm --filter @workspace/scripts run check:lesson`
  against a preview deployment to confirm that the media path still works.

### Sign in with a QR code

The QR tab of the login screen shows a QR code plus an eight-character code. A
signed-in device approves the request from **Profil → Scan QR code**; the
scanner uses the native `BarcodeDetector` where it exists (Chrome on Android)
and falls back to a bundled decoder on desktop browsers.

## 5. AI features in production

Everything works without any key:

- AI topics: deterministic curated generator (slides, facts, 3D, quiz)
- Interesting facts: enriched from Wikipedia (no key needed)
- Interactive 3D: CSS `preserve-3D` objects, drag/pinch/zoom everywhere

With keys (when you add them in the Vercel dashboard, then **Redeploy**):

- `GEMINI_API_KEY` → AI writes slides, facts, 3D descriptors, per-student
  questions differentiated per student (`/topics/:id/student-questions`).
- `YOUTUBE_API_KEY` → the exact YouTube video for the chosen topic is found
  and embedded in the lesson (40-minute lesson with a real video).
- `SKETCHFAB_API_KEY` → real 3D models by topic appear in the lesson and the
  student can rotate them.

## 6. Install on Android / iPhone / iPad

The web app is a full PWA: users install it like an app, no APK or App Store
required.

**Android (Chrome)**: open the site → menu (⋮) → *Install app* / *Add to Home
screen*. The **Установить приложение** button (on the login screen and in the
top bar) does the same with one tap.

**iPhone / iPad (Safari)**: open the site → Share button → *Add to Home
Screen*. The same button shows exact step-by-step instructions.

**Android tablet / education boards**: same as Android. The bottom
navigation and large touch targets are designed for tablets and boards.

## 7. Publishing to Google Play / App Store

Do this only when you are ready to publish; the PWA alone is usually enough.

- **Google Play (PWABuilder)**: https://www.pwabuilder.com → enter your URL →
  *Package for stores* → Android. Download the `.zip`, get a Google Play
  Console account ($25 one time), upload the `.aab`, set the app name,
  screenshots (use the installed PWA screenshots), camera/mic/screen-share
  usage descriptions, a privacy policy URL, and submit.
- **App Store (PWABuilder)**: same site → iOS package → requires a
  macOS/Xcode machine and an Apple Developer account ($99/year).
- **Capacitor alternative**: see `docs/mobile-release.md` — for full native
  builds (push notifications, WebRTC background, etc.).
