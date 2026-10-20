import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import {
  checkDependencies,
  checkToolConflicts,
  compareVersions,
  computePackageChecksum,
  isPluginAgentToolName,
  parsePluginAgentToolName,
  pluginAgentToolName,
  pluginDataPath,
  satisfiesRange,
  validateManifest,
} from '../electron/plugin-manager.ts'

const baseManifest = {
  id: 'ornek-eklenti',
  name: 'Örnek Eklenti',
  version: '1.0.0',
  entry: 'main.js',
  tools: [
    { name: 'topla', description: 'İki sayıyı toplar', parameters: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] } },
  ],
  permissions: ['storage'],
}

function clone(overrides: Record<string, unknown>): unknown {
  return structuredClone({ ...baseManifest, ...overrides })
}

test('validateManifest: geçerli manifest onaylanır', () => {
  const result = validateManifest(clone({}))
  assert.ok(result.ok)
  if (result.ok) {
    assert.equal(result.manifest.id, 'ornek-eklenti')
    assert.deepEqual(result.manifest.permissions, ['storage'])
    assert.equal(result.manifest.tools[0].name, 'topla')
  }
})

test('validateManifest: id, version, entry ve tool ad kuralları katıdır', () => {
  const bad = validateManifest(clone({ id: 'Kötü ID!', version: '1.0', entry: '..\\evil.js', tools: [{ name: 'ç k', description: '' }] }))
  assert.ok(!bad.ok)
  if (!bad.ok) {
    const joined = bad.errors.join(' ')
    assert.ok(joined.includes('id biçimi geçersiz'))
    assert.ok(joined.includes('version biçimi'))
    assert.ok(joined.includes('göreli ve içinde olmalıdır'))
    assert.ok(joined.includes('araç adı geçersiz'))
  }
})

test('validateManifest: araç parametre şemaları doğrulanır, tekrarlı ad reddedilir', () => {
  const bad = validateManifest(clone({
    tools: [
      { name: 'mont', description: 'x', parameters: { type: 'array', properties: {} } },
      { name: 'mont', description: 'y' },
    ],
  }))
  assert.ok(!bad.ok)
  if (!bad.ok) {
    const joined = bad.errors.join(' ')
    assert.ok(joined.includes('"mont".parameters.type'))
    assert.ok(joined.includes('araç adı tekrarlı: mont'))
  }
  const titleless = validateManifest(clone({ tools: [{ name: 'mont', description: '' }] }))
  assert.ok(!titleless.ok)
  if (!titleless.ok) assert.ok(titleless.errors.join(' ').includes('description boş olamaz'))
})

test('validateManifest: izinler kataloğun dışına çıkamaz', () => {
  const bad = validateManifest(clone({ permissions: ['storage', 'filesystem-root'] }))
  assert.ok(!bad.ok)
  if (!bad.ok) assert.ok(bad.errors.join(' ').includes('izin geçersiz'))
})

test('validateManifest: bağımlılık aralıkları denetlenir', () => {
  const ok = validateManifest(clone({ dependencies: { 'yardimci-eklenti': '^1.2.0' } }))
  assert.ok(ok.ok)
  if (ok.ok) assert.deepEqual(ok.manifest.dependencies, { 'yardimci-eklenti': '^1.2.0' })
  const bad = validateManifest(clone({ dependencies: { 'yardimci-eklenti': '>=1.x' } }))
  assert.ok(!bad.ok)
})

test('compareVersions düzgün sıralar', () => {
  assert.ok(compareVersions('2.0.0', '1.9.9') > 0)
  assert.ok(compareVersions('1.2.3', '1.2.3') === 0)
  assert.ok(compareVersions('1.2.3', '1.10.0') < 0)
})

test('satisfiesRange: tam, büyük-major ve >= aralıkları', () => {
  assert.ok(satisfiesRange('1.2.3', '1.2.3'))
  assert.ok(!satisfiesRange('1.2.4', '1.2.3'))
  assert.ok(satisfiesRange('1.9.0', '^1.2.3'))
  assert.ok(!satisfiesRange('2.0.0', '^1.2.3'))
  assert.ok(satisfiesRange('1.2.4', '>=1.2.3'))
  assert.ok(!satisfiesRange('1.2.2', '>=1.2.3'))
})

test('checkDependencies eksik/uyumsuz bağımlılıkları raporlar', () => {
  const manifest = validateManifest(clone({ dependencies: { 'yardimci-eklenti': '^2.0.0', 'sabitleyici': '3.1.0' } }))
  assert.ok(manifest.ok)
  if (!manifest.ok) return
  const installed = { 'yardimci-eklenti': '2.1.7', 'sabitleyici': '3.2.0' }
  const issues = checkDependencies(manifest.manifest, installed)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].id, 'sabitleyici')
  const none = checkDependencies(manifest.manifest, {})
  assert.equal(none.length, 2)
})

test('checkToolConflicts aynı araç adını yakalar', () => {
  const candidate = validateManifest(clone({})).ok ? (validateManifest(clone({})) as { ok: true; manifest: { id: string; tools: { name: string }[] } }).manifest : null
  assert.ok(candidate)
  const conflicts = checkToolConflicts(candidate as never, [{ id: 'diger', toolNames: ['topla'] }])
  assert.equal(conflicts.length, 1)
  assert.ok(conflicts[0].includes('"topla"'))
  const clean = checkToolConflicts(candidate as never, [{ id: 'diger', toolNames: ['farklı'] }])
  assert.equal(clean.length, 0)
})

test('pluginAgentToolName biçimi ve ayrıştırma uyumlu', () => {
  const name = pluginAgentToolName('ornek-eklenti', 'topla')
  assert.equal(name, 'plugin_ornek-eklenti_topla')
  assert.ok(isPluginAgentToolName(name))
  const parsed = parsePluginAgentToolName(name)
  assert.deepEqual(parsed, { pluginId: 'ornek-eklenti', toolName: 'topla' })
  assert.ok(!isPluginAgentToolName('plugins_list'))
  assert.equal(parsePluginAgentToolName('find_files'), null)
})

test('pluginDataPath yalnızca eklenti klasörü içinde kalır', () => {
  const base = path.join('C:', 'AppData', 'ultron', 'plugin-data')
  assert.equal(pluginDataPath(base, 'ornek-eklenti', 'veri.json'), path.join(base, 'ornek-eklenti', 'veri.json'))
  assert.equal(pluginDataPath(base, 'ornek-eklenti', '..\\sır.json'), null)
  assert.equal(pluginDataPath(base, 'Kötü_ID', 'x.json'), null)
  assert.equal(pluginDataPath(base, 'ornek-eklenti', 'C:\\sır.json'), null)
})

test('computePackageChecksum içerik sırasına göre kararlıdır', () => {
  const first = computePackageChecksum([
    { relativePath: 'main.js', content: 'console.log(1)' },
    { relativePath: 'manifest.json', content: '{"id":"ornek-eklenti"}' },
  ])
  const second = computePackageChecksum([
    { relativePath: 'manifest.json', content: '{"id":"ornek-eklenti"}' },
    { relativePath: 'main.js', content: 'console.log(1)' },
  ])
  const changed = computePackageChecksum([
    { relativePath: 'main.js', content: 'console.log(2)' },
    { relativePath: 'manifest.json', content: '{"id":"ornek-eklenti"}' },
  ])
  assert.equal(first, second)
  assert.notEqual(first, changed)
  assert.equal(first.length, 64)
})
