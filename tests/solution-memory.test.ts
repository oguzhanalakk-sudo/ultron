import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildAutorecordPayload,
  formatSolutionMemoryForModel,
  limitSolutionRecords,
  searchSolutionRecords,
  sanitizeSolutionRecord,
  solutionMemoryLimits,
  type SolutionRecord,
} from '../electron/solution-memory.ts'

function baseRecord(overrides: Partial<SolutionRecord> = {}): SolutionRecord {
  return {
    id: 'rec-1',
    createdAt: '2026-10-18T09:00:00.000Z',
    problem: 'Python modülü bulunamadı: yaml',
    errorMessage: 'ModuleNotFoundError: No module named "yaml"',
    cause: 'Sanal ortamda pyyaml kurulu değil',
    solution: 'pip install pyyaml',
    outcome: 'solved',
    verifiedBy: 'python -m pip show pyyaml çıkışı elle kontrol edildi',
    undoNote: null,
    sources: ['https://pypi.org/project/PyYAML/'],
    environmentNote: 'Windows 11, Python 3.13',
    ...overrides,
  }
}

test('geçersiz alanlar sterilize edilir ve kaynak URL filtresi uygulanır', () => {
  const record = sanitizeSolutionRecord({
    id: 'rec-x',
    createdAt: '2026-10-18T09:00:00.000Z',
    problem: '  Derleme hatası \u0007',
    errorMessage: 'x'.repeat(600),
    solution: 'adımı uygula',
    outcome: 'SOLVED',
    sources: ['https://github.com/a/b', 'ftp://kötü-adres/x', 'not-a-url', 42],
    environmentNote: 'Windows 11',
  })
  assert.ok(record)
  assert.equal(record.problem, 'Derleme hatası')
  assert.ok(record.errorMessage && record.errorMessage.length <= solutionMemoryLimits.maxMessageChars)
  assert.equal(record.outcome, 'solved')
  assert.deepEqual(record.sources, ['https://github.com/a/b'])
  assert.equal(record.errorMessage, 'x'.repeat(solutionMemoryLimits.maxMessageChars))
})

test('problem alanı boşsa kayıt oluşturulmaz', () => {
  assert.equal(sanitizeSolutionRecord({ outcome: 'failed' }), null)
  assert.equal(sanitizeSolutionRecord(null), null)
  assert.equal(sanitizeSolutionRecord('metin'), null)
})

test('kayıt listesi üst sınıra kırpılır (en yeniler kalır)', () => {
  const many: SolutionRecord[] = []
  for (let index = 0; index < solutionMemoryLimits.maxRecords + 60; index += 1) {
    many.push(baseRecord({ id: `rec-${index}`, problem: `sorun ${index}` }))
  }
  const limited = limitSolutionRecords(many)
  assert.equal(limited.length, solutionMemoryLimits.maxRecords)
  assert.equal(limited[limited.length - 1].id, `rec-${solutionMemoryLimits.maxRecords + 59}`)
})

test('arama gerçek ortak simge kümesine göre puanlar ve sıralar', () => {
  const records = [
    baseRecord({ id: 'python', problem: 'Python modülü bulunamadı: yaml', cause: 'pyyaml yok', solution: 'pip install pyyaml', outcome: 'solved' }),
    baseRecord({ id: 'gradle', problem: 'Gradle bağımlılıkları çözümlenemedi', cause: 'ağ sorunu', solution: 'proxy ayarla', outcome: 'failed' }),
    baseRecord({ id: 'ilgisiz', problem: 'Fotolar katologlanamadı', cause: null, solution: null, outcome: 'partial' }),
  ]
  const scored = searchSolutionRecords(records, 'python modül yaml bulunamadı hatası')
  assert.ok(scored.length >= 1)
  assert.equal(scored[0].record.id, 'python')
  assert.ok(scored[0].score > 0.15)
  assert.equal(searchSolutionRecords(records, '   ').length, 0)
  const empty = searchSolutionRecords([], 'python yaml')
  assert.equal(empty.length, 0)
})

test('solved kayıtlar failed kayıtlardan öne geçer', () => {
  const records = [
    baseRecord({ id: 'failed', problem: 'npm install ağ hatası', cause: 'proxy', solution: 'x', outcome: 'failed' }),
    baseRecord({ id: 'solved', problem: 'npm install ağ hatası', cause: 'proxy', solution: 'ayarla', outcome: 'solved', verifiedBy: 'test' }),
  ]
  const scored = searchSolutionRecords(records, 'npm install ağ hatası')
  assert.ok(scored.length === 2)
  assert.equal(scored[0].record.id, 'solved')
})

test('boş liste için model çıktısı null döner; dolu listede uyarı satırı görünür', () => {
  assert.equal(formatSolutionMemoryForModel([]), null)
  const record1 = baseRecord({ outcome: 'solved', sources: ['https://pypi.org/project/PyYAML/'] })
  const record2 = baseRecord({ id: 'rec-2', problem: 'npm install EADDRINUSE', outcome: 'failed', verifiedBy: null, sources: [] })
  const text = formatSolutionMemoryForModel(searchSolutionRecords([record1, record2], 'npm install hata', 5))
  assert.ok(text)
  assert.ok(text.includes('KÖRÜ KÖRÜNE UYULMAZ'))
  assert.ok(text.includes('BAŞARISIZ DENEME'))
  assert.ok(text.includes('https://pypi.org/project/PyYAML/'))
})

test('otomatik kayıt yükü (autorecord) güvenli alanlarla üretilir', () => {
  const payload = buildAutorecordPayload({
    problem: 'Not Defteri açılmadı',
    errorMessage: 'exit code 1',
    cause: 'yol bulunamadı',
    solution: 'yolu düzelt',
    outcome: 'solved',
    verifiedBy: 'notepad.exe tekrar açıldı',
    sources: ['https://example.com/fix'],
    environmentNote: 'Windows 11',
  }, 'auto-1')
  assert.ok(payload)
  assert.equal(payload.outcome, 'solved')
  assert.ok(payload.createdAt.length >= 20)
  const badSources = buildAutorecordPayload({ problem: 'test', sources: ['javascript:alert(1)'] }, 'auto-2')
  assert.ok(badSources)
  assert.deepEqual(badSources.sources, [])
})
