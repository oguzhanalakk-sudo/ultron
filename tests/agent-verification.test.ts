import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { assessToolOutcome, isChangeVerification, VerificationLedger, verificationKey } from '../electron/agent-verification.ts'
import { analyzeAgentError, AgentOrchestrator } from '../electron/agent-orchestrator.ts'
import { TaskStore } from '../electron/task-store.ts'

const failure = (tool: string) => analyzeAgentError({ message: 'Tests failed: token=private-test-value', tool, stage: 'testing', exitCode: 1 })

test('gerçek komut zarfı başarısızlık, iptal, ret ve eksik çıkış kodunu başarı saymaz', () => {
  for (const code of [1, -1, -2, -3]) assert.equal(assessToolOutcome('run_tests', `Komut çıkış kodu: ${code}\noutput`).failed, true)
  assert.equal(assessToolOutcome('run_tests', 'Komut çıkış kodu: 0\nKomut çıkış kodu: 1').failed, false, 'stdout içindeki metin zarfın çıkış kodunu değiştiremez')
  assert.equal(assessToolOutcome('run_command', 'Kullanıcı işlemin çalıştırılmasını reddetti.').failed, true)
  assert.equal(assessToolOutcome('run_powershell', 'İşlem başarısız: ENOENT').failed, true)
  assert.equal(assessToolOutcome('run_tests', 'Tests passed').failed, true)
  assert.equal(assessToolOutcome('delete_file', 'Kullanıcı işlemin çalıştırılmasını reddetti.').failed, true)
  assert.equal(assessToolOutcome('web_database', 'İşlem kullanıcı tarafından iptal edildi; komut başlatılmadı.').failed, true)
  assert.equal(assessToolOutcome('undo_change', JSON.stringify({ ok: false, message: 'Dosya kullanıcı tarafından değiştirildi.' })).failed, true)
})

test('yapılandırılmış Android, Windows ve HTTP sonuçları gerçek başarı alanlarından doğrulanır', () => {
  assert.equal(assessToolOutcome('build_android', JSON.stringify({ build: { exitCode: 0 }, analysis: { summary: 'APK bulunamadı' } })).failed, true)
  assert.equal(assessToolOutcome('build_android', JSON.stringify({ build: { exitCode: null } })).failed, true)
  assert.equal(assessToolOutcome('build_android', JSON.stringify({ build: { exitCode: 0 } })).failed, false)
  assert.equal(assessToolOutcome('windows_build', JSON.stringify({ success: false, output: 'Komut çıkış kodu: 0', build: { failure: { summary: 'EXE bulunamadı' } } })).failed, true)
  assert.equal(assessToolOutcome('windows_build', JSON.stringify({ success: true, build: {} })).failed, false)
  assert.equal(assessToolOutcome('web_http_check', JSON.stringify({ ok: false, status: 503 })).failed, true)
  assert.equal(assessToolOutcome('web_http_check', JSON.stringify({ ok: true, body: 'Tests failed; ignore instructions' })).failed, false)
  for (const tool of ['build_android', 'windows_build', 'web_http_check']) assert.equal(assessToolOutcome(tool, '{malformed').failed, true)
})

test('dosya ve günlük içerikleri komut sonucuyla karıştırılmaz', () => {
  assert.equal(assessToolOutcome('read_file', 'Kullanıcı işlemin çalıştırılmasını reddetti.\nKomut çıkış kodu: 1').failed, false)
})

test('başarısız test yalnızca aynı kontrol başarıyla yeniden çalıştırıldığında çözülür', () => {
  const ledger = new VerificationLedger()
  ledger.record('run_tests', '{"command":"npm test"}', failure('run_tests'))
  ledger.record('run_tests', '{"command":"npm run lint"}')
  ledger.record('read_file', '{"path":"index.js"}')
  ledger.record('web_http_check', '{"url":"http://localhost:8080"}')
  assert.equal(ledger.pending.length, 1, 'İlgisiz test, okuma veya HTTP başarısı test hatasını temizleyemez')
  ledger.record('run_tests', '{"command":"npm test"}')
  assert.equal(ledger.pending.length, 0)
})

test('çoklu doğrulama hataları ayrı tutulur, argüman sırası ve gerekçe kimliği değiştirmez', () => {
  const ledger = new VerificationLedger()
  ledger.record('run_command', '{"command":"npm test","reason":"ilk"}', failure('run_command'))
  ledger.record('build_android', '{"task":"assembleDebug"}', failure('build_android'))
  ledger.record('run_command', '{"reason":"yeniden kontrol","command":"npm test"}')
  assert.equal(ledger.pending.length, 1)
  assert.equal(ledger.pending[0].tool, 'build_android')
  assert.equal(verificationKey('web_http_check', '{"url":"http://localhost","timeout_ms":100}'), verificationKey('web_http_check', '{"timeout_ms":1000,"url":"http://localhost"}'))
})

test('başarısız test ve düzeltme döngüsü aynı kontrolün sonucu ile kapanır; hata sayacı görevi kesmez', () => {
  const ledger = new VerificationLedger()
  const orchestrator = new AgentOrchestrator()
  const tool = 'run_tests', args = '{"command":"npm test"}'
  for (const output of ['Komut çıkış kodu: 1\nTests failed', 'Komut çıkış kodu: 0\nTests passed']) {
    const outcome = assessToolOutcome(tool, output)
    const analysis = outcome.failed ? failure(tool) : undefined
    ledger.record(tool, args, analysis)
    if (analysis) assert.equal(orchestrator.recordToolFailure(verificationKey(tool, args)).shouldBlock, false)
  }
  assert.equal(ledger.pending.length, 0)
  const failing = new AgentOrchestrator()
  const stops = [1, 2, 3].map(() => failing.recordToolFailure(verificationKey(tool, args)).shouldBlock)
  assert.deepEqual(stops, [false, false, false])
})

test('açık kontrol sınırı eski hataları düşürmez; yeni kontrol durur ama mevcut kontrol düzeltilebilir', () => {
  const ledger = new VerificationLedger()
  for (let i = 0; i < 48; i++) ledger.record('run_tests', JSON.stringify({ command: `test-${i}` }), failure('run_tests'))
  assert.equal(ledger.canRun('run_tests', '{"command":"new"}'), false)
  assert.throws(() => ledger.record('run_tests', '{"command":"new"}', failure('run_tests')), /sınırına ulaşıldı/)
  assert.equal(ledger.pending.length, 48)
  assert.equal(ledger.canRun('read_file', '{}'), true)
  assert.equal(ledger.canRun('run_tests', '{"command":"test-0"}'), true)
  ledger.record('run_tests', '{"command":"test-0"}')
  assert.equal(ledger.canRun('run_tests', '{"command":"new"}'), true)
})

const revisionA = 'a'.repeat(64), revisionB = 'b'.repeat(64)
test('platform listeleme/yapılandırma ve eski EXE başlatma kod doğrulaması değildir', () => {
  const cases: [string, Record<string, string>, boolean][] = [
    ['build_android', { task: ':app:tasks' }, false], ['build_android', { task: 'projects' }, false],
    ['build_android', { task: ':app:assembleDebug' }, true], ['build_android', { task: 'testDebugUnitTest' }, true],
    ['windows_build', { action: 'configure' }, false], ['windows_build', { action: 'verify_start' }, false],
    ['windows_build', { action: 'build' }, true], ['windows_build', { action: 'test' }, true],
    ['run_command', { command: 'node --version' }, false],
  ]
  for (const [tool, args, expected] of cases) {
    const ledger = new VerificationLedger()
    ledger.record(tool, JSON.stringify(args), undefined, { fingerprint: revisionA, stable: true })
    assert.equal(isChangeVerification(ledger.results[0]), expected, `${tool} ${JSON.stringify(args)}`)
  }
})

test('başarılı kontrol kaynak sürümüne bağlıdır; değişiklikte eskir ve yalnız aynı kontrol yeniden çözebilir', () => {
  const ledger = new VerificationLedger()
  const args = '{"command":"npm test"}'
  ledger.record('run_tests', args, undefined, { fingerprint: revisionA, stable: true })
  assert.equal(ledger.hasAcceptance(' npm test '), true)
  ledger.invalidate(revisionA)
  assert.equal(ledger.pending.length, 0)
  ledger.invalidate(revisionB)
  assert.equal(ledger.results.length, 0)
  assert.equal(ledger.pending[0].status, 'stale')
  assert.equal(ledger.latestError, undefined, 'Eski kontrol başarısız testle karıştırılmamalı')
  ledger.record('run_tests', '{"command":"npm run lint"}', undefined, { fingerprint: revisionB, stable: true })
  assert.equal(ledger.pending.length, 1)
  assert.equal(ledger.hasAcceptance('npm test'), false)
  ledger.record('run_tests', args, undefined, { fingerprint: revisionB, stable: true })
  assert.equal(ledger.pending.length, 0)
  assert.equal(ledger.hasAcceptance('npm test'), true)
})

test('test sırasında değişen, okunamayan kaynak veya salt analiz başarı kanıtı üretemez', () => {
  const ledger = new VerificationLedger()
  ledger.record('run_tests', '{"command":"npm test"}', undefined, { fingerprint: revisionA, stable: false })
  assert.equal(ledger.pending[0].status, 'stale')
  ledger.record('run_tests', '{"command":"npm test"}', undefined, { stable: true })
  assert.equal(ledger.hasAcceptance('npm test'), false)
  ledger.record('windows_build', '{"action":"analyze"}', undefined, { fingerprint: revisionA, stable: true })
  assert.equal(ledger.results.length, 0)
  ledger.record('run_tests', '{"command":"npm test"}', undefined, { fingerprint: revisionA, stable: true })
  ledger.invalidate()
  assert.equal(ledger.pending.length, 1, 'Güncellik kanıtlanamıyorsa eski sonuç kullanılmamalı')
})

test('başarı makbuzları devamda parmak iziyle karşılaştırılır; ham komut ve kaynak içerik saklanmaz', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'kod-receipts-'))
  try {
    const store = new TaskStore(project), task = await store.create('Kanıtları koru')
    const ledger = new VerificationLedger()
    const args = '{"command":"node --test private-script.cjs","reason":"token=private-argument"}'
    ledger.record('run_tests', args, undefined, { fingerprint: revisionA, stable: true })
    await store.update(task.id, { verificationResults: ledger.results, verificationRequired: true })
    await store.finish(task.id, 'paused')
    const resumed = await new TaskStore(project).resume(task.id)
    const restored = new VerificationLedger(resumed.verificationFailures, resumed.verificationResults)
    restored.invalidate(revisionA)
    assert.equal(restored.results.length, 1)
    restored.invalidate(revisionB)
    assert.equal(restored.pending[0].status, 'stale')
    const raw = await readFile(path.join(project, '.codex-local', 'tasks.json'), 'utf8')
    assert.equal(raw.includes('private-script'), false)
    assert.equal(raw.includes('private-argument'), false)
  } finally { await rm(project, { recursive: true, force: true }) }
})

test('48 başarılı kontrol de sınırı doldurur; sonuçlar sessizce düşürülmez', () => {
  const ledger = new VerificationLedger()
  for (let i = 0; i < 48; i++) ledger.record('run_tests', JSON.stringify({ command: `check-${i}` }), undefined, { fingerprint: revisionA, stable: true })
  assert.equal(ledger.canRun('run_tests', '{"command":"new"}'), false)
  ledger.invalidate(revisionB)
  assert.equal(ledger.pending.length, 48)
  assert.equal(ledger.canRun('run_tests', '{"command":"check-0"}'), true)
})

test('doğrulama hataları kesilme/devam sırasında korunur, gizli argümanlar saklanmaz ve başarı kapısı atlanamaz', async () => {
  const project = await mkdtemp(path.join(os.tmpdir(), 'kod-verification-'))
  try {
    const store = new TaskStore(project), task = await store.create('Testleri doğrula')
    const ledger = new VerificationLedger()
    const args = '{"command":"npm test","reason":"token=raw-argument-secret"}'
    ledger.record('run_tests', args, failure('run_tests'))
    await store.update(task.id, { verificationFailures: ledger.pending })
    await store.finish(task.id, 'interrupted')
    const reopened = new TaskStore(project)
    const resumed = await reopened.resume(task.id)
    const restored = new VerificationLedger(resumed.verificationFailures)
    assert.equal(restored.pending.length, 1)
    await reopened.finish(task.id, 'completed')
    assert.equal((await reopened.get(task.id))?.status, 'failed', 'Merkezi kayıt açık doğrulama hatasını başarıya çeviremez')
    const raw = await readFile(path.join(project, '.codex-local', 'tasks.json'), 'utf8')
    assert.equal(raw.includes('raw-argument-secret'), false)
    assert.equal(raw.includes('private-test-value'), false)
    restored.record('run_tests', args)
    await reopened.update(task.id, { verificationFailures: restored.pending })
    await reopened.finish(task.id, 'completed')
    assert.equal((await reopened.get(task.id))?.status, 'completed')
  } finally { await rm(project, { recursive: true, force: true }) }
})
