$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runId = [guid]::NewGuid().ToString('N')
$profilePath = Join-Path $repoRoot ('.codex-installed-userdata-' + $runId)
$debugPort = Get-Random -Minimum 9100 -Maximum 9350
$persistPort = Get-Random -Minimum 9350 -Maximum 9600
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

function Stop-InstalledTestApp {
  $ownedProcesses = Get-CimInstance Win32_Process -Filter "name = 'Ultron.exe'" -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -like '*codex-installed-userdata*'
  }
  foreach ($ownedProcess in $ownedProcesses) { Stop-Process -Id $ownedProcess.ProcessId -Force -ErrorAction SilentlyContinue }
}

function Start-InstalledTestApp([int]$port) {
  $process = Start-Process -FilePath $installedPath -ArgumentList @("--user-data-dir=$profilePath", "--remote-debugging-port=$port") -WindowStyle Hidden -PassThru
  for ($attempt = 0; $attempt -lt 80; $attempt++) {
    if (Test-LocalPort $port) { return $process }
    Start-Sleep -Milliseconds 500
  }
  throw "Installed app did not expose its local test endpoint on port $port."
}

function Stop-TestAppProcess($process) {
  # taskkill bazı durumlarda stderr'e hata yazar; $ErrorActionPreference='Stop' altında bu
  # gürültü script'i durdurabilir. cmd içi yönlendirme ile sessiz çalıştırılır; başarısız olsa
  # bile süreç ağacını Stop-InstalledTestApp temizler.
  if ($process -and -not $process.HasExited) { & cmd.exe /c "taskkill /PID $($process.Id) /T /F >nul 2>&1" | Out-Null }
}

try {
  Stop-InstalledTestApp
  if (-not (Test-Path -LiteralPath $installedPath)) { throw "Installed app not found: $installedPath. Run the installer first." }
  if (Test-Path -LiteralPath $profilePath) { Remove-Item -LiteralPath $profilePath -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
  $env:KODATOLYESI_SMOKE_API_TOKEN = 'smoke-only-secret-value'
  $env:INSTALLED_SMOKE_MARKER = 'isaret-' + $runId.Substring(0, 8)
  Push-Location $repoRoot
  $locationPushed = $true

  # 1. oturum: proje açmadan sohbet, "hatırla", Hafıza paneli, ses durumu ve işaret mesajı.
  $appProcess = Start-InstalledTestApp $debugPort
  $env:INSTALLED_SMOKE_DEBUG_PORT = [string]$debugPort
  npm.cmd run test:smoke:installed:ui
  if ($LASTEXITCODE -ne 0) { throw "Installed app smoke test failed with exit code $LASTEXITCODE." }

  # 2. oturum: uygulama kapanıp aynı profil ve veri klasörüyle yeniden açılır; sohbet geçmişi kalıcı olmalı.
  Stop-TestAppProcess $appProcess
  $appProcess = $null
  Stop-InstalledTestApp
  Start-Sleep -Seconds 2
  $appProcess = Start-InstalledTestApp $persistPort
  $env:INSTALLED_SMOKE_DEBUG_PORT = [string]$persistPort
  npm.cmd run test:smoke:installed:persist
  if ($LASTEXITCODE -ne 0) { throw "Installed app persistence test failed with exit code $LASTEXITCODE." }
} finally {
  if ($locationPushed) { Pop-Location }
  Stop-TestAppProcess $appProcess
  Stop-InstalledTestApp
  Remove-Item Env:INSTALLED_SMOKE_DEBUG_PORT -ErrorAction SilentlyContinue
  Remove-Item Env:INSTALLED_SMOKE_MARKER -ErrorAction SilentlyContinue
  Remove-Item Env:KODATOLYESI_SMOKE_API_TOKEN -ErrorAction SilentlyContinue
  # Electron kapanırken dosya tutamaçları kısa süre açık kalabilir; profil klasörünü sınırlı denemeyle sil.
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    if (-not (Test-Path -LiteralPath $profilePath)) { break }
    Remove-Item -LiteralPath $profilePath -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $profilePath) { Start-Sleep -Milliseconds 700 }
  }
}
