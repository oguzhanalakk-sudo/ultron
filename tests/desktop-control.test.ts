import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildDesktopPayload,
  DESKTOP_HOST_SCRIPT,
  desktopResultFileName,
  isProtectedProcessName,
  normalizeCoordinates,
  normalizeTypedText,
  normalizeWindowTitle,
  parseDesktopResult,
  resolveTrustedApplicationTarget,
  parseKeyChord,
  PROTECTED_PROCESS_NAMES,
  resolveAppTarget,
  resolveVirtualKey,
} from '../electron/desktop-control.ts'

test('klavye kombinasyonu ayrıştırılır ve sanal tuş kodu bulunur', () => {
  const chord = parseKeyChord('ctrl+shift+s')
  assert.deepEqual(chord.modifiers, ['ctrl', 'shift'])
  assert.equal(chord.key, 's')
  assert.equal(resolveVirtualKey('s'), 0x53)
  assert.equal(resolveVirtualKey('enter'), 0x0d)
  assert.equal(resolveVirtualKey('f5'), 0x74)
  assert.equal(resolveVirtualKey('A'), 0x41)
})

test('geçersiz tuş kombinasyonu ve tuş reddedilir', () => {
  assert.throws(() => parseKeyChord(''), /boş/)
  assert.throws(() => parseKeyChord('ctrl'), /basılacak tuşu/)
  assert.throws(() => parseKeyChord('ctrl+a+b'), /yalnızca bir tuş/)
  assert.throws(() => resolveVirtualKey('f13'), /Desteklenmeyen tuş/)
  assert.throws(() => resolveVirtualKey('ş'), /Desteklenmeyen tuş/)
})

test('yazılacak metin sınırlandırılır ve kontrol karakterleri engellenir', () => {
  assert.equal(normalizeTypedText('Merhaba dünya'), 'Merhaba dünya')
  assert.throws(() => normalizeTypedText(''), /boş/)
  assert.throws(() => normalizeTypedText('a'.repeat(4001)), /4000 karakterden uzun/)
  assert.throws(() => normalizeTypedText('kötü\u0007 karakter'), /kontrol karakteri/)
})

test('fare koordinatları doğrulanır', () => {
  assert.deepEqual(normalizeCoordinates(10.4, -20.6), { x: 10, y: -21 })
  assert.throws(() => normalizeCoordinates('abc', 1), /sayı olmalı/)
  assert.throws(() => normalizeCoordinates(99999, 1), /ekran dışında/)
})

test('pencere başlığı doğrulanır', () => {
  assert.equal(normalizeWindowTitle('  Not Defteri  '), 'Not Defteri')
  assert.throws(() => normalizeWindowTitle(''), /boş/)
  assert.throws(() => normalizeWindowTitle('x'.repeat(201)), /çok uzun/)
})

test('Ultron kendi süreçleri korumalı', () => {
  assert.ok(PROTECTED_PROCESS_NAMES.includes('ultron'))
  assert.equal(isProtectedProcessName('Ultron'), true)
  assert.equal(isProtectedProcessName('electron.exe'), true)
  assert.equal(isProtectedProcessName('notepad'), false)
  assert.equal(isProtectedProcessName(null), false)
})

test('eylem yükü güvenli biçimde doğrulanır', () => {
  const move = buildDesktopPayload({ action: 'mouse_move', payload: { x: 100, y: 200 } })
  assert.deepEqual(move, { x: 100, y: 200, button: 'left', double: false, expect_title: '' })
  const click = buildDesktopPayload({ action: 'mouse_click', payload: { x: 5, y: 6, button: 'right', double: true, expect_title: 'Not Defteri' } })
  assert.equal(click.button, 'right')
  assert.equal(click.double, true)
  assert.equal(click.expect_title, 'Not Defteri')
  const keys = buildDesktopPayload({ action: 'keyboard_keys', payload: { keys: 'ctrl+s' } })
  assert.equal(keys.key, 's')
  assert.deepEqual(keys.modifiers, ['ctrl'])
  const type = buildDesktopPayload({ action: 'keyboard_type', payload: { text: 'abc' } })
  assert.equal(type.text, 'abc')
  const launch = buildDesktopPayload({ action: 'launch_app', payload: { path: 'C:/Windows/System32/notepad.exe' } })
  assert.equal(launch.target, 'C:/Windows/System32/notepad.exe')
})

test('tehlikeli hedef yolları ve kabuk karakterleri reddedilir', () => {
  assert.throws(() => buildDesktopPayload({ action: 'launch_app', payload: { path: 'C:\\Windows\\System32\\cmd.exe & del' } }), /güvenilmeyen karakter/)
  assert.throws(() => buildDesktopPayload({ action: 'launch_app', payload: { path: '' } }), /belirtilmedi/)
  assert.throws(() => buildDesktopPayload({ action: 'open_explorer', payload: { path: 'x'.repeat(700) } }), /çok uzun/)
})

test('masaüstü betiği kendi penceresine müdahale etmeyi reddeder', () => {
  assert.match(DESKTOP_HOST_SCRIPT, /SelfProcessId/)
  assert.match(DESKTOP_HOST_SCRIPT, /Ultron kendi penceresine/)
  assert.match(DESKTOP_HOST_SCRIPT, /Test-SelfProtected/)
  // Kullanıcı verisi betiğe gömülmez; yalnız JSON taşınır.
  assert.match(DESKTOP_HOST_SCRIPT, /ConvertFrom-Json/)
})

test('masaüstü betiği temel yetenekleri uygular', () => {
  for (const capability of ['SetCursorPos', 'SendInput', 'TypeUnicode', 'PressVirtualKey', 'EnumWindows', 'SetForegroundWindow', 'PostMessage', 'CopyFromScreen', 'UIAutomationClient', 'FromPoint']) {
    assert.ok(DESKTOP_HOST_SCRIPT.includes(capability), `Betişte ${capability} bulunmalı`)
  }
})

test('masaüstü betiği sonucun işaretli biçimde yazdırır', () => {
  assert.match(DESKTOP_HOST_SCRIPT, /ULTRON_RESULT/)
})

test('masaüstü sonucu ayrıştırılır', () => {
  const parsed = parseDesktopResult('ULTRON_RESULT {"ok":true,"cursor":{"x":10,"y":20}}')
  assert.equal(parsed.ok, true)
  assert.deepEqual(parsed.cursor, { x: 10, y: 20 })
})

test('bozuk veya eksik masaüstü çıktısı anlaşılır hata verir', () => {
  assert.match(parseDesktopResult('').error ?? '', /çıktı üretmedi/)
  assert.match(parseDesktopResult('ULTRON_RESULT {bozuk}').error ?? '', /geçersiz JSON/)
  assert.match(parseDesktopResult('ULTRON_RESULT {"error":"pencere bulunamadı"}').error ?? '', /pencere bulunamadı/)
})

test('ekran görüntüsü dosya adı güvenli ve benzersizdir', () => {
  const name = desktopResultFileName('desktop')
  assert.match(name, /^desktop-.*\.png$/)
  assert.notEqual(name, desktopResultFileName('desktop'))
})

test('kullanıcının yazdığı uygulama adı çalıştırılabilir dosyaya çevrilir', () => {
  assert.equal(resolveAppTarget('Not Defteri'), 'notepad.exe')
  assert.equal(resolveAppTarget('notepad'), 'notepad.exe')
  assert.equal(resolveAppTarget('hesap makinesi'), 'calc.exe')
  assert.equal(resolveAppTarget('dosya gezgini'), 'explorer.exe')
  assert.equal(resolveAppTarget('C:/Windows/System32/notepad.exe'), 'C:/Windows/System32/notepad.exe')
  assert.equal(resolveAppTarget('myapp'), 'myapp.exe')
  assert.equal(resolveAppTarget('myapp.exe'), 'myapp.exe')
})

test('uygulama adı çevirisi güvenlik kurallarını korur', () => {
  assert.throws(() => resolveAppTarget('notepad & calc'), /güvenilmeyen karakter/)
  assert.throws(() => resolveAppTarget(''), /belirtilmedi/)
  assert.throws(() => resolveAppTarget('x'.repeat(700)), /çok uzun/)
})

test('masaüstü eylemi uygulama adını çözümler', () => {
  const payload = buildDesktopPayload({ action: 'launch_app', payload: { path: 'Not Defteri' } })
  assert.equal(payload.target, 'notepad.exe')
})

test('güvenli uygulama başlatma listesi kabuk yürütücülerini reddeder', () => {
  assert.equal(resolveTrustedApplicationTarget('hesap makinesi'), 'calc.exe')
  assert.equal(resolveTrustedApplicationTarget('Not Defteri'), 'notepad.exe')
  assert.throws(() => resolveTrustedApplicationTarget('powershell'), /güvenli uygulama başlatma listesinde değil/)
  assert.throws(() => resolveTrustedApplicationTarget('C:/Windows/System32/notepad.exe'), /güvenli uygulama başlatma listesinde değil/)
})

test('deterministik metin görevi güvenli biçimde doğrulanır', () => {
  const payload = buildDesktopPayload({ action: 'text_task', payload: { app: 'Not Defteri', text: 'Ultron masaüstü ajanı', save_path: 'C:/Temp/not.txt', expect_title: 'Not Defteri' } })
  assert.equal(payload.app, 'notepad.exe')
  assert.equal(payload.text, 'Ultron masaüstü ajanı')
  assert.equal(payload.save_path, 'C:/Temp/not.txt')
  assert.equal(payload.expect_title, 'Not Defteri')
  assert.throws(() => buildDesktopPayload({ action: 'text_task', payload: { text: '  ' } }), /Yazılacak metin boş/)
  assert.throws(() => buildDesktopPayload({ action: 'text_task', payload: { text: 'x', save_path: 'C:\\a&b' } }), /güvenilmeyen karakter/)
})

test('deterministik öğe tıklaması öğe adı ister', () => {
  const payload = buildDesktopPayload({ action: 'click_element', payload: { name: 'Kaydet', window: 'Not Defteri' } })
  assert.equal(payload.name, 'Kaydet')
  assert.equal(payload.window, 'Not Defteri')
  assert.throws(() => buildDesktopPayload({ action: 'click_element', payload: { name: '' } }), /Tıklanacak öğe adı/)
})

test('masaüstü betiği teşhis ve deterministik akış eylemlerini uygular', () => {
  assert.match(DESKTOP_HOST_SCRIPT, /'preflight'/)
  assert.match(DESKTOP_HOST_SCRIPT, /'text_task'/)
  assert.match(DESKTOP_HOST_SCRIPT, /'click_element'/)
  // Teşhis: etkileşimli masaüstü oturumu kontrolü
  assert.match(DESKTOP_HOST_SCRIPT, /hasInteractiveDesktop/)
  assert.match(DESKTOP_HOST_SCRIPT, /UserInteractive/)
  // Deterministik akış: uygulama aç → odaklan → yaz → kaydet
  assert.match(DESKTOP_HOST_SCRIPT, /ForceForeground/)
  assert.match(DESKTOP_HOST_SCRIPT, /TypeUnicode/)
  assert.match(DESKTOP_HOST_SCRIPT, /UIAutomationClient/)
})

test('süreç, log ve varsayılan uygulama eylemleri doğrulanır', () => {
  assert.deepEqual(buildDesktopPayload({ action: 'process_list', payload: { name: 'notepad', pid: 12 } }), { name: 'notepad', pid: 12 })
  assert.deepEqual(buildDesktopPayload({ action: 'process_list', payload: {} }), { name: '', pid: null })
  assert.deepEqual(buildDesktopPayload({ action: 'process_start', payload: { name: 'notepad' } }), { name: 'notepad', pid: null })
  assert.deepEqual(buildDesktopPayload({ action: 'process_kill', payload: { pid: 12 } }), { name: '', pid: 12 })
  assert.deepEqual(buildDesktopPayload({ action: 'app_logs', payload: { path: 'logs/app.log', tail: 20 } }), { path: 'logs/app.log', tail: 20 })
  assert.deepEqual(buildDesktopPayload({ action: 'open_file_default', payload: { path: 'README.md' } }), { path: 'README.md' })
  assert.throws(() => buildDesktopPayload({ action: 'process_kill', payload: {} }), /Süreç adı veya PID/)
  assert.throws(() => buildDesktopPayload({ action: 'app_logs', payload: { path: 'x&y.log' } }), /güvenilmeyen/)
  assert.throws(() => buildDesktopPayload({ action: 'open_file_default', payload: { path: '' } }), /geçersiz/)
})

test('masaüstü betiği süreç ve varsayılan uygulama işlemlerini uygular', () => {
  for (const action of ["'process_list'", "'process_start'", "'process_kill'", "'app_logs'", "'open_file_default'"]) assert.match(DESKTOP_HOST_SCRIPT, new RegExp(action.replace(/[']/g, "'")))
  assert.match(DESKTOP_HOST_SCRIPT, /Get-Process/)
  assert.match(DESKTOP_HOST_SCRIPT, /Stop-Process/)
  assert.match(DESKTOP_HOST_SCRIPT, /Get-Content -LiteralPath/)
  assert.match(DESKTOP_HOST_SCRIPT, /Çalıştırılabilir dosyalar varsayılan uygulamayla açılmaz/)
})
