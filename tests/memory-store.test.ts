import test from 'node:test'
import assert from 'node:assert/strict'
import {
  findSimilarEntry,
  forgetMatchingEntries,
  memoryLimits,
  mergeIntoMemory,
  newMemoryEntry,
  normalizeMemoryTags,
  normalizeMemoryText,
  removeMemoryEntry,
  sanitizeUserMemory,
  selectRelevantMemory,
  trimMemoryEntries,
  updateMemoryEntry,
} from '../electron/memory-store.ts'
import type { MemoryEntry } from '../electron/shared.ts'

const makeEntry = (overrides: Partial<MemoryEntry> = {}): MemoryEntry => ({
  id: 'entry-0000001',
  kind: 'knowledge',
  text: 'Kullanıcı TypeScript projeleri geliştiriyor.',
  tags: [],
  projectPath: null,
  source: 'user',
  createdAt: '2026-10-18T10:00:00.000Z',
  updatedAt: '2026-10-18T10:00:00.000Z',
  conflictWith: null,
  ...overrides,
})

test('normalizeMemoryText denetim karakterlerini temizler ve sınırlar', () => {
  assert.equal(normalizeMemoryText('  Merhaba\u0000 dünya \r\n'), 'Merhaba dünya')
  assert.equal(normalizeMemoryText(''), null)
  assert.equal(normalizeMemoryText(42), null)
  const long = 'a'.repeat(3000)
  assert.equal(normalizeMemoryText(long)?.length, memoryLimits.textLength)
})

test('normalizeMemoryTags tekrarları ve aşırı uzun etiketleri eler', () => {
  const tags = normalizeMemoryTags(['proje', 'proje', 'x'.repeat(80), 7, 'test'])
  assert.equal(tags.length, 3)
  assert.equal(tags[0], 'proje')
  assert.equal(tags[1]?.length, memoryLimits.tagLength)
  assert.equal(tags[2], 'test')
})

test('sanitizeUserMemory geçersiz kayıtları atar ve kimlik tekrarlarını engeller', () => {
  const memory = sanitizeUserMemory({
    entries: [
      makeEntry(),
      makeEntry(),
      { kind: 'yok', text: 'geçersiz tür' },
      { kind: 'knowledge', text: '' },
      'metin değil',
      null,
      makeEntry({ id: undefined, kind: 'preference', text: 'Kısa yanıt ister.' }),
    ],
  })
  assert.equal(memory.version, 1)
  assert.equal(memory.entries.length, 2)
  assert.equal(memory.entries[0]?.id, 'entry-0000001')
  assert.equal(memory.entries[1]?.kind, 'preference')
})

test('mergeIntoMemory benzer kaydı günceller, yeni bilgiyi ekler', () => {
  const first = makeEntry()
  const added = newMemoryEntry({ kind: 'knowledge', text: 'Kullanıcı Rust öğreniyor.', now: '2026-10-18T11:00:00.000Z' })
  assert.ok(added)
  const result = mergeIntoMemory([first], added)
  assert.equal(result.action, 'added')
  assert.equal(result.entries.length, 2)

  const update = newMemoryEntry({ kind: 'knowledge', text: 'Kullanıcı TypeScript projeleri geliştiriyor.', tags: ['dil'], now: '2026-10-18T12:00:00.000Z' })
  assert.ok(update)
  const merged = mergeIntoMemory(result.entries, update)
  assert.equal(merged.action, 'merged')
  assert.equal(merged.entries.length, 2)
  assert.equal(merged.entry.updatedAt, '2026-10-18T12:00:00.000Z')
  assert.deepEqual(merged.entry.tags, ['dil'])
})

test('mergeIntoMemory çelişen kayıtları karşılıklı işaretler', () => {
  const base = makeEntry({ text: 'Bildirimler açık kalsın.' })
  const conflict = newMemoryEntry({ kind: 'knowledge', text: 'Bildirimler açık kalmasın, kapatılsın.', source: 'feedback' })
  assert.ok(conflict)
  const result = mergeIntoMemory([base], conflict)
  assert.equal(result.action, 'conflict')
  assert.equal(result.entry.conflictWith, base.id)
  const previous = result.entries.find((entry) => entry.id === base.id)
  assert.equal(previous?.conflictWith, result.entry.id)
})

test('findSimilarEntry yalnızca aynı tür ve kapsamdaki güçlü eşleşmeyi bulur', () => {
  const project = 'C:\\projeler\\ultron'
  const entries = [makeEntry({ id: 'entry-0000002', kind: 'knowledge', text: 'Veritabanı SQLite kullanıyor.', projectPath: project })]
  assert.equal(findSimilarEntry(entries, 'Veritabanı SQLite kullanıyor.', 'knowledge', project)?.id, 'entry-0000002')
  assert.equal(findSimilarEntry(entries, 'Veritabanı SQLite kullanıyor.', 'preference', project), null)
  assert.equal(findSimilarEntry(entries, 'Veritabanı SQLite kullanıyor.', 'knowledge', null), null)
  assert.equal(findSimilarEntry(entries, 'Bambaşka bir konu hakkında not.', 'knowledge', project), null)
})

test('selectRelevantMemory sorguyla örtüşen ve proje kayıtlarını öne alır', () => {
  const entries = [
    makeEntry({ id: 'entry-0000010', text: 'Testler vitest ile çalışır.', updatedAt: '2026-10-01T10:00:00.000Z' }),
    makeEntry({ id: 'entry-0000011', text: 'Dağıtım Docker ile yapılır.', updatedAt: '2026-10-17T10:00:00.000Z' }),
    makeEntry({ id: 'entry-0000012', text: 'Testler her zaman yeşil bırakılmalı.', kind: 'preference', updatedAt: '2026-10-17T10:00:00.000Z' }),
  ]
  const selected = selectRelevantMemory(entries, 'testleri nasıl çalıştırıyorsun?', { limit: 2 })
  assert.equal(selected.length, 2)
  assert.ok(selected.some((entry) => entry.id === 'entry-0000010'))
  assert.ok(selected.some((entry) => entry.id === 'entry-0000012'))
})

test('updateMemoryEntry metni günceller, geçersiz metni reddeder', () => {
  const entries = [makeEntry()]
  const updated = updateMemoryEntry(entries, 'entry-0000001', { text: 'Yeni metin.', tags: ['not'] }, '2026-10-18T13:00:00.000Z')
  assert.equal(updated?.text, 'Yeni metin.')
  assert.equal(updated?.updatedAt, '2026-10-18T13:00:00.000Z')
  assert.equal(updateMemoryEntry(entries, 'entry-0000001', { text: '   ' }), null)
  assert.equal(updateMemoryEntry(entries, 'bulunamayan-id', { text: 'x' }), null)
})

test('forgetMatchingEntries eşleşen kayıtları siler, removeMemoryEntry olmayanı bildirir', () => {
  const entries = [
    makeEntry({ id: 'entry-0000020', text: 'Ofis adresi Kadıköy.' }),
    makeEntry({ id: 'entry-0000021', text: 'Toplantılar salı günleri.' }),
  ]
  assert.equal(forgetMatchingEntries(entries, 'Ofis adresi Kadıköy.'), 1)
  assert.equal(entries.length, 1)
  assert.equal(removeMemoryEntry(entries, 'entry-0000021'), true)
  assert.equal(removeMemoryEntry(entries, 'entry-0000021'), false)
})

test('trimMemoryEntries sınır aşıldığında önce konuşma kayıtlarını eler', () => {
  const entries: MemoryEntry[] = []
  for (let index = 0; index < memoryLimits.total + 5; index++) {
    entries.push(makeEntry({ id: `entry-conv-${index.toString().padStart(4, '0')}`, kind: 'conversation', text: `Görev özeti ${index}`, updatedAt: `2026-10-01T${String(index % 24).padStart(2, '0')}:00:00.000Z` }))
  }
  entries.push(makeEntry({ id: 'entry-pref-000001', kind: 'preference', text: 'Her zaman Türkçe yanıt ver.' }))
  const trimmed = trimMemoryEntries(entries)
  assert.equal(trimmed.length, memoryLimits.total)
  assert.ok(trimmed.some((entry) => entry.id === 'entry-pref-000001'))
  assert.ok(trimmed.filter((entry) => entry.kind === 'conversation').length <= memoryLimits.total - 1)
})
