# EDUVERSE-UZ Education Platform

An authenticated school learning platform prototype with a server-backed account foundation.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/api-server run test` — run API authentication helper tests
- `pnpm --filter @workspace/api-client-react run test` — verify browser session credentials
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — PostgreSQL connection string; `PORT` — port for each server; `BASE_PATH` — Vite base path (usually `/`)
- Optional env: `CORS_ORIGINS` — comma-separated trusted browser origins for cross-origin or reverse-proxy deployments
- Optional env: `EDUVERSE_LOCAL_AI_MODEL` — name of a model already installed in local Ollama; Guard AI explanations remain disabled when unset
- Optional test-only env: `EDUVERSE_ALLOW_PUBLIC_REGISTRATION=1` — enables registration only for the isolated local smoke-test launcher; production registration is closed by default

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

The test database currently has only the existing account/session schema.
There is no school/tenant, class, roster, assignment, CSV import, TOTP, device,
or online-room backend yet, so the local launcher does not seed fake school
records or claim tests for those features. See
`docs/local-testing-windows.md` for the supported test matrix and follow-up
requirements.

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

- `artifacts/eduverse-uz` — React/Vite learning interface
- `artifacts/api-server` — Express API, including account and session routes
- `lib/db/src/schema` — Drizzle/PostgreSQL schema
- `lib/api-spec/openapi.yaml` — API contract; generated clients live in `lib/api-client-react` and `lib/api-zod`

## Architecture decisions

- School learning pages require a server-backed sign-in; there is no public About or open-learning flow.
- After a successful sign-in, the last non-secret user profile is cached locally so approved offline lesson and practice screens can open when the account API is unavailable. Passwords and session tokens are never cached; offline changes remain on the device until school APIs are implemented.
- The current Grade 7B assignment and quiz walkthrough uses a shared local demo scope on the device so teacher, student, and family views can demonstrate the same workflow. It is not a school tenant, cloud sync, or real student record.
- Production registration is closed by default because EDUVERSE-UZ is a school-managed platform. Accounts should be provisioned by a school administrator; the isolated local smoke-test launcher may opt in to registration with `EDUVERSE_ALLOW_PUBLIC_REGISTRATION=1`. Account roles are persisted in PostgreSQL and never accepted from a public registration payload.
- Role-specific UI paths consult the server-backed session and server-returned role; unimplemented workspaces display a status message instead of fictional school records. Private school-data APIs do not exist yet, so the exported role middleware must be applied when those endpoints are added.
- Passwords are stored as salted scrypt hashes. Session tokens are random, held in `HttpOnly` cookies, and stored only as SHA-256 digests in PostgreSQL.
- EduVerse Guard provides authenticated local diagnostics; TOTP, recovery, school-data APIs, and other listed missing controls are not implemented. AI explanations are optional and require local Ollama.
- Password recovery requires a separately configured email provider and is not represented as a working feature yet.
- The current sign-in rate limiter is process-local; use shared storage before running multiple API instances.

## Product

The public interface includes a sample textbook library, reading progress, open practice, and lesson/board simulations. These sample activities are not connected to school records. Role-specific dashboards remain unavailable until real school data services and privileged-account provisioning are implemented.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
