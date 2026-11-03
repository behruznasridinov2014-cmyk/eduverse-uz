$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($env:DATABASE_URL)) {
  throw "DATABASE_URL was not provided by the local test launcher."
}

$env:PORT = "5000"
$env:HOST = "127.0.0.1"
$env:EDUVERSE_ALLOW_PUBLIC_REGISTRATION = "1"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
pnpm --filter @workspace/api-server run dev
exit $LASTEXITCODE
