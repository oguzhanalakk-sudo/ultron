import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildShortcutEntries,
  buildSoftwareCatalog,
  dedupeCatalog,
  parseRegQueryEntries,
  parseWhereOutput,
  reportCapabilityNeed,
} from '../electron/software-discovery.ts'

const regOutput = [
  '',
  'HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\GIMP_is1',
  '    DisplayName    REG_SZ    GIMP 2.10.36',
  '    DisplayVersion    REG_SZ    2.10.36',
  '    Publisher    REG_SZ    GIMP Team',
  '    InstallLocation    REG_SZ    C:\\Program Files\\GIMP 2\\',
  '',
  'HKEY_LOCAL_MACHINE\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{GUID}',
  '    DisplayName    REG_SZ    Microsoft Edge WebView',
  '    SystemComponent    REG_DWORD    0x1',
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\NodeTest',
  '    DisplayName    REG_SZ    Node.js',
  '    DisplayVersion    REG_SZ    20.11.0',
  '    Publisher    REG_SZ    OpenJS Foundation',
  '    InstallLocation    REG_SZ    C:\\Program Files\\nodejs\\',
  '    NoModify    REG_DWORD    0x1',
  '',
].join('\n')

test('parseRegQueryEntries: DisplayName/Version/Publisher/InstallLocation blokları okunur', () => {
  const entries = parseRegQueryEntries(regOutput)
  // SystemComponent bayraklı blok da parse edilir (filtreleme katalog kurulumundadır)
  assert.equal(entries.length, 3)
  const gimp = entries.find((entry) => entry.displayName === 'GIMP 2.10.36')
  assert.ok(gimp)
  assert.equal(gimp.version, '2.10.36')
  assert.equal(gimp.publisher, 'GIMP Team')
  assert.equal(gimp.installLocation, 'C:\\Program Files\\GIMP 2\\')
  assert.equal(gimp.systemComponent, false)
  const webview = entries.find((entry) => entry.displayName === 'Microsoft Edge WebView')
  assert.ok(webview)
  assert.equal(webview.systemComponent, true)
  const node = entries.find((entry) => entry.displayName === 'Node.js')
  assert.ok(node)
  assert.equal(node.version, '20.11.0')
})

test('parseRegQueryEntries: bozuk çıktıda hata vermeden bos döner', () => {
  assert.deepEqual(parseRegQueryEntries('hello world'), [])
  assert.deepEqual(parseRegQueryEntries(''), [])
})

test('buildSoftwareCatalog: girdileri birleştirir, SystemComponent hariç tutulur', () => {
  const entries = parseRegQueryEntries(regOutput)
  const catalog = buildSoftwareCatalog(entries)
  const names = catalog.map((entry) => entry.name)
  assert.ok(names.includes('GIMP 2.10.36'))
  assert.ok(names.includes('Node.js'))
  assert.ok(!names.includes('Microsoft Edge WebView')) // SystemComponent 0x1 → hariç
  // kategori tahminleri
  const nodeEntry = catalog.find((entry) => entry.name === 'Node.js')
  assert.ok(nodeEntry)
  assert.equal(nodeEntry.categories.includes('geliştirme'), true)
  assert.ok(nodeEntry.capabilities.includes('cli-control'))
})

test('buildSoftwareCatalog: PATH ekleri yürütülebilir yolun korur ve kategoriler birleştirilir', () => {
  const catalog = buildSoftwareCatalog(parseRegQueryEntries(regOutput), [
    { name: 'Node.js', executablePath: 'C:\\Program Files\\nodejs\\node.exe', source: 'path' },
    { name: '7-Zip', executablePath: 'C:\\Program Files\\7-Zip\\7z.exe', source: 'path' },
  ])
  const node = catalog.find((entry) => entry.name === 'Node.js')
  assert.ok(node)
  assert.equal(node.executablePath, 'C:\\Program Files\\nodejs\\node.exe')
  const sevenZip = catalog.find((entry) => entry.name === '7-Zip')
  assert.ok(sevenZip)
  assert.equal(sevenZip.source, 'path')
  assert.ok(sevenZip.capabilities.includes('cli-control'))
})

test('parseWhereOutput: ilk exe/cmd satırını seçer', () => {
  assert.equal(parseWhereOutput('git', 'C:\\Program Files\\Git\\cmd\\git.exe\r\nC:\\yonde\\git.exe\r\n'), 'C:\\Program Files\\Git\\cmd\\git.exe')
  assert.equal(parseWhereOutput('git', ''), null)
  assert.equal(parseWhereOutput('git', 'C:\\klasör\\git.txt'), null)
})

test('buildShortcutEntries ve dedupeCatalog kaynak önceliği çalışır', () => {
  const shortcuts = buildShortcutEntries([
    'Visual Studio Code.lnk',
    'Sürüm Notu (32-bit).lnk',
    'notdefteri.txt',
  ])
  const names = shortcuts.map((entry) => entry.name)
  assert.ok(names.includes('Visual Studio Code'))
  assert.ok(names.includes('Sürüm Notu')) // (32-bit) eki temizlendi
  assert.ok(!names.includes('notdefteri.txt'))
  assert.ok(shortcuts.every((entry) => entry.source === 'start-menu'))
  // dedupe: registry önceliklidir
  const merged = dedupeCatalog([
    { name: 'Node.js', version: null, publisher: null, installLocation: null, executablePath: 'C:\\x\\node.exe', source: 'path', categories: ['geliştirme'], capabilities: ['launch'] },
    { name: 'Node.js', version: '20.11.0', publisher: 'OpenJS', installLocation: null, executablePath: null, source: 'registry', categories: [], capabilities: ['launch'] },
    { name: 'Node.js', version: null, publisher: null, installLocation: null, executablePath: null, source: 'start-menu', categories: [], capabilities: [] },
  ])
  assert.equal(merged.length, 1)
  const node = merged[0]
  assert.equal(node.source, 'registry')
  assert.equal(node.version, '20.11.0')
  assert.equal(node.publisher, 'OpenJS')
  assert.equal(node.executablePath, 'C:\\x\\node.exe')
})

test('reportCapabilityNeed: yerleşik çözüm ve gerçek öneriler', () => {
  const pdf = reportCapabilityNeed('pdf dosyalarında metin aramak istiyorum', [])
  assert.ok(pdf)
  assert.equal(pdf.need.id, 'pdf')
  assert.ok(pdf.need.builtIn)
  assert.deepEqual(pdf.need.suggestions, [])
  const image = reportCapabilityNeed('görsel düzenleme programım yok', [])
  assert.ok(image)
  assert.equal(image.need.id, 'image-edit')
  assert.ok(image.need.suggestions.length > 0)
  assert.ok(image.need.suggestions.some((item) => item.name === 'GIMP' && item.downloadUrl.startsWith('https://www.gimp.org')))
  // kurulu araçlarla eşleşme
  const catalog = buildSoftwareCatalog([], [
    { name: 'GIMP 2.10.36', version: '2.10.36', source: 'registry' },
  ])
  const imageMatched = reportCapabilityNeed('görsel düzenleme', catalog)
  assert.ok(imageMatched)
  assert.ok(imageMatched.installedHits.some((entry) => entry.name.includes('GIMP')))
  // bilinmeyen gereksinim
  assert.equal(reportCapabilityNeed('helikopter pilotu bul', []), null)
})
