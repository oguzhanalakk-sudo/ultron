$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runId = [guid]::NewGuid().ToString('N')
$profilePath = Join-Path $repoRoot ('.codex-smoke-userdata-' + $runId)
$smokeRoot = Join-Path $PSScriptRoot ('.codex-smoke-' + $runId)
$smokeProjectPath = Join-Path $smokeRoot 'demo'
$debugPort = Get-Random -Minimum 9400 -Maximum 9900
$projectPath = Join-Path $repoRoot 'tests/fixtures/demo'
$packageVersion = (Get-Content -Raw -LiteralPath (Join-Path $repoRoot 'package.json') | ConvertFrom-Json).version
$portablePath = Join-Path $repoRoot ("release\Ultron {0}.exe" -f $packageVersion)
$locationPushed = $false
$electronProcess = $null

function Test-LocalPort([int]$port) {
  $client = [System.Net.Sockets.TcpClient]::new()
  try {
    $attempt = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    if (-not $attempt.AsyncWaitHandle.WaitOne(1000)) { return $false }
    $client.EndConnect($attempt)
    return $true
  } catch { return $false }
  finally { $client.Close() }
}

function Stop-PackagedSmokeApp {
  $ownedProcesses = Get-CimInstance Win32_Process -Filter "name = 'Ultron.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like '*--remote-debugging-port=*' -and $_.CommandLine -like '*codex-smoke-userdata*' -and $_.CommandLine -notlike '*--type=*'
  }
  foreach ($ownedProcess in $ownedProcesses) { Stop-Process -Id $ownedProcess.ProcessId -Force -ErrorAction SilentlyContinue }
}

try {
  Stop-PackagedSmokeApp
  if (-not (Test-Path -LiteralPath $portablePath)) { throw "Portable executable not found: $portablePath" }
  $globalGrantFile = Join-Path $profilePath 'permission-grants.json'
  if (Test-Path -LiteralPath $globalGrantFile) { Remove-Item -LiteralPath $globalGrantFile -Force }
  New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
  if (Test-Path -LiteralPath $smokeRoot) { Remove-Item -LiteralPath $smokeRoot -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixtures/demo') -Destination $smokeProjectPath -Recurse
  $env:KODATOLYESI_SMOKE_API_TOKEN = 'smoke-only-secret-value'
  $electronProcess = Start-Process -FilePath $portablePath -ArgumentList @("--user-data-dir=$profilePath", "--remote-debugging-port=$debugPort", '--open-project', $smokeProjectPath) -WindowStyle Hidden -PassThru
  $debugReady = $false
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if (Test-LocalPort $debugPort) { $debugReady = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $debugReady) { throw 'Packaged app did not expose its local test endpoint on port 9223.' }
  $env:UI_SMOKE_DEBUG_PORT = [string]$debugPort
  $env:UI_SMOKE_PROJECT = $smokeProjectPath
  $env:UI_SMOKE_DEFER_CLEANUP = '1'
  Push-Location $repoRoot
  $locationPushed = $true
  npm.cmd run test:smoke:ui
  if ($LASTEXITCODE -ne 0) { throw "Packaged UI smoke test failed with exit code $LASTEXITCODE." }
} finally {
  if ($locationPushed) { Pop-Location }
  Stop-PackagedSmokeApp
  if ($electronProcess -and -not $electronProcess.HasExited) { Stop-Process -Id $electronProcess.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:UI_SMOKE_DEBUG_PORT -ErrorAction SilentlyContinue
  Remove-Item Env:UI_SMOKE_PROJECT -ErrorAction SilentlyContinue
  Remove-Item Env:UI_SMOKE_DEFER_CLEANUP -ErrorAction SilentlyContinue
  Remove-Item Env:KODATOLYESI_SMOKE_API_TOKEN -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $smokeRoot) { Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue }
  # Electron kapanırken dosya tutamaçları kısa süre açık kalabilir; profil klasörünü sınırlı denemeyle sil.
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    if (-not (Test-Path -LiteralPath $profilePath)) { break }
    Remove-Item -LiteralPath $profilePath -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $profilePath) { Start-Sleep -Milliseconds 700 }
  }
}
