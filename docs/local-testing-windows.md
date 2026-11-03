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
`eduverse_test` database if needed and only pushes the current schema to an
empty database. If the database is non-empty but lacks the existing EDUVERSE
`users` and `sessions` tables, startup refuses to modify it.

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
The launcher creates or updates 27 explicitly named role-preview accounts in
`eduverse_test` (platform admin, ministry admin, education admin, school director,
school admin, teacher, parent, and 20 students). Each password is generated
randomly and stored only in the local test credentials file; Windows ACLs are
restricted to the current user and SYSTEM. Never copy this file or these
accounts into production. These accounts have global roles only: there are no
school records, school membership links, or cross-school isolation guarantees.
The smoke test also creates one randomly named synthetic student per run.
It authenticates against each seeded role and does not print passwords.

## Current automated test coverage

| Area | Current status |
|---|---|
| Password hashing and session token helpers | Unit tests exist |
| API health, account registration/session/logout, authenticated Guard | Covered by the local API smoke script; requires the local API and test DB |
| Current account roles | Role is stored on the account; no organization membership model |
| School/tenant CRUD and two-school isolation | Not implemented; no school or membership schema/API |
| Class, student roster, teacher assignments, CSV import | Not implemented |
| TOTP, QR enrollment, backup codes, device confirmation/history/revocation | Not implemented |
| Online rooms, participant invitations, WebRTC camera/microphone/screen share | Not implemented; lesson page is a local UI simulation |
| iOS native app | Not present; the web UI is not a native app |

Do not treat the absence of a tenant API as proof of tenant isolation. The
required two-school security tests must be added alongside school-scoped
tables and server-side authorization before real school data is introduced.
Synthetic school seed accounts should be added only after that schema exists,
and must be restricted to the dedicated local test database.

## WebRTC and device testing requirements

The current project does not implement WebRTC. Once it does, basic
`getUserMedia` testing can run on `localhost` in a modern browser with explicit
camera/microphone permission. Testing participant connections in one browser
can validate signaling paths, but does not validate network traversal.

Testing between different networks or real mobile devices requires reachable
signaling endpoints and a TURN server with appropriate credentials and
firewall configuration. Do not expose a development server publicly as a
substitute. Use synthetic accounts and room membership checks in automated
tests; require user consent before enabling camera, microphone, or screen
sharing.

## Native iOS plan

There is no Expo/React Native iOS application in this repository. A native iOS
client would need a separate approved implementation phase, shared API
contracts, secure platform credential storage, and device permission flows.
Building/signing and iOS Simulator validation require macOS with Xcode; the
iOS Simulator does not run on this Windows 11 workstation.
