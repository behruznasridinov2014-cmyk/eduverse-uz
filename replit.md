# EDUVERSE-UZ Education Platform

An authenticated school learning platform: interactive 3D AI lessons, live
online lessons with camera and screen share, attendance, an end-of-lesson
Kahoot-style game, server-backed accounts with QR device sign-in, and a full
PWA for Android/iPhone/iPad/laptop.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/api-server run test` - API unit tests (auth crypto, school access, AI content)
- `pnpm --filter @workspace/eduverse-uz run dev` — Vite dev server (port 5173, proxies /api)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes
- `node scripts/seed-demo-school.mjs` — seed the demo school (director, teacher, admin, 3 classes, 30 students, 4 AI topics, 5 days of attendance)
- `API_BASE=http://127.0.0.1:5000/api node scripts/smoke-features.mjs` — end-to-end smoke test; cleans up its own test accounts
- `node scripts/generate-icons.mjs` — regenerate PWA / Apple touch icons
- Required env: `DATABASE_URL` — PostgreSQL connection string
- Optional env: `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-2.5-flash`) — Google Gemini AI for topics, tests, 3D and per-student questions. Without it, a deterministic offline generator is used.
- Optional env: `YOUTUBE_API_KEY` — embed the exact YouTube video by topic (or reuse the Gemini key)
- Optional env: `SKETCHFAB_API_KEY` — embed real 3D models by topic
- Optional env: `AI_BASE_URL` (default `http://127.0.0.1:11434/v1`), `AI_API_KEY`, `AI_MODEL` — any OpenAI-compatible endpoint instead of Gemini
- Optional env: `CORS_ORIGINS` — comma-separated trusted origins for reverse-proxy deployments
- Optional env: `EDUVERSE_REGISTRATION_RATE_LIMIT`, `EDUVERSE_LOGIN_RATE_LIMIT`
- Optional env: `EDUVERSE_ALLOW_AUTO_GRADING=0` — disable awarding a grade to the end-of-lesson game winner
- Optional test-only env: `EDUVERSE_ALLOW_PUBLIC_REGISTRATION=1`

## Deploy

- **Vercel** (web app + API as serverless functions + your PostgreSQL): see `docs/vercel-deployment.md`
- **Google Play / App Store**: install the PWA, or package it with PWABuilder — see `docs/mobile-release.md`
- The project also ships `vercel.json` and `api/[...path].mjs` (serverless Express entry-point) out of the box.

### Local development on Windows

Start PostgreSQL, then open a PowerShell terminal in the repository:

```powershell
$env:DATABASE_URL = Read-Host "PostgreSQL connection string"
$env:PORT = "5000"
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-server run dev
```

In a second terminal, set the web app environment and start Vite:

```powershell
$env:PORT = "5173"
$env:BASE_PATH = "/"
pnpm --filter @workspace/eduverse-uz run dev
```

Vite proxies `/api` requests to `http://127.0.0.1:5000` by default. If the API
uses a different address, set `$env:API_SERVER_URL` in the web app terminal
before starting Vite. `CORS_ORIGINS` is only needed for deployments where the
browser calls the API directly from a different origin.
Use real secrets only in local environment variables or a private, ignored
`.env` file; never commit them.

### Isolated Windows local test stack

The local test launcher uses the already-installed PostgreSQL service and a
separate `eduverse_test` database. It never uses `eduverse_local`, a production
database, Docker, or a public server. It applies the current auth-only schema
only when the new test database is empty; it does not reset or drop existing
test data. Local logs and process IDs are stored under
`%LOCALAPPDATA%\EDUVERSE-UZ\local-test`; the PostgreSQL password is requested
securely and is not saved by the scripts.

From the repository root in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-eduverse-test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\status-eduverse-test.ps1
pnpm --filter @workspace/api-server run test:local
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-eduverse-test.ps1
```

The web app is at `http://127.0.0.1:4173`; API health is at
`http://127.0.0.1:5000/api/healthz`. Stopping services preserves the test
database. The API smoke test registers a random synthetic student in
`eduverse_test`, verifies session and Guard access, then logs out; it never
prints or saves that account's password.

The local test database contains the account/session schema and the
school/class/assignment/submission schema. The launcher applies the Drizzle
schema when the test database is empty or already matches the EDUVERSE account
schema, and it adds the school tables when they are missing. It then seeds a
clearly marked demo school, one class, role memberships, two assignments, and
three submissions in `eduverse_test` only. CSV import, TOTP, device
confirmation, and online-room/WebRTC services remain unimplemented. See
`docs/local-testing-windows.md` for the supported test matrix and remaining
follow-up requirements.

### EDUVERSE Guard local checks

Sign in and open **EduVerse Guard** from the navigation. The authenticated
`GET /api/guard/check` endpoint checks API/session access, PostgreSQL, a
temporary in-memory scrypt hash, cookie configuration, and explicitly reports
security features that are not implemented. It does not scan arbitrary files,
test other machines, or perform penetration testing.

Optional AI explanations use only a local Ollama service at
`http://127.0.0.1:11434`. Install/start Ollama separately, choose a model
already shown by `ollama list`, and set the model name in the same PowerShell
terminal before starting the API:

```powershell
ollama list
$env:EDUVERSE_LOCAL_AI_MODEL = "your-installed-model"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-eduverse-local.ps1
```

Only the generated report (check IDs, statuses, aggregate counts, and check
timestamp) is sent to the loopback Ollama service. No source code, passwords,
session tokens, or user profile details are included. Without a local model,
deterministic Guard checks still work and the AI action reports that it is
unavailable.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod 3, `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (ESM bundle)

## Where things live

- `artifacts/eduverse-uz` — React/Vite learning interface (topics & 3D, live lesson room, attendance, QR sign-in)
- `artifacts/api-server` — Express API: accounts, sessions, QR device sign-in, attendance, AI topics, lesson rooms and grading
- `artifacts/api-server/src/lib/ai-content.ts` — provider-agnostic AI content backend with a deterministic offline generator and Wikipedia fact enrichment
- `lib/db/src/schema` — Drizzle/PostgreSQL schema (auth, school, learning: attendance, lesson topics, rooms, quiz attempts, QR sessions)
- `lib/api-spec/openapi.yaml` — API contract; generated clients live in `lib/api-client-react` and `lib/api-zod`

## Architecture decisions

- School learning pages require a server-backed sign-in; there is no public About or open-learning flow.
- Device sign-in uses a Steam-Guard style QR flow: a new device requests a short-lived challenge (`/auth/qr/start`), displays a QR + human code, and an already signed-in device approves it (`/auth/qr/approve`). Only SHA-256 digests of the device/approval tokens are stored, and the session is minted fresh on `/auth/qr/consume`.
- AI lesson content is provider-agnostic: set `AI_MODEL` (and `AI_BASE_URL`/`AI_API_KEY` for a hosted provider) and the platform generates slides, interesting facts, an interactive 3D descriptor, a quiz and per-student questions. Without a model, a deterministic curated generator runs so everything still works locally, and facts are enriched from the public Wikipedia REST API when the network allows.
- 3D objects are rendered without WebGL as CSS `preserve-3d` primitives so they work on low-end phones, tablets and projectors: users rotate, pinch-zoom and drag individual labelled parts.
- Live lesson rooms use a WebRTC mesh signalled through the API via long-polled in-memory message queues (`/rooms/:id/signal`); durable room, participant, topic and test state lives in PostgreSQL. This needs no extra realtime dependency and works behind any proxy. Webcam, microphone and screen sharing all use the browser's native `getUserMedia`/`getDisplayMedia`.
- Attendance stores one authoritative mark per class/student/day (unique index) so teachers can update a mark instead of duplicating it.
- The end-of-lesson game records `quiz_attempts` and lets the teacher award the 1st-place student a grade on a linked class assignment.
- After a successful sign-in, the last non-secret user profile is cached locally so approved offline lesson and practice screens can open when the account API is unavailable. Passwords and session tokens are never cached; school pages use the authenticated school API as the source of truth and show clearly labelled local samples when the server is unreachable.
- The Grade 7B assignment and quiz walkthrough remains a shared local demo scope on the device so teacher, student, and family views can demonstrate the same workflow. It is separate from the server-backed demo school seeded only in `eduverse_test`.
- Production registration is closed by default because EDUVERSE-UZ is a school-managed platform. Accounts should be provisioned by a school administrator; the isolated local smoke-test launcher may opt in to registration with `EDUVERSE_ALLOW_PUBLIC_REGISTRATION=1`. Account roles are persisted in PostgreSQL and never accepted from a public registration payload.
- Role-specific UI paths consult the server-backed session and server-returned role. School routes are protected by authenticated server-side role checks; school membership, class membership, assignment, submission, and `/me/assignments` access are scoped to the account. UI workspaces fall back to clearly labelled local samples only when the server is unavailable or the account has no linked school record.
- Passwords are stored as salted scrypt hashes. Session tokens are random, held in `HttpOnly` cookies, and stored only as SHA-256 digests in PostgreSQL.
- AI explanations and content generation are optional: without a configured model the deterministic local generator is used.
- Password recovery requires a separately configured email provider and is not represented as a working feature yet.
- The current sign-in rate limiter is process-local; use shared storage before running multiple API instances.

## Product

The public interface includes a sample textbook library, reading progress, open practice, and lesson/board simulations. These sample activities are not connected to school records. School roles can inspect server-backed schools, classes, memberships, assignments, and submissions.

The platform's day-to-day learning flow is:
1. A teacher picks a subject (biology, physics, chemistry, geography) and topic in **Topics & 3D**; the AI backend generates a 40-minute slide deck, interesting facts (hidden until revealed), an interactive 3D object and a quiz.
2. The teacher opens a **live online lesson** from the topic. The API returns a join code; students join with camera and microphone, share their screen, and chat. The teacher can start **individual AI tests** — each student receives a unique question — and a class ranking is computed.
3. The teacher marks **attendance** (who came) for the class, which students and parents can see.
4. At the end of the lesson the class plays a Kahoot-style game; the teacher awards the winner a grade on a linked assignment.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
