$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$dataDirectory = Join-Path $env:LOCALAPPDATA "EDUVERSE-UZ\local-test"
$processFile = Join-Path $dataDirectory "processes.json"
$apiLog = Join-Path $dataDirectory "api.log"
$webLog = Join-Path $dataDirectory "web.log"
$databaseName = "eduverse_test"

function Test-LocalPortListener([int]$Port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  $connection = $null
  try {
    $connection = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
    if (!$connection.AsyncWaitHandle.WaitOne(750)) {
      return $false
    }
    $client.EndConnect($connection)
    return $true
  } catch {
    return $false
  } finally {
    if ($connection) {
      $connection.AsyncWaitHandle.Close()
    }
    $client.Dispose()
  }
}
$psqlCommand = Get-Command psql -ErrorAction SilentlyContinue
$psqlPath = if ($psqlCommand) {
  $psqlCommand.Source
} else {
  "C:\Program Files\PostgreSQL\17\bin\psql.exe"
}

if (!(Test-Path $psqlPath)) {
  throw "PostgreSQL psql.exe was not found. Install PostgreSQL command-line tools."
}
if (!(Test-Path $psqlPath -PathType Leaf)) {
  throw "PostgreSQL psql.exe was not found at $psqlPath."
}
$postgresService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if (!$postgresService) {
  throw "The local PostgreSQL Windows service was not found. Install PostgreSQL before starting the local test stack."
}
if ($postgresService.Status -ne "Running") {
  try {
    Start-Service -Name $postgresService.Name -ErrorAction Stop
    $postgresService = Get-Service -Name $postgresService.Name
  } catch {
    throw "PostgreSQL service '$($postgresService.Name)' is stopped and could not be started. Start it from Windows Services, then retry."
  }
}
$existingProcessRecord = $null
$reuseApi = $false
$reuseWeb = $false
if (Test-Path $processFile) {
  try {
    $existingProcessRecord = Get-Content -Path $processFile -Raw | ConvertFrom-Json
  } catch {
    throw "Cannot read the existing local EDUVERSE process record. Inspect $processFile before starting again."
  }

  $existingApiProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$existingProcessRecord.ApiProcessId)" -ErrorAction SilentlyContinue
  if (
    $existingApiProcess -and
    $existingApiProcess.CommandLine -and
    $existingApiProcess.CommandLine.Contains([string]$existingProcessRecord.ApiRunner) -and
    (Test-LocalPortListener 5000)
  ) {
    $reuseApi = $true
    Write-Host "The EDUVERSE API is already running. The local database and demo login will be repaired and verified without stopping it."
  }
}

foreach ($port in @(5000, 4173)) {
  if (Test-LocalPortListener $port) {
    if ($port -eq 5000 -and $reuseApi) {
      continue
    }
    if ($port -eq 4173) {
      try {
        $existingWeb = Invoke-WebRequest -Uri "http://127.0.0.1:4173/" -TimeoutSec 5 -UseBasicParsing
        if ($existingWeb.StatusCode -eq 200 -and $existingWeb.Content.Contains("EDUVERSE")) {
          $reuseWeb = $true
          Write-Host "Reusing the existing local EDUVERSE frontend on port 4173."
          continue
        }
      } catch {
        throw "Port 4173 is already in use, but it did not serve the expected EDUVERSE page."
      }
    }
    throw "Port $port is already in use. Stop that service before starting the local test stack."
  }
}

New-Item -ItemType Directory -Force -Path $dataDirectory | Out-Null
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

$env:PGPASSWORD = $plainPassword
$databaseExists = & $psqlPath -w -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_database WHERE datname = '$databaseName'"
if ($LASTEXITCODE -ne 0) {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  throw "Could not authenticate to local PostgreSQL. Verify the password for user postgres."
}

$createdDatabase = -not ($databaseExists -contains "1")
if ($createdDatabase) {
  & $psqlPath -w -h 127.0.0.1 -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $databaseName OWNER postgres" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    throw "Could not create the separate $databaseName database."
  }
}

$encodedPassword = [Uri]::EscapeDataString($plainPassword)
$env:DATABASE_URL = "postgresql://postgres:$encodedPassword@127.0.0.1:5432/$databaseName"
$plainPassword = $null

if (!$createdDatabase) {
  $tableCount = & $psqlPath -w -h 127.0.0.1 -p 5432 -U postgres -d $databaseName -v ON_ERROR_STOP=1 -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
  if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    throw "Could not inspect the existing $databaseName database."
  }

  $tableCountText = ($tableCount | Out-String).Trim()
  if ($tableCountText -notmatch '^\d+$') {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    throw "Could not read the table count for $databaseName."
  }
  if ($tableCountText -eq "0") {
    $createdDatabase = $true
  } else {
    $schemaState = & $psqlPath -w -h 127.0.0.1 -p 5432 -U postgres -d $databaseName -v ON_ERROR_STOP=1 -tAc "SELECT (to_regclass('public.users') IS NOT NULL)::int::text || '|' || (to_regclass('public.sessions') IS NOT NULL)::int::text"
    if ($LASTEXITCODE -ne 0 -or $null -eq $schemaState -or -not ($schemaState -contains "1|1")) {
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
      Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
      throw "The existing $databaseName database is non-empty and does not match the EDUVERSE account schema. It was left unchanged."
    }
  }
}

if ($createdDatabase) {
  Write-Host "Applying the current Drizzle schema to the separate $databaseName database..."
  pnpm --filter @workspace/db run push
  if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    throw "Test database schema setup failed. The database was not force-migrated."
  }
} else {
  $schoolSchemaState = & $psqlPath -w -h 127.0.0.1 -p 5432 -U postgres -d $databaseName -v ON_ERROR_STOP=1 -tAc "SELECT (to_regclass('public.schools') IS NOT NULL AND to_regclass('public.school_members') IS NOT NULL AND to_regclass('public.school_classes') IS NOT NULL AND to_regclass('public.class_members') IS NOT NULL AND to_regclass('public.assignments') IS NOT NULL AND to_regclass('public.assignment_submissions') IS NOT NULL)::int::text"
  if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    throw "Could not inspect the school schema in the existing $databaseName database."
  }
  if (($schoolSchemaState | Out-String).Trim() -ne "1") {
    Write-Host "Adding missing school tables to the separate $databaseName database..."
    pnpm --filter @workspace/db run push
    if ($LASTEXITCODE -ne 0) {
      Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
      Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
      throw "Test database school schema setup failed. The database was not force-migrated."
    }
  } else {
    Write-Host "Existing $databaseName account and school tables found; no schema changes were applied."
  }
}

$authSchemaQuery = @"
SELECT (
  (SELECT COUNT(*) = 7
   FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'users'
     AND column_name IN (
       'two_factor_secret',
       'two_factor_telegram_id',
       'two_factor_enabled',
       'two_factor_pending_nonce',
       'two_factor_pending_expires_at',
       'two_factor_enabled_at',
       'two_factor_last_used_step'
     ))
  AND to_regclass('public.two_factor_recovery_codes') IS NOT NULL
  AND to_regclass('public.two_factor_challenges') IS NOT NULL
  AND to_regclass('public.telegram_outbox') IS NOT NULL
  AND to_regclass('public.rate_limit_buckets') IS NOT NULL
)::int::text
"@
$authSchemaReady = & $psqlPath -w -h 127.0.0.1 -p 5432 -U postgres -d $databaseName -v ON_ERROR_STOP=1 -tAc $authSchemaQuery
if ($LASTEXITCODE -ne 0) {
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  throw "Could not inspect the authentication schema in the local $databaseName database."
}
if (($authSchemaReady | Out-String).Trim() -ne "1") {
  Write-Host "Applying the current Drizzle schema to the local $databaseName database to add missing authentication columns and tables..."
  pnpm --filter @workspace/db run push
  if ($LASTEXITCODE -ne 0) {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    throw "Authentication schema setup failed. The local database was not force-migrated."
  }

  $authSchemaReady = & $psqlPath -w -h 127.0.0.1 -p 5432 -U postgres -d $databaseName -v ON_ERROR_STOP=1 -tAc $authSchemaQuery
  if ($LASTEXITCODE -ne 0 -or ($authSchemaReady | Out-String).Trim() -ne "1") {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    throw "The local authentication schema is still incomplete after setup. The API was not restarted."
  }
}

Write-Host "Creating/updating explicitly marked local role-testing accounts..."
$env:EDUVERSE_ALLOW_LOCAL_TEST_SEED = "1"
$env:EDUVERSE_LOCAL_TEST_DATA = $dataDirectory
node (Join-Path $PSScriptRoot "seed-local-test-accounts.mjs")
if ($LASTEXITCODE -ne 0) {
  Remove-Item Env:EDUVERSE_ALLOW_LOCAL_TEST_SEED -ErrorAction SilentlyContinue
  Remove-Item Env:EDUVERSE_LOCAL_TEST_DATA -ErrorAction SilentlyContinue
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  throw "Local test account seeding failed; the API and frontend were not started."
}
Remove-Item Env:EDUVERSE_ALLOW_LOCAL_TEST_SEED -ErrorAction SilentlyContinue
Remove-Item Env:EDUVERSE_LOCAL_TEST_DATA -ErrorAction SilentlyContinue

$credentialFile = Join-Path $dataDirectory "test-accounts.json"
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $credentialFile /inheritance:r /grant:r "${currentIdentity}:(R,W)" "SYSTEM:(F)" /C | Out-Null
if ($LASTEXITCODE -ne 0) {
  Remove-Item $credentialFile -ErrorAction SilentlyContinue
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  throw "Could not restrict access to generated test credentials; refusing to start services."
}

Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
$apiRunner = Join-Path $PSScriptRoot "run-eduverse-test-api.ps1"
$webRunner = Join-Path $PSScriptRoot "run-eduverse-test-web.ps1"
$powerShellPath = Join-Path $PSHOME "powershell.exe"

try {
  if (!$reuseApi) {
    $apiProcess = Start-Process -FilePath $powerShellPath -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$apiRunner`"") -WorkingDirectory $repoRoot -RedirectStandardOutput $apiLog -RedirectStandardError "$apiLog.err" -PassThru
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  }
  if (!$reuseWeb) {
    $webProcess = Start-Process -FilePath $powerShellPath -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$webRunner`"") -WorkingDirectory $repoRoot -RedirectStandardOutput $webLog -RedirectStandardError "$webLog.err" -PassThru
  }
  if (!$reuseApi -or !$reuseWeb) {
    $apiProcessId = if ($reuseApi) { [int]$existingProcessRecord.ApiProcessId } else { $apiProcess.Id }
    $webProcessId = if ($reuseWeb) { [int]$existingProcessRecord.WebProcessId } elseif ($webProcess) { $webProcess.Id } else { 0 }
    $recordedApiRunner = if ($reuseApi) { [string]$existingProcessRecord.ApiRunner } else { $apiRunner }
    $recordedWebRunner = if ($reuseWeb -and $existingProcessRecord.WebRunner) { [string]$existingProcessRecord.WebRunner } else { $webRunner }
    [pscustomobject]@{
      ApiProcessId = $apiProcessId
      WebProcessId = $webProcessId
      WebReused = $reuseWeb
      ApiRunner = $recordedApiRunner
      WebRunner = $recordedWebRunner
    } | ConvertTo-Json | Set-Content -Path $processFile -Encoding UTF8
  }
} catch {
  if ($webProcess) {
    Stop-Process -Id $webProcess.Id -ErrorAction SilentlyContinue
  }
  if ($apiProcess) {
    Stop-Process -Id $apiProcess.Id -ErrorAction SilentlyContinue
  }
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  throw
}

Write-Host "Checking API health and the demo student login..."
$apiHealthy = $false
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  try {
    $health = Invoke-WebRequest -Uri "http://127.0.0.1:5000/api/healthz" -TimeoutSec 3 -UseBasicParsing
    if ($health.StatusCode -eq 200) {
      $apiHealthy = $true
      break
    }
  } catch {
    Start-Sleep -Seconds 2
  }
}
if (!$apiHealthy) {
  Write-Host "API did not become ready. Recent API log:"
  if (Test-Path $apiLog) { Get-Content $apiLog -Tail 30 }
  if (Test-Path "$apiLog.err") { Get-Content "$apiLog.err" -Tail 15 }
  throw "The API is not ready. Database and frontend were left intact for diagnosis."
}

$webHealthy = $false
try {
  $webHealth = Invoke-WebRequest -Uri "http://127.0.0.1:4173/api/healthz" -TimeoutSec 5 -UseBasicParsing
  $webHealthy = $webHealth.StatusCode -eq 200
} catch {
  Write-Host "Frontend API proxy check failed: $($_.Exception.Message)"
}
if (!$webHealthy) {
  throw "Startup verification failed: the frontend is not reaching the local API at http://127.0.0.1:5000."
}

try {
  $demoLogin = Invoke-WebRequest `
    -Uri "http://127.0.0.1:5000/api/auth/login" `
    -Method Post `
    -ContentType "application/json" `
    -Body '{"login":"demo_student_b_1","password":"demo-school-2026"}' `
    -TimeoutSec 10 `
    -UseBasicParsing
  $demoLoginBody = $demoLogin.Content | ConvertFrom-Json
} catch {
  if ($_.Exception.Response) {
    Write-Host "Demo student login returned HTTP $([int]$_.Exception.Response.StatusCode)."
    $errorReader = [System.IO.StreamReader]::new($_.Exception.Response.GetResponseStream())
    $errorBody = $errorReader.ReadToEnd()
    if ($errorBody) { Write-Host "API response: $errorBody" }
  } else {
    Write-Host "Demo student login request failed: $($_.Exception.Message)"
  }
  Write-Host "Recent API log:"
  if (Test-Path $apiLog) { Get-Content $apiLog -Tail 30 }
  if (Test-Path "$apiLog.err") { Get-Content "$apiLog.err" -Tail 15 }
  throw "Startup verification failed: demo_student_b_1 could not sign in."
}
if ($demoLogin.StatusCode -ne 200 -or $demoLoginBody.user.login -ne "demo_student_b_1") {
  throw "Startup verification failed: the demo student login did not return the expected account."
}

Write-Host "Local test services are ready."
Write-Host "Web: http://127.0.0.1:4173"
Write-Host "API health: http://127.0.0.1:5000/api/healthz"
Write-Host "Frontend-to-API connection verified."
Write-Host "Demo student login verified: demo_student_b_1"
Write-Host "Database: $databaseName (separate from eduverse_local)"
Write-Host "Role-test credentials: $credentialFile (local test accounts only)"
Write-Host "Process record: $processFile"
Write-Host "Logs: $apiLog and $webLog"
Write-Host "Run scripts\status-eduverse-test.ps1 to verify readiness."
