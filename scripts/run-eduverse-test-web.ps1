$ErrorActionPreference = "Stop"

$env:PORT = "4173"
$env:BASE_PATH = "/"
if ([string]::IsNullOrWhiteSpace($env:API_SERVER_URL)) {
  $env:API_SERVER_URL = "http://127.0.0.1:5000"
}

Set-Location (Resolve-Path (Join-Path $PSScriptRoot ".."))
pnpm --filter @workspace/eduverse-uz run dev -- --host 127.0.0.1 --port 4173
exit $LASTEXITCODE
