import test from 'node:test'
import assert from 'node:assert/strict'
import { canRunAutomatically, classifyCommand, isSafePowerShellQuery, parseCommandLine } from '../electron/permissions.ts'

test('komut satırı tırnak içindeki boşlukları argüman olarak korur', () => {
  assert.deepEqual(parseCommandLine('npm run test -- --reporter "dot reporter"'), ['npm', 'run', 'test', '--', '--reporter', 'dot reporter'])
})

test('kabuk ayraçlarını, kapatılmamış tırnağı ve boş komutu reddeder', () => {
  for (const command of ['', 'npm test & whoami', 'git status; git clean', 'echo %PATH%', 'npm test "unclosed']) {
    assert.throws(() => parseCommandLine(command), undefined, command)
  }
  assert.throws(() => classifyCommand('powershell -NoProfile -Command Get-Date'), /desteklenen geliştirme araçları arasında değil/)
})

test('komutları geliştirme, paket, sistem ve yıkıcı risklerine ayırır', () => {
  assert.equal(classifyCommand('npm test').risk, 'development')
  assert.equal(classifyCommand('npm install react').risk, 'package')
  assert.equal(classifyCommand('.\\gradlew.bat assembleDebug').risk, 'package', 'Gradle build dependency indirebilir ve indirme için paket izni gerekir')
  assert.equal(classifyCommand('.\\gradlew.bat --offline assembleDebug').risk, 'development', 'Ağ kullanmayan offline derleme paket indirme izni istememeli')
  assert.equal(classifyCommand('.\\samples\\android-counter\\gradlew.bat assembleDebug').executable, '.\\samples\\android-counter\\gradlew.bat', 'Alt klasördeki wrapper dosyası proje kapsamı içinde çözülebilmeli')
  assert.throws(() => classifyCommand('..\\outside\\gradlew.bat assembleDebug'), /desteklenen geliştirme araçları arasında değil/)
  assert.equal(classifyCommand('winget install Git.Git').risk, 'system')
  for (const command of ['git push origin main', 'git fetch origin', 'git commit -m "save"', 'node -e "process.exit(0)"', 'python -c "print(1)"', 'python -m http.server', 'java -jar app.jar', 'adb install app.apk', 'npx eslint .', 'npm exec vite -- --version', 'git -C C:\\Users\\Public status', 'type ..\\secret.txt']) {
    assert.equal(classifyCommand(command).risk, 'system', `${command} has network, repository, or arbitrary-code side effects`)
  }
  assert.equal(classifyCommand('npx --no-install eslint .').risk, 'development')
  assert.equal(classifyCommand('git clean -fd').risk, 'destructive')
})

test('otomatik izin paket/sistem sınıflarını ayırır; kişisel profil bütün sınıfları otomatik çalıştırır', () => {
  const base = { commandMode: 'automatic' as const, allowPackageInstalls: false, allowSystemChanges: false }
  assert.equal(canRunAutomatically(base, 'development'), true)
  assert.equal(canRunAutomatically(base, 'package'), false)
  assert.equal(canRunAutomatically({ ...base, allowPackageInstalls: true }, 'package'), true)
  assert.equal(canRunAutomatically({ ...base, allowSystemChanges: true }, 'system'), true)
  assert.equal(canRunAutomatically({ ...base, allowPackageInstalls: true, allowSystemChanges: true }, 'destructive'), false)
  assert.equal(canRunAutomatically({ ...base, mode: 'personal', allowPackageInstalls: true, allowSystemChanges: true }, 'destructive'), true)
  assert.equal(canRunAutomatically({ ...base, commandMode: 'confirm' }, 'development'), false)
})

test('PowerShell otomatik çalışması yalnızca dar salt okunur sorgu listesiyle sınırlıdır', () => {
  assert.equal(isSafePowerShellQuery('Get-Date'), true)
  assert.equal(isSafePowerShellQuery('Get-Process -Name calc; Get-Service -Name Spooler'), true)
  for (const script of [
    'Remove-Item C:\\work\\file.txt',
    'Get-Process; Remove-Item C:\\work\\file.txt',
    'Get-Process; Start-Process cmd.exe',
    'Get-Content C:\\Users\\user\\secret.txt',
    'Get-Process | Out-File output.txt',
    'Get-Process; Invoke-Expression $payload',
  ]) assert.equal(isSafePowerShellQuery(script), false, script)
})
