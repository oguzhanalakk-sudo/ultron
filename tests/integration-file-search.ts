// Geçici entegrasyon doğrulaması: gerçek fs ile dosya arama motoru.
import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { findDuplicateFiles, scanDirectoryForQuery, parseFileSearchRequest } from '../electron/file-search.ts'

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ultron-fs-'))
  try {
    // yapı kur
    await fs.mkdir(path.join(root, 'docs'), { recursive: true })
    await fs.mkdir(path.join(root, 'node_modules'), { recursive: true })
    const pdfText = 'BT (proje sertifikasinin dogrulamasi) Tj ET'
    const compressed = deflateRawSync(Buffer.from(pdfText, 'latin1'))
    const pdf = Buffer.concat([Buffer.from(`%PDF-1.4\n1 0 obj << /Length ${compressed.length} /Filter /FlateDecode >> stream\n`, 'latin1'), compressed, Buffer.from('\nendstream endobj\n%%EOF\n', 'latin1')])
    await fs.writeFile(path.join(root, 'docs', 'rapor.pdf'), pdf)
    await fs.writeFile(path.join(root, 'notes.md'), '# not\napi sertifikasinin detaylari burada\n')
    await fs.writeFile(path.join(root, 'dup.txt'), 'b'.repeat(5000))
    await fs.writeFile(path.join(root, 'dup-copy.txt'), 'b'.repeat(5000))
    await fs.writeFile(path.join(root, 'node_modules', 'ignored.log'), 'burada hata var\n')
    // 1: içerik araması (PDF dahil), node_modules hariç
    const contentRequest = parseFileSearchRequest('içinde sertifikasinin geçen dosyaları bul')
    const contentResult = await scanDirectoryForQuery(root, contentRequest)
    const paths = contentResult.hits.map((item) => item.name).sort()
    assert.ok(paths.includes('rapor.pdf'), 'PDF içerik araması başarısız')
    assert.ok(paths.includes('notes.md'), 'md içerik araması başarısız')
    assert.ok(!paths.includes('ignored.log'), 'node_modules taramamalı')
    console.log('[OK] içerik araması:', paths.join(', '), '— ziyaret:', contentResult.visitedFiles, 'klasör:', contentResult.visitedDirs)
    // 2: yinelenen tespit
    const dup = await findDuplicateFiles(root, { minSizeBytes: 1000 })
    assert.equal(dup.groups.length, 1)
    assert.equal(dup.groups[0].files.length, 2)
    console.log('[OK] yinelenen grup:', dup.groups[0].files.map((file) => file.name).join(' + '))
    console.log('INTEGRATION-PASS')
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}
await main().catch((error) => { console.error('INTEGRATION-FAIL', error); process.exit(1) })
