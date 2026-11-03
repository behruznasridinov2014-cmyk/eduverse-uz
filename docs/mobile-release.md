# Mobile release

The current React/Vite client is the shared responsive product. First ship it as
an HTTPS PWA; this works on iPhone, iPad, Android, Windows laptops, and Android
interactive boards. Store packages require a native shell and cannot be signed
from this Windows-only workspace.

Recommended next implementation:

```powershell
pnpm add @capacitor/core @capacitor/cli @capacitor/android
pnpm exec cap init EDUVERSE-UZ uz.eduverse.school --web-dir artifacts/eduverse-uz/dist/public
pnpm exec cap add android
pnpm exec cap sync android
```

Run the iOS commands on macOS with Xcode and an Apple Developer account:

```text
pnpm add @capacitor/ios
pnpm exec cap add ios
pnpm exec cap sync ios
pnpm exec cap open ios
```

Before submission, add production API URL, app icons, launch screen, privacy
policy, terms, camera/microphone/screen-share usage descriptions, Android
permission declarations, deep links, crash reporting, and store screenshots.
Do not use local demo accounts or the local PostgreSQL database in either store
build.
