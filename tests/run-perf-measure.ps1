$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runId = [guid]::NewGuid().ToString('N')
$profilePath = Join-Path $repoRoot ('.codex-perf-userdata-' + $runId)
$debugPort = Get-Random -Minimum 9600 -Maximum 9900
$installedPath = Join-Path $env:LOCALAPPDATA 'Programs\Ultron\Ultron.exe'
$appProcess = $null
$locationPushed = $false

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

function Stop-PerfApp {
  $ownedProcesses = Get-CimInstance Win32_Process -Filter "name = 'Ultron.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like '*codex-perf-userdata*'
  }
  foreach ($ownedProcess in $ownedProcesses) { Stop-Process -Id $ownedProcess.ProcessId -Force -ErrorAction SilentlyContinue }
}

try {
  Stop-PerfApp
  if (-not (Test-Path -LiteralPath $installedPath)) { throw "Installed app not found: $installedPath. Run the installer first." }
  if (Test-Path -LiteralPath $profilePath) { Remove-Item -LiteralPath $profilePath -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
  $existingPids = @(Get-Process -Name Ultron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
  $env:PERF_LAUNCH_AT = [string][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $appProcess = Start-Process -FilePath $installedPath -ArgumentList @("--user-data-dir=$profilePath", "--remote-debugging-port=$debugPort") -WindowStyle Hidden -PassThru
  $debugReady = $false
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if (Test-LocalPort $debugPort) { $debugReady = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $debugReady) { throw "Perf app did not expose its local test endpoint on port $debugPort." }
  $env:PERF_DEBUG_PORT = [string]$debugPort
  Push-Location $repoRoot
  $locationPushed = $true
  npm.cmd run test:perf:ui
  if ($LASTEXITCODE -ne 0) { throw "Performance measurement failed with exit code $LASTEXITCODE." }
  $newProcesses = @(Get-Process -Name Ultron -ErrorAction SilentlyContinue | Where-Object { $existingPids -notcontains $_.Id })
  $totalWorkingSet = ($newProcesses | Measure-Object WorkingSet64 -Sum).Sum
  Write-Host ("PERF-MEMORY processes={0} totalWorkingSetMB={1:N1}" -f $newProcesses.Count, ($totalWorkingSet / 1MB))
} finally {
  if ($locationPushed) { Pop-Location }
  # taskkill stderr'i $ErrorActionPreference='Stop' ile script'i durdurabilir; cmd içi
  # yönlendirme ile sessiz çalıştırılır, süreç ağacını Stop-PerfApp zaten temizler.
  if ($appProcess -and -not $appProcess.HasExited) { & cmd.exe /c "taskkill /PID $($appProcess.Id) /T /F >nul 2>&1" | Out-Null }
  Stop-PerfApp
  Remove-Item Env:PERF_DEBUG_PORT -ErrorAction SilentlyContinue
  Remove-Item Env:PERF_LAUNCH_AT -ErrorAction SilentlyContinue
  # Electron kapanırken dosya tutamaçları kısa süre açık kalabilir; profil klasörünü sınırlı denemeyle sil.
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    if (-not (Test-Path -LiteralPath $profilePath)) { break }
    Remove-Item -LiteralPath $profilePath -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $profilePath) { Start-Sleep -Milliseconds 700 }
  }
}
