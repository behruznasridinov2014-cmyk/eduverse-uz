$ErrorActionPreference = "Stop"

$dataDirectory = Join-Path $env:LOCALAPPDATA "EDUVERSE-UZ\local-test"
$processFile = Join-Path $dataDirectory "processes.json"
if (!(Test-Path $processFile)) {
  Write-Output "No EDUVERSE local test process record found."
  exit 0
}

try {
  $record = Get-Content -Path $processFile -Raw | ConvertFrom-Json
} catch {
  throw "Cannot read local test process record. Inspect $processFile before removing it."
}

$processes = @(Get-CimInstance Win32_Process)
function Stop-ProcessTree([int]$ProcessId, [string]$ExpectedRunner) {
  $process = $processes | Where-Object { $_.ProcessId -eq $ProcessId } | Select-Object -First 1
  if (!$process) {
    Write-Output "Process $ProcessId is already stopped."
    return
  }
  if (!$process.CommandLine -or !$process.CommandLine.Contains($ExpectedRunner)) {
    Write-Output "Refusing to stop PID ${ProcessId}: its command line does not match the recorded EDUVERSE runner."
    return
  }

  $children = $processes | Where-Object { $_.ParentProcessId -eq $ProcessId }
  foreach ($child in $children) {
    Stop-ChildProcessTree -ProcessId ([int]$child.ProcessId)
  }
  Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
  Write-Output "Stopped EDUVERSE process $ProcessId."
}

function Stop-ChildProcessTree([int]$ProcessId) {
  $process = $processes | Where-Object { $_.ProcessId -eq $ProcessId } | Select-Object -First 1
  if (!$process) { return }
  $children = $processes | Where-Object { $_.ParentProcessId -eq $ProcessId }
  foreach ($child in $children) {
    Stop-ChildProcessTree -ProcessId ([int]$child.ProcessId)
  }
  Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
}

$apiRunner = [string]$record.ApiRunner
$webRunner = [string]$record.WebRunner
Stop-ProcessTree -ProcessId ([int]$record.ApiProcessId) -ExpectedRunner $apiRunner
Stop-ProcessTree -ProcessId ([int]$record.WebProcessId) -ExpectedRunner $webRunner
Remove-Item $processFile -ErrorAction SilentlyContinue
Write-Output "Test services stopped. The eduverse_test database was preserved."
