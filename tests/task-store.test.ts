import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { planTaskRecord, TaskStore } from '../electron/task-store.ts'
import { acceptanceCommandKey } from '../electron/agent-verification.ts'
import type { VerificationReceipt } from '../electron/shared.ts'

async function withProject(run: (project: string) => Promise<void>) {
  const project = await mkdtemp(path.join(os.tmpdir(), 'kod-atolyesi-task-'))
  try { await run(project) } finally { await rm(project, { recursive: true, force: true }) }
}

test('görev, plan, araçlar, onaylar ve sonuçlar diske yazılır ve uygulama yeniden açıldığında okunur', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const task = await store.create('Bir dosyayı düzelt ve test et')
  await store.update(task.id, { plan: ['Dosyayı incele', 'Test et'], completedSteps: ['Dosyayı incele'], pendingSteps: ['Test et'], stage: 'testing', currentTool: 'run_tests', toolCalls: 4, correctionAttempts: 1 })
  await store.record(task.id, { at: new Date().toISOString(), type: 'tool', name: 'read_file', status: 'completed', detail: 'src/main.ts okundu' })
  await store.record(task.id, { at: new Date().toISOString(), type: 'approval', name: 'development', status: 'approved', detail: 'npm test' })
  await store.finish(task.id, 'interrupted', 'Uygulama kapandı')

  const reopened = new TaskStore(project)
  const loaded = await reopened.get(task.id)
  assert.equal(loaded?.status, 'interrupted')
  assert.deepEqual(loaded?.pendingSteps, ['Test et'])
  assert.deepEqual(loaded?.usedTools, ['read_file'])
  assert.equal(loaded?.stage, 'interrupted')
  assert.equal(loaded?.currentTool, undefined)
  assert.equal(loaded?.toolCalls, 4)
  assert.equal(loaded?.correctionAttempts, 1)
  assert.ok(loaded?.events.some((event) => event.status === 'approved'))
  const resumed = await reopened.resume(task.id)
  assert.equal(resumed?.status, 'running')
  assert.equal(resumed?.stage, 'analyzing')
}))

test('yeniden başlatmada yalnızca yarım kalan görevler sürdürülür ve proje kapsamı korunur', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const completed = await store.create('Biten görev')
  await store.finish(completed.id, 'completed')
  await assert.rejects(store.resume(completed.id), /plan adımı bulunan görevler sürdürülebilir/i)
  const responseWithPendingPlan = await store.create('Yanıtlanan ama doğrulanmamış görev')
  await store.update(responseWithPendingPlan.id, { plan: ['Testleri çalıştır'], pendingSteps: ['Testleri çalıştır'] })
  await store.finish(responseWithPendingPlan.id, 'completed')
  assert.equal((await store.get(responseWithPendingPlan.id))?.status, 'needs_review', 'Merkezi kapı açık adımlı görevi tamamlandı kaydedemez')
  assert.equal((await store.resume(responseWithPendingPlan.id)).status, 'running', 'Açık doğrulama adımı olan yanıt sürdürülmeli')
  assert.equal(await new TaskStore(path.join(project, 'elsewhere')).get(completed.id), null)
}))

test('uygulama kapanışında çalışır veya onay bekleyen görev yarım kaldı olarak kaydedilir', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const running = await store.create('Derlemeyi sürdür')
  const waiting = await store.create('Onay bekleyen görev')
  await store.update(waiting.id, { status: 'waiting_approval' })
  await store.interruptActive()
  assert.equal((await store.get(running.id))?.status, 'interrupted')
  assert.equal((await store.get(waiting.id))?.status, 'interrupted')
}))

test('duraklatılan ve doğrulama bekleyen görevler kalıcıdır ve sürdürülebilir', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const paused = await store.create('Uzun görevi duraklat')
  await store.update(paused.id, { plan: ['Değişikliği test et'], pendingSteps: ['Değişikliği test et'], stage: 'testing' })
  await store.finish(paused.id, 'paused', 'Duraklatıldı')
  const review = await store.create('Planı doğrula')
  await store.update(review.id, { plan: ['Derlemeyi doğrula'], pendingSteps: ['Derlemeyi doğrula'] })
  await store.finish(review.id, 'needs_review', 'Doğrulama gerekiyor')
  const reopened = new TaskStore(project)
  assert.equal((await reopened.get(paused.id))?.status, 'paused')
  assert.equal((await reopened.get(paused.id))?.stage, 'paused')
  assert.equal((await reopened.get(review.id))?.status, 'needs_review')
  assert.equal((await reopened.resume(paused.id)).status, 'running')
  assert.equal((await reopened.resume(review.id)).status, 'running')
}))

test('görev günlükleri hassas anahtar örüntülerini maskeler', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const task = await store.create('api_key=sk-abcdefghijklmnop')
  await store.record(task.id, { at: new Date().toISOString(), type: 'error', name: 'request', detail: 'token=secret-value' })
  const loaded = await new TaskStore(project).get(task.id)
  assert.doesNotMatch(loaded?.request ?? '', /sk-abcdefghijklmnop/)
  assert.doesNotMatch(loaded?.errors.join(' ') ?? '', /secret-value/)
}))

test('kabul kontrolleri ve tamamlanan adım kimlikleri başka görevden sonra yeniden açma ve devamda korunur', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const task = await store.create('İki modüldeki aynı başlıklı kontrolleri tamamla')
  await store.update(task.id, planTaskRecord(task, {
    title: 'Modülleri doğrula', objective: 'Her modülü ayrı doğrula',
    steps: ['Testleri çalıştır', 'Testleri çalıştır'], tests: ['npm run test:api', 'npm run test:ui'],
  }))
  await store.update(task.id, { completedSteps: ['Testleri çalıştır'], completedStepIds: ['api-tests'], pendingSteps: ['Testleri çalıştır'] })
  await store.finish(task.id, 'paused')
  const other = await store.create('Bağımsız görev')
  await store.update(other.id, planTaskRecord(other, { title: 'Diğer', objective: 'Başka test', steps: ['Kontrol'], tests: ['npm run lint'] }))

  const reopened = new TaskStore(project)
  const resumed = await reopened.resume(task.id)
  assert.deepEqual(resumed.acceptanceTests, ['npm run test:api', 'npm run test:ui'])
  assert.deepEqual(resumed.completedStepIds, ['api-tests'], 'Aynı başlık başka adım kimliğinin tamamlandığı anlamına gelmez')
  assert.deepEqual(resumed.pendingSteps, ['Testleri çalıştır'])
  assert.deepEqual((await reopened.get(other.id))?.acceptanceTests, ['npm run lint'])
}))

test('yeniden planlama aynı başlıklı eski tamamlanmaları ve eski kabul kontrollerini taşımaz', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const task = await store.create('Planı güncelle')
  await store.update(task.id, { plan: ['Test et'], completedSteps: ['Test et'], completedStepIds: ['old-test'], pendingSteps: [], acceptanceTests: ['npm run old-test'] })
  const previous = await store.get(task.id)
  assert.ok(previous)
  await store.update(task.id, planTaskRecord(previous, { title: 'Yeni plan', objective: 'Yeni davranışı doğrula', steps: ['Test et'], tests: ['npm run new-test'] }))
  const replanned = await new TaskStore(project).get(task.id)
  assert.deepEqual(replanned?.completedSteps, [])
  assert.deepEqual(replanned?.completedStepIds, [])
  assert.deepEqual(replanned?.pendingSteps, ['Test et'])
  assert.deepEqual(replanned?.acceptanceTests, ['npm run new-test'])

  await store.update(task.id, planTaskRecord(previous, { title: 'Küçük görev', objective: 'Dosyayı incele', steps: ['İncele'] }))
  assert.deepEqual((await store.get(task.id))?.acceptanceTests, [], 'Eski çağrı imzası çalışır; önceki plana ait kontroller yeni plana taşınmaz')
}))

test('eski görev kayıtları eksik kabul kontrolü ve adım kimliği alanlarıyla okunabilir ve sürdürülebilir', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const task = await store.create('Eski sürümden kalan görev')
  const { acceptanceTests: _acceptanceTests, completedStepIds: _completedStepIds, verificationRequired: _verificationRequired, ...legacy } = task
  await writeFile(path.join(project, '.codex-local', 'tasks.json'), JSON.stringify([{ ...legacy, status: 'interrupted' }]))
  const reopened = new TaskStore(project)
  const resumed = await reopened.resume(task.id)
  assert.deepEqual(resumed.acceptanceTests, [])
  assert.deepEqual(resumed.completedStepIds, [])
  assert.equal(resumed.verificationRequired, false)
  assert.equal(resumed.status, 'running')
}))

test('kabul kontrolü ve adım kimliği alanları boyut sınırına ve gizlilik filtresine uyar', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const task = await store.create('Kontrolleri sakla')
  await store.update(task.id, {
    acceptanceTests: ['token=private-acceptance-secret', ...Array.from({ length: 35 }, (_, index) => `Kontrol ${index}: ${'x'.repeat(1_200)}`)],
    completedStepIds: Array.from({ length: 45 }, (_, index) => `step-${index}-${'i'.repeat(150)}`),
  })
  const reloaded = await new TaskStore(project).get(task.id)
  assert.equal(reloaded?.acceptanceTests?.length, 30)
  assert.ok(reloaded?.acceptanceTests?.every((item) => item.length <= 1_000))
  assert.equal(reloaded?.completedStepIds?.length, 40)
  assert.ok(reloaded?.completedStepIds?.every((item) => item.length <= 120))
  assert.equal((await readFile(path.join(project, '.codex-local', 'tasks.json'), 'utf8')).includes('private-acceptance-secret'), false)

  await writeFile(path.join(project, '.codex-local', 'tasks.json'), JSON.stringify([{ ...task, acceptanceTests: [null, 7, {}, '', '  ', 'password=on-disk-secret'], completedStepIds: [null, 4, {}, '', 'same-id', 'same-id'] }]))
  const malformed = await new TaskStore(project).get(task.id)
  assert.deepEqual(malformed?.acceptanceTests, ['password=[REDACTED]'])
  assert.deepEqual(malformed?.completedStepIds, ['same-id'])
}))

const receipt = (command: string, tool = 'run_tests', kind?: VerificationReceipt['kind']): VerificationReceipt => ({
  key: acceptanceCommandKey(`${tool}:${command}`), tool, checkedAt: '2026-10-17T09:00:00.000Z',
  fingerprint: 'a'.repeat(64), commandKey: acceptanceCommandKey(command),
  ...(kind ? { kind } : {}),
})

test('merkezi tamamlanma kapısı her kabul komutu için kendi başarılı run_tests kaydını gerektirir', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const task = await store.create('API ve UI testlerini doğrula')
  await store.update(task.id, { acceptanceTests: ['npm run test:api', 'npm run test:ui'] })
  await store.finish(task.id, 'completed')
  assert.equal((await store.get(task.id))?.status, 'needs_review')
  await store.update(task.id, { verificationResults: [receipt('npm run test:api'), receipt('npm run test:ui', 'run_command')] })
  await store.finish(task.id, 'completed')
  assert.equal((await store.get(task.id))?.status, 'needs_review', 'Genel komut başarısı zorunlu run_tests kontrolünün yerine geçmez')
  await store.update(task.id, { verificationResults: [receipt('npm run test:api'), receipt('npm run test:other')] })
  await store.finish(task.id, 'completed')
  assert.equal((await store.get(task.id))?.status, 'needs_review', 'Başka testin başarısı eksik kabul kontrolünü kapatamaz')
  await store.update(task.id, { verificationResults: [receipt('npm run test:api'), receipt('npm run test:ui')] })
  await store.finish(task.id, 'completed')
  assert.equal((await new TaskStore(project).get(task.id))?.status, 'completed')
}))

test('eski doğrulama inceleme bekler, gerçek başarısızlık ve açık yürütme hatası tamamlanmayı engeller', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const task = await store.create('Doğrulama durumunu denetle')
  const analysis = { category: 'test', stage: 'testing', message: 'Test yeniden çalışmalı', nextAction: 'Testi çalıştır', retryable: true } as const
  const stale = { key: acceptanceCommandKey('npm test'), tool: 'run_tests', status: 'stale', analysis } as const
  await store.update(task.id, { verificationFailures: [stale] })
  await store.finish(task.id, 'completed')
  assert.equal((await store.get(task.id))?.status, 'needs_review')
  assert.equal((await new TaskStore(project).get(task.id))?.verificationFailures?.[0].status, 'stale')
  await store.update(task.id, { verificationFailures: [{ ...stale, status: undefined }] })
  await store.finish(task.id, 'completed')
  assert.equal((await store.get(task.id))?.status, 'failed', 'Eski kayıtların status alanı yoksa gerçek başarısızlık kabul edilir')
  assert.equal((await store.get(task.id))?.verificationFailures?.[0].status, 'failed')
  await store.update(task.id, { verificationFailures: [], errorAnalysis: analysis })
  await store.finish(task.id, 'completed')
  assert.equal((await store.get(task.id))?.status, 'failed', 'Kontrol listesi boş olsa da açık yürütme hatası tamamlanmayı engeller')
  await store.update(task.id, { errorAnalysis: undefined })
  await store.finish(task.id, 'completed')
  assert.equal((await store.get(task.id))?.status, 'completed')
}))

test('doğrulama kayıtları geçerli hash ve tarihlerle sınırlıdır; ham argümanlar kalıcılaştırılmaz', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const task = await store.create('Kontrol kanıtlarını sakla')
  const records = Array.from({ length: 50 }, (_, index) => ({ ...receipt(`test-${index}`, 'run_tests', 'test'), checkedAt: '2026-10-17T12:00:00+03:00', rawArguments: 'token=raw-receipt-secret' }))
  const invalid = [
    { ...receipt('bad-key'), key: 'not-a-hash' },
    { ...receipt('bad-fingerprint'), fingerprint: 'not-a-hash' },
    { ...receipt('bad-date'), checkedAt: 'not-a-date' },
    { ...receipt('bad-tool'), tool: 'read_file' },
    { ...receipt('bad-command-key'), commandKey: 'raw-command-secret' },
    { ...receipt('array-key'), key: [receipt('array-key').key] },
    { ...receipt('array-fingerprint'), fingerprint: ['a'.repeat(64)] },
    { ...receipt('array-command-key'), commandKey: [acceptanceCommandKey('array-command-key')] },
  ]
  await writeFile(path.join(project, '.codex-local', 'tasks.json'), JSON.stringify([{ ...task, status: 'paused', verificationResults: [...records, ...invalid] }]))
  const reopened = new TaskStore(project)
  const resumed = await reopened.resume(task.id)
  assert.equal(resumed.verificationResults?.length, 48)
  assert.ok(resumed.verificationResults?.every((item) => item.checkedAt === '2026-10-17T09:00:00.000Z'))
  assert.ok(resumed.verificationResults?.every((item) => item.kind === 'test'))
  assert.equal(resumed.verificationResults?.[0].key, receipt('test-2').key)
  const persisted = await readFile(path.join(project, '.codex-local', 'tasks.json'), 'utf8')
  assert.equal(persisted.includes('raw-receipt-secret'), false)
  assert.equal(persisted.includes('raw-command-secret'), false)
  assert.deepEqual((await new TaskStore(project).get(task.id))?.verificationResults, resumed.verificationResults)
}))

test('gerçek değişiklik sonrası test gereksinimi yeniden planlamada korunur ve genel komutla karşılanamaz', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const task = await store.create('Dosyayı geliştir')
  assert.equal(task.verificationRequired, false)
  await store.update(task.id, { verificationRequired: true })
  await store.update(task.id, planTaskRecord(task, { title: 'Planı sadeleştir', objective: 'Sonucu doğrula', steps: ['Doğrula'] }))
  await store.update(task.id, { completedSteps: ['Doğrula'], pendingSteps: [], verificationResults: [receipt('node --version', 'run_command'), receipt('http://localhost:3000', 'web_http_check')] })
  const reopened = new TaskStore(project)
  assert.equal((await reopened.get(task.id))?.verificationRequired, true)
  await reopened.finish(task.id, 'completed')
  assert.equal((await reopened.get(task.id))?.status, 'needs_review', 'Genel komut veya HTTP başarısı değişiklik sonrası test/derleme zorunluluğunu karşılayamaz')
  for (const kind of [undefined, 'configuration', 'runtime'] as const) {
    await reopened.update(task.id, { verificationResults: [receipt('project-check', 'windows_build', kind)] })
    await reopened.finish(task.id, 'completed')
    assert.equal((await reopened.get(task.id))?.status, 'needs_review', `Windows ${kind ?? 'eski türsüz'} sonucu değişen kodun test/derleme kanıtı sayılamaz`)
  }
  for (const [tool, kind] of [['run_tests', 'test'], ['build_android', 'build'], ['windows_build', 'test'], ['windows_build', 'build']] as const) {
    await reopened.update(task.id, { verificationResults: [receipt('project-check', tool, kind)] })
    await reopened.finish(task.id, 'completed')
    assert.equal((await reopened.get(task.id))?.status, 'completed', `${tool} sonucu değişiklik sonrası doğrulama kabul edilmeli`)
  }
}))

test('bilinmeyen doğrulama türü atılır ve eski Windows makbuzu test veya build kanıtına yükseltilmez', async () => withProject(async (project) => {
  const store = new TaskStore(project)
  const task = await store.create('Windows kanıt türünü doğrula')
  await writeFile(path.join(project, '.codex-local', 'tasks.json'), JSON.stringify([{ ...task, verificationRequired: true, verificationResults: [{ ...receipt('configure-only', 'windows_build'), kind: 'unrecognized' }] }]))
  const reopened = new TaskStore(project)
  assert.equal((await reopened.get(task.id))?.verificationResults?.[0].kind, undefined)
  await reopened.finish(task.id, 'completed')
  assert.equal((await reopened.get(task.id))?.status, 'needs_review')
}))
