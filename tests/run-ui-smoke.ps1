$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$runId = [guid]::NewGuid().ToString('N')
$profilePath = Join-Path $repoRoot ('.codex-smoke-userdata-' + $runId)
$smokeRoot = Join-Path $PSScriptRoot ('.codex-smoke-' + $runId)
$debugPort = Get-Random -Minimum 10000 -Maximum 16000
$smokeProjectPath = Join-Path $smokeRoot 'demo'
$locationPushed = $false
$rendererProcess = $null
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

try {
  Push-Location $repoRoot
  $locationPushed = $true
  npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Build failed with exit code $LASTEXITCODE." }
  $electronPath = Join-Path $repoRoot 'node_modules/electron/dist/electron.exe'
  if (-not (Test-Path -LiteralPath $electronPath)) { throw 'Electron runtime is missing. Run npm run setup:electron before the UI smoke test.' }
  # Önceki başarısız çalıştırmanın sağlayıcı/anahtar durumu sonraki smoke
  # sonucunu etkilememeli. Bu dizin yalnızca test için oluşturulur.
  if (Test-Path -LiteralPath $profilePath) { Remove-Item -LiteralPath $profilePath -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
  if (Test-Path -LiteralPath $smokeRoot) { Remove-Item -LiteralPath $smokeRoot -Recurse -Force }
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'fixtures/demo') -Destination $smokeProjectPath -Recurse
  $nodePath = (Get-Command node.exe).Source
  $viteScript = Join-Path $repoRoot 'node_modules/vite/bin/vite.js'
  $rendererProcess = Start-Process -FilePath $nodePath -ArgumentList @($viteScript, '--config', 'vite.renderer.config.ts', '--host', '127.0.0.1') -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru
  $rendererReady = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Test-LocalPort 5173) { $rendererReady = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $rendererReady) { throw 'Vite renderer did not start on port 5173.' }

  $env:ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173'
  $env:KODATOLYESI_SMOKE_API_TOKEN = 'smoke-only-secret-value'
  $electronProcess = Start-Process -FilePath $electronPath -ArgumentList @('.', "--user-data-dir=$profilePath", "--remote-debugging-port=$debugPort", '--open-project', $smokeProjectPath) -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru

  $debugReady = $false
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Test-LocalPort $debugPort) { $debugReady = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $debugReady) { throw "Electron remote debugging endpoint did not start on port $debugPort." }
  $env:UI_SMOKE_DEBUG_PORT = [string]$debugPort
  $env:UI_SMOKE_PROJECT = $smokeProjectPath
  $env:UI_SMOKE_DEFER_CLEANUP = '1'
  npm.cmd run test:smoke:ui
  if ($LASTEXITCODE -ne 0) { throw "UI smoke test failed with exit code $LASTEXITCODE." }
} finally {
  if ($electronProcess -and -not $electronProcess.HasExited) { Stop-Process -Id $electronProcess.Id -Force -ErrorAction SilentlyContinue }
  if ($rendererProcess -and -not $rendererProcess.HasExited) { Stop-Process -Id $rendererProcess.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:ELECTRON_RENDERER_URL -ErrorAction SilentlyContinue
  Remove-Item Env:KODATOLYESI_SMOKE_API_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:UI_SMOKE_PROJECT -ErrorAction SilentlyContinue
  Remove-Item Env:UI_SMOKE_DEFER_CLEANUP -ErrorAction SilentlyContinue
  Remove-Item Env:UI_SMOKE_DEBUG_PORT -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $smokeRoot) { Remove-Item -LiteralPath $smokeRoot -Recurse -Force -ErrorAction SilentlyContinue }
  # Electron kapanırken dosya tutamaçları kısa süre açık kalabilir; profil klasörünü sınırlı denemeyle sil.
  for ($attempt = 0; $attempt -lt 10; $attempt++) {
    if (-not (Test-Path -LiteralPath $profilePath)) { break }
    Remove-Item -LiteralPath $profilePath -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $profilePath) { Start-Sleep -Milliseconds 700 }
  }
  if ($locationPushed) { Pop-Location }
}
