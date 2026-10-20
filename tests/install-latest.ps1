# Kurulu sürümü günceller ve yeni kodun kullanıldığını doğrular.
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$setup = Get-ChildItem (Join-Path $repoRoot 'release') -Filter 'Ultron Setup *.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) { throw 'Kurulum dosyasi bulunamadi (Ultron Setup *.exe). Once npm run dist calistirin.' }
Write-Output ("Kurulum dosyasi: " + $setup.FullName + " (" + $setup.Length + " bayt)")

# Calisan Ultron varsa kurulumdan once kapat.
Get-Process Ultron -ErrorAction SilentlyContinue | ForEach-Object { Write-Output ("kapatiliyor: " + $_.Id); Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 3

# NSIS sessiz kurulum
$process = Start-Process -FilePath $setup.FullName -ArgumentList @('/S') -PassThru -Wait
Write-Output ("Kurulum giris kodu: " + $process.ExitCode)

$installed = Join-Path $env:LOCALAPPDATA 'Programs\Ultron'
$exe = Join-Path $installed 'Ultron.exe'
$asar = Join-Path $installed 'resources\app.asar'
if (-not (Test-Path -LiteralPath $exe)) { throw "Kurulu uygulama bulunamadi: $exe" }
Write-Output ("Kurulu uygulama: " + $exe)
if (Test-Path -LiteralPath $asar) {
  $hash = (Get-FileHash -LiteralPath $asar -Algorithm SHA256).Hash
  Write-Output ("app.asar SHA256: " + $hash)
  Write-Output ("app.asar boyutu: " + (Get-Item -LiteralPath $asar).Length)
}
Get-ChildItem $installed -Filter '*.exe' | ForEach-Object { Write-Output ("  kurulu dosya: " + $_.Name + " " + $_.Length) }
