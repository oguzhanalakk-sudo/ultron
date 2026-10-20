import test from 'node:test'
import assert from 'node:assert/strict'
import { detectLocalFileFastPath, extractPlainNameTerms, isOpenableFileExtension, parseLocalTextFileOperation, selectFastPathHit, type RankableHit } from '../electron/local-file-actions.ts'

// Hızlı yol tespiti: açık kullanıcı klasörü + eylem fiili birlikte geçmeli.
test('masaüstü açma isteği hızlı yola düşer', () => {
  const detected = detectLocalFileFastPath('masaüstündeki not.txt dosyasını aç')
  assert.ok(detected, 'hızlı yol tespit edilmeli')
  assert.equal(detected.hint, 'Desktop')
  assert.equal(detected.action, 'open')
})

test('indirilenlerdeki pdf isteği hızlı yola düşer', () => {
  const detected = detectLocalFileFastPath('indirilenler klasöründeki rapor.pdf dosyasını göster')
  assert.ok(detected)
  assert.equal(detected.hint, 'Downloads')
  assert.equal(detected.action, 'open')
})

test('klasör ve eylem fiili olmadan hızlı yol reddedilir', () => {
  assert.equal(detectLocalFileFastPath('merhaba nasılsın'), null)
  assert.equal(detectLocalFileFastPath('bu projeyi test et'), null, 'kullanıcı klasörü yok')
  assert.equal(detectLocalFileFastPath('masaüstünü gösterebilir misin'), null, 'masaüstünde dosya eylemi yok')
})

test('üretici-yıkıcı niyetler hızlı yola girmez', () => {
  assert.equal(detectLocalFileFastPath('masaüstüne not.txt dosyası oluştur'), null)
  assert.equal(detectLocalFileFastPath('masaüstündeki eski not.txt dosyasını sil'), null)
  assert.equal(detectLocalFileFastPath('masaüstündeki raporu yeni bir kopyasının üzerine yaz'), null)
})

test('açık metin dosyası oluşturma, okuma ve değiştirme yerel yönlendiriciye ayrışır', () => {
  assert.deepEqual(parseLocalTextFileOperation('Masaüstümde test.txt dosyasını oluştur ve içine Merhaba yaz.'), { action: 'create', fileName: 'test.txt', content: 'Merhaba', hint: 'Desktop' })
  assert.deepEqual(parseLocalTextFileOperation('Masaüstümde test.txt dosyasını oku.'), { action: 'read', fileName: 'test.txt', hint: 'Desktop' })
  assert.deepEqual(parseLocalTextFileOperation('Masaüstümde test.txt dosyasındaki Merhaba kelimesini Selam olarak değiştir.'), { action: 'replace', fileName: 'test.txt', search: 'Merhaba', replacement: 'Selam', hint: 'Desktop' })
  assert.equal(parseLocalTextFileOperation('Masaüstümde test.txt dosyasını sil.'), null)
})

test('uzun ve belirsiz metinler hızlı yola girmez', () => {
  assert.equal(detectLocalFileFastPath('masaüstündeki dosyayı aç ve şu anda şunu söyleyeyim, aslında ' + 'detay '.repeat(80)), null)
})

test('uzantı politikası: belgeler açık, çalıştırılabilirler kapalı', () => {
  for (const ext of ['pdf', 'docx', 'xlsx', 'txt', 'png', 'mp4', 'zip', 'md', 'csv']) assert.equal(isOpenableFileExtension(ext), true, `${ext} açılabilmeli`)
  for (const ext of ['exe', 'bat', 'cmd', 'ps1', 'msi', 'lnk', 'vbs', 'js', 'iso', 'jar', 'sh']) assert.equal(isOpenableFileExtension(ext), false, `${ext} otomatik açılamamalı`)
  assert.equal(isOpenableFileExtension('bilmecetur'), false, 'bilinmeyen tür reddedilmeli')
  assert.equal(isOpenableFileExtension(''), false)
})

test('tek eşleşme açılır, çoklu eşleşme seçenek listesi döner', () => {
  const single: RankableHit[] = [{ name: 'not.txt', path: 'C:/Users/u/Desktop/not.txt' }]
  const decision = selectFastPathHit(single)
  assert.equal(decision.kind, 'open')
  assert.equal(decision.kind === 'open' ? decision.hit.path : '', 'C:/Users/u/Desktop/not.txt')

  const many: RankableHit[] = [
    { name: 'rapor v1.pdf', path: 'C:/Desktop/rapor v1.pdf', sizeBytes: 10_000, modifiedAt: '2026-09-01T00:00:00.000Z' },
    { name: 'rapor.pdf', path: 'C:/Desktop/rapor.pdf', sizeBytes: 20_000, modifiedAt: '2026-10-01T00:00:00.000Z' },
    { name: 'rapor eski.pdf', path: 'C:/Downloads/rapor eski.pdf' },
    { name: 'genişleyen.pdf', path: 'C:/Downloads/genişleyen.pdf' },
  ]
  const ambiguous = selectFastPathHit(many)
  assert.equal(ambiguous.kind, 'ambiguous')
  assert.equal(ambiguous.kind === 'ambiguous' ? ambiguous.top.length : -1, 3, 'en fazla üç öneri listede gösterilir')

  assert.equal(selectFastPathHit([]).kind, 'none')
})

test('ad terimleri uzantından temizlenir', () => {
  assert.deepEqual(extractPlainNameTerms(['not.txt', 'rapor.pdf']), ['not', 'rapor'])
  assert.deepEqual(extractPlainNameTerms(['', 'a']), [], 'iki karakterden kısa terimler atılır')
})
