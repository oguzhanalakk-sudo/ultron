import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAdapterCommand, describeAdaptersForTool, findAdapter, listAdapters } from '../electron/app-adapters.ts'

test('adaptör kataloğu gerçek araçları listeler', () => {
  const adapters = listAdapters()
  const ids = adapters.map((adapter) => adapter.id)
  for (const expected of ['git', 'node', 'npm', 'pnpm', 'yarn', 'bun', 'python', 'pip', 'vscode', 'ollama', 'docker', 'dotnet', 'gradle', 'maven', 'cargo', 'go', 'cmake', 'ninja']) {
    assert.ok(ids.includes(expected), `adaptör eksik: ${expected}`)
  }
  assert.ok(describeAdaptersForTool().includes('git'))
})

test('buildAdapterCommand: read-only git status komutu düzgün üretilir', () => {
  const built = buildAdapterCommand({ adapterId: 'git', actionId: 'status', projectPath: 'C:\\projeler\\demo' })
  assert.ok(built.ok)
  assert.equal(built.command, 'git status --short --branch')
  assert.equal(built.risk, 'read-only')
  assert.equal(built.adapter, 'git')
  assert.equal(built.action, 'status')
})

test('buildAdapterCommand: bilinmeyen adaptör ve eylem net hata döndürür', () => {
  const unknownAdapter = buildAdapterCommand({ adapterId: 'photoshop', actionId: 'open' })
  assert.ok(!unknownAdapter.ok)
  if (!unknownAdapter.ok) assert.ok(unknownAdapter.error.includes('Geçerli adaptörler'))
  const unknownAction = buildAdapterCommand({ adapterId: 'git', actionId: 'rebase-everything' })
  assert.ok(!unknownAction.ok)
  if (!unknownAction.ok) assert.ok(unknownAction.error.includes('eylemleri'))
})

test('buildAdapterCommand: proje gerektiren eylem proje yoksa hata verir', () => {
  const built = buildAdapterCommand({ adapterId: 'npm', actionId: 'test' })
  assert.ok(!built.ok)
  if (!built.ok) assert.ok(built.error.includes('proje dizini gerektirir'))
  const withProject = buildAdapterCommand({ adapterId: 'npm', actionId: 'test', projectPath: 'C:\\projeler\\demo' })
  assert.ok(withProject.ok)
  if (withProject.ok) assert.equal(withProject.command, 'npm test')
})

test('buildAdapterCommand: git add_commit mesaj tırnaklarını temizler', () => {
  const built = buildAdapterCommand({ adapterId: 'git', actionId: 'add_commit', projectPath: 'C:\\p', extraArgs: ['kötü "mesaj"  burada'] })
  assert.ok(built.ok)
  if (built.ok) {
    assert.equal(built.command, 'git add -A && git commit -m "kötü mesaj  burada"')
    assert.equal(built.risk, 'write')
  }
})

test('buildAdapterCommand: ffmpeg probe ffprobe yoluna döner ve boş medya dosyasını eler', () => {
  const withMedia = buildAdapterCommand({ adapterId: 'ffmpeg', actionId: 'probe', mediaFile: 'C:\\video\\klip.mp4' })
  assert.ok(withMedia.ok)
  if (withMedia.ok) assert.ok(withMedia.command.startsWith('ffprobe "C:\\video\\klip.mp4"'))
  const withoutMedia = buildAdapterCommand({ adapterId: 'ffmpeg', actionId: 'probe' })
  assert.ok(withoutMedia.ok)
  if (withoutMedia.ok) assert.equal(withoutMedia.command, 'ffprobe')
})

test('buildAdapterCommand: pip list proje gerektirmez, vscode open proje yolu çift tırnaklı götürür', () => {
  const pipList = buildAdapterCommand({ adapterId: 'pip', actionId: 'list' })
  assert.ok(pipList.ok)
  if (pipList.ok) assert.equal(pipList.command, 'pip list --format=columns')
  const open = buildAdapterCommand({ adapterId: 'vscode', actionId: 'open', projectPath: 'C:\\projeler\\demo' })
  assert.ok(open.ok)
  if (open.ok) assert.equal(open.command, 'code "C:\\projeler\\demo"')
})

test('findAdapter büyük/küçük harf duyarsızdır', () => {
  assert.ok(findAdapter('GIT'))
  assert.equal(findAdapter('nope'), null)
})

test('kurulum gerektiren eylemler risk etiketi taşır', () => {
  const npmInstall = buildAdapterCommand({ adapterId: 'npm', actionId: 'install', projectPath: 'C:\\p', extraArgs: ['typescript'] })
  assert.ok(npmInstall.ok)
  if (npmInstall.ok) {
    assert.equal(npmInstall.risk, 'install')
    assert.equal(npmInstall.command, 'npm install typescript')
  }
  const pipInstall = buildAdapterCommand({ adapterId: 'pip', actionId: 'install', extraArgs: ['requests'] })
  assert.ok(pipInstall.ok)
  if (pipInstall.ok) assert.equal(pipInstall.risk, 'install')
})

test('yeni geliştirme adaptörleri gerçek komutları üretir', () => {
  const cases = [
    ['pnpm', 'build', 'pnpm build'], ['yarn', 'test', 'yarn test'], ['bun', 'build', 'bun run build'],
    ['maven', 'package', 'mvn package'], ['cargo', 'check', 'cargo check'], ['go', 'test', 'go test ./...'],
    ['cmake', 'configure', 'cmake -S . -B build'], ['ninja', 'build', 'ninja -C build'],
  ] as const
  for (const [adapterId, actionId, command] of cases) {
    const built = buildAdapterCommand({ adapterId, actionId, projectPath: 'C:\\projeler\\demo' })
    assert.ok(built.ok, `${adapterId}/${actionId} komut üretmeli`)
    if (built.ok) assert.equal(built.command, command)
  }
})
