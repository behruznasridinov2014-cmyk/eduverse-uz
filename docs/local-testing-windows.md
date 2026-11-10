# EDUVERSE-UZ local testing on Windows 11

This workflow runs against the locally installed PostgreSQL service. The test
API and frontend bind to `127.0.0.1` only: they are not exposed to the LAN or
internet, require no cloud account, and do not alter production configuration.
If the existing EDUVERSE frontend already responds on port 4173, the launcher
reuses it instead of starting a duplicate; the test API still starts separately.

## Requirements

- Windows PowerShell 5.1 or later
- Node.js and pnpm from the repository's supported toolchain
- PostgreSQL service running locally on `127.0.0.1:5432`
- `psql.exe` (the launcher checks `PATH` and PostgreSQL 17's default install
  path)

Docker Compose is not used by this workflow. The current environment has a
local PostgreSQL 17 Windows service and no Docker/Podman CLI.

## Start, verify, test, and stop

Run each command from the repository root. Start prompts for the local
PostgreSQL `postgres` password using a secure prompt. It creates a separate
`eduverse_test` database if needed. It pushes the current schema to an empty
database, adds missing school tables to an existing database that already
matches the EDUVERSE account schema, updates missing authentication tables and
columns, and refuses to modify any non-empty database that lacks the existing
`users` and `sessions` tables.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\start-eduverse-test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\status-eduverse-test.ps1
pnpm --filter @workspace/api-server run test:local
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop-eduverse-test.ps1
```

- Web: `http://127.0.0.1:4173`
- API health: `http://127.0.0.1:5000/api/healthz`
- API and frontend logs: `%LOCALAPPDATA%\EDUVERSE-UZ\local-test`
- Process IDs: `%LOCALAPPDATA%\EDUVERSE-UZ\local-test\processes.json`
- Test account logins and generated passwords:
  `%LOCALAPPDATA%\EDUVERSE-UZ\local-test\test-accounts.json`

The stop command stops only recorded launcher process trees and preserves the
test database. Do not remove or reset databases as part of routine testing.
The launcher creates or updates 28 explicitly named local test accounts in
`eduverse_test` (platform admin, ministry admin, education admin, school
director, school admin, teacher, parent, 20 role-preview students, and the
`demo_student_b_1` login for class 7-B). Role-preview passwords are generated
randomly; the demo student uses `demo-school-2026`. Credentials are stored only
in the local test credentials file; Windows ACLs are restricted to the current
user and SYSTEM. Never copy this file or these accounts into production. These
accounts are global role-preview accounts; the server-backed demo school and
class are linked only by the seeding script in `eduverse_test`. The seed is
idempotent: it creates the local demo school, adds role memberships, links the
teacher and six students to class 7-B, and adds two assignments with three
submissions. It does not provide real-school data or a guarantee that a
production tenant is isolated.
The smoke test also creates one randomly named synthetic student per run.
It authenticates against each seeded role and does not print passwords.

## Current automated test coverage

| Area | Current status |
|---|---|
| Password hashing and session token helpers | Unit tests exist |
| School role, validation, and permission helpers | Unit tests exist |
| API health, protected account registration/session/logout | Covered by the local API smoke script; requires the local API and test DB |
| Current account roles | Role is stored on the account; school membership is stored separately |
| School/class CRUD, membership, roster, assignments, submissions | Implemented with authenticated, role- and membership-scoped API routes; UI integration is server-first with local demo fallbacks |
| Two-school isolation | Server-side scope checks are implemented; an automated two-school database integration test is still required before production use |
| Class, student roster, teacher assignments, CSV import | Roster and assignment flows are implemented; CSV import is not implemented |
| Telegram 2FA, one-time setup binding, recovery codes, challenge-based login | Implemented; database integration tests require a dedicated local `eduverse_test` URL |
| Durable Telegram sending, timeout/retry/backoff, account/chat throttling | PostgreSQL outbox worker and policy tests implemented |
| 100,000 registered or concurrent accounts | Not load-tested; registered-account design target is not a concurrency claim |
| Online rooms, participant invitations, WebRTC camera/microphone/screen share | Implemented: PostgreSQL signalling, WebRTC mesh with perfect negotiation; automated end-to-end check in `scripts/lesson-webrtc-check.mjs` |
| iOS native app | Not present; the web UI is not a native app |

Server-side authorization now scopes school and class access by the
authenticated account and membership. Do not treat the presence of these routes
as proof of production tenant isolation: the required two-school database
integration tests must still be added, and synthetic school data must stay
restricted to the dedicated local test database.

The API unit suite includes Telegram delivery and security-helper tests. The
route-level Telegram 2FA suite is skipped unless
`EDUVERSE_TEST_DATABASE_URL` points to a loopback PostgreSQL database whose name
is `eduverse_test` (optionally with a local suffix). It uses fake bot values,
never calls Telegram, and refuses non-local or differently named databases.
Provision/apply the schema only to that dedicated local database before running
`pnpm --filter @workspace/api-server test`; do not point this variable at a
production database. For manual local UI testing, `EDUVERSE_DEV_2FA_ECHO=1`
exposes test codes only when `NODE_ENV` is not `production`. Development
encryption keys are ephemeral unless a local key is configured, so do not use
them for accounts that must survive a restart.

## WebRTC and device testing requirements

The live lesson uses a WebRTC mesh: the camera, the microphone and the screen
share are published with `addTrack`/`replaceTrack` and the offer/answer exchange
follows the perfect-negotiation pattern, so both sides can offer at the same
time without deadlocking. Signalling messages travel through the API and are
stored in PostgreSQL, which keeps the mesh working on serverless hosts.

Check the media path with two real Chrome tabs:

```powershell
# terminal 1 — API
$env:DATABASE_URL = "<your database>"
$env:PORT = "5000"
pnpm --filter @workspace/api-server run dev

# terminal 2 — web app
$env:PORT = "5173"
pnpm --filter @workspace/eduverse-uz run dev

# terminal 3 — headless Chrome with a fake camera and microphone
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
Start-Process $chrome -ArgumentList '--headless=new','--remote-debugging-port=9223',`
  '--user-data-dir=C:\Temp\eduverse-chrome','--use-fake-device-for-media-stream',`
  '--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required','about:blank'

# terminal 4 — the check itself (teacher + student in one room)
pnpm --filter @workspace/scripts run check:lesson
```

The check signs in as `demo_teacher` and `demo_student_b_1`, opens a room, joins
it with the second tab and verifies that the camera, the microphone and the
screen share really arrive at the other side (including the switch-off and
switch-on cycles).

The QR codes of the sign-in screen are verified separately:

```powershell
pnpm --filter @workspace/scripts run check:qr
```

Testing between different networks or real mobile devices requires reachable
signalling endpoints and a TURN server with appropriate credentials and
firewall configuration. Without a dedicated TURN server the mesh falls back to
public relays (`VITE_TURN_URL`, `VITE_TURN_USERNAME` and
`VITE_TURN_CREDENTIAL` set them at build time). Do not expose a development
server publicly as a substitute. Use synthetic accounts and room membership
checks in automated tests; require user consent before enabling camera,
microphone, or screen sharing.

## Native iOS plan

There is no Expo/React Native iOS application in this repository. A native iOS
client would need a separate approved implementation phase, shared API
contracts, secure platform credential storage, and device permission flows.
Building/signing and iOS Simulator validation require macOS with Xcode; the
iOS Simulator does not run on this Windows 11 workstation.
