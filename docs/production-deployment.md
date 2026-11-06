# Production deployment plan

## Current boundary
The repository now contains the first server-backed school foundation: schools,
memberships, classes, class membership, assignments, and lessons. The API is
ready to provision real records only after the production database is backed up
and the schema is applied by an operator.

The web UI still contains clearly marked local demonstration screens. They must
not be presented as official school records until the school API is connected to
those screens and the school has approved the data import.

## Server
1. Provision PostgreSQL 17 or newer on a private network and create a dedicated
   database role with the minimum permissions needed by the application.
2. Set the variables in `.env.example` in the server secret manager. Never put
   `DATABASE_URL`, passwords, cookies, or API keys in Git or chat.
3. Build with `pnpm install --frozen-lockfile`, `pnpm run typecheck`, and the
   production build commands in the repository.
4. Apply the Drizzle schema during a maintenance window and take a backup first.
5. Run the API behind Nginx, Caddy, or a managed HTTPS reverse proxy. Expose
   only HTTPS on the public interface; keep PostgreSQL private.
6. Set `CORS_ORIGINS` to the exact web origin, not `*`, and set `TRUST_PROXY=1`
   only when the reverse proxy is trusted.
7. Add daily encrypted backups, a restore drill, error monitoring, log retention,
   and a process supervisor such as systemd or a managed container service.

## Telegram two-factor authentication
The API uses the existing `/api` mount, so the exact webhook path is
`/api/auth/2fa/telegram/webhook`. Its origin must be the deployed public HTTPS
origin; this repository does not contain a production hostname. Configure
these values in the API and worker secret stores (never in Git or chat):

- `TELEGRAM_BOT_TOKEN` — private token from @BotFather.
- `TELEGRAM_BOT_USERNAME` — bot username without `@`.
- `TELEGRAM_WEBHOOK_SECRET` — random 1–256 character Telegram-safe value.
- `TWO_FACTOR_ENCRYPTION_KEY` — persistent 32-byte key encoded as 64 hex
  characters. Generate it in the secret manager or with `openssl rand -hex 32`.

The optional `TELEGRAM_WEBHOOK_URL` is the full HTTPS URL ending in the exact
path above. With the secrets available only in the operator's environment,
register (or replace) the webhook without putting credentials in command
arguments:

```powershell
$env:TELEGRAM_WEBHOOK_URL = "https://<your-public-https-origin>/api/auth/2fa/telegram/webhook"
pnpm --filter @workspace/scripts run telegram:webhook
```

The registration script takes the bot token and webhook secret from the
environment, does not print either value or Telegram's response body, and
preserves pending Telegram updates. The deploy owner must create the bot via
@BotFather, set the four secrets in the hosting secret store, and run this
command with the real public HTTPS origin. Never send these secret values to
the assistant or include them in logs.

### Schema rollout

The additive SQL migration is
`lib/db/migrations/20261105_telegram_2fa_scale.sql`. Apply it to a disposable
local database and staging first. The migration adds the outbox and shared
rate-limit tables, challenge/recovery tables and indexes, a 15-minute pending
bind expiry, and one-account-per-Telegram-chat uniqueness. It aborts (and rolls
back) if duplicate non-null Telegram chat IDs exist; review and resolve those
rows before retrying.

After backup, review the SQL and apply it through the deployment's approved
PostgreSQL migration mechanism. For a Windows operator whose `PGHOST`,
`PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` are already provided by a
private secret manager, the command is:

```powershell
psql -v ON_ERROR_STOP=1 -f .\lib\db\migrations\20261105_telegram_2fa_scale.sql
```

Do not pass a database URL containing credentials on a command line or apply
this migration to production without the database owner's separate approval.
No production database was accessed or migrated for this change.

### Delivery, limits, and scale

The API writes encrypted message bodies to the PostgreSQL outbox and returns
without calling Telegram. A separate `telegram-worker` claims jobs with
`FOR UPDATE SKIP LOCKED`, observes Telegram `retry_after`, uses a five-second
request timeout, and applies up to eight bounded retries. One PostgreSQL
advisory lock permits only one sender process per bot. It paces messages at
least 40 ms apart globally (a theoretical ceiling of 25 messages/second before
network latency) and at least one second apart per chat; these are configured
limits, not measured throughput. Expired messages are not retried indefinitely.
Completed and failed outbox rows are retained for 30 days.

Rate-limit counters are atomic PostgreSQL upserts shared by API replicas and
store only hashed identities. Current defaults are 5 two-factor code deliveries
per account per 15 minutes, 8 code checks per account per 15 minutes, plus the
existing per-IP limits (12 password sign-ins and 8 2FA operations per 15
minutes; registration is 5 per hour). Each API process uses the `pg` pool
default of 10 connections; budget the database connection limit for
`10 × API replicas`, plus the worker and any migration/monitoring clients.
Adjust deployment pool sizing to the database plan rather than increasing
replicas without a connection budget.

The design uses indexed accounts/challenges and a durable database queue and is
intended to accommodate 100,000 registered accounts. This does not imply
100,000 simultaneous active sessions or peak sign-in requests. API replicas
can scale independently; the single Telegram sender is a separate capacity
limit. Establish actual peak capacity with a staging load test against a
production-like PostgreSQL instance and a staging bot. Measure concurrent
sessions, login requests/second, database connections, queue age, delivery
latency, and error rates before changing limits or sender concurrency. No
100,000-account or concurrent-user load test has been run.

Vercel functions do not run the long-lived worker. Host `pnpm --filter
@workspace/api-server run worker` as a separate process with the same database,
encryption key, and bot token, or use a managed durable worker. Never set
`EDUVERSE_DEV_2FA_ECHO=1` in production.

### Credential rotation

- **Bot token:** revoke/replace it via @BotFather, update the API and worker
  secret stores, restart both, then rerun the webhook registration command.
- **Webhook secret:** put the replacement in the API secret store and run the
  registration command immediately. Telegram retries rejected updates; do not
  set `drop_pending_updates`. There can be a short webhook retry interval during
  the single-secret cutover.
- **Encryption key:** do not replace `TWO_FACTOR_ENCRYPTION_KEY` by simply
  changing the environment value. Existing TOTP secrets and queued message
  bodies are encrypted with it and would become unreadable. For an approved
  maintenance window, stop API and worker, take a database backup, and make the
  old/new keys plus `DATABASE_URL` available only through the operator's secret
  environment as `TWO_FACTOR_OLD_ENCRYPTION_KEY`,
  `TWO_FACTOR_NEW_ENCRYPTION_KEY`, and `DATABASE_URL`. Set the explicit
  `EDUVERSE_ALLOW_2FA_KEY_ROTATION=1` gate and run:

  ```powershell
  pnpm --filter @workspace/scripts run rotate:2fa-key
  ```

  The tool re-encrypts account secrets and all outbox messages in one database
  transaction, prints row counts only, and rolls back on failure. After
  verifying success, update `TWO_FACTOR_ENCRYPTION_KEY` for API and worker to
  the new key and restart both. Keep the old key and backup secured until
  post-rotation login and message-delivery checks pass. Never run this tool
  against a database without explicit owner approval.

## School data import
Do not import real student records into the demo database. Create the school,
provision administrator accounts, import members, create classes, then assign
teachers and students. Validate that two test schools cannot read each other's
classes or assignments before importing production data.

## Mobile stores
The current client is a responsive PWA. A PWA can be installed on iPhone,
iPad, Android phones, tablets, and Android interactive boards without Xcode.
There is no signed native iOS/Android project in this repository yet.

A store release requires a native wrapper (Capacitor is the recommended reuse
path), app icons and splash assets, privacy policy and terms URLs, camera and
microphone usage descriptions, Android permissions, signing certificates, an
Apple Developer account on macOS/Xcode, and a Google Play Console account. Those
store submissions cannot be completed from this Windows workspace without the
accounts, certificates, app identifiers, and an Apple build machine.
