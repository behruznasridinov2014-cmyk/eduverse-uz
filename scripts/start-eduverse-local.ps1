$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
$psqlPath = if ($psqlCommand) {
  $psqlCommand.Source
} else {
  "C:\Program Files\PostgreSQL\17\bin\psql.exe"
}

if (!(Test-Path $psqlPath)) {
  throw "PostgreSQL psql.exe was not found. Install the PostgreSQL command-line tools."
}

$securePassword = Read-Host "Enter the local PostgreSQL password for user postgres" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$plainPassword = $null

try {
  $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
}

if ([string]::IsNullOrWhiteSpace($plainPassword)) {
  throw "A PostgreSQL password is required."
}

$databaseName = "eduverse_local"
$env:PGPASSWORD = $plainPassword
$databaseExists = & $psqlPath -w -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_database WHERE datname = '$databaseName'"

if ($LASTEXITCODE -ne 0) {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  throw "Could not authenticate to local PostgreSQL. Verify the password for user postgres."
}

$createdDatabase = -not ($databaseExists -contains "1")
if ($createdDatabase) {
  & $psqlPath -w -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $databaseName OWNER postgres"
  if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    throw "Could not create the separate $databaseName development database."
  }
}

$encodedPassword = [Uri]::EscapeDataString($plainPassword)
$env:DATABASE_URL = "postgresql://postgres:$encodedPassword@127.0.0.1:5432/$databaseName"
$plainPassword = $null
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

if (!$createdDatabase) {
  $tableCount = & $psqlPath -w -h 127.0.0.1 -p 5432 -U postgres -d $databaseName -v ON_ERROR_STOP=1 -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
  if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    throw "Could not inspect the existing $databaseName database."
  }

  $tableCountText = ($tableCount | Out-String).Trim()
  if ($tableCountText -notmatch '^\d+$') {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    throw "Could not read the table count for $databaseName."
  }

  if ($tableCountText -eq "0") {
    $createdDatabase = $true
  } else {
    $schemaState = & $psqlPath -w -h 127.0.0.1 -p 5432 -U postgres -d $databaseName -v ON_ERROR_STOP=1 -tAc "SELECT (to_regclass('public.users') IS NOT NULL)::int::text || '|' || (to_regclass('public.sessions') IS NOT NULL)::int::text || '|' || (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'))::int::text"
    if ($LASTEXITCODE -ne 0 -or $null -eq $schemaState -or -not ($schemaState -contains "1|1|1")) {
      Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
      throw "The existing $databaseName database is not empty and does not match the EDUVERSE account schema. It was left unchanged."
    }
  }
}

if ($createdDatabase) {
  Write-Host "Applying the Drizzle schema to the empty $databaseName database..."
  pnpm --filter @workspace/db run push
  if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    throw "Schema setup failed. The database was not force-migrated."
  }
} else {
  Write-Host "The existing $databaseName database matches the EDUVERSE account schema; no schema changes are needed."
}

$env:PORT = "5000"
Write-Host "Starting the EDUVERSE API at http://127.0.0.1:5000"
Write-Host "Keep this terminal open while using account features. Press Ctrl+C to stop the API."
pnpm --filter @workspace/api-server run dev
$apiExitCode = $LASTEXITCODE

Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:PORT -ErrorAction SilentlyContinue
exit $apiExitCode
