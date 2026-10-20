import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createJsonStore, migrateDocument, storeFileName, StoreVersionError } from '../electron/json-store.ts'

async function tempDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'ultron-store-'))
}

type DemoData = { items: string[]; note: string }

test('storeFileName talimattaki tabloları depolara eşler', () => {
  assert.equal(storeFileName('plugins'), 'plugins.json')
  assert.equal(storeFileName('installed_software'), 'software-catalog.json')
  assert.equal(storeFileName('file_index'), 'file-index.json')
  assert.equal(storeFileName('file_search_history'), 'file-search-history.json')
})

test('migrateDocument: bozuk/eksik belge varsayılana düşer', () => {
  const fallback = () => ({ items: [], note: 'yeni' })
  assert.deepEqual(migrateDocument<DemoData>(undefined, { currentVersion: 2, fallback, migrations: [] }).data, { items: [], note: 'yeni' })
  assert.deepEqual(migrateDocument<DemoData>('hamsi', { currentVersion: 2, fallback, migrations: [] }).data, { items: [], note: 'yeni' })
  const old = { version: 1, data: { items: ['a'], extra: true } }
  const migrated = migrateDocument<DemoData>(old, {
    currentVersion: 2,
    fallback,
    migrations: [{ from: 1, to: 2, migrate: (data) => ({ items: (data as { items?: string[] }).items ?? [], note: 'göçen' }) }],
  })
  assert.equal(migrated.version, 2)
  assert.deepEqual(migrated.data, { items: ['a'], note: 'göçen' })
})

test('migrateDocument: daha yeni şema hatası dosyayı dokunulmaz yapar', () => {
  assert.throws(() => migrateDocument({ version: 3, data: {} }, {
    currentVersion: 2,
    fallback: () => ({}),
    migrations: [],
  }), StoreVersionError)
})

test('migrateDocument: doğrulama geçmezse varsayılana döner', () => {
  const result = migrateDocument<{ count: number }>(
    { version: 2, data: { count: -1 } },
    { currentVersion: 2, fallback: () => ({ count: 0 }), migrations: [], validate: (data) => data.count >= 0 },
  )
  assert.deepEqual(result.data, { count: 0 })
})

test('createJsonStore: yaz–ok turuncu değeri, bozuk dosyada yedek bırakır', async () => {
  const dir = await tempDir()
  try {
    const store = createJsonStore<DemoData>({
      currentVersion: 1,
      fallback: () => ({ items: [], note: '' }),
      migrations: [],
    })
    const file = path.join(dir, 'demo.json')
    await store.write(file, { items: ['elma'], note: 'taze' })
    const readBack = await store.read(file)
    assert.deepEqual(readBack.data, { items: ['elma'], note: 'taze' })
    assert.equal(readBack.version, 1)
    // Bozuk dosya: .bak kopyaları kurtarılmış kullanıcının elmasına benzer
    await fs.writeFile(file, '{bozuldu', 'utf8')
    const afterCorrupt = await store.read(file)
    assert.deepEqual(afterCorrupt.data, { items: [], note: '' })
    const backups = (await fs.readdir(dir)).filter((name) => name.includes('.corrupt.bak'))
    assert.equal(backups.length, 1)
  } finally {
    await fs.rm(dir, { recursive: true, force: true })
  }
})
