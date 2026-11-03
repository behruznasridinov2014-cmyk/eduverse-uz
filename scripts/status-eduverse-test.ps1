$ErrorActionPreference = "Stop"

$dataDirectory = Join-Path $env:LOCALAPPDATA "EDUVERSE-UZ\local-test"
$processFile = Join-Path $dataDirectory "processes.json"
$apiLog = Join-Path $dataDirectory "api.log"
$webLog = Join-Path $dataDirectory "web.log"

function Test-HttpEndpoint([string]$Name, [string]$Url) {
  try {
    $response = Invoke-WebRequest -Uri $Url -TimeoutSec 5 -UseBasicParsing
    Write-Host "$Name : HTTP $($response.StatusCode)"
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 400
  } catch {
    if ($_.Exception.Response) {
      $statusCode = [int]$_.Exception.Response.StatusCode
      Write-Host "$Name : HTTP $statusCode"
    } else {
      Write-Host "$Name : unavailable"
    }
    return $false
  }
}

$postgres = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($postgres) {
  Write-Output "PostgreSQL service ($($postgres.Name)): $($postgres.Status)"
} else {
  Write-Output "PostgreSQL service: not found"
}

$processRecord = $null
if (Test-Path $processFile) {
  try {
    $processRecord = Get-Content -Path $processFile -Raw | ConvertFrom-Json
  } catch {
    Write-Output "Local process record: unreadable ($processFile)"
  }
} else {
  Write-Output "Local process record: not found"
}

if ($processRecord) {
  if ($processRecord.WebReused) {
    Write-Output "Web launcher: reusing an existing local EDUVERSE frontend"
  }
  foreach ($service in @(
      @{ Name = "API launcher"; Id = [int]$processRecord.ApiProcessId },
      @{ Name = "Web launcher"; Id = [int]$processRecord.WebProcessId }
    )) {
    if ($service.Name -eq "Web launcher" -and $processRecord.WebReused) {
      continue
    }
    $process = Get-Process -Id $service.Id -ErrorAction SilentlyContinue
    if ($process) {
      Write-Output "$($service.Name): running (PID $($service.Id))"
    } else {
      Write-Output "$($service.Name): stopped"
    }
  }
}

$apiReady = Test-HttpEndpoint "API health" "http://127.0.0.1:5000/api/healthz"
$webReady = Test-HttpEndpoint "Frontend" "http://127.0.0.1:4173/"
if (!$apiReady -and (Test-Path $apiLog)) {
  Write-Output "Recent API log:"
  Get-Content $apiLog -Tail 12
  if (Test-Path "$apiLog.err") { Get-Content "$apiLog.err" -Tail 8 }
}
if (!$webReady -and (Test-Path $webLog)) {
  Write-Output "Recent web log:"
  Get-Content $webLog -Tail 12
  if (Test-Path "$webLog.err") { Get-Content "$webLog.err" -Tail 8 }
}

if (!$apiReady -or !$webReady) {
  exit 1
}
