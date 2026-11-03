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
