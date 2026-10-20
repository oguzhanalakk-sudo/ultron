import test from 'node:test'
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildFileIndex,
  diffFileIndex,
  findDuplicateFiles,
  matchesFileMeta,
  parseFileSearchRequest,
  scanDirectoryForQuery,
  searchFileIndex,
  scoreNameMatch,
  type FileSearchFsLite,
} from '../electron/file-search.ts'

function memoryFs(files: Map<string, { content?: Buffer; size?: number; mtime?: number }>): FileSearchFsLite {
  // Dosya sistemi benzetimi: hem 'dir/' hem Windows ters slaş girişini normalize eder.
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  return {
    async readdir(dir) {
      const prefix = `${normalize(dir)}/`
      const direct = new Map<string, boolean>()
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue
        const rest = filePath.slice(prefix.length)
        const slashIndex = rest.indexOf('/')
        const name = slashIndex === -1 ? rest : rest.slice(0, slashIndex)
        if (!name) continue
        direct.set(name, slashIndex !== -1)
      }
      return [...direct.entries()].map(([name, isDirectory]) => ({
        name,
        isDirectory: () => isDirectory,
        isSymbolicLink: () => false,
        isFile: () => !isDirectory,
      }))
    },
    async stat(filePath) {
      const entry = files.get(normalize(filePath))
      if (!entry) throw Object.assign(new Error('yok'), { code: 'ENOENT' })
      return { size: entry.size ?? entry.content?.length ?? 0, mtimeMs: entry.mtime ?? 1_700_000_000_000 }
    },
    async readFile(filePath) {
      const entry = files.get(normalize(filePath))
      if (!entry?.content) throw Object.assign(new Error('yok'), { code: 'ENOENT' })
      return entry.content
    },
  }
}

const rootPath = 'C:/arctest'

test('parseFileSearchRequest: pdf / excel / word türleri çözülür', () => {
  const request = parseFileSearchRequest('Bilgisayarımdaki bütün PDF dosyalarını bul')
  assert.deepEqual(request.extensions, ['.pdf'])
  assert.equal(request.wholeComputer, true)
  const excel = parseFileSearchRequest('İndirilenler klasöründeki Excel dosyalarını listele')
  assert.ok(excel.extensions.some((extension) => extension.startsWith('.xls')))
  assert.deepEqual(excel.folderHints, ['Downloads'])
  const word = parseFileSearchRequest('Belgelerimdeki word raporlarını bul')
  assert.ok(word.extensions.includes('.docx'))
  assert.deepEqual(word.folderHints, ['Documents'])
})

test('parseFileSearchRequest: tarih, boyut ve içerik kalıpları', () => {
  const big = parseFileSearchRequest('projede büyük boyutlu dosyaları tespit et')
  assert.ok(big.sizeFilter?.op === 'gt')
  assert.ok((big.sizeFilter?.bytes ?? 0) >= 50 * 1024 * 1024)
  const recent = parseFileSearchRequest('son değiştirdiğim md dosyalarını bul')
  assert.equal(recent.sortBy, 'recent')
  assert.ok(recent.extensions.includes('.md'))
  const today = parseFileSearchRequest('bugün değişen json dosyaları')
  assert.equal(today.modifiedWithin, 'day')
  const content = parseFileSearchRequest('içinde "api ayarları" geçen dosyaları bul')
  assert.deepEqual(content.contentTerms, ['api ayarları'])
  assert.ok(content.notices.length === 0)
  const contentUnquoted = parseFileSearchRequest('içinde hata geçen log dosyalarını bul')
  assert.deepEqual(contentUnquoted.contentTerms.length >= 1, true)
  assert.ok(contentUnquoted.extensions.includes('.log'))
  const missingContent = parseFileSearchRequest('projedeki metin dosyalarını bul')
  assert.equal(missingContent.notices.length, 0)
  const vagueContent = parseFileSearchRequest('metin dosyalarını bul ve içinde var olan hataları ara')
  assert.ok(vagueContent.notices.length >= 1)
})

test('matchesFileMeta: uzantı, boyut, mtime ve ad terimleri', () => {
  const request = parseFileSearchRequest('pdf dosyalarını bul')
  assert.equal(matchesFileMeta({ name: 'rapor.pdf', sizeBytes: 100, mtimeMs: Date.now() }, request), true)
  assert.equal(matchesFileMeta({ name: 'rapor.docx', sizeBytes: 100, mtimeMs: Date.now() }, request), false)
  const bigToday = parseFileSearchRequest('büyük dosyaları bul')
  assert.equal(matchesFileMeta({ name: 'video.mp4', sizeBytes: 60 * 1024 * 1024, mtimeMs: Date.now() }, bigToday), true)
  assert.equal(matchesFileMeta({ name: 'notlar.txt', sizeBytes: 1024, mtimeMs: Date.now() }, bigToday), false)
  const named = parseFileSearchRequest('adı "rapor" geçen dosyaları bul')
  assert.equal(matchesFileMeta({ name: 'proje-raporu.docx', sizeBytes: 10, mtimeMs: Date.now() }, named), true)
  assert.equal(matchesFileMeta({ name: 'sunum.docx', sizeBytes: 10, mtimeMs: Date.now() }, named), false)
})

test('scanDirectoryForQuery: ad araması derin klasörlerde çalışır, hariç klasörler atlanır', async () => {
  const files = new Map<string, { content?: Buffer }>([
    [`${rootPath}/src/deep/pdf/rapor.pdf`, { content: Buffer.from('pdf') }],
    [`${rootPath}/node_modules/kitap.pdf`, { content: Buffer.from('yok') }],
    [`${rootPath}/notlar.md`, { content: Buffer.from('not') }],
    [`${rootPath}/other/text.txt`, { content: Buffer.from('metin') }],
  ])
  const request = parseFileSearchRequest('pdf dosyalarını bul')
  request.limit = 50
  const result = await scanDirectoryForQuery(rootPath, request, {}, memoryFs(files))
  // node_modules hariç tutulur; notlar.md ve text.txt tür filtresine takılır
  assert.equal(result.visitedFiles, 3)
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].name, 'rapor.pdf')
  assert.equal(result.hits[0].relativePath, 'src/deep/pdf/rapor.pdf')
})

test('scanDirectoryForQuery: içerik araması snippet döndürür', async () => {
  const files = new Map<string, { content?: Buffer; mtime?: number }>([
    [`${rootPath}/a/config.json`, { content: Buffer.from('{"MYSQL_PASS":"gizli"}') }],
    [`${rootPath}/b/liste.txt`, { content: Buffer.from('hiçbir şey') }],
  ])
  const request = parseFileSearchRequest('içinde "MYSQL_PASS" geçen dosyaları bul')
  request.limit = 10
  const result = await scanDirectoryForQuery(rootPath, request, {}, memoryFs(files))
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].relativePath, 'a/config.json')
  assert.ok(result.hits[0].snippets.join(' ').includes('MYSQL_PASS'))
  // eşleşmeyen metin dosyası da bant içinde okunur; toplam okunan en az eşleşen dosyayı kapsar
  assert.ok(result.readBytes >= (files.get(`${rootPath}/a/config.json`)?.content?.length ?? 0))
})

test('scanDirectoryForQuery: PDF/DOCX içerik araması metoduna göre çözümlenir', async () => {
  // Standart bir PDF üret (deflate edilmiş Akış + Tj)
  // (zip-lite.test.ts'deki yaklaşım burada tekrarlanır)
  const { deflateRawSync } = await import('node:zlib')
  const streamText = 'BT (proje sertifikasinin dogrulamasi) Tj ET'
  const compressed = deflateRawSync(Buffer.from(streamText, 'latin1'))
  const pdf = Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj << /Length ${compressed.length} /Filter /FlateDecode >> stream\n`, 'latin1'),
    compressed,
    Buffer.from('\nendstream endobj\n%%EOF\n', 'latin1'),
  ])
  const files = new Map<string, { content?: Buffer }>([
    [`${rootPath}/docs/rapor.pdf`, { content: pdf }],
  ])
  const request = parseFileSearchRequest('içinde "sertifikasinin" geçen pdf dosyaları')
  request.limit = 20
  const result = await scanDirectoryForQuery(rootPath, request, {}, memoryFs(files))
  assert.equal(result.hits.length, 1)
  assert.equal(result.hits[0].name, 'rapor.pdf')
})

test('findDuplicateFiles: aynı içerik gruplanır', async () => {
  const contentA = Buffer.from('aynı içerik'.repeat(500))
  const files = new Map<string, { content?: Buffer }>([
    [`${rootPath}/a.bin`, { content: contentA }],
    [`${rootPath}/dup/alias.bin`, { content: contentA }],
    [`${rootPath}/b.bin`, { content: Buffer.from('farklı'.repeat(600)) }],
  ])
  const result = await findDuplicateFiles(rootPath, { fs: memoryFs(files), minSizeBytes: 64 })
  assert.equal(result.groups.length, 1)
  assert.equal(result.groups[0].files.length, 2)
  const names = result.groups[0].files.map((file) => file.name).sort()
  assert.deepEqual(names, ['a.bin', 'alias.bin'])
})

test('buildFileIndex ve diffFileIndex değişiklikleri bildirir', async () => {
  const files = new Map<string, { content?: Buffer; mtime?: number }>([
    [`${rootPath}/kaynak/a.ts`, { content: Buffer.from('const x = 1'), mtime: 1000 }],
    [`${rootPath}/kaynak/b.ts`, { content: Buffer.from('const y = 2'), mtime: 1000 }],
  ])
  const first = await buildFileIndex(rootPath, { fs: memoryFs(files) })
  assert.equal(first.entries.length, 2)
  // değişiklik: a kaldırıldı, b güncellendi, c eklendi
  const updated = new Map(files)
  updated.delete(`${rootPath}/kaynak/a.ts`)
  updated.set(`${rootPath}/kaynak/b.ts`, { content: Buffer.from('const y = 3'), mtime: 2000 })
  updated.set(`${rootPath}/kaynak/c.ts`, { content: Buffer.from('const z = 2'), mtime: 1000 })
  const second = await buildFileIndex(rootPath, { fs: memoryFs(updated) })
  const delta = diffFileIndex(first, second)
  assert.deepEqual(delta.added, ['kaynak/c.ts'])
  assert.deepEqual(delta.changed, ['kaynak/b.ts'])
  assert.deepEqual(delta.removed, ['kaynak/a.ts'])
  // kapsam değişince önceki indeks göz ardı edilir (karma karşılaştırma yapılmaz)
  const foreign = { root: 'C:/other', builtAt: '', entries: [], truncated: false }
  const foreignDelta = diffFileIndex(first, foreign)
  assert.equal(foreignDelta.added.length, 0)
  assert.equal(foreignDelta.changed.length, 0)
  assert.equal(foreignDelta.removed.length, 0)
})

test('searchFileIndex: indeks üzerinden ad+tür filtresi', async () => {
  const files = new Map<string, { content?: Buffer }>([
    [`${rootPath}/docs/rapor.pdf`, { content: Buffer.from('x') }],
    [`${rootPath}/docs/iken.pdf`, { content: Buffer.from('x') }],
    [`${rootPath}/docs/other.docx`, { content: Buffer.from('x') }],
  ])
  const index = await buildFileIndex(rootPath, { fs: memoryFs(files) })
  const request = parseFileSearchRequest('adı "rapor" geçen pdf dosyalarını bul')
  const hits = searchFileIndex(index, request)
  assert.equal(hits.length, 1)
  assert.equal(hits[0].name, 'rapor.pdf')
  const empty = parseFileSearchRequest('')
  assert.ok(searchFileIndex(index, empty).length === 3)
})

test('searchFileIndex: sıralama, limit kesilmeden önce tüm indeks üzerinde uygulanır', () => {
  const request = parseFileSearchRequest('son değiştirdiğim dosyaları bul')
  request.limit = 1
  const index = {
    root: rootPath,
    builtAt: new Date().toISOString(),
    truncated: false,
    entries: [
      ['eski.txt', 'eski.txt', 10, 1_000],
      ['yeni.txt', 'yeni.txt', 10, 2_000],
    ],
  }
  assert.equal(searchFileIndex(index, request)[0]?.name, 'yeni.txt')
})

test('scoreNameMatch: tam ad > önek > içerir', () => {
  const request = parseFileSearchRequest('adı "rapor" geçen dosyaları bul')
  assert.equal(scoreNameMatch('rapor', request), 6)
  assert.equal(scoreNameMatch('rapor2026.pdf', request), 5)
  assert.equal(scoreNameMatch('eski-rapor.pdf', request), 3)
  assert.equal(scoreNameMatch('sunum.pptx', request), 0)
  const empty = parseFileSearchRequest('büyük dosyaları bul')
  assert.equal(scoreNameMatch('herhangi.dosya', empty), 0)
})
